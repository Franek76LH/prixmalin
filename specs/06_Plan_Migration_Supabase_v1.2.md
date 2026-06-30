# Plan de migration Supabase — PrixMalin Core
## Version : 1.2
**Date : 30 juin 2026**  
**Statut : document fondateur audité — prêt pour préparation des migrations**  
**Périmètre : migration de la base Supabase actuelle vers le modèle de données PrixMalin v1.3 corrigé**

---

## 0. Objet du document

Ce document décrit la stratégie permettant de faire évoluer la base Supabase actuelle vers le modèle de données PrixMalin v1.3 corrigé, sans perte de données, sans exposition temporaire des nouvelles tables et avec une bascule contrôlée de l’application.

Il répond à six questions :

1. Quel est l’état réel de la base avant migration ?
2. Dans quel ordre créer les nouvelles structures ?
3. Comment préserver et rapprocher les données legacy avant leur insertion dans le modèle cible ?
4. Comment tester les contraintes, les règles RLS et les performances avant la production ?
5. Comment effectuer une bascule atomique sans rendre les écritures incohérentes ?
6. Quelles opérations permettent de revenir en arrière avant le point de non-retour ?

### Documents de référence

- Document 01 : version validée la plus récente du référentiel produit PrixMalin.
- Document 02 : modèle de données PrixMalin v1.3 corrigé.
- Document 03 : règles de reconnaissance et de double validation générique/exacte.
- Document 08 v1.1 : politiques RLS, fonctions d’autorisation et RPC sécurisées.

### Clarification relative au CLI Supabase

Le CLI Supabase lui-même ne porte pas de date d’expiration fonctionnelle. Si le projet dispose actuellement d’un jeton personnel, d’un accès temporaire ou d’une autorisation arrivant à échéance le **28 juillet 2026**, cette date doit être traitée comme une contrainte propre aux identifiants du projet. Un nouveau jeton personnel pourra être généré si nécessaire.

La date du 28 juillet 2026 reste donc un **jalon de projet à vérifier**, et non une limite intrinsèque du CLI.

---

## 1. État de départ

### 1.1 Tables legacy identifiées

Le document initial annonçait 11 tables, mais la liste en contient **12**.

| Table actuelle | Statut cible | Action prévue |
|---|---|---|
| `price_db` | Remplacée par `prices` pour l’historique plat ; `receipt_lines` uniquement pour les futurs tickets | Migrer via staging, puis archiver |
| `archives` | Fusionnée dans `prices` avec `is_archived = true` | Auditer le JSONB, migrer via staging, puis archiver |
| `community_prices` | Fusionnée dans `prices` avec partage vers un cercle | Migrer via staging après résolution du cercle |
| `circles` | Remplacée par la structure cible `circles` + `circle_members` | Migrer dans `circles_v2`, puis basculer |
| `favorites` | Remplacée par une ligne relationnelle par favori | Migrer dans `favorites_v2`, puis basculer |
| `shopping_list` | Remplacée par une ligne relationnelle par article | Migrer dans `shopping_list_v2`, puis basculer |
| `stores` | Conservée et enrichie | Modifier en place avec précautions |
| `profiles` | Conservée | Vérifier son rôle éventuel dans l’autorisation administrateur |
| `feedback` | Conservée | Aucune migration structurelle prévue |
| `produits_ref` | Source legacy de rapprochement, non source de vérité finale | Auditer, exploiter pour le mapping, puis archiver |
| `products_catalog` | Source legacy de rapprochement, non source de vérité finale | Auditer, exploiter pour le mapping, puis archiver |
| `savings` | Obsolète au profit des snapshots | Conserver en archive, sans conversion automatique |

### 1.2 Point impératif : l’inventaire SQL précède toute migration

Les structures exactes de plusieurs tables legacy ne sont pas entièrement connues, notamment :

- le format de `archives.items` ;
- le format de `favorites.items` ;
- le format de `shopping_list.items` ;
- les colonnes et statuts exacts de l’ancienne table `circles` ;
- les éventuelles lignes orphelines de `price_db`, `community_prices` ou `stores` ;
- le bucket Storage déjà utilisé pour les photos de tickets.

Aucun script de transformation JSONB ne doit être exécuté avant l’inventaire de la phase 0.

### 1.3 Correspondance générale de `price_db`

Les données de `price_db` sont des prix plats, sans ticket source fiable. Elles ne doivent donc pas créer artificiellement des tickets ni des lignes de ticket.

| Colonne legacy | Destination ou usage cible |
|---|---|
| `id` | Conservé dans `source_reference` sous la forme `price_db:<id>` |
| `product` | Texte de rapprochement vers `product_aliases` et `products` |
| `format` | Candidat pour `product_variants.net_quantity` et `product_variants.unit`, après parsing validé |
| `brand` | Candidat pour `brands` et `product_variants.brand_id` |
| `storeId` texte | Candidat de rapprochement vers une enseigne ou un magasin |
| `store_name` | Candidat de rapprochement vers `stores.name` |
| `store_address` | Candidat de rapprochement vers `stores.normalized_address` |
| `store_id` uuid | Référence prioritaire si elle pointe vers un magasin existant |
| `price` | `prices.price` |
| `date` | `prices.observed_at` |
| `category` | Information de contrôle pour le rapprochement produit |
| `user_id` | `prices.user_id` si l’utilisateur existe encore, sinon `NULL` pour un import |
| `quantite` | `prices.quantity` |
| `unite` | `prices.unit` |
| `conditionnement` | Candidat pour `product_variants.pack_count`, jamais converti sans contrôle |
| `prix_unitaire` | `prices.unit_price` |

### 1.4 Volumétrie connue ou estimée

| Table | Volume connu ou estimé |
|---|---|
| `price_db` | Environ 561 lignes |
| `stores` | Environ 20 à 30 magasins |
| `produits_ref` | Environ 63 produits legacy |
| `archives` | À mesurer en phase 0 |
| `community_prices` | À mesurer en phase 0 |
| `circles` | Environ 2 à 3 relations bêta, à confirmer |
| `favorites` | À mesurer après éclatement du JSONB |
| `shopping_list` | À mesurer après éclatement du JSONB |

---

## 2. Principes de migration

### 2.1 Aucune donnée legacy n’est supprimée pendant la migration

Une table legacy ne peut être renommée ou archivée qu’après :

- sauvegarde complète ;
- migration ou mise en attente explicite de chaque ligne ;
- rapprochement des totaux ;
- validation de l’application sur la cible ;
- fin de la période de stabilisation.

### 2.2 Les données non résolues restent en staging

Le modèle cible impose notamment :

- `prices.product_id NOT NULL` ;
- `prices.store_id NOT NULL` ;
- `prices.valid_until NOT NULL` ;
- `prices.circle_id NOT NULL` lorsqu’un prix est partagé.

Il est donc interdit d’insérer un prix avec des références nulles, puis d’espérer les corriger après coup. Les lignes incomplètes sont conservées dans une table de staging jusqu’à leur résolution.

### 2.3 Pas de double lecture indéfinie

