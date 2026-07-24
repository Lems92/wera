# Wera — Système de signalement & modération (V0)

Spécification pour le développement. Décrit le parcours d'un signalement,
depuis le bouton dans l'appel jusqu'au dossier dans la console de modération.

---

## 1. Principe directeur

> **Chaque signalement compte, mais tous ne se valent pas.**

On n'attend **jamais** un 2ᵉ signalement pour agir sur une faute grave.
Au lieu d'un seuil (« il faut N signalements »), on utilise un **regroupement** :
chaque signalement crée ou alimente un **dossier** rattaché au membre signalé.

Cela donne l'avantage d'un seuil (repérer qui est signalé en boucle) sans le
risque (laisser passer un cas isolé grave).

---

## 2. Parcours d'un signalement

```
[Appel 1-to-1]
   │  L'utilisateur A appuie sur « Signaler » et choisit un motif
   ▼
[Action automatique immédiate — côté client + serveur]
   1. L'appel est coupé du côté de A
   2. A et B ne sont plus jamais remis en relation (blocage implicite)
   3. Un enregistrement `report` est créé côté serveur
   ▼
[Serveur : création / mise à jour du dossier]
   - On cherche un dossier OUVERT pour le membre B
   - S'il existe → on y ajoute ce signalement (count += 1)
   - Sinon → on crée un nouveau dossier
   ▼
[Console de modération]
   - Le dossier apparaît IMMÉDIATEMENT (pas d'attente)
   - Trié par gravité, puis par nombre de signalements
   ▼
[Décision d'un modérateur]
   Rejeter · Avertir · Suspendre · Bannir → dossier fermé
```

**Important :** l'action automatique (points 1-2) protège la victime tout de
suite, sans attendre l'intervention humaine.

---

## 3. Motifs et gravité

Le motif choisi par l'utilisateur détermine la **gravité** du dossier, qui
pilote le tri et la couleur dans la console.

| Motif                      | Gravité | Traitement                        |
|----------------------------|---------|-----------------------------------|
| Nudité / contenu sexuel    | HAUTE   | Remonte dès 1 signalement, prioritaire |
| Mineur suspecté            | HAUTE   | Remonte dès 1 signalement, **urgence absolue** |
| Propos haineux             | HAUTE   | Remonte dès 1 signalement         |
| Harcèlement                | MOYENNE | Remonte dès 1 signalement         |
| Spam / publicité           | BASSE   | Regroupé, monte en priorité avec le nombre |
| Autre                      | BASSE   | Regroupé                          |

La gravité d'un dossier = **la plus haute** parmi tous ses signalements.
Ex. : un membre signalé pour « spam » puis « propos haineux » devient un
dossier de gravité HAUTE.

---

## 4. Regroupement (« dossier »)

Un **dossier** = tous les signalements ouverts visant **un même membre**.

Règles de fusion :
- Clé de regroupement = **identifiant du membre signalé**.
- Le motif affiché = le motif le plus grave du dossier ; les autres motifs
  apparaissent en badge secondaire (`+ Spam / publicité`).
- Le compteur `×N` s'affiche dès 2 signalements ; il passe en rouge à partir
  de 3 (signal fort de récidive).
- Une décision de modération s'applique à **tout le dossier** d'un coup, pas
  signalement par signalement.

---

## 5. Sanctions graduées

Cohérent avec la charte publique (page Sécurité). Le **compteur d'antécédents**
du membre (`prior` = sanctions déjà reçues) guide la décision :

| Situation                                        | Sanction      |
|--------------------------------------------------|---------------|
| 1er écart léger, aucun antécédent                | Avertissement |
| Récidive, ou faute sérieuse                      | Suspension    |
| Faute grave (mineur, nudité, haine, menaces)     | Bannissement  |
| 3ᵉ signalement confirmé / 2 sanctions au compteur| Bannissement  |

- **Avertissement** — message clair au membre, incrémente le compteur.
- **Suspension** — accès bloqué temporairement (quelques heures → jours).
- **Bannissement** — définitif, sans seconde chance.
- **Rejeter** — signalement non fondé, dossier fermé sans effet sur le membre.

