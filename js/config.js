/**
 * config.js — the single source of truth for the design system's data-side constants.
 * Every tab built later reads from here so colours, stages and header mapping stay identical.
 */

/* Fixed categorical palette. Assigned in this order, never cycled, never re-ordered.
   Past slot 8 a category falls back to NEUTRAL instead of inventing a ninth hue. */
export const PALETTE = [
  '#a83a5b', // rose — primary
  '#4c6ea5', // slate blue
  '#2e8b74', // jade — success
  '#c08a2e', // amber
  '#c0392b', // muted red
  '#6f6b8f', // muted violet
  '#c24e70', // bright rose
  '#5b8c87', // muted teal
];

export const NEUTRAL = '#9a9aa0';   // everything past slot 8, and "Other" — platinum grey
export const SURFACE = '#ffffff';   // card surface — also the gap colour between marks

/* Dhamma's FINALISED pipeline. STAGE is a single value a record is in exactly one of.
   Heat, Dormant and the Closed states are SEPARATE fields (below) — not stages. */
export const STAGE_ORDER = [
  'Target',
  'Engaged',
  'Diligence',
  'Committed',
  'Onboarding',
  'Invested',
];
/* Every selectable stage — the six, and only the six. */
export const ALL_STAGES = [...STAGE_ORDER];
export const STAGE_INVESTED = 'Invested';   // the "won" stage (money received)
export const STAGE_COMMITTED = 'Committed';

/* Stages that count as "actively working the relationship" (not fresh Targets, not won). */
export const ACTIVE_STAGES = ['Engaged', 'Diligence', 'Committed', 'Onboarding'];

/* Fixed stage colours — one meaning, one hue, everywhere (funnel, chips, grid, drawer).
   A cool-to-warm funnel deepening toward the jade "won". */
export const STAGE_COLORS = {
  Target: '#aeaeaa',      // platinum grey — fresh
  Engaged: '#6b7a99',     // slate
  Diligence: '#4c6ea5',   // slate blue
  Committed: '#a83a5b',   // rose — the key milestone
  Onboarding: '#c08a2e',  // amber — in motion
  Invested: '#2e8b74',    // jade — won
};

/* Each stage's "move on when" hint — shown as a small tooltip on the stage editors. */
export const STAGE_HINTS = {
  Target: 'Researched + owner assigned',
  Engaged: 'Two-way exchange done; ticket & vehicle confirmed',
  Diligence: 'Deck / DDQ / calls / references in progress',
  Committed: 'Verbal yes with amount & timing',
  Onboarding: 'Subscription docs & KYC underway',
  Invested: 'Money received',
};

/* HEAT — a SEPARATE field (not a stage). Editable only on the earlier stages; hidden on
   Onboarding and Invested. Changing Heat NEVER changes the Stage. */
export const HEAT_VALUES = ['Hot', 'Warm', 'Cold'];
export const HEAT_STAGES = ['Target', 'Engaged', 'Diligence', 'Committed'];   // where heat applies
export const HEAT_COLORS = { Hot: '#c0392b', Warm: '#c08a2e', Cold: '#4c6ea5' };

/* CLOSED states — SEPARATE from the six stages. A record can be Passed (they declined)
   or Disqualified (we declined), each with a revisit date. Shown apart from the funnel. */
export const CLOSED_STATUSES = [
  { value: 'passed', label: 'Passed', desc: 'They declined' },
  { value: 'disqualified', label: 'Disqualified', desc: 'We declined' },
];
export const CLOSED_LABELS = { passed: 'Passed', disqualified: 'Disqualified' };

/* Vehicle is the structure a record would invest through — a fixed two-value dropdown
   (Phase 10). An existing free-text value (e.g. a fund name) is preserved as a current
   option so nothing is lost, but new picks are one of these. */
export const VEHICLE_VALUES = ['AIF', 'FPI'];

/* ---- Phase 10: hard pipeline gates (mirrored from the server) ----
   Keyed by the stage being ENTERED: those fields must be filled before a record can move in.
   The server (functions/api/_lib.js gateViolation) is authoritative; these mirror its rules
   so the client can show the same message and a "what's needed to advance" checklist. */
