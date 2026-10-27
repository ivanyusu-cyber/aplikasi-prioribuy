-- Menjadikan akun sebagai ADMIN atau KkONSULTAN. Jalankan manual di SQL Editor (hanya pemilik project yang bisa).
-- 1) Daftarkan dulu akunnya lewat halaman konsultasi.html (atau Authentication > Users > Add user).
-- 2) Ganti email di bawah, lalu jalankan.
insert into public.admin_users (user_id, role)
select id, 'admin' from auth.users where email = 'GANTI_DENGAN_EMAIL_ADMIN@contoh.com'
on conflict (user_id) do update set role = excluded.role;

-- Konsultan (hanya bisa melayani sesi, tidak bisa menyetujui pembayaran):
-- insert into public.admin_users (user_id, role)
-- select id, 'consultant' from auth.users where email = 'GANTI_DENGAN_EMAIL_KONSULTAN@contoh.com'
-- on conflict (user_id) do update set role = excluded.role;

-- Memberi Premium manual (misalnya untuk uji coba), tanpa lewat pembayaran:
-- insert into public.user_entitlements (user_id, starts_at, ends_at)
-- select id, now(), now() + interval '30 days' from auth.users where email = 'EMAIL_PENGGUNA@contoh.com';
