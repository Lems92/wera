# Wera — Matchmaking (V0) · durcissement & checklist

Spécification pour le dev. **Le lobby existe déjà et fonctionne** : deux
inconnus qui vont sur wera.mg et cliquent « Lancer » tombent bien l'un sur
l'autre (testé à 2 téléphones ✓). WebRTC + Cloudflare (transport média) sont
en place.

> Ce document n'est donc **pas** un « à construire ». C'est un guide de
> **durcissement** : le cas nominal marche, mais les bugs de matchmaking
> n'apparaissent qu'**à l'échelle et dans les cas limites** (plusieurs
> dizaines de personnes simultanées, coupures réseau, « passer » en rafale…).
> L'objectif ici est de rendre le système **fiable et invisible** quand il y
> aura du monde. **La checklist du §11 est le livrable concret** — chaque
> ligne est un test à faire passer.

> Règle d'or : **un seul endroit décide des paires, et il décide de façon
> atomique.** 90 % des bugs de matchmaking viennent de deux décisions prises
> en même temps. On les élimine par conception, pas par correctifs.

---

## 1. Séparer les responsabilités

Rappel de qui fait quoi (déjà en place, pour contexte) :

```
┌──────────────┐   qui × qui ?    ┌─────────────────────────────┐
│  Ce doc      │ ───────────────► │  File + appariement          │
│ MATCHMAKING  │                  │  (Cloudflare Durable Object) │
└──────────────┘                  └─────────────────────────────┘
                                                │ « vous êtes ensemble »
                                                ▼
┌──────────────────────────────────────────────────────────────┐
│  WebRTC + Cloudflare Calls/TURN  →  transporte la vidéo (FAIT) │
└──────────────────────────────────────────────────────────────┘
```

Le matchmaking **ne touche jamais** à la vidéo. Il désigne la paire, transmet
le signaling (offre/réponse/ICE), puis s'efface. La vidéo reste pair-à-pair.

---

## 2. Pourquoi un Durable Object (et pas Workers KV)

L'appariement doit être **atomique** : deux personnes ne peuvent pas « prendre »
le même partenaire en même temps. Un Durable Object (DO) Cloudflare est
**mono-thread par instance** → il traite les messages **un par un**. C'est
exactement la garantie qu'il faut : impossible d'appairer A à B et A à C
simultanément. KV/D1 n'offrent pas cette atomicité → à éviter pour la file.

**V0 : une seule instance de DO = « le lobby ».** Tous les joueurs en attente
s'y connectent en WebSocket. Tant qu'on est sous ~quelques milliers de
personnes *simultanées*, une instance suffit largement. (Scaling → §10.)

---

## 3. Machine à états d'un utilisateur

Chaque connexion vit dans **exactement un** de ces états. Toute la fiabilité
tient à ne jamais violer ça.

```
        join_queue
  IDLE ───────────► QUEUED ──(appairé)──► MATCHING ──(connecté)──► IN_CALL
   ▲                  │                       │                       │
   │                  │ leave / timeout       │ échec WebRTC          │ next / hangup
   │                  ▼                       ▼                       ▼
   └────────────────────────────  retour IDLE ou QUEUED  ────────────┘
```

| État       | Signification                                        |
|------------|------------------------------------------------------|
| `IDLE`     | Connecté au lobby, pas dans la file                  |
| `QUEUED`   | En attente d'un partenaire                           |
| `MATCHING` | Appairé, négociation WebRTC en cours (offre/réponse) |
| `IN_CALL`  | Appel actif                                          |

**Invariant clé :** un utilisateur en `MATCHING` ou `IN_CALL` **n'est jamais**
dans la file. On le retire de la file **au moment exact** de l'appariement,
dans la même opération atomique. Sinon → double-match.

---

## 4. Protocole WebSocket

Un seul canal WS entre le client et le DO. Messages JSON `{ type, ... }`.

