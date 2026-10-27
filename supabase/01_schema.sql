-- ============================================================================
-- PrioriBuy — skema Supabase (PostgreSQL) + Row Level Security + fungsi backend
-- Jalankan SELURUH file ini sekali di: Supabase Dashboard > SQL Editor > New query.
-- Aman dijalankan ulang (memakai IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
--
-- Prinsip keamanan:
--  * Pengguna TIDAK punya hak tulis langsung ke: user_entitlements, consultation_sessions,
--    consultation_messages, payment_requests, admin_users. Semua perubahan lewat fungsi
--    (RPC) SECURITY DEFINER yang memeriksa auth.uid(), status Premium, kuota, dan waktu SERVER (now()).
--  * Hari kalender kuota = zona waktu Asia/Jakarta.
--  * Batas 1 sesi/hari dijaga unique index di database (tahan terhadap klik ganda / permintaan paralel).
--  * Batas 120 menit dijaga CHECK constraint + diperiksa pada setiap pengiriman pesan.
-- ============================================================================

-- ---------------------------------------------------------------- 1. profiles
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  theme_pref   text not null default 'system' check (theme_pref in ('light','dark','system')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- profil otomatis dibuat saat akun baru terdaftar
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'name', ''), 60))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- pengguna lama (jika ada) yang belum punya profil
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- ---------------------------------------------------------------- 2. role staf (admin / konsultan)
-- Diisi MANUAL oleh pemilik project lewat SQL Editor (lihat 02_staff_example.sql). Tidak bisa diubah dari aplikasi.
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','consultant')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid() and role in ('admin','consultant'));
$$;

-- ---------------------------------------------------------------- 3. purchase_plans (rencana pembelian)
create table if not exists public.purchase_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  price        bigint not null check (price between 0 and 10000000000),
  qty          integer not null default 1 check (qty between 1 and 9999),
  category     text not null check (category in ('kebutuhan','keinginan')),
  priority     text not null check (priority in ('tinggi','sedang','rendah')),
  status       text not null default 'belum' check (status in ('belum','sudah','ditunda')),
  note         text not null default '' check (char_length(note) <= 300),
  purchased_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists purchase_plans_user_idx on public.purchase_plans (user_id, created_at desc);

drop trigger if exists trg_plans_touch on public.purchase_plans;
create trigger trg_plans_touch before update on public.purchase_plans
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- 4. Premium: hak akses + permintaan pembayaran
create table if not exists public.user_entitlements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  plan       text not null default 'premium' check (plan in ('premium')),
  status     text not null default 'active' check (status in ('active','revoked')),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  payment_id uuid,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists user_entitlements_user_idx on public.user_entitlements (user_id, ends_at desc);

create table if not exists public.payment_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  plan        text not null default 'premium_monthly',
  amount      integer not null default 49000,
  months      integer not null default 1 check (months between 1 and 12),
  proof_path  text not null,
  note        text not null default '' check (char_length(note) <= 300),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
-- satu permintaan pending per pengguna (mencegah spam / data ganda)
create unique index if not exists payment_one_pending on public.payment_requests (user_id) where status = 'pending';

-- ---------------------------------------------------------------- 5. Konsultasi
create table if not exists public.consultation_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  consultant_id uuid references auth.users(id),
  session_date  date not null,                        -- hari kalender Asia/Jakarta saat sesi diminta
  status        text not null default 'WAITING' check (status in ('WAITING','ACTIVE','COMPLETED','EXPIRED','CANCELLED')),
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  expires_at    timestamptz,
  ended_at      timestamptz,
  -- sesi yang sudah berjalan wajib punya waktu mulai & batas akhir
  constraint cs_times_required check (status in ('WAITING','CANCELLED') or (started_at is not null and expires_at is not null)),
  -- durasi tidak boleh lebih dari 120 menit
  constraint cs_max_120 check (started_at is null or expires_at is null or expires_at <= started_at + interval '120 minutes'),
  constraint cs_end_in_window check (ended_at is null or expires_at is null or ended_at <= expires_at)
);
-- KUNCI KUOTA: maksimal satu sesi (selain yang dibatalkan sebelum mulai) per pengguna per hari kalender.
create unique index if not exists cs_one_per_day on public.consultation_sessions (user_id, session_date) where status <> 'CANCELLED';
create index if not exists cs_waiting_idx on public.consultation_sessions (status, created_at) where status = 'WAITING';
create index if not exists cs_consultant_idx on public.consultation_sessions (consultant_id, status);

