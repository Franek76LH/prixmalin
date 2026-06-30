# Modèle de données PrixMalin
## Version : 1.4
**Date : 30 juin 2026**
**Statut : document fondateur — PrixMalin Core**
**Périmètre : schéma métier cible du PrixMalin Core, tables, champs et relations ; les tables transverses existantes `profiles` et `feedback` restent conservées hors cœur jusqu’à leur audit détaillé**

---

## 0. Objet du document

Ce document décrit l'intégralité du modèle de données Supabase de PrixMalin.

Il répond à trois questions :
1. Quelles tables existent et pourquoi ?
2. Quels champs chaque table contient-elle, avec quel type et quelle contrainte ?
3. Comment les tables sont-elles reliées entre elles ?

Il est la référence unique pour toute migration, tout script SQL, et toute requête applicative.

**Différences avec la v1.2 :**
- Ajout des tables `retailers`, `brands`, `circle_members`
- Ajout de la table `product_variants` avec champs de modération
- Ajout de `product_variant_id` dans `receipt_lines`, `prices`, `recommendation_snapshot_items`, `favorites`, `shopping_list`
- Ajout de la table `receipt_images`
- Correction de la gestion des doublons (`duplicate_of_receipt_id`, `fingerprint_version`)
- Ajout de `processing_status`, `processing_error`, `processed_at`, `receipt_number`, `register_number`, `transaction_number`, `purchase_time` dans `receipts`
- Ajout de `line_number`, `line_type`, `gross_amount`, `discount_amount`, `net_amount`, `image_id`, `exclusion_reason` dans `receipt_lines`
- Séparation complète des validations génériques et exactes dans `receipt_lines` (champs `_validated_by`, `_validated_at`, `_validation_method`)
- Correction de la contradiction validation automatique / utilisateur obligatoire
- Correction de l'unicité des alias avec `retailer_id IS NULL` (deux index partiels)
- Ajout de `source_type`, `valid_until` (NOT NULL), `currency_code`, `is_archived`, `archived_at` dans `prices`
- Correction de la priorité de calcul de `valid_until`
- Assouplissement de `prices.user_id` (nullable pour imports)
- Assouplissement de `promotion_end_date` (applicable à promo, loyalty_card, batch)
- Ajout de `retailer_id` et `merged_into_store_id` dans `stores`
- Enrichissement des snapshots (`algorithm_version`, `expires_at`, `missing_item_count`, `available_item_count`)
- Correction du signe de `saving_vs_avg` (positif = économie)
- Description de la vue sécurisée du comparateur `comparable_prices`
- Ajout des structures complètes de `circles`, `circle_members`, `favorites`, `shopping_list`
- Harmonisation complète des comportements ON DELETE
- Ajout de toutes les contraintes de cohérence, index, politiques RLS
- Création automatique du membre propriétaire lors de la création d’un cercle
- Limitation à un seul cercle actif par utilisateur, sans bloquer plusieurs invitations en attente
- Renforcement des contraintes de validation des variantes, alias et résolutions OCR
- Protection des variantes et alias non validés dans les accès publics et le comparateur
- Clarification des règles de suppression des cercles et de cohérence des montants
- Alignement avec le référentiel : 14 catégories visibles, `Non classé` restant un état technique
- Alignement du périmètre legacy : migration directe de `price_db` vers `prices`, archivage de `produits_ref`, `products_catalog` et `savings`, conservation de `profiles` et `feedback`
- Ajout de `receipts.client_scan_id` pour l’idempotence des envois
- Ajout de l’unicité partielle de `prices.source_reference` pour les imports
- Ajout des contraintes temporelles des snapshots
- Clarification du mode d’accès serveur à `comparable_prices`

---

## 1. Vue d'ensemble

### 1.1 Liste des tables

| Table | Rôle |
|---|---|
| `retailers` | Les enseignes normalisées (Leclerc, Lidl, Carrefour…) |
| `brands` | Les marques normalisées (Barilla, Président, MDD…) |
| `categories` | Les 14 catégories visibles de niveau 1 |
| `subcategories` | Les sous-rayons de niveau 2 (5 à 8 par catégorie) |
| `products` | Les produits génériques de niveau 3 — ancre du référentiel |
| `product_variants` | Les produits exacts (Barilla Penne Rigate 500 g) |
| `product_aliases` | Dictionnaire de correspondance ticket → produit |
| `stores` | Les magasins physiques |
| `receipts` | Les tickets de caisse scannés |
| `receipt_images` | Les photos individuelles d'un ticket |
| `receipt_lines` | Les lignes individuelles d'un ticket |
| `prices` | Les prix validés — source unique de vérité |
| `recommendation_snapshots` | Les snapshots du comparateur |
| `recommendation_snapshot_items` | Les lignes d'un snapshot comparateur |
| `circles` | Les cercles communautaires |
| `circle_members` | Les membres d'un cercle |
| `favorites` | Les produits favoris des utilisateurs |
| `shopping_list` | La liste de courses active d'un utilisateur |

### 1.2 Tables héritées à archiver après migration

| Table | Traitement cible |
|---|---|
| `price_db` | Migration directe vers `prices` avec `source_type = 'import'` ; aucune fausse ligne de ticket n’est créée |
| `archives` | Migration vers `prices` avec `is_archived = true` |
| `community_prices` | Migration vers `prices` avec `shared_with_circle = true` |
| `produits_ref` | Source à auditer avant le seed, puis archivage |
| `products_catalog` | Source partielle à auditer, puis archivage |
| `savings` | Non reprise automatiquement ; remplacée fonctionnellement par les snapshots après validation |

### 1.3 Tables transverses existantes conservées

| Table | Traitement |
|---|---|
| `profiles` | Conservée sans modification structurelle dans cette version ; utilisée notamment pour la définition des rôles si confirmée par l’audit |
| `feedback` | Conservée sans modification ; hors périmètre du modèle métier Core |

---

## 2. Tables de référence

### 2.1 Table `retailers`

Les enseignes normalisées. Référence stable pour éviter les variantes textuelles (Leclerc / E.Leclerc / LECLERC).

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `name` | text | NOT NULL, UNIQUE | Nom officiel normalisé (ex : `E.Leclerc`) |
| `slug` | text | NOT NULL, UNIQUE | Identifiant stable en minuscules sans accent (ex : `leclerc`) |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

---

### 2.2 Table `brands`

Les marques normalisées. Évite les doublons (Barilla / BARILLA / barilla).

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `name` | text | NOT NULL | Nom affiché normalisé |
| `name_lower` | text | NOT NULL, UNIQUE | Nom en minuscules — déduplication insensible à la casse |
| `is_mdd` | boolean | NOT NULL, default false | Marque de distributeur (MDD) |
| `retailer_id` | uuid | FK → retailers.id, nullable, ON DELETE RESTRICT | Enseigne propriétaire si MDD |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Contraintes :**
- `CHECK (is_mdd = true → retailer_id IS NOT NULL)`
- `CHECK (is_mdd = false → retailer_id IS NULL)`
- `name_lower` est généré ou mis à jour automatiquement à partir de `name` (trigger détaillé dans le document 06)

