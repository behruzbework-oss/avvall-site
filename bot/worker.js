// AVVALL lid boti — Cloudflare Worker (D1: DB, secret: BOT_TOKEN, cron: * * * * *)
const TZ = 5 * 3600; // Toshkent UTC+5
const TOPICS = [
  ['inbox', '📥 Barcha lidlar', 0x6FB9F0], ['ok', '✅ Tasdiqlandi', 0x8EEE98],
  ['no', '❌ Bekor qilindi', 0xFF93B2], ['rem', '⏰ Eslatmalar', 0xFFD67E], ['rep', '📊 Hisobot', 0xCB86DB]];
const REASONS = { q: 'Qimmat', j: 'Javob bermadi', k: 'Keyinroq', b: 'Boshqa studiya', x: 'Boshqa sabab' };
const ST = { new: '🆕 Yangi', ok: '✅ Tasdiqlandi', no: '❌ Bekor qilindi', na: '📞 Javob bermadi', done: '🏁 Uchrashuv o\'tdi' };
const WD = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const now = () => Math.floor(Date.now() / 1000);
const loc = t => new Date((t + TZ) * 1000); // UTC getterlari Toshkent vaqtini beradi
const fmt = t => { const d = loc(t); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')} ${WD[d.getUTCDay()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const num = id => '#' + String(id).padStart(3, '0');
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...h } });