export const STAGE_GATES = {
  Diligence: {
    fields: ['vehicle', 'targetTicket'],
    message: "Can't move to Diligence yet — add Vehicle and Target ticket first.",
  },
  Committed: {
    fields: ['committedAmount', 'fundingDate'],
    message: "Can't move to Committed yet — add Committed amount and expected funding date first.",
  },
};
export const CLOSE_NEEDS_REVISIT_MSG = 'Add a revisit date to close this.';
/* Disqualified (we declined) is only meaningful once a relationship exists — Engaged onward.
   Passed (they declined) is allowed from any active stage. */
export const DISQUALIFY_MIN_STAGE = 'Engaged';

/* ---- Phase 11: top-ups + the LP book ----
   A top-up is a NEW record (isTopUp) created at Committed and linked to an existing LP
   (linkedLp = that Invested contact's id). The LP book is a separate reporting module over
   the funded LPs, with these three editable fields living on the LP's own record. */
export const REPORTING_STATUSES = ['Up to date', 'Due', 'Overdue'];
export const TOPUP_POTENTIAL = ['High', 'Med', 'Low'];
export const REDEMPTION_RISK = ['Low', 'Med', 'High'];
/* Fixed colours for the LP-book signals (green good → red risk). */
export const LP_COLORS = {
  reportingStatus: { 'Up to date': '#2e8b74', Due: '#c08a2e', Overdue: '#c0392b' },
  topUpPotential: { High: '#2e8b74', Med: '#c08a2e', Low: '#9a9aa0' },
  redemptionRisk: { Low: '#2e8b74', Med: '#c08a2e', High: '#c0392b' },
};

/* The normalised contact shape. Order matters for table views in later tabs. */
export const FIELDS = [
  'fullName', 'entityType', 'role', 'organisation', 'designation',
  'email', 'phone', 'altPhone', 'whatsapp', 'whatsappOptIn',
  'country', 'city', 'vehicle', 'stage', 'heat', 'dormant', 'wakeDate',
  'closedStatus', 'revisitDate', 'targetTicket', 'committedAmount', 'fundingDate',
  'isTopUp', 'linkedLp', 'reportingStatus', 'topUpPotential', 'redemptionRisk',
  'tier', 'priority', 'referredBy',
  'lastContact', 'nextAction', 'nextActionDate',
  'relationshipOwner', 'source', 'signal', 'notes', 'roughNotes',
];

/* Sheet header -> field. Keys are headers reduced to lowercase letters+digits only,
   so "Source / Channel", "source_channel" and "SOURCE CHANNEL" all collapse to the
   same key. Several spellings may point at the same field. */
export const HEADER_MAP = {
  fullname: 'fullName', name: 'fullName', contactname: 'fullName', investorname: 'fullName',
  entitytype: 'entityType', type: 'entityType', investortype: 'entityType',
  role: 'role',
  organisationname: 'organisation', organizationname: 'organisation',
  organisation: 'organisation', organization: 'organisation', company: 'organisation', firm: 'organisation',
  designation: 'designation', title: 'designation', jobtitle: 'designation',
  email: 'email', emailaddress: 'email', emailid: 'email',
  phonedisplay: 'phone', phone: 'phone', phonenumber: 'phone', mobile: 'phone', contactnumber: 'phone',
  whatsappnumbere164: 'whatsapp', whatsappnumber: 'whatsapp', whatsapp: 'whatsapp', whatsappe164: 'whatsapp',
  whatsappoptin: 'whatsappOptIn', optin: 'whatsappOptIn', whatsappconsent: 'whatsappOptIn',
  primarycountry: 'country', country: 'country',
  primarycity: 'city', city: 'city',
  vehicle: 'vehicle', fund: 'vehicle', product: 'vehicle', strategy: 'vehicle',
  stage: 'stage', pipelinestage: 'stage',
  // Phase 10 — gate fields
  targetticket: 'targetTicket', targetticketsize: 'targetTicket', ticket: 'targetTicket', ticketsize: 'targetTicket',
  committedamount: 'committedAmount', commitmentamount: 'committedAmount', amountcommitted: 'committedAmount',
  fundingdate: 'fundingDate', expectedfundingdate: 'fundingDate', expectedfunding: 'fundingDate', fundingexpected: 'fundingDate',
  // Phase 11 — top-ups + LP book
  istopup: 'isTopUp', topup: 'isTopUp', linkedlp: 'linkedLp', lp: 'linkedLp', parentlp: 'linkedLp',
  reportingstatus: 'reportingStatus', reporting: 'reportingStatus',
  topuppotential: 'topUpPotential', redemptionrisk: 'redemptionRisk', redemption: 'redemptionRisk',
  // Finalised model — Heat / Dormant / Closed are separate fields (Phase 9).
  heat: 'heat', temperature: 'heat', heatlevel: 'heat',
  dormant: 'dormant', isdormant: 'dormant', parked: 'dormant',
  wakedate: 'wakeDate', wakeupdate: 'wakeDate', dormantuntil: 'wakeDate',
  closedstatus: 'closedStatus', closed: 'closedStatus', closereason: 'closedStatus',
  revisitdate: 'revisitDate', revisit: 'revisitDate',
  referredby: 'referredBy', referral: 'referredBy', referredbywhom: 'referredBy',
  lastcontact: 'lastContact', lastcontacted: 'lastContact', lastcontactdate: 'lastContact', lasttouch: 'lastContact',
  nextaction: 'nextAction', nextstep: 'nextAction',
  nextactiondate: 'nextActionDate', nextstepdate: 'nextActionDate', duedate: 'nextActionDate', followupdate: 'nextActionDate',
  relationshipowner: 'relationshipOwner', owner: 'relationshipOwner', accountowner: 'relationshipOwner', assignedto: 'relationshipOwner',
  sourcechannel: 'source', source: 'source', channel: 'source', leadsource: 'source',
  notes: 'notes', note: 'notes', comments: 'notes', remarks: 'notes',
  // Dhamma working-copy columns
  altphone: 'altPhone', alternatephone: 'altPhone', alternativephone: 'altPhone', secondaryphone: 'altPhone', phonealt: 'altPhone',
  tier: 'tier',
  priority: 'priority',
  signaltags: 'signal', signal: 'signal', signals: 'signal',
  roughnotesforraghav: 'roughNotes', roughnotes: 'roughNotes', roughnote: 'roughNotes',
};

