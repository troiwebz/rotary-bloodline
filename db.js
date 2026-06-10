/**
 * db.js — JSON-file database with 100 seeded Puducherry donors
 * Response tracking, activity feed, settings storage
 */
const fs   = require('fs');
const path = require('path');

const BUNDLE_DATA_DIR = path.join(__dirname, 'data');
// On Vercel the bundle dir is read-only — write to /tmp instead
// On Railway, PERSIST_DIR points at a mounted volume so data survives redeploys
const IS_VERCEL   = !!process.env.VERCEL;
const PERSIST     = process.env.PERSIST_DIR || null;
const DATA_DIR    = IS_VERCEL ? '/tmp/rotary-data'
                  : PERSIST   ? path.join(PERSIST, 'data')
                  : BUNDLE_DATA_DIR;

const DONORS_FILE    = path.join(DATA_DIR, 'donors.json');
const REQUESTS_FILE  = path.join(DATA_DIR, 'requests.json');
const RESPONSES_FILE = path.join(DATA_DIR, 'responses.json');
const ACTIVITY_FILE  = path.join(DATA_DIR, 'activity.json');
const SETTINGS_FILE  = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// On Vercel/Railway-volume: copy bundled seed files so first boot gets real data
if ((IS_VERCEL || PERSIST) && fs.existsSync(BUNDLE_DATA_DIR)) {
  ['donors.json','requests.json','responses.json','activity.json','settings.json','zones.json','zone-managers.json'].forEach(f => {
    const dst = path.join(DATA_DIR, f);
    if (!fs.existsSync(dst)) {
      const src = path.join(BUNDLE_DATA_DIR, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
    }
  });
}

// ── 100 Real Puducherry donor seeds ──────────────────────────────────────────
const AREAS = [
  'Ariyankuppam','Odiyan','Villianur','Nettapakkam','Bahour','Lawspet',
  'Mudaliarpet','Reddiarpalayam','White Town','Kamaraj Nagar','Gorimedu',
  'Thattanchavady','Kosapalayam','Chunnambar','Thengazhithittu','Pondicherry','Puducherry'
];

// Natural blood-type distribution for Tamil Nadu population
const BT_POOL = [
  ...Array(35).fill('O+'), ...Array(24).fill('B+'), ...Array(22).fill('A+'),
  ...Array(8).fill('AB+'), ...Array(4).fill('O-'), ...Array(3).fill('B-'),
  ...Array(3).fill('A-'), ...Array(1).fill('AB-')
];

const MALE_NAMES = [
  'Arjun Rajan','Karthik Murugesan','Selvam Annamalai','Ravi Krishnan','Suresh Manimaran',
  'Ganesh Palaniswami','Kumar Rangasamy','Senthil Shanmugam','Vignesh Ponnusamy','Anand Ganeshan',
  'Prasad Manickam','Manoj Radhakrishnan','Dinesh Natesan','Ramesh Durai','Bala Venkatesh',
  'Sathish Sundaram','Arun Narayanan','Prabhu Srinivasan','Gopal Jayaraman','Naresh Selvakumar',
  'Vinod Ramalingam','Mohan Arumugam','Shankar Muthukrishnan','Vijay Subramanian','Naveen Dhanarajan',
  'Ashok Rajan','Venkat Krishnan','Lokesh Murugesan','Balaji Selvam','Praveen Kumar',
  'Deepak Arumugam','Rajesh Pandian','Siva Annamalai','Murugan Palani','Tamil Arasu',
  'Saravanan Natarajan','Harish Balasubramanian','Bharath Gurusamy','Karthi Periyasamy',
  'Satheesh Loganathan','Sudhakar Manivannan','Kumaresan Dhandapani','Elango Velusamy',
  'Rajendar Thangavel','Naveenkumar Sekar','Ponraj Mariappan','Gokulan Rajendar',
  'Ajith Palanivel','Dhanraj Arockiaraj','Ranjith Selvaraj'
];

const FEMALE_NAMES = [
  'Priya Rajan','Kavya Krishnan','Deepa Murugesan','Meena Selvakumar','Saranya Ramalingam',
  'Lavanya Arumugam','Sumathi Annamalai','Revathi Muthukrishnan','Nithya Subramanian',
  'Geetha Dhanarajan','Anitha Manimaran','Padma Palaniswami','Shanthi Rangasamy',
  'Lakshmi Shanmugam','Malathi Ponnusamy','Suganya Ganeshan','Pooja Manickam',
  'Divya Radhakrishnan','Keerthi Natesan','Sindhu Durai','Janani Venkatesh',
  'Yamuna Sundaram','Valli Narayanan','Uma Srinivasan','Sathya Jayaraman',
  'Kiruthiga Suresh','Abitha Selvam','Priyadharshini Mani','Gomathi Balasubramaniam',
  'Kousalya Palanisamy','Tamilselvi Rajendar','Vanitha Murugan','Vijayalakshmi Nair',
  'Saraswathi Pillai','Chandravathi Subramani','Niranjana Gopal','Poorvika Karthik',
  'Ranjani Venkatraman','Nalini Ravishankar','Shamitha Paramasivan',
  'Dhivyabharathi Mani','Elavarasi Ponnambalam','Suganthi Vetriselvan',
  'Rajeswari Thangaraj','Sathyabama Arockiam','Valarmathi Pandian',
  'Nirmala Joseph','Roseline Mary','Beatrice Rajan','Jacqueline Thomas'
];

const now = Date.now();
const DAY = 86400000;

function daysAgo(d) { return now - d * DAY; }
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Generate 100 real-ish donors
function generateDonors() {
  const donors = [];
  const allNames = [...MALE_NAMES, ...FEMALE_NAMES];
  const usedPhones = new Set();
  const usedNames  = new Set();

  for (let i = 1; i <= 100; i++) {
    let name;
    do { name = allNames[(i - 1) % allNames.length] + (i > allNames.length ? ` ${Math.floor(i/allNames.length)}` : ''); } while (usedNames.has(name));
    usedNames.add(name);

    let phone;
    do { phone = `${pickRandom(['9','8','7'])}${Math.floor(Math.random()*100000000).toString().padStart(8,'0')}`; } while (usedPhones.has(phone));
    usedPhones.add(phone);

    const bloodType = BT_POOL[(i - 1) % BT_POOL.length];
    const area      = AREAS[(i - 1) % AREAS.length];

    // Realistic last donation distribution:
    // 40% donated 90-365 days ago (eligible to donate again)
    // 25% never donated (eligible)
    // 20% donated 30-89 days ago (NOT eligible yet)
    // 15% donated 1-29 days ago (NOT eligible)
    let lastDonation = null;
    let donationCount = 0;
    const r = i % 20;
    if (r < 8) { // 40% eligible past donors
      lastDonation  = daysAgo(90 + (i * 7) % 275);
      donationCount = 1 + (i % 6);
    } else if (r < 13) { // 25% never donated (null)
      lastDonation  = null;
      donationCount = 0;
    } else if (r < 17) { // 20% donated recently — ineligible
      lastDonation  = daysAgo(30 + (i * 3) % 59);
      donationCount = 1 + (i % 4);
    } else { // 15% very recent — ineligible
      lastDonation  = daysAgo(1 + (i % 28));
      donationCount = 1 + (i % 3);
    }

    donors.push({
      id:            i,
      name,
      phone,
      bloodType,
      area,
      lastDonation,
      donationCount,
      available:     true,
      responseCount: 0,         // how many times this donor responded to alerts
      declineCount:  0,         // how many times declined
      lastSeen:      daysAgo(i % 30),
      createdAt:     daysAgo(30 + i),
      registered:    'app',     // 'app' | 'walk-in' | 'camp'
    });
  }
  return donors;
}

function initFile(p, def) {
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(def, null, 2));
}