---

## 3. Tables du référentiel produit

### 3.1 Table `categories`

Les 14 catégories visibles de niveau 1.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `slug` | text | NOT NULL, UNIQUE | Identifiant lisible (ex : `epicerie-salee`) |
| `label` | text | NOT NULL | Nom affiché (ex : `Épicerie salée`) |
| `display_order` | integer | NOT NULL, CHECK >= 0 | Ordre d'affichage |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Règle `Non classé` :** aucune catégorie technique `Non classé` n’est créée. Une ligne non résolue reste dans `receipt_lines` avec `product_id = NULL` et une validation générique non validée.

---

### 3.2 Table `subcategories`

Les sous-catégories de niveau 2.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `category_id` | uuid | FK → categories.id NOT NULL, ON DELETE RESTRICT | Catégorie parente |
| `slug` | text | NOT NULL | Identifiant lisible dans la catégorie |
| `label` | text | NOT NULL | Nom affiché |
| `display_order` | integer | NOT NULL, CHECK >= 0 | Ordre dans la catégorie |
| `freshness_class` | text | NOT NULL, CHECK IN ('fresh','ambient','frozen','any') | Classe de conservation |
| `default_price_validity_days` | integer | NOT NULL, CHECK > 0 | Durée de validité par défaut d'un prix dans cette sous-catégorie |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Contraintes :**
- `UNIQUE (category_id, slug)`
- `UNIQUE (category_id, display_order)`

**Valeurs recommandées de `default_price_validity_days` :**
- `fresh` → 7 jours
- `ambient` → 90 jours
- `frozen` → 180 jours
- `any` → 30 jours

---

### 3.3 Table `products`

Les produits génériques de niveau 3 — ancre du référentiel.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `subcategory_id` | uuid | FK → subcategories.id NOT NULL, ON DELETE RESTRICT | Sous-catégorie parente |
| `canonical_name` | text | NOT NULL | Nom de référence normalisé (ex : `Penne`) |
| `unit` | text | CHECK IN ('kg','g','l','cl','ml','unité','lot') | Unité de comparaison du générique (ex : `kg` pour les pâtes) |
| `notes` | text | nullable | Remarques internes |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |
| `updated_at` | timestamptz | NOT NULL, default now() | Date de dernière modification |

**Contraintes :**
- `UNIQUE (subcategory_id, canonical_name)`
- Déclencheur `updated_at` automatique

---

### 3.4 Table `product_variants`

Les produits exacts — un conditionnement précis d'un produit générique.

Exemples : Barilla Penne Rigate 500 g, Carrefour Bio Riz long 1 kg.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `product_id` | uuid | FK → products.id NOT NULL, ON DELETE RESTRICT | Produit générique parent |
| `brand_id` | uuid | FK → brands.id, nullable, ON DELETE SET NULL | Marque (null si sans marque identifiée) |
| `commercial_name` | text | NOT NULL | Nom commercial complet (ex : `Penne Rigate n°73`) |
| `barcode` | text | nullable | Code-barres EAN13 ou EAN8 |
| `net_quantity` | numeric(8,3) | nullable, CHECK > 0 | Contenance totale (ex : 500 pour 500 g) |
| `unit` | text | nullable, CHECK IN ('kg','g','l','cl','ml','unité') | Unité du conditionnement — différente de `products.unit` qui est l'unité de comparaison |
| `pack_count` | integer | NOT NULL, default 1, CHECK >= 1 | Nombre d'unités dans le conditionnement |
| `validation_status` | text | NOT NULL, default 'pending', CHECK IN ('pending','validated','rejected') | Statut de modération — seules les variantes `validated` sont utilisées automatiquement |
| `created_by` | uuid | FK → auth.users.id, nullable, ON DELETE SET NULL | Utilisateur ayant créé la variante |
| `validated_by` | uuid | FK → auth.users.id, nullable, ON DELETE SET NULL | Validateur |
| `validated_at` | timestamptz | nullable | Date de validation |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |
| `updated_at` | timestamptz | NOT NULL, default now() | Date de dernière modification |

**Contraintes :**
- `UNIQUE (barcode) WHERE barcode IS NOT NULL`
- `CHECK (net_quantity > 0)`
- `CHECK (pack_count >= 1)`
- `CHECK (validated_by IS NOT NULL WHEN validation_status = 'validated')`
- `CHECK (validated_at IS NOT NULL WHEN validation_status = 'validated')`
- `CHECK (validated_by IS NULL AND validated_at IS NULL WHEN validation_status = 'pending')`
- Déclencheur `updated_at` automatique

**Règle de modération :**
- Variante créée depuis OCR → `validation_status = 'pending'`, non utilisée automatiquement
- Variante validée par un administrateur → `validation_status = 'validated'`, utilisée par le comparateur
- Les administrateurs peuvent créer directement une variante `validated`

**Règles de visibilité :**
- Les variantes `validated` sont lisibles publiquement.
- Les variantes `pending` sont visibles uniquement par leur créateur et les administrateurs.
- Les variantes `rejected` sont visibles uniquement par les administrateurs et, si nécessaire, par leur créateur.

**Note sur les unités :**
- `products.unit` = unité de comparaison du générique (ex : `kg` → on compare au kilo)
- `product_variants.unit` = unité du conditionnement exact (ex : `g` → le paquet fait 500 g)
- `product_variants.net_quantity` représente toujours la quantité totale vendue dans le conditionnement. Exemple : pour un pack de 6 bouteilles de 33 cl, `pack_count = 6`, `net_quantity = 198`, `unit = 'cl'`.

---

### 3.5 Table `product_aliases`

Dictionnaire de correspondance : chaque variante orthographique d'un ticket pointe vers un produit générique ou exact.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `product_id` | uuid | FK → products.id NOT NULL, ON DELETE RESTRICT | Produit générique cible |
| `product_variant_id` | uuid | FK → product_variants.id, nullable, ON DELETE SET NULL | Produit exact cible (null si résolution générique uniquement) |
| `alias` | text | NOT NULL | Texte brut exact tel qu'il apparaît sur un ticket |
| `normalized_alias` | text | NOT NULL | Version normalisée (majuscules, sans accents, sans ponctuation) — sert à la recherche |
| `retailer_id` | uuid | FK → retailers.id, nullable, ON DELETE SET NULL | Enseigne d'origine (null = valable dans toutes les enseignes) |
| `source` | text | NOT NULL, CHECK IN ('ocr','manual','import') | Origine de cet alias |
| `confidence` | numeric(3,2) | NOT NULL, CHECK BETWEEN 0 AND 1 | Confiance dans la correspondance permanente alias → produit (distincte du score OCR de chaque lecture) |
| `validation_status` | text | NOT NULL, default 'pending', CHECK IN ('pending','validated','rejected') | Statut de validation |
| `created_by` | uuid | FK → auth.users.id, nullable, ON DELETE SET NULL | Utilisateur à l’origine de l’alias |
| `validated_by` | uuid | FK → auth.users.id, nullable, ON DELETE SET NULL | Validateur |
| `validated_at` | timestamptz | nullable | Date de validation |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Contraintes d'unicité (deux index partiels — PostgreSQL ne traite pas deux NULL comme identiques dans un UNIQUE classique) :**
```sql
CREATE UNIQUE INDEX product_aliases_retailer_unique
  ON product_aliases (normalized_alias, retailer_id)
  WHERE retailer_id IS NOT NULL;

CREATE UNIQUE INDEX product_aliases_global_unique
  ON product_aliases (normalized_alias)
  WHERE retailer_id IS NULL;
```

