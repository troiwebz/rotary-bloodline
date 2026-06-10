/**
 * whatsapp.js — multi-session WhatsApp engine.
 * 'master' session always runs; each zone can have its own paired number
 * (enabled from Mission Control). Sessions persist on the Railway volume.
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode  = require('qrcode-terminal');
const fs      = require('fs');
const path    = require('path');

// ── Auth data: Railway volume when PERSIST_DIR set, else next to server.js ───
const AUTH_DIR = process.env.PERSIST_DIR
  ? path.join(process.env.PERSIST_DIR, '.wwebjs_auth')
  : path.join(__dirname, '.wwebjs_auth');

let onIncoming = null; // server.js registers a handler for donor replies
function setOnMessage(fn) { onIncoming = fn; }

// id → { client, ready, lastQR, retries, stopping }
const sessions = new Map();

const clientIdFor = id => id === 'master' ? 'bloodline' : `bloodline-${id}`;

// ── Remove stale SingletonLock before init ────────────────────────────────────
function clearLock(id) {
  const p = path.join(AUTH_DIR, `session-${clientIdFor(id)}`, 'SingletonLock');
  try { if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('[WA] Cleared lock:', p); } } catch {}
}

function initSession(id) {
  const existing = sessions.get(id);
  if (existing && existing.client) return;           // already running
  const st = { client: null, ready: false, lastQR: null, retries: existing?.retries || 0, stopping: false };
  sessions.set(id, st);
  clearLock(id);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: clientIdFor(id), dataPath: AUTH_DIR }),
    puppeteer: {
      headless: true,
      protocolTimeout: 180000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
      ]
    }
  });
  st.client = client;

  client.on('qr', qr => {
    st.lastQR = qr;
    st.retries++;
    console.log(`\n[WA:${id}] 📱 SCAN QR — WhatsApp → Linked Devices → Link a Device`);
    if (id === 'master') qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    st.ready  = true;
    st.lastQR = null;
    st.retries = 0;
    st.number = client.info?.wid?.user || null;
    console.log(`\n✅ [WA:${id}] CONNECTED — session live as +${st.number || '?'}\n`);
  });

  // Donor replies can land on ANY session — same pipeline
  client.on('message', async msg => {
    try {
      if (!msg.from || !msg.from.endsWith('@c.us')) return;
      const phone = msg.from.replace('@c.us', '');
      console.log(`[WA:${id}] Reply from ${phone}: "${(msg.body || '').slice(0, 60)}"`);
      if (onIncoming) await onIncoming(phone, msg.body || '');
    } catch (e) {
      console.error(`[WA:${id}] Incoming handler error:`, e.message);
    }
  });

  client.on('auth_failure', msg => {
    st.ready = false;
    console.error(`[WA:${id}] Auth failed:`, msg, '— clearing session and retrying…');
    try { fs.rmSync(path.join(AUTH_DIR, `session-${clientIdFor(id)}`), { recursive: true, force: true }); } catch {}
    if (!st.stopping) setTimeout(() => { sessions.delete(id); initSession(id); }, 5000);
  });

  client.on('disconnected', reason => {
    st.ready = false;
    console.log(`[WA:${id}] Disconnected:`, reason, '— reconnecting in 15s…');
    if (!st.stopping) setTimeout(() => { sessions.delete(id); initSession(id); }, 15000);
  });

  client.initialize().catch(err => {
    st.ready = false;
    st.retries++;
    const wait = Math.min(60000, 10000 * st.retries);
    console.error(`[WA:${id}] Init error (retry ${st.retries}, in ${wait / 1000}s):`, err.message);
    if (!st.stopping) setTimeout(() => { sessions.delete(id); initSession(id); }, wait);
  });
}

async function destroySession(id) {
  const st = sessions.get(id);
  if (!st) return;
  st.stopping = true;
  try { await st.client?.destroy(); } catch {}
  sessions.delete(id);
  console.log(`[WA:${id}] Session stopped`);
}

// Wipe a zone's pairing entirely (forces fresh QR next enable)
function clearSessionData(id) {
  try { fs.rmSync(path.join(AUTH_DIR, `session-${clientIdFor(id)}`), { recursive: true, force: true }); } catch {}
}

function initWhatsApp() { initSession('master'); }

function isReady(id = 'master')   { return !!sessions.get(id)?.ready; }
function getLastQR(id = 'master') { return sessions.get(id)?.lastQR || null; }
function sessionState(id) {
  const st = sessions.get(id);
  return { running: !!st, connected: !!st?.ready, hasQR: !!st?.lastQR, number: st?.number || null };
}

// ── Normalize phone → WhatsApp ID ─────────────────────────────────────────────
function formatPhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) return digits + '@c.us';
  if (digits.length === 10) return '91' + digits + '@c.us';
  return digits + '@c.us';
}

// Send via a specific session; falls back to master if that zone isn't ready
async function sendMessage(phone, message, via = 'master') {
  let st = sessions.get(via);
  if (!st?.ready) st = sessions.get('master');
  if (!st?.ready) return false;
  try {
    await st.client.sendMessage(formatPhone(phone), message);
    return true;
  } catch (e) {
    console.error(`[WA:${via}] Send error:`, e.message);
    return false;
  }
}

async function alertDonors(donors, request, via = 'master') {
  const urgencyLabel = request.urgency === 'critical' ? '🚨 CRITICAL EMERGENCY' : '🩸 Blood Needed';
  let sent = 0;
  for (const donor of donors) {
    const distTxt = donor.distanceKm != null ? `📍 You are *${donor.distanceKm} km* from the hospital.` : '';
    const msg =
`${urgencyLabel} — Rotary Blood Line, Puducherry

Blood Type: *${request.bloodType}*
Hospital: *${request.hospital}*
Patient Contact: ${request.phone}
Units Needed: ${request.units || 1}

Hi *${donor.name}*, you are a registered *${request.bloodType}* donor.
${distTxt}

*First to reach ${request.hospital} saves this life.* 🙏

Go to the blood bank counter and mention Rotary Blood Line.

To confirm you are coming — reply *YES*
To decline — reply *NO*

Thank you for being a community hero 🦸

🇮🇳 *தமிழ்:* ${request.hospital} மருத்துவமனையில் *${request.bloodType}* ரத்தம் அவசரத் தேவை. வர முடிந்தால் *YES*, முடியாவிட்டால் *NO* என பதிலளிக்கவும். 🙏
— Rotary Club of Legacy, Puducherry`;

    const ok = await sendMessage(donor.phone, msg, via);
    if (ok) sent++;
    await new Promise(r => setTimeout(r, 800));
  }
  return sent;
}

async function sendWelcome(name, phone, bloodType, area, via = 'master') {
  const msg =
`🩸 Welcome to Rotary Blood Line!

Hi *${name}*, you are now registered as a *${bloodType}* donor in *${area}*, Puducherry.

✅ We will contact you *only* when someone near you urgently needs *${bloodType}* blood.
✅ You can decline any request — no pressure.
✅ Your 90-day eligibility window is tracked automatically.

You are now part of Puducherry's first automated blood network.
*You are a hero.* 🦸

— Rotary Club of Legacy, Puducherry (District 2981)`;
  return sendMessage(phone, msg, via);
}

async function confirmToRequester(requesterPhone, donor, bloodType, via = 'master') {
  const msg =
`✅ Rotary Blood Line — Donor Found!

Blood Type: *${bloodType}*
Donor: *${donor.name}*
Area: ${donor.area}
Contact: ${donor.phone}

Please call the donor and coordinate with your hospital blood bank.

We hope for a speedy recovery 🙏
— Rotary Club of Legacy, Puducherry`;
  return sendMessage(requesterPhone, msg, via);
}

async function sendReminderToDonor(donor, waitingCount, via = 'master') {
  const msg =
`🩸 Rotary Blood Line — You Can Donate Again!

Hi *${donor.name}*, it has been 90+ days since your last donation.

Right now, *${waitingCount} patients* in Puducherry need blood.

Visit any blood bank or reply *READY* to be matched today.

You are a hero 🦸
— Rotary Club of Legacy, Puducherry`;
  return sendMessage(donor.phone, msg, via);
}

module.exports = {
  initWhatsApp, initSession, destroySession, clearSessionData, sessionState,
  sendMessage, alertDonors, sendWelcome, confirmToRequester, sendReminderToDonor,
  isReady, getLastQR, setOnMessage
};