const DEFAULT_SETTINGS = {
  defaultRadius:       50,
  maxDonorsPerAlert:   20,
  reengage90Days:      true,
  morningCronEnabled:  true,
  morningCronHour:     9,
  welcomeMessage:      true,
  orgName:             'Rotary Club of Legacy, Puducherry',
  orgPhone:            '',
  alertCooldownHours:  24,
  // 3-Layer Lifeline
  autoEscalate:        true,
  layer1WaitMin:       10,   // minutes before Layer 1 → 2
  layer2WaitMin:       10,   // minutes before Layer 2 → 3
  teamFollowUpMin:     15,   // minutes of silence before team CALL alert
  expertPhones:        '',   // comma-separated coordinator numbers for Layer 3
  aiNumbers:           '{"default":"918667571800"}',  // per-country wa.me numbers (JSON: {default, IN, TH, ...})
  aiName:              'Rtn. Thuli',   // the AI Rotarian's name (துளி = drop)
  donorHiMsg:          'Hi {ai}! 🩸 I want to become a blood donor with Rotary Blood Line. My verify code: {code}',
  requesterHiMsg:      'Hi {ai}! 🆘 I urgently need help finding blood. My verify code: {code}',
  updatedAt:           null,
};

initFile(DONORS_FILE,    []);   // real registrations only — never seed fake donors
initFile(REQUESTS_FILE,  []);
initFile(RESPONSES_FILE, []);
initFile(ACTIVITY_FILE,  []);
initFile(SETTINGS_FILE,  DEFAULT_SETTINGS);