**Contraintes de validation et de cohérence :**
- `CHECK (validated_by IS NOT NULL AND validated_at IS NOT NULL WHEN validation_status = 'validated')`
- `CHECK (validated_by IS NULL AND validated_at IS NULL WHEN validation_status = 'pending')`
- `product_variant_id.product_id` doit correspondre à `product_id` (vérification par trigger).

**Distinction des scores de confiance :**
- `product_aliases.confidence` = confiance permanente dans la correspondance dictionnaire (qualité de l'alias lui-même)
- `receipt_lines.generic_confidence_score` = confiance de la lecture OCR sur un ticket précis (variable à chaque scan)

**Règles de visibilité et de résolution :**
- Les alias `validated` sont lisibles publiquement et utilisables pour les résolutions automatiques à haute confiance.
- Les alias `pending` sont visibles uniquement par leur créateur et les administrateurs.
- Les alias `rejected` sont visibles uniquement par les administrateurs et, si nécessaire, par leur créateur.
- `normalized_alias` est généré ou mis à jour automatiquement à partir de `alias` (trigger détaillé dans le document 06).

---

## 4. Table `stores`

Les magasins physiques où des prix ont été relevés.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `retailer_id` | uuid | FK → retailers.id, nullable, ON DELETE SET NULL | Enseigne normalisée |
| `enseigne` | text | nullable | Enseigne texte libre — conservé pendant la migration |
| `name` | text | nullable | Nom complet du point de vente |
| `address` | text | nullable | Adresse complète |
| `normalized_address` | text | nullable | Adresse normalisée pour déduplication |
| `city` | text | nullable | Ville |
| `postal_code` | text | nullable | Code postal |
| `country_code` | text | NOT NULL, default 'FR' | Code pays ISO 3166-1 alpha-2 |
| `latitude` | numeric(9,6) | nullable, CHECK BETWEEN -90 AND 90 | Latitude GPS |
| `longitude` | numeric(9,6) | nullable, CHECK BETWEEN -180 AND 180 | Longitude GPS |
| `status` | text | NOT NULL, default 'unverified', CHECK IN ('active','closed','merged','unverified') | État du magasin |
| `merged_into_store_id` | uuid | FK → stores.id, nullable, ON DELETE SET NULL | Magasin de référence en cas de fusion |
| `created_by` | uuid | FK → auth.users.id, nullable, ON DELETE SET NULL | Utilisateur ayant créé ce magasin |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |
| `updated_at` | timestamptz | NOT NULL, default now() | Date de dernière modification |

**Contraintes :**
- `CHECK (merged_into_store_id IS NOT NULL WHEN status = 'merged')`
- `CHECK (merged_into_store_id IS NULL WHEN status != 'merged')`
- `CHECK (merged_into_store_id != id)`
- `CHECK (latitude BETWEEN -90 AND 90)`
- `CHECK (longitude BETWEEN -180 AND 180)`
- Déclencheur `updated_at` automatique
- `normalized_address` est généré ou mis à jour automatiquement à partir de l’adresse du magasin (trigger détaillé dans le document 06)

**Règles RLS :**
- Tout utilisateur authentifié peut créer un magasin avec `status = 'unverified'`
- Le créateur peut modifier sa proposition tant que `status = 'unverified'`
- Seuls les administrateurs peuvent passer un magasin à `active`, `closed` ou `merged`
- Seuls les administrateurs peuvent modifier un magasin `active`

---

## 5. Tables du scan

### 5.1 Table `receipts`

Un ticket de caisse scanné (peut être composé de plusieurs photos).

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `user_id` | uuid | FK → auth.users.id NOT NULL, ON DELETE RESTRICT | Utilisateur ayant scanné |
| `client_scan_id` | uuid | NOT NULL, UNIQUE | Identifiant généré par le client avant l’envoi — garantit l’idempotence des nouvelles tentatives |
| `store_id` | uuid | FK → stores.id, nullable, ON DELETE SET NULL | Magasin identifié |
| `scanned_at` | timestamptz | NOT NULL, default now() | Date et heure du scan |
| `purchase_date` | date | nullable | Date d'achat indiquée sur le ticket |
| `purchase_time` | time | nullable | Heure d'achat si lisible |
| `total_amount` | numeric(8,2) | nullable, CHECK >= 0 | Montant total du ticket |
| `photo_count` | integer | NOT NULL, default 1, CHECK >= 1 | Nombre de photos (valeur de contrôle) |
| `receipt_number` | text | nullable | Numéro du ticket si lisible |
| `register_number` | text | nullable | Numéro de caisse si lisible |
| `transaction_number` | text | nullable | Numéro de transaction si lisible |
| `receipt_fingerprint` | text | nullable | Empreinte calculée côté serveur pour détecter les doublons |
| `fingerprint_version` | integer | NOT NULL, default 1 | Version de l'algorithme de calcul de l'empreinte |
| `duplicate_status` | text | NOT NULL, default 'original', CHECK IN ('original','duplicate','suspected_duplicate') | Statut doublon |
| `duplicate_of_receipt_id` | uuid | FK → receipts.id, nullable, ON DELETE RESTRICT | Ticket original dont celui-ci est le doublon |
| `processing_status` | text | NOT NULL, default 'uploaded', CHECK IN ('uploaded','processing','review_required','validated','rejected','failed') | État de traitement du ticket |
| `processing_error` | text | nullable | Message d'erreur si `processing_status = 'failed'` |
| `processed_at` | timestamptz | nullable | Date de fin de traitement |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Contraintes :**
- `CHECK (total_amount >= 0)`
- `CHECK (photo_count >= 1)`
- `UNIQUE (client_scan_id)`
- `CHECK (duplicate_of_receipt_id IS NOT NULL WHEN duplicate_status IN ('duplicate','suspected_duplicate'))`
- `CHECK (duplicate_of_receipt_id IS NULL WHEN duplicate_status = 'original')`
- `CHECK (duplicate_of_receipt_id != id)`
- `CHECK (processing_error IS NOT NULL WHEN processing_status = 'failed')`
- `CHECK (processed_at IS NOT NULL WHEN processing_status IN ('validated','rejected','failed'))`
- Index B-tree sur `receipt_fingerprint` (non UNIQUE — les doublons ont leur propre ligne)

**Règle d’idempotence :**
- si `client_scan_id` existe déjà, l’API retourne le ticket existant sans créer une nouvelle ligne ;
- le contrôle par `receipt_fingerprint` intervient ensuite pour détecter un même achat transmis avec un nouvel identifiant client.

**Règle métier doublons :**
- Ticket inédit → `duplicate_status = 'original'`, insertion complète avec lignes et prix
- Doublon exact (fingerprint identique) → `duplicate_status = 'duplicate'`, insertion minimale dans `receipts` uniquement, aucune `receipt_line`, aucun prix
- Doublon suspecté → `duplicate_status = 'suspected_duplicate'`, `processing_status = 'review_required'`, prix non publiés avant validation manuelle

**ON DELETE :** suppression d'un ticket → CASCADE sur `receipt_images` et `receipt_lines`. RESTRICT si le ticket est référencé comme original par un doublon (`duplicate_of_receipt_id`).

---

### 5.2 Table `receipt_images`

Les photos individuelles composant un ticket multi-photos.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `receipt_id` | uuid | FK → receipts.id NOT NULL, ON DELETE CASCADE | Ticket parent |
| `storage_path` | text | NOT NULL | Chemin dans Supabase Storage |
| `display_order` | integer | NOT NULL, CHECK >= 1 | Ordre de lecture (1 = première photo) |
| `ocr_status` | text | NOT NULL, default 'pending', CHECK IN ('pending','processing','done','failed') | État de traitement OCR de cette photo |
| `ocr_confidence_score` | numeric(3,2) | nullable, CHECK BETWEEN 0 AND 1 | Score de confiance global de l'OCR sur cette image |
| `width` | integer | nullable | Largeur en pixels |
| `height` | integer | nullable | Hauteur en pixels |
| `created_at` | timestamptz | NOT NULL, default now() | Date d'import |

**Contraintes :**
- `UNIQUE (receipt_id, display_order)`
- `CHECK (display_order >= 1)`

---

### 5.3 Table `receipt_lines`

Les lignes individuelles extraites d'un ticket — état brut avant validation.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `receipt_id` | uuid | FK → receipts.id NOT NULL, ON DELETE CASCADE | Ticket parent |
| `image_id` | uuid | FK → receipt_images.id, nullable, ON DELETE SET NULL | Photo source de cette ligne |
| `line_number` | integer | NOT NULL, CHECK >= 1 | Numéro d'ordre de la ligne dans le ticket |
| `line_type` | text | NOT NULL, default 'product', CHECK IN ('product','discount','subtotal','total','deposit','payment','loyalty','information','unknown') | Type de ligne — seules les lignes `product` génèrent un prix |
| `raw_text` | text | NOT NULL | Texte brut extrait par l'OCR |
| `gross_amount` | numeric(8,2) | nullable, CHECK >= 0 | Montant avant remise |
| `discount_amount` | numeric(8,2) | nullable, CHECK >= 0 | Montant de la remise directement rattachée à cette ligne |
| `net_amount` | numeric(8,2) | nullable, CHECK >= 0 | Montant payé effectivement — valeur transmise à `prices` |
| `quantity` | numeric(6,3) | nullable, CHECK > 0 | Quantité |
| `unit` | text | nullable | Unité |
| `unit_price` | numeric(8,2) | nullable, CHECK >= 0 | Prix unitaire calculé |
| `product_id` | uuid | FK → products.id, nullable, ON DELETE SET NULL | Produit générique identifié |
| `product_variant_id` | uuid | FK → product_variants.id, nullable, ON DELETE SET NULL | Produit exact identifié |
| `alias_used` | text | nullable | Alias exact ayant permis la résolution |
| `generic_confidence_score` | numeric(3,2) | nullable, CHECK BETWEEN 0 AND 1 | Score de confiance pour la résolution générique |
| `exact_confidence_score` | numeric(3,2) | nullable, CHECK BETWEEN 0 AND 1 | Score de confiance pour la résolution exacte |
| `generic_validation_status` | text | NOT NULL, default 'pending', CHECK IN ('pending','validated','rejected') | État de validation de la résolution générique |
| `generic_validation_method` | text | nullable, CHECK IN ('automatic','user','admin') | Méthode de validation générique |
| `generic_validated_by` | uuid | FK → auth.users.id, nullable, ON DELETE SET NULL | Validateur générique (null si méthode `automatic`) |
| `generic_validated_at` | timestamptz | nullable | Date de validation générique |
| `exact_validation_status` | text | NOT NULL, default 'pending', CHECK IN ('pending','validated','rejected') | État de validation de la résolution exacte |
| `exact_validation_method` | text | nullable, CHECK IN ('automatic','user','admin') | Méthode de validation exacte |
| `exact_validated_by` | uuid | FK → auth.users.id, nullable, ON DELETE SET NULL | Validateur exact (null si méthode `automatic`) |
| `exact_validated_at` | timestamptz | nullable | Date de validation exacte |
| `is_excluded` | boolean | NOT NULL, default false | Ligne exclue manuellement |
| `exclusion_reason` | text | nullable | Motif d'exclusion |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Contraintes :**
- `UNIQUE (receipt_id, line_number)`
- `CHECK (line_number >= 1)`
- `CHECK (exact_confidence_score <= generic_confidence_score) WHEN BOTH ARE NOT NULL`
- `CHECK (gross_amount >= 0)`
- `CHECK (discount_amount >= 0)`
- `CHECK (net_amount >= 0)`
- `CHECK (net_amount = gross_amount - COALESCE(discount_amount, 0)) WHEN gross_amount IS NOT NULL AND net_amount IS NOT NULL`
- `CHECK (quantity > 0)`
- `CHECK (unit_price >= 0)`
- `CHECK (exclusion_reason IS NOT NULL WHEN is_excluded = true)`
- `CHECK (generic_validated_at IS NOT NULL WHEN generic_validation_status = 'validated')`
- `CHECK (generic_validation_method IS NOT NULL WHEN generic_validation_status = 'validated')`
- `CHECK (product_id IS NOT NULL WHEN generic_validation_status = 'validated')`
- `CHECK (exact_validated_at IS NOT NULL WHEN exact_validation_status = 'validated')`
- `CHECK (exact_validation_method IS NOT NULL WHEN exact_validation_status = 'validated')`
- `CHECK (product_variant_id IS NOT NULL WHEN exact_validation_status = 'validated')`
- `CHECK (generic_validation_status = 'validated' WHEN exact_validation_status = 'validated')`
- `CHECK (generic_validated_by IS NOT NULL WHEN generic_validation_method IN ('user','admin'))`
- `CHECK (generic_validated_by IS NULL WHEN generic_validation_method = 'automatic')`
- `CHECK (exact_validated_by IS NOT NULL WHEN exact_validation_method IN ('user','admin'))`
- `CHECK (exact_validated_by IS NULL WHEN exact_validation_method = 'automatic')`
- Contrainte de cohérence : `product_variant_id.product_id` doit correspondre à `product_id` (trigger)
- Contrainte de cohérence : `image_id` doit appartenir au même `receipt_id` (trigger)

**Règles de résolution automatique :**
- `generic_confidence_score >= 0.95` → `generic_validation_status = 'validated'`, `generic_validation_method = 'automatic'`, `generic_validated_by = NULL`
- `generic_confidence_score >= 0.80 et < 0.95` → suggestion proposée à l'utilisateur, statut `pending`
- `generic_confidence_score < 0.80` → non résolu, statut `pending`

**Remises globales :** les remises portant sur l'ensemble du panier (coupon ticket, bon d'achat global) sont représentées comme des lignes autonomes avec `line_type = 'discount'`. Elles ne sont pas réparties entre les produits dans la v1.3.