### Client → serveur
| type          | payload                    | quand                          |
|---------------|----------------------------|--------------------------------|
| `join`        | `{ userId, token }`        | à l'ouverture / « Lancer »     |
| `leave`       | —                          | quitte la file (bouton retour) |
| `next`        | —                          | « Passer » pendant l'appel     |
| `hangup`      | —                          | raccroche                      |
| `signal`      | `{ sdp \| ice }`           | signaling WebRTC (relayé)      |
| `report`      | `{ reason }`               | signale le partenaire courant  |
| `pong`        | —                          | réponse au heartbeat           |

### Serveur → client
| type          | payload                              | quand                     |
|---------------|--------------------------------------|---------------------------|
| `queued`      | `{ position? }`                      | entré dans la file        |
| `matched`     | `{ peerId, role, matchId, iceServers }` | paire trouvée          |
| `signal`      | `{ sdp \| ice }`                     | signaling du partenaire   |
| `peer_left`   | `{ reason }`                         | le partenaire est parti   |
| `requeued`    | —                                    | remis en file après next  |
| `ping`        | —                                    | heartbeat (toutes les 15 s)|
| `error`       | `{ code, msg }`                      | erreur                    |

`role` = `"caller"` ou `"callee"` → **résout le problème de glare** (§6).
`matchId` = identifiant unique de la paire → **idempotence** (§6).

---

## 5. Algorithme d'appariement (le cœur)

Exécuté **dans le DO, de façon atomique** à chaque `join` (et à chaque
`requeue`). Pseudo-code :

```js
// État du DO
const queue = [];              // file FIFO d'userIds en attente
const users = new Map();       // userId -> { ws, state, peerId, matchId, lastSeen }
const recentPairs = new Map(); // "a|b" -> timestamp (cooldown anti-boucle)

function onJoin(userId, ws) {
  const u = users.get(userId);
  // Idempotence : un join alors qu'on est déjà en file/en appel = no-op
  if (u && (u.state === 'QUEUED' || u.state === 'MATCHING' || u.state === 'IN_CALL')) return;

  users.set(userId, { ws, state: 'QUEUED', lastSeen: now() });
  tryMatch(userId);
}

function tryMatch(userId) {
  const me = users.get(userId);
  if (!me || me.state !== 'QUEUED') return;

  // Cherche le premier candidat compatible dans la file
  for (let i = 0; i < queue.length; i++) {
    const otherId = queue[i];
    if (otherId === userId) continue;
    const other = users.get(otherId);
    if (!other || other.state !== 'QUEUED') { queue.splice(i, 1); i--; continue; } // nettoie les fantômes

    if (!compatible(userId, otherId)) continue;   // §7 : blocage + cooldown

    // ---- APPARIEMENT ATOMIQUE ----
    // Retirer LES DEUX de la file AVANT tout envoi réseau
    removeFromQueue(userId);
    removeFromQueue(otherId);
    const matchId = uuid();
    setMatch(userId, otherId, matchId);   // state -> MATCHING des deux côtés
    markPair(userId, otherId);            // cooldown

    // role déterministe : le plus petit id est "caller" (§6)
    const caller = userId < otherId ? userId : otherId;
    send(userId,  { type:'matched', peerId: otherId, matchId, role: userId===caller?'caller':'callee', iceServers });
    send(otherId, { type:'matched', peerId: userId,  matchId, role: otherId===caller?'caller':'callee', iceServers });
    return;
  }

  // Personne de compatible → on attend dans la file
  if (!queue.includes(userId)) queue.push(userId);
  send(userId, { type:'queued' });
}
```

Points non négociables :
- **Retirer les deux de la file AVANT le moindre `send`.** Aucun `await`
  réseau entre « je choisis la paire » et « je retire les deux ». Comme le DO
  est mono-thread, cette section est atomique → **jamais de double-match**.
