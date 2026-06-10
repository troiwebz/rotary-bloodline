// Local WhatsApp QR relay — polls Railway, renders the QR as a PNG, serves a live page.
// Run: node wa-qr-local.js  → open http://localhost:5050
const http   = require('http');
const QRCode = require('qrcode');

const RAILWAY = 'https://rotary-bloodline-production-d586.up.railway.app';

// In-memory cache — browser never sees a transient Railway failure
let state   = { connected: false, qr: null };
let lastPng = null;

async function refresh() {
  try {
    const d = await fetch(RAILWAY + '/api/wa-qr').then(r => r.json());
    state = d;
    if (d.qr) lastPng = await QRCode.toBuffer(d.qr, { width: 340, margin: 1 });
    if (d.connected) lastPng = null;
  } catch (e) { /* keep last good state */ }
}
refresh();
setInterval(refresh, 8000);

http.createServer((req, res) => {
  if (req.url.startsWith('/qr.png')) {
    if (!lastPng) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return res.end(lastPng);
  }
  if (req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ connected: !!state.connected, hasQr: !!lastPng }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect WhatsApp — Rotary Blood Line</title>
<style>
body{font-family:-apple-system,'Segoe UI',sans-serif;background:#0B1120;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:20px}
h1{font-size:22px;margin-bottom:6px}
p{color:#94a3b8;font-size:14px;max-width:440px;line-height:1.7;margin:6px 0}
#qrwrap{background:#fff;padding:14px;border-radius:16px;margin:22px 0;display:none}
img{display:block;width:340px;height:340px}
#status{font-size:15px;font-weight:700;padding:10px 26px;border-radius:24px;margin-top:8px}
.wait{background:rgba(245,158,11,.15);color:#FBBF24}
.ok{background:rgba(16,163,74,.2);color:#34D399}
.err{background:rgba(220,38,38,.15);color:#FCA5A5}
.steps{text-align:left;color:#cbd5e1;font-size:13.5px;line-height:2;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:14px 22px;margin-top:18px}
</style></head><body>
<h1>🩸 Rotary Blood Line — Connect WhatsApp</h1>
<p>Scan with the <b>coordinator phone</b> to start sending donor alerts.</p>
<div id="qrwrap"><img id="qrimg" alt="WhatsApp QR"></div>
<div id="status" class="wait">Loading QR…</div>
<div class="steps"><b>On the coordinator phone:</b><br>
1. Open <b>WhatsApp</b><br>
2. Tap <b>⋮ → Linked Devices</b><br>
3. Tap <b>Link a Device</b><br>
4. Scan the code above</div>
<script>
const w=document.getElementById('qrwrap'),i=document.getElementById('qrimg'),s=document.getElementById('status');
// Swap image only after the new one fully loads — never shows a broken icon
function loadQr(){
  const probe=new Image();
  probe.onload=function(){ i.src=probe.src; w.style.display='block'; };
  probe.src='/qr.png?t='+Date.now();
}
async function poll(){
  try{
    const d=await fetch('/state').then(r=>r.json());
    if(d.connected){w.style.display='none';s.className='ok';s.textContent='✅ CONNECTED — donor alerts are live!';return;}
    if(d.hasQr){loadQr();s.className='wait';s.textContent='📱 Scan now — refreshes automatically';}
    else{s.className='wait';s.textContent='⏳ Server generating QR… wait 30s';}
  }catch(e){s.className='err';s.textContent='⚠️ Local relay not running';}
}
poll();setInterval(poll,8000);
</script></body></html>`);
}).listen(5050, () => console.log('QR page → http://localhost:5050'));
