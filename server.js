const express  = require('express');
const cron     = require('node-cron');
const path     = require('path');
const cors     = require('cors');
const fs       = require('fs');
const db       = require('./db');
const geo      = require('./geo');

// WhatsApp — skip on Vercel serverless (no persistent process / Chromium)
const IS_VERCEL = !!process.env.VERCEL;
let wa;
if (IS_VERCEL) {
  wa = require('./wa-stub');
} else {
  try { wa = require('./whatsapp'); } catch { wa = require('./wa-stub'); }
}

// ── Zone data helpers ─────────────────────────────────────────────────────────
const DATA_ROOT     = IS_VERCEL ? '/tmp/rotary-data' : path.join(__dirname, 'data');
const ZONES_FILE    = path.join(DATA_ROOT, 'zones.json');
const MANAGERS_FILE = path.join(DATA_ROOT, 'zone-managers.json');
function loadZones()    { try { return JSON.parse(fs.readFileSync(ZONES_FILE,    'utf8')); } catch { return []; } }
function loadManagers() { try { return JSON.parse(fs.readFileSync(MANAGERS_FILE, 'utf8')); } catch { return []; } }
function saveManagers(m){ fs.writeFileSync(MANAGERS_FILE, JSON.stringify(m, null, 2)); }

function getZoneForArea(area) {
  if (!area) return null;
  const zones = loadZones();
  const a = area.toLowerCase();
  return zones.find(z => z.areas.some(za => za.toLowerCase() === a ||
    a.includes(za.toLowerCase()) || za.toLowerCase().includes(a))) || null;
}

const app  = express();
const PORT = 4001;

// ── CORS — allow any origin (Vercel, mobile, etc.) ───────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.options('*', cors());

// ── SSE clients list (real-time push to browser) ─────────────────────────────
const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(payload); } catch {} });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Run one-time migrations ───────────────────────────────────────────────────
db.migratePoints();

// ── Init WhatsApp (non-fatal — server still runs without it) ──────────────────
try { wa.initWhatsApp(); } catch(e) { console.warn('[WA] Init skipped:', e.message); }

// ── SSE endpoint — real-time updates ─────────────────────────────────────────
app.get('/api/live', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  sseClients.add(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  // Send current stats immediately
  res.write(`event: stats\ndata: ${JSON.stringify(db.getStats())}\n\n`);

  req.on('close', () => sseClients.delete(res));
});

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ whatsapp: wa.isReady(), uptime: Math.round(process.uptime()), ok: true });
});

