-- ============================================================================
-- Uji otomatis aturan backend (jalankan di SQL Editor setelah 01_schema.sql).
-- Seluruhnya berjalan di dalam transaksi dan di-ROLLBACK di akhir: tidak meninggalkan data.
-- Jika ada pemeriksaan gagal, muncul error "UJI GAGAL: ..." pada langkah yang bermasalah.
-- ============================================================================
begin;

-- tiga akun uji: pengguna Premium (A), pengguna biasa (B), konsultan (C), admin (D)
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'uji-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'uji-b@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'uji-c@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'uji-d@example.test');
insert into public.admin_users (user_id, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'consultant'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin');
insert into public.user_entitlements (user_id, starts_at, ends_at)
values ('00000000-0000-0000-0000-0000000000a1', now() - interval '1 day', now() + interval '29 days');

create or replace function pg_temp.as_user(p_id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create or replace function pg_temp.fails_with(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm = p_msg then return; end if;
    raise exception 'UJI GAGAL: "%" seharusnya error "%", tetapi "%"', p_sql, p_msg, sqlerrm;
  end;
  raise exception 'UJI GAGAL: "%" seharusnya ditolak dengan "%"', p_sql, p_msg;
end $$;

do $$
declare s public.consultation_sessions; sid uuid; n int; m public.consultation_messages;
begin
  -- 1. non-Premium ditolak
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails_with('select public.request_consultation()', 'PREMIUM_REQUIRED');
  -- 2. pengguna tidak bisa memberi Premium / mengubah kuota sendiri
  begin execute 'insert into public.user_entitlements (user_id, ends_at) values (auth.uid(), now() + interval ''1 day'')'; raise exception 'UJI GAGAL: insert entitlement lolos';
  exception when insufficient_privilege then null; end;
  begin execute 'update public.consultation_sessions set status = ''ACTIVE'''; raise exception 'UJI GAGAL: update sesi lolos';
  exception when insufficient_privilege then null; end;
  reset role;

  -- 3. Premium bisa membuat sesi WAITING; sesi kedua di hari yang sama ditolak
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  s := public.request_consultation(); sid := s.id;
  if s.status <> 'WAITING' or s.started_at is not null then raise exception 'UJI GAGAL: sesi baru harus WAITING tanpa waktu mulai'; end if;
  perform pg_temp.fails_with('select public.request_consultation()', 'DAILY_QUOTA_USED');
  -- 4. pesan ditolak sebelum sesi aktif
  perform pg_temp.fails_with(format('select public.send_consultation_message(%L, ''halo'')', sid), 'SESSION_NOT_ACTIVE');
  reset role;

  -- 5. konsultan memulai: ACTIVE, durasi tepat 120 menit dari waktu server
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  s := public.staff_start_session(sid);
  if s.status <> 'ACTIVE' or s.expires_at <> s.started_at + interval '120 minutes' then raise exception 'UJI GAGAL: sesi harus ACTIVE 120 menit'; end if;
  perform pg_temp.fails_with(format('select public.staff_start_session(%L)', sid), 'INVALID_STATE');
  reset role;

  -- 6. pengguna B tidak bisa membaca / mengirim ke sesi orang lain
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails_with(format('select public.send_consultation_message(%L, ''intip'')', sid), 'SESSION_NOT_FOUND');
  select count(*) into n from public.consultation_sessions where id = sid;
  if n <> 0 then raise exception 'UJI GAGAL: B bisa melihat sesi A'; end if;
  reset role;

  -- 7. A & konsultan dapat saling kirim pesan; B tidak bisa membacanya
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  m := public.send_consultation_message(sid, '  Halo, saya ingin konsultasi  ');
  if m.body <> 'Halo, saya ingin konsultasi' or m.sender_role <> 'user' then raise exception 'UJI GAGAL: pesan A'; end if;
  perform pg_temp.fails_with(format('select public.send_consultation_message(%L, repeat(''x'', 1001))', sid), 'INVALID_MESSAGE');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.consultation_messages;
  if n <> 0 then raise exception 'UJI GAGAL: B bisa membaca pesan'; end if;
  reset role;

  -- 8. waktu habis: geser started_at/expires_at ke masa lalu (sebagai pemilik DB), pesan harus ditolak
  update public.consultation_sessions set started_at = now() - interval '121 minutes', expires_at = now() - interval '1 minute' where id = sid;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform pg_temp.fails_with(format('select public.send_consultation_message(%L, ''terlambat'')', sid), 'SESSION_EXPIRED');
  if (public.my_consultation_state()->'session'->>'status') <> 'EXPIRED' then raise exception 'UJI GAGAL: status harus EXPIRED'; end if;
  perform pg_temp.fails_with('select public.request_consultation()', 'DAILY_QUOTA_USED');   -- tetap terpakai
  reset role;

  -- 9. constraint 120 menit di level tabel
  begin
    update public.consultation_sessions set expires_at = started_at + interval '121 minutes' where id = sid;
    raise exception 'UJI GAGAL: constraint 120 menit tidak bekerja';
  exception when check_violation then null; end;

  -- 10. pembayaran: pengguna tidak bisa menyetujui sendiri; admin bisa
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.submit_payment_request('00000000-0000-0000-0000-0000000000b1/bukti.png', 'uji');
  perform pg_temp.fails_with('select public.submit_payment_request(''00000000-0000-0000-0000-0000000000b1/lagi.png'', '''')', 'PAYMENT_ALREADY_PENDING');
  perform pg_temp.fails_with('select public.submit_payment_request(''orang-lain/bukti.png'', '''')', 'INVALID_PROOF');
  perform pg_temp.fails_with('select public.admin_list_payments(''pending'')', 'FORBIDDEN');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform public.admin_review_payment((select id from public.payment_requests where user_id = '00000000-0000-0000-0000-0000000000b1'), true);
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  if not (public.my_premium_status()->>'is_premium')::boolean then raise exception 'UJI GAGAL: B harus Premium setelah disetujui'; end if;
  reset role;

  raise notice 'SEMUA UJI LULUS';
end $$;

rollback;
