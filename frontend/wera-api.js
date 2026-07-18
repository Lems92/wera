/* wera-api.js — pont entre le site statique et le backend Wera.
 *
 * Auth : le JWT vit dans un cookie HttpOnly (wera_token) posé par l'API —
 * le JS n'y touche jamais. localStorage['wera.user'] ne garde qu'une copie
 * d'affichage (pseudo/email) pour la nav ; la session réelle est vérifiée
 * via GET /api/auth/me à chaque chargement de page.
 */
(function () {
  var API = 'https://api.wera.mg/api';
  var SOCKET_ORIGIN = 'https://api.wera.mg';
  // Client ID Google (valeur publique). /api/auth/config reste la source de
  // vérité ; cette constante n'est qu'un secours si l'API est injoignable.
  var GOOGLE_CLIENT_ID_FALLBACK = '779694209769-aagddluic2a6rtl9a0ca7ueqcl91hsup.apps.googleusercontent.com';

  function req(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: {}
    };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        return { ok: r.ok, status: r.status, data: data };
      });
    });
  }

  // ── Session ────────────────────────────────────────────────────────────
  function cachedUser() {
    try { return JSON.parse(localStorage.getItem('wera.user') || 'null'); }
    catch (e) { return null; }
  }

  function storeUser(user) {
    // Fusionne avec le cache local (bio/prefs restent purement locaux).
    var prev = cachedUser() || {};
    var merged = Object.assign({}, prev, {
      id: user.id,
      pseudo: user.username || prev.pseudo,
      email: user.email || prev.email || '',
      ville: user.ville !== undefined ? user.ville : prev.ville,
      pays: user.pays !== undefined ? user.pays : prev.pays
    });
    localStorage.setItem('wera.user', JSON.stringify(merged));
    return merged;
  }

  function clearStoredUser() { localStorage.removeItem('wera.user'); }

  // Vérifie la session serveur et resynchronise le cache local.
  // onChange(user|null) n'est appelé QUE si l'état connecté/déconnecté a
  // changé par rapport au cache (permet un location.reload sans boucle).
  function syncSession(onChange) {
    var hadUser = Boolean(cachedUser());
    return req('/auth/me').then(function (r) {
      if (r.status === 200 && r.data && r.data.user) {
        // Complète avec le profil (email, ville…) pour la nav et compte.html.
        return req('/users/me').then(function (p) {
          var u = storeUser((p.status === 200 && p.data.user) || r.data.user);
          if (!hadUser && typeof onChange === 'function') onChange(u);
          return u;
        });
      }
      if (r.status === 401) {
        clearStoredUser();
        if (hadUser && typeof onChange === 'function') onChange(null);
        return null;
      }
      // API injoignable : on garde le cache tel quel (mode dégradé).
      return cachedUser();
    }).catch(function () { return cachedUser(); });
  }

  function logout() {
    return req('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () {
      clearStoredUser();
    });
  }

  // ── Google Sign-In ─────────────────────────────────────────────────────
  function getGoogleClientId() {
    return req('/auth/config').then(function (r) {
      return (r.data && r.data.googleClientId) || GOOGLE_CLIENT_ID_FALLBACK;
    }).catch(function () { return GOOGLE_CLIENT_ID_FALLBACK; });
  }

  // Initialise GSI (une seule fois) et rend le bouton officiel dans chaque
  // slot fourni. onDone(user) après connexion réussie côté API.
  function mountGoogleButtons(slots, onDone, onError) {
    getGoogleClientId().then(function (clientId) {
      var tries = 0;
      (function waitGsi() {
        if (!(window.google && google.accounts && google.accounts.id)) {
          if (++tries > 40) { if (onError) onError('Google Sign-In indisponible'); return; }
          return setTimeout(waitGsi, 250);
        }
        google.accounts.id.initialize({
          client_id: clientId,
          callback: function (resp) {
            if (!resp || !resp.credential) return;
            req('/auth/google', { method: 'POST', body: { credential: resp.credential } })
              .then(function (r) {
                if (r.ok && r.data.user) {
                  var u = storeUser(r.data.user);
                  if (onDone) onDone(u);
                } else if (onError) {
                  onError((r.data && r.data.error) || 'Connexion Google impossible');
                }
              })
              .catch(function () { if (onError) onError('Réseau indisponible'); });
          }
        });
        slots.forEach(function (el) {
          if (!el) return;
          el.innerHTML = '';
          google.accounts.id.renderButton(el, {
            theme: 'outline', size: 'large', shape: 'pill',
            text: 'continue_with', logo_alignment: 'center',
            width: Math.min(400, Math.max(220, el.offsetWidth || 340))
          });
        });
      })();
    });
  }

  window.WeraAPI = {
    API: API,
    SOCKET_ORIGIN: SOCKET_ORIGIN,
    req: req,
    cachedUser: cachedUser,
    storeUser: storeUser,
    clearStoredUser: clearStoredUser,
    syncSession: syncSession,
    logout: logout,
    mountGoogleButtons: mountGoogleButtons
  };
})();
