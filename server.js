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
const DATA_ROOT     = IS_VERCEL ? '/tmp/rotary-data'
                    : process.env.PERSIST_DIR ? path.join(process.env.PERSIST_DIR, 'data')
                    : path.join(__dirname, 'data');
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
const PORT = process.env.PORT || 4001;

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

// ── Role-based auth ───────────────────────────────────────────────────────────
const crypto    = require('crypto');
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.ADMIN_RESET_KEY || '';
const zoneTokens = new Map();   // token → {username, name, zoneId}

function isMaster(req) {
  const k = req.headers['x-admin-key'] || req.query.adminKey;
  return !!ADMIN_KEY && k === ADMIN_KEY;
}
function zoneSession(req) {
  const t = req.headers['x-zone-token'] || req.query.zoneToken;
  return (t && zoneTokens.get(t)) || null;
}
function requireMaster(req, res, next) {
  if (isMaster(req)) { req.auth = { role: 'master', actor: 'master' }; return next(); }
  res.status(403).json({ ok: false, msg: 'Master admin key required' });
}
const DEFAULT_PERMS = { donors: true, requests: true, whatsapp: true };
function permsFor(username) {
  const m = loadManagers().find(x => x.username === username);
  return { ...DEFAULT_PERMS, ...(m?.perms || {}) };
}
function hasPerm(req, key) {
  if (req.auth?.role === 'master') return true;
  return !!(req.auth?.perms?.[key]);
}
function requirePerm(key) {
  return (req, res, next) => hasPerm(req, key)
    ? next()
    : res.status(403).json({ ok: false, msg: 'Permission "' + key + '" not granted by Mission Control' });
}

function requireAuth(req, res, next) {
  if (isMaster(req)) { req.auth = { role: 'master', actor: 'master' }; return next(); }
  const z = zoneSession(req);
  if (z) { req.auth = { role: 'zone', actor: z.username, ...z }; return next(); }
  res.status(401).json({ ok: false, msg: 'Login required' });
}

// ── Privacy helpers ───────────────────────────────────────────────────────────
const maskPhone = p => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(0, 4) + '•••' + d.slice(-2) : '•••';
};

const AUDIT_FILE = path.join(DATA_ROOT, 'audit.json');
function audit(action, actor, detail) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')); } catch {}
  log.unshift({ id: (log[0]?.id || 0) + 1, at: Date.now(), action, actor, detail });
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(log.slice(0, 1000), null, 2));
}

// ── Partners (Layer 2 network: blood banks, NGOs, sister Rotary clubs) ────────
const PARTNERS_FILE = path.join(DATA_ROOT, 'partners.json');
function loadPartners()  { try { return JSON.parse(fs.readFileSync(PARTNERS_FILE, 'utf8')); } catch { return []; } }
function savePartners(p) { fs.writeFileSync(PARTNERS_FILE, JSON.stringify(p, null, 2)); }

// ── Network Heroes — super-connectors alerted on EVERY request by default ─────
// People with big networks / blood-organisation contacts who can source any group
const CONNECTORS_FILE = path.join(DATA_ROOT, 'connectors.json');
function loadConnectors()  { try { return JSON.parse(fs.readFileSync(CONNECTORS_FILE, 'utf8')); } catch { return []; } }
function saveConnectors(c) { fs.writeFileSync(CONNECTORS_FILE, JSON.stringify(c, null, 2)); }

async function alertConnectors(request) {
  const list = loadConnectors().filter(c => c.active !== false && c.phone);
  for (const c of list) {
    wa.sendMessage(c.phone,
`🌐 *NETWORK HERO ALERT — Rotary Blood Line*

Hi *${c.name}*, a blood request just came in. Your network can make the difference.

Blood Type: *${request.bloodType}* · Units: ${request.units || 1}
Hospital: *${request.hospital}*
Urgency: ${(request.urgency || 'normal').toUpperCase()}
Patient contact: ${request.phone}

Please activate your blood-bank / organisation contacts. Anyone who can help should head to the hospital blood bank and mention Rotary Blood Line. 🙏

— Rotary Club of Legacy, Puducherry`).catch(() => {});
    await new Promise(r => setTimeout(r, 700));
  }
  if (list.length) console.log(`[NH] ${list.length} network heroes alerted for request #${request.id}`);
  return list.length;
}

function donorInZone(d, zone) {
  return zone.areas.some(a =>
    (d.area || '').toLowerCase() === a.toLowerCase() ||
    (d.area || '').toLowerCase().includes(a.split(',')[0].toLowerCase()));
}

