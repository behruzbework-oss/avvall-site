// demo.avvall.uz → avvall.uz/zumrad/ (GitHub Pages). Root-relative yo'llar (/360/, /floor/...) shu orqali ishlaydi.
const ORIGIN = 'https://avvall.uz/zumrad';
export default {
  async fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const url = new URL(req.url);
    if (url.pathname.includes('..')) return new Response('Not found', { status: 404 });
    const r = await fetch(ORIGIN + url.pathname + url.search, { method: req.method, redirect: 'manual', cf: { cacheTtl: 600, cacheEverything: true } });
    if (r.status >= 300 && r.status < 400) {
      const loc = new URL(r.headers.get('location'), ORIGIN + url.pathname);
      const path = loc.pathname.replace(/^\/zumrad/, '') || '/';
      return Response.redirect(url.origin + path + loc.search, r.status);
    }
    const h = new Headers(r.headers);
    h.set('x-content-type-options', 'nosniff'); h.set('referrer-policy', 'strict-origin-when-cross-origin');
    h.set('strict-transport-security', 'max-age=31536000');
    return new Response(r.body, { status: r.status, headers: h });
  }
};
