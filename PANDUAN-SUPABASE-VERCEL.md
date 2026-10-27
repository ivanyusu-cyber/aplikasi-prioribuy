# PrioriBuy — Panduan Supabase, Vercel, dan Instalasi Android

## 1. Kondisi sebelum perubahan (hasil audit)
- Website statis multi-halaman (Bootstrap 5) + alur Premium berbasis **PHP + MySQL (InfinityFree)** dan EmailJS. Pembayaran QRIS diverifikasi manual oleh admin.
- Aplikasi perencana pembelian (`app.html`) memakai akun dan data lokal di `localStorage`. Belum ada backend cloud.
- Belum ada Dark Mode, konsultasi, maupun hak akses Premium di server.
- **PHP tidak berjalan di Vercel.** `mulai-premium.php`, `pembayaran.php`, `konfirmasi.php`, dan folder `private/` hanya hidup di InfinityFree. Di Vercel, tiga URL .php tersebut dialihkan ke `konsultasi.html`, yang kini memuat alur bukti bayar + persetujuan admin berbasis Supabase.

## 2. File baru / diubah
| Area | File |
|---|---|
| Dark Mode | `assets/js/theme.js`, `assets/css/theme.css`, `assets/css/dark.css` (dibuat dari `style.css`), tema di `app.html`; ditautkan ke semua halaman + `private/partials/head.php` |
| Konsultasi | `konsultasi.html` (pengguna), `konsultan.html` (konsultan/admin), `assets/js/pb-supabase.js`, `pb-chat.js`, `konsultasi.js`, `konsultan.js`, `assets/css/konsultasi.css` |
| Backend | `supabase/01_schema.sql`, `02_staff_example.sql`, `03_manual_tests.sql` |
| PWA | `manifest.json`, `sw.js` (v2), `assets/js/pwa.js`, ikon `assets/img/pwa/`, kartu "Pasang di HP Android" di `download.html` |
| Deploy | `vercel.json`, `scripts/build.js`, `package.json`, `.env.example`, `.vercelignore`, `.gitignore`, `_headers` (Cloudflare) |
| Diubah sedikit | footer semua halaman, `premium.html` (tombol ke konsultasi), `.htaccess`, `sitemap.xml` |

## 3. Menyiapkan Supabase
1. Buat project di supabase.com.
2. **SQL Editor** > New query > tempel seluruh `supabase/01_schema.sql` > Run. (Aman dijalankan ulang.)
3. **Authentication > Providers > Email**: aktifkan. Jika "Confirm email" aktif, pengguna harus mengonfirmasi email sebelum masuk. Atur *Site URL* ke domain Vercel kamu.
4. Daftarkan akun admin lewat `konsultasi.html`, lalu jalankan `supabase/02_staff_example.sql` (ganti email) agar akun itu menjadi **admin**. Tambahkan konsultan dengan cara yang sama (role `consultant`).
5. Ambil **Project URL** dan **anon / publishable key** di *Project Settings > API*. Jangan pakai service_role.
6. (Opsional) Jalankan `supabase/03_manual_tests.sql` di SQL Editor untuk menguji aturan backend. Skrip berjalan dalam transaksi dan di-ROLLBACK.