- **Nettoyer les fantômes** en parcourant la file (états incohérents, ws morte).
- Le `signal` relayé n'est accepté que s'il correspond au `matchId` courant
  (sinon un vieux message d'un appel précédent casse le nouveau).

---

## 6. Bugs WebRTC classiques — et comment on les tue

### Glare (les deux envoient une offre en même temps)
**Cause :** sans rôle défini, A et B créent chacun une offre → collision, l'appel
ne se monte pas.
**Solution :** le serveur assigne `role` dans `matched`. **Seul le `caller`
crée l'offre.** Le `callee` attend l'offre et répond. Zéro ambiguïté.
Règle déterministe : `caller = min(userIdA, userIdB)`.

### Double-`matched` / messages en retard
**Cause :** un client reçoit deux `matched`, ou un `signal` d'un ancien appel.
**Solution :** tout est estampillé `matchId`. Le client **ignore** tout
`signal`/`matched` dont le `matchId` ≠ celui en cours. Idempotent par design.

### ICE qui n'aboutit pas (≈ 30 % sans TURN)
**Cause :** un des deux est derrière un NAT/pare-feu strict (mobile, entreprise).
**Solution :** toujours fournir des **iceServers TURN** dans `matched`
(Cloudflare Calls / TURN loué). Ne jamais compter sur STUN seul.

### Connexion qui ne se monte pas (timeout de négociation)
**Cause :** un des deux a un réseau pourri, la négociation traîne.
**Solution :** timeout côté serveur. Si pas de `iceConnectionState=connected`
sous **12 s**, on annule la paire, on renvoie **les deux** en file
(`requeued`) et on les réappaire avec d'autres. L'utilisateur ne voit qu'un
« on te cherche un Malgache » un peu plus long, jamais un écran figé.

---

## 7. Règles de compatibilité (V0)

```js
function compatible(a, b) {
  if (blocked(a, b)) return false;                    // 1. jamais deux bloqués/signalés
  if (recentlyPaired(a, b, COOLDOWN)) return false;   // 2. anti-boucle A↔B
  return true;                                        // 3. le reste = aléatoire
}
```

1. **Blocage / signalement** : si A a bloqué ou signalé B (ou l'inverse), ils
   ne sont **jamais** réappairés. Voir `SIGNALEMENT.md`. Cette liste doit être
   chargée dans le DO (ou vérifiée en O(1) via un Set par utilisateur).
2. **Cooldown anti-boucle** : après un appel A↔B, on interdit de les
   réappairer pendant `COOLDOWN` (ex. **5 min**). Évite de retomber sur la
   même personne juste après avoir « passé ».
3. Le reste est **purement aléatoire** — c'est la promesse produit, pas
   d'algorithme de préférence en V0. (Les filtres région/langue viendront
   après, en ajoutant une condition ici.)

> FIFO simple = équitable : le premier arrivé est le premier servi. Ne pas
> sur-optimiser en V0.

---

## 8. Présence & fantômes (la 2ᵉ source de bugs)

Le pire bug de matchmaking : **appairer quelqu'un avec un fantôme** (onglet
fermé, réseau coupé) → l'autre attend une vidéo qui ne viendra jamais.

**Heartbeat obligatoire :**
- Le serveur envoie `ping` toutes les **15 s**. Le client répond `pong`.
- Pas de `pong` après **2 cycles (30 s)** → l'utilisateur est mort :
  - on le retire de la file,
  - si en appel, on envoie `peer_left` à son partenaire et on le remet en file.
- La fermeture WebSocket (`onclose`) déclenche **immédiatement** le même
  nettoyage — le heartbeat n'est que le filet de sécurité pour les coupures
  brutales (mobile qui perd la 4G).

**Nettoyage à l'appariement :** au moment de piocher un candidat, si sa ws
n'est pas `OPEN` → on le jette de la file et on continue. On ne fait jamais
confiance à la file sans revérifier l'état vivant du candidat.

---

## 9. Cycle de vie d'un appel (récapitulatif pas-à-pas)