// ── Core helpers ──────────────────────────────────────────────────────────────
function read(f)     { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } }
function write(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }
function nextId(arr) { return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1; }

const NINETY_DAYS = 90 * DAY;

// ── One-time points migration (runs at startup) ───────────────────────────────
function migratePoints() {
  try {
    const donors = read(DONORS_FILE);
    let changed = false;
    donors.forEach(d => {
      if (d.points == null) {
        // Registration base + donations + responses
        d.points = 50 + (d.donationCount || 0) * 250 + (d.responseCount || 0) * 30;
        const b = BADGES.find(x => d.points >= x.min) || BADGES[BADGES.length - 1];
        d.badgeLabel = b.label;
        d.badgeEmoji = b.emoji;
        changed = true;
      }
    });
    if (changed) write(DONORS_FILE, donors);
  } catch {}
}

// ── Activity feed ─────────────────────────────────────────────────────────────
function pushActivity(type, data) {
  const feed = read(ACTIVITY_FILE);
  feed.unshift({ id: nextId(feed), type, data, at: Date.now() });
  if (feed.length > 200) feed.length = 200; // keep last 200 events
  write(ACTIVITY_FILE, feed);
}

function getActivity(limit = 30) {
  return read(ACTIVITY_FILE).slice(0, limit);
}

// ── Donors ────────────────────────────────────────────────────────────────────
function getDonors()   { return read(DONORS_FILE).filter(d => d.available); }
function getAllDonors() { return read(DONORS_FILE); }

// ── Points & badge system ─────────────────────────────────────────────────────
const BADGES = [
  { min: 1000, label: 'Legend',          emoji: '👑', color: '#7C3AED' },
  { min: 700,  label: 'Champion',        emoji: '🏆', color: '#D97706' },
  { min: 400,  label: 'Life Saver',      emoji: '🦸', color: '#E53935' },
  { min: 130,  label: 'Active Donor',    emoji: '💉', color: '#0891B2' },
  { min: 50,   label: 'New Hero',        emoji: '🌱', color: '#16A34A' },
  { min: 0,    label: 'Registered',      emoji: '🩸', color: '#64748B' },
];

function getBadge(points) {
  return BADGES.find(b => (points || 0) >= b.min) || BADGES[BADGES.length - 1];
}

function calcPoints(donor) {
  const reg      = 50;
  const donated  = (donor.donationCount || 0) * 250;
  const responded= (donor.responseCount || 0) * 30;
  return reg + donated + responded;
}