## 4. Deploy ke Vercel
1. Push folder proyek ke GitHub (jangan commit `private/config.php` yang berisi kredensial; `.gitignore` sudah menyertakannya).
2. Vercel > Add New Project > pilih repo. Framework: **Other**. Pengaturan build sudah ada di `vercel.json` (`node scripts/build.js` → folder `dist`).
3. *Settings > Environment Variables*: isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` (lihat `.env.example`). Deploy.
4. `scripts/build.js` menyalin **hanya file publik** ke `dist/` (tanpa `.php`, `private/`, `supabase/`), membuat `assets/js/supabase-config.js` dari env, dan **menggagalkan build** jika kunci yang diisi ternyata service_role/secret key.
5. HTTPS otomatis aktif di domain `*.vercel.app` dan domain kustom.

Lokal: `export SUPABASE_URL=... SUPABASE_ANON_KEY=...; node scripts/build.js; npx serve dist -l 8080`, lalu buka http://localhost:8080.

## 5. Cara kerja aturan konsultasi (semua di server)
- Kuota: `unique index (user_id, session_date) where status <> 'CANCELLED'`. Dua klik/permintaan paralel → salah satunya ditolak database (`DAILY_QUOTA_USED`). `session_date` memakai Asia/Jakarta.
- Sesi lahir `WAITING`; hanya konsultan/admin (`staff_start_session`) yang mengubahnya ke `ACTIVE`, mengisi `started_at = now()` dan `expires_at = started_at + 120 menit` (waktu server). Constraint `cs_max_120` mencegah lebih dari 120 menit.
- Pesan hanya lewat `send_consultation_message` (cek pemilik/konsultan, status ACTIVE, `expires_at > now()`, panjang 1–1000). Tidak ada hak INSERT langsung ke tabel pesan.
- Pesan hanya terbaca oleh pemilik sesi dan konsultan yang ditugaskan (RLS). Mengetahui ID sesi tidak cukup.
- Premium: tabel `user_entitlements` hanya bisa ditulis oleh `admin_review_payment` (admin). Pengguna tidak punya hak tulis.
- Timer di browser memakai `expires_at` dan selisih waktu server (diukur dengan `performance.now()`), sehingga refresh, ganti perangkat, atau ubah jam perangkat tidak mengubah sisa waktu.
- Realtime: pesan dan status memakai Supabase Realtime. Polling 15 detik hanya aktif saat koneksi Realtime terputus.

## 6. Alur operasional
- **Pengguna**: daftar/masuk di `konsultasi.html` → bayar QRIS → unggah bukti → admin menyetujui di `konsultan.html` (tab Pembayaran) → Premium aktif 1 bulan (diperpanjang jika sudah aktif) → Mulai Konsultasi → menunggu konsultan.
- **Konsultan/Admin**: buka `konsultan.html` → antrean → **Mulai sesi** (menjalankan timer 120 menit) → chat → **Akhiri Sesi**.
- Konsultasi dilayani **manusia**. Tidak ada bot. Selama belum ada akun konsultan, pengguna hanya akan melihat status "menunggu konsultan".

## 7. Instalasi PWA di Android
**Memasang (pengguna):** buka situs lewat Chrome Android (HTTPS) → halaman Download → tombol **Pasang PrioriBuy** (muncul hanya bila Chrome mengizinkan). Jika tombol tidak ada: menu ⋮ → **Instal aplikasi** / **Tambahkan ke layar utama**. Setelah terpasang, kartu berubah menjadi "sudah terpasang".

**Memeriksa kriteria PWA:**
- Chrome DevTools > *Application* > **Manifest**: nama, ikon 192/512/maskable, start_url, tanpa peringatan. Lalu **Service Workers**: status *activated*; centang *Offline* dan muat ulang `app.html`.
- DevTools > *Lighthouse* > Progressive Web App.
- Di HP: `chrome://inspect` (remote debugging lewat USB) untuk memeriksa hal yang sama pada perangkat asli.
- `start_url`, `scope`, dan ikon memakai path **relatif**, jadi tetap benar bila situs berada di subpath (diuji di `/prioribuy/`).

**Aturan cache (keamanan):** service worker hanya menyimpan `app.html`, aset statis, dan file CDN. Respons Supabase (API, Storage, Realtime), bukti pembayaran, token, dan percakapan **tidak pernah** di-cache. Saat logout, token Supabase dihapus, `sessionStorage` dikosongkan, dan service worker diminta menghapus cache privat. Pembaruan: `app.html` dan aset memakai jaringan-dulu, nama cache dinaikkan tiap rilis, dan pengguna mendapat tombol "Muat ulang" bila versi baru tersedia.
Catatan: akun lokal di `app.html` sengaja menyimpan datanya per akun di perangkat (dipisah per pengguna, dilindungi kata sandi akun lokal). Itu bukan keamanan server.

## 8. Yang membutuhkan internet
Masuk/daftar akun cloud, konsultasi (chat, status, timer sinkron), pengiriman bukti bayar, dan pemuatan pertama Bootstrap/font (setelah itu tersimpan di cache). Perencana belanja (`app.html`) tetap berjalan offline.

## 9. Belum selesai / perlu tindakan kamu
- Project Supabase, akun admin/konsultan, dan environment variables di Vercel harus dibuat sendiri.
- Perencana belanja di `app.html` **masih lokal** (localStorage). Tabel `purchase_plans` + RLS sudah siap, tetapi aplikasi belum menyinkronkan ke sana. Jadi tidak ada klaim sinkronisasi cloud untuk daftar belanja.
- Dua sistem akun terpisah: akun lokal di `app.html` dan akun Supabase di konsultasi.
- Tema tersimpan di profil Supabase hanya untuk halaman konsultasi. Di halaman lain tersimpan di browser.
- Pencegahan spam pesan (rate limit per detik) belum ada selain batas 2000 pesan per sesi.
- Notifikasi push dan pembayaran otomatis tidak dibuat (sesuai permintaan: verifikasi admin).