---

## 6. Table `prices`

Les prix validés — source unique de vérité pour toutes les fonctions de comparaison.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `receipt_line_id` | uuid | FK → receipt_lines.id, nullable, ON DELETE SET NULL | Ligne de ticket d'origine |
| `product_id` | uuid | FK → products.id NOT NULL, ON DELETE RESTRICT | Produit générique |
| `product_variant_id` | uuid | FK → product_variants.id, nullable, ON DELETE SET NULL | Produit exact |
| `store_id` | uuid | FK → stores.id NOT NULL, ON DELETE RESTRICT | Magasin |
| `user_id` | uuid | FK → auth.users.id, nullable, ON DELETE SET NULL | Contributeur — nullable pour les imports automatiques |
| `price` | numeric(8,2) | NOT NULL, CHECK >= 0 | Prix payé (correspond à `net_amount` de la ligne de ticket) |
| `quantity` | numeric(6,3) | nullable, CHECK > 0 | Quantité |
| `unit` | text | nullable | Unité de la quantité |
| `unit_price` | numeric(8,2) | nullable, CHECK >= 0 | Prix au kg/l/unité |
| `currency_code` | text | NOT NULL, default 'EUR' | Devise ISO 4217 |
| `price_type` | text | NOT NULL, default 'normal', CHECK IN ('normal','promo','loyalty_card','batch') | Type de prix |
| `promotion_end_date` | date | nullable | Date de fin de l'offre temporaire — applicable pour `promo`, `loyalty_card` et `batch` |
| `source_type` | text | NOT NULL, default 'receipt', CHECK IN ('receipt','manual','import') | Provenance du prix |
| `source_reference` | text | nullable | Référence externe si `source_type = 'import'` |
| `observed_at` | date | NOT NULL | Date à laquelle le prix a été observé |
| `valid_until` | date | NOT NULL, CHECK >= observed_at | Date d'expiration du prix — calculée à la création et figée |
| `shared_with_circle` | boolean | NOT NULL, default false | Prix partagé avec le cercle |
| `circle_id` | uuid | FK → circles.id, nullable, ON DELETE RESTRICT | Cercle destinataire |
| `is_validated` | boolean | NOT NULL, default true | Prix validé |
| `is_archived` | boolean | NOT NULL, default false | Prix archivé |
| `archived_at` | timestamptz | nullable | Date d'archivage |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Contraintes :**
- `CHECK (price >= 0)`
- `CHECK (quantity > 0)`
- `CHECK (unit_price >= 0)`
- `CHECK (valid_until >= observed_at)`
- `CHECK (promotion_end_date >= observed_at) WHEN promotion_end_date IS NOT NULL`
- `UNIQUE (receipt_line_id) WHERE receipt_line_id IS NOT NULL`
- `CHECK (user_id IS NOT NULL WHEN source_type IN ('receipt','manual'))`
- `CHECK (receipt_line_id IS NOT NULL WHEN source_type = 'receipt')`
- `CHECK (receipt_line_id IS NULL WHEN source_type IN ('manual','import'))`
- `CHECK (source_reference IS NOT NULL WHEN source_type = 'import')`
- `UNIQUE (source_reference) WHERE source_type = 'import' AND source_reference IS NOT NULL`
- `CHECK (circle_id IS NOT NULL WHEN shared_with_circle = true)`
- `CHECK (circle_id IS NULL WHEN shared_with_circle = false)`
- `CHECK (archived_at IS NOT NULL WHEN is_archived = true)`
- `CHECK (archived_at IS NULL WHEN is_archived = false)`
- Contrainte de cohérence : `product_variant_id.product_id` doit correspondre à `product_id` (trigger)

