// demo.avvall.uz — Zumrad showroom.
// Statik fayllar: avvall.uz/zumrad/ (GitHub Pages) dan proxy. Root yo'llar (/360/, /floor/...) shu orqali ishlaydi.
// API: narx/holat/360 sozlamalari D1 da (env.DB, avvall-bot-db bilan umumiy), 360 rasmlar KV da (env.PANOS).
// Admin kirishi: Telegram botdagi /admin bir martalik havola -> sessiya cookie (parol yo'q).
const ORIGIN = 'https://avvall.uz/zumrad';
const PROJECT = 'zumrad';
const FLOORS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const TYPES = ['A', 'B', 'C', 'D'];
const STATUS = ['free', 'reserved', 'sold'];
const MAX_PANO = 8 * 1024 * 1024;

const DEFAULT = () => ({
  currency: 'UZS',
  types: { A: { area: 70, tour: null }, B: { area: 69, tour: null }, C: { area: 79, tour: null }, D: { area: 110, tour: 'D' } },
  units: Object.fromEntries(FLOORS.map(f => [f, Object.fromEntries(TYPES.map(t => [t, { price: null, status: 'free', area: null }]))])),
  tours: {
    D: {
      name: 'D xonadon', builtin: true, start: 'L',
      rooms: [
        { id: 'L', name: 'Mehmonxona', yaw: 200 }, { id: 'K', name: 'Oshxona', yaw: 215 }, { id: 'B', name: 'Yotoqxona', yaw: -45 },
        { id: 'H', name: 'Dahliz', yaw: 0 }, { id: 'G', name: 'Loggiya', yaw: -90 }, { id: 'T', name: 'Hammom', yaw: 200 }
      ],
      panos: {} // nuqta -> KV kaliti (almashtirilgan rasmlar)
    }
  }
});
const BUILTIN_POINTS = ['L1', 'L2', 'L3', 'K1', 'K2', 'K3', 'B1', 'B2', 'B3', 'H1', 'H2', 'H3', 'G1', 'G2', 'G3', 'T1', 'T2'];

const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const now = () => Math.floor(Date.now() / 1000);
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

let schemaOk = false;
async function schema(env) {
  if (schemaOk) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sr_config(project TEXT PRIMARY KEY, json TEXT, updated_at INT, updated_by INT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sr_tokens(hash TEXT PRIMARY KEY, uid INT, exp INT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sr_sessions(hash TEXT PRIMARY KEY, uid INT, exp INT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sr_log(id INTEGER PRIMARY KEY AUTOINCREMENT, at INT, uid INT, what TEXT)')
  ]);
  schemaOk = true;
}
async function getConfig(env) {
  const r = await env.DB.prepare('SELECT json FROM sr_config WHERE project=?').bind(PROJECT).first();
  if (!r) return DEFAULT();
  try { return normalize(JSON.parse(r.json)); } catch { return DEFAULT(); }
}

// Kiruvchi config'ni qat'iy tekshirish: faqat ma'lum maydonlar, son va ro'yxat chegaralari.
function normalize(c) {
  const d = DEFAULT(), out = { currency: c?.currency === 'USD' ? 'USD' : 'UZS', types: {}, units: {}, tours: {} };
  const tourIds = new Set(Object.keys(c?.tours || {}).filter(id => /^[A-Za-z0-9_-]{1,16}$/.test(id)).slice(0, 12));
  tourIds.add('D');
  for (const id of tourIds) {
    const src = c?.tours?.[id] || d.tours[id];
    if (!src) continue;
    const builtin = id === 'D';
    const base = builtin ? d.tours.D : null;
    const rooms = (Array.isArray(src.rooms) ? src.rooms : []).slice(0, 12).map(r => ({
      id: clean(r?.id, 16).replace(/[^A-Za-z0-9_-]/g, '') || rand(3),
      name: clean(r?.name, 40) || 'Xona',
      yaw: Math.max(-360, Math.min(360, Number(r?.yaw) || 0)),
      ...(builtin ? {} : { pano: /^p[0-9a-f]{24}$/.test(r?.pano) ? r.pano : null })
    }));
    const t = { name: clean(src.name, 40) || ('Sayr ' + id), builtin, rooms };
    if (builtin) {
      // ichki sayr: xonalar to'plami o'zgarmaydi (nuqtalar va reja Blender'dan), faqat nom, tartib, burchak
      const known = new Map(rooms.map(r => [r.id, r]));
      t.rooms = [...rooms.filter(r => base.rooms.some(b => b.id === r.id)), ...base.rooms.filter(b => !known.has(b.id))]
        .map(r => ({ id: r.id, name: r.name, yaw: r.yaw }));
      t.panos = {};
      for (const p of BUILTIN_POINTS) if (/^p[0-9a-f]{24}$/.test(src.panos?.[p])) t.panos[p] = src.panos[p];
    }
    t.start = t.rooms.some(r => r.id === src.start) ? src.start : (t.rooms[0]?.id || null);
    out.tours[id] = t;
  }
  for (const k of TYPES) {
    const s = c?.types?.[k] || d.types[k];
    out.types[k] = { area: num(s.area, 1, 1000) ?? d.types[k].area, tour: out.tours[s.tour] ? s.tour : null };
  }
  for (const f of FLOORS) {
    out.units[f] = {};
    for (const k of TYPES) {
      const u = c?.units?.[f]?.[k] || {};
      out.units[f][k] = { price: num(u.price, 0, 1e13), status: STATUS.includes(u.status) ? u.status : 'free', area: num(u.area, 1, 1000) };
    }
  }
  return out;
}
function num(v, lo, hi) { if (v === null || v === '' || v === undefined) return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 100) / 100 : null; }

