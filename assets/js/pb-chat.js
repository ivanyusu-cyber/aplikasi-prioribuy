/* PrioriBuy — komponen chat konsultasi (dipakai pengguna & konsultan).
   Waktu sesi SELALU dari server: expires_at dari database + selisih waktu server yang dihitung dengan performance.now()
   (monoton, tidak terpengaruh jika jam perangkat diubah). Pesan hanya dikirim lewat RPC send_consultation_message. */
(function () {
  'use strict';
  var fmtTime = function (iso) { try { return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }); } catch (e) { return ''; } };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var NOTE = {
    WAITING: 'Menunggu konsultan memulai sesi. Durasi 120 menit baru berjalan setelah sesi dimulai.',
    COMPLETED: 'Sesi telah diakhiri. Pesan baru tidak dapat dikirim.',
    EXPIRED: 'Waktu sesi 120 menit sudah habis. Pesan baru tidak dapat dikirim.',
    CANCELLED: 'Sesi dibatalkan.'
  };

  window.PBChat = function (o) {
    var sb = o.sb, E = o.els, me = o.meId, S = null, msgs = new Map(), channel = null;
    var base = { server: Date.now(), perf: performance.now() }, tickT = null, syncT = null, pollT = null, live = false, closed = false;

    function serverNow() { return base.server + (performance.now() - base.perf); }
    async function sync() {
      var r = await sb.rpc('server_time');
      if (!r.error && r.data) { base = { server: new Date(r.data).getTime(), perf: performance.now() }; }
    }
    function setConn(state) {
      if (!E.conn) return;
      var on = state === 'ok';
      E.conn.className = 'conn-dot ' + (on ? 'ok' : state === 'wait' ? 'wait' : 'off');
      if (E.connText) E.connText.textContent = on ? 'Terhubung' : state === 'wait' ? 'Menghubungkan…' : (navigator.onLine ? 'Terputus, mencoba lagi' : 'Offline');
    }
    function add(m) {
      if (!m || msgs.has(m.id)) return;
      msgs.set(m.id, m);
      var mine = m.sender_id === me;
      var row = document.createElement('div'); row.className = 'msg ' + (mine ? 'mine' : 'theirs'); row.dataset.id = m.id;
      var who = document.createElement('div'); who.className = 'msg-who';
      who.textContent = (mine ? 'Kamu' : (m.sender_role === 'consultant' ? 'Konsultan PrioriBuy' : (o.peerLabel || 'Pengguna'))) + ' · ' + fmtTime(m.created_at);
      var body = document.createElement('div'); body.className = 'msg-body'; body.textContent = m.body;
      row.appendChild(who); row.appendChild(body);
      var near = E.list.scrollHeight - E.list.scrollTop - E.list.clientHeight < 80;
      E.list.appendChild(row); if (near || mine) E.list.scrollTop = E.list.scrollHeight;
      var empty = E.list.querySelector('.chat-empty'); if (empty) empty.remove();
    }
    async function loadMessages() {
      var r = await sb.from('consultation_messages').select('*').eq('session_id', S.id).order('created_at', { ascending: true }).limit(1000);
      if (r.error) throw r.error;
      r.data.forEach(add);
    }
    function render() {
      var active = S && S.status === 'ACTIVE' && !expired();
      E.input.disabled = !active; E.send.disabled = !active;
      if (E.end) E.end.hidden = !(S && S.status === 'ACTIVE');
      if (E.status) { E.status.textContent = S ? S.status : ''; E.status.dataset.s = S ? S.status : ''; }
      if (E.note) { var n = S && !active ? (S.status === 'ACTIVE' ? NOTE.EXPIRED : NOTE[S.status] || '') : ''; E.note.textContent = n; E.note.hidden = !n; }
      if (!active && E.timer) E.timer.textContent = S && S.status === 'ACTIVE' ? '00:00:00' : '--:--:--';
      tick();
      if (o.onSession) o.onSession(S);
    }
    function expired() { return !!(S && S.expires_at && new Date(S.expires_at).getTime() <= serverNow()); }
    function tick() {
      if (!S || S.status !== 'ACTIVE' || !E.timer) return;
      var left = Math.max(0, Math.floor((new Date(S.expires_at).getTime() - serverNow()) / 1000));
      E.timer.textContent = pad(Math.floor(left / 3600)) + ':' + pad(Math.floor(left % 3600 / 60)) + ':' + pad(left % 60);
      E.timer.classList.toggle('low', left <= 600);
      if (left === 0 && !tick.fin) { tick.fin = true; finalize(); }
    }
    async function finalize() {   // waktu habis: minta server menandai EXPIRED (idempotent)
      try { await sb.rpc('end_consultation', { p_session_id: S.id }); } catch (e) {}
      await refresh(); tick.fin = false;
    }
    async function refresh() {
      if (!S || closed) return;
      try {
        await sync();
        var r = await sb.from('consultation_sessions').select('*').eq('id', S.id).maybeSingle();
        if (r.error) throw r.error;
        if (r.data) S = r.data;
        render();
        if (S.status === 'ACTIVE' && expired() && !tick.fin) { tick.fin = true; await finalize(); }
      } catch (e) { /* koneksi bermasalah: dicoba lagi oleh pengatur waktu */ }
    }
    function startPoll(on) {   // cadangan ringan HANYA saat Realtime terputus
      if (on && !pollT) pollT = setInterval(async function () { if (S) { try { await loadMessages(); } catch (e) {} refresh(); } }, 15000);
      if (!on && pollT) { clearInterval(pollT); pollT = null; }
    }
    function subscribe() {
      setConn('wait');
      channel = sb.channel('pb-chat-' + S.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'consultation_messages', filter: 'session_id=eq.' + S.id }, function (p) { add(p.new); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'consultation_sessions', filter: 'id=eq.' + S.id }, function () { refresh(); })
        .subscribe(function (status) {
          if (status === 'SUBSCRIBED') { live = true; setConn('ok'); startPoll(false); loadMessages().catch(function () {}); refresh(); }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { live = false; setConn('off'); startPoll(true); }
        });
    }

    var api = {
      async open(session) {
        api.close(true); closed = false; S = session; msgs.clear(); E.list.textContent = '';
        var empty = document.createElement('div'); empty.className = 'chat-empty'; empty.textContent = 'Belum ada pesan.'; E.list.appendChild(empty);
        await sync(); render(); tick(); tickT = setInterval(tick, 1000); syncT = setInterval(function () { sync(); }, 60000);
        try { await loadMessages(); } catch (e) {}
        if (S.status === 'ACTIVE' || S.status === 'WAITING') subscribe(); else setConn('off');
        render();
      },
      refresh: refresh,
      async send() {
        var text = E.input.value.trim();
        if (!text) return { ok: false, error: 'Tulis pesan terlebih dahulu.' };
        if (text.length > 1000) return { ok: false, error: 'Pesan maksimal 1000 karakter.' };
        E.send.disabled = true;
        try {
          var r = await sb.rpc('send_consultation_message', { p_session_id: S.id, p_body: text });
          if (r.error) throw r.error;
          add(r.data); E.input.value = ''; return { ok: true };
        } catch (e) { refresh(); return { ok: false, error: PBSB.errText(e) }; }
        finally { E.send.disabled = !(S && S.status === 'ACTIVE' && !expired()); }
      },
      async end() {
        var r = await sb.rpc('end_consultation', { p_session_id: S.id });
        if (r.error) throw r.error;
        S = r.data; render(); return S;
      },
      get session() { return S; },
      close: function (keep) {
        if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; }
        clearInterval(tickT); clearInterval(syncT); startPoll(false);
        if (!keep) { closed = true; S = null; msgs.clear(); E.list.textContent = ''; }
      }
    };
    window.addEventListener('online', function () { if (S) refresh(); });
    window.addEventListener('offline', function () { setConn('off'); });
    return api;
  };
})();