**Règle de calcul de `valid_until` (priorité décroissante, calculée à la création et figée) :**
1. `promotion_end_date` si présente
2. `observed_at + 14 jours` si `price_type = 'promo'` et sans `promotion_end_date`
3. `observed_at + subcategories.default_price_validity_days`
4. `observed_at + 30 jours` (règle applicative par défaut)

Une modification ultérieure de `default_price_validity_days` n'affecte pas les prix existants.

**Gestion de la qualité dans la version 1.4 :**
- un prix utilisable par le comparateur possède `is_validated = true`, `is_archived = false` et une date `valid_until` non dépassée ;
- un prix suspect ou en attente de revue possède `is_validated = false` ;
- une erreur rejetée, une donnée historique ou une observation remplacée peut être conservée avec `is_archived = true` ;
- les statuts détaillés d’anomalie pourront être ajoutés ultérieurement sans modifier cette règle d’accès.

**Règle `promotion_end_date` :**
- Applicable pour `price_type` ∈ `{promo, loyalty_card, batch}`
- Nulle pour `price_type = 'normal'`, sauf exception documentée
- Pour `loyalty_card` et `batch` sans date de fin : durée normale de la sous-catégorie

---

## 7. Tables du comparateur

### 7.1 Vue sécurisée `comparable_prices` (implémentation SQL dans doc 06)

Le comparateur n'accède pas directement à `prices`. Il passe par une vue sécurisée qui filtre et anonymise les données.

**Données retournées :**
- `product_id`
- `product_variant_id` uniquement si la variante correspondante a `validation_status = 'validated'`; sinon la valeur retournée est `NULL` afin de conserver le prix au niveau générique
- `store_id`
- `price`, `unit_price`, `currency_code`
- `price_type`, `promotion_end_date`
- `observed_at`, `valid_until`
- `source_type`

**Données exclues (jamais exposées) :**
- `user_id`, `receipt_line_id`
- `circle_id`, `shared_with_circle`

**Conditions de filtrage :**
```sql
WHERE is_validated = true
  AND is_archived = false
  AND valid_until >= CURRENT_DATE
  AND store_id IN (SELECT id FROM stores WHERE status = 'active')
  AND product_id IS NOT NULL
```

**Mode d’accès :** la vue est créée avec `security_invoker = true`, mais son accès direct est révoqué pour `anon` et `authenticated`. Le comparateur l’interroge côté serveur ou via une Edge Function, afin de ne jamais exposer les données personnelles sources.

La vue masque les variantes non validées avec une expression de type :
```sql
CASE
  WHEN product_variants.validation_status = 'validated'
  THEN prices.product_variant_id
  ELSE NULL
END AS product_variant_id
```

---

### 7.2 Table `recommendation_snapshots`

