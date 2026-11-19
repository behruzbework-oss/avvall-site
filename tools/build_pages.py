#!/usr/bin/env python3
"""AVVALL: xizmat, keys va maqola sahifalarini pages_content.py dan yasaydi (uz / ru / en).
build_i18n.py ichidan chaqiriladi; qaytaradi: sitemap uchun [(yo'l, {til: url})]."""
import os, json, html, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pages_content import UI, PAGES, ALT

SITE = 'https://avvall.uz'
PFX = {'uz': '', 'ru': '/ru', 'en': '/en'}
LOC = {'uz': 'uz_UZ', 'ru': 'ru_RU', 'en': 'en_US'}
BY_KEY = {p['key']: p for p in PAGES}
e = lambda s: html.escape(s, quote=True)

def path(l, slug): return f"{PFX[l]}/{slug}"
def url(l, slug): return SITE + path(l, slug)

CSS = """
:root{--graphite:#16181B;--paper:#F4F4F2;--signal:#E0402A;--signal-strong:#C93A24;--smoke:#8E9196;--ink:#4A4E54;
--pad:clamp(20px,5.6vw,80px);--display:'Unbounded',system-ui,sans-serif;--body:'Manrope',system-ui,sans-serif}
*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--graphite);font:400 18px/1.65 var(--body);-webkit-font-smoothing:antialiased}
img{display:block;max-width:100%;height:auto}a{color:inherit}
:focus-visible{outline:2px solid var(--signal);outline-offset:3px}
.skip{position:absolute;left:-9999px;top:8px;background:var(--paper);color:var(--graphite);padding:10px 16px;z-index:9}.skip:focus{left:8px}
.wrap{max-width:calc(1120px + 2*var(--pad));margin:0 auto;padding:0 var(--pad)}
.top{background:var(--graphite);color:var(--paper)}
.nav{display:flex;align-items:center;gap:28px;min-height:76px}
.nav .logo{margin-right:auto}.nav-links{display:flex;gap:24px;list-style:none;margin:0;padding:0;font-size:15px}
.nav-links a,.lang a{text-decoration:none;opacity:.8}.nav-links a:hover,.lang a:hover{opacity:1}
.lang{display:flex;gap:4px;font:600 14px/1 var(--body)}.lang a{padding:14px 6px;opacity:.5}.lang a[aria-current]{opacity:1;box-shadow:inset 0 -1px var(--signal)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 26px;border-radius:2px;font:600 16px/1 var(--body);text-decoration:none;border:1px solid transparent}
.btn-primary{background:var(--signal-strong);color:var(--paper)}.btn-primary:hover{background:#B53320}
.btn-ghost{border-color:rgba(244,244,242,.35);color:var(--paper)}.btn-ghost:hover{border-color:var(--paper)}
.crumbs{font-size:14px;color:var(--smoke);padding-top:28px}.crumbs ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.crumbs li+li::before{content:"/";margin-right:8px;opacity:.6}.crumbs a{text-decoration:none}.crumbs a:hover{text-decoration:underline}
.head{padding:28px 0 64px}
h1,h2,h3{font-family:var(--display);font-weight:300;letter-spacing:-.02em;line-height:1.15;margin:0}
h1{font-size:clamp(32px,4.4vw,58px);max-width:18ch}
.lead{color:#C9CBCE;font-size:clamp(18px,1.6vw,21px);max-width:60ch;margin:24px 0 0}
.meta{color:var(--smoke);font-size:14px;margin-top:20px}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}
.hero-img{margin:0;background:var(--graphite)}.hero-img img{width:100%;max-height:72vh;object-fit:cover}
article{padding:72px 0 24px}.prose{max-width:720px}
.prose h2{font-size:clamp(24px,2.4vw,32px);margin:56px 0 18px}.prose h2:first-child{margin-top:0}
.prose p{margin:0 0 18px}.prose ul,.prose ol{margin:0 0 18px;padding-left:22px}.prose li{margin:0 0 10px}.prose li::marker{color:var(--signal-strong)}
.prose figure{margin:40px 0}
.faq{max-width:720px;padding:24px 0 40px}.faq h2{font-size:clamp(24px,2.4vw,32px);margin:0 0 20px}
.faq details{border-top:1px solid rgba(22,24,27,.16);padding:18px 0}.faq details:last-child{border-bottom:1px solid rgba(22,24,27,.16)}
.faq summary{cursor:pointer;font-weight:600}.faq p{margin:12px 0 0;color:var(--ink)}
.cta{background:var(--graphite);color:var(--paper);padding:72px 0;margin:48px 0 0}
.cta h2{font-size:clamp(28px,3vw,42px)}.cta p{color:#C9CBCE;margin:16px 0 0;max-width:52ch}
.cta .contacts{display:flex;flex-wrap:wrap;gap:20px;margin-top:28px;font-style:normal}.cta .contacts a{text-decoration:none;border-bottom:1px solid rgba(244,244,242,.3)}
.related{padding:64px 0}.related h2{font-size:22px;margin:0 0 20px}
.related ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.related a{display:block;height:100%;padding:22px;border:1px solid rgba(22,24,27,.16);text-decoration:none}.related a:hover{border-color:var(--graphite)}
.related b{display:block;font-weight:600;margin-bottom:6px}.related span{color:var(--ink);font-size:15px}
footer{background:var(--graphite);color:var(--smoke);font-size:15px;padding:48px 0}
footer .cols{display:flex;flex-wrap:wrap;gap:40px;justify-content:space-between}
footer ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}footer a{text-decoration:none}footer a:hover{color:var(--paper)}
@media (max-width:900px){.nav-links{display:none}.nav{gap:12px}.nav .btn{min-height:44px;padding:0 16px;font-size:14px}}
@media (max-width:520px){.nav .btn{display:none}}
"""

