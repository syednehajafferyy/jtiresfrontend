'use strict';
/* Juniors Automotive & Tire - web server and API. Node 18+, no dependencies. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 3000;
const ROOT = __dirname, PUB = path.join(ROOT, 'public'), DATA = path.join(ROOT, 'data'), UP = path.join(DATA, 'uploads');
fs.mkdirSync(UP, { recursive: true });

/* ---------- tiny JSON store ---------- */
const fp = n => path.join(DATA, n);
const read = (n, d) => { try { return JSON.parse(fs.readFileSync(fp(n), 'utf8')); } catch (e) { return d; } };
const write = (n, v) => { const t = fp(n) + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, fp(n)); };

/* ---------- admin password ---------- */
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function setPassword(pw) { const salt = crypto.randomBytes(16).toString('hex'); write('auth.json', { salt, hash: hashPw(pw, salt) }); }
if (process.env.ADMIN_PASSWORD) setPassword(process.env.ADMIN_PASSWORD);
else if (!read('auth.json')) {
  const pw = crypto.randomBytes(9).toString('base64url'); setPassword(pw);
  console.log('\n  First run. Admin password: ' + pw + '\n  Set your own by starting with ADMIN_PASSWORD=yourpassword\n');
}
const checkPw = pw => { const a = read('auth.json'); if (!a || typeof pw !== 'string') return false;
  const x = Buffer.from(hashPw(pw, a.salt), 'hex'), y = Buffer.from(a.hash, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ---------- sessions and rate limits ---------- */
const sessions = new Map(), SESSION_MS = 12 * 3600e3;
const hits = new Map();
function limited(key, max, ms) { const n = Date.now(), h = hits.get(key) || { c: 0, t: n };
  if (n - h.t > ms) { h.c = 0; h.t = n; } h.c++; hits.set(key, h); return h.c > max; }
setInterval(() => { const n = Date.now(); for (const [k, v] of sessions) if (v < n) sessions.delete(k); for (const [k, h] of hits) if (n - h.t > 36e5) hits.delete(k); }, 6e5).unref();
const cookie = (req, name) => ((req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '=')) || '').slice(name.length + 1);
const isAdmin = req => { const t = cookie(req, 'sid'); return !!t && (sessions.get(t) || 0) > Date.now(); };
const ipOf = req => (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';

/* ---------- helpers ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const send = (res, code, body, type = 'application/json', extra = {}) => { res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', ...extra }); res.end(body); };
const json = (res, code, obj, extra) => send(res, code, JSON.stringify(obj), 'application/json', { 'Cache-Control': 'no-store', ...extra });
function body(req, max) { return new Promise((ok, no) => { const c = []; let n = 0;
  req.on('data', d => { n += d.length; if (n > max) { no(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else c.push(d); });
  req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); }); }
const jbody = async (req, max = 2e6) => { try { return JSON.parse((await body(req, max)).toString() || '{}'); } catch (e) { if (e.code === 413) throw e; throw Object.assign(new Error('Bad JSON'), { code: 400 }); } };
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const okImg = u => u === '' || /^\/(uploads|img)\/[\w.-]+$/.test(u);

function cleanProducts(items) {
  if (!Array.isArray(items) || !items.length || items.length > 60) throw Object.assign(new Error('Add at least one tire'), { code: 400 });
  return items.map(t => {
    const sz = (Array.isArray(t.sz) ? t.sz : []).map(s => str(s, 40)).filter(Boolean).slice(0, 30);
    if (!str(t.n, 120) || !sz.length) throw Object.assign(new Error('Every tire needs a name and a size'), { code: 400 });
    const img = str(t.img, 200); if (!okImg(img)) throw Object.assign(new Error('Bad image path'), { code: 400 });
    return { n: str(t.n, 120), c: str(t.c, 60), k: ['s', 'v', 'b'].includes(t.k) ? t.k : 's', price: str(t.price, 40), img, sz,
      sp: (Array.isArray(t.sp) ? t.sp : []).slice(0, 20).map(p => [str(p && p[0], 60), str(p && p[1], 120)]).filter(p => p[0]) };
  });
}
const SIG = { 'image/png': b => b.slice(1, 4).toString() === 'PNG', 'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8, 'image/gif': b => b.slice(0, 3).toString() === 'GIF', 'image/webp': b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' };
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

/* ---------- API ---------- */
async function api(req, res, url) {
  const p = url.pathname.slice(4), m = req.method;
  if (m === 'GET' && p === '/site') return json(res, 200, { products: read('products.json', null), business: read('business.json', null) }, { 'Cache-Control': 'no-cache' });
  if (m === 'GET' && p === '/me') return json(res, 200, { admin: isAdmin(req) });
  if (m === 'POST' && p === '/orders') {
    if (limited('o:' + ipOf(req), 10, 36e5)) return json(res, 429, { error: 'Too many requests. Please call us.' });
    const b = await jbody(req, 2e4), o = { name: str(b.name, 100), phone: str(b.phone, 40), msg: str(b.msg, 1000), tire: str(b.tire, 120), size: str(b.size, 40), qty: Math.min(999, Math.max(1, parseInt(b.qty, 10) || 1)) };
    if (!o.name || !o.phone || (!o.tire && !o.msg)) return json(res, 400, { error: 'Name, phone and a tire or message are required' });
    const all = read('orders.json', []); all.push({ id: crypto.randomBytes(6).toString('hex'), at: Date.now(), ...o }); write('orders.json', all.slice(-5000));
    return json(res, 201, { ok: true });
  }
  if (m === 'POST' && p === '/login') {
    if (limited('l:' + ipOf(req), 8, 6e5)) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const b = await jbody(req, 2e3);
    if (!checkPw(b.password)) return json(res, 401, { error: 'Wrong password' });
    const t = crypto.randomBytes(24).toString('base64url'); sessions.set(t, Date.now() + SESSION_MS);
    const sec = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return json(res, 200, { ok: true }, { 'Set-Cookie': `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${sec}` });
  }
  if (m === 'POST' && p === '/logout') { sessions.delete(cookie(req, 'sid')); return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }

  /* everything below requires the admin session */
  if (!isAdmin(req)) return json(res, 401, { error: 'Sign in required' });
  if (m !== 'GET' && !req.headers['x-requested-with']) return json(res, 400, { error: 'Bad request' });
  if (m === 'PUT' && p === '/products') { const b = await jbody(req); write('products.json', { items: cleanProducts(b.items) }); return json(res, 200, { ok: true }); }
  if (m === 'PUT' && p === '/business') { const b = await jbody(req, 2e4); const o = {}; for (const k of ['address', 'phone', 'hours', 'email']) o[k] = str(b[k], 200); write('business.json', o); return json(res, 200, { ok: true }); }
  if (m === 'POST' && p === '/upload') {
    const type = String(req.headers['content-type'] || '').split(';')[0], buf = await body(req, 8e6);
    if (!SIG[type] || !buf.length || !SIG[type](buf)) return json(res, 400, { error: 'Upload a PNG, JPG, WebP or GIF image' });
    const name = crypto.randomBytes(10).toString('hex') + EXT[type]; fs.writeFileSync(path.join(UP, name), buf); return json(res, 201, { url: '/uploads/' + name });
  }
  if (m === 'GET' && p === '/orders') return json(res, 200, { orders: read('orders.json', []).slice().reverse() });
  const d = p.match(/^\/orders\/([a-f0-9]+)$/);
  if (m === 'DELETE' && d) { write('orders.json', read('orders.json', []).filter(o => o.id !== d[1])); return json(res, 200, { ok: true }); }
  return json(res, 404, { error: 'Not found' });
}

/* ---------- static files ---------- */
function serve(req, res, url) {
  let rel = decodeURIComponent(url.pathname), root = PUB;
  if (rel === '/admin' || rel === '/admin/') rel = '/index.html';
  if (rel === '/') rel = '/index.html';
  if (rel.startsWith('/uploads/')) { root = UP; rel = rel.slice(8); }
  const f = path.normalize(path.join(root, rel));
  if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, 'Not found', 'text/plain');
  const ext = path.extname(f).toLowerCase(), isHtml = ext === '.html';
  const h = { 'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=86400' };
  if (isHtml) h['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
  send(res, 200, fs.readFileSync(f), MIME[ext] || 'application/octet-stream', h);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    serve(req, res, url);
  } catch (e) { if (!res.headersSent) json(res, e.code >= 400 && e.code < 500 ? e.code : 500, { error: e.code >= 400 && e.code < 500 ? e.message : 'Server error' }); else res.end(); if (!(e.code >= 400 && e.code < 500)) console.error(e); }
}).listen(PORT, () => console.log(`Juniors site running at http://localhost:${PORT}  (admin: http://localhost:${PORT}/admin)`));