Lire simultanément l’ancien et le nouveau modèle tout en écrivant uniquement dans le nouveau produirait des résultats incohérents pour les versions de l’application encore connectées aux tables legacy.

La stratégie retenue est :

1. création du nouveau schéma en parallèle ;
2. chargement initial et rapprochement des données ;
3. validation sur un environnement de test ou de staging ;
4. courte fenêtre de maintenance pour le dernier delta ;
5. bascule atomique de l’application ;
6. stabilisation sur la cible.

Une double écriture temporaire ne doit être mise en place que si une fenêtre de maintenance est impossible. Elle nécessiterait alors des triggers dédiés et des tests supplémentaires.

### 2.4 Deux niveaux de rollback

#### Avant la bascule applicative

Le rollback est complet : l’application continue d’utiliser les tables legacy et les nouvelles tables peuvent être supprimées ou corrigées.

#### Après les premières écritures en production dans le nouveau modèle

Un retour direct vers les tables legacy ferait perdre la visibilité sur les nouvelles données. À partir de ce moment, la stratégie normale devient le **correctif en avant**.

Un retour vers l’ancien modèle n’est autorisé qu’avec :

- export des nouvelles écritures ;
- script de réinjection inverse validé ;
- nouvelle fenêtre de maintenance.

### 2.5 Toute modification est versionnée

Chaque phase structurelle doit être enregistrée dans un fichier du dossier :

```text
supabase/migrations/
```

Les scripts ne sont pas exécutés directement en production depuis un document Markdown. Ils sont :

1. appliqués sur une base locale avec `supabase db reset` ;
2. testés avec les tests SQL/pgTAP ;
3. appliqués sur un projet de staging ;
4. contrôlés avant production avec `supabase db push --dry-run` ;
5. poussés en production avec `supabase db push` après validation.

### 2.6 Sécurité dès la création

Les nouvelles tables du schéma `public` doivent avoir RLS activée dans la même migration que leur création. Tant que les politiques finales ne sont pas déployées :

- aucun droit d’écriture n’est accordé à `anon` ou `authenticated` ;
- les tables privées ne sont pas accessibles par le Data API ;
- le rôle `service_role` reste réservé au serveur et aux opérations de migration.

---

## 3. Architecture des fichiers de migration

Ordre recommandé :

```text
000_preflight_documentation.sql          -- requêtes d'inventaire, non destructif
001_extensions_and_helpers.sql
002_reference_tables.sql
003_enrich_stores.sql
004_circles_v2.sql
005_scan_and_prices.sql
006_comparator.sql
007_user_tables_v2.sql
008_seed_reference_data.sql
009_migration_staging.sql
010_backfill_legacy_data.sql
011_rls_and_grants.sql
012_validation_constraints.sql
013_cutover.sql
014_legacy_read_only.sql
```

Les scripts de données volumineux peuvent être séparés dans des fichiers de seed ou des scripts administratifs versionnés.

---

## 4. Phase 0 — Inventaire, sauvegarde et répétition

### 4.1 Capturer la structure réelle

```sql
-- Tables et volumes
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS estimated_rows
FROM pg_stat_user_tables
ORDER BY schemaname, relname;

-- Colonnes legacy
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'price_db','archives','community_prices','circles','favorites',
    'shopping_list','stores','profiles','feedback','produits_ref',
    'products_catalog','savings'
  )
ORDER BY table_name, ordinal_position;

-- Contraintes et clés étrangères existantes
SELECT
  conrelid::regclass AS table_name,
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

-- Statuts réellement utilisés dans circles
SELECT status, COUNT(*)
FROM public.circles
GROUP BY status
ORDER BY status;

-- Buckets et volumes Storage
SELECT id, name, public, created_at
FROM storage.buckets
ORDER BY name;
```

### 4.2 Examiner des échantillons JSONB sans les modifier

Les requêtes exactes dépendent des colonnes constatées. Exemples :

```sql
SELECT id, jsonb_typeof(items), items
FROM public.favorites
LIMIT 10;

SELECT id, jsonb_typeof(items), items
FROM public.shopping_list
LIMIT 10;

SELECT id, jsonb_typeof(items), items
FROM public.archives
LIMIT 10;
```

Le script d’éclatement JSONB ne sera validé qu’après analyse de ces échantillons.

### 4.3 Contrôler les orphelins et doublons

```sql
-- price_db avec store_id inexistant
SELECT p.id, p.store_id, p.store_name, p.store_address
FROM public.price_db p
LEFT JOIN public.stores s ON s.id = p.store_id
WHERE p.store_id IS NOT NULL
  AND s.id IS NULL;

-- Utilisateurs legacy inexistants
SELECT DISTINCT p.user_id
FROM public.price_db p
LEFT JOIN auth.users u ON u.id = p.user_id
WHERE p.user_id IS NOT NULL
  AND u.id IS NULL;

-- Doublons de magasins potentiels
SELECT
  lower(trim(COALESCE(enseigne, ''))) AS enseigne_normalisee,
  lower(trim(COALESCE(address, ''))) AS adresse_normalisee,
  COUNT(*)
FROM public.stores
GROUP BY 1, 2
HAVING COUNT(*) > 1;
```

### 4.4 Sauvegarde obligatoire

Avant le premier changement de production :

```bash
supabase db dump --db-url "$DATABASE_URL" -f backup_roles.sql --role-only
supabase db dump --db-url "$DATABASE_URL" -f backup_schema.sql
supabase db dump --db-url "$DATABASE_URL" -f backup_data.sql --use-copy --data-only
```

À compléter par :

- export CSV des tables legacy critiques ;
- sauvegarde des fichiers Storage liés aux tickets ;
- vérification spécifique des données Auth nécessaires, car le dump CLI standard exclut les schémas gérés par Supabase tels que `auth` et `storage` ;
- sauvegarde des objets Storage eux-mêmes, qui ne sont pas contenus dans le dump SQL ;
- test de restauration sur un projet ou une base isolée ;
- conservation du hash et de la date de chaque fichier de sauvegarde.

### 4.5 Checkpoint phase 0

La phase 0 est validée uniquement si :

- les 12 tables legacy ont été inventoriées ;
- les JSONB ont une structure comprise ;
- les statuts de cercle sont connus ;
- les utilisateurs et magasins orphelins sont recensés ;
- une sauvegarde restaurable existe ;
- l’origine du droit administrateur est confirmée (`profiles`, claim JWT ou autre mécanisme) ;
- la réalité de l’échéance du jeton du 28 juillet 2026 est confirmée.

---

## 5. Phase 1 — Extensions, schéma privé et fonctions communes

### 5.1 SQL corrigé

```sql
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- Supabase installe généralement les extensions dans le schéma extensions.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_search_text(input_text text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        upper(extensions.unaccent(COALESCE(input_text, ''))),
        '[^A-Z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_search_text(text) FROM PUBLIC;

COMMIT;
```

### 5.2 Corrections apportées

