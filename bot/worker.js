// AVVALL CRM boti v2 — Cloudflare Worker (D1: DB, BOT_TOKEN, cron: har daqiqa)
const TZ = 5 * 3600; // Toshkent UTC+5
// Guruh bo'limlari (forum mavzulari). Karta holatiga qarab o'z bo'limiga ko'chadi.
const TOPICS = [
  ['new', '🆕 Yangi lidlar', 0x6FB9F0], ['meet', '📅 Uchrashuvlar', 0xFFD67E], ['follow', '💬 Qayta suhbat', 0xCB86DB],
  ['won', '🏁 Yopilgan bitimlar', 0x8EEE98], ['lost', '❌ Bekor qilingan', 0xFF93B2], ['rem', '⏰ Eslatmalar', 0xFB6F5F], ['rep', '📊 Hisobot', 0x6FB9F0]];
const TOPIC_OF = { new: 'new', na: 'follow', fu: 'follow', ok: 'meet', done: 'won', no: 'lost' };
const ST = { new: '🆕 Yangi', na: '📞 Javob bermadi', fu: '💬 Qayta suhbat', ok: '📅 Uchrashuv belgilandi', done: '🏁 Bitim yopildi', no: '❌ Bekor qilindi' };
const REASONS = { q: 'Qimmat', b: 'Boshqa studiya', e: 'Ehtiyoj yo\'q', x: 'Boshqa sabab' };
const WD = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];
const TPL_DEFAULT = {
  meet: 'Hurmatli {ism}! AVVALL jamoasidan. {sana} kuni soat {soat} da siz bilan uchrashuvimizni eslatib o\'tamiz. Ko\'rishganimizdan mamnun bo\'lamiz.',
  wait: 'Hurmatli {ism}! AVVALL jamoasidan. Taklifimiz bo\'yicha javobingizni kutib qolamiz. Savollaringiz bo\'lsa, shu yerga yozing.',
  thanks: 'Hurmatli {ism}! Bugungi uchrashuv uchun rahmat. Kelishilgan ishlarni boshlaymiz, yangiliklarni shu yerda yuborib boramiz.'
};
const TPL_NAME = { meet: '📅 Uchrashuv eslatmasi', wait: '⏳ Javob kutyapmiz', thanks: '🙏 Rahmat' };

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const now = () => Math.floor(Date.now() / 1000);
const loc = t => new Date((t + TZ) * 1000);
const p2 = n => String(n).padStart(2, '0');
const fmtD = t => { const d = loc(t); return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)} ${WD[d.getUTCDay()]}`; };
const fmtT = t => { const d = loc(t); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const fmt = t => `${fmtD(t)}, ${fmtT(t)}`;
const num = id => '#' + String(id).padStart(3, '0');
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...h } });
const J = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

const TOK = env => String(env.BOT_TOKEN || '').replace(/\s+/g, '');
async function secretOf(env) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('avvall:' + TOK(env)));
  return [...new Uint8Array(b)].slice(0, 20).map(x => x.toString(16).padStart(2, '0')).join('');
}
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOK(env)}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) console.log('tg', method, JSON.stringify(j)); return j;
}
const ORIGINS = ['https://avvall.uz', 'https://www.avvall.uz', 'https://dev.avvall.uz', 'https://avvall-dev.behruzbework.workers.dev'];
let schemaDone = false;
async function schema(env) {
  if (schemaDone) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INT, name TEXT, company TEXT, phone TEXT, message TEXT, source TEXT, ip TEXT, status TEXT DEFAULT 'new', meeting_at INT, assignees TEXT DEFAULT '[]', reason TEXT, notes TEXT DEFAULT '[]', card_msg INT, reminded INT DEFAULT 0, followup_at INT, closed_by INT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users(id INT PRIMARY KEY, name TEXT, username TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS pending(uid INT PRIMARY KEY, lead_id INT, kind TEXT, at INT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS team(id INT PRIMARY KEY, role TEXT DEFAULT 'manager', mention INT DEFAULT 1, dm INT DEFAULT 1)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INT, text TEXT, send_at INT, status TEXT DEFAULT 'wait', created_by INT, via TEXT, info TEXT)`)]);
  for (const sql of ['ALTER TABLE leads ADD COLUMN card_topic TEXT', 'ALTER TABLE leads ADD COLUMN client_chat INT', 'ALTER TABLE leads ADD COLUMN client_last INT', 'ALTER TABLE leads ADD COLUMN tg_user TEXT', 'ALTER TABLE leads ADD COLUMN claim TEXT'])
    try { await env.DB.prepare(sql).run(); } catch { }
  schemaDone = true;
}
const kget = async (env, k) => (await env.DB.prepare('SELECT v FROM kv WHERE k=?').bind(k).first())?.v ?? null;
const kset = (env, k, v) => env.DB.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(v)).run();
const getLead = (env, id) => env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
async function conf(env) { const g = await kget(env, 'group'); const t = J(await kget(env, 'topics2'), {}); return { g: g && Number(g), t }; }
async function setting(env, k, d) { const v = await kget(env, 'set:' + k); return v === null ? d : v; }
async function tpl(env, k) { return (await kget(env, 'tpl:' + k)) || TPL_DEFAULT[k]; }
async function userName(env, id) { const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first(); return u ? u.name : String(id); }
const mention = (id, name) => `<a href="tg://user?id=${id}">${esc(name)}</a>`;
async function mentions(env, ids) { const out = []; for (const id of ids) out.push(mention(id, await userName(env, id))); return out.join(', '); }
async function member(env, id) { return env.DB.prepare('SELECT * FROM team WHERE id=?').bind(id).first(); }
async function isAdmin(env, id) { const m = await member(env, id); return m && (m.role === 'admin' || m.role === 'owner'); }
async function isTeam(env, id) { return !!(await member(env, id)); }

