#!/usr/bin/env python3
"""AVVALL: index.html (UZ, manba) dan /ru/ va /en/ statik sahifalarini, SEO blokini,
CSP hashlarini, sitemap.xml va robots.txt ni yaratadi.  Ishlatish: python3 tools/build_i18n.py"""
import re, json, hashlib, base64, datetime, os, copy
from bs4 import BeautifulSoup, NavigableString

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://avvall.uz'
LANGS = {'uz': ('/', 'uz_UZ'), 'ru': ('/ru/', 'ru_RU'), 'en': ('/en/', 'en_US')}
SRC = os.path.join(ROOT, 'index.html')
src = open(SRC, encoding='utf-8').read()
D = json.loads(re.search(r'<script type="application/json" id="i18n">(.*?)</script>', src, re.S).group(1))

def uz_dict(html):
    soup = BeautifulSoup(html, 'html.parser'); d = {}
    for el in soup.select('[data-i18n]'):
        if el.has_attr('data-html'): d[el['data-i18n']] = el.decode_contents()
        else:
            t = next((c for c in el.contents if isinstance(c, NavigableString) and c.strip()), None)
            d[el['data-i18n']] = str(t) if t else ''
    for el in soup.select('[data-i18n-alt]'): d[el['data-i18n-alt']] = el['alt']
    for el in soup.select('[data-i18n-aria]'): d[el['data-i18n-aria']] = el['aria-label']
    d.update(D.get('uz', {}))
    return d
DICT = {'uz': uz_dict(src), 'ru': D['ru'], 'en': D['en']}
def T(l, k): return DICT[l].get(k) or DICT['uz'].get(k, '')

def seo_block(l):
    url = SITE + LANGS[l][0]
    lines = ['<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">']
    for x, (p, _) in LANGS.items(): lines.append(f'<link rel="alternate" hreflang="{x}" href="{SITE}{p}">')
    lines.append(f'<link rel="alternate" hreflang="x-default" href="{SITE}/">')
    for x, (_, loc) in LANGS.items():
        if x != l: lines.append(f'<meta property="og:locale:alternate" content="{loc}">')
    strip = lambda h: re.sub(r'<[^>]+>', ' ', h).replace('  ', ' ').strip()
    faq = [{'@type': 'Question', 'name': strip(T(l, f'q{i}')),
            'acceptedAnswer': {'@type': 'Answer', 'text': strip(T(l, f'a{i}'))}} for i in range(1, 9)]
    org = {'@type': 'ProfessionalService', '@id': SITE + '/#org', 'name': 'AVVALL', 'url': SITE + '/',
        'logo': SITE + '/img/apple-touch-icon.png', 'image': SITE + '/img/og.jpg',
        'description': T(l, 'meta.desc'), 'slogan': strip(T(l, 'hero.title')),
        'telephone': '+998948651145',
        'address': {'@type': 'PostalAddress', 'addressLocality': 'Tashkent', 'addressCountry': 'UZ'},
        'areaServed': {'@type': 'Country', 'name': 'Uzbekistan'},
        'knowsLanguage': ['uz', 'ru', 'en'], 'sameAs': ['https://t.me/avvall_support'],
        'contactPoint': {'@type': 'ContactPoint', 'telephone': '+998948651145', 'contactType': 'sales',
                         'areaServed': 'UZ', 'availableLanguage': ['Uzbek', 'Russian', 'English']},
        'hasOfferCatalog': {'@type': 'OfferCatalog', 'name': strip(T(l, 'nav.services')), 'itemListElement': [
            {'@type': 'Offer', 'itemOffered': {'@type': 'Service', 'name': strip(T(l, k + '.h')),
             'description': strip(T(l, k + '.p')), 'provider': {'@id': SITE + '/#org'}}} for k in ('sr', 'film')]}}
    graph = [org,
        {'@type': 'WebSite', '@id': SITE + '/#website', 'url': SITE + '/', 'name': 'AVVALL',
         'inLanguage': list(LANGS), 'publisher': {'@id': SITE + '/#org'}},
        {'@type': 'WebPage', '@id': url + '#webpage', 'url': url, 'name': T(l, 'meta.title'),
         'description': T(l, 'meta.desc'), 'inLanguage': l, 'isPartOf': {'@id': SITE + '/#website'},
         'about': {'@id': SITE + '/#org'}, 'primaryImageOfPage': SITE + '/img/og.jpg'},
        {'@type': 'FAQPage', '@id': url + '#faq', 'inLanguage': l, 'mainEntity': faq}]
    ld = json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False).replace('</', '<\\/')
    lines.append(f'<script type="application/ld+json">{ld}</script>')
    return '<!--seo:start-->\n' + '\n'.join(lines) + '\n<!--seo:end-->'