// ── Rotary Bloodline Team — club coordinators alerted on requests ─────────────
// scope 'all' → every request; scope 'radius' → only requests within radiusKm
// of the member's area (radius configurable per member from the dashboard)
const TEAM_FILE = path.join(DATA_ROOT, 'team.json');
function loadTeam()  { try { return JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8')); } catch { return []; } }
function saveTeam(t) { fs.writeFileSync(TEAM_FILE, JSON.stringify(t, null, 2)); }

async function alertTeam(request, alertedCount) {
  const members = loadTeam().filter(m => m.active !== false && m.phone);
  if (!members.length) return 0;
  // Distance of each member's area to the hospital
  const withDist = geo.sortByProximity(members, request.hospital);
  const targets = withDist.filter(m =>
    m.scope !== 'radius' || m.distanceKm <= (Number(m.radiusKm) || 10));
  for (const m of targets) {
    wa.sendMessage(m.phone,
`🩸 *BLOODLINE TEAM — NEW REQUEST*

Hi *${m.name}*, a request just came in${m.scope === 'radius' ? ` *${m.distanceKm} km* from you` : ''}.

Blood Type: *${request.bloodType}* · Units: ${request.units || 1}
Hospital: *${request.hospital}*
Urgency: ${(request.urgency || 'normal').toUpperCase()}
Patient contact: ${request.phone}
Donors alerted: ${alertedCount}

Please track this case and step in if no donor confirms. 🙏
— Rotary Blood Line Mission Control`).catch(() => {});
    await new Promise(r => setTimeout(r, 700));
  }
  if (targets.length) console.log(`[TEAM] ${targets.length}/${members.length} team members alerted for #${request.id}`);
  return targets.length;
}

function saveZones(z) { fs.writeFileSync(ZONES_FILE, JSON.stringify(z, null, 2)); }

// ── Web Push (PWA notifications) — free, unbannable alert channel ─────────────
let webpush = null;
try {
  webpush = require('web-push');
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails('mailto:troiwebz@gmail.com',
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  } else { webpush = null; console.warn('[PUSH] VAPID keys missing — push disabled'); }
} catch (e) { console.warn('[PUSH] web-push not available:', e.message); }

const PUSH_FILE = path.join(DATA_ROOT, 'push-subs.json');
function loadSubs()  { try { return JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')); } catch { return []; } }
function saveSubs(x) { fs.writeFileSync(PUSH_FILE, JSON.stringify(x, null, 2)); }

async function sendPush(entry, payload) {
  if (!webpush) return false;
  try {
    await webpush.sendNotification(entry.sub, JSON.stringify(payload));
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      // Subscription expired — clean it up
      saveSubs(loadSubs().filter(x => x.id !== entry.id));
    }
    return false;
  }
}

// Push the matched donors (by donorId) — falls back to all subs in early phase
async function pushAlertDonors(matchedIds, request) {
  if (!webpush) return 0;
  const subs = loadSubs();
  const matchedSet = new Set(matchedIds);
  let targets = subs.filter(x => x.donorId && matchedSet.has(Number(x.donorId)));
  if (!targets.length) targets = subs;   // tiny-network phase: alert every subscriber
  let sent = 0;
  for (const t of targets) {
    const ok = await sendPush(t, {
      title: (request.urgency === 'critical' ? '🚨 CRITICAL: ' : '🩸 ') + request.bloodType + ' blood needed',
      body: request.hospital + ' — tap to respond. Rotary Blood Line.',
      url: '/track.html?id=' + request.id,
      urgent: request.urgency === 'critical',
      tag: 'req-' + request.id,
    });
    if (ok) sent++;
  }
  if (sent) console.log(`[PUSH] ${sent}/${targets.length} push alerts for request #${request.id}`);
  return sent;
}

app.get('/api/push/key', (req, res) =>
  res.json({ ok: !!webpush, key: process.env.VAPID_PUBLIC_KEY || null }));

app.post('/api/push/subscribe', (req, res) => {
  const { sub, donorId } = req.body || {};
  if (!sub || !sub.endpoint) return res.status(400).json({ ok: false });
  const subs = loadSubs();
  const existing = subs.find(x => x.sub.endpoint === sub.endpoint);
  if (existing) { existing.donorId = donorId || existing.donorId; existing.at = Date.now(); }
  else subs.push({ id: (subs[subs.length-1]?.id || 0) + 1, sub, donorId: donorId || null, at: Date.now() });
  saveSubs(subs);
  res.json({ ok: true, total: subs.length });
});

// Master: test push to all subscribers
app.post('/api/push/test', requireMaster, async (req, res) => {
  const subs = loadSubs();
  let sent = 0;
  for (const t of subs) {
    if (await sendPush(t, { title: '✅ Rotary Blood Line — Push Test',
      body: 'If you see this, instant alerts are working on your device!', url: '/' })) sent++;
  }
  audit('push_test', req.auth.actor, { sent, total: subs.length });
  res.json({ ok: true, sent, total: subs.length });
});

// ── Init WhatsApp (non-fatal — server still runs without it) ──────────────────
try {
  wa.initWhatsApp();
  // Bring up each zone's own WhatsApp session if enabled from Mission Control
  loadZones().filter(z => z.waEnabled).forEach(z => {
    try { wa.initSession(z.id); } catch (e) { console.warn(`[WA:${z.id}] init failed:`, e.message); }
  });
} catch(e) { console.warn('[WA] Init skipped:', e.message); }

// Route sends through the hospital's zone session when that zone has its own number
function viaForHospital(hospital) {
  const z = getZoneForArea(hospital);
  return (z && z.waEnabled) ? z.id : 'master';
}

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

// ── WhatsApp admin page — renders the QR as a scannable image ────────────────
app.get('/wa-admin', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Connect — Rotary Blood Line</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
<style>
body{font-family:-apple-system,Segoe UI,sans-serif;background:#0B1120;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:20px}
h1{font-size:22px;margin-bottom:6px}p{color:#94a3b8;font-size:14px;max-width:420px;line-height:1.6}
#qr{background:#fff;padding:16px;border-radius:16px;margin:24px 0;display:none}
#status{font-size:15px;font-weight:700;padding:10px 24px;border-radius:24px;margin-top:8px}
.wait{background:rgba(245,158,11,.15);color:#FBBF24}.ok{background:rgba(16,163,74,.2);color:#34D399}
</style></head><body>
<h1>🩸 Rotary Blood Line — WhatsApp</h1>
<p>Open WhatsApp on the coordinator phone → <b>Linked Devices</b> → <b>Link a Device</b> → scan this code.</p>
<canvas id="qr"></canvas>
<div id="status" class="wait">Checking…</div>
<script>
async function poll(){
  try{
    const d = await fetch('/api/wa-qr').then(r=>r.json());
    const c = document.getElementById('qr'), s = document.getElementById('status');
    if(d.connected){ c.style.display='none'; s.className='ok'; s.textContent='✅ WhatsApp CONNECTED — messages are flowing'; return; }
    if(d.qr){ c.style.display='block'; QRCode.toCanvas(c, d.qr, {width:300,margin:1}); s.className='wait'; s.textContent='📱 Scan now — QR refreshes every ~30s'; }
    else { c.style.display='none'; s.className='wait'; s.textContent='⏳ WhatsApp initialising… wait 30s'; }
  }catch(e){ document.getElementById('status').textContent='⚠️ Server unreachable'; }
}
poll(); setInterval(poll, 10000);
</script></body></html>`);
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
app.get('/api/donors', requireAuth, requirePerm('donors'), (req, res) => {
  let donors = db.getAllDonors();
  // Zone admins only see their own zone
  if (req.auth.role === 'zone') {
    const zone = loadZones().find(z => z.id === req.auth.zoneId);
    if (zone) donors = donors.filter(d => donorInZone(d, zone));
  }
  const { q, bloodType, area, eligible } = req.query;
  if (q)         donors = donors.filter(d => d.name.toLowerCase().includes(q.toLowerCase()) || d.phone.includes(q));
  if (bloodType) donors = donors.filter(d => d.bloodType === bloodType);
  if (area)      donors = donors.filter(d => d.area === area);
  if (eligible === 'true') {
    const n = Date.now(), NINETY = 90 * 86400000;
    donors = donors.filter(d => !d.lastDonation || (n - d.lastDonation) >= NINETY);
  }
  // Phones masked for zone admins — full numbers only via audited reveal
  // Raw GPS coordinates are master-only; zone admins see a hasGps flag
  if (req.auth.role === 'zone') donors = donors.map(d => {
    const { lat, lng, ...rest } = d;
    return { ...rest, phone: maskPhone(d.phone), hasGps: lat != null };
  });
  else donors = donors.map(d => ({ ...d, hasGps: d.lat != null }));
  res.json(donors);
});

// ── Audited phone reveal — zone admins get the number only when acting ────────
app.post('/api/admin/reveal-phone', requireAuth, requirePerm('donors'), (req, res) => {
  const donor = db.getAllDonors().find(d => d.id === Number(req.body?.donorId));
  if (!donor) return res.status(404).json({ ok: false });
  if (req.auth.role === 'zone') {
    const zone = loadZones().find(z => z.id === req.auth.zoneId);
    if (!zone || !donorInZone(donor, zone))
      return res.status(403).json({ ok: false, msg: 'Donor is outside your zone' });
  }
  audit('reveal_phone', req.auth.actor, { donorId: donor.id, donorName: donor.name, reason: req.body?.reason || 'unspecified' });
  res.json({ ok: true, phone: donor.phone });
});

// ── Donor moderation (verify / deactivate) — zone-scoped ─────────────────────
app.post('/api/admin/donor/:id/update', requireAuth, requirePerm('donors'), (req, res) => {
  const donor = db.getAllDonors().find(d => d.id === Number(req.params.id));
  if (!donor) return res.status(404).json({ ok: false });
  if (req.auth.role === 'zone') {
    const zone = loadZones().find(z => z.id === req.auth.zoneId);
    if (!zone || !donorInZone(donor, zone))
      return res.status(403).json({ ok: false, msg: 'Donor is outside your zone' });
  }
  const patch = {};
  if (req.body.verified  !== undefined) patch.verified  = !!req.body.verified;
  if (req.body.available !== undefined) patch.available = !!req.body.available;
  const updated = db.updateDonor(donor.id, patch);
  audit('donor_update', req.auth.actor, { donorId: donor.id, patch });
  res.json({ ok: true, donor: { ...updated, phone: req.auth.role === 'zone' ? maskPhone(updated.phone) : updated.phone } });
});

// Master only: delete donor permanently
app.delete('/api/admin/donor/:id', requireMaster, (req, res) => {
  const ok = db.deleteDonor(Number(req.params.id));
  audit('donor_delete', req.auth.actor, { donorId: Number(req.params.id) });
  res.json({ ok });
});

app.post('/api/donors/register', async (req, res) => {
  req.body = req.body || {};
  const { name, phone, bloodType, area, lastDonation, camp, pincode, lat, lng, landmark } = req.body;
  if (!name || !phone || !bloodType || !area)
    return res.status(400).json({ ok: false, msg: 'All fields required' });

  const result = db.registerDonor(name, phone, bloodType, area, lastDonation, camp, {
    pincode: pincode ? String(pincode).replace(/\D/g, '').slice(0, 6) : null,
    lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
    lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
    landmark: landmark ? String(landmark).slice(0, 120) : null,
  });
  if (!result.ok) return res.status(409).json(result);

  // NO proactive welcome DM — the donor says Hi to US first (the handshake),
  // and the welcome arrives as a reply. We are never the stranger.

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
// ── AI Scan — real database search for the mission sequence (NO sends) ───────
app.post('/api/scan', (req, res) => {
  const { bloodType, hospital, radiusKm } = req.body || {};
  if (!bloodType || !hospital) return res.status(400).json({ ok: false });

  const all       = db.getAllDonors();
  const typeMatch = all.filter(d => d.bloodType === bloodType);
  const eligible  = db.getEligibleDonors(bloodType);
  const sorted    = geo.sortByProximity(eligible, hospital);
  const radius    = Number(radiusKm) || 50;
  const inRange   = sorted.filter(d => d.distanceKm <= radius);

  // Team members who would be alerted (scope-aware)
  const team      = loadTeam().filter(m => m.active !== false);
  const teamDist  = geo.sortByProximity(team, hospital);
  const teamHit   = teamDist.filter(m => m.scope !== 'radius' || m.distanceKm <= (Number(m.radiusKm) || 10));

  const st = db.getSettings();
  res.json({
    ok: true,
    dbTotal:    all.length,
    typeMatches: typeMatch.length,
    eligible:   eligible.length,
    inRange:    inRange.length,
    within10:   sorted.filter(d => d.distanceKm <= 10).length,
    nearestKm:  sorted[0]?.distanceKm ?? null,
    team:       teamHit.length,
    teamNear:   teamHit.filter(m => m.scope === 'radius').length,
    heroes:     loadConnectors().filter(c => c.active !== false).length,
    partners:   loadPartners().filter(p => p.active !== false).length,
    l1Wait:     Number(st.layer1WaitMin) || 10,
    l2Wait:     Number(st.layer2WaitMin) || 10,
  });
});

// ── Hero Profile — donor self-service (validated by id + phone last-4) ────────
function profileDonor(req) {
  const d = db.getAllDonors().find(x => x.id === Number(req.params.id));
  if (!d) return null;
  const p4 = String(req.query.p || req.body?.p || '');
  return d.phone.endsWith(p4) && p4.length === 4 ? d : null;
}

app.get('/api/donors/:id/profile', (req, res) => {
  const d = profileDonor(req);
  if (!d) return res.status(403).json({ ok: false });
  res.json({ ok: true, name: d.name, bloodType: d.bloodType, area: d.area,
    pincode: d.pincode, landmark: d.landmark, hasGps: d.lat != null,
    nightOk: d.nightOk, maxTravelKm: d.maxTravelKm, hasVehicle: d.hasVehicle,
    points: d.points, badgeLabel: d.badgeLabel, badgeEmoji: d.badgeEmoji });
});

app.post('/api/donors/:id/profile', (req, res) => {
  const d = profileDonor(req);
  if (!d) return res.status(403).json({ ok: false });
  const b = req.body || {};
  const patch = {};
  if (b.pincode !== undefined)    patch.pincode = String(b.pincode).replace(/\D/g, '').slice(0, 6) || null;
  if (b.landmark !== undefined)   patch.landmark = String(b.landmark).slice(0, 120) || null;
  if (b.nightOk !== undefined)    patch.nightOk = !!b.nightOk;
  if (b.hasVehicle !== undefined) patch.hasVehicle = !!b.hasVehicle;
  if (b.maxTravelKm !== undefined) patch.maxTravelKm = Math.min(100, Math.max(2, Number(b.maxTravelKm) || 25));
  if (Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))) { patch.lat = Number(b.lat); patch.lng = Number(b.lng); }
  const updated = db.updateDonorProfile(d.id, patch);
  audit('profile_update', 'donor:' + d.id, { fields: Object.keys(patch) });
  res.json({ ok: true, hasGps: updated.lat != null });
});

// ── Public live tracking — sanitized, shareable (no patient phone) ────────────
app.get('/api/track/:id', (req, res) => {
  const r = db.getRequests(500).find(x => x.id === Number(req.params.id));
  if (!r) return res.status(404).json({ ok: false });
  const st = db.getSettings();
  res.json({
    ok: true,
    id: r.id,
    bloodType: r.bloodType,
    hospital: r.hospital,
    urgency: r.urgency || 'normal',
    status: r.status,
    layer: r.layer || 1,
    createdAt: r.createdAt,
    alertedCount: r.alertedCount || 0,
    responding: (r.respondingDonors || []).length,
    l1Wait: Number(st.layer1WaitMin) || 10,
    l2Wait: Number(st.layer2WaitMin) || 10,
  });
});

app.get('/api/requests', (req, res) => {
  res.json(db.getRequests(Number(req.query.limit) || 50));
});

app.post('/api/requests', async (req, res) => {
  const { name, phone, bloodType, hospital, units, urgency, radiusKm } = req.body;
  if (!name || !phone || !bloodType || !hospital)
    return res.status(400).json({ ok: false, msg: 'Name, phone, blood type and hospital are required.' });

  const request = db.addRequest(name, phone, bloodType, hospital, units, urgency);
  db.patchRequest(request.id, { layer: 1, layerHistory: [{ layer: 1, at: Date.now(), by: 'system' }] });

  // Find eligible donors
  const donors      = db.getEligibleDonors(bloodType);
  const sorted      = geo.sortByProximity(donors, hospital);
  const radius      = Number(radiusKm) || 50;
  // Respect each donor's stated willingness: night availability + max travel
  const istHour     = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
  const isNight     = istHour >= 22 || istHour < 6;
  const willing     = sorted.filter(d =>
    !(isNight && d.nightOk === false) &&
    d.distanceKm <= (Number(d.maxTravelKm) || 999));
  const inRange     = willing.filter(d => d.distanceKm <= radius);
  const toAlert     = inRange.length > 0 ? inRange : willing;
  const settings    = db.getSettings();
  const capped      = toAlert.slice(0, settings.maxDonorsPerAlert || 20);

  if (capped.length === 0) {
    // No registered donors yet — the human layers take over. Status stays
    // 'alerted' so auto-escalation and the team follow-up cron keep working.
    db.updateRequestStatus(request.id, 'alerted', []);
    broadcastSSE('request_no_donors', { bloodType, hospital, name });

    alertConnectors(request).catch(() => {});
    alertTeam(request, 0).catch(() => {});
    pushAlertDonors([], request).catch(() => {});
    try {
      const zone = getZoneForArea(hospital) || getZoneForArea(req.body.area);
      if (zone && zone.waNumber) {
        wa.sendMessage(zone.waNumber, `🚨 *ZONE ALERT — ${zone.name}*\n\nBlood request with NO matching donors in database!\n*Patient:* ${name}\n*Blood Type:* ${bloodType}\n*Hospital:* ${hospital}\n\nPersonal network needed — please act now.`).catch(()=>{});
      }
    } catch (e) {}

    return res.json({
      ok: true, id: request.id, matched: 0, within50: 0, dbTotal: donors.length,
      partners: loadPartners().filter(p => p.active !== false).length,
      connectors: loadConnectors().filter(c => c.active !== false).length,
      zoneNotified: !!getZoneForArea(hospital),
      whatsapp: wa.isReady(),
      msg: `No registered ${bloodType} donors nearby yet — AI has escalated to the Rotary team, zone coordinator and network heroes. Calls are being made.`
    });
  }

  // Mark request as alerted immediately
  db.updateRequestStatus(request.id, 'alerted', capped.map(d => d.id));
  const nearest = capped[0];

  // Respond to client RIGHT AWAY — don't wait for all WhatsApp sends
  const waLive = wa.isReady();
  const partnersCt = loadPartners().filter(p => p.active !== false).length;
  res.json({
    ok:       true,
    id:       request.id,
    matched:  capped.length,
    alerted:  capped.length,
    within50: inRange.length,
    dbTotal:  donors.length,
    partners: partnersCt,
    connectors: loadConnectors().filter(c => c.active !== false).length,
    zoneNotified: !!getZoneForArea(hospital),
    radius,
    whatsapp: waLive,
    nearest:  nearest ? `${nearest.name} — ${nearest.area} (${nearest.distanceKm} km)` : null,
    msg: waLive
      ? `✅ Alerting ${capped.length} ${bloodType} donors near ${hospital}. WhatsApp messages are being sent now. Nearest donor: ${nearest?.name} (${nearest?.distanceKm} km away).`
      : `✅ ${capped.length} ${bloodType} donors matched near ${hospital}. WhatsApp is reconnecting — the Rotary coordinator has been notified and donors will be alerted shortly. Nearest donor: ${nearest?.name} (${nearest?.distanceKm} km away).`
  });

  // Network heroes get EVERY request by default — they source through big networks
  alertConnectors(request).catch(() => {});

  // Bloodline Team — coordinators alerted per their scope (all / radius)
  alertTeam(request, capped.length).catch(() => {});

  // PWA push — instant, free, unbannable
  pushAlertDonors(capped.map(d => d.id), request).catch(() => {});

  // Fire WhatsApp alerts in background (non-blocking) — via the zone's own
  // WhatsApp when it has one, falling back to master automatically
  const _via = viaForHospital(hospital);
  wa.alertDonors(capped, request, _via).then(sent => {
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
    const zone = getZoneForArea(hospital) || getZoneForArea(req.body.area);
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

// ── Hero moment — celebrate the donor who saved a life ────────────────────────
async function heroMoment(requestId, donorId) {
  const reqs = db.getRequests(500);
  const r = reqs.find(x => x.id === Number(requestId));
  if (!r) return;
  // Resolve the hero: explicit donorId, else first responding donor's phone
  let donor = donorId ? db.getAllDonors().find(d => d.id === Number(donorId)) : null;
  if (!donor && (r.respondingDonors || []).length) {
    const ph = r.respondingDonors[0].phone;
    donor = db.getAllDonors().find(d =>
      d.phone === ph || '91' + d.phone === ph || d.phone === '91' + ph);
  }
  if (!donor) return;

  db.markDonated(donor.id);   // +250 points, badge recalc, 90-day clock starts
  const certUrl = 'https://rotary-bloodline.vercel.app/certificate.html?name='
    + encodeURIComponent(donor.name) + '&bt=' + encodeURIComponent(donor.bloodType)
    + '&d=' + new Date().toISOString().split('T')[0] + '&n=' + (donor.donationCount + 1);

  await wa.sendMessage(donor.phone,
`🏆 *YOU SAVED A LIFE TODAY*

*${donor.name}*, your ${r.bloodType} donation at ${r.hospital} just gave a family their tomorrow back.

🎖️ +250 Hero Points awarded
📜 Your certificate: ${certUrl}

Know friends with ${r.bloodType} blood? Forward them this — every registration is another life we can save:
https://rotary-bloodline.vercel.app

You are what Rotary means. 🙏
— Rotary Club of Legacy, Puducherry`, viaForHospital(r.hospital));

  audit('hero_moment', 'system', { requestId: r.id, donorId: donor.id, donorName: donor.name });
  broadcastSSE('donation_completed', { donorName: donor.name, bloodType: donor.bloodType });
}

// ── Donor reply processing (shared by WhatsApp listener + webhook) ────────────
// Classifies YES/NO, finds which request the donor is answering, records it,
// pushes SSE to the site, and sends a follow-up WhatsApp confirmation.
// ── The "Hi handshake" — donor messages US first, we're never strangers ───────
// Detects a greeting / ID-tag from a registered donor, marks them WA-verified,
// and replies with the Rtn. Uyir welcome. Returns true if handled.
async function tryHandshake(from, body) {
  const msg = (body || '').trim();
  const isGreeting = /^(hi|hii+|hello|hai|hey|vanakkam|வணக்கம்)\b/i.test(msg) || /\bID-\d+\b/i.test(msg);
  if (!isGreeting) return false;

  const clean = String(from).replace(/\D/g, '');
  const donor = db.getAllDonors().find(d =>
    d.phone === clean || '91' + d.phone === clean || d.phone === '91' + clean);
  if (!donor) return false;

  if (!donor.waVerified) {
    db.updateDonor(donor.id, { waVerified: true, waVerifiedAt: Date.now() });
    const profileUrl = 'https://rotary-bloodline.vercel.app/profile.html?id=' + donor.id + '&p=' + donor.phone.slice(-4);
    await wa.sendWelcome(donor.name, donor.phone, donor.bloodType, donor.area, 'master', profileUrl);
    audit('wa_handshake', 'donor:' + donor.id, { name: donor.name });
    broadcastSSE('donor_verified', { name: donor.name, bloodType: donor.bloodType });
    console.log(`[HANDSHAKE] ${donor.name} (#${donor.id}) is now WA-verified`);
  } else {
    await wa.sendMessage(donor.phone,
`⚙️ Vanakkam *${donor.name}*! Rtn. Uyir here — your Bloodline is active and you're fully verified. 🩸

Ask me anything, or just stay ready: when *${donor.bloodType}* blood is needed near you, I'll reach out. 🙏`);
  }
  return true;
}

async function processDonorReply(from, body, requestId) {
  // Greeting from a registered donor? Handle the handshake, skip response logging
  if (await tryHandshake(from, body)) return { type: 'handshake' };

  const msg  = (body || '').toLowerCase().trim();
  let type   = 'responded';
  if (['no','2','busy','cant','cannot','not available','decline'].some(w => msg.includes(w))) type = 'declined';
  else if (['yes','1','coming','on way','ok','call','going','ready'].some(w => msg.includes(w))) type = 'responding';

  // Auto-resolve the request when the listener doesn't know it:
  // newest open request (last 48h) whose alerted-donor list includes this phone.
  let reqId = Number(requestId) || 0;
  if (!reqId) {
    const clean  = String(from).replace(/\D/g, '');
    const donor  = db.getAllDonors().find(d =>
      d.phone === clean || '91' + d.phone === clean || d.phone === '91' + clean);
    const cutoff = Date.now() - 48 * 3600000;
    const open   = db.getRequests(200).filter(r =>
      ['alerted', 'donor_responding'].includes(r.status) && (r.createdAt || 0) > cutoff);
    let match = donor && open.find(r => (r.matchedDonors || []).includes(donor.id));
    if (!match && donor) match = open.find(r => r.bloodType === donor.bloodType);
    if (match) reqId = match.id;
  }

  const result = db.recordDonorResponse(from, reqId, type);
  broadcastSSE('donor_replied', result.entry);

  // Follow-up message to the donor
  if (wa.isReady()) {
    const req2 = db.getRequests(200).find(r => r.id === reqId);
    if (type === 'responding' && req2) {
      await wa.sendMessage(from,
`✅ Thank you for responding!

Please head to *${req2.hospital}* immediately and tell the blood bank:
• Blood type: *${req2.bloodType}*
• Patient contact: ${req2.phone}

You are saving a life 🙏
— Rotary Blood Line`);
    } else if (type === 'declined') {
      await wa.sendMessage(from,
`🙏 No problem — thank you for letting us know.

We'll reach out next time someone near you needs your blood type.
— Rotary Blood Line`);
    }
  }
  return { type, requestId: reqId };
}

// Live WhatsApp replies → same pipeline
if (wa.setOnMessage) wa.setOnMessage((phone, body) =>
  processDonorReply(phone, body, 0).catch(e => console.error('[WA] Reply error:', e.message)));

// ── WhatsApp webhook — donor replies (manual/external trigger) ────────────────
app.post('/api/wa-reply', async (req, res) => {
  const { from, body, requestId } = req.body;
  if (!from) return res.status(400).json({ ok: false });
  const out = await processDonorReply(from, body, requestId);
  res.json({ ok: true, ...out });
});

// ── Manual blast ──────────────────────────────────────────────────────────────
app.post('/api/blast', requireMaster, async (req, res) => {
  const { bloodType, message } = req.body;
  const donors = bloodType ? db.getEligibleDonors(bloodType) : db.getDonors();
  if (!message) return res.status(400).json({ ok: false, msg: 'Message required' });
  let sent = 0;
  for (const d of donors) {
    const ok = await wa.sendMessage(d.phone, message);
    if (ok) sent++;
    await new Promise(r => setTimeout(r, 700));
  }
  audit('blast', req.auth.actor, { bloodType: bloodType || 'ALL', sent, total: donors.length });
  res.json({ ok: true, sent, total: donors.length });
});

// ── Admin: wipe donor/request/response/activity data (key-guarded) ───────────
app.post('/api/admin/reset-data', (req, res) => {
  const key = req.body?.key || req.query?.key;
  if (!process.env.ADMIN_RESET_KEY || key !== process.env.ADMIN_RESET_KEY)
    return res.status(403).json({ ok: false, msg: 'Invalid key' });
  ['donors', 'requests', 'responses', 'activity'].forEach(f =>
    fs.writeFileSync(path.join(DATA_ROOT, f + '.json'), '[]'));
  res.json({ ok: true, msg: 'Donor, request, response and activity data cleared.' });
});

// ── Admin: requests with layer status + manual escalation ────────────────────
app.get('/api/admin/requests', requireAuth, requirePerm('requests'), (req, res) => {
  let requests = db.getRequests(Number(req.query.limit) || 100);
  if (req.auth.role === 'zone') {
    const zone = loadZones().find(z => z.id === req.auth.zoneId);
    if (zone) requests = requests.filter(r => {
      const h = (r.hospital || '').toLowerCase();
      return zone.areas.some(a => h.includes(a.split(',')[0].toLowerCase())) ||
             h.includes(zone.id) || h.includes(zone.name.toLowerCase().split(' ')[0]);
    });
  }
  res.json(requests);
});

app.post('/api/admin/requests/:id/escalate', requireAuth, requirePerm('requests'), async (req, res) => {
  const r = db.getRequests(500).find(x => x.id === Number(req.params.id));
  if (!r) return res.status(404).json({ ok: false });
  const toLayer = Math.min(3, (r.layer || 1) + 1);
  const done = await escalateRequest(r, toLayer, req.auth.actor);
  res.json({ ok: done, layer: toLayer });
});

app.post('/api/admin/requests/:id/fulfill', requireAuth, requirePerm('requests'), (req, res) => {
  db.updateRequestStatus(Number(req.params.id), 'fulfilled');
  audit('request_fulfill', req.auth.actor, { requestId: Number(req.params.id) });
  broadcastSSE('request_fulfilled', { requestId: Number(req.params.id) });
  heroMoment(Number(req.params.id), req.body?.donorId).catch(e => console.error('[HERO]', e.message));
  res.json({ ok: true });
});

app.post('/api/admin/requests/:id/cancel', requireAuth, requirePerm('requests'), (req, res) => {
  db.updateRequestStatus(Number(req.params.id), 'cancelled');
  audit('request_cancel', req.auth.actor, { requestId: Number(req.params.id) });
  res.json({ ok: true });
});

// ── Admin: partners (Layer 2 network) — master only ──────────────────────────
app.get('/api/admin/partners', requireMaster, (req, res) => res.json(loadPartners()));

app.post('/api/admin/partners', requireMaster, (req, res) => {
  const { name, type, phone, area } = req.body || {};
  if (!name || !phone) return res.status(400).json({ ok: false, msg: 'Name and phone required' });
  const partners = loadPartners();
  const p = { id: (partners[0]?.id || 0) + 1, name, type: type || 'blood-bank', phone: String(phone).replace(/\D/g, ''), area: area || '', active: true, createdAt: Date.now() };
  partners.unshift(p);
  savePartners(partners);
  audit('partner_add', req.auth.actor, { name, type: p.type });
  res.json({ ok: true, partner: p });
});

app.post('/api/admin/partners/:id', requireMaster, (req, res) => {
  const partners = loadPartners();
  const p = partners.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ ok: false });
  ['name', 'type', 'phone', 'area', 'active'].forEach(k => { if (req.body[k] !== undefined) p[k] = req.body[k]; });
  savePartners(partners);
  res.json({ ok: true, partner: p });
});

app.delete('/api/admin/partners/:id', requireMaster, (req, res) => {
  savePartners(loadPartners().filter(x => x.id !== Number(req.params.id)));
  audit('partner_delete', req.auth.actor, { partnerId: Number(req.params.id) });
  res.json({ ok: true });
});

// ── Admin: Network Heroes (super-connectors) — master only ───────────────────
app.get('/api/admin/connectors', requireMaster, (req, res) => res.json(loadConnectors()));

app.post('/api/admin/connectors', requireMaster, (req, res) => {
  const { name, phone, network, area } = req.body || {};
  if (!name || !phone) return res.status(400).json({ ok: false, msg: 'Name and phone required' });
  const list = loadConnectors();
  const c = { id: (list[0]?.id || 0) + 1, name, phone: String(phone).replace(/\D/g, ''), network: network || '', area: area || '', active: true, createdAt: Date.now() };
  list.unshift(c);
  saveConnectors(list);
  audit('connector_add', req.auth.actor, { name });
  res.json({ ok: true, connector: c });
});

app.post('/api/admin/connectors/:id', requireMaster, (req, res) => {
  const list = loadConnectors();
  const c = list.find(x => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ ok: false });
  ['name', 'phone', 'network', 'area', 'active'].forEach(k => { if (req.body[k] !== undefined) c[k] = req.body[k]; });
  saveConnectors(list);
  res.json({ ok: true, connector: c });
});

app.delete('/api/admin/connectors/:id', requireMaster, (req, res) => {
  saveConnectors(loadConnectors().filter(x => x.id !== Number(req.params.id)));
  audit('connector_delete', req.auth.actor, { connectorId: Number(req.params.id) });
  res.json({ ok: true });
});

// ── Admin: Bloodline Team — master only ──────────────────────────────────────
app.get('/api/admin/team', requireMaster, (req, res) => res.json(loadTeam()));

app.post('/api/admin/team', requireMaster, (req, res) => {
  const { name, phone, area, scope, radiusKm } = req.body || {};
  if (!name || !phone) return res.status(400).json({ ok: false, msg: 'Name and phone required' });
  const list = loadTeam();
  const m = { id: (list[0]?.id || 0) + 1, name, phone: String(phone).replace(/\D/g, ''),
    area: area || 'Puducherry', scope: scope === 'radius' ? 'radius' : 'all',
    radiusKm: Number(radiusKm) || 10, active: true, createdAt: Date.now() };
  list.unshift(m);
  saveTeam(list);
  audit('team_add', req.auth.actor, { name, scope: m.scope });
  res.json({ ok: true, member: m });
});

app.post('/api/admin/team/:id', requireMaster, (req, res) => {
  const list = loadTeam();
  const m = list.find(x => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ ok: false });
  ['name', 'phone', 'area', 'scope', 'radiusKm', 'active'].forEach(k => { if (req.body[k] !== undefined) m[k] = req.body[k]; });
  saveTeam(list);
  res.json({ ok: true, member: m });
});

app.delete('/api/admin/team/:id', requireMaster, (req, res) => {
  saveTeam(loadTeam().filter(x => x.id !== Number(req.params.id)));
  audit('team_delete', req.auth.actor, { memberId: Number(req.params.id) });
  res.json({ ok: true });
});

// ── Admin: per-zone WhatsApp sessions ─────────────────────────────────────────
app.get('/api/admin/zone-wa', requireMaster, (req, res) => {
  const managers = loadManagers();
  const zones = loadZones().map(z => ({
    id: z.id, name: z.name, emoji: z.emoji,
    enabled: !!z.waEnabled,
    waNumber: z.waNumber || '',
    managerPhone: managers.find(m => m.zoneId === z.id)?.phone || '',
    ...wa.sessionState(z.id),
  }));
  res.json({ master: wa.sessionState('master'), zones });
});

// Master: set a zone's alert/WhatsApp number
app.post('/api/admin/zones/:id/update', requireMaster, (req, res) => {
  const zones = loadZones();
  const z = zones.find(x => x.id === req.params.id);
  if (!z) return res.status(404).json({ ok: false });
  if (req.body.waNumber !== undefined) z.waNumber = String(req.body.waNumber).replace(/[^\d+]/g, '');
  saveZones(zones);
  audit('zone_update', req.auth.actor, { zoneId: z.id, waNumber: z.waNumber });
  res.json({ ok: true, zone: z });
});

app.post('/api/admin/zone-wa/:zoneId/enable', requireMaster, async (req, res) => {
  const zones = loadZones();
  const z = zones.find(x => x.id === req.params.zoneId);
  if (!z) return res.status(404).json({ ok: false });
  const enable = !!req.body?.enabled;
  z.waEnabled = enable;
  saveZones(zones);
  if (enable) wa.initSession(z.id);
  else { await wa.destroySession(z.id); }
  audit('zone_wa_' + (enable ? 'enable' : 'disable'), req.auth.actor, { zoneId: z.id });
  res.json({ ok: true, enabled: enable, ...wa.sessionState(z.id) });
});

app.post('/api/admin/zone-wa/:zoneId/reset', requireMaster, async (req, res) => {
  await wa.destroySession(req.params.zoneId);
  wa.clearSessionData(req.params.zoneId);
  const z = loadZones().find(x => x.id === req.params.zoneId);
  if (z?.waEnabled) wa.initSession(req.params.zoneId);
  audit('zone_wa_reset', req.auth.actor, { zoneId: req.params.zoneId });
  res.json({ ok: true });
});

// QR for a zone — master, or the zone's own manager
app.get('/api/admin/zone-wa/:zoneId/qr', requireAuth, requirePerm('whatsapp'), (req, res) => {
  const zid = req.params.zoneId;
  if (req.auth.role === 'zone' && req.auth.zoneId !== zid)
    return res.status(403).json({ ok: false, msg: 'Not your zone' });
  res.json({ ok: true, ...wa.sessionState(zid), qr: wa.getLastQR(zid) });
});

// Master sends the scan instructions to the zone manager on WhatsApp
app.post('/api/admin/zone-wa/:zoneId/send-link', requireMaster, async (req, res) => {
  const zid = req.params.zoneId;
  const zones = loadZones();
  const z = zones.find(x => x.id === zid);
  const mgr = loadManagers().find(m => m.zoneId === zid);
  if (!z || !mgr?.phone) return res.status(404).json({ ok: false, msg: 'Zone manager phone not set' });
  const ok = await wa.sendMessage(mgr.phone,
`📱 *${z.name} — Connect your Zone WhatsApp*

Hi *${mgr.name}*, Mission Control has enabled a dedicated WhatsApp line for your zone.

To activate it:
1. Open https://rotary-bloodline.vercel.app/admin.html
2. Log in with your zone credentials (${mgr.username})
3. Open the *📱 Zone WhatsApp* tab
4. Scan the QR with the ZONE phone → WhatsApp → Linked Devices → Link a Device

Once scanned, all alerts for ${z.name} go out from your zone's own number. 🙏
— Rotary Blood Line Mission Control`);
  audit('zone_wa_link_sent', req.auth.actor, { zoneId: zid, to: mgr.username });
  res.json({ ok, msg: ok ? 'Scan instructions sent to ' + mgr.name : 'Master WhatsApp not connected' });
});

// ── Admin: zone managers — master only ───────────────────────────────────────
app.get('/api/admin/managers', requireMaster, (req, res) => {
  const managers = loadManagers().map(m => ({ ...m, password: undefined, perms: { ...DEFAULT_PERMS, ...(m.perms || {}) } }));
  res.json({ managers, zones: loadZones() });
});

app.post('/api/admin/managers', requireMaster, (req, res) => {
  const { username, password, name, zoneId, phone } = req.body || {};
  if (!username || !password || !zoneId) return res.status(400).json({ ok: false, msg: 'username, password, zoneId required' });
  const managers = loadManagers();
  if (managers.find(m => m.username === username)) return res.status(409).json({ ok: false, msg: 'Username taken' });
  managers.push({ username, password, name: name || username, zoneId, phone: phone || '', active: true, createdAt: Date.now() });
  saveManagers(managers);
  audit('manager_add', req.auth.actor, { username, zoneId });
  res.json({ ok: true });
});

app.post('/api/admin/managers/:username', requireMaster, (req, res) => {
  const managers = loadManagers();
  const m = managers.find(x => x.username === req.params.username);
  if (!m) return res.status(404).json({ ok: false });
  ['password', 'name', 'zoneId', 'phone', 'active', 'perms'].forEach(k => { if (req.body[k] !== undefined) m[k] = req.body[k]; });
  saveManagers(managers);
  audit('manager_update', req.auth.actor, { username: m.username });
  res.json({ ok: true });
});

app.delete('/api/admin/managers/:username', requireMaster, (req, res) => {
  saveManagers(loadManagers().filter(x => x.username !== req.params.username));
  audit('manager_delete', req.auth.actor, { username: req.params.username });
  res.json({ ok: true });
});

// ── Admin: live WhatsApp send test — proves the pipe end-to-end ──────────────
app.post('/api/admin/test-wa', requireMaster, async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ ok: false, msg: 'phone required' });
  const sent = await wa.sendMessage(phone,
`✅ *Rotary Blood Line — Test Message*

If you are reading this, the WhatsApp engine is firing correctly.
Sent: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
— Mission Control`);
  audit('test_wa', req.auth.actor, { phone, sent });
  res.json({ ok: true, sent });
});

