/**
 * components/filterbar.js — the shared filter row for the Contacts and Follow-ups
 * tabs. Multi-select dropdowns for any dimensions you pass, plus on/off toggles.
 * Options are derived from the loaded data and sorted by count; colours come from
 * the shared registry so a category looks the same here as on every chart.
 *
 * Selecting is instant (checkbox, chip and count update immediately); the heavier
 * re-render is announced through a debounced onChange so typing/clicking stays snappy.
 */
import { h, icon, refreshIcons } from '../ui.js';
import { debounce, tidy, formatNumber } from '../util.js';
import { filterOptions, applyFilters } from '../filters.js';

export function createFilterBar({ dimensions = [], toggles = [], onChange, debounceMs = 300 }) {
  const selections = new Map(dimensions.map((d) => [d.field, new Set()]));
  const toggleState = new Map(toggles.map((t) => [t.key, false]));
  let contacts = [];
  const groups = new Map();

  const el = h('div', { class: 'filterbar', role: 'group', 'aria-label': 'Filters' });
  const chipsEl = h('div', { class: 'chips-row' });

  const announce = debounce(() => onChange?.(), debounceMs);

  /* one dropdown per dimension */
  for (const dim of dimensions) {
    const menu = h('div', { class: 'fb-menu', hidden: true });
    const optionList = h('div', {});
    const search = h('input', {
      class: 'fb-search', type: 'search', placeholder: `Search ${dim.label.toLowerCase()}…`, 'aria-label': `Search ${dim.label}`,
    });
    search.addEventListener('input', () => paintOptions(dim, optionList, search.value));
    search.addEventListener('click', (e) => e.stopPropagation());

    const button = h('button', {
      class: 'fb-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    }, [
      icon(dim.icon || 'filter', 'size-4 text-slate-400'),
      h('span', { text: dim.label }),
      h('span', { class: 'fb-count', hidden: true }),
      icon('chevron-down', 'size-3.5 chev text-slate-400'),
    ]);
    button.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(dim.field); });

    menu.addEventListener('click', (e) => e.stopPropagation());
    menu.append(search, optionList);
    const group = h('div', { class: 'fb-group' }, [button, menu]);
    el.append(group);
    groups.set(dim.field, { dim, button, menu, optionList, search, countBadge: button.querySelector('.fb-count') });
  }

  /* toggles */
  for (const toggle of toggles) {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.addEventListener('change', () => {
      toggleState.set(toggle.key, input.checked);
      renderChips();
      announce();
    });
    const label = h('label', { class: 'fb-switch' }, [
      input,
      h('span', { class: 'fb-track' }),
      toggle.icon ? icon(toggle.icon, 'size-4 text-slate-400') : null,
      h('span', { text: toggle.label }),
    ]);
    el.append(label);
    groups.set(`toggle:${toggle.key}`, { toggle, input });
  }

  refreshIcons(el);

  /* ---------- menu open/close ---------- */
  function toggleMenu(field) {
    const target = groups.get(field);
    const isOpen = !target.menu.hidden;
    closeAllMenus();
    if (!isOpen) {
      paintOptions(target.dim, target.optionList, '');
      target.menu.hidden = false;
      target.button.setAttribute('aria-expanded', 'true');
      target.search.value = '';
      if (contacts.length > 12) requestAnimationFrame(() => target.search.focus());
    }
  }
  function closeAllMenus() {
    for (const g of groups.values()) {
      if (g.menu) { g.menu.hidden = true; g.button.setAttribute('aria-expanded', 'false'); }
    }
  }
  document.addEventListener('click', closeAllMenus);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllMenus(); });

  /* ---------- options ---------- */
  function paintOptions(dim, host, query) {
    const q = query.trim().toLowerCase();
    const all = dim.options ? dim.options(contacts) : filterOptions(contacts, dim.field);
    const shown = q ? all.filter((o) => o.value.toLowerCase().includes(q)) : all;
    const chosen = selections.get(dim.field);

    host.replaceChildren(...(shown.length ? shown.map((opt) => {
      const input = h('input', { type: 'checkbox' });
      input.checked = chosen.has(opt.value);
      input.addEventListener('change', () => {
        if (input.checked) chosen.add(opt.value); else chosen.delete(opt.value);
        updateCount(dim.field);
        renderChips();
        announce();
      });
      const row = h('label', { class: 'fb-option' }, [
        input,
        h('span', { class: 'fb-box' }, [icon('check', 'size-3')]),
        h('span', { class: 'fb-dot', style: `--c:${opt.color}` }),
        h('span', { class: 'fb-name', text: opt.value }),
        h('span', { class: 'fb-n', text: formatNumber(opt.count) }),
      ]);
      return row;
    }) : [h('div', { class: 'fb-empty', text: 'Nothing matches' })]));
    refreshIcons(host);
  }

  function updateCount(field) {
    const g = groups.get(field);
    const n = selections.get(field).size;
    g.countBadge.textContent = n ? String(n) : '';
    g.countBadge.hidden = !n;
    g.button.setAttribute('aria-expanded', g.menu.hidden ? 'false' : 'true');
  }

  /* ---------- active-filter chips ---------- */
  function renderChips() {
    const chips = [];
    for (const dim of dimensions) {
      for (const value of selections.get(dim.field)) {
        chips.push(h('span', { class: 'chip-filter' }, [
          h('span', { class: 'k', text: `${dim.label}:` }),
          h('span', { text: value }),
          h('button', { type: 'button', 'aria-label': `Remove ${value}`, onClick: () => removeValue(dim.field, value) }, [icon('x', 'size-3')]),
        ]));
      }
    }
    for (const toggle of toggles) {
      if (toggleState.get(toggle.key)) {
        chips.push(h('span', { class: 'chip-filter' }, [
          h('span', { text: toggle.label }),
          h('button', { type: 'button', 'aria-label': `Turn off ${toggle.label}`, onClick: () => setToggle(toggle.key, false) }, [icon('x', 'size-3')]),
        ]));
      }
    }
    if (chips.length) chips.push(h('button', { class: 'chips-clear', type: 'button', text: 'Clear all', onClick: clear }));
    chipsEl.replaceChildren(...chips);
    refreshIcons(chipsEl);
  }

  function removeValue(field, value) {
    selections.get(field).delete(value);
    updateCount(field);
    const g = groups.get(field);
    if (!g.menu.hidden) paintOptions(g.dim, g.optionList, g.search.value);
    renderChips();
    announce();
  }
  function setToggle(key, on) {
    toggleState.set(key, on);
    groups.get(`toggle:${key}`).input.checked = on;
    renderChips();
    announce();
  }
  function clear() {
    for (const set of selections.values()) set.clear();
    for (const key of toggleState.keys()) toggleState.set(key, false);
    for (const dim of dimensions) updateCount(dim.field);
    for (const toggle of toggles) groups.get(`toggle:${toggle.key}`).input.checked = false;
    closeAllMenus();
    renderChips();
    announce();
  }

  /** Replace all selections with a preset { field: [values] } (used by cross-tab jumps). */
  function setSelections(preset) {
    for (const set of selections.values()) set.clear();
    for (const key of toggleState.keys()) toggleState.set(key, false);
    for (const [key, val] of Object.entries(preset || {})) {
      if (selections.has(key)) {
        for (const v of (Array.isArray(val) ? val : [val])) selections.get(key).add(v);
        updateCount(key);
      } else if (toggleState.has(key)) {
        toggleState.set(key, !!val);
        const g = groups.get(`toggle:${key}`);
        if (g) g.input.checked = !!val;
      }
    }
    for (const t of toggles) { const g = groups.get(`toggle:${t.key}`); if (g) g.input.checked = toggleState.get(t.key); }
    renderChips();
    announce();
  }

  return {
    el,
    chipsEl,
    setSelections,
    setData(next) {
      contacts = next || [];
      // Drop any selected value that no longer exists in the data (e.g. after upload).
      for (const dim of dimensions) {
        if (!dim.test) {   // only prune plain-field dimensions against the data
          const present = new Set(contacts.map((c) => tidy(c[dim.field])));
          const chosen = selections.get(dim.field);
          for (const v of [...chosen]) if (!present.has(v)) chosen.delete(v);
        }
        updateCount(dim.field);
      }
      renderChips();
    },
    apply(list) {
      const activeToggles = toggles.filter((t) => toggleState.get(t.key));
      const activeDims = dimensions.filter((d) => selections.get(d.field).size);
      if (!activeDims.length && !activeToggles.length) return list;
      return list.filter((c) => {
        for (const d of activeDims) {
          const set = selections.get(d.field);
          const ok = d.test ? d.test(c, set) : set.has(tidy(c[d.field]));
          if (!ok) return false;
        }
        for (const t of activeToggles) if (!t.predicate(c)) return false;
        return true;
      });
    },
    isActive: () => [...selections.values()].some((s2) => s2.size) || [...toggleState.values()].some(Boolean),
    /** Serialise dims + active toggles for saving a segment. */
    getFilterState() {
      const out = {};
      for (const dim of dimensions) { const set = selections.get(dim.field); if (set.size) out[dim.field] = [...set]; }
      for (const t of toggles) if (toggleState.get(t.key)) out[t.key] = true;
      return out;
    },
    clear,
  };
}
