// AVVALL dev sayt: GitHub'dagi `dev` branchni ko'rsatadi (avvall-site repo).
const REPO = 'https://raw.githubusercontent.com/behruzbework-oss/avvall-site/dev';
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon', json: 'application/json', woff2: 'font/woff2', mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain; charset=utf-8' };
export default {
  async fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const url = new URL(req.url);
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { return new Response('Not found', { status: 404 }); }
    if (p.endsWith('/')) p += 'index.html';
    if (p.includes('..') || p.includes('\\') || /^\/(bot|\.)/.test(p)) return new Response('Not found', { status: 404 });
    const ext = (p.split('.').pop() || '').toLowerCase();
    if (!TYPES[ext]) return new Response('Not found', { status: 404 });
    const r = await fetch(REPO + p.split('/').map(encodeURIComponent).join('/'), { cf: { cacheTtl: 30, cacheEverything: true } });
    if (!r.ok) return new Response('Not found', { status: 404 });
    return new Response(r.body, { headers: {
      'content-type': TYPES[ext],
      'cache-control': ext === 'html' ? 'no-cache' : 'public, max-age=300',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'SAMEORIGIN',
      'strict-transport-security': 'max-age=31536000'
    } });
  }
};
