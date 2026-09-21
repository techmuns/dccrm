/**
 * colors.js — one colour per category, for the whole app.
 *
 * Two rules this file exists to enforce:
 *  1. A category keeps its colour everywhere. "Family Office" is the same hue on the
 *     donut, on a bar, and on any chart a future tab adds.
 *  2. Colour follows the category, never its current rank. Searching or filtering
 *     changes which categories are on screen — it never repaints the survivors,
 *     because the assignment is made once from the full dataset.
 *
 * There are eight hues and no ninth. Categories past slot eight take the neutral
 * slate, which reads honestly as "the tail" rather than as a made-up colour.
 */
import { PALETTE, NEUTRAL, STAGE_DORMANT } from './config.js';

const dimensions = new Map(); // dimension name -> Map(category -> hex)

/** Assign hues to a dimension's categories, in the order given. Called once per load. */
export function registerDimension(dimension, orderedNames) {
  const map = new Map();
  let slot = 0;
  for (const name of orderedNames) {
    if (!name || map.has(name)) continue;
    // Dormant sits outside the pipeline, so it reads as parked rather than as a stage.
    if (name === STAGE_DORMANT) { map.set(name, NEUTRAL); continue; }
    map.set(name, slot < PALETTE.length ? PALETTE[slot] : NEUTRAL);
    slot += 1;
  }
  dimensions.set(dimension, map);
  return map;
}

/**
 * Give a brand-new category a colour WITHOUT repainting the existing ones — it takes
 * the next free palette slot. Used when a contact is added/edited into a category
 * the initial data didn't have, so single writes never reshuffle colours.
 */
export function ensureCategory(dimension, name) {
  if (!name) return;
  let map = dimensions.get(dimension);
  if (!map) { map = new Map(); dimensions.set(dimension, map); }
  if (map.has(name)) return;
  if (name === STAGE_DORMANT) { map.set(name, NEUTRAL); return; }
  const used = [...map.values()].filter((c) => PALETTE.includes(c)).length;
  map.set(name, used < PALETTE.length ? PALETTE[used] : NEUTRAL);
}

export function colorOf(dimension, name) {
  const map = dimensions.get(dimension);
  return (map && map.get(name)) || NEUTRAL;
}

/** True when this category got a real hue rather than the neutral fallback. */
export const hasOwnColor = (dimension, name) => colorOf(dimension, name) !== NEUTRAL;

export function resetColors() {
  dimensions.clear();
}

/** A translucent version of a hue, for hover washes and tooltip headers. */
export function withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}