async function secretOf(env) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('avvall:' + env.BOT_TOKEN));
  return [...new Uint8Array(b)].slice(0, 20).map(x => x.toString(16).padStart(2, '0')).join('');
}
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) console.log('tg', method, JSON.stringify(j)); return j;
}
async function schema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INT, name TEXT, company TEXT, phone TEXT, message TEXT, source TEXT, ip TEXT, status TEXT DEFAULT 'new', meeting_at INT, assignees TEXT DEFAULT '[]', reason TEXT, notes TEXT DEFAULT '[]', card_msg INT, reminded INT DEFAULT 0, followup_at INT, closed_by INT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users(id INT PRIMARY KEY, name TEXT, username TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pending(uid INT PRIMARY KEY, lead_id INT, kind TEXT, at INT)`)]);
}
const kget = async (env, k) => (await env.DB.prepare('SELECT v FROM kv WHERE k=?').bind(k).first())?.v ?? null;
const kset = (env, k, v) => env.DB.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(v)).run();
const getLead = (env, id) => env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
async function conf(env) { const g = await kget(env, 'group'); const t = JSON.parse(await kget(env, 'topics') || '{}'); return { g: g && Number(g), t }; }
async function userName(env, id) { const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first(); return u ? u.name : String(id); }
const mention = (id, name) => `<a href="tg://user?id=${id}">${esc(name)}</a>`;
async function mentions(env, ids) { const out = []; for (const id of ids) out.push(mention(id, await userName(env, id))); return out.join(', '); }

async function cardText(env, L) {
  const a = JSON.parse(L.assignees || '[]'), notes = JSON.parse(L.notes || '[]');
  let s = `<b>${num(L.id)} · ${ST[L.status] || L.status}</b>\n\n👤 <b>${esc(L.name)}</b>${L.company ? ' · ' + esc(L.company) : ''}\n📞 <a href="tel:${esc(L.phone.replace(/[^\d+]/g, ''))}">${esc(L.phone)}</a>\n`;
  if (L.message) s += `📝 ${esc(L.message)}\n`;
  s += `\n🕐 Keldi: ${fmt(L.created_at)} · ${esc(L.source || 'sayt')}`;
  if (L.meeting_at) s += `\n📅 Uchrashuv: <b>${fmt(L.meeting_at)}</b>`;
  if (a.length) s += `\n👥 Mas'ul: ${await mentions(env, a)}`;
  if (L.reason) s += `\n❔ Sabab: ${esc(L.reason)}`;
  if (L.closed_by && L.status !== 'new') s += `\n✍️ ${esc(await userName(env, L.closed_by))}`;
  for (const n of notes.slice(-5)) s += `\n💬 ${esc(n.by)}: ${esc(n.t)}`;
  return s;
}
function mainKb(L) {
  const id = L.id;
  if (L.status === 'new' || L.status === 'na') return [[{ text: '✅ Tasdiqlash', callback_data: `ok:${id}` }, { text: '❌ Bekor qilish', callback_data: `no:${id}` }], [{ text: '📞 Javob bermadi', callback_data: `na:${id}` }, { text: '💬 Izoh', callback_data: `nt:${id}` }]];
  if (L.status === 'ok') return [[{ text: '🏁 Uchrashuv o\'tdi', callback_data: `dn:${id}` }, { text: '🔁 Vaqtni o\'zgartirish', callback_data: `ok:${id}` }], [{ text: '👥 Mas\'ullar', callback_data: `as:${id}` }, { text: '❌ Bekor qilish', callback_data: `no:${id}` }], [{ text: '💬 Izoh', callback_data: `nt:${id}` }]];
  return [[{ text: '↩️ Qayta ochish', callback_data: `ro:${id}` }, { text: '💬 Izoh', callback_data: `nt:${id}` }]];
}
async function refresh(env, L, kb) {
  const { g } = await conf(env); if (!g || !L.card_msg) return;
  await tg(env, 'editMessageText', { chat_id: g, message_id: L.card_msg, text: await cardText(env, L), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: kb || mainKb(L) } });
}
async function post(env, topic, text, extra = {}) {
  const { g, t } = await conf(env); if (!g) return null;
  return tg(env, 'sendMessage', { chat_id: g, message_thread_id: t[topic] || undefined, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}

// ---------- sayt formasi ----------
async function newLead(req, env) {
  let d = {}; const ct = req.headers.get('content-type') || '';
  if (ct.includes('json')) d = await req.json(); else d = Object.fromEntries(new URLSearchParams(await req.text()));
  if (d.manzil) return { ok: true }; // honeypot
  const name = String(d.ism || d.name || '').trim().slice(0, 120), phone = String(d.telefon || d.phone || '').trim().slice(0, 40);
  if (!name || phone.replace(/\D/g, '').length < 9) return { ok: false, err: 'invalid' };
  const ip = req.headers.get('cf-connecting-ip') || '';
  const recent = await env.DB.prepare('SELECT COUNT(*) c FROM leads WHERE ip=? AND created_at>?').bind(ip, now() - 600).first();
  if (recent.c >= 3) return { ok: false, err: 'rate' };
  const r = await env.DB.prepare('INSERT INTO leads(created_at,name,company,phone,message,source,ip) VALUES(?,?,?,?,?,?,?) RETURNING *')
    .bind(now(), name, String(d.kompaniya || '').trim().slice(0, 160), phone, String(d.loyiha || d.message || '').trim().slice(0, 2000), String(d.source || 'avvall.uz').slice(0, 60), ip).first();
  const m = await post(env, 'inbox', await cardText(env, r), { reply_markup: { inline_keyboard: mainKb(r) } });
  if (m?.ok) await env.DB.prepare('UPDATE leads SET card_msg=? WHERE id=?').bind(m.result.message_id, r.id).run();
  return { ok: true, id: r.id };
}

// ---------- tugmalar ----------
function dateKb(id) {
  const rows = [], base = now(); let row = [];
  for (let i = 0; i < 7; i++) {
    const d = loc(base + i * 86400), ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    row.push({ text: i == 0 ? 'Bugun' : i == 1 ? 'Ertaga' : `${WD[d.getUTCDay()]} ${d.getUTCDate()}`, callback_data: `d:${id}:${ymd}` });
    if (row.length == 4) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row); rows.push([{ text: '⬅️ Orqaga', callback_data: `bk:${id}` }]); return rows;
}
function hourKb(id, ymd) {
  const rows = []; let row = [];
  for (let h = 9; h <= 20; h++) { row.push({ text: `${h}:00`, callback_data: `h:${id}:${ymd}:${h}` }); if (row.length == 4) { rows.push(row); row = []; } }
  rows.push([{ text: '⬅️ Sana', callback_data: `ok:${id}` }]); return rows;
}
function minKb(id, ymd, h) {
  return [[0, 15, 30, 45].map(m => ({ text: `${h}:${String(m).padStart(2, '0')}`, callback_data: `m:${id}:${ymd}:${h}:${m}` })), [{ text: '⬅️ Soat', callback_data: `d:${id}:${ymd}` }]];
}
async function assignKb(env, L) {
  const a = JSON.parse(L.assignees || '[]'); const us = (await env.DB.prepare('SELECT * FROM users ORDER BY name LIMIT 12').all()).results;
  const rows = []; let row = [];
  for (const u of us) { row.push({ text: (a.includes(u.id) ? '☑️ ' : '⬜️ ') + u.name.slice(0, 18), callback_data: `a:${L.id}:${u.id}` }); if (row.length == 2) { rows.push(row); row = []; } }
  if (row.length) rows.push(row); rows.push([{ text: '✔️ Tayyor', callback_data: `af:${L.id}` }]); return rows;
}
const tsOf = (ymd, h, m) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +h, +m) / 1000) - TZ;