/* Friendly, jargon-free labels for each field — shared by the AI update preview,
   the Ask table and the priorities panel so a column always reads the same. */
export const FIELD_LABELS = {
  fullName: 'Full name', entityType: 'Entity type', role: 'Role', organisation: 'Organisation', designation: 'Designation',
  email: 'Email', phone: 'Phone', altPhone: 'Alt phone', whatsapp: 'WhatsApp', whatsappOptIn: 'WhatsApp opt-in',
  country: 'Country', city: 'City', vehicle: 'Vehicle', stage: 'Stage', heat: 'Heat', dormant: 'Dormant',
  wakeDate: 'Wake date', closedStatus: 'Closed status', revisitDate: 'Revisit date',
  targetTicket: 'Target ticket', committedAmount: 'Committed amount', fundingDate: 'Expected funding date',
  isTopUp: 'Top-up', linkedLp: 'Linked LP', reportingStatus: 'Reporting status',
  topUpPotential: 'Top-up potential', redemptionRisk: 'Redemption risk',
  tier: 'Tier', priority: 'Priority',
  referredBy: 'Referred by', lastContact: 'Last contact', nextAction: 'Next action', nextActionDate: 'Next action date',
  relationshipOwner: 'Relationship owner', source: 'Source / channel', signal: 'Signal / tags', notes: 'Notes', roughNotes: 'Rough notes',
};

/* Fields searched by the header search box. */
export const SEARCH_FIELDS = [
  'fullName', 'organisation', 'designation', 'email', 'country', 'city',
  'stage', 'heat', 'entityType', 'relationshipOwner', 'source', 'vehicle', 'notes', 'referredBy',
  'tier', 'priority', 'signal', 'roughNotes',
];

/* Tab bar. Only 'overview' is live in Phase 1; the rest render the coming-soon shell
   so the structure of the product is visible from day one. */
/* Five tabs, each the ONE home for its job: Overview = all analytics + AI intelligence;
   Investors = the book (grid / board / follow-ups); Inbox = incoming replies;
   Outreach = compose + campaigns; LP Book = funded LPs. */
export const TABS = [
  { id: 'overview',   label: 'Overview',  icon: 'layout-dashboard', ready: true },
  { id: 'investors',  label: 'Investors', icon: 'users',            ready: true },
  { id: 'inbox',      label: 'Inbox',     icon: 'inbox',            ready: true },
  { id: 'outreach',   label: 'Outreach',  icon: 'send',             ready: true },
  { id: 'lpbook',     label: 'LP Book',   icon: 'landmark',         ready: true },
];

export const STORAGE_KEY = 'dccrm.data.v1';
export const SAMPLE_URL = 'data/contacts.sample.json';
