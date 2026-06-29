# Architecture fonctionnelle PrixMalin
## Version : 1.0
**Date : 29 juin 2026**
**Statut : document fondateur — PrixMalin Core**
**Périmètre : description complète de l'architecture cible, interactions entre modules, flux de données, état de transition**

---

## 0. Objet du document

Ce document décrit l'architecture fonctionnelle cible de PrixMalin.

Il répond à cinq questions :

1. quels sont les modules qui composent PrixMalin ?
2. comment les données circulent entre ces modules ?
3. quelles tables sont lues et écrites par chaque module ?
4. quelles règles gouvernent chaque interaction ?
5. quel est l'état de transition entre l'architecture actuelle et l'architecture cible ?

Ce document est le cinquième et dernier document fondateur du PrixMalin Core. Il s'appuie sur les quatre documents précédents et en constitue la synthèse opérationnelle.

---

## 1. Vue d'ensemble

PrixMalin est une application communautaire de comparaison de prix. Elle repose sur sept modules fonctionnels interconnectés.

```text
┌─────────────────────────────────────────────────────────────────┐
│                        UTILISATEUR                              │
└────────┬────────────────────┬────────────────────┬─────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
  ┌─────────────┐    ┌─────────────────┐   ┌──────────────────┐
  │  MODULE 1   │    │    MODULE 2      │   │    MODULE 3       │
  │    SCAN     │    │  SAISIE MANUELLE │   │   LISTE DE       │
  │  DE TICKET  │    │  DE PRIX        │   │   COURSES        │
  └──────┬──────┘    └────────┬────────┘   └────────┬─────────┘
         │                    │                     │
         └──────────┬─────────┘                     │
                    ▼                               │
         ┌─────────────────────┐                   │
         │      MODULE 4        │                   │
         │  PRODUCT INTELLIGENCE│                   │
         │      ENGINE         │                   │
         └──────────┬──────────┘                   │
                    │                               │
                    ▼                               ▼
         ┌─────────────────────┐      ┌─────────────────────┐
         │      MODULE 5        │      │      MODULE 6        │
         │    COMPARATEUR      │◄─────│    RECOMMANDATIONS  │
         │    DE PRIX          │      │    & ÉCONOMIES      │
         └──────────┬──────────┘      └─────────────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │      MODULE 7        │
         │    COMMUNAUTÉ &     │
         │    GOUVERNANCE      │
         └─────────────────────┘
```

---

## 2. Les sept modules

### Module 1 — Scan de ticket

**Rôle :** transformer une ou plusieurs photos de ticket de caisse en données structurées.

**Entrée :** image(s) JPEG ou PNG transmises par l'utilisateur.

**Sortie :** un ticket (`receipts`) et ses lignes (`receipt_lines`).

**Flux détaillé :**

```text
1. L'utilisateur photographie son ticket (1 à N photos)
2. L'application génère un client_scan_id unique
3. Les images sont envoyées à la Edge Function scan-ticket (Supabase)
4. La Edge Function appelle OpenRouter → Claude via l'API OCR
5. Claude retourne le texte brut reconnu (ocr_raw_text)
6. Le moteur d'extraction identifie :
   - le nom du magasin (store_name_raw)
   - la date du ticket (receipt_date)
   - le montant total (total_amount)
   - chaque ligne produit (raw_label + prix)
7. Vérification du client_scan_id (doublon certain ?)
8. Calcul du receipt_fingerprint (doublon probable ?)
9. Si nouveau ticket : création dans receipts + receipt_lines
10. Transmission au Module 4 (Product Intelligence Engine)
11. Transmission au Module 5 (Comparateur) pour écriture dans prices
```

**Tables lues :**
- `stores` (reconnaissance du magasin)
- `receipts` (vérification doublon via client_scan_id et receipt_fingerprint)

**Tables écrites :**
- `receipts`
- `receipt_lines`

**Règles applicables :**
- Le `raw_label` ne doit jamais être modifié après création
- Un `client_scan_id` déjà connu → retour du ticket existant sans création
- Un `receipt_fingerprint` identique → doublon certain
- Une empreinte très proche (≥ 95 % des lignes) → `duplicate_status = suspected`
- En cas d'erreur OCR partielle : le ticket est créé avec `status = needs_review`
- Les images multi-photos sont fusionnées avant enregistrement (lignes en doublon détectées par chevauchement)

**Clé API :** `OPENROUTER_API_KEY` stockée exclusivement côté serveur (Edge Function). Jamais exposée dans le navigateur.