async function session(req, env) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)sr=([0-9a-f]{64})/);
  if (!m) return null;
  const s = await env.DB.prepare('SELECT uid, exp FROM sr_sessions WHERE hash=?').bind(await sha(m[1])).first();
  if (!s || s.exp < now()) return null;
  const t = await env.DB.prepare('SELECT role FROM team WHERE id=?').bind(s.uid).first();
  return t && (t.role === 'owner' || t.role === 'admin') ? s.uid : null; // jamoadan chiqarilgan admin darhol kira olmaydi
}
const sameOrigin = req => {
  const o = req.headers.get('origin');
  return (!o || o === new URL(req.url).origin) && req.headers.get('x-sr') === '1'; // CSRF: SameSite=Strict + maxsus sarlavha + Origin
};
async function log(env, uid, what) { await env.DB.prepare('INSERT INTO sr_log(at,uid,what) VALUES(?,?,?)').bind(now(), uid, what.slice(0, 200)).run(); }

async function api(req, env, url) {
  await schema(env);
  const p = url.pathname;
  if (p === '/api/config' && req.method === 'GET') {
    const c = await getConfig(env);
    return json(c, 200, { 'cache-control': 'public, max-age=15' });
  }
  if (p === '/api/admin/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json({ ok: false }, 403);
    let b; try { b = await req.json(); } catch { return json({ ok: false }, 400); }
    const tok = String(b?.token || '');
    if (!/^[0-9a-f]{64}$/.test(tok)) return json({ ok: false, err: 'token' }, 400);
    const h = await sha(tok);
    const t = await env.DB.prepare('SELECT uid, exp FROM sr_tokens WHERE hash=?').bind(h).first();
    await env.DB.prepare('DELETE FROM sr_tokens WHERE hash=? OR exp<?').bind(h, now()).run(); // bir martalik
    if (!t || t.exp < now()) return json({ ok: false, err: 'expired' }, 401);
    const sid = rand(32);
    await env.DB.prepare('INSERT INTO sr_sessions(hash,uid,exp) VALUES(?,?,?)').bind(await sha(sid), t.uid, now() + 7 * 86400).run();
    await env.DB.prepare('DELETE FROM sr_sessions WHERE exp<?').bind(now()).run();
    await log(env, t.uid, 'login');
    return json({ ok: true }, 200, { 'set-cookie': `sr=${sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 86400}` });
  }
  if (p === '/api/admin/logout' && req.method === 'POST') {
    const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)sr=([0-9a-f]{64})/);
    if (m) await env.DB.prepare('DELETE FROM sr_sessions WHERE hash=?').bind(await sha(m[1])).run();
    return json({ ok: true }, 200, { 'set-cookie': 'sr=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }
  if (p.startsWith('/api/admin/')) {
    const uid = await session(req, env);
    if (!uid) return json({ ok: false, err: 'auth' }, 401);
    if (p === '/api/admin/me' && req.method === 'GET') {
      const u = await env.DB.prepare('SELECT name FROM users WHERE id=?').bind(uid).first();
      const last = await env.DB.prepare('SELECT updated_at, updated_by FROM sr_config WHERE project=?').bind(PROJECT).first();
      return json({ ok: true, uid, name: u?.name || String(uid), updated_at: last?.updated_at || null });
    }
    if (!sameOrigin(req)) return json({ ok: false }, 403);
    if (p === '/api/admin/config' && req.method === 'PUT') {
      const raw = await req.text();
      if (raw.length > 200000) return json({ ok: false, err: 'big' }, 413);
      let c; try { c = normalize(JSON.parse(raw)); } catch { return json({ ok: false, err: 'invalid' }, 400); }
      await env.DB.prepare('INSERT INTO sr_config(project,json,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(project) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, updated_by=excluded.updated_by')
        .bind(PROJECT, JSON.stringify(c), now(), uid).run();
      await log(env, uid, 'config');
      return json({ ok: true, config: c });
    }
    if (p === '/api/admin/pano' && req.method === 'POST') {
      if (!env.PANOS) return json({ ok: false, err: 'no-storage' }, 500);
      const len = +(req.headers.get('content-length') || 0);
      if (len > MAX_PANO) return json({ ok: false, err: 'big' }, 413);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_PANO || buf.byteLength < 1000) return json({ ok: false, err: 'size' }, 400);
      const b = new Uint8Array(buf);
      if (!(b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)) return json({ ok: false, err: 'jpeg' }, 400); // faqat JPEG
      const key = 'p' + rand(12);
      await env.PANOS.put(key, buf, { metadata: { uid, at: now() } });
      await log(env, uid, 'pano ' + key);
      return json({ ok: true, key, url: '/pano/' + key + '.jpg' });
    }
    return json({ ok: false }, 404);
  }
  return json({ ok: false }, 404);
}

