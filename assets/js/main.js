/* PrioriBuy — script bersama semua halaman */
(function(){
  'use strict';

  /* navbar: state saat scroll + tombol kembali ke atas */
  var nav = document.getElementById('mainNav');
  var toTop = document.getElementById('backToTop');
  function onScroll(){
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 30);
    if (toTop) toTop.classList.toggle('show', window.scrollY > 500);
  }
  window.addEventListener('scroll', onScroll, {passive:true});
  onScroll();
  if (toTop) toTop.addEventListener('click', function(){ window.scrollTo({top:0, behavior:'smooth'}); });

  /* tutup menu mobile setelah link diklik */
  document.querySelectorAll('#navMenu .nav-link').forEach(function(l){
    l.addEventListener('click', function(){
      var menu = document.getElementById('navMenu');
      if (menu && menu.classList.contains('show') && window.bootstrap){
        bootstrap.Collapse.getOrCreateInstance(menu).hide();
      }
    });
  });

  /* animasi muncul saat scroll */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window){
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ e.target.classList.add('is-visible'); observer.unobserve(e.target); }
      });
    }, {threshold:0.12});
    reveals.forEach(function(el){ observer.observe(el); });
  } else {
    reveals.forEach(function(el){ el.classList.add('is-visible'); });
  }

  /* form: cegah klik ganda */
  document.querySelectorAll('form[data-submit-once]').forEach(function(f){
    f.addEventListener('submit', function(){
      var b = f.querySelector('button[type="submit"]');
      if (b){ setTimeout(function(){ b.disabled = true; }, 0); }
    });
  });

  /* Beranda: demo prioritas di hero (skenario perlengkapan sekolah) */
  var demoData = {
    tinggi:{icon:'bi-person-badge', label:'Prioritas Tinggi', name:'Seragam baru sekolah', price:900000,
            note:'Kebutuhan sekolah yang mendesak, jadi layak didahulukan.'},
    sedang:{icon:'bi-pencil', label:'Prioritas Sedang', name:'Alat tulis sekolah', price:100000,
            note:'Dibutuhkan, tetapi bisa dibeli bertahap sesuai kebutuhan.'},
    rendah:{icon:'bi-bag-heart', label:'Prioritas Rendah', name:'Sepatu baru Nike', price:2400000,
            note:'Lebih ke keinginan dan bisa ditunda; sepatu lama masih layak pakai.'}
  };
  function formatRupiah(n){ return 'Rp' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  var demoCard = document.querySelector('.priority-item-card');
  function renderDemo(lvl){
    var d = demoData[lvl];
    if (!d || !demoCard) return;
    var iconBox = document.getElementById('demoIcon');
    var chip = document.getElementById('demoChip');
    var title = document.getElementById('demoTitle');
    var price = document.getElementById('demoPrice');
    var note = document.getElementById('demoNote');
    demoCard.dataset.level = lvl;
    if (iconBox) iconBox.innerHTML = '<i class="bi ' + d.icon + '"></i>';
    if (chip){ chip.textContent = d.label; chip.className = 'mock-chip chip-' + lvl; }
    if (title) title.textContent = d.name;
    if (price) price.textContent = formatRupiah(d.price);
    if (note){ note.textContent = d.note; note.className = 'item-note ' + lvl; }
  }
  document.querySelectorAll('.priority-pill').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.priority-pill').forEach(function(b){
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      renderDemo(btn.dataset.level);
    });
  });

  /* Beranda: tab preview aplikasi + grafik mini */
  var miniChart;
  function initMiniChart(){
    if (miniChart || !window.Chart) return;
    var ctx = document.getElementById('miniChart');
    if (!ctx) return;
    miniChart = new Chart(ctx, {
      type:'doughnut',
      data:{
        labels:['Tinggi','Sedang','Rendah'],
        datasets:[{ data:[45,35,20], backgroundColor:['#E85D9E','#3E7BFA','#3FA873'], borderWidth:0 }]
      },
      options:{
        plugins:{legend:{position:'bottom', labels:{boxWidth:10, font:{size:10, family:'Poppins'}}}},
        cutout:'62%'
      }
    });
  }
  document.querySelectorAll('.preview-tab-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.preview-tab-btn').forEach(function(b){ b.classList.remove('active'); });
      document.querySelectorAll('.preview-screen').forEach(function(s){ s.classList.remove('active'); });
      btn.classList.add('active');
      var target = document.getElementById(btn.dataset.target);
      if (target) target.classList.add('active');
      if (btn.dataset.target === 'screen-statistik'){ initMiniChart(); }
    });
  });
})();
