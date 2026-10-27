/* PrioriBuy — pemasangan PWA (Android/Chrome) + pendaftaran service worker + pemberitahuan pembaruan.
   Tombol "Pasang" hanya muncul bila browser benar-benar mengirim `beforeinstallprompt`. Jika tidak, ditampilkan petunjuk manual. */
(function () {
  'use strict';
  var deferred = null, ua = navigator.userAgent || '';
  var isAndroid = /Android/i.test(ua), isIOS = /iPhone|iPad|iPod/i.test(ua);
  var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  function standalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }

  function steps() {
    if (!secure) return 'Pemasangan membutuhkan koneksi aman (HTTPS). Buka lewat alamat https:// lalu coba lagi.';
    if (isIOS) return 'Di iPhone/iPad (Safari): ketuk tombol Bagikan, lalu pilih "Tambahkan ke Layar Utama".';
    if (isAndroid) return 'Di Android (Chrome): ketuk menu ⋮ di pojok kanan atas, lalu pilih "Instal aplikasi" atau "Tambahkan ke layar utama". Jika menu itu belum muncul, muat ulang halaman dan coba lagi.';
    return 'Di Chrome atau Edge: klik ikon pasang di bilah alamat, atau buka menu lalu pilih "Instal PrioriBuy".';
  }
  function render() {
    var st = standalone() ? 'installed' : (deferred ? 'prompt' : 'manual');
    document.querySelectorAll('[data-pwa-install]').forEach(function (box) {
      var q = function (s) { return box.querySelector(s); };
      if (q('[data-pwa-btn]')) q('[data-pwa-btn]').hidden = st !== 'prompt';
      if (q('[data-pwa-installed]')) q('[data-pwa-installed]').hidden = st !== 'installed';
      if (q('[data-pwa-manual]')) { q('[data-pwa-manual]').hidden = st !== 'manual'; if (q('[data-pwa-steps]')) q('[data-pwa-steps]').textContent = steps(); }
    });
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; render(); });
  window.addEventListener('appinstalled', function () { deferred = null; render(); });
  if (window.matchMedia) { var m = matchMedia('(display-mode: standalone)'); (m.addEventListener ? m.addEventListener.bind(m, 'change') : m.addListener.bind(m))(render); }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pwa-btn]'); if (!b || !deferred) return;
    deferred.prompt(); deferred.userChoice.finally(function () { deferred = null; render(); });
  });
  function mount() { render(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  /* service worker + pembaruan */
  function banner(reg) {
    if (document.getElementById('pwaUpdate')) return;
    var d = document.createElement('div'); d.id = 'pwaUpdate'; d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));z-index:3000;background:#1C2541;color:#fff;padding:12px 16px;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center;font-size:.9rem;max-width:92vw';
    d.innerHTML = '<span>Versi baru PrioriBuy tersedia.</span><button type="button" style="border:0;border-radius:50px;padding:6px 14px;font-weight:600;background:#fec600;color:#1C2541">Muat ulang</button>';
    d.querySelector('button').addEventListener('click', function () { if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); location.reload(); });
    document.body.appendChild(d);
  }
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        reg.addEventListener('updatefound', function () {
          var w = reg.installing; if (!w) return;
          w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) banner(reg); });
        });
      }).catch(function () {});
    });
  }
  window.PBInstall = {
    standalone: standalone, steps: steps,
    canPrompt: function () { return !!deferred; },
    prompt: function () { if (!deferred) return false; deferred.prompt(); deferred.userChoice.finally(function () { deferred = null; render(); window.dispatchEvent(new Event('pb-install-change')); }); return true; }
  };
  window.addEventListener('beforeinstallprompt', function () { window.dispatchEvent(new Event('pb-install-change')); });
})();
