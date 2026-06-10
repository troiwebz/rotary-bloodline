const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode  = require('qrcode-terminal');
const fs      = require('fs');
const path    = require('path');

let client  = null;
let ready   = false;
let lastQR  = null;   // stored so admin can fetch it
let retries = 0;
let onIncoming = null; // server.js registers a handler for donor replies

function setOnMessage(fn) { onIncoming = fn; }

// ── Auth data: Railway volume when PERSIST_DIR set, else next to server.js ───
const AUTH_DIR = process.env.PERSIST_DIR
  ? path.join(process.env.PERSIST_DIR, '.wwebjs_auth')
  : path.join(__dirname, '.wwebjs_auth');

// ── Remove stale SingletonLock before every init ──────────────────────────────
function clearLock() {
  // Check both the project dir and CWD (preview tool may use either)
  const paths = [
    path.join(AUTH_DIR, 'session-bloodline', 'SingletonLock'),
    path.join(process.cwd(), '.wwebjs_auth', 'session-bloodline', 'SingletonLock'),
  ];
  paths.forEach(p => {
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('[WA] Cleared lock:', p); } } catch {}
  });
}

function initWhatsApp() {
  clearLock();
  lastQR = null;

  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'bloodline', dataPath: AUTH_DIR }),
    puppeteer: {
      headless: true,
      protocolTimeout: 180000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--single-process',
      ]
    }
  });

  client.on('qr', qr => {
    lastQR = qr;
    retries++;
    console.log('\n══════════════════════════════════════════════');
    console.log('📱  SCAN THIS QR IN WHATSAPP');
    console.log('    WhatsApp → Linked Devices → Link a Device');
    console.log('══════════════════════════════════════════════\n');
    qrcode.generate(qr, { small: true });
    console.log('\n══════════════════════════════════════════════\n');
  });

  client.on('ready', () => {
    ready  = true;
    lastQR = null;
    retries = 0;
    console.log('\n✅  WhatsApp CONNECTED — Rotary Blood Line is live and sending messages!\n');
  });

  // ── Incoming donor replies (YES / NO / CALL) ────────────────────────────────
  client.on('message', async msg => {
    try {
      // Only direct chats — ignore groups, broadcasts, status updates
      if (!msg.from || !msg.from.endsWith('@c.us')) return;
      const phone = msg.from.replace('@c.us', '');
      console.log(`[WA] Reply from ${phone}: "${(msg.body || '').slice(0, 60)}"`);
      if (onIncoming) await onIncoming(phone, msg.body || '');
    } catch (e) {
      console.error('[WA] Incoming handler error:', e.message);
    }
  });

  client.on('auth_failure', msg => {
    ready = false;
    console.error('[WA] Auth failed:', msg, '— clearing session and retrying…');
    // Clear the session so next init does a fresh QR
    try {
      const sessionDir = path.join(AUTH_DIR, 'session-bloodline');
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {}
    setTimeout(initWhatsApp, 5000);
  });

  client.on('disconnected', reason => {
    ready = false;
    console.log('[WA] Disconnected:', reason, '— reconnecting in 15s…');
    setTimeout(() => { clearLock(); initWhatsApp(); }, 15000);
  });

  client.initialize().catch(err => {
    ready = false;
    retries++;  // Always increment so wait grows: 10s, 20s, 30s … 60s max
    const wait = Math.min(60000, 10000 * retries);
    console.error(`[WA] Init error (retry ${retries}, in ${wait/1000}s):`, err.message);
    setTimeout(() => { clearLock(); initWhatsApp(); }, wait);
  });
}

// ── Normalize phone → WhatsApp ID ─────────────────────────────────────────────
function formatPhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  // Already has country code 91 (12 digits)
  if (digits.startsWith('91') && digits.length === 12) return digits + '@c.us';
  // 10-digit Indian number
  if (digits.length === 10) return '91' + digits + '@c.us';
  // Fallback
  return digits + '@c.us';
}

async function sendMessage(phone, message) {
  if (!ready || !client) return false;
  try {
    const chatId = formatPhone(phone);
    await client.sendMessage(chatId, message);
    return true;
  } catch (e) {
    console.error('[WA] Send error:', e.message);
    return false;
  }
}

async function alertDonors(donors, request) {
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
— Rotary Club of Legacy, Puducherry`;

    const ok = await sendMessage(donor.phone, msg);
    if (ok) sent++;
    await new Promise(r => setTimeout(r, 800));
  }
  return sent;
}

async function sendWelcome(name, phone, bloodType, area) {
  const msg =
`🩸 Welcome to Rotary Blood Line!

Hi *${name}*, you are now registered as a *${bloodType}* donor in *${area}*, Puducherry.

✅ We will contact you *only* when someone near you urgently needs *${bloodType}* blood.
✅ You can decline any request — no pressure.
✅ Your 90-day eligibility window is tracked automatically.

You are now part of Puducherry's first automated blood network.
*You are a hero.* 🦸

— Rotary Club of Legacy, Puducherry (District 2981)`;
  return sendMessage(phone, msg);
}

async function confirmToRequester(requesterPhone, donor, bloodType) {
  const msg =
`✅ Rotary Blood Line — Donor Found!

Blood Type: *${bloodType}*
Donor: *${donor.name}*
Area: ${donor.area}
Contact: ${donor.phone}

Please call the donor and coordinate with your hospital blood bank.

We hope for a speedy recovery 🙏
— Rotary Club of Legacy, Puducherry`;
  return sendMessage(requesterPhone, msg);
}

async function sendReminderToDonor(donor, waitingCount) {
  const msg =
`🩸 Rotary Blood Line — You Can Donate Again!

Hi *${donor.name}*, it has been 90+ days since your last donation.

Right now, *${waitingCount} patients* in Puducherry need blood.

Visit any blood bank or reply *READY* to be matched today.

You are a hero 🦸
— Rotary Club of Legacy, Puducherry`;
  return sendMessage(donor.phone, msg);
}

function isReady()  { return ready; }
function getLastQR() { return lastQR; }

module.exports = {
  initWhatsApp, sendMessage, alertDonors, sendWelcome,
  confirmToRequester, sendReminderToDonor, isReady, getLastQR, setOnMessage
};