function registerDonor(name, phone, bloodType, area, lastDonationTs, camp, extra = {}) {
  const donors = read(DONORS_FILE);
  const clean  = phone.replace(/\D/g, '');
  if (donors.some(d => d.phone === clean))
    return { ok: false, msg: 'This phone number is already registered as a donor.' };

  // lastDonationTs = Unix ms timestamp (from frontend Date picker) or null
  const lastDonation = (lastDonationTs && Number.isFinite(Number(lastDonationTs)))
    ? Number(lastDonationTs) : null;

  const donationCount = lastDonation ? 1 : 0;
  const points  = 50 + donationCount * 250; // 50 for registering, 250 per past donation
  const badge   = getBadge(points);

  const donor = {
    id: nextId(donors), name, phone: clean, bloodType, area,
    lastDonation, donationCount,
    responseCount: 0, declineCount: 0,
    points, badgeLabel: badge.label, badgeEmoji: badge.emoji,
    available: true, registered: camp ? 'camp' : 'app', camp: camp || null,
    pincode: extra.pincode || null, lat: extra.lat ?? null, lng: extra.lng ?? null,
    landmark: extra.landmark || null,
    nightOk: null, maxTravelKm: null, hasVehicle: null,
    lastSeen: Date.now(), createdAt: Date.now()
  };
  donors.push(donor);
  write(DONORS_FILE, donors);
  pushActivity('donor_registered', { name, bloodType, area });
  return { ok: true, donor };
}

// Hero Profile self-update (validated by phone last-4 in server layer)
function updateDonorProfile(id, patch) {
  const donors = read(DONORS_FILE);
  const dn = donors.find(x => x.id === Number(id));
  if (!dn) return null;
  ['pincode','lat','lng','landmark','nightOk','maxTravelKm','hasVehicle'].forEach(k => {
    if (patch[k] !== undefined) dn[k] = patch[k];
  });
  dn.lastSeen = Date.now();
  write(DONORS_FILE, donors);
  return dn;
}

function markDonated(id) {
  const donors = read(DONORS_FILE);
  const d = donors.find(x => x.id === Number(id));
  if (!d) return false;
  d.lastDonation  = Date.now();
  d.donationCount = (d.donationCount || 0) + 1;
  d.lastSeen      = Date.now();
  // Recalculate points + badge
  d.points = calcPoints(d);
  const b = getBadge(d.points);
  d.badgeLabel = b.label; d.badgeEmoji = b.emoji;
  write(DONORS_FILE, donors);
  pushActivity('donation_completed', { donorName: d.name, bloodType: d.bloodType, area: d.area });
  return true;
}

function updateDonor(id, fields) {
  const donors = read(DONORS_FILE);
  const idx = donors.findIndex(x => x.id === Number(id));
  if (idx === -1) return false;
  donors[idx] = { ...donors[idx], ...fields, updatedAt: Date.now() };
  write(DONORS_FILE, donors);
  return donors[idx];
}

function deleteDonor(id) {
  const donors = read(DONORS_FILE);
  const idx = donors.findIndex(x => x.id === Number(id));
  if (idx === -1) return false;
  donors.splice(idx, 1);
  write(DONORS_FILE, donors);
  return true;
}

function getEligibleDonors(bloodType) {
  const n = Date.now();
  return read(DONORS_FILE).filter(d =>
    d.available &&
    d.bloodType === bloodType &&
    (!d.lastDonation || (n - d.lastDonation) >= NINETY_DAYS)
  );
}

function getDueForReminder() {
  const n = Date.now();
  return read(DONORS_FILE).filter(d =>
    d.available && d.lastDonation && (n - d.lastDonation) >= NINETY_DAYS
  );
}