- `unaccent` est activée avant la création des fonctions qui l’utilisent.
- La normalisation passe en majuscules **avant** le filtrage des caractères. Le script initial supprimait les lettres minuscules.
- Les espaces multiples et la ponctuation sont normalisés de manière stable.
- Les fonctions sont qualifiées et leur `search_path` est limité.
- Les extensions ne sont pas supprimées lors d’un rollback, car elles peuvent être utilisées par d’autres objets du projet.

### 5.3 Checkpoint phase 1

```sql
SELECT extname, extnamespace::regnamespace
FROM pg_extension
WHERE extname IN ('pg_trgm','unaccent');

SELECT public.normalize_search_text('Penne rigate n°73 — 500 g');
-- Résultat attendu : PENNE RIGATE N 73 500 G
```

---

## 6. Phase 2 — Tables de référence

Les structures doivent correspondre au document 02 v1.4. Les noms restent ceux validés dans le modèle.

### 6.1 Points SQL à respecter

#### `brands.name_lower`

```sql
CREATE OR REPLACE FUNCTION public.set_brand_name_lower()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.name_lower := lower(btrim(NEW.name));
  RETURN NEW;
END;
$$;
```

#### Code-barres des variantes

Le code initial utilisait :

```sql
UNIQUE NULLS NOT DISTINCT (barcode)
```

Cette écriture n’est pas adaptée, car elle n’autorise qu’une seule ligne avec `barcode = NULL`. La règle correcte est :

```sql
CREATE UNIQUE INDEX product_variants_barcode_unique
ON public.product_variants (barcode)
WHERE barcode IS NOT NULL;
```

#### Normalisation des alias

```sql
CREATE OR REPLACE FUNCTION public.set_normalized_alias()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.normalized_alias := public.normalize_search_text(NEW.alias);
  RETURN NEW;
END;
$$;
```

#### Unicité des alias

```sql
CREATE UNIQUE INDEX product_aliases_global_unique
ON public.product_aliases (normalized_alias)
WHERE retailer_id IS NULL;

CREATE UNIQUE INDEX product_aliases_retailer_unique
ON public.product_aliases (normalized_alias, retailer_id)
WHERE retailer_id IS NOT NULL;
```

#### Index de recherche approximative

```sql
CREATE INDEX product_aliases_normalized_trgm
ON public.product_aliases
USING gin (normalized_alias extensions.gin_trgm_ops);
```

### 6.2 Fonction générique de cohérence produit/variante

```sql
CREATE OR REPLACE FUNCTION public.check_product_variant_matches_product()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.product_variant_id IS NOT NULL THEN
    IF NEW.product_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.product_variants pv
      WHERE pv.id = NEW.product_variant_id
        AND pv.product_id = NEW.product_id
    ) THEN
      RAISE EXCEPTION
        'La variante % ne correspond pas au produit %',
        NEW.product_variant_id,
        NEW.product_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
```

Cette fonction sera attachée à :

- `product_aliases` ;
- `receipt_lines` ;
- `prices` ;
- `recommendation_snapshot_items` ;
- `favorites_v2` ;
- `shopping_list_v2`.

### 6.3 Index de clés étrangères

À créer au minimum :

```sql
CREATE INDEX subcategories_category_idx
  ON public.subcategories (category_id);

CREATE INDEX products_subcategory_idx
  ON public.products (subcategory_id);

CREATE INDEX product_variants_product_idx
  ON public.product_variants (product_id);

CREATE INDEX product_aliases_product_idx
  ON public.product_aliases (product_id);

CREATE INDEX product_aliases_variant_idx
  ON public.product_aliases (product_variant_id)
  WHERE product_variant_id IS NOT NULL;
```

### 6.4 Sécurité provisoire

Dans la même migration :

```sql
ALTER TABLE public.retailers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.retailers,
  public.brands,
  public.categories,
  public.subcategories,
  public.products,
  public.product_variants,
  public.product_aliases
FROM anon, authenticated;
```

Les droits de lecture et d’écriture définitifs sont ajoutés dans la phase RLS, avant la bascule applicative.

### 6.5 Checkpoint phase 2

- 7 tables créées.
- Aucun code-barres nul ne bloque l’insertion d’une autre variante sans code-barres.
- Les alias en minuscules sont correctement normalisés.
- Les variantes et alias `pending` ne sont pas accessibles aux rôles clients avant les politiques finales.

---

## 7. Phase 3 — Enrichissement contrôlé de `stores`

### 7.1 Règle de statut

Les magasins existants validés peuvent être initialisés à `active`, mais les nouvelles créations doivent avoir le défaut `unverified`.

Le script initial conservait `active` comme défaut permanent, ce qui contredisait le modèle v1.3.

### 7.2 SQL recommandé

```sql
BEGIN;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS retailer_id uuid,
  ADD COLUMN IF NOT EXISTS normalized_address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS merged_into_store_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Backfill des lignes déjà présentes.
UPDATE public.stores
SET
  country_code = COALESCE(country_code, 'FR'),
  status = COALESCE(status, 'active'),
  updated_at = COALESCE(updated_at, now());

ALTER TABLE public.stores
  ALTER COLUMN country_code SET DEFAULT 'FR',
  ALTER COLUMN country_code SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'unverified',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.stores
  ADD CONSTRAINT stores_retailer_fk
    FOREIGN KEY (retailer_id)
    REFERENCES public.retailers(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT stores_merged_into_fk
    FOREIGN KEY (merged_into_store_id)
    REFERENCES public.stores(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT stores_created_by_fk
    FOREIGN KEY (created_by)
    REFERENCES auth.users(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT stores_status_check
    CHECK (status IN ('active','closed','merged','unverified')),
  ADD CONSTRAINT stores_latitude_range
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT stores_longitude_range
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT stores_merged_target_coherence
    CHECK (
      (status = 'merged' AND merged_into_store_id IS NOT NULL)
      OR
      (status <> 'merged' AND merged_into_store_id IS NULL)
    ),
  ADD CONSTRAINT stores_no_self_merge
    CHECK (merged_into_store_id IS NULL OR merged_into_store_id <> id);

CREATE OR REPLACE FUNCTION public.set_normalized_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.normalized_address := public.normalize_search_text(NEW.address);
  RETURN NEW;
END;
$$;

CREATE TRIGGER stores_updated_at
BEFORE UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER stores_normalized_address_trigger
BEFORE INSERT OR UPDATE OF address ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.set_normalized_address();

UPDATE public.stores
SET normalized_address = public.normalize_search_text(address);

CREATE INDEX stores_retailer_postal_idx
  ON public.stores (retailer_id, postal_code);

CREATE INDEX stores_normalized_address_trgm
  ON public.stores
  USING gin (normalized_address extensions.gin_trgm_ops);

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.stores FROM anon, authenticated;

COMMIT;
```

### 7.3 Normalisation des enseignes

Il ne faut pas créer automatiquement une enseigne pour chaque chaîne de caractères distincte de `stores.enseigne`, car cela reproduirait les fautes et doublons legacy.

La méthode retenue est :