// ---------- karta ----------
async function cardText(env, L) {
  const a = J(L.assignees, []), notes = J(L.notes, []);
  let s = `<b>${num(L.id)} · ${ST[L.status] || L.status}</b>\n\n👤 <b>${esc(L.name)}</b>${L.company ? ' · ' + esc(L.company) : ''}\n📞 <a href="tel:${esc(String(L.phone).replace(/[^\d+]/g, ''))}">${esc(L.phone)}</a>`;
  if (L.client_chat) s += ' · 💬 Telegram ulangan';
  if (L.message) s += `\n📝 ${esc(L.message)}`;
  s += `\n\n🕐 Keldi: ${fmt(L.created_at)} · ${esc(L.source || 'sayt')}`;
  if (L.meeting_at && L.status === 'ok') s += `\n📅 Uchrashuv: <b>${fmt(L.meeting_at)}</b>`;
  if (L.followup_at && (L.status === 'na' || L.status === 'fu')) s += `\n🔁 Qayta bog'lanish: <b>${fmt(L.followup_at)}</b>`;
  if (a.length) s += `\n👥 Mas'ul: ${await mentions(env, a)}`;
  if (L.reason) s += `\n❔ Sabab: ${esc(L.reason)}`;
  const ob = (await env.DB.prepare('SELECT * FROM outbox WHERE lead_id=? AND status=\'wait\' ORDER BY send_at').bind(L.id).all()).results;
  for (const o of ob) s += `\n✉️ Mijozga xabar: ${fmt(o.send_at)}`;
  for (const n of notes.slice(-4)) s += `\n💬 ${esc(n.by)}: ${esc(n.t)}`;
  return s;
}
function mainKb(L) {
  const id = L.id, msg = { text: '✉️ Mijozga xabar', callback_data: `cm:${id}` }, note = { text: '💬 Izoh', callback_data: `nt:${id}` };
  if (['new', 'na', 'fu'].includes(L.status)) return [[{ text: '📅 Uchrashuv belgilash', callback_data: `ok:${id}` }], [{ text: '📞 Javob bermadi', callback_data: `na:${id}` }, { text: '💬 Keyinroq', callback_data: `fu:${id}` }], [msg, note], [{ text: '❌ Bekor qilish', callback_data: `no:${id}` }]];
  if (L.status === 'ok') return [[{ text: '🏁 Bitim yopildi', callback_data: `dn:${id}` }, { text: '🔁 Vaqtni o\'zgartirish', callback_data: `ok:${id}` }], [{ text: '👥 Mas\'ullar', callback_data: `as:${id}` }, msg], [note, { text: '❌ Bekor qilish', callback_data: `no:${id}` }]];
  return [[{ text: '↩️ Qayta ochish', callback_data: `ro:${id}` }, msg], [note]];
}
// Kartani holatiga mos bo'limga qo'yadi: bo'lim o'zgargan bo'lsa eskisini o'chirib, yangi bo'limda qayta chiqaradi
async function placeCard(env, L, kb) {
  const { g, t } = await conf(env); if (!g) return;
  const topic = TOPIC_OF[L.status] || 'new';
  const text = await cardText(env, L), markup = { inline_keyboard: kb || mainKb(L) };
  if (L.card_msg && L.card_topic === topic) {
    const r = await tg(env, 'editMessageText', { chat_id: g, message_id: L.card_msg, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });
    if (r.ok || /not modified/.test(r.description || '')) return;
  }
  if (L.card_msg) await tg(env, 'deleteMessage', { chat_id: g, message_id: L.card_msg });
  const m = await tg(env, 'sendMessage', { chat_id: g, message_thread_id: t[topic] || undefined, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });
  if (m.ok) await env.DB.prepare('UPDATE leads SET card_msg=?, card_topic=? WHERE id=?').bind(m.result.message_id, topic, L.id).run();
}
async function post(env, topic, text, extra = {}) {
  const { g, t } = await conf(env); if (!g) return null;
  return tg(env, 'sendMessage', { chat_id: g, message_thread_id: t[topic] || undefined, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
async function dm(env, uid, text, extra = {}) { return tg(env, 'sendMessage', { chat_id: uid, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }); }
// Eslatma: bo'limga (mention yoqilganlar belgilanadi) + DM yoqilganlarga shaxsiy xabar
async function notify(env, L, title, body) {
  const a = J(L.assignees, []);
  let ids = a.length ? a : (await env.DB.prepare('SELECT id FROM team').all()).results.map(r => r.id);
  const team = Object.fromEntries((await env.DB.prepare('SELECT * FROM team').all()).results.map(r => [r.id, r]));
  const men = ids.filter(i => !team[i] || team[i].mention); const dms = ids.filter(i => team[i] && team[i].dm);
  const text = `${title}\n\n${num(L.id)} · <b>${esc(L.name)}</b>${L.company ? ' · ' + esc(L.company) : ''}\n📞 ${esc(L.phone)}${body ? '\n' + body : ''}`;
  await post(env, 'rem', text + (men.length ? `\n\n👥 ${await mentions(env, men)}` : ''));
  for (const u of dms) await dm(env, u, text, { reply_markup: { inline_keyboard: mainKb(L) } });
}

// ---------- sayt formasi ----------
async function newLead(req, env) {
  let d = {}; const ct = req.headers.get('content-type') || '';
  const raw = await req.text(); if (raw.length > 16000) return { ok: false, err: 'big' };
  try { d = ct.includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { return { ok: false, err: 'invalid' }; }
  if (!d || typeof d !== 'object') return { ok: false, err: 'invalid' };
  if (d.manzil) return { ok: true };
  const name = String(d.ism || d.name || '').trim().slice(0, 120), phone = String(d.telefon || d.phone || '').trim().slice(0, 40);
  if (!name || phone.replace(/\D/g, '').length < 9) return { ok: false, err: 'invalid' };
  const ip = req.headers.get('cf-connecting-ip') || '';
  const recent = await env.DB.prepare('SELECT COUNT(*) c FROM leads WHERE ip=? AND created_at>?').bind(ip, now() - 600).first();
  if (ip && recent.c >= 3) return { ok: false, err: 'rate' };
  const allHour = await env.DB.prepare('SELECT COUNT(*) c FROM leads WHERE created_at>?').bind(now() - 3600).first();
  if (allHour.c >= 60) return { ok: false, err: 'rate' };
  const claim = [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, '0')).join('');
  const r = await env.DB.prepare('INSERT INTO leads(created_at,name,company,phone,message,source,ip,claim) VALUES(?,?,?,?,?,?,?,?) RETURNING *')
    .bind(now(), name, String(d.kompaniya || '').trim().slice(0, 160), phone, String(d.loyiha || d.message || '').trim().slice(0, 2000), String(d.source || 'avvall.uz').slice(0, 60), ip, claim).first();
  await placeCard(env, r);
  const me = await kget(env, 'botname');
  return { ok: true, id: r.id, tg: me ? `https://t.me/${me}?start=c${claim}` : null };
}

// ---------- tanlov klaviaturalari ----------
function dateKb(prefix, id, back) {
  const rows = [], base = now(); let row = [];
  for (let i = 0; i < 8; i++) {
    const d = loc(base + i * 86400), ymd = `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`;
    row.push({ text: i == 0 ? 'Bugun' : i == 1 ? 'Ertaga' : `${WD[d.getUTCDay()]} ${d.getUTCDate()}`, callback_data: `${prefix}d:${id}:${ymd}` });
    if (row.length == 4) { rows.push(row); row = []; }
  }
  rows.push([{ text: '⬅️ Orqaga', callback_data: back }]); return rows;
}
function hourKb(prefix, id, ymd) {
  const rows = []; let row = [];
  for (let h = 8; h <= 21; h++) { row.push({ text: `${h}:00`, callback_data: `${prefix}h:${id}:${ymd}:${h}` }); if (row.length == 5) { rows.push(row); row = []; } }
  if (row.length) rows.push(row); rows.push([{ text: '⬅️ Sana', callback_data: `${prefix}s:${id}` }]); return rows;
}
const minKb = (prefix, id, ymd, h) => [[0, 15, 30, 45].map(m => ({ text: `${h}:${p2(m)}`, callback_data: `${prefix}m:${id}:${ymd}:${h}:${m}` })), [{ text: '⬅️ Soat', callback_data: `${prefix}d:${id}:${ymd}` }]];
async function assignKb(env, L) {
  const a = J(L.assignees, []); let us = (await env.DB.prepare('SELECT u.* FROM team t JOIN users u ON u.id=t.id ORDER BY u.name LIMIT 16').all()).results;
  if (!us.length) us = (await env.DB.prepare('SELECT * FROM users ORDER BY name LIMIT 12').all()).results;
  const rows = []; let row = [];
  for (const u of us) { row.push({ text: (a.includes(u.id) ? '☑️ ' : '⬜️ ') + u.name.slice(0, 18), callback_data: `a:${L.id}:${u.id}` }); if (row.length == 2) { rows.push(row); row = []; } }
  if (row.length) rows.push(row); rows.push([{ text: '✔️ Tayyor', callback_data: `af:${L.id}` }]); return rows;
}
const tsOf = (ymd, h, m) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +h, +m) / 1000) - TZ;
async function fillTpl(env, L, k) {
  const t = await tpl(env, k);
  return t.replace(/\{ism\}/g, L.name).replace(/\{kompaniya\}/g, L.company || '').replace(/\{sana\}/g, L.meeting_at ? fmtD(L.meeting_at) : '').replace(/\{soat\}/g, L.meeting_at ? fmtT(L.meeting_at) : '');
}

// ---------- mijozga xabar yuborish ----------
async function sendToClient(env, L, text) {
  // 1) Telegram Business: admin akkaunti nomidan (oxirgi 24 soatda mijoz yozgan bo'lsa)
  const bc = await kget(env, 'business');
  if (bc && L.client_chat && L.client_last && now() - L.client_last < 86000) {
    const r = await tg(env, 'sendMessage', { business_connection_id: bc, chat_id: L.client_chat, text });
    if (r.ok) return { ok: true, via: 'akkaunt' };
  }
  // 2) Bot orqali (mijoz botni ochgan bo'lsa)
  if (L.client_chat) {
    const r = await tg(env, 'sendMessage', { chat_id: L.client_chat, text });
    if (r.ok) return { ok: true, via: 'bot' };
  }
  return { ok: false };
}
async function deliverOutbox(env, o) {
  const L = await getLead(env, o.lead_id); if (!L) return;
  const r = await sendToClient(env, L, o.text);
  await env.DB.prepare('UPDATE outbox SET status=?, via=? WHERE id=?').bind(r.ok ? 'sent' : 'manual', r.via || 'manual', o.id).run();
  if (r.ok) await post(env, 'rem', `✉️ ${num(L.id)} <b>${esc(L.name)}</b>ga xabar yuborildi (${r.via === 'akkaunt' ? 'akkaunt nomidan' : 'bot orqali'}).`);
  else {
    // Avtomatik yuborib bo'lmasa: mas'ulga tayyor matn + telefon
    const a = J(L.assignees, []), to = a.length ? a : [o.created_by];
    for (const u of to) await dm(env, u, `✉️ <b>${num(L.id)} ${esc(L.name)}</b>ga yuborish vaqti keldi.\nMijoz Telegram'da ulanmagan, xabarni o'zingiz yuboring:\n📞 ${esc(L.phone)}\n\n<code>${esc(o.text)}</code>`);
    await post(env, 'rem', `✉️ ${num(L.id)} <b>${esc(L.name)}</b>ga xabar vaqti keldi — mas'ulga tayyor matn yuborildi.`);
  }
  await placeCard(env, await getLead(env, L.id));
}

// ---------- tugmalar ----------
async function onCallback(env, q) {
  const uid = q.from.id; await saveUser(env, q.from);
  const ans = (text, alert = false) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alert });
  const [act, sid, ...rest] = q.data.split(':');
  if (act.startsWith('p')) return panelCb(env, q, act, sid, rest, ans);
  if (!(await isTeam(env, uid)) && (await env.DB.prepare('SELECT COUNT(*) c FROM team').first()).c > 0) return ans('Siz jamoa ro\'yxatida yo\'qsiz. Admin sizni qo\'shishi kerak.', true);
  const id = +sid; let L = await getLead(env, id);
  if (!L) return ans('Lid topilmadi');
  const upd = async (sql, ...b) => { await env.DB.prepare(sql).bind(...b).run(); L = await getLead(env, id); };
  const inDm = q.message?.chat?.type === 'private';
  const show = async kb => { if (inDm) await tg(env, 'editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: kb } }); else await placeCard(env, L, kb); };
  switch (act) {
    case 'ok': case 's': await show(dateKb('', id, `bk:${id}`)); return ans('Uchrashuv kunini tanlang');
    case 'bk': await show(mainKb(L)); return ans('');
    case 'd': await show(hourKb('', id, rest[0])); return ans('Soatni tanlang');
    case 'h': await show(minKb('', id, rest[0], rest[1])); return ans('Daqiqani tanlang');
    case 'm': {
      const t = tsOf(rest[0], rest[1], rest[2]); if (t < now()) return ans('Bu vaqt o\'tib ketgan', true);
      const a = J(L.assignees, []); if (!a.includes(uid)) a.push(uid);
      await upd('UPDATE leads SET status=\'ok\', meeting_at=?, reminded=0, assignees=?, closed_by=?, reason=NULL, followup_at=NULL WHERE id=?', t, JSON.stringify(a), uid, id);
      await placeCard(env, L, await assignKb(env, L)); return ans('Saqlandi. Mas\'ullarni belgilang');
    }
    case 'as': await placeCard(env, L, await assignKb(env, L)); return ans('Mas\'ullarni belgilang');
    case 'a': { const u = +rest[0]; let a = J(L.assignees, []); a = a.includes(u) ? a.filter(x => x !== u) : [...a, u]; await upd('UPDATE leads SET assignees=? WHERE id=?', JSON.stringify(a), id); await placeCard(env, L, await assignKb(env, L)); return ans(''); }
    case 'af': await placeCard(env, L); return ans('Tayyor');
    case 'na': { await upd('UPDATE leads SET status=\'na\', followup_at=?, closed_by=? WHERE id=?', now() + 86400, uid, id); await placeCard(env, L); return ans('Qayta suhbat bo\'limiga o\'tdi, ertaga eslataman'); }
    case 'fu': await show(dateKb('f', id, `bk:${id}`)); return ans('Qachon qayta bog\'lanamiz?');
    case 'fd': await show(hourKb('f', id, rest[0])); return ans('');
    case 'fs': await show(dateKb('f', id, `bk:${id}`)); return ans('');
    case 'fh': await show(minKb('f', id, rest[0], rest[1])); return ans('');
    case 'fm': { const t = tsOf(rest[0], rest[1], rest[2]); await upd('UPDATE leads SET status=\'fu\', followup_at=?, closed_by=? WHERE id=?', t, uid, id); await placeCard(env, L); return ans('Qayta suhbat belgilandi'); }
    case 'no': await show([...Object.entries(REASONS).map(([k, v]) => [{ text: v, callback_data: `r:${id}:${k}` }]), [{ text: '⬅️ Orqaga', callback_data: `bk:${id}` }]]); return ans('Sababini tanlang');
    case 'r': await upd('UPDATE leads SET status=\'no\', reason=?, closed_by=?, followup_at=NULL WHERE id=?', REASONS[rest[0]] || 'Boshqa', uid, id); await env.DB.prepare('UPDATE outbox SET status=\'cancel\' WHERE lead_id=? AND status=\'wait\'').bind(id).run(); await placeCard(env, L); return ans('Bekor qilingan bo\'limiga o\'tdi');
    case 'dn': await upd('UPDATE leads SET status=\'done\', closed_by=? WHERE id=?', uid, id); await placeCard(env, L); return ans('Tabriklaymiz! 🏁');
    case 'ro': await upd('UPDATE leads SET status=\'new\', reason=NULL WHERE id=?', id); await placeCard(env, L); return ans('Yangi lidlar bo\'limiga qaytdi');
    case 'nt': await askText(env, q, uid, id, 'note', `💬 ${num(id)} uchun izohni shu xabarga javob qilib yozing.`); return ans('Izohni yozing');
    // mijozga xabar: shablon -> vaqt
    case 'cm': await show([...Object.keys(TPL_DEFAULT).map(k => [{ text: TPL_NAME[k], callback_data: `ct:${id}:${k}` }]), [{ text: '✍️ O\'z matnim', callback_data: `ct:${id}:own` }], [{ text: '⬅️ Orqaga', callback_data: `bk:${id}` }]]); return ans('Shablonni tanlang');
    case 'ct': {
      if (rest[0] === 'own') { await askText(env, q, uid, id, 'cmsg', `✍️ ${num(id)} ${esc(L.name)}ga yuboriladigan matnni shu xabarga javob qilib yozing.`); return ans('Matnni yozing'); }
      await kset(env, 'draft:' + uid, JSON.stringify({ lead: id, text: await fillTpl(env, L, rest[0]) }));
      await show(sendWhenKb(L)); return ans('Qachon yuborilsin?');
    }
    case 'cw': {
      const dr = J(await kget(env, 'draft:' + uid), null); if (!dr || dr.lead !== id) return ans('Matn topilmadi, qaytadan tanlang', true);
      let t = now(); const w = rest[0];
      if (w === 'm30') { if (!L.meeting_at) return ans('Uchrashuv vaqti yo\'q', true); t = L.meeting_at - 1800; }
      else if (w === 'eve') { if (!L.meeting_at) return ans('Uchrashuv vaqti yo\'q', true); const d = loc(L.meeting_at - 86400); t = tsOf(`${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`, 19, 0); }
      else if (w === 'pick') { await show(dateKb('w', id, `cm:${id}`)); return ans('Kunni tanlang'); }
      await queueMsg(env, L, dr.text, t, uid); L = await getLead(env, id); await placeCard(env, L); return ans(t <= now() + 60 ? 'Yuborilmoqda…' : `${fmt(t)} da yuboriladi`);
    }
    case 'wd': await show(hourKb('w', id, rest[0])); return ans('');
    case 'ws': await show(dateKb('w', id, `cm:${id}`)); return ans('');
    case 'wh': await show(minKb('w', id, rest[0], rest[1])); return ans('');
    case 'wm': {
      const dr = J(await kget(env, 'draft:' + uid), null); if (!dr) return ans('Matn topilmadi', true);
      const t = tsOf(rest[0], rest[1], rest[2]); await queueMsg(env, L, dr.text, t, uid); L = await getLead(env, id); await placeCard(env, L); return ans(`${fmt(t)} da yuboriladi`);
    }
  }
  return ans('');
}
function sendWhenKb(L) {
  const rows = [[{ text: '⚡️ Hozir', callback_data: `cw:${L.id}:now` }]];
  if (L.meeting_at && L.meeting_at > now()) rows.push([{ text: '🌙 Uchrashuvdan oldingi kechqurun 19:00', callback_data: `cw:${L.id}:eve` }], [{ text: '⏰ Uchrashuvdan 30 daq oldin', callback_data: `cw:${L.id}:m30` }]);
  rows.push([{ text: '📅 Vaqtni tanlash', callback_data: `cw:${L.id}:pick` }], [{ text: '⬅️ Orqaga', callback_data: `cm:${L.id}` }]); return rows;
}
async function queueMsg(env, L, text, t, uid) {
  const r = await env.DB.prepare('INSERT INTO outbox(lead_id,text,send_at,created_by) VALUES(?,?,?,?) RETURNING *').bind(L.id, text, t, uid).first();
  if (t <= now() + 60) await deliverOutbox(env, r);
}
async function askText(env, q, uid, id, kind, prompt) {
  await env.DB.prepare('INSERT INTO pending(uid,lead_id,kind,at) VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET lead_id=excluded.lead_id, kind=excluded.kind, at=excluded.at').bind(uid, id, kind, now()).run();
  const chat = q.message.chat.id;
  await tg(env, 'sendMessage', { chat_id: chat, message_thread_id: q.message.message_thread_id, text: (chat < 0 ? mention(uid, q.from.first_name) + ', ' : '') + prompt, parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true } });
}
async function saveUser(env, f) {
  if (!f || f.is_bot) return;
  const name = [f.first_name, f.last_name].filter(Boolean).join(' ') || f.username || String(f.id);
  await env.DB.prepare('INSERT INTO users(id,name,username) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username').bind(f.id, name, f.username || null).run();
}