def head(l, p, d):
    alts = ''.join(f'<link rel="alternate" hreflang="{x}" href="{url(x, p["slug"])}">\n' for x in PFX) + \
           f'<link rel="alternate" hreflang="x-default" href="{url("uz", p["slug"])}">\n'
    img = SITE + p['img'].replace('.webp', '.webp')
    return f"""<!DOCTYPE html>
<html lang="{l}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; base-uri 'none'; object-src 'none'; form-action 'none'; upgrade-insecure-requests">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(d['title'])}</title>
<meta name="description" content="{e(d['desc'])}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="{url(l, p['slug'])}">
{alts}<meta property="og:type" content="{'article' if p['type'] == 'article' else 'website'}">
<meta property="og:site_name" content="AVVALL">
<meta property="og:url" content="{url(l, p['slug'])}">
<meta property="og:locale" content="{LOC[l]}">
<meta property="og:title" content="{e(d['title'])}">
<meta property="og:description" content="{e(d['desc'])}">
<meta property="og:image" content="{SITE}/img/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#16181B">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="preload" href="/fonts/unbounded-latin-Yq6W-LOTXC.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/fonts.css">
<style>{CSS}</style>
<script type="application/ld+json">{jsonld(l, p, d)}</script>
</head>
"""

def jsonld(l, p, d):
    u = UI[l]; me = url(l, p['slug'])
    crumbs = [(u['home'], SITE + PFX[l] + '/'), (d['h1'], me)]
    bl = {'@type': 'BreadcrumbList', 'itemListElement': [
        dict({'@type': 'ListItem', 'position': i + 1, 'name': n}, **({'item': h} if h else {})) for i, (n, h) in enumerate(crumbs)]}
    graph = [bl]
    if p['type'] == 'service':
        graph.append({'@type': 'Service', '@id': me + '#service', 'name': d['h1'], 'description': d['desc'], 'url': me,
                      'serviceType': u[p['key']], 'image': SITE + p['img'], 'inLanguage': l,
                      'provider': {'@id': SITE + '/#org', '@type': 'ProfessionalService', 'name': 'AVVALL', 'url': SITE + '/', 'telephone': '+998948651145'},
                      'areaServed': {'@type': 'Country', 'name': 'Uzbekistan'}})
    else:
        graph.append({'@type': 'Article' if p['type'] == 'article' else 'CreativeWork', '@id': me + '#main',
                      'headline': d['h1'], 'description': d['desc'], 'url': me, 'image': SITE + p['img'], 'inLanguage': l,
                      'datePublished': '2026-11-19', 'dateModified': '2026-11-19',
                      'author': {'@type': 'Organization', 'name': 'AVVALL', 'url': SITE + '/'},
                      'publisher': {'@id': SITE + '/#org', '@type': 'Organization', 'name': 'AVVALL',
                                    'logo': {'@type': 'ImageObject', 'url': SITE + '/img/apple-touch-icon.png'}}})
    if d.get('faq'):
        graph.append({'@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in d['faq']]})
    return json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False).replace('</', '<\\/')

def header(l, p):
    u = UI[l]; home = PFX[l] + '/'
    langs = ''.join(f'<a href="{path(x, p["slug"])}" hreflang="{x}" lang="{x}"{" aria-current=\"page\"" if x == l else ""}>{x.upper()}</a>' for x in PFX)
    links = ''.join(f'<li><a href="{path(l, BY_KEY[k]["slug"])}"{" aria-current=\"page\"" if k == p["key"] else ""}>{e(u[k])}</a></li>' for k in ('showroom', 'viz', 'tour', 'case'))
    return f"""<body>
<a class="skip" href="#asosiy">{e(u['skip'])}</a>
<header class="top"><div class="wrap nav">
<a class="logo" href="{home}" aria-label="AVVALL"><img src="/img/logo.svg" alt="AVVALL" width="140" height="27"></a>
<ul class="nav-links">{links}</ul>
<nav class="lang" aria-label="{e(u['lang'])}">{langs}</nav>
<a class="btn btn-ghost" href="{home}#aloqa">{e(u['contact'])}</a>
</div></header>
"""

def block(l, b):
    t = b[0]
    if t == 'h2': return f'<h2>{e(b[1])}</h2>'
    if t == 'p': return f'<p>{e(b[1])}</p>'
    if t in ('ul', 'ol'): return f'<{t}>' + ''.join(f'<li>{e(x)}</li>' for x in b[1]) + f'</{t}>'
    if t == 'img': return f'<figure><img src="{b[1]}" alt="{e(ALT[l][b[2]])}" loading="lazy" width="1280" height="720"></figure>'
    return ''

def page(l, p):
    d = p[l]; u = UI[l]; home = PFX[l] + '/'
    mid = ''
    crumbs = f'<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="{home}">{e(u["home"])}</a></li>{mid}<li aria-current="page">{e(d["h1"])}</li></ol></nav>'
    meta = f'<p class="meta">{e(u["by"])} · {e(u["date"])}</p>' if p['type'] == 'article' else ''
    body = []; cta_done = False
    for b in d['body']:
        if b[0] == 'cta': cta_done = True; continue
        body.append(block(l, b))
    faq = ''
    if d.get('faq'):
        faq = f'<section class="faq" aria-labelledby="faq-t"><h2 id="faq-t">{e(u["faq"])}</h2>' + ''.join(
            f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in d['faq']) + '</section>'
    rel = ''.join(f'<li><a href="{path(l, BY_KEY[k]["slug"])}"><b>{e(BY_KEY[k][l]["h1"])}</b><span>{e(BY_KEY[k][l]["desc"][:110].rsplit(" ", 1)[0])}…</span></a></li>' for k in p['related'])
    foot_links = ''.join(f'<li><a href="{path(l, q["slug"])}">{e(q[l]["h1"] if q["type"] == "article" else u[q["key"]])}</a></li>' for q in PAGES)
    return head(l, p, d) + header(l, p) + f"""<main id="asosiy">
<section class="top"><div class="wrap">{crumbs}
<div class="head"><h1>{e(d['h1'])}</h1><p class="lead">{e(d['lead'])}</p>{meta}
<div class="actions"><a class="btn btn-primary" href="{home}#aloqa">{e(u['cta_btn'])}</a><a class="btn btn-ghost" href="https://demo.avvall.uz" target="_blank" rel="noopener">{e(u['demo'])}</a></div></div>
</div>
<figure class="hero-img"><img src="{p['img']}" alt="{e(d['alt'])}" width="1600" height="900" fetchpriority="high"></figure>
</section>
<article><div class="wrap"><div class="prose">{''.join(body)}</div>{faq}</div></article>
<section class="cta" aria-labelledby="cta-t"><div class="wrap">
<h2 id="cta-t">{e(u['cta_h'])}</h2><p>{e(u['cta_p'])}</p>
<div class="actions"><a class="btn btn-primary" href="{home}#aloqa">{e(u['cta_btn'])}</a></div>
<address class="contacts"><a href="tel:+998948651145">+998 94 865 11 45</a><a href="https://t.me/avvall_support" target="_blank" rel="noopener">Telegram: @avvall_support</a><span>{e(u['city'])}</span></address>
</div></section>
<section class="related" aria-labelledby="rel-t"><div class="wrap"><h2 id="rel-t">{e(u['related'])}</h2><ul>{rel}</ul></div></section>
</main>
<footer><div class="wrap cols">
<div><a href="{home}"><img src="/img/logo.svg" alt="AVVALL" width="126" height="25"></a><p>{e(u['city'])}<br><a href="tel:+998948651145">+998 94 865 11 45</a></p></div>
<ul>{foot_links}</ul>
<ul><li><a href="https://t.me/avvall_support" target="_blank" rel="noopener">Telegram</a></li><li><a href="https://demo.avvall.uz" target="_blank" rel="noopener">demo.avvall.uz</a></li><li>© 2026 AVVALL</li></ul>
</div></footer>
</body>
</html>
"""

def build(root):
    out = []
    for p in PAGES:
        for l in PFX:
            f = os.path.join(root, path(l, p['slug']).lstrip('/'), 'index.html')
            os.makedirs(os.path.dirname(f), exist_ok=True)
            open(f, 'w', encoding='utf-8').write(page(l, p))
        out.append({l: url(l, p['slug']) for l in PFX})
    return out

if __name__ == '__main__':
    print(len(build(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), 'sahifa guruhi')