create table if not exists public.consultation_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.consultation_sessions(id) on delete cascade,
  sender_id   uuid not null references auth.users(id),
  sender_role text not null check (sender_role in ('user','consultant')),
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists cm_session_idx on public.consultation_messages (session_id, created_at);

-- ============================================================================
-- 6. Fungsi internal (tidak bisa dipanggil dari browser)
-- ============================================================================
create or replace function public.jakarta_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Jakarta')::date;
$$;

create or replace function public.is_premium(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_entitlements e
    where e.user_id = p_user and e.plan = 'premium' and e.status = 'active'
      and e.starts_at <= now() and e.ends_at > now());
$$;

-- Merapikan status berdasarkan waktu SERVER: sesi ACTIVE yang lewat batas -> EXPIRED,
-- sesi WAITING dari hari sebelumnya -> CANCELLED (tidak memakan kuota hari baru).
create or replace function public.cleanup_sessions() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.consultation_sessions
     set status = 'EXPIRED', ended_at = expires_at
   where status = 'ACTIVE' and expires_at <= now();
  update public.consultation_sessions
     set status = 'CANCELLED', ended_at = now()
   where status = 'WAITING' and session_date < public.jakarta_today();
end $$;

-- ============================================================================
-- 7. RPC untuk pengguna
-- ============================================================================
create or replace function public.server_time() returns timestamptz
language sql stable set search_path = '' as $$ select now(); $$;

create or replace function public.my_staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.admin_users where user_id = auth.uid();
$$;

create or replace function public.my_premium_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_end timestamptz; v_pending boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select max(ends_at) into v_end from public.user_entitlements
   where user_id = v_uid and status = 'active' and starts_at <= now() and ends_at > now();
  select exists (select 1 from public.payment_requests where user_id = v_uid and status = 'pending') into v_pending;
  return jsonb_build_object('is_premium', v_end is not null, 'ends_at', v_end, 'payment_pending', v_pending);
end $$;

-- Ajukan Premium: bukti bayar sudah diunggah ke bucket 'payment-proofs' pada folder <user_id>/...
-- Nominal & durasi ditetapkan SERVER (bukan dari browser). Premium baru aktif setelah admin menyetujui.
create or replace function public.submit_payment_request(p_proof_path text, p_note text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_proof_path is null or p_proof_path not like (v_uid::text || '/%') or char_length(p_proof_path) > 300 then
    raise exception 'INVALID_PROOF';
  end if;
  begin
    insert into public.payment_requests (user_id, proof_path, note)
    values (v_uid, p_proof_path, left(coalesce(p_note, ''), 300)) returning id into v_id;
  exception when unique_violation then
    raise exception 'PAYMENT_ALREADY_PENDING';
  end;
  return v_id;
end $$;

-- Keadaan konsultasi saat ini + waktu server (klien memakai ini untuk timer; refresh tetap konsisten)
create or replace function public.my_consultation_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); s public.consultation_sessions; v_today date := public.jakarta_today(); v_found boolean; v_premium boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.cleanup_sessions();
  select * into s from public.consultation_sessions
   where user_id = v_uid and status <> 'CANCELLED'
     and (session_date = v_today or status in ('WAITING','ACTIVE'))
   order by created_at desc limit 1;
  v_found := found;
  v_premium := public.is_premium(v_uid);
  return jsonb_build_object(
    'server_now', now(),
    'today', v_today,
    'premium', v_premium,
    'quota_used', v_found,
    'session', case when s.id is null then null else jsonb_build_object(
        'id', s.id, 'status', s.status, 'created_at', s.created_at, 'started_at', s.started_at,
        'expires_at', s.expires_at, 'ended_at', s.ended_at, 'consultant_id', s.consultant_id,
        'remaining_seconds', case when s.status = 'ACTIVE' then greatest(0, floor(extract(epoch from (s.expires_at - now()))))::int end
      ) end);
