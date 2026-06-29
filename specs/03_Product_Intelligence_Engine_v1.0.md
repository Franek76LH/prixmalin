# Product Intelligence Engine — PrixMalin
## Version : 1.0
**Date : 29 juin 2026**
**Statut : document fondateur — PrixMalin Core**
**Périmètre : reconnaissance des libellés de tickets, normalisation, scores de confiance, apprentissage des alias**

---

## 0. Objet du document

Ce document décrit le moteur de reconnaissance de PrixMalin.

Son rôle est de transformer un libellé brut de ticket de caisse en produit identifié dans le référentiel.

Exemple :

```text
JAMB SUP RANOU 4X80G
→ Jambon supérieur Ranou 4 × 80 g
→ Produit générique : Jambon supérieur
→ Catégorie : Viandes & charcuterie > Charcuterie
```

Ce document est complémentaire du Référentiel Produit (document 01) et du Modèle de données (document 02).

---

## 1. Principe central

> **Reconnaître largement au niveau générique, mais rester exigeant pour identifier une référence commerciale exacte.**

Cette règle gouverne toutes les décisions du moteur.

Elle signifie que PrixMalin peut classer et comparer rapidement des produits sans
pour autant associer trop facilement un paquet de 6 rouleaux à une référence de 12 rouleaux.

---

## 2. Les deux scores de confiance

Le moteur produit systématiquement deux scores distincts.

### 2.1. `confiance_generique`

Score de confiance que le libellé correspond au bon **produit générique**.

Exemple :
```text
LOTUS CONF 6RLX → Papier toilette Lotus Confort → confiance_generique : 0,98
```

### 2.2. `confiance_exact`

Score de confiance que le libellé correspond à la bonne **référence commerciale exacte**.

Exemple :
```text
LOTUS CONF 6RLX → Lotus Confort 6 rouleaux → confiance_exact : 0,94
LOTUS CONF 6RLX → Lotus Confort 12 rouleaux → confiance_exact : 0,22
```

### 2.3. Pourquoi deux scores

Un score textuel élevé ne suffit pas lorsque le format contredit le produit.

| Libellé ticket | Produit générique | confiance_generique | Référence exacte | confiance_exact |
|---|---|---|---|---|
| LOTUS CONF 6RLX | Papier toilette Lotus Confort | 0,98 | Lotus Confort 6 rouleaux | 0,94 |
| LOTUS CONF 6RLX | Papier toilette Lotus Confort | 0,98 | Lotus Confort 12 rouleaux | 0,22 |

Le moteur peut classer correctement sans inventer le mauvais format.

### 2.4. Règle de cohérence

Si `confiance_generique` est élevé mais `confiance_exact` est faible, PrixMalin :

- classe le produit dans le bon produit générique ;
- ne valide pas la référence commerciale exacte ;
- laisse `matched_product_id` vide ;
- renseigne `matched_generic_id`.

---

## 3. Zones de décision

Le moteur opère dans trois zones selon les scores obtenus.

### Zone 1 — Validation automatique

```text
confiance_generique ≥ 0,95
ET confiance_exact ≥ 0,95
ET aucun garde-fou violé
→ validation automatique
```

PrixMalin reconnaît et classe le produit sans intervention de l'utilisateur.

**Conditions supplémentaires obligatoires :**

Aucun des garde-fous suivants ne doit être violé :

- l'enseigne ou le magasin contredit l'alias connu ;
- la marque détectée contredit le produit associé ;
- le format ou le conditionnement contredit la référence exacte ;
- le produit générique de l'alias contredit la sous-catégorie détectée ;
- le prix observé est incohérent avec les observations historiques (écart > 300 %).

Si un seul garde-fou est violé, le moteur descend en zone 2, même si les scores sont élevés.

---

### Zone 2 — Suggestion à confirmer

```text
0,75 ≤ confiance_generique < 0,95
OU confiance_exact < 0,95 avec confiance_generique ≥ 0,75
→ suggestion à confirmer
```

PrixMalin présente une proposition déjà sélectionnée.

Interface proposée :

```text
Nous avons reconnu :
▶ Jambon supérieur Ranou – 4 × 80 g  ✓ Confirmer

Pas le bon produit ?  [Choisir un autre]
```