Chaque calcul du comparateur est figé dans un snapshot.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `user_id` | uuid | FK → auth.users.id NOT NULL, ON DELETE CASCADE | Utilisateur |
| `circle_id` | uuid | FK → circles.id, nullable, ON DELETE RESTRICT | Cercle utilisé |
| `computed_at` | timestamptz | NOT NULL, default now() | Date du calcul |
| `period_start` | date | NOT NULL | Début de la période analysée |
| `period_end` | date | NOT NULL | Fin de la période analysée |
| `algorithm_version` | text | NOT NULL | Version de l'algorithme de calcul |
| `expires_at` | timestamptz | nullable | Date d'expiration du snapshot |
| `total_potential_saving` | numeric(8,2) | nullable, CHECK >= 0 | Économie totale potentielle |
| `best_store_id` | uuid | FK → stores.id, nullable, ON DELETE SET NULL | Magasin recommandé |
| `available_item_count` | integer | nullable, CHECK >= 0 | Nombre d'articles pour lesquels un prix a été trouvé |
| `missing_item_count` | integer | nullable, CHECK >= 0 | Nombre d'articles sans prix disponible |
| `filters_applied` | jsonb | nullable | Filtres utilisés |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Contraintes :**
- `CHECK (period_end >= period_start)`
- `CHECK (expires_at IS NULL OR expires_at >= computed_at)`

**ON DELETE :** suppression d'un snapshot → CASCADE sur `recommendation_snapshot_items`.

---

### 7.3 Table `recommendation_snapshot_items`

Les lignes détaillées d'un snapshot.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `snapshot_id` | uuid | FK → recommendation_snapshots.id NOT NULL, ON DELETE CASCADE | Snapshot parent |
| `product_id` | uuid | FK → products.id NOT NULL, ON DELETE RESTRICT | Produit générique |
| `product_variant_id` | uuid | FK → product_variants.id, nullable, ON DELETE SET NULL | Produit exact utilisé pour le calcul |
| `best_store_id` | uuid | FK → stores.id, nullable, ON DELETE SET NULL | Magasin le moins cher pour ce produit |
| `best_price` | numeric(8,2) | nullable, CHECK >= 0 | Meilleur prix trouvé |
| `best_price_id` | uuid | FK → prices.id, nullable, ON DELETE SET NULL | Entrée prix utilisée |
| `avg_market_price` | numeric(8,2) | nullable, CHECK >= 0 | Prix moyen du marché |
| `saving_vs_avg` | numeric(8,2) | nullable | Économie = `avg_market_price - best_price` — positif = économie, négatif = prix au-dessus de la moyenne |
| `data_age_days` | integer | nullable, CHECK >= 0 | Ancienneté du prix utilisé en jours au moment du calcul |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Contrainte de cohérence :** lorsque `product_variant_id` est renseigné, la variante doit appartenir au même `product_id` (trigger).

---

## 8. Tables communautaires et utilisateur

### 8.1 Table `circles`

Les cercles de partage entre utilisateurs.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `name` | text | NOT NULL | Nom du cercle |
| `created_by` | uuid | FK → auth.users.id NOT NULL, ON DELETE RESTRICT | Créateur du cercle |
| `invite_code` | text | nullable, UNIQUE | Code d'invitation |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |
| `updated_at` | timestamptz | NOT NULL, default now() | Date de modification |

**ON DELETE :** suppression d’un cercle → RESTRICT s’il est utilisé dans `prices` ou `recommendation_snapshots`. Les lignes de `circle_members` sont supprimées en cascade uniquement lorsque la suppression du cercle est autorisée.

---

### 8.2 Table `circle_members`

Les membres d'un cercle — nécessaire pour appliquer les règles RLS de partage.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `circle_id` | uuid | FK → circles.id NOT NULL, ON DELETE CASCADE | Cercle |
| `user_id` | uuid | FK → auth.users.id NOT NULL, ON DELETE CASCADE | Membre |
| `role` | text | NOT NULL, CHECK IN ('owner','member') | Rôle dans le cercle |
| `status` | text | NOT NULL, default 'pending', CHECK IN ('pending','active','declined','removed') | État de l'adhésion |
| `joined_at` | timestamptz | nullable | Date d'entrée effective |
| `created_at` | timestamptz | NOT NULL, default now() | Date de création |

**Contraintes :**
- `UNIQUE (circle_id, user_id)`
- `UNIQUE (user_id) WHERE status = 'active'` — un utilisateur appartient à un seul cercle actif, mais peut recevoir plusieurs invitations en attente
- `UNIQUE (circle_id) WHERE role = 'owner' AND status = 'active'` — un seul propriétaire actif par cercle

**Création automatique du propriétaire :** lors de la création d’un cercle, une ligne `circle_members` est créée automatiquement avec `user_id = circles.created_by`, `role = 'owner'`, `status = 'active'` et `joined_at = created_at`.

**Politique RLS :**
- Les membres actifs peuvent lire les données du cercle.
- Un utilisateur invité peut lire uniquement les informations nécessaires à sa propre invitation en attente.
- Le créateur du cercle peut gérer les membres et leurs rôles.
- Un utilisateur invité peut uniquement accepter ou refuser sa propre invitation.
- Un membre ne peut pas modifier lui-même son `role`, son `circle_id` ou son `user_id`.
- Le passage de `pending` à `active` doit résulter de l’acceptation d’une invitation valide.

---

### 8.3 Table `favorites`

Les produits favoris d'un utilisateur.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `user_id` | uuid | FK → auth.users.id NOT NULL, ON DELETE CASCADE | Utilisateur |
| `product_id` | uuid | FK → products.id NOT NULL, ON DELETE CASCADE | Produit générique favori |
| `product_variant_id` | uuid | FK → product_variants.id, nullable, ON DELETE SET NULL | Préférence de variante exacte (optionnel) |
| `created_at` | timestamptz | NOT NULL, default now() | Date d'ajout |

**Contraintes :**
- `UNIQUE (user_id, product_id)` — un utilisateur ne peut avoir qu'un favori par produit générique, même si plusieurs variantes existent. La `product_variant_id` exprime une préférence de format, pas un favori distinct.

**Contrainte de cohérence :** lorsque `product_variant_id` est renseigné, la variante doit appartenir au même `product_id` (trigger).

**Politique RLS :** lecture et écriture propriétaire uniquement.

---

### 8.4 Table `shopping_list`

La liste de courses active d'un utilisateur. Cette table représente les articles de la liste en cours — une seule liste active par utilisateur. Si des listes nommées multiples sont prévues, une table parente sera ajoutée.