// ---------- admin panel (bot bilan shaxsiy chatda: /panel) ----------
async function panelText(env) {
  const team = (await env.DB.prepare('SELECT t.*, u.name, u.username FROM team t LEFT JOIN users u ON u.id=t.id ORDER BY t.role DESC, u.name').all()).results;
  const lead = await setting(env, 'remind', '30'), bc = await kget(env, 'business');
  let s = `⚙️ <b>AVVALL boshqaruv paneli</b>\n\n👥 <b>Jamoa</b> (🔔 guruhda belgilash · ✉️ shaxsiy xabar)`;
  for (const m of team) s += `\n• ${esc(m.name || m.id)}${m.username ? ' @' + esc(m.username) : ''} — ${m.role === 'admin' || m.role === 'owner' ? '👑 admin' : 'menejer'} ${m.mention ? '🔔' : '🔕'} ${m.dm ? '✉️' : '—'}`;
  s += `\n\n⏰ Uchrashuv eslatmasi: <b>${lead} daqiqa oldin</b>\n🤝 Akkaunt nomidan yozish: <b>${bc ? 'ulangan' : 'ulanmagan'}</b>`;
  return s;
}
async function panelKb(env) {
  const team = (await env.DB.prepare('SELECT t.*, u.name FROM team t LEFT JOIN users u ON u.id=t.id ORDER BY u.name').all()).results;
  const rows = team.map(m => [{ text: (m.name || String(m.id)).slice(0, 16), callback_data: `pu:${m.id}` }, { text: m.mention ? '🔔' : '🔕', callback_data: `pm:${m.id}` }, { text: m.dm ? '✉️' : '—', callback_data: `pd:${m.id}` }, { text: m.role === 'manager' ? 'menejer' : '👑', callback_data: `pr:${m.id}` }, { text: '🗑', callback_data: `px:${m.id}` }]);
  rows.push([{ text: '⏰ Eslatma: 15 / 30 / 60 daq', callback_data: 'pt:0' }]);
  rows.push([{ text: '📝 Xabar shablonlari', callback_data: 'pl:0' }, { text: '🤝 Akkauntni ulash', callback_data: 'pb:0' }]);
  rows.push([{ text: '📊 Statistika', callback_data: 'ps:0' }, { text: '🔄 Yangilash', callback_data: 'pp:0' }]);
  return rows;
}
const addKb = { keyboard: [[{ text: '➕ Xodim qo\'shish', request_users: { request_id: 1, user_is_bot: false, max_quantity: 10, request_name: true, request_username: true } }], [{ text: '⚙️ Panel' }]], resize_keyboard: true };
async function showPanel(env, chat, edit) {
  const body = { chat_id: chat, text: await panelText(env), parse_mode: 'HTML', reply_markup: { inline_keyboard: await panelKb(env) } };
  if (edit) return tg(env, 'editMessageText', { ...body, message_id: edit });
  return tg(env, 'sendMessage', body);
}
async function panelCb(env, q, act, sid, rest, ans) {
  const uid = q.from.id; if (!(await isAdmin(env, uid))) return ans('Faqat admin uchun', true);
  const id = +sid, edit = q.message.message_id, chat = q.message.chat.id;
  const tog = async col => { await env.DB.prepare(`UPDATE team SET ${col}=1-${col} WHERE id=?`).bind(id).run(); await showPanel(env, chat, edit); };
  switch (act) {
    case 'pm': await tog('mention'); return ans('Guruhda belgilash o\'zgardi');
    case 'pd': await tog('dm'); return ans('Shaxsiy xabar o\'zgardi');
    case 'pr': { const m = await member(env, id); if (m.role === 'owner') return ans('Egasi o\'zgarmaydi', true); await env.DB.prepare('UPDATE team SET role=? WHERE id=?').bind(m.role === 'admin' ? 'manager' : 'admin', id).run(); await showPanel(env, chat, edit); return ans('Rol o\'zgardi'); }
    case 'px': { const m = await member(env, id); if (m?.role === 'owner') return ans('Egasini o\'chirib bo\'lmaydi', true); await env.DB.prepare('DELETE FROM team WHERE id=?').bind(id).run(); await showPanel(env, chat, edit); return ans('Jamoadan chiqarildi'); }
    case 'pu': return ans((await userName(env, id)) + ` · ID ${id}`, true);
    case 'pt': { const v = { '15': '30', '30': '60', '60': '15' }[await setting(env, 'remind', '30')]; await kset(env, 'set:remind', v); await showPanel(env, chat, edit); return ans(`Eslatma ${v} daqiqa oldin`); }
    case 'pp': await showPanel(env, chat, edit); return ans('Yangilandi');
    case 'ps': await dm(env, chat, await stats(env, 30)); return ans('');
    case 'pl': {
      let s = '📝 <b>Mijozga xabar shablonlari</b>\nO\'zgaruvchilar: {ism} {kompaniya} {sana} {soat}\n';
      for (const k of Object.keys(TPL_DEFAULT)) s += `\n<b>${TPL_NAME[k]}</b>\n<i>${esc(await tpl(env, k))}</i>\n`;
      await dm(env, chat, s, { reply_markup: { inline_keyboard: Object.keys(TPL_DEFAULT).map(k => [{ text: '✏️ ' + TPL_NAME[k], callback_data: `pe:${k}` }]) } }); return ans('');
    }
    case 'pe': await env.DB.prepare('INSERT INTO pending(uid,lead_id,kind,at) VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET lead_id=excluded.lead_id, kind=excluded.kind, at=excluded.at').bind(uid, 0, 'tpl:' + sid, now()).run();
      await dm(env, chat, `✏️ <b>${TPL_NAME[sid]}</b> uchun yangi matnni yozing (javob qilib).`, { reply_markup: { force_reply: true } }); return ans('');
    case 'pb': await dm(env, chat, '🤝 <b>Akkaunt nomidan mijozlarga yozish</b>\n\nBu Telegram Business orqali ishlaydi (Telegram Premium kerak):\n1. Telegram → Sozlamalar → Telegram Business → <b>Chatbotlar</b>\n2. <code>@' + esc(await kget(env, 'botname') || 'avvall_lead_bot') + '</code> ni kiriting\n3. "Xabarlarga javob berish" huquqini yoqing\n\nCheklov: Telegram qoidasiga ko\'ra bot sizning nomingizdan faqat oxirgi 24 soatda sizga yozgan mijozga yoza oladi. Boshqa holatlarda xabar bot nomidan ketadi yoki mas\'ulga tayyor matn bilan eslatiladi.'); return ans('');
  }
  return ans('');
}

