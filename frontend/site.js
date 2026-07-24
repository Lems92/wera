/* site.js — interactions partagées du site Wera */
(function () {
  var USER_KEY = 'wera.user';

  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
  function clearUser() { localStorage.removeItem(USER_KEY); }
  function initials(pseudo) {
    if (!pseudo) return 'W';
    var parts = pseudo.trim().split(/\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function colorFor(pseudo) {
    var palette = [
      ['#E87C4A','#c85a2a'], ['#4A7CE8','#2a52c8'], ['#2FB16B','#1c8a4f'],
      ['#7a4ae8','#4a2ac8'], ['#e84a8a','#c82a6a'], ['#e8b54a','#c8932a']
    ];
    var sum = 0;
    for (var i = 0; i < (pseudo || 'W').length; i++) sum += pseudo.charCodeAt(i);
    var p = palette[sum % palette.length];
    return 'linear-gradient(135deg,' + p[0] + ',' + p[1] + ')';
  }
  // expose so auth.html can use it
  window.Wera = { getUser: getUser, setUser: setUser, clearUser: clearUser };

  // ----- swap nav when logged in -----
  function renderUserNav() {
    var user = getUser();
    if (!user) return;

    var initialsTxt = initials(user.pseudo || user.email || 'W');
    var gradient = colorFor(user.pseudo || user.email || 'W');

    // Desktop nav
    var navCta = document.querySelector('.nav-cta');
    if (navCta) {
      navCta.innerHTML =
        '<a href="appel.html" class="btn btn-yellow"><svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M15.5 10.5 21 7v10l-5.5-3.5M3 6.5A2.5 2.5 0 0 1 5.5 4h7A2.5 2.5 0 0 1 15 6.5v11A2.5 2.5 0 0 1 12.5 20h-7A2.5 2.5 0 0 1 3 17.5v-11Z" stroke="#141414" stroke-width="1.9" stroke-linejoin="round"/></svg>Lancer un appel</a>' +
        '<div class="user-menu">' +
          '<button class="user-chip" aria-haspopup="true" aria-expanded="false">' +
            '<span class="user-av" style="background:' + gradient + '">' + initialsTxt + '</span>' +
            '<span class="user-name">' + (user.pseudo || 'Mon compte') + '</span>' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<div class="user-pop" role="menu">' +
            '<div class="user-pop-head">' +
              '<span class="user-av lg" style="background:' + gradient + '">' + initialsTxt + '</span>' +
              '<div><b>' + (user.pseudo || 'Wera user') + '</b><span>' + (user.email || '') + '</span></div>' +
            '</div>' +
            '<a href="appel.html" role="menuitem">Lancer un appel</a>' +
            '<a href="compte.html#profil" role="menuitem">Mon profil</a>' +
            '<button type="button" role="menuitem" data-logout>Se déconnecter</button>' +
          '</div>' +
        '</div>';
    }

    // Mobile menu
    var mobile = document.querySelector('.mobile-menu');
    if (mobile) {
      // remove connexion / inscription links + separator (compte connecté)
      mobile.querySelectorAll('a').forEach(function (a) {
        var h = a.getAttribute('href') || '';
        if (h.indexOf('auth.html') === 0) a.remove();
      });
      var sep = mobile.querySelector('.menu-sep');
      if (sep) sep.remove();
      var mobUser = document.createElement('div');
      mobUser.className = 'mobile-user';
      mobUser.innerHTML =
        '<a href="compte.html#profil" class="mobile-user-card">' +
          '<span class="user-av lg" style="background:' + gradient + '">' + initialsTxt + '</span>' +
          '<div><b>' + (user.pseudo || 'Wera user') + '</b><span>' + (user.email || '') + '</span></div>' +
          '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</a>' +
        '<a href="appel.html" class="btn btn-yellow">Lancer un appel</a>' +
        '<button type="button" class="mobile-logout" data-logout>Se déconnecter</button>';
      mobile.appendChild(mobUser);
    }

    // wire interactions
    var chip = document.querySelector('.user-chip');
    var pop = document.querySelector('.user-pop');
    if (chip && pop) {
      chip.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = pop.classList.toggle('open');
        chip.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function (e) {
        if (!pop.contains(e.target) && !chip.contains(e.target)) {
          pop.classList.remove('open');
          chip.setAttribute('aria-expanded', 'false');
        }
      });
    }
    document.querySelectorAll('[data-logout]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        // Efface le cookie HttpOnly côté API puis le cache local.
        var done = function () { location.href = 'index.html'; };
        if (window.WeraAPI) WeraAPI.logout().then(done, done);
        else { clearUser(); done(); }
      });
    });
  }

  // ----- nav scroll + active link -----
  function initNavChrome() {
    var nav = document.querySelector('.nav');
    if (nav) {
      var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 6); };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    // Auto-mark active link based on current page
    var here = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var page = href.split('#')[0] || 'index.html';
      if (page === here) a.classList.add('active');
      // Special: highlight "Comment ça marche" only on index, not other pages
      if (here === 'index.html' && href.indexOf('#how') > -1) a.classList.add('active');
      else if (here === 'index.html' && href === 'index.html#how') a.classList.add('active');
    });
    // Remove false positives — only one active at a time, prefer non-index exact match
    var actives = document.querySelectorAll('.nav-links a.active');
    if (actives.length > 1 && here !== 'index.html') {
      actives.forEach(function (a) {
        if ((a.getAttribute('href') || '').indexOf('index.html') === 0) a.classList.remove('active');
      });
    }
  }

  // ----- menu mobile -----
  function initNav() {
    var burger = document.querySelector('.nav-burger');
    var menu = document.querySelector('.mobile-menu');
    if (!burger || !menu) return;
    // Sort le menu du <header> : backdrop-filter sur .nav crée un containing block
    // pour les enfants position:fixed → sans ça, inset:72px 0 0 résout contre le header (72px de haut)
    // au lieu du viewport, et le menu ouvert mesure ~54px au lieu de plein écran.
    if (menu.parentElement !== document.body) {
      document.body.appendChild(menu);
    }
    burger.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        menu.classList.remove('open');
        burger.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });
  }

  // ----- FAQ accordéon -----
  function initFaq() {
    document.querySelectorAll('.faq-item').forEach(function (item) {
      var q = item.querySelector('.faq-q');
      var a = item.querySelector('.faq-a');
      if (!q || !a) return;
      q.addEventListener('click', function () {
        var isOpen = item.classList.contains('open');
        if (isOpen) { item.classList.remove('open'); a.style.maxHeight = 0; }
        else { item.classList.add('open'); a.style.maxHeight = a.scrollHeight + 'px'; }
      });
    });
  }

  // ----- reveal au scroll (avec filets de sécurité) -----
  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    function reveal(e) { e.classList.add('in'); }

    if (!('IntersectionObserver' in window)) {
      els.forEach(reveal);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { reveal(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' });
    els.forEach(function (e) { io.observe(e); });

    // révèle immédiatement ce qui est déjà dans le viewport au chargement
    requestAnimationFrame(function () {
      var vh = window.innerHeight || 800;
      els.forEach(function (e) {
        if (e.getBoundingClientRect().top < vh * 0.96) reveal(e);
      });
    });
    // filet de sécurité : le contenu ne doit jamais rester caché
    setTimeout(function () { els.forEach(reveal); }, 1600);
  }

  // ----- garde auth sur les liens "Lancer un appel" -----
  function initCallGuard() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('appel.html') !== 0) return;
      if (getUser()) return;
      e.preventDefault();
      location.href = 'auth.html#inscription';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderUserNav();
    initNavChrome();
    initNav(); initFaq(); initReveal();
    initCallGuard();

    // Vérifie la vraie session (cookie HttpOnly) auprès de l'API. Si l'état
    // a changé par rapport au cache local (connexion expirée, ou connexion
    // faite dans un autre onglet), on recharge pour resynchroniser la nav.
    if (window.WeraAPI) {
      WeraAPI.syncSession(function () { location.reload(); });
    }
  });
})();