1. peupler `retailers` depuis une liste canonique validée ;
2. créer une table privée de mapping entre valeur legacy et enseigne canonique ;
3. rattacher les magasins uniquement après validation du mapping.

```sql
CREATE TABLE private.migration_retailer_map (
  legacy_value text PRIMARY KEY,
  retailer_id uuid NOT NULL REFERENCES public.retailers(id),
  validated_by uuid REFERENCES auth.users(id),
  validated_at timestamptz NOT NULL DEFAULT now()
);
```

### 7.4 Checkpoint phase 3

- Tous les magasins existants sont toujours présents.
- Les nouveaux magasins auront par défaut `status = 'unverified'`.
- Chaque valeur distincte de `enseigne` est soit mappée, soit inscrite dans un rapport d’anomalies.
- Les doublons de magasins sont identifiés avant toute fusion.

---

## 8. Phase 4 — Nouvelle structure communautaire

La table `circles_v2` est créée avant `prices`, afin que `prices.circle_id` puisse recevoir immédiatement une vraie clé étrangère.

### 8.1 Création

```sql
CREATE TABLE public.circles_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  invite_code text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.circle_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL
    REFERENCES public.circles_v2(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','member')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','declined','removed')),
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT circle_members_unique UNIQUE (circle_id, user_id),
  CONSTRAINT circle_members_active_joined_at CHECK (
    status <> 'active' OR joined_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX circle_members_one_active_per_user
ON public.circle_members (user_id)
WHERE status = 'active';

CREATE UNIQUE INDEX circle_members_one_active_owner
ON public.circle_members (circle_id)
WHERE role = 'owner' AND status = 'active';

CREATE INDEX circle_members_circle_idx
ON public.circle_members (circle_id, status);

CREATE OR REPLACE FUNCTION private.create_circle_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.circle_members (
    circle_id, user_id, role, status, joined_at
  )
  VALUES (
    NEW.id, NEW.created_by, 'owner', 'active', NEW.created_at
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.create_circle_owner()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER circles_v2_updated_at
BEFORE UPDATE ON public.circles_v2
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER circles_v2_create_owner
AFTER INSERT ON public.circles_v2
FOR EACH ROW EXECUTE FUNCTION private.create_circle_owner();

ALTER TABLE public.circles_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.circles_v2, public.circle_members FROM anon, authenticated;
```

### 8.2 Migration de l’ancienne structure

Une table de correspondance évite les doublons lors des répétitions :

```sql
CREATE TABLE private.migration_circle_map (
  legacy_circle_id text PRIMARY KEY,
  new_circle_id uuid NOT NULL UNIQUE
    REFERENCES public.circles_v2(id) ON DELETE CASCADE,
  migration_status text NOT NULL DEFAULT 'pending'
    CHECK (migration_status IN ('pending','migrated','conflict','rejected')),
  note text
);
```

Avant l’insertion, il faut produire un rapport des utilisateurs présents dans plusieurs relations actives. La contrainte « un seul cercle actif par utilisateur » rend ces cas incompatibles avec la cible et impose une décision manuelle.

Pour chaque relation legacy validée :

- le demandeur devient `owner` ;
- le destinataire devient `member` ;
- le statut cible est `active` si la relation legacy est active ;
- le statut cible est `pending` si l’invitation est encore en attente ;
- les relations refusées ou supprimées restent en archive et ne créent pas de cercle actif.

Aucun membre actif ne doit être ajouté manuellement sans conserver la correspondance avec la ligne source.

---

## 9. Phase 5 — Tables de scan et de prix

### 9.1 Corrections indispensables par rapport au plan initial

- `receipts.client_scan_id` est `NOT NULL` et `UNIQUE` pour garantir l’idempotence des nouveaux scans.
- `prices.circle_id` reçoit une vraie FK vers `circles_v2`.
- `prices.product_id` reste `NOT NULL` ; les imports non résolus restent en staging.
- `valid_until` est calculé par trigger avant insertion.
- le trigger de cohérence produit/variante est attaché aux tables concernées.
- l’index unique de `receipt_line_id` n’est pas doublé par un second index inutile.
- les lignes legacy plates ne créent ni `receipts` ni `receipt_lines`.

### 9.2 Idempotence des tickets

La table `receipts` doit contenir :

```sql
client_scan_id uuid NOT NULL UNIQUE
```

L’API de création vérifie ce champ avant de lancer un nouveau traitement. Le contrôle par `receipt_fingerprint` intervient ensuite pour identifier un même achat envoyé avec un nouvel identifiant.

### 9.3 Contraintes de validation des lignes de ticket

Les contraintes suivantes doivent être présentes en plus de celles du document 02 :

```sql
CHECK (
  generic_validation_status <> 'validated'
  OR generic_validation_method IS NOT NULL
),
CHECK (
  exact_validation_status <> 'validated'
  OR exact_validation_method IS NOT NULL
),
CHECK (
  exact_validation_status <> 'validated'
  OR generic_validation_status = 'validated'
),
CHECK (
  exact_validation_status <> 'validated'
  OR product_variant_id IS NOT NULL
),
CHECK (
  generic_validation_status <> 'validated'
  OR product_id IS NOT NULL
)
```

### 9.4 Calcul automatique de `valid_until`

```sql
CREATE OR REPLACE FUNCTION public.set_price_valid_until()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  validity_days integer;
BEGIN
  IF NEW.valid_until IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.promotion_end_date IS NOT NULL THEN
    NEW.valid_until := NEW.promotion_end_date;
    RETURN NEW;
  END IF;

  IF NEW.price_type = 'promo' THEN
    NEW.valid_until := NEW.observed_at + 14;
    RETURN NEW;
  END IF;

  SELECT sc.default_price_validity_days
  INTO validity_days
  FROM public.products p
  JOIN public.subcategories sc ON sc.id = p.subcategory_id
  WHERE p.id = NEW.product_id;

  NEW.valid_until := NEW.observed_at + COALESCE(validity_days, 30);
  RETURN NEW;
END;
$$;
```

Le trigger est uniquement `BEFORE INSERT`, afin que la valeur reste figée ensuite :

```sql
CREATE TRIGGER prices_set_valid_until
BEFORE INSERT ON public.prices
FOR EACH ROW EXECUTE FUNCTION public.set_price_valid_until();
```

### 9.5 Traçabilité et idempotence des imports

Pour éviter de migrer deux fois une même ligne legacy :

```sql
CREATE UNIQUE INDEX prices_import_source_unique
ON public.prices (source_reference)
WHERE source_type = 'import'
  AND source_reference IS NOT NULL;
```

Le document 02 v1.4 rend également `source_reference` obligatoire pour `source_type = 'import'`. Le script de création de `prices` doit donc inclure :

```sql
CHECK (source_type <> 'import' OR source_reference IS NOT NULL)
```

L’index garantit l’idempotence des répétitions de migration.

### 9.6 Index complémentaires