// ---------- xabarlar ----------
async function onMessage(env, m) {
  await saveUser(env, m.from);
  const text = (m.text || '').trim(), cmd = text.split(/[\s@]/)[0];
  const { g } = await conf(env); const priv = m.chat.type === 'private';
  // Birinchi foydalanuvchi = egasi
  if ((await env.DB.prepare('SELECT COUNT(*) c FROM team').first()).c === 0 && (cmd === '/start' || cmd === '/setup' || cmd === '/panel')) {
    await env.DB.prepare('INSERT INTO team(id,role) VALUES(?,\'owner\')').bind(m.from.id).run();
  }
  // Mijoz botni saytdagi tugma orqali ochdi: /start l123
  if (priv && cmd === '/start' && /^\/start c[0-9a-f]{24}$/.test(text)) {
    const L = await env.DB.prepare('SELECT * FROM leads WHERE claim=?').bind(text.split(' ')[1].slice(1)).first(); const id = L?.id;
    if (L && !L.client_chat) {
      await env.DB.prepare('UPDATE leads SET client_chat=?, client_last=?, tg_user=?, claim=NULL WHERE id=?').bind(m.chat.id, now(), m.from.username || null, id).run();
      await placeCard(env, await getLead(env, id));
      return tg(env, 'sendMessage', { chat_id: m.chat.id, text: `Rahmat, ${L.name}! So'rovingiz AVVALL jamoasiga yetib bordi. Uchrashuv vaqti va yangiliklarni shu yerga yuboramiz.` });
    }
  }
  // Mijoz botga yozsa — guruhga ko'chiriladi
  if (priv && !text.startsWith('/') && !(await isTeam(env, m.from.id))) {
    const L = await env.DB.prepare('SELECT * FROM leads WHERE client_chat=? ORDER BY id DESC').bind(m.chat.id).first();
    if (L) { await env.DB.prepare('UPDATE leads SET client_last=? WHERE id=?').bind(now(), L.id).run(); await post(env, TOPIC_OF[L.status] || 'new', `💬 <b>${num(L.id)} ${esc(L.name)}</b> yozdi:\n${esc(text)}`); return; }
  }
  if (priv && (cmd === '/start' || cmd === '/panel' || text === '⚙️ Panel')) {
    if (!(await isAdmin(env, m.from.id))) return dm(env, m.chat.id, 'Salom! Men AVVALL lid botiman. Panel faqat adminlar uchun.');
    await dm(env, m.chat.id, 'Pastdagi <b>➕ Xodim qo\'shish</b> tugmasi orqali jamoa a\'zolarini tanlang.', { reply_markup: addKb });
    return showPanel(env, m.chat.id);
  }
  if (priv && m.users_shared && (await isAdmin(env, m.from.id))) {
    for (const u of m.users_shared.users) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.user_id);
      await env.DB.prepare('INSERT INTO users(id,name,username) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(u.user_id, name, u.username || null).run();
      await env.DB.prepare('INSERT INTO team(id,role) VALUES(?,\'manager\') ON CONFLICT(id) DO NOTHING').bind(u.user_id).run();
    }
    await dm(env, m.chat.id, `✅ ${m.users_shared.users.length} ta xodim qo'shildi. Ular shaxsiy eslatma olishi uchun botga /start yozishi kerak, guruhga ham qo'shib qo'ying.`);
    return showPanel(env, m.chat.id);
  }
  if (cmd === '/setup' && ['group', 'supergroup'].includes(m.chat.type)) {
    if (g && g !== m.chat.id) return tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Bot boshqa guruhga ulangan.' });
    const mem = await tg(env, 'getChatMember', { chat_id: m.chat.id, user_id: m.from.id });
    if (!['creator', 'administrator'].includes(mem.result?.status)) return;
    if (!m.chat.is_forum) return tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Guruh sozlamalarida "Mavzular" (Topics) ni yoqing, keyin /setup ni qayta yozing.' });
    await kset(env, 'group', m.chat.id);
    const t = J(await kget(env, 'topics2'), {});
    for (const [k, name, color] of TOPICS) {
      if (t[k]) continue;
      const r = await tg(env, 'createForumTopic', { chat_id: m.chat.id, name, icon_color: color });
      if (r.ok) t[k] = r.result.message_thread_id; else return tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Bo\'lim ochib bo\'lmadi: ' + (r.description || '') });
    }
    await kset(env, 'topics2', JSON.stringify(t));
    const guide = {
      new: '🆕 Saytdan kelgan yangi so\'rovlar. Kartadagi tugmalar bilan ishlang — karta o\'zi kerakli bo\'limga ko\'chadi.',
      meet: '📅 Vaqti belgilangan uchrashuvlar. Uchrashuvdan oldin ⏰ Eslatmalar bo\'limiga xabar keladi.',
      follow: '💬 Javob bermagan yoki "keyinroq" degan mijozlar. Belgilangan kuni qayta eslatiladi.',
      won: '🏁 Bitim yopilgan mijozlar.', lost: '❌ Bekor qilinganlar (sababi bilan). ↩️ bilan qayta ochish mumkin.',
      rem: '⏰ Uchrashuv, qayta qo\'ng\'iroq va mijozga xabar eslatmalari.', rep: '📊 Har kuni 09:00 da hisobot. /stats — 30 kunlik statistika, /bugun — bugungi uchrashuvlar.'
    };
    for (const [k] of TOPICS) await post(env, k, guide[k]);
    return tg(env, 'sendMessage', { chat_id: m.chat.id, text: '✅ Guruh sozlandi: 7 ta bo\'lim ochildi. Admin panel: botga shaxsiy chatda /panel yozing.' });
  }
  // javob kutilayotgan matnlar (izoh, mijozga o'z matn, shablon)
  if (m.reply_to_message && text && !text.startsWith('/')) {
    const p = await env.DB.prepare('SELECT * FROM pending WHERE uid=?').bind(m.from.id).first();
    if (p && now() - p.at < 3600) {
      await env.DB.prepare('DELETE FROM pending WHERE uid=?').bind(m.from.id).run();
      if (p.kind === 'note') {
        const L = await getLead(env, p.lead_id); const notes = J(L.notes, []); notes.push({ by: m.from.first_name, t: text.slice(0, 300), at: now() });
        await env.DB.prepare('UPDATE leads SET notes=? WHERE id=?').bind(JSON.stringify(notes), L.id).run();
        await placeCard(env, await getLead(env, L.id));
      } else if (p.kind === 'cmsg') {
        const L = await getLead(env, p.lead_id);
        await kset(env, 'draft:' + m.from.id, JSON.stringify({ lead: L.id, text: text.slice(0, 3000) }));
        await tg(env, 'sendMessage', { chat_id: m.chat.id, message_thread_id: m.message_thread_id, text: `✉️ ${num(L.id)} ${esc(L.name)}ga qachon yuborilsin?`, parse_mode: 'HTML', reply_markup: { inline_keyboard: sendWhenKb(L) } });
      } else if (p.kind.startsWith('tpl:') && (await isAdmin(env, m.from.id))) {
        await kset(env, 'tpl:' + p.kind.slice(4), text.slice(0, 2000)); await dm(env, m.chat.id, '✅ Shablon saqlandi.');
      }
      try { await tg(env, 'deleteMessage', { chat_id: m.chat.id, message_id: m.reply_to_message.message_id }); } catch { }
      return tg(env, 'setMessageReaction', { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] });
    }
  }
  if (!priv && (!g || m.chat.id !== g)) return;
  if (['/stats', '/bugun', '/test'].includes(cmd) && !(await isTeam(env, m.from.id))) return priv ? dm(env, m.chat.id, 'Bu buyruq faqat AVVALL jamoasi uchun.') : undefined;
  const reply = async s => tg(env, 'sendMessage', { chat_id: m.chat.id, message_thread_id: m.message_thread_id, text: s, parse_mode: 'HTML' });
  if (cmd === '/stats') return reply(await stats(env, 30));
  if (cmd === '/bugun') return reply(await today(env));
  if (cmd === '/panel' && !priv) return reply(`⚙️ Panel shaxsiy chatda ochiladi: @${await kget(env, 'botname')} ga /panel yozing.`);
  if (cmd === '/test') await newLead(new Request('https://x/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ism: 'Sinov Mijoz', telefon: '+998 90 000 00 00', kompaniya: 'Test Qurilish', loyiha: '12 qavatli bino, 2027', source: 'sinov' }) }), env);
}
async function onBusiness(env, u) {
  if (u.business_connection) {
    const c = u.business_connection;
    if (c.is_enabled && c.rights?.can_reply !== false) { await kset(env, 'business', c.id); await dm(env, c.user.id, '🤝 Akkauntingiz ulandi. Endi bot oxirgi 24 soatda sizga yozgan mijozlarga sizning nomingizdan xabar yubora oladi.'); }
    else await kset(env, 'business', '');
  }
  if (u.business_message) { // mijoz admin akkauntiga yozdi — 24 soat oynasini yangilash
    const m = u.business_message; if (m.from?.id === m.chat.id) {
      const user = m.from.username;
      if (user) await env.DB.prepare('UPDATE leads SET client_chat=?, client_last=? WHERE tg_user=? OR client_chat=?').bind(m.chat.id, now(), user, m.chat.id).run();
      else await env.DB.prepare('UPDATE leads SET client_last=? WHERE client_chat=?').bind(now(), m.chat.id).run();
    }
  }
}
async function stats(env, days) {
  const since = now() - days * 86400;
  const rows = (await env.DB.prepare('SELECT status, COUNT(*) c FROM leads WHERE created_at>? GROUP BY status').bind(since).all()).results;
  const c = Object.fromEntries(rows.map(r => [r.status, r.c])); const all = rows.reduce((s, r) => s + r.c, 0);
  const won = c.done || 0;
  const top = (await env.DB.prepare('SELECT closed_by, COUNT(*) c FROM leads WHERE created_at>? AND status IN (\'ok\',\'done\') AND closed_by IS NOT NULL GROUP BY closed_by ORDER BY c DESC LIMIT 5').bind(since).all()).results;
  let s = `📊 <b>Oxirgi ${days} kun</b>\n\nJami lid: <b>${all}</b>\n🆕 Yangi: ${c.new || 0}\n💬 Qayta suhbat: ${(c.na || 0) + (c.fu || 0)}\n📅 Uchrashuv belgilangan: ${c.ok || 0}\n🏁 Bitim: ${won}\n❌ Bekor: ${c.no || 0}\n\nKonversiya (lid → bitim): <b>${all ? Math.round(won / all * 100) : 0}%</b>`;
  if (top.length) { s += '\n\n🏆 Eng faollar:'; for (const t of top) s += `\n• ${esc(await userName(env, t.closed_by))} — ${t.c}`; }
  return s;
}
async function today(env) {
  const d = loc(now()), start = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000) - TZ;
  const r = (await env.DB.prepare('SELECT * FROM leads WHERE status=\'ok\' AND meeting_at BETWEEN ? AND ? ORDER BY meeting_at').bind(start, start + 86400).all()).results;
  if (!r.length) return '📅 Bugun uchrashuv yo\'q.';
  let s = `📅 <b>Bugungi uchrashuvlar (${r.length})</b>`;
  for (const L of r) s += `\n\n${fmtT(L.meeting_at)} · <b>${num(L.id)} ${esc(L.name)}</b>${L.company ? ' · ' + esc(L.company) : ''}\n👥 ${await mentions(env, J(L.assignees, []))}`;
  return s;
}