async function pano(env, key) {
  if (!env.PANOS) return new Response('Not found', { status: 404 });
  const v = await env.PANOS.get(key, 'arrayBuffer');
  if (!v) return new Response('Not found', { status: 404 });
  return new Response(v, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, url); } catch (e) { console.log('api', e.stack); return json({ ok: false, err: 'server' }, 500); }
    }
    const pm = url.pathname.match(/^\/pano\/(p[0-9a-f]{24})\.jpg$/);
    if (pm) return pano(env, pm[1]);
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    if (url.pathname.includes('..')) return new Response('Not found', { status: 404 });
    const r = await fetch(ORIGIN + url.pathname + url.search, { method: req.method, redirect: 'manual', cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.status >= 300 && r.status < 400) {
      const loc = new URL(r.headers.get('location'), ORIGIN + url.pathname);
      const path = loc.pathname.replace(/^\/zumrad/, '') || '/';
      return Response.redirect(url.origin + path + loc.search, r.status);
    }
    const h = new Headers(r.headers);
    h.set('x-content-type-options', 'nosniff'); h.set('referrer-policy', 'strict-origin-when-cross-origin');
    h.set('strict-transport-security', 'max-age=15552000');
    if (url.pathname.startsWith('/admin')) { h.set('x-robots-tag', 'noindex, nofollow'); h.set('x-frame-options', 'DENY'); h.set('cache-control', 'no-store'); }
    return new Response(r.body, { status: r.status, headers: h });
  }
};
