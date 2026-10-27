/* Konsol staf: antrean konsultasi + persetujuan pembayaran. Otorisasi dijaga RLS & RPC (FORBIDDEN bila bukan staf). */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var show = function (sel, on) { var n = $(sel); if (n) n.hidden = !on; };
  var TIME = function (iso) { try { return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }); } catch (e) { return ''; } };
  function flash(text, type) {
    var box = $('#flash'); box.textContent = ''; if (!text) return;
    var d = document.createElement('div'); d.className = 'alert-pb alert-pb--' + (type || 'error'); d.setAttribute('role', 'alert');
    d.innerHTML = '<i class="bi bi-info-circle"></i><span></span>'; d.querySelector('span').textContent = text; box.appendChild(d);
    if (type === 'ok') setTimeout(function () { if (d.parentNode) d.remove(); }, 4000);
  }
  if (!PBSB.configured || !PBSB.client()) { show('#cfgMissing', true); return; }
  var sb = PBSB.client(), user = null, role = null, chat = null, qChan = null, qPoll = null, lastStatus = null;

  function ensureChat() {
    if (chat) return chat;
    chat = PBChat({ sb: sb, meId: user.id, peerLabel: 'Pengguna',
      els: { list: $('#chatList'), input: $('#chatInput'), send: $('#chatSend'), timer: $('#timer'), conn: $('#connDot'), connText: $('#connText'), status: $('#sBadge'), note: $('#chatNote'), end: $('#endBtn') },
      onSession: function (s) { if (!s) return; var changed = lastStatus !== null && lastStatus !== s.status; lastStatus = s.status; if (changed) loadQueue(true); } });
    return chat;
  }

  function el(tag, cls, text) { return PBSB.el(tag, cls, text); }
  async function loadQueue(quiet) {
    try {
      var rows = await PBSB.rpc('staff_queue'), box = $('#queue'); box.textContent = '';
      if (!rows.length) box.appendChild(el('div', 'form-hint', 'Belum ada antrean.'));
      rows.forEach(function (r) {
        var it = el('div', 'q-item'), l = el('div');
        l.appendChild(el('div', 'n', r.display_name)); l.appendChild(el('div', 't', (r.status === 'WAITING' ? 'Menunggu sejak ' + TIME(r.created_at) : 'Sesi saya, berakhir ' + TIME(r.expires_at))));
        var b = el('button', 'btn btn-pb-primary btn-sm-pb2', r.status === 'WAITING' ? 'Mulai sesi' : 'Buka');
        b.type = 'button';
        b.addEventListener('click', async function () {
          b.disabled = true;
          try {
            var s = r.status === 'WAITING' ? await PBSB.rpc('staff_start_session', { p_session_id: r.session_id }) : (await sb.from('consultation_sessions').select('*').eq('id', r.session_id).single()).data;
            show('#noChat', false); show('#chatPanel', true); lastStatus = null; await ensureChat().open(s); loadQueue(true);
          } catch (err) { flash(PBSB.errText(err), 'error'); loadQueue(true); } finally { b.disabled = false; }
        });
        it.appendChild(l); it.appendChild(b); box.appendChild(it);
      });
    } catch (e) { if (!quiet) flash(PBSB.errText(e), 'error'); }
  }
  function watchQueue() {
    if (qChan) return;
    qChan = sb.channel('pb-staff-queue').on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_sessions' }, function () { loadQueue(true); })
      .subscribe(function (st) {
        if (st === 'SUBSCRIBED') { if (qPoll) { clearInterval(qPoll); qPoll = null; } }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { if (!qPoll) qPoll = setInterval(function () { loadQueue(true); }, 20000); }
      });
  }

  async function loadPayments() {
    try {
      var rows = await PBSB.rpc('admin_list_payments', { p_status: 'pending' }), box = $('#payList'); box.textContent = '';
      if (!rows.length) box.appendChild(el('div', 'form-hint', 'Tidak ada pembayaran yang menunggu.'));
      rows.forEach(function (r) {
        var c = el('div', 'pay-item'); c.appendChild(el('div', 'n fw-semibold', r.display_name + ' · ' + r.email));
        c.appendChild(el('div', 'form-hint', 'Rp' + String(r.amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' · ' + r.months + ' bulan · ' + new Date(r.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + (r.note ? ' · ' + r.note : '')));
        var row = el('div', 'd-flex gap-2 flex-wrap mt-2');
        var v = el('button', 'btn btn-pb-outline btn-sm-pb2', 'Lihat bukti'); v.type = 'button';
        v.addEventListener('click', async function () {
          var s = await sb.storage.from('payment-proofs').createSignedUrl(r.proof_path, 60);
          if (s.error) flash(PBSB.errText(s.error), 'error'); else window.open(s.data.signedUrl, '_blank', 'noopener');
        });
        function review(ok) {
          return async function () {
            if (!confirm(ok ? 'Setujui pembayaran dan aktifkan Premium 1 bulan untuk pengguna ini?' : 'Tolak pembayaran ini?')) return;
            try { await PBSB.rpc('admin_review_payment', { p_payment_id: r.id, p_approve: ok }); flash(ok ? 'Premium diaktifkan.' : 'Pembayaran ditolak.', 'ok'); loadPayments(); }
            catch (err) { flash(PBSB.errText(err), 'error'); }
          };
        }
        var a = el('button', 'btn btn-pb-primary btn-sm-pb2', 'Setujui'); a.type = 'button'; a.addEventListener('click', review(true));
        var t = el('button', 'btn btn-pb-outline btn-sm-pb2', 'Tolak'); t.type = 'button'; t.addEventListener('click', review(false));
        row.appendChild(v); row.appendChild(a); row.appendChild(t); c.appendChild(row); box.appendChild(c);
      });
    } catch (e) { flash(PBSB.errText(e), 'error'); }
  }

  async function enter(u) {
    user = u; show('#authWrap', false);
    try { role = await PBSB.rpc('my_staff_role'); } catch (e) { role = null; }
    if (!role) { show('#denied', true); show('#console', false); return; }
    show('#denied', false); show('#console', true);
    $('#who').textContent = u.email; $('#roleBadge').textContent = role === 'admin' ? 'Admin' : 'Konsultan';
    show('#payTabLi', role === 'admin');
    loadQueue(); watchQueue(); if (role === 'admin') loadPayments();
  }
  function leave() {
    if (chat) { chat.close(); chat = null; }
    if (qChan) { try { sb.removeChannel(qChan); } catch (e) {} qChan = null; }
    if (qPoll) { clearInterval(qPoll); qPoll = null; }
    user = role = null; show('#console', false); show('#denied', false); show('#authWrap', true); show('#chatPanel', false); show('#noChat', true);
    $('#queue').textContent = ''; $('#payList').textContent = '';
    PBSB.mountAuth($('#authBox'), enter, { noRegister: true });
  }
  async function out() { await PBSB.signOut(); leave(); }
  $('#logoutBtn').addEventListener('click', out); $('#deniedOut').addEventListener('click', out);
  $('#refreshQ').addEventListener('click', function () { loadQueue(); }); $('#refreshP').addEventListener('click', loadPayments);
  document.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('active', x === b); });
      show('#tabQueue', b.dataset.tab === 'queue'); show('#tabPay', b.dataset.tab === 'pay');
    });
  });
  $('#chatForm').addEventListener('submit', async function (e) { e.preventDefault(); if (!chat) return; var r = await chat.send(); if (!r.ok) flash(r.error, 'error'); else flash(''); });
  $('#chatInput').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); } });
  $('#endBtn').addEventListener('click', async function () {
    if (!chat || !confirm('Akhiri sesi konsultasi ini?')) return;
    try { await chat.end(); flash('Sesi diakhiri.', 'ok'); loadQueue(true); } catch (err) { flash(PBSB.errText(err), 'error'); }
  });
  sb.auth.onAuthStateChange(function (evt) { if (evt === 'SIGNED_OUT' && user) leave(); });
  (async function () { try { var s = await sb.auth.getSession(); if (s.data && s.data.session) await enter(s.data.session.user); else leave(); } catch (e) { leave(); } })();
})();