Règles d'affichage :

- la suggestion la plus probable est pré-sélectionnée ;
- si plusieurs produits sont proches, deux ou trois alternatives sont proposées au maximum ;
- l'utilisateur ne doit pas avoir à parcourir tout le catalogue ;
- une confirmation rapide doit être possible en un seul geste.

---

### Zone 3 — Non classé temporaire

```text
confiance_generique < 0,75
→ non_classe temporaire
```

PrixMalin ne valide aucune correspondance.

La ligne est marquée `non_classe` avec `validation_status = needs_review`.

L'utilisateur peut toujours rechercher et associer manuellement un produit.

**Distinction importante :**

| État | Signification |
|---|---|
| `non_classe` temporaire | Le moteur manque d'information. Résolvable. |
| Produit définitivement inconnu | Le produit n'existe pas encore dans le référentiel. |

`non_classe` signifie uniquement : le système ne dispose pas encore d'assez d'informations. Ce n'est pas un échec définitif.

---

## 4. Les cinq niveaux de représentation d'un libellé

Le moteur ne supprime jamais d'information. Il crée des représentations complémentaires.

### Niveau 1 — Texte brut

Jamais modifié. Conservé tel quel dans `receipt_lines.raw_label`.

```text
JAMB SUP RANOU 4X80G
```

### Niveau 2 — Alias normalisé complet

Nettoyage de forme, conservation de toutes les informations.

```text
jamb sup ranou 4 x 80 g
```

Opérations appliquées :

| Opération | Exemple |
|---|---|
| Passage en minuscules | `JAMB` → `jamb` |
| Suppression des accents | `éclairs` → `eclairs` |
| Suppression de la ponctuation inutile | `LOTUS,CONF` → `lotus conf` |
| Réduction des espaces multiples | `JAMB  SUP` → `jamb sup` |
| Normalisation de ×, *, X vers x | `4X80G` → `4 x 80 g` |
| Séparation chiffres et unités | `80G` → `80 g` |
| Normalisation des unités | `GR`, `GRAM`, `GRAMMES` → `g` |
| Normalisation des unités | `LIT`, `LITRE`, `LITRES` → `l` |
| Normalisation des unités | `CL`, `ML`, `KG` → formes canoniques |

Cette représentation est stockée dans `product_aliases.normalized_alias`.
Elle sert à chercher un alias précis dans le dictionnaire.

### Niveau 3 — Composants extraits

Le moteur sépare les composants sémantiques du libellé.

| Composant | Champ | Valeur pour `JAMB SUP RANOU 4X80G` |
|---|---|---|
| Type de produit | `detected_name` | jambon supérieur |
| Marque | `detected_brand` | Ranou |
| Conditionnement | `packaging_candidate` | 4 |
| Quantité unitaire | `quantity_candidate` | 80 |
| Unité | `unit_candidate` | g |
| Quantité totale calculée | — | 320 g |

Ces composants sont stockés dans `receipt_lines` pour permettre des vérifications de cohérence.

### Niveau 4 — Clé générique (sans format)

Pour reconnaître le produit générique, le format est ignoré.

```text
jambon superieur ranou
```

ou, si la marque est ambiguë :

```text
jambon superieur
```

Cette clé sert à identifier le produit générique, indépendamment du conditionnement.

### Niveau 5 — Clé de référence exacte (avec format)

Pour identifier la référence commerciale exacte, le format est conservé.

```text
ranou jambon superieur 4 x 80 g
```

Cette clé sert à trouver ou créer le `product_id` exact.

---

## 5. Exemple complet de traitement

**Ticket :**
```text
JAMB SUP RANOU 4X80G    2,52 €
```

**Données produites par le moteur :**

| Champ | Valeur |
|---|---|
| `raw_label` | `JAMB SUP RANOU 4X80G` |
| `normalized_label` | `jamb sup ranou 4 x 80 g` |
| `detected_brand` | `Ranou` |
| `detected_name` | `Jambon supérieur` |
| `detected_format` | `4 x 80 g` |
| `packaging_candidate` | `4` |
| `quantity_candidate` | `80` |
| `unit_candidate` | `g` |

**Résultats de reconnaissance :**