---

### Module 2 — Saisie manuelle de prix

**Rôle :** permettre à l'utilisateur d'enregistrer un prix sans ticket.

**Entrée :** formulaire saisi par l'utilisateur (produit, magasin, prix, date, format).

**Sortie :** une observation de prix dans `prices`, sans `receipt_line_id`.

**Flux détaillé :**

```text
1. L'utilisateur choisit un produit via l'autocomplete
2. Il sélectionne ou crée un magasin
3. Il saisit le prix, la quantité, l'unité, le conditionnement
4. Validation des données (cohérence prix/format)
5. Création dans prices avec source = manuel
6. Transmission au Module 4 pour rattachement produit si nécessaire
```

**Tables lues :**
- `products`, `generic_products` (autocomplete produit)
- `stores` (sélection magasin)
- `subcategories`, `categories` (navigation catalogue)

**Tables écrites :**
- `prices`
- `stores` (si magasin inconnu créé par l'utilisateur)

**Règles applicables :**
- `receipt_line_id` reste null pour une saisie manuelle
- `source = manuel` dans `prices`
- Le prix doit être strictement positif
- Les dates futures sont refusées
- Un magasin inconnu peut être créé avec adresse manuelle ou GPS

---

### Module 3 — Liste de courses

**Rôle :** permettre à l'utilisateur de préparer ses courses et d'obtenir une recommandation de magasin avant l'achat.

**Entrée :** liste de produits saisie ou importée par l'utilisateur.

**Sortie :** recommandation de magasin(s) + estimation du coût du panier.

**Flux détaillé :**

```text
1. L'utilisateur crée ou modifie sa liste de courses
2. Pour chaque article, il peut spécifier :
   - le produit générique ou la référence exacte
   - la quantité souhaitée
   - le format préféré
3. Le Module 5 (Comparateur) est interrogé pour chaque article
4. PrixMalin calcule le coût du panier pour chaque magasin disponible
5. Il recommande la meilleure solution viable (1 ou 2 magasins)
6. L'utilisateur peut valider, modifier ou ignorer la recommandation
7. Après les courses, l'utilisateur scanne son ticket (Module 1)
8. Le rapprochement entre liste et ticket permet de calculer l'économie réalisée
```

**Tables lues :**
- `shopping_list`
- `products`, `generic_products`
- `prices` (via Module 5)
- `stores`

**Tables écrites :**
- `shopping_list`

**Règles applicables :**
- La recommandation affiche « jusqu'à X € d'économies potentielles »
- Après rapprochement avec le ticket : « X € réellement économisés »
- Le rapprochement est possible uniquement si les produits de la liste et du ticket sont identifiables
- Zone de recherche : 50 km (indépendante du rayon habituel du comparateur)

---

### Module 4 — Product Intelligence Engine

**Rôle :** transformer un libellé brut de ticket en produit identifié dans le référentiel.

**Entrée :** `receipt_lines.raw_label` + contexte (enseigne, magasin, prix, format).

**Sortie :** `matched_product_id` ou `matched_generic_id` + `confidence_score`.

**Flux détaillé :**

```text
1. Réception d'une ligne de ticket (raw_label)
2. Normalisation niveau 2 → normalized_label
   (minuscules, sans accents, unités normalisées, espaces nettoyés)
3. Extraction des composants niveau 3
   (detected_brand, detected_name, detected_format, packaging_candidate…)
4. Recherche dans product_aliases par ordre de priorité :
   a. normalized_alias + store_id
   b. normalized_alias + store_brand
   c. normalized_alias global
   d. recherche sémantique par composants extraits
5. Calcul de confiance_generique et confiance_exact
6. Application des garde-fous (cohérence enseigne, marque, format, catégorie, prix)
7. Décision selon les zones :
   - score ≥ 0,95 sur les deux niveaux et aucun garde-fou violé → validation automatique
   - 0,75 ≤ score < 0,95 → suggestion à confirmer (zone 2)
   - score < 0,75 → non_classe temporaire (zone 3)
8. Mise à jour de receipt_lines (matched_product_id, matched_generic_id, matched_alias_id)
9. Mise à jour ou création dans product_aliases (times_seen, last_seen_at, status)
10. Si validé : transmission au comparateur pour écriture dans prices
```

**Tables lues :**
- `product_aliases`
- `products`, `generic_products`
- `subcategories`, `categories`
- `stores`

**Tables écrites :**
- `receipt_lines` (mise à jour des champs de reconnaissance)
- `product_aliases` (apprentissage : times_seen, statut)
- `products` (création d'un produit candidat si inconnu)

**Règles applicables :**
- Deux scores distincts : `confiance_generique` et `confiance_exact`
- Un score élevé ne suffit pas si un garde-fou est violé
- Le `raw_label` n'est jamais modifié
- Un alias `candidate` passe à `validated` après 3 utilisateurs distincts + 5 observations + 0 contradiction
- La portée de validation suit l'ordre : magasin → enseigne → global
- Un alias `contested` suspend la validation automatique

---

### Module 5 — Comparateur de prix

**Rôle :** trouver le meilleur prix disponible pour un produit ou un panier dans une zone géographique.

**Entrée :** produit (ou liste), localisation, rayon de recherche.

**Sortie :** classement des magasins par prix, avec indication de fraîcheur et de confiance.

**Flux détaillé :**

```text
1. Réception d'une demande de comparaison (produit + localisation + rayon)
2. Récupération des observations de prix actives (status = active ou confirmed_promotion)
3. Filtrage par fraîcheur selon la freshness_class de la sous-catégorie :
   - volatile : 7 jours
   - fresh : 14 jours
   - standard : 30 jours
   - stable : 60 jours
4. Filtrage géographique (distance entre l'utilisateur et le magasin)
5. Calcul du prix normalisé (prix au kg, litre, pièce…)
6. Regroupement par magasin avec clé :
   COALESCE(product_id, generic_product_id) + format + store_id + date + price
7. Classement des magasins par prix normalisé
8. Pour un panier : calcul du coût total par magasin
9. Calcul de la meilleure solution viable (1 ou 2 magasins, zone 50 km)
10. Application du seuil de pertinence pour deux magasins (provisoire : 5 €)
11. Retour du classement + indication de fraîcheur + nombre de tickets confirmants
```

**Tables lues :**
- `prices` (filtré sur status actif + fraîcheur)
- `products`, `generic_products`
- `stores` (coordonnées GPS pour calcul de distance)
- `subcategories` (freshness_class)

**Tables écrites :**
- Aucune (module en lecture seule)

**Règles applicables :**
- Seuls les statuts `active` et `confirmed_promotion` valide sont utilisés
- Un prix expiré peut être affiché en information secondaire : « Dernier prix connu : X €, il y a N jours »
- La médiane est utilisée pour détecter les anomalies, pas la moyenne
- Le comparateur ne fusionne pas les observations brutes : il les regroupe uniquement pour l'affichage
- Pendant la transition : le comparateur lit également `price_db` (compatibilité)

**Compatibilité transition :**

Pendant la phase de transition, le comparateur maintient une double lecture :

```text
Nouvelles données → prices (nouvelle structure)
Données historiques → price_db (ancienne structure)
```

La priorité est donnée aux données de `prices` lorsqu'elles existent pour un produit et un magasin.

---

### Module 6 — Recommandations et économies

**Rôle :** calculer et présenter les économies potentielles et réalisées à l'utilisateur.

**Entrée :** historique des achats de l'utilisateur + résultats du comparateur.

**Sortie :** indicateurs d'économies personnalisés, affichés sur l'écran d'accueil et dans le profil.

**Flux détaillé :**

```text
1. Récupération de l'historique des achats de l'utilisateur (prices + receipts)
2. Pour chaque achat :
   a. Interrogation du Module 5 pour obtenir le meilleur prix disponible à la date d'achat
   b. Calcul de l'économie potentielle :
      prix payé − meilleure solution viable = économie potentielle
3. Si rapprochement liste → ticket possible :
   a. Calcul de l'économie réalisée :
      panier de référence − prix réellement payé = économie réalisée
4. Agrégation mensuelle et annuelle
5. Calcul de la médiane des prix de la zone (indicateur secondaire)
6. Si magasin habituel identifiable :
   a. Calcul de l'économie par rapport au magasin habituel (indicateur complémentaire)
7. Affichage sur l'écran d'accueil :
   - bandeau économies du mois
   - meilleure opportunité détectée
8. Affichage dans le profil :
   - historique mensuel
   - récapitulatif annuel (#31)
```

**Tables lues :**
- `prices`
- `receipts`, `receipt_lines`
- `products`, `generic_products`
- `stores`
- `shopping_list`

**Tables écrites :**
- Aucune (module en lecture seule, calculs en mémoire)

**Règles applicables :**
- « Économie potentielle » : formulation obligatoire sans preuve d'achat
- « Économie réalisée » : formulation autorisée uniquement avec rapprochement ticket validé
- La médiane (et non la moyenne) est utilisée pour le prix de référence de zone
- Le magasin habituel n'est affiché que si identifiable avec suffisamment de données
- Les économies potentielles passées ne doivent pas être rétroactivement converties en économies réalisées

---

### Module 7 — Communauté et gouvernance

**Rôle :** gérer la fiabilité des données partagées, la validation communautaire et les droits d'accès.

**Entrée :** actions des utilisateurs (validation, contestation, signalement, partage).

**Sortie :** mise à jour des statuts, scores de confiance, alias validés.

**Flux détaillé :**

```text
1. Validation communautaire d'un alias :
   a. L'utilisateur confirme ou corrige une suggestion du Module 4
   b. Mise à jour de product_aliases (times_seen, distinct_user_count, status)
   c. Si conditions atteintes (3 users, 5 obs, 0 contradiction) → alias = validated
   d. Si contradiction → alias = contested

2. Signalement d'un prix suspect :
   a. L'utilisateur signale un prix anormal
   b. Mise à jour du statut dans prices → suspect
   c. Suspension de l'utilisation dans le comparateur

3. Confirmation communautaire d'un prix suspect :
   a. Même prix observé par 2 users distincts, 3 tickets, même magasin, 7 jours
   b. Statut → confirmed_promotion
   c. Durée de vie : 7 jours (ou promotion_end_date si connue)

4. Gestion des cercles :
   a. Un utilisateur peut partager ses prix avec son cercle
   b. Les prix partagés sont visibles dans le comparateur des membres du cercle
   c. Les prix privés restent invisibles aux autres utilisateurs

5. Validation administrateur :
   a. Un admin peut passer directement un alias à validated
   b. La source de validation est tracée : source = admin
   c. Un admin peut rejeter ou désactiver un prix ou un alias

6. Gouvernance du référentiel :
   a. Les catégories et sous-catégories ne peuvent être modifiées que par un admin
   b. Les utilisateurs peuvent proposer une correction ou signaler une erreur
   c. Les produits génériques ne peuvent être créés que par un processus validé
```

**Tables lues :**
- `product_aliases`
- `prices`
- `profiles`
- `circles`

**Tables écrites :**
- `product_aliases` (statut, times_seen, validated_by)
- `prices` (statut, correction_reason, supersedes_price_id)
- `community_prices` (prix partagés avec la communauté)

**Règles applicables :**
- Un utilisateur ne peut valider que ses propres associations de produits
- Une seule confirmation principale par utilisateur, produit, magasin et journée
- La validation administrateur est tracée et irréversible sans nouvelle décision admin
- Un alias contesté suspend immédiatement la validation automatique
- La liste des statuts autorisés est commune à tous les modules :
  `active`, `suspect`, `confirmed_promotion`, `contested`, `rejected`, `expired`, `superseded`

---

## 3. Flux de données complet — cas du scan de ticket

Voici le flux complet d'une donnée depuis la photo jusqu'à l'affichage dans le comparateur.

```text
UTILISATEUR
│
│ photographie son ticket
▼
MODULE 1 — SCAN
│ OCR via Edge Function → OpenRouter → Claude
│ Création : receipts + receipt_lines (raw_label)
│ Vérification doublon (client_scan_id + receipt_fingerprint)
▼
MODULE 4 — PRODUCT INTELLIGENCE ENGINE
│ Normalisation du raw_label
│ Recherche dans product_aliases
│ Calcul confiance_generique + confiance_exact
│ Garde-fous
│ Décision : validation auto / suggestion / non_classe
│ Mise à jour : receipt_lines + product_aliases
▼
MODULE 5 — COMPARATEUR (écriture)
│ Création dans prices :
│   product_id ou generic_product_id
│   store_id
│   price, unit_price, price_per_unit
│   observed_at, source, confidence_score
│   status = active
▼
MODULE 6 — RECOMMANDATIONS
│ Calcul économie potentielle
│ Mise à jour bandeau économies
▼
MODULE 7 — COMMUNAUTÉ
  Mise à jour score de confiance de l'alias
  Si alias atteint les seuils → validated
```

---

## 4. Flux de données complet — cas de la comparaison de prix

```text
UTILISATEUR
│ demande une comparaison (produit + localisation)
▼
MODULE 5 — COMPARATEUR (lecture)
│ Lecture prices (status actif + fraîcheur OK)
│ Filtrage géographique
│ Calcul prix normalisé
│ Regroupement par magasin
│ Classement
▼
MODULE 6 — RECOMMANDATIONS
│ Calcul meilleure solution viable (1 ou 2 magasins)
│ Application seuil 5 € pour 2 magasins
│ Calcul économie potentielle
▼
UTILISATEUR
  Affichage : classement + économie potentielle
```

---

## 5. Flux de données complet — cas de la liste de courses

```text
UTILISATEUR
│ crée sa liste de courses
▼
MODULE 3 — LISTE DE COURSES
│ Enregistrement dans shopping_list
│ Interrogation Module 5 pour chaque article
▼
MODULE 5 — COMPARATEUR
│ Prix disponibles par magasin pour chaque article
▼
MODULE 6 — RECOMMANDATIONS
│ Calcul coût total panier par magasin
│ Recommandation meilleure solution viable
│ Affichage économie potentielle
▼
UTILISATEUR
│ fait ses courses
│ scanne son ticket
▼
MODULE 1 — SCAN
│ Traitement du ticket
▼
MODULE 4 — PIE
│ Reconnaissance des produits
▼
MODULE 6 — RECOMMANDATIONS
  Rapprochement liste → ticket
  Calcul économie réalisée
  Affichage : « X € réellement économisés »
```

---

## 6. Architecture technique

### 6.1. Stack

| Composant | Technologie |
|---|---|
| Frontend | React + Vite (PWA) |
| Backend | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| OCR | OpenRouter → Claude (via Edge Function) |
| Déploiement | Vercel |
| Versionnement | GitHub (`Franek76LH/prixmalin`, branche `main`) |

### 6.2. Sécurité

| Clé / Secret | Emplacement |
|---|---|
| `SUPABASE_ANON_KEY` | Client (publique, RLS protège les données) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function uniquement — jamais exposée |
| `OPENROUTER_API_KEY` | Edge Function uniquement — jamais exposée |
| Clés Vercel | Variables d'environnement Vercel |

### 6.3. Edge Functions

| Fonction | Rôle |
|---|---|
| `scan-ticket` | Réception des images, appel OCR, retour du texte brut |
| *(à créer)* `process-receipt` | Traitement transactionnel : receipts + receipt_lines + prices |
| *(à créer)* `validate-alias` | Validation communautaire d'un alias |

### 6.4. Politiques RLS

| Table | Lecture | Écriture |
|---|---|---|
| `categories`, `subcategories`, `generic_products` | Tout utilisateur authentifié | Admin uniquement |
| `products`, `product_aliases` | Tout utilisateur authentifié | Processus validé ou admin |
| `receipts`, `receipt_lines` | Propriétaire uniquement | Propriétaire via fonction serveur |
| `prices` | Lecture communautaire selon règles cercle | Propriétaire via fonction serveur |
| `stores` | Tout utilisateur authentifié | Tout utilisateur authentifié (magasin inconnu) |

### 6.5. Transactions

Les opérations suivantes doivent être exécutées dans une transaction PostgreSQL :

```text
Traitement d'un ticket :
  INSERT receipts
  INSERT receipt_lines (N lignes)
  INSERT prices (N lignes)
  UPDATE product_aliases (times_seen)
  INSERT price_db (compatibilité transition)
  → Tout réussit ou tout échoue
```

L'idempotence est garantie par `client_scan_id` (UNIQUE sur `receipts`).

---

## 7. État de transition

### 7.1. Architecture actuelle (en production)

```text
scan-ticket (Edge Function OCR)
    ↓
App.jsx (traitement client)
    ↓
price_db (table unique)
    ↓
comparateur (lit price_db + constants.js STORES)
```

Limitations actuelles :

- tout est dans `price_db` (pas de séparation produit / prix / ticket)
- pas de dictionnaire d'alias (`product_aliases`)
- les noms de produits ne sont pas normalisés
- le comparateur utilise un tableau statique `STORES` dans `constants.js`
- `produits_ref` existe mais son contenu n'est pas encore audité
- `stores` existe mais son schéma exact n'a pas encore été audité

### 7.2. Architecture cible (après migration complète)

```text
scan-ticket (Edge Function OCR)
    ↓
process-receipt (Edge Function transactionnelle)
    ↓
receipts + receipt_lines
    ↓
Product Intelligence Engine
    ↓
product_aliases → products → generic_products
    ↓
prices
    ↓
comparateur (lit prices + stores avec coordonnées GPS)
    ↓
Module 6 Recommandations (économies potentielles / réalisées)
```

### 7.3. Phases de transition

| Phase | Description | État |
|---|---|---|
| 0 | Audit des tables existantes (`price_db`, `produits_ref`, `stores`) | À faire |
| 1 | Création des nouvelles tables (additive, sans toucher à l'existant) | À faire |
| 2 | Double écriture : nouveaux scans → `prices` ET `price_db` | À faire |
| 3 | Validation en production (comparaison des deux sources) | À faire |
| 4 | Migration du comparateur vers `prices` | À faire |
| 5 | Passage de `price_db` en lecture seule | À faire |
| 6 | Migration des 561 articles historiques de `price_db` | À faire |
| 7 | Audit et migration de `produits_ref` | À faire |

Aucune table existante n'est supprimée avant la validation complète de la phase correspondante.

### 7.4. Priorité d'exécution

L'ordre recommandé pour implémenter l'architecture cible est :

```text
1. Créer les tables du référentiel (categories, subcategories, generic_products)
2. Peupler le référentiel depuis le document 01
3. Créer products et product_aliases (vides)
4. Créer receipts, receipt_lines, prices (vides)
5. Créer la Edge Function process-receipt (transaction)
6. Brancher les nouveaux scans sur la nouvelle structure (double écriture)
7. Valider en production
8. Migrer le comparateur
9. Migrer les données historiques
```

---

## 8. Dépendances entre modules

| Module | Dépend de | Est utilisé par |
|---|---|---|
| Module 1 — Scan | Edge Function OCR, stores | Module 4 |
| Module 2 — Saisie manuelle | products, stores | Module 5 |
| Module 3 — Liste de courses | shopping_list, Module 5 | Module 6 |
| Module 4 — PIE | product_aliases, products, generic_products | Module 5, Module 7 |
| Module 5 — Comparateur | prices, stores, products | Module 3, Module 6 |
| Module 6 — Recommandations | Module 5, receipts, shopping_list | Interface utilisateur |
| Module 7 — Communauté | product_aliases, prices, circles | Module 4, Module 5 |

---

## 9. Points de vigilance

### 9.1. GPS uniquement en HTTPS

La géolocalisation (`navigator.geolocation`) ne fonctionne qu'en HTTPS. Elle est donc disponible uniquement en production (Vercel) et non sur le serveur de développement local (HTTP).

En développement local, utiliser une position simulée ou saisir manuellement les coordonnées.

### 9.2. Comparateur et `storeId`

Dans le code actuel, la colonne `storeId` (camelCase) nécessite des guillemets doubles dans toutes les requêtes SQL Supabase :

```sql
SELECT * FROM price_db WHERE "storeId" = '...'
```

Cette convention doit être respectée jusqu'à la migration complète.

### 9.3. Clé `STORES` dans `constants.js`

Le comparateur actuel utilise un tableau statique `STORES` dans `constants.js` pour faire correspondre les noms d'enseigne aux slugs. Ce tableau devra être remplacé par une lecture dynamique de la table `stores` après migration.

### 9.4. Supabase CLI

Le token CLI Supabase (`sbp_...`) expire le 28 juillet 2026. Il devra être renouvelé avant tout déploiement de Edge Function après cette date.

### 9.5. RLS sur `stores`

La table `stores` est actuellement sans RLS (UNRESTRICTED). L'activation des politiques RLS est prévue au point #36 du backlog.

---

## 10. Versionnage

| Version | Date | Nature |
|---|---|---|
| 1.0 | Juin 2026 | Version fondatrice |

---

## 11. Documents du PrixMalin Core

| # | Document | Statut |
|---|---|---|
| 01 | Référentiel Produit PrixMalin v1.1 | Déposé — commit 20ef784 |
| 02 | Modèle de données Supabase v1.1 | Déposé — commit 278b783 *(mise à jour v1.2 requise avant déploiement)* |
| 03 | Product Intelligence Engine v1.0 | Déposé — commit 7ba1391 |
| 04 | Règles métier PrixMalin v1.1 | Déposé — commit 31a228b |
| 05 | Architecture fonctionnelle v1.0 | Présent document |
| 06 | Plan de migration Supabase | À rédiger avant déploiement |

---

*Document fondateur PrixMalin — toute évolution de l'architecture doit être documentée et versionnée avant implémentation.*