```sql
CREATE UNIQUE INDEX prices_receipt_line_unique
ON public.prices (receipt_line_id)
WHERE receipt_line_id IS NOT NULL;

CREATE INDEX prices_comparator_idx
ON public.prices (product_id, store_id, valid_until, observed_at DESC)
WHERE is_validated = true AND is_archived = false;

CREATE INDEX prices_user_history_idx
ON public.prices (user_id, observed_at DESC);

CREATE INDEX prices_circle_idx
ON public.prices (circle_id)
WHERE circle_id IS NOT NULL;

CREATE INDEX receipt_lines_raw_text_trgm
ON public.receipt_lines
USING gin (raw_text extensions.gin_trgm_ops);
```

### 9.7 Images et Storage

La base doit être cohérente avec le stockage réel des photos :

1. inventorier le bucket déjà utilisé ;
2. réutiliser ce bucket s’il est conforme ;
3. sinon créer un bucket privé dédié ;
4. adopter une convention de chemin comprenant au minimum l’utilisateur et le ticket ;
5. déployer les politiques Storage avec les politiques RLS du document 08.

Aucun bucket public ne doit exposer les photos complètes des tickets.

### 9.8 Baseline RLS

RLS doit être activée immédiatement sur :

- `receipts` ;
- `receipt_images` ;
- `receipt_lines` ;
- `prices`.

Tous les droits clients sont révoqués jusqu’au déploiement des politiques finales.

---

## 10. Phase 6 — Comparateur

### 10.1 Tables de snapshots

Créer les tables conformément au document 02 et ajouter les contrôles suivants :

```sql
CHECK (period_end >= period_start),
CHECK (expires_at IS NULL OR expires_at >= computed_at)
```

Attacher le trigger de cohérence produit/variante à `recommendation_snapshot_items`.

### 10.2 Vue `comparable_prices`

Le plan initial indiquait à tort que la RLS de `prices` s’appliquait automatiquement à une vue classique. Une vue PostgreSQL s’exécute par défaut avec les droits de son propriétaire.

La vue doit être créée avec `security_invoker = true` :

```sql
CREATE OR REPLACE VIEW public.comparable_prices
WITH (security_invoker = true)
AS
SELECT
  p.product_id,
  CASE
    WHEN pv.validation_status = 'validated'
      THEN p.product_variant_id
    ELSE NULL
  END AS product_variant_id,
  p.store_id,
  p.price,
  p.unit_price,
  p.currency_code,
  p.price_type,
  p.promotion_end_date,
  p.observed_at,
  p.valid_until,
  p.source_type
FROM public.prices p
LEFT JOIN public.product_variants pv
  ON pv.id = p.product_variant_id
JOIN public.stores s
  ON s.id = p.store_id
WHERE p.is_validated = true
  AND p.is_archived = false
  AND p.valid_until >= CURRENT_DATE
  AND s.status = 'active';
```

### 10.3 Mode d’accès retenu

Pour permettre au comparateur d’exploiter l’ensemble des prix validés sans exposer directement les lignes personnelles :

- `anon` et `authenticated` n’ont pas accès directement à la vue ;
- `service_role` reçoit `SELECT` sur la vue ;
- le calcul est exécuté côté serveur ou dans une Edge Function ;
- le client reçoit uniquement le résultat du comparateur ou du snapshot ;
- la clé `service_role` n’est jamais embarquée dans l’application cliente.

```sql
REVOKE ALL ON public.comparable_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comparable_prices TO service_role;
```

Si un accès direct client est souhaité plus tard, il faudra créer une fonction RPC dédiée avec paramètres, limites et règles de sécurité explicites.

---

## 11. Phase 7 — `favorites_v2` et `shopping_list_v2`

Ajouter des colonnes relationnelles à une table contenant une liste JSONB ne suffit pas : une ligne legacy peut contenir plusieurs articles alors que le modèle cible exige une ligne par article.

La stratégie correcte consiste à créer de nouvelles tables.

### 11.1 Tables cibles temporaires

```sql
CREATE TABLE public.favorites_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_variant_id uuid
    REFERENCES public.product_variants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT favorites_v2_user_product_unique UNIQUE (user_id, product_id)
);

CREATE TABLE public.shopping_list_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_variant_id uuid
    REFERENCES public.product_variants(id) ON DELETE SET NULL,
  raw_label text NOT NULL,
  quantity numeric(6,3) CHECK (quantity > 0),
  unit text,
  is_checked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 11.2 Migration JSONB

Après l’inventaire, un script dédié utilise `jsonb_array_elements` ou `jsonb_to_recordset` selon la structure réelle.

Règles :

- chaque favori résolu crée une ligne dans `favorites_v2` ;
- un favori non résolu reste en staging, car `favorites_v2.product_id` est obligatoire ;
- chaque article de liste crée une ligne dans `shopping_list_v2` ;
- un article de liste non résolu conserve son libellé dans `raw_label` avec `product_id = NULL` ;
- aucune donnée JSONB source n’est supprimée avant validation complète.

### 11.3 Sécurité

RLS est activée immédiatement et les droits clients restent révoqués jusqu’à la phase RLS.

---

## 12. Phase 8 — Peuplement du référentiel

### 12.1 Source de vérité

Le référentiel produit validé le plus récent du document 01 est la source de vérité pour :

- `categories` ;
- `subcategories` ;
- `products`.

Les tables `produits_ref` et `products_catalog` servent uniquement à :

- proposer des correspondances ;
- enrichir les alias ;
- récupérer des informations de marque ou de format à contrôler.

Elles ne doivent pas recréer automatiquement une taxonomie différente de celle du document 01.

### 12.2 Retailers et marques

Les enseignes et marques sont peuplées à partir de listes canoniques validées. Les variantes legacy alimentent les tables de mapping, pas directement le référentiel.

### 12.3 Variantes exactes

Une variante n’est créée automatiquement que si le rapprochement est suffisamment fiable :

- produit générique résolu ;
- marque résolue ou explicitement absente ;
- quantité totale et unité interprétées ;
- conditionnement cohérent ;
- code-barres valide s’il est présent.

Dans les autres cas, le prix peut être migré au niveau générique, avec `product_variant_id = NULL`.

### 12.4 Checkpoint phase 8

Les nombres attendus ne doivent pas être approximatifs dans le script final. Ils sont calculés depuis le fichier de seed validé :

```sql
SELECT COUNT(*) FROM public.categories;
SELECT COUNT(*) FROM public.subcategories;
SELECT COUNT(*) FROM public.products;
```

Le checkpoint attend exactement 14 catégories visibles et compare les sous-catégories et produits aux totaux exacts du seed, sans créer de catégorie `Non classé`.

---

## 13. Phase 9 — Staging et migration des données legacy

### 13.1 Table de staging des prix

```sql
CREATE TABLE private.migration_price_staging (
  source_table text NOT NULL
    CHECK (source_table IN ('price_db','archives','community_prices')),
  source_id text NOT NULL,
  source_payload jsonb NOT NULL,
  raw_product text,
  raw_brand text,
  raw_format text,
  raw_conditionnement text,
  raw_store_id uuid,
  raw_store_name text,
  raw_store_address text,
  raw_user_id uuid,
  raw_price numeric(8,2),
  raw_quantity numeric(8,3),
  raw_unit text,
  raw_unit_price numeric(8,2),
  raw_observed_at date,
  product_id uuid REFERENCES public.products(id),
  product_variant_id uuid REFERENCES public.product_variants(id),
  store_id uuid REFERENCES public.stores(id),
  user_id uuid REFERENCES auth.users(id),
  circle_id uuid REFERENCES public.circles_v2(id),
  mapping_status text NOT NULL DEFAULT 'pending'
    CHECK (mapping_status IN ('pending','ready','migrated','review','rejected')),
  error_code text,
  error_message text,
  migrated_price_id uuid REFERENCES public.prices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, source_id)
);
```

### 13.2 Chargement de `price_db`

```sql
INSERT INTO private.migration_price_staging (
  source_table,
  source_id,
  source_payload,
  raw_product,
  raw_brand,
  raw_format,
  raw_conditionnement,
  raw_store_id,
  raw_store_name,
  raw_store_address,
  raw_user_id,
  raw_price,
  raw_quantity,
  raw_unit,
  raw_unit_price,
  raw_observed_at
)
SELECT
  'price_db',
  p.id::text,
  to_jsonb(p),
  p.product,
  p.brand,
  p.format,
  p.conditionnement::text,
  p.store_id,
  p.store_name,
  p.store_address,
  p.user_id,
  p.price,
  p.quantite,
  p.unite,
  p.prix_unitaire,
  p.date::date