async function onCallback(env, q) {
  const uid = q.from.id; await saveUser(env, q.from);
  const [act, sid, ...rest] = q.data.split(':'); const id = +sid; let L = await getLead(env, id);
  const ans = (text, alert = false) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alert });
  if (!L) return ans('Lid topilmadi');
  const upd = async (sql, ...b) => { await env.DB.prepare(sql).bind(...b).run(); L = await getLead(env, id); };
  switch (act) {
    case 'ok': await refresh(env, L, dateKb(id)); return ans('Uchrashuv kunini tanlang');
    case 'bk': await refresh(env, L); return ans('');
    case 'd': await refresh(env, L, hourKb(id, rest[0])); return ans('Soatni tanlang');
    case 'h': await refresh(env, L, minKb(id, rest[0], rest[1])); return ans('Daqiqani tanlang');
    case 'm': {
      const t = tsOf(rest[0], rest[1], rest[2]); if (t < now()) return ans('Bu vaqt o\'tib ketgan', true);
      const a = JSON.parse(L.assignees || '[]'); if (!a.includes(uid)) a.push(uid);
      const was = L.status === 'ok';
      await upd('UPDATE leads SET status=\'ok\', meeting_at=?, reminded=0, assignees=?, closed_by=?, reason=NULL, followup_at=NULL WHERE id=?', t, JSON.stringify(a), uid, id);
      await refresh(env, L, await assignKb(env, L));
      await post(env, 'ok', `${was ? '🔁 Vaqt o\'zgardi' : '✅ Tasdiqlandi'} · <b>${num(id)} ${esc(L.name)}</b>\n📅 ${fmt(t)}\n👥 ${await mentions(env, a)}`);
      return ans('Saqlandi. Mas\'ullarni belgilang');
    }
    case 'as': await refresh(env, L, await assignKb(env, L)); return ans('Mas\'ullarni belgilang');
    case 'a': {
      const u = +rest[0]; let a = JSON.parse(L.assignees || '[]'); a = a.includes(u) ? a.filter(x => x !== u) : [...a, u];
      await upd('UPDATE leads SET assignees=? WHERE id=?', JSON.stringify(a), id); await refresh(env, L, await assignKb(env, L)); return ans('');
    }
    case 'af': await refresh(env, L); return ans('Tayyor');
    case 'no': await refresh(env, L, [...Object.entries(REASONS).map(([k, v]) => [{ text: v, callback_data: `r:${id}:${k}` }]), [{ text: '⬅️ Orqaga', callback_data: `bk:${id}` }]]); return ans('Sababini tanlang');
    case 'r': await upd('UPDATE leads SET status=\'no\', reason=?, closed_by=?, followup_at=NULL WHERE id=?', REASONS[rest[0]] || 'Boshqa', uid, id); await refresh(env, L);
      await post(env, 'no', `❌ <b>${num(id)} ${esc(L.name)}</b> · ${esc(L.reason)}\n✍️ ${mention(uid, q.from.first_name)}`); return ans('Bekor qilindi');
    case 'na': { const f = now() + 86400; await upd('UPDATE leads SET status=\'na\', followup_at=?, closed_by=? WHERE id=?', f, uid, id); await refresh(env, L); return ans('Ertaga shu vaqtda qayta eslataman'); }
    case 'dn': await upd('UPDATE leads SET status=\'done\', closed_by=? WHERE id=?', uid, id); await refresh(env, L); return ans('Ajoyib! Uchrashuv o\'tdi');
    case 'ro': await upd('UPDATE leads SET status=\'new\', reason=NULL WHERE id=?', id); await refresh(env, L); return ans('Qayta ochildi');
    case 'nt': {
      await env.DB.prepare('INSERT INTO pending(uid,lead_id,kind,at) VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET lead_id=excluded.lead_id, kind=excluded.kind, at=excluded.at').bind(uid, id, 'note', now()).run();
      const { g } = await conf(env);
      await tg(env, 'sendMessage', { chat_id: g, message_thread_id: q.message.message_thread_id, text: `💬 ${mention(uid, q.from.first_name)}, ${num(id)} uchun izohni shu xabarga javob qilib yozing.`, parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true } });
      return ans('Izohni yozing');
    }
  }
  return ans('');
}
async function saveUser(env, f) {
  if (!f || f.is_bot) return;
  const name = [f.first_name, f.last_name].filter(Boolean).join(' ') || f.username || String(f.id);
  await env.DB.prepare('INSERT INTO users(id,name,username) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username').bind(f.id, name, f.username || null).run();
}

