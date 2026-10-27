/* Halaman konsultasi pengguna. Semua aturan (Premium, kuota harian, 120 menit, otorisasi) dijalankan SERVER (RPC + RLS);
   kode ini hanya menampilkan hasilnya. Tidak ada status Premium atau kuota yang dibaca dari localStorage. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var show = function (sel, on) { var n = $(sel); if (n) n.hidden = !on; };
  var DATE = function (iso) { try { return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }); } catch (e) { return ''; } };

  function flash(text, type) {
    var box = $('#flash'); box.textContent = '';
    if (!text) return;
    var d = document.createElement('div'); d.className = 'alert-pb alert-pb--' + (type || 'error'); d.setAttribute('role', type === 'ok' ? 'status' : 'alert');
    d.innerHTML = '<i class="bi bi-info-circle"></i><span></span>'; d.querySelector('span').textContent = text; box.appendChild(d);
    if (type === 'ok') setTimeout(function () { if (d.parentNode) d.remove(); }, 5000);
  }

  if (!PBSB.configured || !PBSB.client()) { show('#cfgMissing', true); return; }
  var sb = PBSB.client(), user = null, chat = null, busy = false, lastStatus = null;

  function ensureChat() {
    if (chat) return chat;
    chat = PBChat({
      sb: sb, meId: user.id, peerLabel: 'Kamu',
      els: { list: $('#chatList'), input: $('#chatInput'), send: $('#chatSend'), timer: $('#timer'), conn: $('#connDot'), connText: $('#connText'), status: $('#sBadge'), note: $('#chatNote'), end: $('#endBtn') },
      onSession: function (s) {
        if (!s) return;
        $('#cancelBtn').hidden = s.status !== 'WAITING';
        var changed = lastStatus !== null && lastStatus !== s.status; lastStatus = s.status;
        if (changed) loadAll(true);          // status berubah (mis. konsultan memulai / waktu habis): segarkan kuota & panel
      }
    });
    return chat;
  }

  async function loadAll(quiet) {
    if (busy) return; busy = true;
    try {
      var r = await Promise.all([PBSB.rpc('my_premium_status'), PBSB.rpc('my_consultation_state')]);
      var prem = r[0], st = r[1];
      $('#premStatus').textContent = prem.is_premium ? 'Aktif' : (prem.payment_pending ? 'Menunggu verifikasi' : 'Belum Premium');
      $('#premSub').textContent = prem.is_premium ? 'Berlaku sampai ' + DATE(prem.ends_at) : '';
      $('#quotaStatus').textContent = !prem.is_premium ? 'Khusus Premium' : (st.quota_used ? 'Sudah dipakai' : 'Tersedia (1 sesi)');
      show('#premiumBox', !prem.is_premium); show('#consultBox', prem.is_premium);
      show('#payPending', !!prem.payment_pending); show('#payForm', !prem.payment_pending);
      if (!prem.is_premium) { if (chat) chat.close(); return; }
      var s = st.session;
      if (!s) { if (chat) chat.close(); show('#chatPanel', false); show('#idlePanel', true); return; }
      show('#idlePanel', false); show('#chatPanel', true);
      var live = ensureChat();
      if (!live.session || live.session.id !== s.id) { lastStatus = null; await live.open(s); } else live.refresh();
    } catch (e) { if (!quiet) flash(PBSB.errText(e), 'error'); }
    finally { busy = false; }
  }

  async function enter(u) {
    user = u; show('#authWrap', false); show('#dash', true);
    $('#who').textContent = (u.user_metadata && u.user_metadata.name ? u.user_metadata.name + ' · ' : '') + u.email;
    // tema tersimpan di profil (konsisten antar-perangkat)
    try {
      var p = await sb.from('profiles').select('theme_pref').eq('id', u.id).maybeSingle();
      if (p.data && p.data.theme_pref && window.PBTheme && PBTheme.get() !== p.data.theme_pref) PBTheme.set(p.data.theme_pref, true);
    } catch (e) {}
    flash('');
    await loadAll();
  }
  function leave() {
    if (chat) { chat.close(); chat = null; }
    lastStatus = null; user = null; show('#dash', false); show('#authWrap', true);
    ['#chatList', '#premStatus', '#quotaStatus'].forEach(function (s) { var n = $(s); if (n) n.textContent = ''; });
    PBSB.mountAuth($('#authBox'), enter);
  }

  $('#logoutBtn').addEventListener('click', async function () { await PBSB.signOut(); leave(); flash('Kamu sudah keluar.', 'ok'); });

  $('#startBtn').addEventListener('click', async function (e) {
    var b = e.currentTarget; if (b.disabled) return; b.disabled = true; flash('');
    try { await PBSB.rpc('request_consultation'); await loadAll(); flash('Permintaan konsultasi dikirim. Menunggu konsultan memulai sesi.', 'ok'); }
    catch (err) { flash(PBSB.errText(err), 'error'); loadAll(true); }
    finally { b.disabled = false; }
  });
  $('#cancelBtn').addEventListener('click', async function () {
    var s = chat && chat.session; if (!s || !confirm('Batalkan antrean? Kuota hari ini tidak akan terpakai.')) return;
    try { await PBSB.rpc('cancel_consultation', { p_session_id: s.id }); chat.close(); chat = null; await loadAll(); }
    catch (err) { flash(PBSB.errText(err), 'error'); }
  });
  $('#endBtn').addEventListener('click', async function () {
    if (!chat || !confirm('Akhiri sesi sekarang? Sesi tetap dihitung sebagai 1 sesi hari ini dan tidak bisa dibuka lagi.')) return;
    try { await chat.end(); flash('Sesi telah diakhiri.', 'ok'); await loadAll(true); } catch (err) { flash(PBSB.errText(err), 'error'); }
  });
  $('#chatForm').addEventListener('submit', async function (e) {
    e.preventDefault(); if (!chat) return;
    var r = await chat.send(); if (!r.ok) flash(r.error, 'error'); else flash('');
  });
  $('#chatInput').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); } });

  // Bukti pembayaran → Storage privat + RPC (nominal ditetapkan server; Premium baru aktif setelah admin menyetujui)
  $('#payForm').addEventListener('submit', async function (e) {
    e.preventDefault(); flash('');
    var f = $('#payFile').files[0], btn = $('#payBtn');
    var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[f && f.type];
    if (!f) { flash('Pilih file bukti pembayaran terlebih dahulu.', 'error'); return; }
    if (!ext) { flash('Format harus JPG, PNG, atau WebP.', 'error'); return; }
    if (f.size > 3 * 1024 * 1024) { flash('Ukuran file maksimal 3 MB.', 'error'); return; }
    btn.disabled = true;
    var path = user.id + '/' + Date.now() + '.' + ext;
    try {
      var up = await sb.storage.from('payment-proofs').upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) throw up.error;
      try { await PBSB.rpc('submit_payment_request', { p_proof_path: path, p_note: $('#payNote').value.trim() }); }
      catch (err) { await sb.storage.from('payment-proofs').remove([path]); throw err; }
      $('#payForm').reset(); flash('Bukti pembayaran terkirim. Admin akan memeriksanya sebelum Premium diaktifkan.', 'ok'); await loadAll(true);
    } catch (err) { flash(PBSB.errText(err), 'error'); } finally { btn.disabled = false; }
  });

  window.addEventListener('pb-theme-change', async function (e) {
    if (!user) return;
    try { await sb.from('profiles').update({ theme_pref: e.detail.pref }).eq('id', user.id); } catch (err) {}
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && user) loadAll(true); });   // sinkron ulang timer/status

  sb.auth.onAuthStateChange(function (evt) { if (evt === 'SIGNED_OUT' && user) leave(); });
  (async function () {
    try {
      var s = await sb.auth.getSession();
      if (s.data && s.data.session) await enter(s.data.session.user); else leave();
    } catch (e) { leave(); }
  })();
})();
