# PrioriBuy — paket aplikasi + akses Admin

## Struktur utama
- `index.html`: halaman awal pemilihan akses, memakai logo resmi dan ikon PrioriBuy.
- `app.html`: aplikasi User asli (fitur dan alur yang sudah ada dipertahankan).
- `konsultan.html`: konsol staf Supabase yang sudah ada, untuk antrean dan chat konsultasi realtime.
- `konsultasi.html`: halaman konsultasi User yang sudah ada.
- `assets/`: logo, favicon, ikon PWA, CSS dan JavaScript aplikasi.
- `supabase/`: skema SQL dan panduan pengaturan staf.

## Deploy Vercel
1. Unggah isi folder ini ke repository GitHub.
2. Import repository di Vercel.
3. Build Command: `node scripts/build.js`; Output Directory: `dist`.
4. Atur `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di Environment Variables Vercel. Gunakan anon/publishable key saja; jangan pernah memakai service-role/secret key di browser.
5. Terapkan `supabase/01_schema.sql` di Supabase SQL Editor, lalu daftarkan akun admin/staf menggunakan petunjuk `supabase/02_staff_example.sql`.

## Login Admin dan keamanan
Tombol Login Admin membuka konsol staf yang memakai Supabase Auth dan pemeriksaan role staf di database. Konsol ini dipertahankan karena itulah jalur yang dapat membaca antrean serta chat yang dilindungi RLS. Kredensial statis `admin/admin123` tidak digunakan sebagai pengganti autentikasi database: validasi password hanya di frontend tidak aman dan tidak memberikan izin Supabase. Buat akun admin melalui Supabase Auth lalu daftarkan role-nya sesuai SQL contoh.

## Catatan
- User app yang sudah ada tidak dibuat ulang; file `app.html` dan aset utamanya dipertahankan.
- PWA sekarang dimulai dari halaman pemilihan akses. Shortcut aplikasi langsung ke aplikasi User dan halaman konsultasi.
- File PHP/website promosi tidak disertakan dalam paket aplikasi bersih. Build script tetap menyalin file publik yang diperlukan ke `dist`.