FROM public.price_db p
ON CONFLICT (source_table, source_id) DO NOTHING;
```

### 13.3 Rapprochement

Ordre de priorité :

1. magasin par UUID valide ;
2. magasin par mapping manuel nom/adresse ;
3. produit par alias validé dans l’enseigne ;
4. produit par alias global validé ;
5. rapprochement trigramme proposé pour revue, jamais accepté sans seuil validé ;
6. variante exacte uniquement lorsque toutes ses informations sont cohérentes.

Une ligne passe à `ready` seulement si :

- `product_id` est renseigné ;
- `store_id` est renseigné ;
- `raw_price` et `raw_observed_at` sont valides ;
- le cercle est renseigné pour un prix communautaire ;
- aucune incohérence produit/variante n’est détectée.

### 13.4 Insertion de `price_db` dans `prices`

Les lignes ordinaires de `price_db` ne sont pas archivées par principe. Leur date de validité détermine naturellement si elles apparaissent encore dans le comparateur.

```sql
INSERT INTO public.prices (
  product_id,
  product_variant_id,
  store_id,
  user_id,
  price,
  quantity,
  unit,
  unit_price,
  currency_code,
  price_type,
  source_type,
  source_reference,
  observed_at,
  valid_until,
  shared_with_circle,
  circle_id,
  is_validated,
  is_archived,
  archived_at
)
SELECT
  s.product_id,
  s.product_variant_id,
  s.store_id,
  s.user_id,
  s.raw_price,
  s.raw_quantity,
  s.raw_unit,
  s.raw_unit_price,
  'EUR',
  'normal',
  'import',
  s.source_table || ':' || s.source_id,
  s.raw_observed_at,
  NULL, -- rempli par le trigger BEFORE INSERT
  false,
  NULL,
  true,
  false,
  NULL
FROM private.migration_price_staging s
WHERE s.source_table = 'price_db'
  AND s.mapping_status = 'ready'
ON CONFLICT DO NOTHING;
```

Après insertion, le staging est marqué `migrated` et reçoit l’identifiant du prix créé par rapprochement sur `source_reference`.

### 13.5 Migration de `archives`

Le JSONB est d’abord éclaté dans la même table de staging. Les lignes prêtes sont insérées avec :

```text
source_type = 'import'
source_reference = 'archives:<identifiant source>:<index item>'
is_archived = true
archived_at = date de migration ou date d’archivage connue
```

Une ligne d’archive non résolue reste en staging. Elle n’est jamais abandonnée silencieusement.

### 13.6 Migration de `community_prices`

Une ligne communautaire est insérée uniquement lorsque :

- son produit est résolu ;
- son magasin est résolu ;
- son cercle cible est connu grâce à `migration_circle_map` ;
- le contributeur est cohérent avec le cercle ou l’historique legacy.

Valeurs :

```text
shared_with_circle = true
circle_id = cercle mappé
source_type = 'import'
is_archived = false, sauf si la source est explicitement historique
```

Le plan initial omettait `circle_id`, ce qui violait directement la contrainte du modèle.

### 13.7 Utilisateurs supprimés

Pour une source `import`, `user_id` peut rester `NULL`. La migration ne doit pas échouer à cause d’un utilisateur Auth supprimé.

### 13.8 Aucune perte silencieuse

Le résultat doit pouvoir être réparti ainsi :

```sql
SELECT source_table, mapping_status, COUNT(*)
FROM private.migration_price_staging
GROUP BY source_table, mapping_status
ORDER BY source_table, mapping_status;
```

Chaque ligne source doit être :

- migrée ;
- en revue ;
- rejetée avec un motif documenté.

---

## 14. Phase 10 — Migration des cercles et données utilisateur

### 14.1 Cercles

- Insérer les cercles mappés dans `circles_v2`.
- Laisser le trigger créer le propriétaire.
- Ajouter le destinataire comme membre `active` ou `pending` selon le statut legacy.
- Enregistrer le lien dans `private.migration_circle_map`.
- Bloquer les conflits « plusieurs cercles actifs pour un même utilisateur » jusqu’à décision.

### 14.2 Favoris

- Éclater le JSONB.
- Résoudre le produit générique.
- Insérer dans `favorites_v2`.
- Laisser en staging les favoris non résolus.
- Comparer le nombre d’éléments JSON source au total migré + total en revue.

### 14.3 Liste de courses

- Éclater le JSONB.
- Toujours conserver le libellé source dans `raw_label`.
- Résoudre `product_id` et `product_variant_id` lorsque possible.
- Insérer même les articles non résolus grâce à `raw_label`.
- Conserver l’état coché, la quantité et l’unité lorsqu’ils existent.

---

## 15. Phase 11 — RLS, droits et tests de sécurité

Le document 08 contient le détail des politiques, mais leur déploiement est un **prérequis bloquant** à la bascule.

### 15.1 Points minimaux

- aucune politique récursive sur `circle_members` ;
- les fonctions `SECURITY DEFINER` utilisent un `search_path` vide et des relations qualifiées ;
- les tickets, lignes OCR, prix et snapshots sont en écriture serveur uniquement ;
- les invitations et réponses de cercle passent par les RPC du document 08 ;
- tables de référence : lecture publique contrôlée, écriture administrateur ;
- variantes et alias : visibilité selon `validation_status` et `created_by` ;
- magasins : création `unverified` par utilisateur authentifié, validation administrateur ;
- tickets, images et lignes : propriétaire via `receipts.user_id` ;
- prix : propriétaire et membres actifs du cercle lorsqu’ils sont partagés ;
- cercles : membres actifs ;
- invitations : l’invité ne peut changer que son propre statut selon la transition autorisée ;
- favoris et liste : propriétaire ;
- snapshots : propriétaire ;
- Storage des tickets : propriétaire du chemin et du ticket.

### 15.2 Définition de l’administrateur

Le plan doit utiliser une source unique et vérifiable :

- claim JWT dédié ;
- ou rôle stocké dans `profiles` ;
- ou fonction d’autorisation privée.

La décision doit être prise avant d’écrire les politiques admin.

### 15.3 Tests

Les tests pgTAP doivent couvrir :

- lecture publique des données validées ;
- invisibilité des variantes et alias `pending` pour les autres utilisateurs ;
- impossibilité de lire le ticket d’un autre utilisateur ;
- accès d’un membre actif à un prix partagé ;
- refus d’accès d’un non-membre ;
- impossibilité pour un membre de devenir propriétaire ;
- création d’un magasin uniquement en `unverified` ;
- absence d’accès client direct à `comparable_prices` ;
- accès du rôle serveur à la vue.

Commandes de validation :

```bash
supabase db reset
supabase test db
supabase db lint
supabase migration list
```

Le Security Advisor et le Performance Advisor Supabase doivent être vérifiés après déploiement en staging puis en production.

---

## 16. Phase 12 — Validation globale

### 16.1 Validation structurelle

Vérifier l’existence des tables cibles, des index, des triggers, des FKs, de la vue et des politiques.

Le nombre exact de tables ne doit pas exclure :

- les tables existantes conservées (`profiles`, `feedback`, `stores`) ;
- les tables temporaires `*_v2` avant bascule ;
- les tables du schéma `private` utilisées pour la migration.

### 16.2 Réconciliation des prix

Pour chaque source :

```sql
SELECT
  source_table,
  COUNT(*) AS staged,
  COUNT(*) FILTER (WHERE mapping_status = 'migrated') AS migrated,
  COUNT(*) FILTER (WHERE mapping_status = 'review') AS review,
  COUNT(*) FILTER (WHERE mapping_status = 'rejected') AS rejected
