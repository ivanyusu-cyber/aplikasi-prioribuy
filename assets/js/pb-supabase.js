/* PrioriBuy — helper Supabase bersama (konsultasi.html & konsultan.html). Semua teks pengguna ditulis via textContent. */
(function () {
  'use strict';
  var cfg = window.PB_SUPABASE || {};
  var configured = !!(cfg.url && cfg.anonKey && /^https:\/\/[^\s]+$/.test(cfg.url) && !/GANTI|YOUR_|example\./i.test(cfg.url + cfg.anonKey));
  var client = null;

  function getClient() {
    if (client || !configured || !window.supabase) return client;
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } }
    });
    return client;
  }

  var ERR = {
    AUTH_REQUIRED: 'Silakan masuk terlebih dahulu.',
    PREMIUM_REQUIRED: 'Fitur ini hanya untuk pengguna PrioriBuy Premium.',
    DAILY_QUOTA_USED: 'Kuota konsultasi hari ini sudah terpakai. Kamu bisa mulai lagi besok (hari berganti pukul 00.00 WIB).',
    SESSION_NOT_FOUND: 'Sesi tidak ditemukan.',
    SESSION_NOT_ACTIVE: 'Sesi belum aktif atau sudah berakhir, jadi pesan tidak dapat dikirim.',
    SESSION_EXPIRED: 'Waktu sesi 120 menit sudah habis. Pesan tidak dapat dikirim.',
    INVALID_MESSAGE: 'Pesan harus berisi 1 sampai 1000 karakter.',
    MESSAGE_LIMIT: 'Batas jumlah pesan pada sesi ini sudah tercapai.',
    INVALID_STATE: 'Tindakan ini tidak dapat dilakukan pada status sesi saat ini.',
    FORBIDDEN: 'Kamu tidak memiliki akses untuk tindakan ini.',
    USER_NOT_PREMIUM: 'Premium pengguna ini sudah tidak aktif.',
    PAYMENT_ALREADY_PENDING: 'Kamu masih memiliki pembayaran yang menunggu verifikasi.',
    INVALID_PROOF: 'Bukti pembayaran tidak valid. Unggah ulang.',
    PAYMENT_NOT_FOUND: 'Data pembayaran tidak ditemukan.',
    'Invalid login credentials': 'Email atau kata sandi salah.',
    'Email not confirmed': 'Email belum dikonfirmasi. Cek kotak masuk emailmu.',
    'User already registered': 'Email ini sudah terdaftar. Silakan masuk.'
  };
  function errText(e) {
    var m = (e && (e.message || e.error_description)) || '';
    for (var k in ERR) if (Object.prototype.hasOwnProperty.call(ERR, k) && m.indexOf(k) !== -1) return ERR[k];
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Tidak ada koneksi internet. Coba lagi setelah online.';
    return 'Terjadi kesalahan. Coba lagi beberapa saat.';
  }
  async function rpc(name, args) {
    var r = await getClient().rpc(name, args || {});
    if (r.error) throw r.error;
    return r.data;
  }

  /* Keluar: hapus sesi Supabase, data sementara di tab, dan cache privat (bila ada) agar pengguna berikutnya tidak melihatnya */
  async function signOut() {
    var c = getClient();
    try { if (c) await c.auth.signOut(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('sb-') === 0) localStorage.removeItem(k); });
    } catch (e) {}
    try {
      if (window.caches) caches.keys().then(function (ks) { ks.filter(function (k) { return k.indexOf('pb-private') === 0; }).forEach(function (k) { caches.delete(k); }); });
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_PRIVATE' });
    } catch (e) {}
  }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  /* Formulir masuk / daftar. onSuccess(user) dipanggil setelah sesi tersedia. */
  function mountAuth(box, onSuccess, opts) {
    opts = opts || {};
    box.innerHTML =
      '<div class="auth-tabs-pb" role="tablist"><button type="button" class="on" data-t="in" role="tab">Masuk</button>' +
      (opts.noRegister ? '' : '<button type="button" data-t="up" role="tab">Daftar</button>') + '</div>' +
      '<div class="alert-pb alert-pb--error" data-err hidden role="alert"><i class="bi bi-exclamation-circle"></i><span></span></div>' +
      '<div class="alert-pb alert-pb--ok" data-ok hidden role="status"><i class="bi bi-check-circle"></i><span></span></div>' +
      '<form data-f="in" novalidate><label class="form-label-pb" for="aEmail">Email</label>' +
      '<input class="form-control-pb" id="aEmail" type="email" autocomplete="username" maxlength="254">' +
      '<label class="form-label-pb mt-3" for="aPass">Kata sandi</label>' +
      '<input class="form-control-pb" id="aPass" type="password" autocomplete="current-password" maxlength="72">' +
      '<button class="btn btn-pb-primary w-100 mt-4" type="submit">Masuk</button></form>' +
      '<form data-f="up" novalidate hidden><label class="form-label-pb" for="uName">Nama</label>' +
      '<input class="form-control-pb" id="uName" type="text" autocomplete="name" maxlength="60">' +
      '<label class="form-label-pb mt-3" for="uEmail">Email</label>' +
      '<input class="form-control-pb" id="uEmail" type="email" autocomplete="username" maxlength="254">' +
      '<label class="form-label-pb mt-3" for="uPass">Kata sandi (min. 8 karakter)</label>' +
      '<input class="form-control-pb" id="uPass" type="password" autocomplete="new-password" maxlength="72">' +
      '<button class="btn btn-pb-primary w-100 mt-4" type="submit">Buat Akun</button></form>';
    var errBox = box.querySelector('[data-err]'), okBox = box.querySelector('[data-ok]');
    function show(which, msg) { errBox.hidden = okBox.hidden = true; if (msg) { var b = which === 'err' ? errBox : okBox; b.hidden = false; b.querySelector('span').textContent = msg; } }
    box.querySelectorAll('[data-t]').forEach(function (b) {
      b.addEventListener('click', function () {
        box.querySelectorAll('[data-t]').forEach(function (x) { x.classList.toggle('on', x === b); });
        box.querySelector('[data-f=in]').hidden = b.dataset.t !== 'in'; box.querySelector('[data-f=up]').hidden = b.dataset.t !== 'up'; show();
      });
    });
    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    box.querySelector('[data-f=in]').addEventListener('submit', async function (e) {
      e.preventDefault(); show();
      var email = box.querySelector('#aEmail').value.trim().toLowerCase(), pass = box.querySelector('#aPass').value, btn = e.target.querySelector('button[type=submit]');
      if (!EMAIL.test(email) || !pass) { show('err', 'Isi email yang valid dan kata sandi.'); return; }
      btn.disabled = true;
      try {
        var r = await getClient().auth.signInWithPassword({ email: email, password: pass });
        if (r.error) throw r.error;
        box.querySelector('#aPass').value = '';
        onSuccess(r.data.user);
      } catch (err) { show('err', errText(err)); } finally { btn.disabled = false; }
    });
    box.querySelector('[data-f=up]').addEventListener('submit', async function (e) {
      e.preventDefault(); show();
      var name = box.querySelector('#uName').value.trim(), email = box.querySelector('#uEmail').value.trim().toLowerCase(), pass = box.querySelector('#uPass').value, btn = e.target.querySelector('button[type=submit]');
      if (!name) { show('err', 'Nama wajib diisi.'); return; }
      if (!EMAIL.test(email)) { show('err', 'Masukkan alamat email yang valid.'); return; }
      if (pass.length < 8) { show('err', 'Kata sandi minimal 8 karakter.'); return; }
      btn.disabled = true;
      try {
        var r = await getClient().auth.signUp({ email: email, password: pass, options: { data: { name: name } } });
        if (r.error) throw r.error;
        box.querySelector('#uPass').value = '';
        if (r.data.session) onSuccess(r.data.user);
        else show('ok', 'Akun dibuat. Cek emailmu untuk konfirmasi, lalu masuk.');
      } catch (err) { show('err', errText(err)); } finally { btn.disabled = false; }
    });
  }

  window.PBSB = { configured: configured, client: getClient, rpc: rpc, errText: errText, signOut: signOut, mountAuth: mountAuth, el: el };
})();