// ── Admin: audit log — master only ───────────────────────────────────────────
app.get('/api/admin/audit', requireMaster, (req, res) => {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')); } catch {}
  res.json(log.slice(0, Number(req.query.limit) || 200));
});

// ── Admin: who am I (validates stored credentials on dashboard load) ─────────
app.get('/api/admin/whoami', requireAuth, (req, res) => {
  const out = { ok: true, role: req.auth.role };
  if (req.auth.role === 'zone') {
    out.username = req.auth.username;
    out.name     = req.auth.name;
    out.zone     = loadZones().find(z => z.id === req.auth.zoneId) || null;
    out.perms    = permsFor(req.auth.username);
  }
  res.json(out);
});

// ── Admin API ─────────────────────────────────────────────────────────────────
app.get('/api/admin/summary', requireAuth, (req, res) => {
  const stats     = db.getStats();
  const requests  = db.getRequests(10);
  const donors    = db.getAllDonors();
  const responses = db.getRecentResponses(10);
  const activity  = db.getActivity(20);
  res.json({ stats, recentRequests: requests, recentResponses: responses, activity, waReady: wa.isReady() });
});

app.get('/api/admin/settings', requireMaster, (req, res) => res.json(db.getSettings()));

app.post('/api/admin/settings', requireMaster, (req, res) => {
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
  const token = crypto.randomBytes(24).toString('hex');
  zoneTokens.set(token, { username: mgr.username, name: mgr.name, zoneId: mgr.zoneId, perms: permsFor(mgr.username) });
  audit('zone_login', mgr.username, { zoneId: mgr.zoneId });
  res.json({ ok: true, token, manager: { username: mgr.username, name: mgr.name, zoneId: mgr.zoneId, active: mgr.active }, zone });
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

// ── 3-LAYER LIFELINE — escalation engine ─────────────────────────────────────
// Layer 1: registered donors near the hospital (fires at request time)
// Layer 2: partner network — wider-radius donors + partner organisations
// Layer 3: expert response — zone manager + coordinators step in personally
async function escalateRequest(r, toLayer, by) {
  const fresh = db.getRequests(500).find(x => x.id === r.id);
  if (!fresh || (fresh.layer || 1) >= toLayer) return false;
  if (['fulfilled', 'cancelled'].includes(fresh.status)) return false;

  const hist = fresh.layerHistory || [];
  hist.push({ layer: toLayer, at: Date.now(), by });
  db.patchRequest(fresh.id, { layer: toLayer, layerHistory: hist });
  audit('escalate', by, { requestId: fresh.id, toLayer, bloodType: fresh.bloodType, hospital: fresh.hospital });
  broadcastSSE('request_escalated', { requestId: fresh.id, layer: toLayer, bloodType: fresh.bloodType, hospital: fresh.hospital });

  if (toLayer === 2) {
    // Wider-radius donors not yet alerted
    const donors  = db.getEligibleDonors(fresh.bloodType);
    const sorted  = geo.sortByProximity(donors, fresh.hospital);
    const already = new Set(fresh.matchedDonors || []);
    const extra   = sorted.filter(d => !already.has(d.id)).slice(0, 20);
    if (extra.length) {
      db.patchRequest(fresh.id, { matchedDonors: [...already, ...extra.map(d => d.id)] });
      wa.alertDonors(extra, fresh).then(n => console.log(`[L2] ${n} wider-radius donors alerted for #${fresh.id}`)).catch(() => {});
    }
    // Partner organisations
    const partners = loadPartners().filter(p => p.active !== false && p.phone);
    for (const p of partners) {
      wa.sendMessage(p.phone,
`🤝 *PARTNER ALERT — Rotary Blood Line* (Layer 2)

We urgently need *${fresh.bloodType}* blood.
Hospital: *${fresh.hospital}*
Units: ${fresh.units || 1} · Urgency: ${(fresh.urgency || 'normal').toUpperCase()}

Please circulate to your donor network. Anyone willing can reply here or go directly to the hospital blood bank and mention Rotary Blood Line.

— Rotary Club of Legacy, Puducherry`).catch(() => {});
      await new Promise(rs => setTimeout(rs, 700));
    }
    console.log(`[L2] Partner network notified (${partners.length} partners) for #${fresh.id}`);
  }

  if (toLayer === 3) {
    const zones = loadZones();
    const zone  = zones.find(z => z.areas.some(a => (fresh.hospital || '').toLowerCase().includes(a.split(',')[0].toLowerCase()))) || zones[0];
    const targets = new Set();
    if (zone?.waNumber) targets.add(zone.waNumber);
    const s2 = db.getSettings();
    String(s2.expertPhones || '').split(',').map(x => x.trim()).filter(Boolean).forEach(p => targets.add(p));
    for (const phone of targets) {
      wa.sendMessage(phone,
`🚨 *LAYER 3 — EXPERT RESPONSE NEEDED*

A blood request is unfulfilled after two alert waves. Personal intervention required NOW.

Blood Type: *${fresh.bloodType}* · Units: ${fresh.units || 1}
Hospital: *${fresh.hospital}*
Patient contact: ${fresh.phone}
Request age: ${Math.round((Date.now() - fresh.createdAt) / 60000)} min

Please call the hospital blood bank, activate personal contacts, and coordinate directly.

— Rotary Blood Line Mission Control`).catch(() => {});
      await new Promise(rs => setTimeout(rs, 700));
    }
    console.log(`[L3] Expert escalation sent to ${targets.size} coordinator(s) for #${fresh.id}`);
  }
  return true;
}

// Team follow-up: if NOBODY responded after teamFollowUpMin, tell the
// front-line team to start CALLING — includes the nearest donors' numbers.
async function teamFollowUp(r) {
  const members = loadTeam().filter(m => m.active !== false && m.phone);
  if (!members.length) return;
  const nearest = geo.sortByProximity(db.getEligibleDonors(r.bloodType), r.hospital).slice(0, 5);
  const donorLines = nearest.length
    ? nearest.map((d, i) => `${i + 1}. ${d.name} (${d.bloodType}) · ${d.area} · ${d.distanceKm} km · 📞 +91${d.phone}`).join('\n')
    : 'No eligible donors in database — activate personal networks.';
  for (const m of members) {
    wa.sendMessage(m.phone,
`🚨 *NO RESPONSE YET — CALLS NEEDED*

Hi *${m.name}*, ${Math.round((Date.now() - r.createdAt) / 60000)} minutes have passed and *no donor has confirmed* for this request:

Blood Type: *${r.bloodType}* · Hospital: *${r.hospital}*
Patient contact: ${r.phone}

📞 *Please start calling now — nearest eligible donors:*
${donorLines}

A personal call works when a message doesn't. This patient is counting on us. 🙏
— Rotary Blood Line Mission Control`).catch(() => {});
    await new Promise(rs => setTimeout(rs, 700));
  }
  console.log(`[TEAM] Follow-up (no response) sent to ${members.length} members for #${r.id}`);
}

// Auto-escalation: every 2 minutes, move stale unanswered requests up a layer
cron.schedule('*/2 * * * *', async () => {
  const st = db.getSettings();
  if (st.autoEscalate === false) return;
  const w1 = Number(st.layer1WaitMin) || 10;
  const w2 = Number(st.layer2WaitMin) || 10;
  const open = db.getRequests(200).filter(r =>
    !['fulfilled', 'cancelled', 'no_donors_found'].includes(r.status) &&
    !(r.respondingDonors || []).length);
  const fu = Number(st.teamFollowUpMin) || 15;
  for (const r of open) {
    const ageMin = (Date.now() - r.createdAt) / 60000;
    const layer  = r.layer || 1;
    if (layer === 1 && ageMin >= w1)            await escalateRequest(r, 2, 'auto');
    else if (layer === 2 && ageMin >= w1 + w2)  await escalateRequest(r, 3, 'auto');
    // One-time team call-out when silence passes the follow-up window
    if (!r.teamFollowUpSent && ageMin >= fu) {
      db.patchRequest(r.id, { teamFollowUpSent: true });
      await teamFollowUp(r);
      audit('team_followup', 'auto', { requestId: r.id, ageMin: Math.round(ageMin) });
    }
  }
});

// ── CRON: monthly impact digest (1st of month, 10am) ──────────────────────────
cron.schedule('0 10 1 * *', async () => {
  const st = db.getSettings();
  if (st.digestEnabled === false) return;
  const stats = db.getStats();
  const reqs  = db.getRequests(500).filter(r => Date.now() - r.createdAt < 31 * 86400000);
  const fulfilled = reqs.filter(r => r.status === 'fulfilled').length;
  const msg =
`🩸 *ROTARY BLOOD LINE — MONTHLY IMPACT*

This month our network handled *${reqs.length} blood request${reqs.length === 1 ? '' : 's'}* — *${fulfilled} fulfilled*.

👥 You are one of *${stats.totalDonors} registered heroes* across ${stats.areas} areas.

Every alert you answer keeps the 30-minute promise alive. Know someone who should join? Forward this:
https://rotary-bloodline.vercel.app

Thank you for being there. 🙏
— Rotary Club of Legacy, Puducherry`;
  const everyone = [...db.getAllDonors().filter(d => d.available !== false), ...loadTeam().filter(m => m.active !== false)];
  console.log(`[DIGEST] Sending monthly impact to ${everyone.length} people`);
  for (const p of everyone) {
    await wa.sendMessage(p.phone, msg);
    await new Promise(r => setTimeout(r, 900));
  }
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