```
A: join ───► DO: QUEUED (personne) ───► "queued"
B: join ───► DO: match(A,B) atomique
              ├─► A: matched{ peer:B, role:caller, matchId, iceServers }
              └─► B: matched{ peer:A, role:callee, matchId, iceServers }
A (caller): crée offre ─ signal{sdp} ─► DO relaie ─► B
B (callee): crée réponse ─ signal{sdp} ─► DO relaie ─► A
A,B: échangent ICE via signal ─► WebRTC connecté ─► IN_CALL
        │
        ├─ A clique "Passer" (next):
        │     DO: peer_left ─► B (remis en QUEUED, réappairé)
        │     DO: A remis en QUEUED, réappairé (cooldown A↔B actif)
        │
        ├─ A ferme l'onglet / perd le réseau:
        │     onclose/heartbeat ─► peer_left ─► B remis en file
        │
        └─ A signale B (report):
              appel coupé, paire bloquée à vie (§7.1), report créé (SIGNALEMENT.md)
```

---

## 10. Scaling (après la V0, à noter seulement)

Une instance de DO tient des milliers de connexions simultanées. Quand ça ne
suffira plus :
- **Sharder** en plusieurs lobbies (par région, ou hash) — mais attention, un
  lobby trop petit = moins de monde à appairer = attentes plus longues. On
  shard **tard**, pas tôt.
- Un lobby « coordinateur » peut rediriger vers des sous-lobbies.
- Ne pas y penser avant d'avoir un vrai problème de charge mesuré.

---

## 11. Checklist « sans bug »

Avant de dire que le matchmaking est prêt, vérifier :

- [ ] Deux inconnus qui cliquent « Lancer » **sans rien se partager** tombent l'un sur l'autre.
- [ ] Appariement atomique : impossible d'être appairé à deux personnes (test de charge : 100 `join` en rafale).
- [ ] `role` caller/callee assigné → **un seul** crée l'offre (pas de glare).
- [ ] `matchId` filtre les messages en retard d'un appel précédent.
- [ ] TURN fourni → un appel entre deux mobiles 4G se monte.
- [ ] Timeout de négociation (12 s) → réappariement, jamais d'écran figé.
- [ ] Fermeture d'onglet → le partenaire est remis en file en < 2 s.
- [ ] Perte réseau (couper la 4G) → détectée par heartbeat en < 30 s.
- [ ] « Passer » ne retombe pas sur la même personne (cooldown).
- [ ] Deux personnes qui se sont bloquées/signalées ne sont jamais réappairées.
- [ ] `next` spammé (clics rapides) → pas de doublon en file (idempotence du state).
- [ ] File vide → « on te cherche un Malgache » propre, jamais d'erreur.

---

## 12. Priorités de durcissement (V0)

Le lobby marche déjà. Ce qu'il reste à **vérifier / renforcer**, par ordre
d'impact — chacun correspond à un test de la §11 :

1. **Appariement atomique** (§5) — le seul bug invisible à 2 téléphones et
   catastrophique à l'échelle. À tester en rafale (100 `join`). **Priorité 1.**
2. **Fantômes** : heartbeat + nettoyage à la fermeture (§8) — sinon écrans
   figés dès qu'un mobile perd le réseau. **Priorité 2.**
3. **Cooldown anti-boucle** (§7.2) — « Passer » ne doit pas retomber sur la
   même personne. Testable à 3 téléphones.
4. **Blocage/signalement non réapparié** (§7.1) — lien avec `SIGNALEMENT.md`.
5. **`role` + `matchId` + timeout** (§6) — si le cas nominal marche déjà, une
   partie est sûrement en place ; vérifier surtout le timeout de
   réappariement (pas d'écran figé sur mauvais réseau).

Les filtres, le sharding et la position dans la file sont **hors V0**.
Un bon matchmaking V0 = **fiable et invisible**, pas riche en options.