end $$;

-- Minta sesi. Status awal WAITING: durasi 2 jam BELUM berjalan sampai konsultan memulai.
create or replace function public.request_consultation() returns public.consultation_sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row public.consultation_sessions;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.cleanup_sessions();
  if not public.is_premium(v_uid) then raise exception 'PREMIUM_REQUIRED'; end if;
  begin
    insert into public.consultation_sessions (user_id, session_date)
    values (v_uid, public.jakarta_today()) returning * into v_row;
  exception when unique_violation then
    raise exception 'DAILY_QUOTA_USED';
  end;
  return v_row;
end $$;

-- Batalkan sebelum dimulai (tidak memakan kuota).
create or replace function public.cancel_consultation(p_session_id uuid) returns public.consultation_sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); s public.consultation_sessions;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into s from public.consultation_sessions where id = p_session_id and user_id = v_uid for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.status <> 'WAITING' then raise exception 'INVALID_STATE'; end if;
  update public.consultation_sessions set status = 'CANCELLED', ended_at = now() where id = s.id returning * into s;
  return s;
end $$;

-- Akhiri sesi (pemilik atau konsultan yang ditugaskan). Tetap dihitung 1 sesi harian.
create or replace function public.end_consultation(p_session_id uuid) returns public.consultation_sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); s public.consultation_sessions;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into s from public.consultation_sessions
   where id = p_session_id and (user_id = v_uid or consultant_id = v_uid) for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.status = 'ACTIVE' then
    if s.expires_at <= now() then
      update public.consultation_sessions set status = 'EXPIRED', ended_at = expires_at where id = s.id returning * into s;
    else
      update public.consultation_sessions set status = 'COMPLETED', ended_at = now() where id = s.id returning * into s;
    end if;
  elsif s.status = 'WAITING' then
    raise exception 'INVALID_STATE';      -- sebelum dimulai: gunakan cancel_consultation
  end if;
  return s;                                -- COMPLETED / EXPIRED / CANCELLED: idempotent
end $$;

-- Kirim pesan. Semua pemeriksaan di server: otorisasi, status, waktu, panjang.
create or replace function public.send_consultation_message(p_session_id uuid, p_body text) returns public.consultation_messages
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); s public.consultation_sessions; m public.consultation_messages; v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then raise exception 'INVALID_MESSAGE'; end if;
  select * into s from public.consultation_sessions
   where id = p_session_id and (user_id = v_uid or consultant_id = v_uid) for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;        -- tidak membocorkan keberadaan sesi orang lain
  if s.status <> 'ACTIVE' then raise exception 'SESSION_NOT_ACTIVE'; end if;
  if s.expires_at <= now() then raise exception 'SESSION_EXPIRED'; end if;
  if (select count(*) from public.consultation_messages where session_id = s.id) >= 2000 then raise exception 'MESSAGE_LIMIT'; end if;
  insert into public.consultation_messages (session_id, sender_id, sender_role, body)
  values (s.id, v_uid, case when v_uid = s.user_id then 'user' else 'consultant' end, v_body)
  returning * into m;
  return m;
end $$;