| Champ | Type | Contrainte | Description |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | Identifiant unique |
| `user_id` | uuid | FK → auth.users.id NOT NULL, ON DELETE CASCADE | Utilisateur |
| `product_id` | uuid | FK → products.id, nullable, ON DELETE SET NULL | Produit générique (null si article libre non résolu) |
| `product_variant_id` | uuid | FK → product_variants.id, nullable, ON DELETE SET NULL | Produit exact (optionnel) |
| `raw_label` | text | NOT NULL | Texte saisi par l'utilisateur (toujours conservé) |
| `quantity` | numeric(6,3) | nullable, CHECK > 0 | Quantité souhaitée |
| `unit` | text | nullable | Unité |
| `is_checked` | boolean | NOT NULL, default false | Article coché (acheté) |
| `created_at` | timestamptz | NOT NULL, default now() | Date d'ajout |
| `updated_at` | timestamptz | NOT NULL, default now() | Date de modification |

**Contraintes de cohérence :**
- Lorsque `product_variant_id` est renseigné, `product_id` devient obligatoire.
- La variante doit appartenir au même `product_id` (trigger).

**Politique RLS :** lecture et écriture propriétaire uniquement.

---

## 9. Relations entre tables

```
retailers (1)
    ├── brands (N)           ← retailer_id (MDD)
    ├── stores (N)           ← retailer_id
    └── product_aliases (N)  ← retailer_id

brands (1)
    └── product_variants (N)

categories (1)
    └── subcategories (N)
            └── products (N)
                    ├── product_aliases (N)
                    ├── product_variants (N)
                    ├── receipt_lines (N)    ← product_id
                    ├── prices (N)           ← product_id
                    ├── favorites (N)
                    ├── shopping_list (N)
                    └── recommendation_snapshot_items (N)

product_variants (1)
    ├── product_aliases (N)  ← product_variant_id
    ├── receipt_lines (N)    ← product_variant_id
    ├── prices (N)           ← product_variant_id
    ├── favorites (N)        ← product_variant_id
    ├── shopping_list (N)    ← product_variant_id
    └── recommendation_snapshot_items (N)

stores (1)
    ├── receipts (N)
    ├── prices (N)
    ├── recommendation_snapshots (N)  ← best_store_id
    └── recommendation_snapshot_items (N)

receipts (1)
    ├── receipt_images (N)   ← ON DELETE CASCADE
    └── receipt_lines (N)    ← ON DELETE CASCADE

receipt_images (1)
    └── receipt_lines (N)    ← image_id

receipt_lines (1)
    └── prices (0..1)        ← UNIQUE (receipt_line_id) WHERE NOT NULL

circles (1)
    ├── circle_members (N)   ← ON DELETE CASCADE
    ├── prices (N)           ← circle_id
    └── recommendation_snapshots (N)

recommendation_snapshots (1)
    └── recommendation_snapshot_items (N)  ← ON DELETE CASCADE

auth.users (1)
    ├── receipts (N)
    ├── prices (N)           ← nullable pour imports
    ├── product_aliases (N)  ← created_by, validated_by
    ├── product_variants (N) ← created_by, validated_by
    ├── receipt_lines (N)    ← generic_validated_by, exact_validated_by
    ├── stores (N)           ← created_by
    ├── circles (N)          ← created_by
    ├── circle_members (N)
    ├── recommendation_snapshots (N)
    ├── favorites (N)
    └── shopping_list (N)
```

---

## 10. Index

| Table | Champ(s) | Type | Raison |
|---|---|---|---|
| `product_aliases` | `normalized_alias` WHERE `retailer_id IS NULL` | B-tree UNIQUE partiel | Unicité des alias globaux |
| `product_aliases` | `(normalized_alias, retailer_id)` WHERE `retailer_id IS NOT NULL` | B-tree UNIQUE partiel | Unicité des alias par enseigne |
| `product_aliases` | `product_id` | B-tree | Jointures vers products |
| `prices` | `(product_id, store_id, observed_at DESC)` WHERE `is_validated = true AND is_archived = false` | B-tree partiel | Requêtes comparateur |
| `prices` | `(user_id, observed_at)` | B-tree | Historique utilisateur |
| `prices` | `receipt_line_id` WHERE `receipt_line_id IS NOT NULL` | B-tree UNIQUE partiel | Unicité ligne → prix |
| `prices` | `source_reference` WHERE `source_type = 'import' AND source_reference IS NOT NULL` | B-tree UNIQUE partiel | Idempotence des imports |
| `receipt_lines` | `receipt_id` | B-tree | Chargement des lignes d'un ticket |
| `receipt_lines` | `product_id` | B-tree | Jointures vers prices |
| `receipt_lines` | `image_id` | B-tree | Jointures vers receipt_images |
| `receipts` | `client_scan_id` | B-tree UNIQUE | Idempotence des envois |
| `receipts` | `receipt_fingerprint` | B-tree | Détection doublons — non UNIQUE |
| `receipts` | `user_id` | B-tree | Historique utilisateur |
| `receipts` | `store_id` | B-tree | Filtrage par magasin |
| `receipt_images` | `receipt_id` | B-tree | Chargement des photos |
| `stores` | `(retailer_id, postal_code)` | B-tree | Filtrage géographique par enseigne |
| `recommendation_snapshots` | `(user_id, computed_at DESC)` | B-tree | Dernier snapshot utilisateur |
| `recommendation_snapshot_items` | `snapshot_id` | B-tree | Chargement des lignes d'un snapshot |
| `subcategories` | `category_id` | B-tree | Jointures catégorie → sous-catégorie |
| `products` | `subcategory_id` | B-tree | Jointures sous-catégorie → produit |
| `product_variants` | `product_id` | B-tree | Jointures produit → variantes |
| `circle_members` | `(circle_id, user_id)` | B-tree UNIQUE | Unicité membre/cercle |
| `circle_members` | `user_id` WHERE `status = 'active'` | B-tree UNIQUE partiel | Un seul cercle actif par utilisateur |
| `circle_members` | `circle_id` WHERE `role = 'owner' AND status = 'active'` | B-tree UNIQUE partiel | Un seul propriétaire actif par cercle |
| `product_variants` | `(created_by, validation_status)` | B-tree | Politiques RLS créateur/statut |
| `product_aliases` | `(created_by, validation_status)` | B-tree | Politiques RLS créateur/statut |
| `stores` | `(created_by, status)` | B-tree | Propositions de magasins |
| `prices` | `circle_id` WHERE `shared_with_circle = true` | B-tree partiel | Lecture des prix partagés |
| `circles` | `created_by` | B-tree | Gestion par le créateur |
| `shopping_list` | `user_id` | B-tree | Accès propriétaire |

**Note :** une extension `pg_trgm` (trigrammes PostgreSQL) devra être activée sur Supabase pour la recherche approximative sur `normalized_alias` et `receipt_lines.raw_text`. Détails dans le document 06.

---

## 11. Politique de sécurité (RLS)