FROM private.migration_price_staging
GROUP BY source_table;
```

Contrôles supplémentaires :

- somme des montants source vs somme des montants migrés ;
- dates minimum et maximum ;
- nombre de magasins ;
- nombre d’utilisateurs contributeurs ;
- nombre de produits résolus ;
- distribution des unités ;
- aucun `source_reference` dupliqué ;
- aucun prix partagé sans cercle ;
- aucun prix archivé sans `archived_at`.

### 16.3 Réconciliation communautaire

- chaque cercle source accepté possède un mapping ;
- chaque cercle cible possède exactement un propriétaire actif ;
- aucun utilisateur n’appartient à plusieurs cercles actifs ;
- les prix communautaires migrés pointent vers le bon cercle.

### 16.4 Réconciliation utilisateur

```text
éléments source = éléments migrés + éléments en revue + éléments rejetés documentés
```

Cette égalité est exigée séparément pour les favoris et la liste de courses.

### 16.5 Validation applicative

Tester au minimum :

- scan multi-photo ;
- traitement OCR et validation générique/exacte ;
- création d’une variante `pending` ;
- création et validation d’un magasin ;
- détection de doublon de ticket ;
- génération d’un prix avec `valid_until` ;
- comparateur sur plusieurs magasins ;
- partage au cercle ;
- favoris ;
- liste de courses ;
- snapshots ;
- suppression ou archivage des objets autorisés.

---

## 17. Phase 13 — Bascule

### 17.1 Préparation

1. Valider le staging.
2. Déployer les migrations structurelles et RLS en production.
3. Charger et rapprocher les données.
4. Déployer le code applicatif derrière un feature flag.
5. Générer les nouveaux types TypeScript Supabase.
6. Planifier une courte fenêtre de maintenance.

### 17.2 Dernier delta

Pendant la maintenance :

- bloquer les écritures legacy ;
- relancer le chargement staging de manière idempotente ;
- migrer les nouvelles lignes ;
- refaire tous les contrôles de réconciliation ;
- réaliser une sauvegarde finale pré-bascule.

### 17.3 Échange des tables

À exécuter dans une transaction après validation :

```sql
BEGIN;

ALTER TABLE public.circles RENAME TO _legacy_circles;
ALTER TABLE public.circles_v2 RENAME TO circles;

ALTER TABLE public.favorites RENAME TO _legacy_favorites;
ALTER TABLE public.favorites_v2 RENAME TO favorites;

ALTER TABLE public.shopping_list RENAME TO _legacy_shopping_list;
ALTER TABLE public.shopping_list_v2 RENAME TO shopping_list;

COMMIT;
```

Les clés étrangères PostgreSQL suivent le renommage de la relation référencée.

### 17.4 Activation applicative

- activer le feature flag du nouveau modèle ;
- surveiller les erreurs PostgREST, Edge Functions et base ;
- vérifier la génération de nouveaux tickets et prix ;
- vérifier les politiques RLS avec plusieurs comptes de test ;
- vérifier que les anciennes tables ne reçoivent plus d’écriture.

### 17.5 Point de non-retour

Le point de non-retour opérationnel est atteint dès que des écritures de production existent uniquement dans le nouveau modèle et qu’aucun mécanisme de réinjection inverse n’est actif.

---

## 18. Phase 14 — Stabilisation et archivage legacy

### 18.1 Mise en lecture seule

Pendant 30 jours :

- conserver les tables `_legacy_*` ;
- révoquer les droits d’écriture applicatifs ;
- conserver l’accès administrateur pour audit ;
- surveiller les écarts de volumes et de résultats.

### 18.2 Tables à renommer après validation

```sql
ALTER TABLE public.price_db RENAME TO _legacy_price_db;
ALTER TABLE public.archives RENAME TO _legacy_archives;
ALTER TABLE public.community_prices RENAME TO _legacy_community_prices;
ALTER TABLE public.produits_ref RENAME TO _legacy_produits_ref;
ALTER TABLE public.products_catalog RENAME TO _legacy_products_catalog;
ALTER TABLE public.savings RENAME TO _legacy_savings;
```

Les tables `circles`, `favorites` et `shopping_list` ont déjà été renommées lors de la bascule.

### 18.3 Suppression future

La suppression physique des tables legacy n’est pas couverte par cette version du plan. Elle nécessitera :

- une décision explicite ;
- une sauvegarde finale ;
- une vérification de l’absence de dépendances ;
- une durée de conservation définie.

Les tables privées de staging ne sont supprimées qu’après résolution ou export de toutes les lignes encore en revue.

---

## 19. Rollback détaillé

### 19.1 Avant bascule

- désactiver le feature flag ;
- ne pas exécuter les renommages ;
- corriger ou supprimer les nouvelles migrations sur l’environnement de test ;
- en production, préférer une migration corrective plutôt qu’un `DROP ... CASCADE` ;
- conserver toutes les données staging.

### 19.2 Pendant la transaction de renommage

Toute erreur provoque un `ROLLBACK` de la transaction. Les noms originaux restent alors en place.

### 19.3 Après bascule, avant nouvelle écriture

La transaction peut être inversée :

```sql
BEGIN;

