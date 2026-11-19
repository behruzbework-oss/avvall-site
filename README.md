# AVVALL sayti

Quruvchilar uchun kinematografik film va interaktiv 3D showroom studiyasi — avvall.uz.

- `index.html` — bitta sahifali sayt (HTML/CSS/JS, kutubxonasiz).
- `img/` — logo, kun vaqti kadrlari (`img/day`), qavat 360° kadrlari (`img/floor`).
- `send.php` — so'rov formasi (PHP hostingda ishlaydi; `leads/` ga yozadi, `$TO` berilsa emailga yuboradi).
- `.htaccess` — HTTPS yo'naltirish va kesh (Apache).

Dev: https://avval-studio.netlify.app · Prod: https://avvall.uz

## Tillar va SEO
`index.html` — asosiy (UZ) manba. Matn yoki tarjima (`#i18n` JSON) o'zgarsa:

    python3 tools/build_i18n.py

Bu `/ru/` va `/en/` sahifalarini, hreflang, JSON-LD, CSP hashlari, `sitemap.xml` va `robots.txt` ni qayta yaratadi.