// ---------- xabarlar va buyruqlar ----------
async function onMessage(env, m) {
  await saveUser(env, m.from);
  const text = (m.text || '').trim(), cmd = text.split(/[\s@]/)[0];
  const { g } = await conf(env);
  if (cmd === '/start' && m.chat.type === 'private') return tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Salom! Men AVVALL lid botiman. Meni guruhga admin qilib qo\'shing va guruhda /setup yozing.' });
  if (cmd === '/setup' && ['group', 'supergroup'].includes(m.chat.type)) {
    if (g && g !== m.chat.id) return tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Bot boshqa guruhga ulangan.' });
    const mem = await tg(env, 'getChatMember', { chat_id: m.chat.id, user_id: m.from.id });
    if (!['creator', 'administrator'].includes(mem.result?.status)) return;
    if (!m.chat.is_forum) return tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Guruh sozlamalarida "Mavzular" (Topics) ni yoqing, keyin /setup ni qayta yozing.' });
    await kset(env, 'group', m.chat.id);
    const t = JSON.parse(await kget(env, 'topics') || '{}');
    for (const [k, name, color] of TOPICS) {
      if (t[k]) continue;
      const r = await tg(env, 'createForumTopic', { chat_id: m.chat.id, name, icon_color: color });
      if (r.ok) t[k] = r.result.message_thread_id; else return tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Mavzu ochib bo\'lmadi: botni admin qilib, "Mavzularni boshqarish" huquqini bering.' });
    }
    await kset(env, 'topics', JSON.stringify(t));
    await post(env, 'inbox', '📥 Saytdan keladigan so\'rovlar shu yerga tushadi.\n\nHar bir kartada: ✅ tasdiqlash (vaqt va mas\'ul), ❌ bekor qilish (sabab), 📞 javob bermadi (ertaga eslatma), 💬 izoh.\n\nBuyruqlar: /stats — statistika, /bugun — bugungi uchrashuvlar, /test — sinov lidi.');
    return tg(env, 'sendMessage', { chat_id: m.chat.id, message_thread_id: m.message_thread_id, text: '✅ Guruh sozlandi: 5 ta mavzu ochildi.' });
  }
  if (!g || m.chat.id !== g) return;
  // izoh javobi
  if (m.reply_to_message && text && !text.startsWith('/')) {
    const p = await env.DB.prepare('SELECT * FROM pending WHERE uid=?').bind(m.from.id).first();
    if (p && p.kind === 'note' && now() - p.at < 3600) {
      const L = await getLead(env, p.lead_id); const notes = JSON.parse(L.notes || '[]'); notes.push({ by: m.from.first_name, t: text.slice(0, 300), at: now() });
      await env.DB.prepare('UPDATE leads SET notes=? WHERE id=?').bind(JSON.stringify(notes), L.id).run();
      await env.DB.prepare('DELETE FROM pending WHERE uid=?').bind(m.from.id).run();
      await refresh(env, { ...L, notes: JSON.stringify(notes) });
      await tg(env, 'deleteMessage', { chat_id: g, message_id: m.reply_to_message.message_id });
      return tg(env, 'setMessageReaction', { chat_id: g, message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] });
    }
  }
  if (cmd === '/stats') return tg(env, 'sendMessage', { chat_id: g, message_thread_id: m.message_thread_id, text: await stats(env, 30), parse_mode: 'HTML' });
  if (cmd === '/bugun') return tg(env, 'sendMessage', { chat_id: g, message_thread_id: m.message_thread_id, text: await today(env), parse_mode: 'HTML' });
  if (cmd === '/test') { await newLead(new Request('https://x/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ism: 'Sinov Mijoz', telefon: '+998 90 000 00 00', kompaniya: 'Test Qurilish', loyiha: '12 qavatli bino, 2027', source: 'sinov' }) }), env); }
}
async function stats(env, days) {
  const since = now() - days * 86400;
  const rows = (await env.DB.prepare('SELECT status, COUNT(*) c FROM leads WHERE created_at>? GROUP BY status').bind(since).all()).results;
  const c = Object.fromEntries(rows.map(r => [r.status, r.c])); const all = rows.reduce((s, r) => s + r.c, 0);
  const won = (c.ok || 0) + (c.done || 0);
  const top = (await env.DB.prepare('SELECT closed_by, COUNT(*) c FROM leads WHERE created_at>? AND status IN (\'ok\',\'done\') AND closed_by IS NOT NULL GROUP BY closed_by ORDER BY c DESC LIMIT 5').bind(since).all()).results;
  let s = `📊 <b>Oxirgi ${days} kun</b>\n\nJami lid: <b>${all}</b>\n🆕 Yangi: ${c.new || 0}\n📞 Javob bermadi: ${c.na || 0}\n✅ Tasdiqlandi: ${c.ok || 0}\n🏁 Uchrashuv o'tdi: ${c.done || 0}\n❌ Bekor: ${c.no || 0}\n\nKonversiya: <b>${all ? Math.round(won / all * 100) : 0}%</b>`;
  if (top.length) { s += '\n\n🏆 Ko\'p tasdiqlaganlar:'; for (const t of top) s += `\n• ${esc(await userName(env, t.closed_by))} — ${t.c}`; }
  return s;
}
async function today(env) {
  const d = loc(now()), start = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000) - TZ;
  const r = (await env.DB.prepare('SELECT * FROM leads WHERE status=\'ok\' AND meeting_at BETWEEN ? AND ? ORDER BY meeting_at').bind(start, start + 86400).all()).results;
  if (!r.length) return '📅 Bugun uchrashuv yo\'q.';
  let s = `📅 <b>Bugungi uchrashuvlar (${r.length})</b>`;
  for (const L of r) s += `\n\n${fmt(L.meeting_at).split(', ')[1]} · <b>${num(L.id)} ${esc(L.name)}</b>${L.company ? ' · ' + esc(L.company) : ''}\n👥 ${await mentions(env, JSON.parse(L.assignees || '[]'))}`;
  return s;
}

// ---------- har daqiqa ----------
async function tick(env) {
  const { g } = await conf(env); if (!g) return; const t = now();
  const due = (await env.DB.prepare('SELECT * FROM leads WHERE status=\'ok\' AND reminded=0 AND meeting_at<=? AND meeting_at>?').bind(t + 1800, t - 600).all()).results;
  for (const L of due) {
    const a = JSON.parse(L.assignees || '[]'); const left = Math.max(0, Math.round((L.meeting_at - t) / 60));
    await post(env, 'rem', `⏰ <b>${left} daqiqadan keyin uchrashuv</b>\n\n${num(L.id)} · <b>${esc(L.name)}</b>${L.company ? ' · ' + esc(L.company) : ''}\n📞 ${esc(L.phone)}\n📅 ${fmt(L.meeting_at)}\n\n👥 ${a.length ? await mentions(env, a) : 'mas\'ul belgilanmagan'}`);
    await env.DB.prepare('UPDATE leads SET reminded=1 WHERE id=?').bind(L.id).run();
  }
  const fu = (await env.DB.prepare('SELECT * FROM leads WHERE status=\'na\' AND followup_at IS NOT NULL AND followup_at<=?').bind(t).all()).results;
  for (const L of fu) {
    await post(env, 'rem', `📞 <b>Qayta qo'ng'iroq qiling</b>\n${num(L.id)} · <b>${esc(L.name)}</b> · ${esc(L.phone)}\n👤 ${L.closed_by ? mention(L.closed_by, await userName(env, L.closed_by)) : ''}`);
    await env.DB.prepare('UPDATE leads SET followup_at=NULL WHERE id=?').bind(L.id).run();
  }
  const d = loc(t), day = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  if (d.getUTCHours() === 9 && (await kget(env, 'report')) !== day) {
    await kset(env, 'report', day);
    await post(env, 'rep', (await stats(env, 1)).replace('Oxirgi 1 kun', 'Kecha va bugun (24 soat)') + '\n\n' + await today(env));
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url); await schema(env);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname === '/lead' && req.method === 'POST') return json(await newLead(req, env), 200, cors);
    if (url.pathname === '/tg' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== await secretOf(env)) return new Response('no', { status: 403 });
      const u = await req.json();
      try { if (u.callback_query) await onCallback(env, u.callback_query); else if (u.message) await onMessage(env, u.message); } catch (e) { console.log('err', e.stack); }
      return new Response('ok');
    }
    if (url.pathname === '/init') {
      const r = await tg(env, 'setWebhook', { url: `${url.origin}/tg`, secret_token: await secretOf(env), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
      await tg(env, 'setMyCommands', { commands: [{ command: 'stats', description: 'Statistika (30 kun)' }, { command: 'bugun', description: 'Bugungi uchrashuvlar' }, { command: 'test', description: 'Sinov lidi' }, { command: 'setup', description: 'Guruhni sozlash' }] });
      const me = await tg(env, 'getMe', {});
      return json({ webhook: r.ok, err: r.description, bot: me.result?.username, group: (await conf(env)).g });
    }
    return new Response('AVVALL bot ishlayapti');
  },
  async scheduled(ev, env, ctx) { await schema(env); ctx.waitUntil(tick(env)); },
};
