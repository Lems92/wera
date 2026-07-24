/* appel.js — web-app Wera : appel vidéo réel (Socket.IO + PeerJS + TURN).
 *
 * L'UI (états [data-state], tuiles, chat, mini-jeux) est celle du design
 * statique ; ce fichier remplace l'ancienne simulation par le vrai backend :
 *   - matchmaking via Socket.IO en long-polling uniquement (derrière
 *     Cloudflare + Render, l'upgrade websocket est fragile sur mobile),
 *   - vidéo via PeerJS avec credentials TURN renouvelés à chaque match
 *     (sans relais TURN, deux clients en 4G/CGNAT ne se joignent jamais),
 *   - chien de garde : re-appel automatique du même partenaire si WebRTC
 *     décroche (micro-coupures radio fréquentes sur mobile).
 */
(function () {
  var API = window.WeraAPI;

  // ── état global ────────────────────────────────────────────────────────
  var app;
  var socket = null;
  var peer = null;
  var peerId = null;
  var localStream = null;
  var currentCall = null;
  var phase = 'idle';            // idle | waiting | connected
  var pendingFind = false;
  var partnerPeerId = null;
  var partnerUserId = null;
  var currentMatchId = null;   // estampille de la paire (serveur) — sert de callId au signalement
  var isInitiator = false;
  var recoverTimer = null;
  var recoverAttempts = 0;
  var mic = true, cam = true;
  var timerInt = null, seconds = 0;
  var selfVideoEl = null, partnerVideoEl = null;

  function $(s) { return document.querySelector(s); }

  // ── helpers UI (repris du design) ──────────────────────────────────────
  function show(state) {
    document.querySelectorAll('[data-state]').forEach(function (el) {
      el.style.display = el.getAttribute('data-state') === state ? '' : 'none';
    });
    app.setAttribute('data-current', state);
    var bar = $('.app-bar');
    if (bar) bar.style.display = (state === 'active') ? 'none' : '';
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function setPartnerOverlay(visible, label) {
    var overlay = $('#partnerOverlay');
    if (!overlay) return;
    overlay.style.display = visible ? 'flex' : 'none';
    var p = overlay.querySelector('p');
    if (p && label) p.textContent = label;
  }

  function startTimer() {
    seconds = 0; stopTimer();
    timerInt = setInterval(function () {
      seconds++;
      var m = String(Math.floor(seconds / 60)).padStart(2, '0');
      var s = String(seconds % 60).padStart(2, '0');
      var el = $('#calltimer'); if (el) el.textContent = m + ':' + s;
    }, 1000);
  }
  function stopTimer() { if (timerInt) clearInterval(timerInt); timerInt = null; }

  function clearChat() {
    var c = $('#chatOverlay'); if (!c) return;
    c.innerHTML = '<div class="chat-hint">Dis akory pour commencer 👋</div>';
  }
  function removeHint() {
    var h = $('#chatOverlay .chat-hint'); if (h) h.remove();
  }
  function addBubble(text, who) {
    var c = $('#chatOverlay'); if (!c) return;
    removeHint();
    var b = document.createElement('div');
    b.className = 'bubble ' + (who || 'me');
    b.textContent = text;
    c.appendChild(b);
    c.scrollTop = c.scrollHeight;
    setTimeout(function () {
      if (!b.parentNode) return;
      b.classList.add('fade');
      setTimeout(function () { if (b.parentNode) b.remove(); }, 760);
    }, 7000);
  }

  // ── vidéos : injectées dans les tuiles du design ───────────────────────
  function ensureVideoEls() {
    if (!selfVideoEl) {
      selfVideoEl = document.createElement('video');
      selfVideoEl.autoplay = true; selfVideoEl.playsInline = true; selfVideoEl.muted = true;
      selfVideoEl.setAttribute('playsinline', '');
      selfVideoEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);background:#000;';
      $('#selfVideo').appendChild(selfVideoEl);
    }
    if (!partnerVideoEl) {
      partnerVideoEl = document.createElement('video');
      partnerVideoEl.autoplay = true; partnerVideoEl.playsInline = true;
      partnerVideoEl.setAttribute('playsinline', '');
      partnerVideoEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;';
      $('#partnerVideo').appendChild(partnerVideoEl);
    }
  }

  function attachRemoteStream(stream) {
    ensureVideoEls();
    partnerVideoEl.srcObject = stream;
    var p = partnerVideoEl.play();
    if (p && p.catch) p.catch(function () {
      toast('Touche l\'écran pour activer le son 🔊');
      var once = function () {
        partnerVideoEl.play().catch(function () {});
        document.removeEventListener('click', once);
      };
      document.addEventListener('click', once);
    });
  }

  // ── ICE / TURN ─────────────────────────────────────────────────────────
  var DEFAULT_ICE = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' }
  ];

  function fetchIceServers() {
    return API.req('/turn/credentials').then(function (r) {
      if (r.data && !r.data.relayAvailable) {
        console.warn('Aucun relais TURN configuré — les appels mobile↔mobile ne pourront pas s\'établir.');
      } else if (r.data) {
        console.info('TURN relay actif — provider:', r.data.provider);
      }
      return (r.data && r.data.iceServers && r.data.iceServers.length) ? r.data.iceServers : DEFAULT_ICE;
    }).catch(function () { return DEFAULT_ICE; });
  }

  // PeerJS relit options.config à chaque RTCPeerConnection : rafraîchir
  // l'objet partagé suffit pour repartir avec des credentials frais.
  function refreshIceConfig() {
    return fetchIceServers().then(function (servers) {
      if (peer && peer.options && peer.options.config) {
        peer.options.config.iceServers = servers;
      }
      return servers;
    });
  }

  // ── Socket.IO ──────────────────────────────────────────────────────────
  function initSocket() {
    if (socket) return;
    socket = io(API.SOCKET_ORIGIN, {
      // Long-polling uniquement : l'upgrade websocket meurt régulièrement
      // derrière Cloudflare + Render free sur données mobiles, et chaque
      // échec tue la session (400 « Session ID unknown » en boucle).
      transports: ['polling'],
      upgrade: false,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 60000
    });

    socket.on('connect', function () { maybeStartSearch(); });

    socket.on('connect_error', function (err) {
      var msg = (err && err.message) || '';
      if (msg === 'Auth required' || msg === 'Invalid token' || msg === 'Token revoked') {
        API.clearStoredUser();
        location.href = 'auth.html#connexion';
      } else if (msg === 'Banned') {
        toast('Ton compte a été suspendu.');
      }
    });

    socket.on('waiting', function () {
      if (phase !== 'connected') { phase = 'waiting'; }
    });

    socket.on('partner_found', function (data) {
      pendingFind = false;
      partnerPeerId = data.partnerPeerId;
      partnerUserId = data.partnerUserId || null;
      currentMatchId = data.matchId || null;
      isInitiator = Boolean(data.initiator);
      recoverAttempts = 0;
      clearRecoverTimer();
      var wasActive = (app.getAttribute('data-current') === 'active');
      phase = 'connected';
      if (!wasActive) { clearChat(); show('connecting'); }

      var startCall = function () {
        if (phase !== 'connected' || partnerPeerId !== data.partnerPeerId) return;
        if (isInitiator) placeCall(data.partnerPeerId);
        // L'appelé attend l'appel entrant (géré dans peer.on('call')).
      };
      // L'initiateur repart avec des credentials TURN frais : ceux du
      // chargement de page peuvent avoir expiré.
      if (isInitiator) refreshIceConfig().then(startCall, startCall);
      else startCall();
    });

    socket.on('receive_message', function (msg) {
      if (msg && typeof msg.text === 'string') addBubble(msg.text, 'them');
    });

    socket.on('partner_left', function () {
      closeCurrentCall();
      partnerPeerId = null; partnerUserId = null; currentMatchId = null;
      clearRecoverTimer();
      if (app.getAttribute('data-current') === 'active') {
        // Reste dans l'écran d'appel, overlay « Manaraka… », et on recherche.
        stopTimer();
        setPartnerOverlay(true, 'Manaraka…');
        phase = 'waiting';
        pendingFind = true;
        maybeStartSearch();
      } else {
        phase = 'waiting';
        pendingFind = true;
        show('searching');
        maybeStartSearch();
      }
    });

    socket.on('skipped', function () {
      pendingFind = false;
      if (phase !== 'connected') { phase = 'idle'; show('idle'); }
    });
  }

  function maybeStartSearch() {
    if (phase === 'connected') { pendingFind = false; return; }
    if (!pendingFind) return;
    if (!localStream || !peerId || !socket || !socket.connected) return;
    pendingFind = false;
    phase = 'waiting';
    socket.emit('find_partner', { peerId: peerId });
  }

  // ── PeerJS ─────────────────────────────────────────────────────────────
  function initPeer() {
    if (peer) return;
    fetchIceServers().then(function (iceServers) {
      if (peer) return;
      peer = new Peer(undefined, {
        host: 'api.wera.mg',
        port: 443,
        secure: true,
        path: '/peerjs',
        config: { iceServers: iceServers }
      });

      peer.on('open', function (id) {
        peerId = id;
        maybeStartSearch();
      });

      peer.on('call', function (call) {
        if (!localStream) return;
        // Un appel entrant remplace l'ancien — c'est aussi le chemin par
        // lequel l'initiateur nous « rappelle » après une coupure réseau.
        closeCurrentCall();
        currentCall = call;
        call.answer(localStream);
        call.on('stream', onRemoteStream);
        call.on('error', function (err) { console.error('Call error:', err); });
        watchCall(call);
      });

      peer.on('error', function (err) { console.error('Peer error:', err); });
      peer.on('disconnected', function () {
        try { peer.reconnect(); } catch (e) { /* ignore */ }
      });
    });
  }

  function placeCall(pid) {
    if (!peer || !localStream) return;
    closeCurrentCall();
    var call = peer.call(pid, localStream);
    if (!call) return;
    currentCall = call;
    call.on('stream', onRemoteStream);
    call.on('error', function (err) { console.error('Call error:', err); });
    watchCall(call);
  }

  function onRemoteStream(remoteStream) {
    attachRemoteStream(remoteStream);
    setPartnerOverlay(false);
    if (app.getAttribute('data-current') !== 'active') {
      show('active');
      clearChat();
    }
    startTimer();
  }

  function closeCurrentCall() {
    if (currentCall) {
      try { currentCall.close(); } catch (e) { /* ignore */ }
      currentCall = null;
    }
    if (partnerVideoEl) partnerVideoEl.srcObject = null;
  }

  // ── Chien de garde : reconnexion automatique de l'appel ────────────────
  function clearRecoverTimer() {
    if (recoverTimer) { clearTimeout(recoverTimer); recoverTimer = null; }
  }

  function callAlive() {
    var pc = currentCall && currentCall.peerConnection;
    var st = pc && pc.iceConnectionState;
    return st === 'connected' || st === 'completed';
  }

  function watchCall(call) {
    var pc = call.peerConnection;
    if (!pc) {
      setTimeout(function () { if (call === currentCall) watchCall(call); }, 500);
      return;
    }
    pc.oniceconnectionstatechange = function () {
      if (call !== currentCall) return;
      var st = pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') {
        recoverAttempts = 0;
        clearRecoverTimer();
        setPartnerOverlay(false);
      } else if (st === 'disconnected') {
        // Laisse 8 s à WebRTC pour se réparer seul avant d'agir.
        setPartnerOverlay(true, 'Connexion instable…');
        clearRecoverTimer();
        recoverTimer = setTimeout(tryRecover, 8000);
      } else if (st === 'failed') {
        setPartnerOverlay(true, 'Reconnexion…');
        clearRecoverTimer();
        recoverTimer = setTimeout(tryRecover, 300);
      }
    };
  }

  function tryRecover() {
    if (phase !== 'connected') return;
    if (callAlive()) return;
    if (!partnerPeerId || !peer || !localStream) return;

    if (!isInitiator) {
      // Côté appelé : on laisse à l'initiateur le temps de rappeler ;
      // si rien ne revient, on passe au suivant.
      clearRecoverTimer();
      recoverTimer = setTimeout(function () {
        if (phase === 'connected' && !callAlive()) skipToNext();
      }, 12000);
      return;
    }

    if (recoverAttempts >= 3) { skipToNext(); return; }
    recoverAttempts++;
    refreshIceConfig().then(function () {
      if (phase !== 'connected' || callAlive()) return;
      placeCall(partnerPeerId);
      clearRecoverTimer();
      recoverTimer = setTimeout(tryRecover, 8000);
    }, function () {
      clearRecoverTimer();
      recoverTimer = setTimeout(tryRecover, 8000);
    });
  }

  // ── caméra / micro ─────────────────────────────────────────────────────
  function startCamera() {
    return navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(function (stream) {
        localStream = stream;
        ensureVideoEls();
        selfVideoEl.srcObject = stream;
        return stream;
      });
  }

  // ── flux principal ─────────────────────────────────────────────────────
  function launchFlow() {
    if (!API.cachedUser()) { location.href = 'auth.html#inscription'; return; }
    if (localStream) { toSearching(); return; }
    show('perms');
  }

  function toSearching() {
    clearChat();
    show('searching');
    pendingFind = true;
    phase = 'waiting';
    initSocket();
    initPeer();
    maybeStartSearch();
  }

  function skipToNext() {
    clearRecoverTimer();
    recoverAttempts = 0;
    closeCurrentCall();
    stopTimer();
    clearChat();
    partnerPeerId = null; partnerUserId = null; currentMatchId = null;
    if (socket) socket.emit('skip');
    if (app.getAttribute('data-current') === 'active') {
      setPartnerOverlay(true, 'Manaraka…');
    } else {
      show('searching');
    }
    phase = 'waiting';
    pendingFind = true;
    maybeStartSearch();
  }

  function endCall() {
    clearRecoverTimer();
    recoverAttempts = 0;
    var wasWaiting = (phase === 'waiting');
    var wasConnected = (phase === 'connected');
    closeCurrentCall();
    stopTimer();
    clearChat();
    setPartnerOverlay(false);
    if (socket) {
      if (wasConnected) socket.emit('skip');
      else if (wasWaiting) socket.emit('cancel_search');
    }
    partnerPeerId = null; partnerUserId = null; currentMatchId = null;
    phase = 'idle';
    pendingFind = false;
    show('idle');
  }

  function cleanup() {
    try { if (socket) socket.disconnect(); } catch (e) { /* ignore */ }
    try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
    if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); });
  }

  // ── wiring DOM ─────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    app = $('#app');

    // Pas connecté → auth (site.js vérifie aussi le cookie de session en
    // arrière-plan ; le socket refusera de toute façon sans session).
    if (!API.cachedUser()) { location.replace('auth.html#inscription'); }

    $('#launchBtn').addEventListener('click', launchFlow);

    $('#grantBtn').addEventListener('click', function () {
      startCamera().then(toSearching, function () {
        toast('Impossible d\'accéder à la caméra/micro. Autorise l\'accès dans ton navigateur.');
      });
    });

    $('#cancelSearch').addEventListener('click', endCall);
    $('#closeBtn').addEventListener('click', endCall);
    $('#skipBtn').addEventListener('click', skipToNext);
    $('#historyBtn').addEventListener('click', function () { toast('Historique — bientôt disponible'); });

    $('#micBtn').addEventListener('click', function () {
      mic = !mic;
      if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = mic; });
      this.classList.toggle('off', !mic);
      toast(mic ? 'Micro activé' : 'Micro coupé');
    });

    $('#camBtn').addEventListener('click', function () {
      cam = !cam;
      if (localStream) localStream.getVideoTracks().forEach(function (t) { t.enabled = cam; });
      this.classList.toggle('off', !cam);
      $('#camOffPill').style.display = cam ? 'none' : '';
    });

    // ── chat réel ──
    var msgInput = $('#msgInput');
    var msgSend = $('#msgSend');
    msgInput.addEventListener('input', function () {
      msgSend.disabled = msgInput.value.trim().length === 0;
    });
    $('#msgForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = msgInput.value.trim();
      if (!v || phase !== 'connected' || !socket) return;
      socket.emit('send_message', v);
      addBubble(v, 'me');
      msgInput.value = ''; msgSend.disabled = true;
      msgInput.focus();
    });

    // ── signalement réel ──
    $('#flagBtn').addEventListener('click', function () { show('report'); });
    $('#reportCancel').addEventListener('click', function () { show('active'); });
    document.querySelectorAll('.report-reason').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.report-reason').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
      });
    });
    $('#reportSend').addEventListener('click', function () {
      var sel = document.querySelector('.report-reason.sel');
      var label = sel ? sel.textContent.trim() : 'Autre comportement';
      // Enum de motifs attendu par l'API (docs/SIGNALEMENT.md §3).
      var REASON_ENUM = {
        'Nudité ou contenu sexuel': 'sexual_content',
        'Propos haineux ou racistes': 'hate_speech',
        'Harcèlement ou menaces': 'harassment',
        'Mineur en danger': 'minor',
        'Autre comportement': 'other'
      };
      var reason = REASON_ENUM[label] || 'other';
      var reportedId = partnerUserId;
      var callId = currentMatchId;
      var after = function () {
        endCall();
        setTimeout(function () { toast('Signalement envoyé. Merci d\'aider à protéger la communauté.'); }, 300);
      };
      if (reportedId) {
        API.req('/reports', { method: 'POST', body: { reported_id: reportedId, reason: reason, note: label, callId: callId } })
          .then(after, after);
      } else {
        after();
      }
    });

    window.addEventListener('pagehide', cleanup);

    show('idle');
  });
})();
