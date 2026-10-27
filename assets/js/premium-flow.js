/**
 * Alur PrioriBuy Premium (tanpa database): email -> QRIS -> "Saya Sudah Bayar" -> EmailJS.
 * - Email disimpan di sessionStorage (TIDAK di URL).
 * - Status transaksi SELALU "PENDING". Tombol "Saya Sudah Bayar" bukan bukti pembayaran;
 *   verifikasi dilakukan manual oleh admin.
 */
(function () {
  'use strict';

  var KEY = 'pb_tx';
  var PRODUCT = 'PrioriBuy Premium';
  var PRICE = 'Rp49.000';
  var STATUS = 'PENDING';
  var ERR_EMAIL = 'Silakan masukkan alamat email yang valid.';
  var ERR_SEND = 'Konfirmasi belum dapat dikirim. Silakan coba lagi.';

  /* ---------- penyimpanan sesi ---------- */
  function load() {
    try { var r = sessionStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function save(tx) {
    try { sessionStorage.setItem(KEY, JSON.stringify(tx)); return true; } catch (e) { return false; }
  }

  /* ---------- validasi & sanitasi email ---------- */
  function validEmail(raw) {
    if (typeof raw !== 'string') return { ok: false, msg: ERR_EMAIL };
    var v = raw.trim();
    if (v === '' || v.length > 254) return { ok: false, msg: ERR_EMAIL };
    if (/[\u0000-\u0020\u007f<>"'`;\\(),:\[\]{}|]/.test(v)) return { ok: false, msg: ERR_EMAIL };
    if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$/.test(v)) return { ok: false, msg: ERR_EMAIL };
    return { ok: true, value: v.toLowerCase() };
  }

  /* ---------- Transaction ID unik: PB-YYYYMMDD-XXXXXX ---------- */
  function genId() {
    var d = new Date();
    var ymd = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    var buf = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < buf.length; i++) out += alphabet.charAt(buf[i] % alphabet.length);
    return 'PB-' + ymd + '-' + out;
  }

  /* ---------- waktu konfirmasi (WIB) ---------- */
  function formatDT(date) {
    try {
      var parts = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(date);
      var m = {};
      parts.forEach(function (p) { m[p.type] = p.value; });
      return m.day + ' ' + m.month + ' ' + m.year + ', ' + m.hour + '.' + m.minute + ' WIB';
    } catch (e) {
      return date.toISOString();
    }
  }

  function $(id) { return document.getElementById(id); }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }
  function showError(id, msg) {
    var box = $(id);
    if (!box) return;
    var span = box.querySelector('span');
    if (span) span.textContent = msg;
    box.style.display = 'flex';
  }
  function hideError(id) { var box = $(id); if (box) box.style.display = 'none'; }

  /* ============ HALAMAN 1: mulai-premium.php ============ */
  var form = $('formMulai');
  if (form) {
    var emailInput = $('email');
    var existing = load();
    if (existing && existing.email && !existing.confirmed && emailInput && !emailInput.value) {
      emailInput.value = existing.email;
    }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      hideError('formError');
      var hp = $('website');
      if (hp && hp.value) { showError('formError', 'Permintaan tidak dapat diproses.'); return; }
      var r = validEmail(emailInput.value);
      if (!r.ok) {
        emailInput.classList.add('is-invalid');
        showError('formError', r.msg);
        return;
      }
      emailInput.classList.remove('is-invalid');
      var prev = load();
      var tx;
      if (prev && !prev.confirmed && prev.email === r.value) {
        tx = prev; // lanjutkan transaksi yang belum dikonfirmasi (hindari ID ganda)
      } else {
        tx = { email: r.value, product: PRODUCT, price: PRICE, payment_status: STATUS };
      }
      if (!save(tx)) {
        showError('formError', 'Browser Anda memblokir penyimpanan sesi. Aktifkan penyimpanan lokal lalu coba lagi.');
        return;
      }
      window.location.href = 'pembayaran.php';
    });
  }

  /* ============ HALAMAN 2: pembayaran.php ============ */
  var payBtn = $('btnSudahBayar');
  if (payBtn) {
    var tx0 = load();
    if (!tx0 || !tx0.email) { window.location.replace('mulai-premium.php'); return; }
    if (tx0.confirmed) { window.location.replace('konfirmasi.php'); return; }
    setText('sumEmail', tx0.email);
    setText('sumId', tx0.transaction_id || 'Dibuat saat konfirmasi');

    var cfg = window.PB_EMAILJS || {};
    var busy = false;
    var labelNormal = payBtn.textContent;

    if (window.emailjs && cfg.PUBLIC_KEY) {
      window.emailjs.init({ publicKey: cfg.PUBLIC_KEY });
    }

    var isPlaceholder = function (v) { return !v || /^YOUR_/i.test(v); };

    payBtn.addEventListener('click', async function () {
      if (busy) return;
      busy = true;
      hideError('payError');

      var tx = load();
      if (!tx || !tx.email) { window.location.replace('mulai-premium.php'); return; }

      var r = validEmail(tx.email);
      if (!r.ok) { showError('payError', r.msg); busy = false; return; }

      if (!window.emailjs) {
        console.error('EmailJS Error: SDK belum termuat (periksa koneksi / pemblokir iklan).');
        showError('payError', ERR_SEND);
        busy = false;
        return;
      }
      if (isPlaceholder(cfg.SERVICE_ID) || isPlaceholder(cfg.BUYER_TEMPLATE_ID) || isPlaceholder(cfg.ADMIN_TEMPLATE_ID)) {
        console.error('EmailJS Error: Service ID / Template ID belum diisi di assets/js/emailjs-config.js');
        showError('payError', ERR_SEND);
        busy = false;
        return;
      }

      payBtn.disabled = true;
      payBtn.textContent = 'Mengirim konfirmasi...';

      // ID & waktu dibuat sekali, dipakai ulang jika pengiriman diulang
      if (!tx.transaction_id) tx.transaction_id = genId();
      if (!tx.confirmation_time) tx.confirmation_time = formatDT(new Date());
      tx.email = r.value;
      tx.payment_status = STATUS;
      save(tx);

      var siteUrl = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');

      var buyerParams = {
        transaction_id: tx.transaction_id,
        email: tx.email,
        to_email: tx.email,
        reply_to: cfg.ADMIN_EMAIL,
        product: PRODUCT,
        price: PRICE,
        confirmation_time: tx.confirmation_time,
        payment_status: STATUS,
        website_url: siteUrl
      };
      var adminParams = {
        transaction_id: tx.transaction_id,
        buyer_email: tx.email,
        email: tx.email,
        to_email: cfg.ADMIN_EMAIL,
        reply_to: tx.email,
        product: PRODUCT,
        price: PRICE,
        confirmation_time: tx.confirmation_time,
        payment_status: STATUS,
        website_url: siteUrl
      };

      try {
        if (!tx.buyer_sent) {
          await window.emailjs.send(cfg.SERVICE_ID, cfg.BUYER_TEMPLATE_ID, buyerParams);
          tx.buyer_sent = true; save(tx);
        }
        if (!tx.admin_sent) {
          await window.emailjs.send(cfg.SERVICE_ID, cfg.ADMIN_TEMPLATE_ID, adminParams);
          tx.admin_sent = true; save(tx);
        }
        // Hanya setelah KEDUA email berhasil
        tx.confirmed = true; tx.payment_status = STATUS; save(tx);
        window.location.href = 'konfirmasi.php';
      } catch (error) {
        console.error('EmailJS Error:', error);
        showError('payError', ERR_SEND);
        payBtn.disabled = false;
        payBtn.textContent = labelNormal;
        busy = false;
      }
    });
  }

  /* ============ HALAMAN 3: konfirmasi.php ============ */
  var box = $('konfirmasiBox');
  if (box) {
    var t = load();
    if (!t || !t.email) { window.location.replace('mulai-premium.php'); return; }
    if (!t.confirmed) { window.location.replace('pembayaran.php'); return; }
    setText('cId', t.transaction_id);
    setText('cEmail', t.email);
    setText('cProduct', PRODUCT + ' — ' + PRICE);
    setText('cTime', t.confirmation_time);
  }

  /* dipakai untuk pengujian */
  window.PBFlow = { validEmail: validEmail, genId: genId, formatDT: formatDT };
})();