ALTER TABLE public.circles RENAME TO circles_v2;
ALTER TABLE public._legacy_circles RENAME TO circles;

ALTER TABLE public.favorites RENAME TO favorites_v2;
ALTER TABLE public._legacy_favorites RENAME TO favorites;

ALTER TABLE public.shopping_list RENAME TO shopping_list_v2;
ALTER TABLE public._legacy_shopping_list RENAME TO shopping_list;

COMMIT;
```

### 19.4 Après nouvelles écritures

Un rollback exige un export et une conversion des écritures nouvelles. Sans ce script inverse, seule une correction en avant est autorisée.

---

## 20. Calendrier recommandé

Le calendrier dépend de la qualité réelle des données legacy. Les durées initiales de deux à quatre heures pour toute la migration des données sont trop optimistes tant que les JSONB et les correspondances ne sont pas audités.

| Étape | Durée indicative | Condition de sortie |
|---|---:|---|
| Inventaire et sauvegarde | 0,5 à 1 jour | Backup restauré et schémas compris |
| Migrations structurelles locales | 1 à 2 jours | `db reset`, lint et tests réussis |
| Référentiel et mappings | 1 à 3 jours | Référentiel validé et anomalies traitées |
| Migration staging | 0,5 à 2 jours | 100 % des lignes classées |
| RLS et tests sécurité | 1 à 2 jours | Tests multi-utilisateurs réussis |
| Répétition staging | 0,5 à 1 jour | Réconciliation complète |
| Bascule production | Quelques heures | Checkpoints et smoke tests réussis |
| Stabilisation | 30 jours | Aucune dépendance legacy restante |

La date du 28 juillet 2026 ne doit être conservée comme contrainte absolue qu’après confirmation qu’elle correspond réellement à l’expiration d’un identifiant utilisé par le projet.

---

## 21. Check-list de validation finale

### Données

- [ ] Les 12 tables legacy sont inventoriées.
- [ ] Chaque ligne de prix legacy est migrée, en revue ou rejetée avec motif.
- [ ] `price_db` n’est pas archivée automatiquement.
- [ ] `archives` est migrée avec `is_archived = true` et `archived_at`.
- [ ] Chaque prix partagé possède un `circle_id` valide.
- [ ] Aucun prix cible ne possède `product_id` ou `store_id` nul.
- [ ] Tous les imports ont une `source_reference` traçable.
- [ ] Les favoris et listes JSONB sont éclatés ligne par ligne.

### Structure

- [ ] Les FK correspondent au document 02 v1.4 corrigé.
- [ ] Le code-barres utilise un index unique partiel.
- [ ] Les triggers produit/variante sont attachés à toutes les tables concernées.
- [ ] `valid_until` est généré à l’insertion et reste figé.
- [ ] `client_scan_id` empêche la création multiple d’un même envoi.
- [ ] aucun enregistrement `Non classé` n’existe dans `categories`.
- [ ] Le statut par défaut des nouveaux magasins est `unverified`.
- [ ] Les index de recherche approximative sont actifs.

### Sécurité

- [ ] RLS est activée sur toutes les nouvelles tables publiques.
- [ ] Les politiques du document 08 sont déployées avant la bascule.
- [ ] Aucun droit direct `INSERT/UPDATE/DELETE` n’est accordé à `authenticated` sur les tickets, lignes OCR, prix ou snapshots.
- [ ] Les tests utilisent au minimum deux utilisateurs normaux distincts, un admin, `anon` et `service_role`.
- [ ] Les tables `profiles` et `feedback` ont été auditées ou restent en refus par défaut.
- [ ] Les photos de ticket sont dans un bucket privé.
- [ ] `comparable_prices` n’est pas accessible directement aux clients.
- [ ] La clé `service_role` est utilisée uniquement côté serveur.
- [ ] L’autorisation administrateur possède une source unique.

### Exploitation

- [ ] Sauvegarde restaurable disponible.
- [ ] Migrations versionnées dans Git.
- [ ] `supabase db reset` réussi.
- [ ] `supabase test db` réussi.
- [ ] `supabase db lint` sans erreur bloquante.
- [ ] Migration répétée sur staging.
- [ ] Types TypeScript régénérés.
- [ ] Feature flag et fenêtre de maintenance préparés.
- [ ] Plan de surveillance post-bascule défini.

---

## 22. Principales corrections apportées par la v1.1

- correction du nombre de tables legacy : 12 et non 11 ;
- suppression de l’affirmation erronée selon laquelle le CLI Supabase expire ;
- ajout d’une phase obligatoire d’inventaire, de backup et de restauration test ;
- remplacement des insertions impossibles avec `product_id = NULL` par une table de staging ;
- ajout de la migration manquante de `archives` ;
- correction de la migration de `community_prices` avec `circle_id` obligatoire ;
- conservation de `price_db` comme historique actif ou expiré par date, et non comme archive systématique ;
- remplacement de l’altération insuffisante des JSONB par `favorites_v2` et `shopping_list_v2` ;
- correction de l’unicité des codes-barres ;
- correction de la normalisation des alias et adresses ;
- correction du statut par défaut des nouveaux magasins ;
- création de la structure communautaire avant `prices` ;
- ajout du calcul automatique de `valid_until` ;
- ajout des triggers de cohérence produit/variante ;
- correction de la sécurité de la vue `comparable_prices` ;
- activation immédiate de RLS et retrait des droits clients avant politiques ;
- ajout de tests pgTAP, lint, staging et réconciliation complète ;
- définition explicite du point de non-retour et du rollback après bascule.

---

## 23. Alignement avec les documents fondateurs

Le présent plan applique les décisions suivantes :

- 14 catégories visibles ; `Non classé` reste un état de résolution ;
- `price_db` migre directement vers `prices` avec `source_type = 'import'`, sans créer de faux tickets ;
- `profiles` et `feedback` sont conservées hors cœur tant que leur structure réelle n’a pas été auditée ;
- `products` représente le produit générique et `product_variants` le produit exact ;
- seuils de reconnaissance 0,80 et 0,95 ;
- alias limités à une portée enseigne ou globale dans la première version ;
- types de prix `normal`, `promo`, `loyalty_card`, `batch` ;
- validité 7/90/180/30 jours selon la sous-catégorie, sauf promotion ;
- accès au comparateur côté serveur ;
- anomalies neutralisées avec `is_validated` et `is_archived` dans la première version ;
- snapshots utilisés pour figer les économies potentielles ;
- économie réalisée reportée tant que le lien snapshot–liste–ticket n’est pas modélisé.

---

## 24. Historique des versions

| Version | Date | Modifications |
|---|---|---|
| v1.0 | 30 juin 2026 | Première version du plan de migration |
| v1.1 corrigée | 30 juin 2026 | Audit complet, correction des blocages SQL, ajout du staging, de la sauvegarde, de la sécurité, des tests et de la stratégie de bascule |
