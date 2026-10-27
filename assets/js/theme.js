/* PrioriBuy — pengatur tema (Terang / Gelap / Ikuti perangkat).
   Muat di <head> TANPA defer agar tema terpasang sebelum halaman digambar (tanpa kedipan putih). */
(function () {
  'use strict';
  var KEY = 'pb_theme', root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var LABEL = { light: 'Terang', dark: 'Gelap', system: 'Ikuti perangkat' };
  var ICON  = { light: 'bi-sun', dark: 'bi-moon-stars', system: 'bi-circle-half' };

  function stored() {
    try { var v = localStorage.getItem(KEY); return (v === 'light' || v === 'dark' || v === 'system') ? v : 'system'; }
    catch (e) { return 'system'; }
  }
  function effective(p) { return p === 'system' ? (mq && mq.matches ? 'dark' : 'light') : p; }

  var metaLight = null;
  function apply(p) {
    var t = effective(p);
    root.setAttribute('data-theme', t);
    root.setAttribute('data-bs-theme', t);
    root.setAttribute('data-theme-pref', p);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) { if (metaLight === null) metaLight = m.getAttribute('content'); m.setAttribute('content', t === 'dark' ? '#0e1424' : metaLight); }
    refreshUI();
  }
  function set(p, silent) {
    if (!LABEL[p]) return;
    try { localStorage.setItem(KEY, p); } catch (e) {}
    apply(p);
    if (!silent) window.dispatchEvent(new CustomEvent('pb-theme-change', { detail: { pref: p, theme: effective(p) } }));
  }

  /* ---------- UI ---------- */
  function build(slot) {
    if (slot.querySelector('.theme-toggle')) return;
    var wrap = document.createElement('div'); wrap.className = 'theme-wrap';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'theme-toggle'; btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<i class="bi"></i><span class="visually-hidden theme-label"></span>';
    var menu = document.createElement('div'); menu.className = 'theme-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    ['light', 'dark', 'system'].forEach(function (k) {
      var it = document.createElement('button'); it.type = 'button'; it.className = 'theme-opt'; it.setAttribute('role', 'menuitemradio'); it.dataset.pref = k;
      it.innerHTML = '<i class="bi ' + ICON[k] + '"></i><span>' + LABEL[k] + '</span><i class="bi bi-check2 ms-auto tick"></i>';
      it.addEventListener('click', function () { set(k); close(); });
      menu.appendChild(it);
    });
    function open() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden ? open() : close(); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
    wrap.appendChild(btn); wrap.appendChild(menu); slot.appendChild(wrap);
  }
  function refreshUI() {
    var p = root.getAttribute('data-theme-pref') || 'system';
    var all = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      b.querySelector('.bi').className = 'bi ' + ICON[p];
      b.querySelector('.theme-label').textContent = 'Tema: ' + LABEL[p];
      b.setAttribute('title', 'Tema: ' + LABEL[p]); b.setAttribute('aria-label', 'Ubah tema. Saat ini: ' + LABEL[p]);
    }
    var opts = document.querySelectorAll('.theme-opt');
    for (var j = 0; j < opts.length; j++) {
      var on = opts[j].dataset.pref === p;
      opts[j].setAttribute('aria-checked', on ? 'true' : 'false'); opts[j].classList.toggle('on', on);
    }
  }
  function mount() {
    var slots = document.querySelectorAll('[data-theme-slot]');
    if (!slots.length) {                       // halaman website: sisipkan ke navbar
      var ul = document.querySelector('#navMenu .navbar-nav');
      if (ul) { var li = document.createElement('li'); li.className = 'nav-item ms-lg-2 mt-2 mt-lg-0 theme-li'; li.setAttribute('data-theme-slot', ''); ul.insertBefore(li, ul.lastElementChild); slots = [li]; }
    }
    for (var i = 0; i < slots.length; i++) build(slots[i]);
    refreshUI();
  }

  window.PBTheme = { get: stored, effective: function () { return effective(stored()); }, set: set, remount: mount };
  apply(stored());
  if (mq) { var h = function () { if (stored() === 'system') apply('system'); }; mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h); }
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(stored()); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