| Niveau | Résultat | Score |
|---|---|---|
| Produit générique | Jambon supérieur | confiance_generique : 0,98 |
| Référence exacte | Jambon supérieur Ranou 4 × 80 g | confiance_exact : 0,96 |

**Décision :**

Score ≥ 0,95 aux deux niveaux, aucun garde-fou violé → **validation automatique**.

---

## 6. Ordre de recherche dans le dictionnaire

Le moteur recherche un alias dans cet ordre de priorité.

```text
1. normalized_alias + store_id           (alias propre à ce magasin exact)
2. normalized_alias + store_brand        (alias propre à cette enseigne)
3. normalized_alias global               (alias universel)
4. recherche par composants extraits     (reconnaissance sémantique)
5. proposition à l'utilisateur           (aucune correspondance trouvée)
```

Un alias plus spécifique est toujours prioritaire sur un alias plus général.

---

## 7. Apprentissage et cycle de vie d'un alias

### 7.1. Statuts d'un alias

```text
observé → candidate → validated → contested → disabled
```

| Statut | Signification |
|---|---|
| `candidate` | Alias observé, non encore confirmé |
| `validated` | Alias fiable, utilisable automatiquement dans sa portée |
| `contested` | Alias ambigu, validation suspendue |
| `disabled` | Alias désactivé, non utilisé |

### 7.2. Première observation

Lorsqu'un alias est vu pour la première fois, il est créé avec :

```text
status = candidate
times_seen = 1
confidence_score = calculé par le moteur
```

Lorsqu'il réapparaît, PrixMalin le propose en suggestion mais demande encore confirmation.

### 7.3. Conditions de passage à `validated`

Un alias passe automatiquement à `validated` lorsque toutes ces conditions sont réunies :

| Condition | Valeur minimale |
|---|---|
| Utilisateurs distincts ayant validé | 3 |
| Observations validées au total | 5 |
| Contradictions | 0 |

**Pourquoi 3 utilisateurs distincts ?**

Un seul utilisateur peut se tromper. Deux constituent un indice, mais une coïncidence reste possible. Trois utilisateurs indépendants donnent une base raisonnable pour une première version.

**Pourquoi 5 observations ?**

Un alias peut être vu plusieurs fois par la même personne. Cinq observations garantissent une répétition suffisante sans exiger des dizaines de tickets.

**Validation par un administrateur :**

Un administrateur PrixMalin peut passer un alias directement à `validated` lors d'un travail de nettoyage du catalogue. La source de validation reste visible :

```text
validated_by = uuid de l'administrateur
source = admin
```

### 7.4. Portée de la validation

La validation est toujours liée à une portée précise.

**Portée magasin :**

3 utilisateurs du même magasin suffisent à valider l'alias pour ce magasin.

**Portée enseigne :**

Pour étendre l'alias à toute l'enseigne, l'alias doit être observé dans au moins 3 magasins différents de la même enseigne.

Exemple :
```text
Carrefour Bonneveine     → LOTUS CFT 12R → Lotus Confort 12 rouleaux
Carrefour Le Merlan      → LOTUS CFT 12R → Lotus Confort 12 rouleaux
Carrefour Grand Littoral → LOTUS CFT 12R → Lotus Confort 12 rouleaux
→ alias validé pour toute l'enseigne Carrefour
```

**Portée globale :**

Un alias ne devient global que si :

- sa signification est non ambiguë ;
- il est observé dans plusieurs enseignes différentes ;
- il pointe toujours vers le même produit générique ;
- aucune contradiction n'a été enregistrée.

Les alias globaux doivent rester rares. Les mêmes abréviations peuvent signifier des choses différentes selon les enseignes.

### 7.5. Gestion des contradictions

Exemple :

| Utilisateurs | Produit choisi |
|---|---|
| 4 utilisateurs | Jambon supérieur Ranou |
| 2 utilisateurs | Jambon à l'ancienne Ranou |

Dans ce cas :

- l'alias passe à `contested` ;
- la validation automatique est suspendue ;
- toutes les nouvelles occurrences passent en zone 2 (suggestion à confirmer) ;
- une résolution manuelle ou administrative est nécessaire.

**Règle de proportionnalité :**

Une seule contestation ne doit pas annuler vingt validations. Mais elle doit suspendre l'automatisation dès qu'elle révèle une ambiguïté réelle de format ou de référence.