// ── Donor responses ───────────────────────────────────────────────────────────
// Called when a donor replies to a WhatsApp alert (YES/NO/CALL)
function recordDonorResponse(donorPhone, requestId, responseType) {
  const responses  = read(RESPONSES_FILE);
  const donors     = read(DONORS_FILE);
  const requests   = read(REQUESTS_FILE);

  const clean  = donorPhone.replace(/\D/g, '');
  const donor  = donors.find(d => d.phone === clean || '91' + d.phone === clean || d.phone === '91' + clean);
  const req    = requests.find(r => r.id === Number(requestId));

  const entry = {
    id:           nextId(responses),
    donorPhone:   clean,
    donorName:    donor?.name || 'Unknown',
    donorArea:    donor?.area || '',
    bloodType:    donor?.bloodType || '',
    requestId:    Number(requestId),
    hospital:     req?.hospital || '',
    responseType, // 'responding' | 'declined' | 'called'
    at:           Date.now(),
  };
  responses.unshift(entry);
  write(RESPONSES_FILE, responses);

  // Update donor stats
  if (donor) {
    if (responseType === 'responding' || responseType === 'called') {
      donor.responseCount = (donor.responseCount || 0) + 1;
    } else if (responseType === 'declined') {
      donor.declineCount = (donor.declineCount || 0) + 1;
    }
    donor.lastSeen = Date.now();
    write(DONORS_FILE, donors);
  }

  // Update request with responding donor
  if (req && (responseType === 'responding' || responseType === 'called')) {
    if (!req.respondingDonors) req.respondingDonors = [];
    if (!req.respondingDonors.find(d => d.phone === clean)) {
      req.respondingDonors.push({ phone: clean, name: donor?.name, at: Date.now() });
    }
    if (req.status === 'alerted') req.status = 'donor_responding';
    write(REQUESTS_FILE, requests);
  }

  pushActivity('donor_responded', {
    donorName:    donor?.name || 'A donor',
    bloodType:    donor?.bloodType || '',
    hospital:     req?.hospital || '',
    responseType,
    minutesAfter: req ? Math.round((Date.now() - req.createdAt) / 60000) : 0,
  });

  return { ok: true, entry };
}

function getRecentResponses(limit = 20) {
  return read(RESPONSES_FILE).slice(0, limit);
}

// ── Requests ──────────────────────────────────────────────────────────────────
function getRequests(limit = 50) {
  return read(REQUESTS_FILE).slice().reverse().slice(0, limit);
}

function addRequest(name, phone, bloodType, hospital, units, urgency) {
  const requests = read(REQUESTS_FILE);
  const clean    = phone.replace(/\D/g, '');
  const req = {
    id:              nextId(requests),
    name, phone:     clean,
    bloodType, hospital,
    units:           Number(units) || 1,
    urgency:         urgency || 'normal',
    status:          'pending',
    matchedDonors:   [],
    respondingDonors:[],
    alertedCount:    0,
    createdAt:       Date.now(),
  };
  requests.push(req);
  write(REQUESTS_FILE, requests);
  pushActivity('blood_request', { name, bloodType, hospital, urgency: req.urgency });
  return req;
}

function updateRequestStatus(id, status, matchedDonors) {
  const requests = read(REQUESTS_FILE);
  const r = requests.find(x => x.id === Number(id));
  if (!r) return false;
  r.status     = status;
  r.updatedAt  = Date.now();
  if (matchedDonors !== undefined) {
    r.matchedDonors = matchedDonors;
    r.alertedCount  = matchedDonors.length;
  }
  write(REQUESTS_FILE, requests);
  return true;
}