-- ============================================================================
-- 8. RPC untuk staf (konsultan / admin)
-- ============================================================================
create or replace function public.staff_queue() returns table (
  session_id uuid, user_id uuid, display_name text, status text,
  created_at timestamptz, started_at timestamptz, expires_at timestamptz, consultant_id uuid, server_now timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  perform public.cleanup_sessions();
  return query
    select s.id, s.user_id, coalesce(nullif(p.display_name, ''), 'Pengguna'), s.status,
           s.created_at, s.started_at, s.expires_at, s.consultant_id, now()
      from public.consultation_sessions s
      left join public.profiles p on p.id = s.user_id
     where s.status = 'WAITING' or (s.status = 'ACTIVE' and s.consultant_id = auth.uid())
     order by s.created_at;
end $$;

create or replace function public.staff_start_session(p_session_id uuid) returns public.consultation_sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); s public.consultation_sessions;
begin
  if not public.is_staff() then raise exception 'FORBIDDEN'; end if;
  perform public.cleanup_sessions();
  select * into s from public.consultation_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.status <> 'WAITING' then raise exception 'INVALID_STATE'; end if;
  if s.user_id = v_uid then raise exception 'FORBIDDEN'; end if;            -- tidak boleh melayani diri sendiri
  if not public.is_premium(s.user_id) then raise exception 'USER_NOT_PREMIUM'; end if;
  update public.consultation_sessions
     set status = 'ACTIVE', consultant_id = v_uid, started_at = now(), expires_at = now() + interval '120 minutes'
   where id = s.id returning * into s;
  return s;
end $$;

-- ============================================================================
-- 9. RPC admin: persetujuan pembayaran
-- ============================================================================
create or replace function public.admin_list_payments(p_status text default 'pending') returns table (
  id uuid, user_id uuid, email text, display_name text, amount integer, months integer,
  status text, note text, proof_path text, created_at timestamptz, reviewed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return query
    select r.id, r.user_id, u.email::text, coalesce(nullif(p.display_name, ''), 'Pengguna'),
           r.amount, r.months, r.status, r.note, r.proof_path, r.created_at, r.reviewed_at
      from public.payment_requests r
      join auth.users u on u.id = r.user_id
      left join public.profiles p on p.id = r.user_id
     where (p_status is null or r.status = p_status)
     order by r.created_at desc limit 200;
end $$;

create or replace function public.admin_review_payment(p_payment_id uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); r public.payment_requests; v_start timestamptz;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into r from public.payment_requests where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if p_approve then
    -- perpanjang dari akhir Premium aktif (jika ada), jika tidak mulai sekarang
    select greatest(now(), coalesce(max(ends_at), now())) into v_start
      from public.user_entitlements where user_id = r.user_id and status = 'active';
    insert into public.user_entitlements (user_id, starts_at, ends_at, payment_id)
    values (r.user_id, v_start, v_start + make_interval(months => r.months), r.id);
    update public.payment_requests set status = 'approved', reviewed_by = v_uid, reviewed_at = now() where id = r.id;
    return 'approved';
  end if;
  update public.payment_requests set status = 'rejected', reviewed_by = v_uid, reviewed_at = now() where id = r.id;
  return 'rejected';
end $$;

-- ============================================================================
-- 10. Row Level Security
-- ============================================================================
alter table public.profiles              enable row level security;
alter table public.admin_users           enable row level security;
alter table public.purchase_plans        enable row level security;
alter table public.user_entitlements     enable row level security;
alter table public.payment_requests      enable row level security;
alter table public.consultation_sessions enable row level security;
alter table public.consultation_messages enable row level security;

-- profiles: baca & ubah milik sendiri (kolom yang boleh diubah dibatasi lewat GRANT di bawah)
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- admin_users: hanya bisa melihat baris milik sendiri; tidak ada policy tulis
drop policy if exists admin_users_select_own on public.admin_users;
create policy admin_users_select_own on public.admin_users for select to authenticated using (user_id = auth.uid());

-- purchase_plans: CRUD hanya data milik sendiri
drop policy if exists plans_select_own on public.purchase_plans;
create policy plans_select_own on public.purchase_plans for select to authenticated using (user_id = auth.uid());
drop policy if exists plans_insert_own on public.purchase_plans;
create policy plans_insert_own on public.purchase_plans for insert to authenticated with check (user_id = auth.uid());
drop policy if exists plans_update_own on public.purchase_plans;
create policy plans_update_own on public.purchase_plans for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists plans_delete_own on public.purchase_plans;
create policy plans_delete_own on public.purchase_plans for delete to authenticated using (user_id = auth.uid());

-- Premium & pembayaran: hanya baca milik sendiri (tulis hanya lewat RPC)
drop policy if exists ent_select_own on public.user_entitlements;
create policy ent_select_own on public.user_entitlements for select to authenticated using (user_id = auth.uid());
drop policy if exists pay_select_own on public.payment_requests;
create policy pay_select_own on public.payment_requests for select to authenticated using (user_id = auth.uid());

-- Sesi: pemilik, konsultan yang ditugaskan, atau staf (hanya sesi WAITING, untuk antrean)
drop policy if exists cs_select on public.consultation_sessions;
create policy cs_select on public.consultation_sessions for select to authenticated
  using (user_id = auth.uid() or consultant_id = auth.uid() or (status = 'WAITING' and public.is_staff()));

-- Pesan: hanya pemilik sesi & konsultan yang ditugaskan (mengetahui ID sesi saja tidak cukup)
drop policy if exists cm_select on public.consultation_messages;
create policy cm_select on public.consultation_messages for select to authenticated
  using (exists (select 1 from public.consultation_sessions s
                  where s.id = session_id and (s.user_id = auth.uid() or s.consultant_id = auth.uid())));

-- ============================================================================
-- 11. Hak akses (GRANT) — cabut semua, lalu beri seminimal mungkin
-- ============================================================================
revoke all on public.profiles, public.admin_users, public.purchase_plans, public.user_entitlements,
              public.payment_requests, public.consultation_sessions, public.consultation_messages
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, theme_pref) on public.profiles to authenticated;     -- bukan id / created_at
grant select on public.admin_users, public.user_entitlements, public.payment_requests,
                public.consultation_sessions, public.consultation_messages to authenticated;
