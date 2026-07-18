/* recompense.js — Wera · flux récompense intégré dans appel.html
   Hooke les victoires des mini-jeux, gère le solde de points et déroule
   le parcours d'échange contre une carte à gratter de crédit téléphonique.
*/
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────
  var PTS_KEY      = 'wera_pts_v1';
  var CEL_KEY      = 'wera_celeb_v1';
  var THRESHOLD    = 1000;
  var DEFAULT_PTS  = 900;          // démarre proche du seuil pour démontrer

  var OPS = {
    orange: { name: 'Orange', full: 'Orange Madagascar', ussd: '#123*CODE#', initial: 'O' },
    yas:    { name: 'Yas',    full: 'Yas Madagascar',    ussd: '*222*CODE#', initial: 'Y' },
    airtel: { name: 'Airtel', full: 'Airtel Madagascar', ussd: '*535*CODE#', initial: 'A' },
  };

  var STATE = {
    pts: parseInt(localStorage.getItem(PTS_KEY) || String(DEFAULT_PTS), 10),
    op:  'orange',
    am:  1000,
    cards: [],      // codes déjà échangés cette session
  };

  // ── Utils ───────────────────────────────────────────────────
  function fmt(n) { return (n || 0).toLocaleString('fr-FR').replace(/,/g, ' '); }
  function $(id) { return document.getElementById(id); }
  function show(id) { var el = $(id); if (el) el.classList.add('show'); }
  function hide(id) { var el = $(id); if (el) el.classList.remove('show'); }

  function syncChip() {
    var chip = $('weraPtsChip'); if (!chip) return;
    chip.querySelector('.pts-val').textContent = fmt(STATE.pts);
    chip.classList.toggle('ready', STATE.pts >= THRESHOLD);
  }

  function bumpChip() {
    var chip = $('weraPtsChip'); if (!chip) return;
    chip.classList.remove('bump');
    void chip.offsetWidth;
    chip.classList.add('bump');
  }

  function rwdToast(html, ms) {
    var t = $('rwdToast'); if (!t) return;
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(rwdToast._t);
    rwdToast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 3200);
  }

  function genCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var groups = [];
    for (var g = 0; g < 4; g++) {
      var s = '';
      for (var i = 0; i < 3; i++) s += chars[Math.floor(Math.random() * chars.length)];
      groups.push(s);
    }
    return groups.join('-');
  }

  function copyTo(txt, btn) {
    try { if (navigator.clipboard) navigator.clipboard.writeText(txt); } catch (e) {}
    if (btn) {
      var old = btn.innerHTML;
      btn.innerHTML = '✓ Copié';
      btn.classList.add('copied');
      setTimeout(function () { btn.innerHTML = old; btn.classList.remove('copied'); }, 1700);
    }
  }

  // ── Awarding points ─────────────────────────────────────────
  function award(amount, reason) {
    var prev = STATE.pts;
    STATE.pts += amount;
    localStorage.setItem(PTS_KEY, String(STATE.pts));
    syncChip();
    bumpChip();
    var reasonHtml = reason ? (' · ' + reason) : '';
    rwdToast(
      '<span style="font-size:18px;">🎉</span>' +
      ' <span class="rt-amt">+' + amount + ' pts</span>' +
      reasonHtml +
      '<span class="rt-bal">Solde : ' + fmt(STATE.pts) + '</span>'
    );

    // Première fois qu'on franchit le seuil → écran de félicitations
    var firstCelebDone = localStorage.getItem(CEL_KEY) === '1';
    if (prev < THRESHOLD && STATE.pts >= THRESHOLD && !firstCelebDone) {
      localStorage.setItem(CEL_KEY, '1');
      setTimeout(openCelebrate, 1800);
    }
  }

  // ── Celebrate (plein-écran jaune) ───────────────────────────
  function openCelebrate() {
    paintConfetti('rwdCelConfetti', '#141414');
    show('rwdCel');
  }
  function closeCelebrate() { hide('rwdCel'); }

  // ── Operator picker ─────────────────────────────────────────
  function openOperator() {
    paintOperatorRows();
    $('rwdOpBal').textContent = fmt(STATE.pts);
    show('rwdOp');
  }
  function paintOperatorRows() {
    Array.prototype.forEach.call(document.querySelectorAll('#rwdOpList .op-row'), function (r) {
      r.classList.toggle('sel', r.getAttribute('data-op') === STATE.op);
    });
  }

  function pickOp(op) {
    if (!OPS[op]) return;
    STATE.op = op;
    paintOperatorRows();
  }

  // ── Amount picker ───────────────────────────────────────────
  function openAmount() {
    var op = OPS[STATE.op];
    $('rwdAmBal').textContent = fmt(STATE.pts);
    $('rwdAmOp').textContent = '· ' + op.name;
    paintAmount();
    show('rwdAm');
  }
  function paintAmount() {
    Array.prototype.forEach.call(document.querySelectorAll('#rwdAmList .am-card'), function (c) {
      var pts = parseInt(c.getAttribute('data-pts'), 10);
      var available = pts <= STATE.pts;
      c.classList.toggle('disabled', !available);
      c.classList.toggle('sel', available && pts === STATE.am);
    });
    $('rwdAmAfter').textContent = fmt(Math.max(0, STATE.pts - STATE.am)) + ' pts';
  }
  function pickAm(pts) {
    if (pts > STATE.pts) return;
    STATE.am = pts;
    paintAmount();
  }

  // ── Confirm ─────────────────────────────────────────────────
  function openConfirm() {
    var op = OPS[STATE.op];
    $('rwdCfName').textContent  = op.full;
    $('rwdCfLogo').textContent  = op.initial;
    $('rwdCfPts').textContent   = fmt(STATE.am) + ' points';
    $('rwdCfAr').textContent    = fmt(STATE.am) + ' Ar';
    $('rwdCfCur').textContent   = fmt(STATE.pts) + ' pts';
    $('rwdCfAfter').textContent = fmt(STATE.pts - STATE.am) + ' pts';
    show('rwdCf');
  }

  function exchange() {
    hide('rwdCf');
    // Simulation : 18 % de chance d'épuisement de stock chez Orange (les
    // autres opérateurs sont disponibles dans la démo)
    var hasError = STATE.op === 'orange' && Math.random() < 0.18;
    if (hasError) {
      setTimeout(openError, 220);
      return;
    }
    STATE.pts -= STATE.am;
    localStorage.setItem(PTS_KEY, String(STATE.pts));
    syncChip();
    setTimeout(openScratch, 250);
  }

  // ── Scratch (plein-écran noir) ─────────────────────────────
  var SCR = { ctx: null, canvas: null, drawing: false, revealed: false, lastP: null };

  function openScratch() {
    var op = OPS[STATE.op];
    var code = genCode();
    var num  = String(Math.floor(100000 + Math.random() * 900000));
    STATE.lastCode = code;
    STATE.lastCardNum = num;
    $('rwdScKick').textContent  = 'VITA !';
    $('rwdScTitle').textContent = 'Ta carte est prête';
    $('rwdScLead').textContent  = 'Gratte avec le doigt ou la souris pour révéler le code.';
    $('rwdScLogo').textContent  = op.initial;
    $('rwdScOp').textContent    = op.name + ' · Recharge';
    $('rwdScAmt').textContent   = fmt(STATE.am) + ' Ar';
    $('rwdScNum').textContent   = 'N° WR-2026-' + num;
    $('rwdScCode').textContent  = code;
    $('rwdScUssdStr').textContent = op.ussd;
    $('rwdScUssdOp').textContent  = op.name;
    $('rwdScZone').classList.remove('scratched');
    $('rwdScCopy').style.display = 'none';
    $('rwdScUssd').style.display = 'none';
    $('rwdScDone').style.display = 'none';
    paintConfetti('rwdScConfetti', '#FADC34');
    show('rwdSc');
    // Initialise le canvas après affichage (pour avoir des dimensions correctes)
    requestAnimationFrame(initScratchCanvas);
  }

  function initScratchCanvas() {
    var z = $('rwdScZone'); if (!z) return;
    var canvas = $('rwdScCanvas'); if (!canvas) return;
    var rect = z.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.max(1, rect.width)  * dpr;
    canvas.height = Math.max(1, rect.height) * dpr;
    var ctx = canvas.getContext('2d');
    // base : aluminium râpé
    var grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0,    '#BFBCB1');
    grad.addColorStop(0.35, '#D9D5C7');
    grad.addColorStop(0.70, '#B1AE9F');
    grad.addColorStop(1,    '#CFC9B9');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // stries claires
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 26 * dpr;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(40 * dpr, 50 * dpr);
    ctx.quadraticCurveTo(180 * dpr, 28 * dpr, 320 * dpr, 70 * dpr);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 20 * dpr;
    ctx.beginPath();
    ctx.moveTo(50 * dpr, 90 * dpr);
    ctx.quadraticCurveTo(160 * dpr, 80 * dpr, 280 * dpr, 96 * dpr);
    ctx.stroke();
    // mode "gomme"
    ctx.globalCompositeOperation = 'destination-out';
    SCR.ctx = ctx; SCR.canvas = canvas;
    SCR.drawing = false; SCR.revealed = false; SCR.lastP = null;
  }

  function scrPoint(e) {
    var c = SCR.canvas; if (!c) return null;
    var r = c.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var x, y;
    if (e.touches && e.touches[0]) { x = e.touches[0].clientX; y = e.touches[0].clientY; }
    else { x = e.clientX; y = e.clientY; }
    return { x: (x - r.left) * dpr, y: (y - r.top) * dpr };
  }

  function scrBrush(p) {
    if (!SCR.ctx || !p) return;
    var dpr = window.devicePixelRatio || 1;
    var R = 30 * dpr;
    SCR.ctx.beginPath();
    SCR.ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    SCR.ctx.fill();
    if (SCR.lastP) {
      // Relie le dernier point pour éviter les "trous" lors d'un mouvement rapide
      SCR.ctx.lineWidth = R * 2;
      SCR.ctx.lineCap = 'round';
      SCR.ctx.beginPath();
      SCR.ctx.moveTo(SCR.lastP.x, SCR.lastP.y);
      SCR.ctx.lineTo(p.x, p.y);
      SCR.ctx.stroke();
    }
    SCR.lastP = p;
  }

  function scrPct() {
    var c = SCR.canvas; if (!c) return 0;
    try {
      var d = SCR.ctx.getImageData(0, 0, c.width, c.height).data;
      var trans = 0, total = 0;
      // échantillonne 1 pixel sur 16 pour la perf
      for (var i = 3; i < d.length; i += 64) { total++; if (d[i] < 32) trans++; }
      return total ? trans / total : 0;
    } catch (e) { return 0; }
  }

  function scrReveal() {
    if (SCR.revealed) return;
    SCR.revealed = true;
    $('rwdScZone').classList.add('scratched');
    $('rwdScKick').textContent  = 'FALY BE !';
    $('rwdScTitle').textContent = 'Voici ton code';
    $('rwdScLead').textContent  = "Note-le ou copie-le. Tu vas l'utiliser sur ton téléphone, hors de Wera.";
    $('rwdScCopy').style.display = '';
    $('rwdScUssd').style.display = '';
    $('rwdScDone').style.display = '';
    // Enregistre la carte dans l'historique session
    STATE.cards.unshift({ op: STATE.op, ar: STATE.am, code: STATE.lastCode, num: STATE.lastCardNum });
    if ('vibrate' in navigator) try { navigator.vibrate([12, 35, 24]); } catch (e) {}
  }

  // ── Post-success ────────────────────────────────────────────
  function openPost() {
    var op = OPS[STATE.op];
    $('rwdPostOp').textContent  = op.name;
    $('rwdPostAr').textContent  = fmt(STATE.am) + ' Ar';
    $('rwdPostBal').textContent = fmt(STATE.pts);
    // Liste des cartes (la plus récente en premier)
    var list = $('rwdPostCards');
    list.innerHTML = '';
    STATE.cards.forEach(function (c) {
      var o = OPS[c.op];
      var row = document.createElement('div');
      row.className = 'cl-row';
      row.innerHTML =
        '<div class="op-logo">' + o.initial + '</div>' +
        '<div class="ct"><b>' + o.name + ' · ' + fmt(c.ar) + ' Ar</b>' +
        '<span>' + c.code + '</span></div>' +
        '<span class="active-pill">Active</span>';
      list.appendChild(row);
    });
    show('rwdPost');
  }

  // ── Error ───────────────────────────────────────────────────
  function openError() { show('rwdErr'); }

  // ── Confetti decorations ───────────────────────────────────
  function paintConfetti(containerId, color) {
    var c = $(containerId); if (!c) return;
    c.innerHTML = '';
    var w = window.innerWidth, h = window.innerHeight;
    var n = w < 600 ? 14 : 22;
    for (var i = 0; i < n; i++) {
      var s = document.createElement('span');
      s.className = 'confetti-piece';
      var isCircle = Math.random() < 0.3;
      var size = 6 + Math.random() * 14;
      s.style.left   = (Math.random() * w) + 'px';
      s.style.top    = (Math.random() * h * 0.85) + 'px';
      s.style.width  = (isCircle ? size : size + 4) + 'px';
      s.style.height = (isCircle ? size : 6) + 'px';
      s.style.borderRadius = isCircle ? '50%' : '2px';
      s.style.background = (Math.random() < 0.5) ? color : '#fff';
      s.style.opacity = 0.4 + Math.random() * 0.5;
      s.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      c.appendChild(s);
    }
  }

  // ── Wire-up DOM ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    syncChip();

    // Chip → ouvre les récompenses
    var chip = $('weraPtsChip');
    if (chip) chip.addEventListener('click', function () {
      if (STATE.pts >= THRESHOLD) openCelebrate();
      else rwdToast(
        '<span style="font-size:18px;">🎯</span>' +
        ' Encore <span class="rt-amt">' + fmt(THRESHOLD - STATE.pts) + ' pts</span>' +
        ' pour ta première carte de recharge.'
      );
    });

    // Celebrate
    $('rwdCelClose').addEventListener('click', closeCelebrate);
    $('rwdCelLater').addEventListener('click', closeCelebrate);
    $('rwdCelGo').addEventListener('click', function () { closeCelebrate(); openOperator(); });

    // Operator picker
    $('rwdOpClose').addEventListener('click', function () { hide('rwdOp'); });
    $('rwdOpList').addEventListener('click', function (e) {
      var row = e.target.closest('.op-row');
      if (row) pickOp(row.getAttribute('data-op'));
    });
    $('rwdOpNext').addEventListener('click', function () { hide('rwdOp'); openAmount(); });

    // Amount picker
    $('rwdAmClose').addEventListener('click', function () { hide('rwdAm'); });
    $('rwdAmBack').addEventListener('click', function () { hide('rwdAm'); openOperator(); });
    $('rwdAmList').addEventListener('click', function (e) {
      var c = e.target.closest('.am-card');
      if (!c || c.classList.contains('disabled')) return;
      pickAm(parseInt(c.getAttribute('data-pts'), 10));
    });
    $('rwdAmNext').addEventListener('click', function () { hide('rwdAm'); openConfirm(); });

    // Confirm
    $('rwdCfClose').addEventListener('click', function () { hide('rwdCf'); });
    $('rwdCfBack').addEventListener('click', function () { hide('rwdCf'); openAmount(); });
    $('rwdCfGo').addEventListener('click', exchange);

    // Scratch
    $('rwdScClose').addEventListener('click', function () { hide('rwdSc'); openPost(); });
    $('rwdScDone').addEventListener('click', function () { hide('rwdSc'); openPost(); });
    $('rwdScCopy').addEventListener('click', function () { copyTo($('rwdScCode').textContent, this); });
    $('rwdScUssdCopy').addEventListener('click', function () { copyTo($('rwdScUssdStr').textContent, this); });

    var canvas = $('rwdScCanvas');
    if (canvas) {
      var down = function (e) {
        if (SCR.revealed) return;
        if (e.cancelable) e.preventDefault();
        SCR.drawing = true;
        SCR.lastP = null;
        scrBrush(scrPoint(e));
      };
      var move = function (e) {
        if (!SCR.drawing || SCR.revealed) return;
        if (e.cancelable) e.preventDefault();
        scrBrush(scrPoint(e));
        if (scrPct() > 0.42) scrReveal();
      };
      var up = function () { SCR.drawing = false; SCR.lastP = null; };
      canvas.addEventListener('mousedown', down);
      canvas.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      canvas.addEventListener('touchstart', down, { passive: false });
      canvas.addEventListener('touchmove',  move, { passive: false });
      canvas.addEventListener('touchend',   up);
    }

    // Post
    $('rwdPostClose').addEventListener('click', function () { hide('rwdPost'); });
    $('rwdPostDone').addEventListener('click', function () { hide('rwdPost'); });

    // Error
    $('rwdErrClose').addEventListener('click', function () { hide('rwdErr'); });
    $('rwdErrSwitch').addEventListener('click', function () {
      hide('rwdErr');
      STATE.op = 'yas';
      openOperator();
    });
    $('rwdErrRetry').addEventListener('click', function () {
      hide('rwdErr');
      rwdToast('⏱️ On réessaiera dans quelques minutes. Tes points sont intacts.');
    });

    // Hook : victoires des mini-jeux
    document.addEventListener('wera:gameWin', function (e) {
      var d = e.detail || {};
      award(d.reward || 60, d.reason || '');
    });

    // Bouton debug (visible en bas-gauche pendant l'idle/perms) pour ajouter
    // rapidement des points sans jouer un mini-jeu — pratique pour la démo
    var dbg = $('weraDbgAdd');
    if (dbg) dbg.addEventListener('click', function () {
      award(60, 'partie de démo');
    });
  });

  // Expose pour TTT / TOW
  window.WeraRewards = {
    award: award,
    open: openCelebrate,
    state: STATE,
  };
})();