| Table | Lecture | Écriture |
|---|---|---|
| `retailers` | Publique | Admin uniquement |
| `brands` | Publique | Admin uniquement |
| `categories` | Publique | Admin uniquement |
| `subcategories` | Publique | Admin uniquement |
| `products` | Publique | Admin uniquement |
| `product_variants` | Variantes `validated` publiques ; variantes `pending` visibles par leur créateur et les admins ; variantes `rejected` réservées aux admins et, si nécessaire, au créateur | Admin + utilisateurs authentifiés (statut `pending` à la création) |
| `product_aliases` | Alias `validated` publics ; alias `pending` visibles par leur créateur et les admins ; alias `rejected` réservés aux admins et, si nécessaire, au créateur | Admin + utilisateurs authentifiés (statut `pending` à la création) |
| `stores` | Publique | Création `unverified` par utilisateur ; modification et validation via serveur |
| `receipts` | Propriétaire + admin | Serveur uniquement |
| `receipt_images` | Via `receipts.user_id` + admin | Serveur uniquement |
| `receipt_lines` | Via `receipts.user_id` + admin | Serveur ou RPC de confirmation limitée |
| `prices` | Propriétaire + membres actifs du cercle + admin | Serveur ou RPC métier uniquement |
| `recommendation_snapshots` | Propriétaire + admin | Serveur uniquement |
| `recommendation_snapshot_items` | Via `recommendation_snapshots.user_id` + admin | Serveur uniquement |
| `circles` | Membres actifs, utilisateur invité pour sa propre invitation, admin | Création directe ; modification limitée du nom/code ; opérations sensibles côté serveur |
| `circle_members` | Propre ligne + membres actifs du cercle + admin | RPC dédiées uniquement |
| `favorites` | Propriétaire | Propriétaire |
| `shopping_list` | Propriétaire | Propriétaire |

**Note :** les tables sans `user_id` direct (`receipt_lines`, `receipt_images`, `recommendation_snapshot_items`) vérifient le propriétaire par une fonction auxiliaire sécurisée ou une jointure vers leur table parente.

**Canal d’écriture :** les droits de propriétaire décrivent la visibilité métier. Les tables de preuve, de validation, de prix et de recommandation ne sont pas modifiables directement depuis le client. Le document 08 définit les RPC et accès serveur autorisés.

---

## 12. Comportements ON DELETE

| Table supprimée | Table liée | Comportement |
|---|---|---|
| `receipts` | `receipt_images` | CASCADE |
| `receipts` | `receipt_lines` | CASCADE |
| `receipts` (original) | `receipts` (doublon via `duplicate_of_receipt_id`) | RESTRICT |
| `recommendation_snapshots` | `recommendation_snapshot_items` | CASCADE |
| `circles` | `circle_members` | CASCADE |
| `circles` | `prices.circle_id` | RESTRICT |
| `circles` | `recommendation_snapshots.circle_id` | RESTRICT |
| `auth.users` | `receipts` | RESTRICT |
| `auth.users` | `prices.user_id` | SET NULL |
| `auth.users` | `circle_members` | CASCADE |
| `auth.users` | `product_aliases.created_by` | SET NULL |
| `auth.users` | `product_aliases.validated_by` | SET NULL |
| `products` | `prices` | RESTRICT |
| `products` | `receipt_lines.product_id` | SET NULL |
| `products` | `favorites` | CASCADE |
| `products` | `shopping_list.product_id` | SET NULL |
| `products` | `recommendation_snapshot_items` | RESTRICT |
| `product_variants` | `receipt_lines.product_variant_id` | SET NULL |
| `product_variants` | `prices.product_variant_id` | SET NULL |
| `product_variants` | `favorites.product_variant_id` | SET NULL |
| `product_variants` | `shopping_list.product_variant_id` | SET NULL |
| `product_variants` | `recommendation_snapshot_items.product_variant_id` | SET NULL |
| `product_variants` | `product_aliases.product_variant_id` | SET NULL |
| `stores` | `prices` | RESTRICT |
| `stores` | `receipts.store_id` | SET NULL |
| `stores` | `recommendation_snapshots.best_store_id` | SET NULL |
| `stores` | `recommendation_snapshot_items.best_store_id` | SET NULL |
| `retailers` | `stores.retailer_id` | SET NULL |
| `retailers` | `brands.retailer_id` | RESTRICT |
| `retailers` | `product_aliases.retailer_id` | SET NULL |

**Principe général :** on ne supprime jamais physiquement un produit, un magasin ou un prix utilisé dans des données historiques. On archive ou on désactive.

---

## 13. Déclencheurs `updated_at`

Les tables suivantes nécessitent un déclencheur automatique sur `updated_at` :

`products`, `product_variants`, `stores`, `circles`, `shopping_list`

Le SQL de ces déclencheurs est dans le document 06. Ce document décrit également les triggers de normalisation de `brands.name_lower`, `product_aliases.normalized_alias` et `stores.normalized_address`, ainsi que les triggers de cohérence entre produits génériques et variantes.

---

## 14. État de transition

| Table actuelle | Action |
|---|---|
| `price_db` | Migration directe vers `prices` avec `source_type = 'import'`, puis archivage |
| `archives` | Migration vers `prices` avec `is_archived = true`, puis archivage |
| `community_prices` | Migration vers `prices` avec `shared_with_circle = true`, puis archivage |
| `produits_ref` | Audit, utilisation éventuelle pour le seed, puis archivage |
| `products_catalog` | Audit, rapprochement éventuel avec le référentiel, puis archivage |
| `savings` | Conservation legacy sans reprise automatique, puis archivage après validation |
| `profiles` | Conservée hors cœur sans modification dans cette version |
| `feedback` | Conservée hors cœur sans modification |
| `stores.enseigne` | Conservé pendant la migration, remplacé par `retailer_id` |
| `favorites` | Ajout de `product_id` et `product_variant_id`, conservé |
| `shopping_list` | Ajout de `product_id` et `product_variant_id`, conservé |
| `circles` | Ajout de `circle_members`, conservé |

Le plan détaillé (ordre des migrations, scripts, tests, points de non-retour) est dans le document 06.

---

## 15. Historique des versions

| Version | Date | Modifications |
|---|---|---|
| v1.0 | juin 2026 | Création — tables fondatrices |
| v1.1 | juin 2026 | Ajout quantité/unité/prix unitaire |
| v1.2 | 29 juin 2026 | freshness_class, price_type, receipt_fingerprint, scores de confiance, stores.status, recommendation_snapshots |
| v1.3 | 30 juin 2026 | retailers, brands, product_variants (avec modération), circle_members, receipt_images ; correction gestion doublons ; processing_status ; line_number/line_type/montants bruts ; validations séparées avec méthode de validation ; correction contradiction validation automatique ; correction unicité alias NULL ; correction priorité valid_until (NOT NULL) ; source_type, currency_code, is_archived ; merged_into_store_id ; enrichissement snapshots ; correction signe saving_vs_avg ; vue sécurisée comparateur ; tables circles/favorites/shopping_list documentées ; création automatique du propriétaire de cercle ; limitation à un seul cercle actif ; protection des variantes et alias non validés ; harmonisation complète ON DELETE, index, RLS et contraintes de cohérence |
| v1.4 | 30 juin 2026 | Alignement transversal : 14 catégories visibles, client_scan_id, idempotence des imports, contraintes temporelles des snapshots, périmètre legacy complet et accès serveur sécurisé à comparable_prices |

