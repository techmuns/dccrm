/**
 * config.js — the single source of truth for the design system's data-side constants.
 * Every tab built later reads from here so colours, stages and header mapping stay identical.
 */

/* Fixed categorical palette. Assigned in this order, never cycled, never re-ordered.
   Past slot 8 a category falls back to NEUTRAL instead of inventing a ninth hue. */
export const PALETTE = [
  '#4f46e5', // indigo
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
];

export const NEUTRAL = '#94a3b8';   // everything past slot 8, and "Other"
export const SURFACE = '#ffffff';   // card surface — also the gap colour between marks

/* Pipeline, in order. Dormant is a real stage but sits outside the funnel. */
export const STAGE_ORDER = [
  'Not Contacted',
  'Contacted',
  'In Conversation',
  'Interested',
  'Meeting Scheduled',
  'Onboarded',
];
export const STAGE_DORMANT = 'Dormant';
export const ALL_STAGES = [...STAGE_ORDER, STAGE_DORMANT];

/* Stages that count as "actively talking". */
export const ACTIVE_STAGES = ['In Conversation', 'Interested', 'Meeting Scheduled'];

/* The normalised contact shape. Order matters for table views in later tabs. */
export const FIELDS = [
  'fullName', 'entityType', 'role', 'organisation', 'designation',
  'email', 'phone', 'whatsapp', 'whatsappOptIn',
  'country', 'city', 'vehicle', 'stage', 'referredBy',
  'lastContact', 'nextAction', 'nextActionDate',
  'relationshipOwner', 'source', 'notes',
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
};

/* Fields searched by the header search box. */
export const SEARCH_FIELDS = [
  'fullName', 'organisation', 'designation', 'email', 'country', 'city',
  'stage', 'entityType', 'relationshipOwner', 'source', 'vehicle', 'notes', 'referredBy',
];

/* Tab bar. Only 'overview' is live in Phase 1; the rest render the coming-soon shell
   so the structure of the product is visible from day one. */
export const TABS = [
  { id: 'overview',   label: 'Overview',    icon: 'layout-dashboard', ready: true },
  { id: 'contacts',   label: 'Contacts',    icon: 'users',            ready: true },
  { id: 'followups',  label: 'Follow-ups',  icon: 'calendar-check',   ready: true },
  { id: 'campaigns',  label: 'Campaigns',   icon: 'send',             ready: false },
  { id: 'insights',   label: 'AI Insights', icon: 'sparkles',         ready: false },
];

export const STORAGE_KEY = 'dccrm.data.v1';
export const SAMPLE_URL = 'data/contacts.sample.json';
