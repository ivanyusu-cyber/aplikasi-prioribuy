/* Konfigurasi Supabase untuk browser.
   Hanya URL proyek dan "anon / publishable key" yang boleh ada di sini (keduanya memang publik; keamanan data dijaga RLS).
   JANGAN PERNAH menaruh kunci rahasia (kunci tingkat server / admin) di file ini atau file lain yang dipublikasikan.
   Di Vercel, file ini dibuat ulang saat build dari environment variables (lihat scripts/build.js). */
window.PB_SUPABASE = { url: '', anonKey: '' };
