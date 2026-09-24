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

/* Dhamma's real fundraising pipeline, in funnel order. Hot and Dormant are real
   statuses that sit OUTSIDE the funnel (a priority flag and a parked flag). */
export const STAGE_ORDER = [
  'Cold',
  'Network',
  'Qualified',
  'In Diligence',
  'Committed',
  'Funded',
];
export const STAGE_HOT = 'Hot';         // out-of-pipeline priority
export const STAGE_DORMANT = 'Dormant'; // out-of-pipeline parked
export const STAGE_FUNDED = 'Funded';   // the "won" stage (money in)
/* Every selectable stage, in display order: the funnel, then the two side statuses. */
export const ALL_STAGES = [...STAGE_ORDER, STAGE_HOT, STAGE_DORMANT];

/* Stages that count as "actively working the relationship" (not Cold, Funded or parked). */
export const ACTIVE_STAGES = ['Network', 'Qualified', 'In Diligence', 'Committed', 'Hot'];

/* Fixed stage colours — one meaning, one hue, everywhere (funnel, chips, grid, drawer).
   Enterprise/muted: rose + platinum + jade with slate and amber for the middle. */
export const STAGE_COLORS = {
  Cold: '#aeaeaa',           // platinum grey
  Network: '#6b7a99',        // slate
  Qualified: '#c08a2e',      // amber
  'In Diligence': '#4c6ea5', // slate blue
  Committed: '#a83a5b',      // rose
  Funded: '#2e8b74',         // jade
  Hot: '#c24e70',            // bright rose
  Dormant: '#8f8f96',        // muted grey (parked)
};

/* The normalised contact shape. Order matters for table views in later tabs. */
export const FIELDS = [
  'fullName', 'entityType', 'role', 'organisation', 'designation',
  'email', 'phone', 'altPhone', 'whatsapp', 'whatsappOptIn',
  'country', 'city', 'vehicle', 'stage', 'tier', 'priority', 'referredBy',
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
  stage: 'stage', status: 'stage', pipelinestage: 'stage',
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
  country: 'Country', city: 'City', vehicle: 'Vehicle', stage: 'Stage', tier: 'Tier', priority: 'Priority',
  referredBy: 'Referred by', lastContact: 'Last contact', nextAction: 'Next action', nextActionDate: 'Next action date',
  relationshipOwner: 'Relationship owner', source: 'Source / channel', signal: 'Signal / tags', notes: 'Notes', roughNotes: 'Rough notes',
};

/* Fields searched by the header search box. */
export const SEARCH_FIELDS = [
  'fullName', 'organisation', 'designation', 'email', 'country', 'city',
  'stage', 'entityType', 'relationshipOwner', 'source', 'vehicle', 'notes', 'referredBy',
  'tier', 'priority', 'signal', 'roughNotes',
];

/* Tab bar. Only 'overview' is live in Phase 1; the rest render the coming-soon shell
   so the structure of the product is visible from day one. */
export const TABS = [
  { id: 'overview',   label: 'Overview',    icon: 'layout-dashboard', ready: true },
  { id: 'contacts',   label: 'Contacts',    icon: 'users',            ready: true },
  { id: 'followups',  label: 'Follow-ups',  icon: 'calendar-check',   ready: true },
  { id: 'campaigns',  label: 'Campaigns',   icon: 'send',             ready: true },
  { id: 'insights',   label: 'AI Insights', icon: 'sparkles',         ready: true },
];

export const STORAGE_KEY = 'dccrm.data.v1';
export const SAMPLE_URL = 'data/contacts.sample.json';