// ---------- har daqiqa ----------
async function tick(env) {
  const { g } = await conf(env); if (!g) return; const t = now();
  const lead = +(await setting(env, 'remind', '30')) * 60;
  const due = (await env.DB.prepare('SELECT * FROM leads WHERE status=\'ok\' AND reminded=0 AND meeting_at<=? AND meeting_at>?').bind(t + lead, t - 600).all()).results;
  for (const L of due) { await notify(env, L, `⏰ <b>${Math.max(0, Math.round((L.meeting_at - t) / 60))} daqiqadan keyin uchrashuv</b>`, `📅 ${fmt(L.meeting_at)}`); await env.DB.prepare('UPDATE leads SET reminded=1 WHERE id=?').bind(L.id).run(); }
  const fu = (await env.DB.prepare('SELECT * FROM leads WHERE status IN (\'na\',\'fu\') AND followup_at IS NOT NULL AND followup_at<=?').bind(t).all()).results;
  for (const L of fu) { await notify(env, L, '📞 <b>Qayta bog\'lanish vaqti</b>', ''); await env.DB.prepare('UPDATE leads SET followup_at=NULL WHERE id=?').bind(L.id).run(); }
  const ob = (await env.DB.prepare('SELECT * FROM outbox WHERE status=\'wait\' AND send_at<=?').bind(t).all()).results;
  for (const o of ob) await deliverOutbox(env, o);
  const d = loc(t), day = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  if (d.getUTCHours() === 9 && (await kget(env, 'report')) !== day) { await kset(env, 'report', day); await post(env, 'rep', (await stats(env, 1)).replace('Oxirgi 1 kun', 'Oxirgi 24 soat') + '\n\n' + await today(env)); }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url); await schema(env);
    const origin = req.headers.get('origin') || '';
    const okOrigin = ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin);
    const cors = { 'access-control-allow-origin': okOrigin ? origin : 'https://avvall.uz', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname === '/lead' && req.method === 'POST') { if (origin && !okOrigin) return json({ ok: false, err: 'origin' }, 403, cors); return json(await newLead(req, env), 200, cors); }
    if (url.pathname === '/tg' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== await secretOf(env)) return new Response('no', { status: 403 });
      const u = await req.json();
      try { if (u.callback_query) await onCallback(env, u.callback_query); else if (u.message) await onMessage(env, u.message); else if (u.business_connection || u.business_message) await onBusiness(env, u); } catch (e) { console.log('err', e.stack); }
      return new Response('ok');
    }
    if (url.pathname === '/init') {
      if ((await kget(env, 'botname')) && (!env.INIT_KEY || url.searchParams.get('k') !== env.INIT_KEY)) return new Response('no', { status: 403 });
      const r = await tg(env, 'setWebhook', { url: `${url.origin}/tg`, secret_token: await secretOf(env), allowed_updates: ['message', 'callback_query', 'business_connection', 'business_message'] });
      await tg(env, 'setMyCommands', { commands: [{ command: 'panel', description: 'Admin panel' }, { command: 'stats', description: 'Statistika (30 kun)' }, { command: 'bugun', description: 'Bugungi uchrashuvlar' }, { command: 'test', description: 'Sinov lidi' }, { command: 'setup', description: 'Guruhni sozlash' }] });
      const me = await tg(env, 'getMe', {}); if (me.ok) await kset(env, 'botname', me.result.username);
      return json({ webhook: r.ok, err: r.description, bot: me.result?.username, group: (await conf(env)).g });
    }
    return new Response('AVVALL bot ishlayapti');
  },
  async scheduled(ev, env, ctx) { await schema(env); ctx.waitUntil(tick(env)); },
};