// Patch arbitrary fields on a request (layer tracking, escalation history)
function patchRequest(id, patch) {
  const requests = read(REQUESTS_FILE);
  const r = requests.find(x => x.id === Number(id));
  if (!r) return null;
  Object.assign(r, patch, { updatedAt: Date.now() });
  write(REQUESTS_FILE, requests);
  return r;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function getStats() {
  const donors   = read(DONORS_FILE).filter(d => d.available);
  const requests = read(REQUESTS_FILE);
  const n        = Date.now();

  const byType = {};
  donors.forEach(d => { byType[d.bloodType] = (byType[d.bloodType] || 0) + 1; });

  // Eligible right now (90-day rule)
  const eligible = donors.filter(d => !d.lastDonation || (n - d.lastDonation) >= NINETY_DAYS).length;

  // Response rate
  const responses = read(RESPONSES_FILE);
  const positive  = responses.filter(r => r.responseType !== 'declined').length;

  return {
    totalDonors:    donors.length,
    eligibleNow:    eligible,
    totalRequests:  requests.length,
    fulfilled:      requests.filter(r => r.status === 'fulfilled').length,
    pending:        requests.filter(r => ['pending','alerted','donor_responding'].includes(r.status)).length,
    byBloodType:    byType,
    totalResponses: responses.length,
    responseRate:   responses.length ? Math.round((positive / responses.length) * 100) : 0,
    areas:          new Set(donors.map(d => d.area).filter(Boolean)).size || AREAS.length,
  };
}

// ── Report data ───────────────────────────────────────────────────────────────
function getReportData() {
  const donors   = read(DONORS_FILE);
  const requests = read(REQUESTS_FILE);
  const responses= read(RESPONSES_FILE);
  const now      = Date.now();
  const DAY_MS   = 86400000;

  // Monthly registration trend (last 6 months)
  const months = [];
  for (let m = 5; m >= 0; m--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - m);
    const label = d.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).getTime();
    const count = donors.filter(x => x.createdAt >= start && x.createdAt <= end).length;
    months.push({ label, count });
  }

  // Blood type supply vs demand
  const supply = {}, demand = {};
  const BTS = ['O+','O-','A+','A-','B+','B-','AB+','AB-'];
  BTS.forEach(bt => {
    supply[bt] = donors.filter(d => d.bloodType === bt && d.available).length;
    demand[bt] = requests.filter(r => r.bloodType === bt).length;
  });

  // Area-wise donor count
  const byArea = {};
  donors.filter(d => d.available).forEach(d => {
    byArea[d.area] = (byArea[d.area] || 0) + 1;
  });
  const areaRanking = Object.entries(byArea)
    .sort((a, b) => b[1] - a[1])
    .map(([area, count]) => ({ area, count }));

  // Badge distribution
  const badgeCounts = {};
  donors.forEach(d => {
    const lbl = d.badgeLabel || 'Registered';
    badgeCounts[lbl] = (badgeCounts[lbl] || 0) + 1;
  });

  // Top donors by points
  const topDonors = [...donors]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, 10)
    .map(d => ({
      name: d.name, bloodType: d.bloodType, area: d.area,
      points: d.points || 0, badgeLabel: d.badgeLabel || 'Registered',
      badgeEmoji: d.badgeEmoji || '🩸', donationCount: d.donationCount || 0,
      responseCount: d.responseCount || 0,
    }));

  // Response breakdown this month
  const thisMonthStart = new Date(now); thisMonthStart.setDate(1); thisMonthStart.setHours(0,0,0,0);
  const thisMonthResponses = responses.filter(r => r.at >= thisMonthStart.getTime());

  return {
    totalDonors:     donors.length,
    activeDonors:    donors.filter(d => d.available).length,
    totalRequests:   requests.length,
    thisMonthReqs:   requests.filter(r => r.createdAt >= thisMonthStart.getTime()).length,
    totalResponses:  responses.length,
    thisMonthResps:  thisMonthResponses.length,
    fulfillmentRate: requests.length ? Math.round(requests.filter(r => r.status === 'fulfilled').length / requests.length * 100) : 0,
    avgResponseRate: responses.length ? Math.round(responses.filter(r => r.responseType !== 'declined').length / responses.length * 100) : 0,
    monthlyTrend:    months,
    supplyByType:    supply,
    demandByType:    demand,
    areaRanking,
    badgeCounts,
    topDonors,
    generatedAt:     now,
  };
}

// ── Recent donors (for homepage ticker) ──────────────────────────────────────
function getRecentDonors(n = 5) {
  const donors = read(DONORS_FILE);
  return donors
    .filter(d => d.createdAt)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, n)
    .map(d => ({
      name:      d.name,
      bloodType: d.bloodType,
      area:      d.area,
      createdAt: d.createdAt,
    }));
}

// ── Settings ──────────────────────────────────────────────────────────────────
function getSettings() {
  const saved = read(SETTINGS_FILE);
  return { ...DEFAULT_SETTINGS, ...saved };
}

function saveSettings(fields) {
  const s = { ...getSettings(), ...fields, updatedAt: Date.now() };
  write(SETTINGS_FILE, s);
  return s;
}

module.exports = {
  // donors
  getDonors, getAllDonors, registerDonor, markDonated, updateDonor, deleteDonor, updateDonorProfile,
  getEligibleDonors, getDueForReminder,
  // responses
  recordDonorResponse, getRecentResponses,
  // requests
  getRequests, addRequest, updateRequestStatus, patchRequest,
  // stats & activity
  getStats, getActivity, pushActivity, getRecentDonors, getReportData, getBadge, migratePoints,
  // settings
  getSettings, saveSettings,
  // constants
  AREAS,
};
