# PrioriBuy Smart Spending Planner (PWA)

## File baru
- `app.html` — seluruh aplikasi dalam satu file (HTML + CSS + JS). Bootstrap 5, Bootstrap Icons, dan font Poppins dimuat dari CDN yang sama dengan website.
- `manifest.json`, `sw.js` — agar bisa dipasang dan berjalan offline.
- `assets/img/pwa/` — ikon 192, 512, dan maskable, dibuat dari logo asli.
- `_headers` — header untuk Cloudflare Pages.
- Diubah sedikit: footer semua halaman (tautan "Buka Aplikasi (Web)"), `download.html`, `.htaccess`, `sitemap.xml`.

## Menjalankan lokal
```
python3 -m http.server 8080
```
Buka http://localhost:8080/app.html. Service worker hanya aktif di `https://` atau `localhost`.

## Deployment
**Cloudflare Pages** (sesuai rencana): Create project > Upload / hubungkan repo GitHub, build command kosong, output directory `/`.
PERHATIAN: Pages hanya menyajikan file statis. File `*.php` (pembayaran, konfirmasi, mulai-premium) dan folder `private/` TIDAK berjalan di Pages. Selama alur Premium masih memakai PHP, biarkan website di InfinityFree.
Opsi paling aman: unggah file baru ke InfinityFree bersama website lama (HTTPS harus aktif agar PWA bisa dipasang), atau pasang `app.html` di Cloudflare Pages secara terpisah.

## Batasan
- Akun dan data hanya di `localStorage` browser: tidak ada sinkronisasi antar perangkat, dan data hilang jika data situs dihapus. Gunakan Ekspor JSON sebagai cadangan.
- Login lokal hanya memisahkan data antar akun di satu browser. Ini bukan keamanan server, dan tidak ada fitur lupa kata sandi.
- Pemasangan pertama butuh internet sekali agar Bootstrap/font tersimpan di cache.

---
Pembaruan v2 (Dark Mode, konsultasi Premium, Supabase, Vercel, instalasi Android): lihat **PANDUAN-SUPABASE-VERCEL.md**.