---

## 8. Garde-fous

Un score élevé ne suffit pas à déclencher la validation automatique si un garde-fou est violé.

| Garde-fou | Exemple de violation |
|---|---|
| Cohérence enseigne | Alias validé pour Carrefour utilisé pour Leclerc |
| Cohérence marque | Alias Ranou associé à un produit Herta |
| Cohérence format | `LOTUS CONF 6RLX` associé à Lotus Confort 12 rouleaux |
| Cohérence catégorie | Produit générique dans Charcuterie associé à Fromages |
| Cohérence prix | Prix observé 10× supérieur à la médiane historique |

Lorsqu'un garde-fou est violé, le moteur descend en zone 2 (suggestion) ou zone 3 (non_classe) selon la gravité.

---

## 9. Cas particuliers

### 9.1. Alias enseigne-dépendant

Certaines abréviations sont propres à un système de caisse.

Exemple :
```text
Intermarché : SCE QCK NT → Sauce Quick'n Toast
Carrefour   : SCE QCK NT → autre produit possible
```

Dans ce cas, l'alias ne doit jamais être promu en alias global. Sa portée reste limitée à l'enseigne ou au magasin.

### 9.2. Libellé trop court

Un libellé de moins de 3 caractères significatifs après normalisation ne doit pas déclencher de reconnaissance automatique.

```text
OEF
→ non_classe temporaire, saisie manuelle recommandée
```

### 9.3. Produit générique reconnu, référence exacte inconnue

Lorsque le produit générique est identifié avec une haute confiance mais que la référence exacte n'existe pas encore dans la base :

- `matched_generic_id` est renseigné ;
- `matched_product_id` reste vide ;
- un produit de référence candidat peut être créé automatiquement avec `confidence_score` faible et `status = candidate` ;
- l'utilisateur peut confirmer ou corriger.

### 9.4. Nouveau produit jamais vu

Si aucune correspondance n'est trouvée à aucun niveau :

- la ligne passe en `non_classe` ;
- le libellé normalisé est conservé dans `product_aliases` avec `status = candidate` et `times_seen = 1` ;
- l'utilisateur est invité à choisir manuellement ;
- sa validation crée ou confirme l'alias.

---

## 10. Champs produits par le moteur

Récapitulatif des champs renseignés dans `receipt_lines` par le moteur.

| Champ | Renseigné par |
|---|---|
| `raw_label` | OCR — jamais modifié |
| `normalized_label` | Normalisation niveau 2 |
| `detected_brand` | Extraction niveau 3 |
| `detected_name` | Extraction niveau 3 |
| `detected_format` | Extraction niveau 3 |
| `matched_generic_id` | Reconnaissance niveau 4 |
| `matched_product_id` | Reconnaissance niveau 5 |
| `matched_alias_id` | Alias utilisé |
| `confidence_score` | Score combiné |
| `validation_status` | Décision automatique |
| `assigned_subcategory_id` | Déduit du produit générique |

---

## 11. Évolutions prévues

Ces fonctionnalités ne font pas partie de la version initiale mais sont prévues.

| Fonctionnalité | Déclencheur |
|---|---|
| Reconnaissance par code-barres EAN | Connexion à Open Food Facts ou scan EAN |
| Enrichissement via catalogue Drive | Import automatisé |
| Détection de changement de recette | Variation EAN avec produit similaire |
| Score basé sur la communauté | Suffisamment d'utilisateurs actifs |
| Suggestion proactive de correction | Anomalie de prix détectée |

---

## 12. Versionnage

| Version | Date | Nature |
|---|---|---|
| 1.0 | Juin 2026 | Version fondatrice |

---

## 13. Documents liés au PrixMalin Core

1. **Référentiel Produit PrixMalin** — document 01
2. **Modèle de données Supabase** — document 02
3. **Product Intelligence Engine** — présent document
4. **Règles métier PrixMalin** — scores, validation et économies
5. **Architecture fonctionnelle** — interactions entre modules
6. **Plan de migration Supabase** — scripts, tests et retour arrière

---

*Document fondateur PrixMalin — toute évolution du moteur de reconnaissance doit respecter le principe central : reconnaître largement au niveau générique, rester exigeant pour la référence exacte.*