---

## 6. Modèle de données (proposition)

### `report` — un signalement brut
```json
{
  "id": "uuid",
  "reportedUserId": "uuid",     // membre signalé (clé de regroupement)
  "reporterUserId": "uuid|null",// null si anonyme
  "reason": "harassment",       // enum, voir §3
  "note": "texte libre optionnel",
  "callId": "uuid",             // l'appel concerné
  "city": "Antananarivo",
  "createdAt": "ISO-8601",
  "status": "open"              // open | resolved
}
```

### `case` — dossier (peut être calculé à la volée en V0)
```json
{
  "reportedUserId": "uuid",
  "reportIds": ["uuid", "uuid"],
  "count": 2,
  "topReason": "hate_speech",   // motif le plus grave
  "severity": "high",           // high | mid | low
  "otherReasons": ["spam"],
  "priorSanctions": 1,          // antécédents du membre
  "createdAt": "ISO-8601",      // premier signalement
  "lastReportAt": "ISO-8601",
  "status": "open"
}
```

En V0, `case` n'a **pas besoin d'être une table** : on peut le calculer par un
`GROUP BY reportedUserId WHERE status = 'open'`. C'est ce que fait le
prototype (`buildCases()` dans `admin.html`).

### Enum `reason`
```
sexual_content | minor | hate_speech | harassment | spam | other
```

---

## 7. API (minimum V0)

```
POST /reports
  body: { reportedUserId, reason, note?, callId }
  → 201. Crée le report + applique l'action auto (coupe l'appel, bloque la paire)

GET  /mod/cases?severity=&reason=
  → liste des dossiers ouverts, triés (gravité desc, count desc, récence)

POST /mod/cases/:reportedUserId/resolve
  body: { action: "dismiss|warn|suspend|ban", moderatorId }
  → ferme tous les reports du dossier, applique la sanction, incrémente prior

GET  /mod/metrics
  → KPI de la vue d'ensemble (voir §8)
```

---

## 8. Métriques (vue d'ensemble)

Chiffres affichés dans la console. À brancher sur de vraies requêtes :

- **Membres inscrits** + nouveaux (7 j)
- **Appels aujourd'hui** + variation vs hier
- **Durée moyenne** d'appel
- **Dossiers à traiter** (= dossiers ouverts, pas signalements bruts)
- **Appels par jour** (7 j) — histogramme
- **Motifs de signalement** (30 j) — répartition en %
- **Top villes** (membres actifs)
- **Santé** : taux de mise en relation, appels sans incident, taux de
  signalement, rétention 7 j, délai moyen de modération

---

## 9. Règles anti-abus (important dès la V0)

Le signalement est une arme — il faut éviter qu'elle serve à harceler.

- **1 signalement par paire d'appel** : A ne peut pas signaler B 10 fois pour
  gonfler le compteur. Un `report` est unique par `(reporterUserId, callId)`.
- **Signalements rejetés tracés** : si un membre voit ses signalements
  systématiquement rejetés (faux signalements), on le note — un abus de
  signalement est lui-même une faute.
- **Anonymat du signaleur** : le membre signalé ne sait jamais qui l'a signalé.
- **Pas d'enregistrement d'appel** : seules les métadonnées nécessaires au
  traitement sont conservées, de façon limitée dans le temps (cohérent avec la
  page Sécurité et la politique de confidentialité).

---

## 10. Ce qui suffit pour la V0

Le minimum viable, dans l'ordre de priorité :

1. `POST /reports` + action auto (couper l'appel, bloquer la paire). **Non négociable.**
2. Regroupement par membre (`GROUP BY`) dans la console.
3. Tri automatique par gravité.
4. 4 actions de modération : Rejeter / Avertir / Suspendre / Bannir.
5. Compteur d'antécédents (`prior`) affiché.
6. Objectif opérationnel : **la file peut être vidée chaque jour** par 1-2 modérateurs.

Le reste (métriques avancées, détection auto, ML) vient après.