// ── WhatsApp QR code (for admin to scan) ─────────────────────────────────────
app.get('/api/wa-qr', (req, res) => {
  const qr = wa.getLastQR();
  if (wa.isReady()) return res.json({ ok: true, connected: true, qr: null });
  if (!qr) return res.json({ ok: true, connected: false, qr: null, msg: 'WhatsApp initialising… check back in 30s' });
  res.json({ ok: true, connected: false, qr });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const s = db.getStats();
  // If opened in a browser → return a nice HTML status page
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    const bt = s.byBloodType || {};
    const btRows = ['O+','O-','A+','A-','B+','B-','AB+','AB-'].map(t => {
      const count = bt[t] || 0;
      const pct   = s.totalDonors ? Math.round(count / s.totalDonors * 100) : 0;
      const colors = {'O+':'#E53935','O-':'#C62828','A+':'#1E88E5','A-':'#1565C0','B+':'#43A047','B-':'#2E7D32','AB+':'#FB8C00','AB-':'#E65100'};
      return `<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid #F1F5F9">
        <span style="width:38px;height:38px;border-radius:10px;background:${colors[t]};color:#fff;font-size:13px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0">${t}</span>
        <div style="flex:1">
          <div style="height:8px;border-radius:4px;background:#F1F5F9;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${colors[t]};border-radius:4px"></div>
          </div>
        </div>
        <span style="font-size:15px;font-weight:800;color:#1E293B;width:28px;text-align:right">${count}</span>
        <span style="font-size:11px;color:#94A3B8;width:32px">${pct}%</span>
      </div>`;
    }).join('');

    const waStatus = wa.isReady()
      ? `<span style="background:#D1FAE5;color:#065F46;padding:4px 14px;border-radius:20px;font-weight:700;font-size:12px">✅ Connected</span>`
      : `<span style="background:#FEF3C7;color:#92400E;padding:4px 14px;border-radius:20px;font-weight:700;font-size:12px">⏳ Waiting for QR Scan</span>`;

    const uptime = Math.round(process.uptime());
    const hh = Math.floor(uptime/3600), mm = Math.floor((uptime%3600)/60), ss = uptime%60;
    const uptimeStr = `${hh}h ${mm}m ${ss}s`;

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rotary Blood Line — Live Status</title>
<meta http-equiv="refresh" content="30">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#F8FAFC;color:#1E293B;min-height:100vh}
.top{background:#E53935;padding:20px 32px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.top h1{font-size:20px;font-weight:900;color:#fff;display:flex;align-items:center;gap:10px}
.top .sub{font-size:12px;color:rgba(255,255,255,.7);margin-top:3px}
.top .live{display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:20px;padding:6px 16px;font-size:12px;font-weight:700;color:#fff}
.dot{width:8px;height:8px;border-radius:50%;background:#4ADE80;animation:pulse 1.8s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.body{max-width:900px;margin:0 auto;padding:32px 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px}
.card{background:#fff;border-radius:16px;padding:24px 20px;box-shadow:0 1px 4px rgba(0,0,0,.06);border:1.5px solid #E2E8F0;text-align:center}
.card .num{font-size:42px;font-weight:900;letter-spacing:-1.5px;line-height:1}
.card .lbl{font-size:12px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:.5px;margin-top:8px}
.card .sub2{font-size:11px;color:#94A3B8;margin-top:4px}
.card.red .num{color:#E53935} .card.blue .num{color:#1E88E5} .card.green .num{color:#16A34A} .card.teal .num{color:#0891B2}
.panel{background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.06);border:1.5px solid #E2E8F0;margin-bottom:20px}
.panel h2{font-size:15px;font-weight:800;color:#1E293B;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.wa-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:14px 0}
.meta{font-size:12px;color:#94A3B8;text-align:center;margin-top:24px;padding:16px;border-top:1px solid #E2E8F0}
.meta a{color:#E53935;text-decoration:none;font-weight:600}
.refresh{font-size:11px;color:#94A3B8;text-align:right;margin-bottom:12px}
</style>
</head>
<body>
<div class="top">
  <div>
    <h1>🩸 Rotary Blood Line</h1>
    <div class="sub">Rotary Club of Legacy, Puducherry · District 2981 · RI ID: 224440</div>
  </div>
  <div class="live"><div class="dot"></div> SYSTEM LIVE · Auto-refresh every 30s</div>
</div>
<div class="body">
  <div class="refresh">Last updated: ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</div>
  <div class="grid">
    <div class="card red"><div class="num">${s.totalDonors}</div><div class="lbl">Total Donors</div><div class="sub2">${s.eligibleNow} eligible now</div></div>
    <div class="card blue"><div class="num">${s.totalRequests}</div><div class="lbl">Blood Requests</div><div class="sub2">${s.fulfilled || 0} fulfilled</div></div>
    <div class="card green"><div class="num">${s.totalResponses || 0}</div><div class="lbl">Donor Responses</div><div class="sub2">${s.responseRate || 0}% response rate</div></div>
    <div class="card teal"><div class="num">${s.areas}</div><div class="lbl">Areas Covered</div><div class="sub2">Across Tamil Nadu</div></div>
  </div>

  <div class="panel">
    <h2>🩸 Donors by Blood Type</h2>
    ${btRows}
  </div>

  <div class="panel">
    <h2>📱 WhatsApp Status</h2>
    <div class="wa-row">
      <div>
        <div style="font-size:14px;font-weight:700;color:#1E293B">Automated Alerts</div>
        <div style="font-size:12px;color:#64748B;margin-top:3px">Messages sent to donors on blood requests</div>
      </div>
      ${waStatus}
    </div>
    <div class="wa-row" style="border-top:1px solid #F1F5F9">
      <div>
        <div style="font-size:14px;font-weight:700;color:#1E293B">Server Uptime</div>
        <div style="font-size:12px;color:#64748B;margin-top:3px">Running on port 4001</div>
      </div>
      <span style="background:#EFF6FF;color:#1E40AF;padding:4px 14px;border-radius:20px;font-weight:700;font-size:12px">⏱ ${uptimeStr}</span>
    </div>
    <div class="wa-row" style="border-top:1px solid #F1F5F9">
      <div>
        <div style="font-size:14px;font-weight:700;color:#1E293B">Pending Requests</div>
        <div style="font-size:12px;color:#64748B;margin-top:3px">Requests awaiting donor response</div>
      </div>
      <span style="background:${s.pending > 0 ? '#FEF3C7' : '#F0FDF4'};color:${s.pending > 0 ? '#92400E' : '#065F46'};padding:4px 14px;border-radius:20px;font-weight:700;font-size:12px">${s.pending || 0} pending</span>
    </div>
  </div>

  <div class="meta">
    <a href="/">← Main Website</a> &nbsp;·&nbsp; <a href="/admin.html">Admin Dashboard</a> &nbsp;·&nbsp; <span>Rotary Club of Legacy, Puducherry — Free Forever</span>
  </div>
</div>
</body>
</html>`);
  }
  // API call → return JSON as before
  res.json(s);
});

// ── Report data ───────────────────────────────────────────────────────────────
app.get('/api/report', (req, res) => {
  res.json(db.getReportData());
});

// ── Recent donors (homepage ticker) ───────────────────────────────────────────
app.get('/api/recent-donors', (req, res) => {
  const n = Math.min(parseInt(req.query.n) || 5, 10);
  res.json(db.getRecentDonors(n));
});

// ── Areas ─────────────────────────────────────────────────────────────────────
app.get('/api/areas', (req, res) => {
  res.json(Object.keys(geo.AREA_COORDS).sort());
});

// ── Detect nearest area from GPS coords ───────────────────────────────────────
app.get('/api/detect-area', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ ok: false, msg: 'lat and lon required' });

  let nearest = null, minDist = Infinity;
  for (const [area, coords] of Object.entries(geo.AREA_COORDS)) {
    if (area === 'Puducherry') continue; // skip duplicate
    const d = geo.distanceKm(lat, lon, coords.lat, coords.lon);
    if (d < minDist) { minDist = d; nearest = area; }
  }
  res.json({ ok: true, area: nearest, distanceKm: Math.round(minDist * 10) / 10 });
});

// ── Live Radar — anonymised donor blips near a GPS coordinate ─────────────────
app.get('/api/radar', (req, res) => {
  const lat      = parseFloat(req.query.lat);
  const lng      = parseFloat(req.query.lng);
  const maxKm    = Math.min(parseFloat(req.query.radius) || 50, 100);

  if (isNaN(lat) || isNaN(lng))
    return res.status(400).json({ ok: false, msg: 'lat and lng required' });

  const now    = Date.now();
  const NINETY = 90 * 86400000;
  const donors = db.getAllDonors().filter(d => {
    if (d.eligible === false) return false;
    if (d.lastDonation && (now - Number(d.lastDonation)) < NINETY) return false;
    return true;
  });

  const blips = [];
  for (const donor of donors) {
    const coords = geo.AREA_COORDS[donor.area];
    if (!coords) continue;

    const dist = geo.distanceKm(lat, lng, coords.lat, coords.lon);
    if (dist > maxKm) continue;

    // Bearing from user → donor (degrees from North, clockwise)
    const φ1 = lat       * Math.PI / 180;
    const φ2 = coords.lat * Math.PI / 180;
    const Δλ = (coords.lon - lng) * Math.PI / 180;
    const y  = Math.sin(Δλ) * Math.cos(φ2);
    const x  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    blips.push({
      distance : Math.round(dist * 10) / 10,
      bearing  : Math.round(bearing),
      bloodType: donor.bloodType   // type only — no name / phone
    });
  }

  blips.sort((a, b) => a.distance - b.distance);

  res.json({
    ok      : true,
    total   : blips.length,
    within10: blips.filter(b => b.distance <= 10).length,
    within25: blips.filter(b => b.distance > 10 && b.distance <= 25).length,
    within50: blips.filter(b => b.distance > 25 && b.distance <= 50).length,
    blips   : blips.slice(0, 80)  // cap display to 80 dots
  });
});

// ── Activity feed ─────────────────────────────────────────────────────────────
app.get('/api/activity', (req, res) => {
  res.json(db.getActivity(Number(req.query.limit) || 30));
});

// ── Donor responses ───────────────────────────────────────────────────────────
app.get('/api/responses', (req, res) => {
  res.json(db.getRecentResponses(Number(req.query.limit) || 20));
});

// ── Public leaderboard (no phone numbers) ────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const donors  = db.getAllDonors();
  const limit   = Math.min(Number(req.query.limit) || 10, 25);
  const top = [...donors]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, limit)
    .map((d, i) => ({
      rank:          i + 1,
      name:          d.name,
      area:          d.area || '',
      bloodType:     d.bloodType,
      points:        d.points || 0,
      badgeLabel:    d.badgeLabel || 'Registered',
      badgeEmoji:    d.badgeEmoji || '🩸',
      donationCount: d.donationCount || 0,
      responseCount: d.responseCount || 0,
      eligible:      d.eligible !== false,
    }));
  // Most responsive donor
  const mostResponsive = [...donors]
    .filter(d => (d.responseCount || 0) > 0)
    .sort((a, b) => (b.responseCount || 0) - (a.responseCount || 0))[0];
  res.json({
    top,
    mostResponsive: mostResponsive ? {
      name:          mostResponsive.name,
      area:          mostResponsive.area || '',
      bloodType:     mostResponsive.bloodType,
      responseCount: mostResponsive.responseCount || 0,
      points:        mostResponsive.points || 0,
      badgeLabel:    mostResponsive.badgeLabel || 'Active Donor',
      badgeEmoji:    mostResponsive.badgeEmoji || '💉',
    } : null,
    totalDonors: donors.length,
  });
});

// Donor manually marks they're responding (from a UI button or WhatsApp link)
app.post('/api/respond', async (req, res) => {
  const { phone, requestId, type } = req.body;
  if (!phone || !requestId) return res.status(400).json({ ok: false, msg: 'phone and requestId required' });

  const result = db.recordDonorResponse(phone, requestId, type || 'responding');
  const stats  = db.getStats();
  broadcastSSE('donor_responded', { ...result.entry, stats });
  res.json(result);
});

// ── Donors ────────────────────────────────────────────────────────────────────
app.get('/api/donors', (req, res) => {
  let donors = db.getAllDonors();
  const { q, bloodType, area, eligible } = req.query;
  if (q)         donors = donors.filter(d => d.name.toLowerCase().includes(q.toLowerCase()) || d.phone.includes(q));
  if (bloodType) donors = donors.filter(d => d.bloodType === bloodType);
  if (area)      donors = donors.filter(d => d.area === area);
  if (eligible === 'true') {
    const n = Date.now(), NINETY = 90 * 86400000;
    donors = donors.filter(d => !d.lastDonation || (n - d.lastDonation) >= NINETY);
  }
  res.json(donors);
});

app.post('/api/donors/register', async (req, res) => {
  const { name, phone, bloodType, area, lastDonation } = req.body;
  if (!name || !phone || !bloodType || !area)
    return res.status(400).json({ ok: false, msg: 'All fields required' });

  const result = db.registerDonor(name, phone, bloodType, area, lastDonation);
  if (!result.ok) return res.status(409).json(result);

  // Welcome WhatsApp
  if (wa.isReady()) await wa.sendWelcome(name, phone, bloodType, area);

  const stats = db.getStats();
  broadcastSSE('donor_registered', { name, bloodType, area, stats });
  res.json({
    ok: true,
    msg: `Welcome, ${name}! You are registered as a ${bloodType} donor.`,
    points:     result.donor.points,
    badgeLabel: result.donor.badgeLabel,
    badgeEmoji: result.donor.badgeEmoji,
    donorId:    result.donor.id,
  });
});

app.put('/api/donors/:id', (req, res) => {
  const updated = db.updateDonor(req.params.id, req.body);
  if (!updated) return res.status(404).json({ ok: false, msg: 'Donor not found' });
  res.json({ ok: true, donor: updated });
});

app.delete('/api/donors/:id', (req, res) => {
  const ok = db.deleteDonor(req.params.id);
  res.json({ ok });
});

app.post('/api/donors/:id/donated', (req, res) => {
  const ok = db.markDonated(req.params.id);
  if (ok) broadcastSSE('donation_recorded', db.getStats());
  res.json({ ok });
});

// ── Blood Requests ────────────────────────────────────────────────────────────
app.get('/api/requests', (req, res) => {
  res.json(db.getRequests(Number(req.query.limit) || 50));
});

app.post('/api/requests', async (req, res) => {
  const { name, phone, bloodType, hospital, units, urgency, radiusKm } = req.body;
  if (!name || !phone || !bloodType || !hospital)
    return res.status(400).json({ ok: false, msg: 'Name, phone, blood type and hospital are required.' });

  const request = db.addRequest(name, phone, bloodType, hospital, units, urgency);

  // Find eligible donors
  const donors      = db.getEligibleDonors(bloodType);
  const sorted      = geo.sortByProximity(donors, hospital);
  const radius      = Number(radiusKm) || 50;
  const inRange     = sorted.filter(d => d.distanceKm <= radius);
  const toAlert     = inRange.length > 0 ? inRange : sorted;
  const settings    = db.getSettings();
  const capped      = toAlert.slice(0, settings.maxDonorsPerAlert || 20);

  if (capped.length === 0) {
    db.updateRequestStatus(request.id, 'no_donors_found');
    broadcastSSE('request_no_donors', { bloodType, hospital, name });
    return res.json({
      ok:      true,
      matched: 0,
      msg:     `No ${bloodType} donors found in Puducherry right now. Rotary coordinator has been notified.`
    });
  }

  // Mark request as alerted immediately
  db.updateRequestStatus(request.id, 'alerted', capped.map(d => d.id));
  const nearest = capped[0];

  // Respond to client RIGHT AWAY — don't wait for all WhatsApp sends
  res.json({
    ok:      true,
    matched: capped.length,
    alerted: capped.length,
    radius,
    nearest: nearest ? `${nearest.name} — ${nearest.area} (${nearest.distanceKm} km)` : null,
    msg:     `✅ Alerting ${capped.length} ${bloodType} donors near ${hospital}. WhatsApp messages are being sent now. Nearest donor: ${nearest?.name} (${nearest?.distanceKm} km away).`
  });

  // Fire WhatsApp alerts in background (non-blocking)
  wa.alertDonors(capped, request).then(sent => {
    console.log(`[WA] Sent ${sent}/${capped.length} alerts for request #${request.id}`);
    const stats = db.getStats();
    broadcastSSE('blood_requested', {
      bloodType, hospital, name,
      alertedCount: capped.length,
      nearest: nearest ? `${nearest.name} (${nearest.distanceKm} km)` : null,
      stats,
    });
  }).catch(err => console.error('[WA] Alert error:', err.message));

  // Zone-aware notification: also alert the zone manager for this hospital's zone
  try {
    const zone = getZoneForArea(hospital) || getZoneForArea(area);
    if (zone && zone.waNumber) {
      const zoneMsg = `🚨 *ZONE ALERT — ${zone.name}*\n\nBlood request received!\n*Patient:* ${name}\n*Blood Type:* ${bloodType}\n*Hospital:* ${hospital}\n*Urgency:* ${urgency.toUpperCase()}\n*Donors alerted:* ${capped.length}\n\nPlease coordinate with zone donors if needed.`;
      wa.sendMessage(zone.waNumber, zoneMsg).catch(()=>{});
    }
  } catch(e) { /* non-fatal zone notification */ }
});

app.post('/api/requests/:id/fulfill', async (req, res) => {
  const { donorId, requesterPhone } = req.body;
  const donor = db.getAllDonors().find(d => d.id === Number(donorId));
  const reqs  = db.getRequests(1000);
  const req2  = reqs.find(r => r.id === Number(req.params.id));
  if (!donor || !req2) return res.status(404).json({ ok: false });

  db.updateRequestStatus(req2.id, 'fulfilled');
  db.markDonated(donor.id);

  if (wa.isReady()) await wa.confirmToRequester(req2.phone, donor, req2.bloodType);

  broadcastSSE('request_fulfilled', { hospital: req2.hospital, bloodType: req2.bloodType, donorName: donor.name });
  res.json({ ok: true, msg: 'Request fulfilled. Donor and patient notified.' });
});

// ── WhatsApp webhook — donor replies ──────────────────────────────────────────
// When a donor replies YES/1/COMING/CALL to a WhatsApp alert, we track it
app.post('/api/wa-reply', async (req, res) => {
  const { from, body, requestId } = req.body;
  if (!from) return res.status(400).json({ ok: false });

  const msg  = (body || '').toLowerCase().trim();
  let type   = 'responded';
  if (['no','2','busy','cant','cannot','not available','decline'].some(w => msg.includes(w))) type = 'declined';
  else if (['yes','1','coming','on way','ok','call','going','ready'].some(w => msg.includes(w))) type = 'responding';

  const result = db.recordDonorResponse(from, requestId || 0, type);
  broadcastSSE('donor_replied', result.entry);

  // If responding, send them a confirmation
  if (type === 'responding' && wa.isReady()) {
    const reqs = db.getRequests(200);
    const req2 = reqs.find(r => r.id === Number(requestId));
    if (req2) {
      await wa.sendMessage(from,
`✅ Thank you for responding!

Please head to *${req2.hospital}* immediately and tell the blood bank:
• Blood type: *${req2.bloodType}*
• Patient contact: ${req2.phone}

You are saving a life 🙏
— Rotary Blood Line`);
    }
  }
  res.json({ ok: true });
});

// ── Manual blast ──────────────────────────────────────────────────────────────
app.post('/api/blast', async (req, res) => {
  const { bloodType, message } = req.body;
  const donors = bloodType ? db.getEligibleDonors(bloodType) : db.getDonors();
  if (!message) return res.status(400).json({ ok: false, msg: 'Message required' });
  let sent = 0;
  for (const d of donors) {
    const ok = await wa.sendMessage(d.phone, message);
    if (ok) sent++;
    await new Promise(r => setTimeout(r, 700));
  }
  res.json({ ok: true, sent, total: donors.length });
});

// ── Admin API ─────────────────────────────────────────────────────────────────
app.get('/api/admin/summary', (req, res) => {
  const stats     = db.getStats();
  const requests  = db.getRequests(10);
  const donors    = db.getAllDonors();
  const responses = db.getRecentResponses(10);
  const activity  = db.getActivity(20);
  res.json({ stats, recentRequests: requests, recentResponses: responses, activity, waReady: wa.isReady() });
});

app.get('/api/admin/settings', (req, res) => res.json(db.getSettings()));

app.post('/api/admin/settings', (req, res) => {
  const s = db.saveSettings(req.body);
  res.json({ ok: true, settings: s });
});

// ── Zone Manager APIs ─────────────────────────────────────────────────────────

// Login
app.post('/api/zone/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, msg: 'Username and password required' });
  const managers = loadManagers();
  const mgr = managers.find(m => m.username === username && m.password === password);
  if (!mgr) return res.status(401).json({ ok: false, msg: 'Invalid credentials' });
  const zones = loadZones();
  const zone  = zones.find(z => z.id === mgr.zoneId);
  res.json({ ok: true, manager: { username: mgr.username, name: mgr.name, zoneId: mgr.zoneId, active: mgr.active }, zone });
});

// Zone dashboard — donors + requests for this zone
app.get('/api/zone/dashboard', (req, res) => {
  const { username } = req.query;
  const managers = loadManagers();
  const mgr = managers.find(m => m.username === username);
  if (!mgr) return res.status(401).json({ ok: false, msg: 'Not authorized' });

  const zones = loadZones();
  const zone  = zones.find(z => z.id === mgr.zoneId);
  if (!zone)  return res.status(404).json({ ok: false, msg: 'Zone not found' });

  const allDonors = db.getAllDonors();
  const zoneDonors = allDonors.filter(d => zone.areas.some(a =>
    (d.area || '').toLowerCase() === a.toLowerCase() ||
    (d.area || '').toLowerCase().includes(a.split(',')[0].toLowerCase())
  ));

  const allRequests = db.getRequests(50);
  const zoneRequests = allRequests.filter(r => {
    if (!r.hospital) return false;
    const h = r.hospital.toLowerCase();
    return zone.areas.some(a => h.includes(a.split(',')[0].toLowerCase())) ||
           h.includes(zone.id) || h.includes(zone.name.toLowerCase().split(' ')[0]);
  });

  const byBlood = {};
  zoneDonors.forEach(d => { byBlood[d.bloodType] = (byBlood[d.bloodType] || 0) + 1; });

  res.json({
    ok: true,
    zone,
    stats: {
      totalDonors: zoneDonors.length,
      eligibleNow: zoneDonors.filter(d => d.eligible !== false).length,
      pendingRequests: zoneRequests.filter(r => r.status !== 'fulfilled').length,
      byBlood,
    },
    donors:   zoneDonors.slice(0, 50),
    requests: zoneRequests.slice(0, 20),
  });
});

// Zone — all zones list (public, for super-admin)
app.get('/api/zones', (req, res) => {
  const zones    = loadZones();
  const allDonors = db.getAllDonors();
  const out = zones.map(z => {
    const count = allDonors.filter(d => z.areas.some(a =>
      (d.area || '').toLowerCase() === a.toLowerCase() ||
      (d.area || '').toLowerCase().includes(a.split(',')[0].toLowerCase())
    )).length;
    return { id: z.id, name: z.name, emoji: z.emoji, color: z.color, donorCount: count,
             waNumber: z.waNumber, managerUsername: z.manager };
  });
  res.json(out);
});

// Zone — update manager phone/WA number
app.post('/api/zone/update-contact', (req, res) => {
  const { username, waNumber, phone } = req.body || {};
  const managers = loadManagers();
  const idx = managers.findIndex(m => m.username === username);
  if (idx < 0) return res.status(401).json({ ok: false, msg: 'Manager not found' });
  if (waNumber !== undefined) {
    const zones = loadZones();
    const zi = zones.findIndex(z => z.id === managers[idx].zoneId);
    if (zi >= 0) { zones[zi].waNumber = waNumber; fs.writeFileSync(ZONES_FILE, JSON.stringify(zones, null, 2)); }
  }
  if (phone !== undefined) managers[idx].phone = phone;
  saveManagers(managers);
  res.json({ ok: true });
});

// Zone — mark zone active/inactive
app.post('/api/zone/toggle-active', (req, res) => {
  const { username, active } = req.body || {};
  const managers = loadManagers();
  const idx = managers.findIndex(m => m.username === username);
  if (idx < 0) return res.status(404).json({ ok: false, msg: 'Manager not found' });
  managers[idx].active = !!active;
  saveManagers(managers);
  res.json({ ok: true, active: managers[idx].active });
});

// ── CRON: 9am re-engagement ───────────────────────────────────────────────────
cron.schedule('0 9 * * *', async () => {
  const settings = db.getSettings();
  if (!settings.morningCronEnabled) return;
  console.log('[CRON] Running 90-day re-engagement...');
  const due     = db.getDueForReminder();
  const stats   = db.getStats();
  for (const donor of due) {
    await wa.sendReminderToDonor(donor, stats.pending || 0);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`[CRON] Re-engagement sent to ${due.length} donors`);
});

// ── Start (local only — Vercel uses module.exports) ───────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    const stats = db.getStats();
    console.log(`\n🩸 Rotary Blood Line running at http://localhost:${PORT}`);
    console.log(`   Donors: ${stats.totalDonors} total (${stats.eligibleNow} eligible now)`);
    console.log(`   Areas:  ${stats.areas}`);
    console.log(`   Admin:  http://localhost:${PORT}/admin.html\n`);
  });
}

module.exports = app;