grant select, insert, delete on public.purchase_plans to authenticated;
grant update (name, price, qty, category, priority, status, note, purchased_at) on public.purchase_plans to authenticated;

-- fungsi: cabut dari semua, beri hanya yang memang boleh dipanggil dari browser
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin(), public.is_staff() to authenticated;   -- dipakai oleh policy
grant execute on function
  public.server_time(), public.my_staff_role(), public.my_premium_status(), public.submit_payment_request(text, text),
  public.my_consultation_state(), public.request_consultation(), public.cancel_consultation(uuid),
  public.end_consultation(uuid), public.send_consultation_message(uuid, text),
  public.staff_queue(), public.staff_start_session(uuid),
  public.admin_list_payments(text), public.admin_review_payment(uuid, boolean)
  to authenticated;
-- (cleanup_sessions, is_premium, jakarta_today, handle_new_user, touch_updated_at = internal saja)

-- ============================================================================
-- 12. Realtime (pesan & perubahan status sesi). RLS tetap berlaku pada Realtime.
-- ============================================================================
do $$
begin
  begin alter publication supabase_realtime add table public.consultation_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.consultation_sessions; exception when duplicate_object then null; end;
end $$;

-- ============================================================================
-- 13. Storage: bukti pembayaran (privat). Pengguna hanya di folder <user_id>/ miliknya; admin bisa melihat.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists proofs_insert_own on storage.objects;
create policy proofs_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists proofs_select_own_or_admin on storage.objects;
create policy proofs_select_own_or_admin on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ============================================================================
-- 14. (Opsional) Penutupan sesi kedaluwarsa terjadwal bila pg_cron diaktifkan.
--     Tanpa ini pun aturan tetap benar: semua fungsi memeriksa expires_at dengan now() server.
-- ============================================================================
-- select cron.schedule('pb-cleanup-sessions', '* * * * *', $$select public.cleanup_sessions()$$);
