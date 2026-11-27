// siyovush.avvall.uz — Siyovush House showroom (demo).
// Statik fayllar avvall.uz/siyovush/ (GitHub Pages) dan proxy qilinadi.
const ORIGIN = 'https://avvall.uz/siyovush';

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    let path = url.pathname;
    if (path.endsWith('/')) path += 'index.html';
    const up = await fetch(ORIGIN + path, { method: req.method, cf: { cacheTtl: 60, cacheEverything: true } });
    const h = new Headers(up.headers);
    h.set('x-robots-tag', 'noindex, nofollow');
    h.set('x-content-type-options', 'nosniff');
    h.set('referrer-policy', 'strict-origin-when-cross-origin');
    h.delete('link');
    const dynamic = /\.(html|json)$/.test(path);
    h.set('cache-control', dynamic ? 'no-cache' : 'public, max-age=86400');
    return new Response(up.body, { status: up.status, headers: h });
  }
};