def fix_csp(html):
    hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(m.encode('utf-8')).digest()).decode() + "'"
              for m in re.findall(r'<script>(.*?)</script>', html, re.S)]
    return re.sub(r"(script-src 'self')( 'sha256-[^']+')*", lambda m: m.group(1) + ' ' + ' '.join(hashes), html, count=1)

def with_seo(html, l):
    return re.sub(r'<!--seo:start-->.*?<!--seo:end-->', lambda m: seo_block(l), html, count=1, flags=re.S)

def esc(v): return v.replace('&', '&amp;').replace('"', '&quot;')

def translate(l):
    url = SITE + LANGS[l][0]
    soup = BeautifulSoup(src, 'html.parser')
    soup.html['lang'] = l
    for el in soup.select('[data-i18n]'):
        k = el['data-i18n']; v = DICT[l].get(k)
        if v is None: continue
        if el.has_attr('data-html'):
            el.clear(); el.append(BeautifulSoup(v, 'html.parser'))
        else:
            t = next((c for c in el.contents if isinstance(c, NavigableString) and c.strip()), None)
            if t is not None: t.replace_with(v)
    for el in soup.select('[data-i18n-ph]'):
        v = DICT[l].get(el['data-i18n-ph'])
        if v: el['placeholder'] = v
    for el in soup.select('[data-i18n-alt]'):
        v = DICT[l].get(el['data-i18n-alt'])
        if v: el['alt'] = v
    for el in soup.select('[data-i18n-aria]'):
        v = DICT[l].get(el['data-i18n-aria'])
        if v: el['aria-label'] = v
    soup.title.string = T(l, 'meta.title')
    for sel, attr, val in [('meta[name=description]', 'content', T(l, 'meta.desc')),
                           ('meta[property="og:title"]', 'content', T(l, 'meta.title')),
                           ('meta[property="og:description"]', 'content', T(l, 'meta.desc')),
                           ('meta[property="og:url"]', 'content', url),
                           ('meta[property="og:locale"]', 'content', LANGS[l][1]),
                           ('meta[property="og:image:alt"]', 'content', T(l, 'og.alt')),
                           ('link[rel=canonical]', 'href', url)]:
        soup.select_one(sel)[attr] = val
    src_in = soup.select_one('input[name=source]')
    if src_in: src_in['value'] = 'avvall.uz · ' + l.upper()
    out = str(soup)
    return with_seo(out, l)

def mark_current(html, l):
    return re.sub(r'(<a href="[^"]*" data-lang="%s"[^>]*?)>' % l, r'\1 class="on" aria-current="page">', html)

# --- UZ (manba) ---
uz = src
for sel, val in [('og:url', SITE + '/'), ('og:locale', 'uz_UZ')]:
    uz = re.sub(r'(<meta property="%s" content=")[^"]*(">)' % sel, lambda m: m.group(1) + val + m.group(2), uz, count=1)
uz = re.sub(r'(<meta property="og:image:alt" content=")[^"]*(">)', lambda m: m.group(1) + esc(T('uz', 'og.alt')) + m.group(2), uz, count=1)
uz = re.sub(r' class="on" aria-current="page"', '', uz)
uz = fix_csp(with_seo(uz, 'uz'))
open(SRC, 'w', encoding='utf-8').write(uz)
src = uz
for l in ('ru', 'en'):
    os.makedirs(os.path.join(ROOT, l), exist_ok=True)
    page = fix_csp(mark_current(translate(l), l))
    open(os.path.join(ROOT, l, 'index.html'), 'w', encoding='utf-8').write(page)

# --- sitemap / robots ---
today = datetime.date.today().isoformat()
alts = ''.join(f'\n    <xhtml:link rel="alternate" hreflang="{x}" href="{SITE}{p}"/>' for x, (p, _) in LANGS.items()) + \
       f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{SITE}/"/>'
urls = ''.join(f'\n  <url>\n    <loc>{SITE}{p}</loc>\n    <lastmod>{today}</lastmod>{alts}\n  </url>' for p, _ in LANGS.values())
open(os.path.join(ROOT, 'sitemap.xml'), 'w').write(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
    'xmlns:xhtml="http://www.w3.org/1999/xhtml">' + urls + '\n</urlset>\n')
open(os.path.join(ROOT, 'robots.txt'), 'w').write(
    'User-agent: *\nAllow: /\nDisallow: /zumrad/\nDisallow: /bot/\nDisallow: /tools/\n\n'
    f'Sitemap: {SITE}/sitemap.xml\n')
print('built:', ', '.join(LANGS))
