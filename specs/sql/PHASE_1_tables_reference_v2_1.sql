-- =============================================================================
-- PRIXMALIN — PHASE 1 : RÉFÉRENTIEL PRODUITS EN FRANÇAIS
-- Version : 2.1 | Date : 2026-06-30
--
-- ORDRE
--   enseignes → marques → categories → sous_categories → produits
--   → variantes_produit → alias_produits
--
-- PRÉREQUIS
--   - Exécuter le contrôle des extensions avant la phase 0.
--   - pg_trgm doit être accessible via public ou extensions.
--
-- PRINCIPES
--   - Aucun objet legacy n'est renommé ou supprimé.
--   - Le référentiel global est lisible par les utilisateurs authentifiés.
--   - Seuls les administrateurs peuvent l'insérer ou le modifier.
--   - Aucun utilisateur standard ne peut renommer directement un produit,
--     une catégorie, une marque ou un alias global.
-- =============================================================================

BEGIN;
SET LOCAL search_path = pg_catalog, public, extensions;

-- Arrêt préventif si une phase cible a déjà été créée.
DO $$
DECLARE
  v_objet TEXT;
BEGIN
  FOREACH v_objet IN ARRAY ARRAY[
    'enseignes','marques','categories','sous_categories',
    'produits','variantes_produit','alias_produits'
  ]
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', v_objet)) IS NOT NULL THEN
      RAISE EXCEPTION
        'Objet public.% déjà présent. Vérifier le schéma avant de relancer la phase 1.',
        v_objet;
    END IF;
  END LOOP;
END;
$$;

-- =============================================================================
-- 1.1 ENSEIGNES
-- =============================================================================
CREATE TABLE public.enseignes (
  id              UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  nom             TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  url_logo        TEXT,
  actif           BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le      TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT enseignes_nom_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(nom)) > 0),
  CONSTRAINT enseignes_slug_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(slug)) > 0)
);

CREATE UNIQUE INDEX uq_enseignes_nom_sans_casse
  ON public.enseignes (pg_catalog.lower(nom));
CREATE INDEX idx_enseignes_nom_trigramme
  ON public.enseignes USING gin (pg_catalog.lower(nom) gin_trgm_ops);

CREATE TRIGGER trg_enseignes_date_modification
  BEFORE UPDATE ON public.enseignes
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 1.2 MARQUES
-- =============================================================================
CREATE TABLE public.marques (
  id              UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  nom             TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  est_mdd         BOOLEAN NOT NULL DEFAULT FALSE,
  enseigne_id     UUID REFERENCES public.enseignes(id) ON DELETE SET NULL,
  actif           BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le      TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT marques_nom_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(nom)) > 0),
  CONSTRAINT marques_mdd_coherente
    CHECK (NOT est_mdd OR enseigne_id IS NOT NULL)
);

CREATE INDEX idx_marques_enseigne_id ON public.marques(enseigne_id);
CREATE UNIQUE INDEX uq_marques_nom_enseigne_sans_casse
  ON public.marques (
    pg_catalog.lower(nom),
    COALESCE(enseigne_id, '00000000-0000-0000-0000-000000000000'::UUID)
  );
CREATE INDEX idx_marques_nom_trigramme
  ON public.marques USING gin (pg_catalog.lower(nom) gin_trgm_ops);

CREATE TRIGGER trg_marques_date_modification
  BEFORE UPDATE ON public.marques
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 1.3 CATEGORIES
-- =============================================================================
CREATE TABLE public.categories (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  nom                   TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  icone                 TEXT,
  ordre_affichage       INTEGER NOT NULL DEFAULT 0,
  visible               BOOLEAN NOT NULL DEFAULT TRUE,
  classe_conservation   TEXT CHECK (
    classe_conservation IN ('frais','ambiant','surgele','non_alimentaire')
  ),
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT categories_nom_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(nom)) > 0),
  CONSTRAINT categories_ordre_positif
    CHECK (ordre_affichage >= 0)
);

CREATE UNIQUE INDEX uq_categories_nom_sans_casse
  ON public.categories (pg_catalog.lower(nom));

CREATE TRIGGER trg_categories_date_modification
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 1.4 SOUS-CATEGORIES
-- =============================================================================
CREATE TABLE public.sous_categories (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  categorie_id          UUID NOT NULL
                        REFERENCES public.categories(id) ON DELETE RESTRICT,
  nom                   TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  ordre_affichage       INTEGER NOT NULL DEFAULT 0,
  classe_conservation   TEXT CHECK (
    classe_conservation IN ('frais','ambiant','surgele','non_alimentaire')
  ),
  actif                 BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT sous_categories_nom_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(nom)) > 0),
  CONSTRAINT sous_categories_ordre_positif
    CHECK (ordre_affichage >= 0),
  CONSTRAINT uq_sous_categories_categorie_nom
    UNIQUE (categorie_id, nom)
);

CREATE INDEX idx_sous_categories_categorie_id
  ON public.sous_categories(categorie_id);
CREATE INDEX idx_sous_categories_nom_trigramme
  ON public.sous_categories USING gin (pg_catalog.lower(nom) gin_trgm_ops);

CREATE TRIGGER trg_sous_categories_date_modification
  BEFORE UPDATE ON public.sous_categories
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 1.5 PRODUITS GÉNÉRIQUES
-- =============================================================================
CREATE TABLE public.produits (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  sous_categorie_id     UUID NOT NULL
                        REFERENCES public.sous_categories(id) ON DELETE RESTRICT,
  nom_reference         TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  type_unite            TEXT NOT NULL CHECK (
    type_unite IN ('poids','volume','piece','lot')
  ),
  unite_base            TEXT NOT NULL,
  actif                 BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT produits_nom_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(nom_reference)) > 0),
  CONSTRAINT produits_unite_base_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(unite_base)) > 0),
  CONSTRAINT uq_produits_sous_categorie_nom
    UNIQUE (sous_categorie_id, nom_reference)
);

CREATE INDEX idx_produits_sous_categorie_id
  ON public.produits(sous_categorie_id);
CREATE INDEX idx_produits_nom_reference_trigramme
  ON public.produits USING gin (pg_catalog.lower(nom_reference) gin_trgm_ops);

CREATE TRIGGER trg_produits_date_modification
  BEFORE UPDATE ON public.produits
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 1.6 VARIANTES PRODUIT
-- =============================================================================
CREATE TABLE public.variantes_produit (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  produit_id            UUID NOT NULL
                        REFERENCES public.produits(id) ON DELETE RESTRICT,
  marque_id             UUID REFERENCES public.marques(id) ON DELETE SET NULL,
  code_barres           TEXT UNIQUE,
  quantite_nette        NUMERIC(12,3),
  unite_quantite        TEXT,
  nombre_unites         INTEGER NOT NULL DEFAULT 1,
  libelle               TEXT,
  composition           TEXT,
  nutri_score           TEXT CHECK (nutri_score IN ('A','B','C','D','E')),
  est_bio               BOOLEAN NOT NULL DEFAULT FALSE,
  url_image             TEXT,
  actif                 BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT variantes_quantite_positive
    CHECK (quantite_nette IS NULL OR quantite_nette > 0),
  CONSTRAINT variantes_nombre_unites_positif
    CHECK (nombre_unites > 0),
  CONSTRAINT variantes_quantite_unite_coherentes
    CHECK (
      (quantite_nette IS NULL AND unite_quantite IS NULL)
      OR
      (quantite_nette IS NOT NULL AND unite_quantite IS NOT NULL)
    ),
  CONSTRAINT variantes_code_barres_format
    CHECK (
      code_barres IS NULL
      OR code_barres ~ '^[0-9]{8}$|^[0-9]{12,14}$'
    ),
  CONSTRAINT uq_variantes_id_produit UNIQUE (id, produit_id)
);

CREATE INDEX idx_variantes_produit_produit_id
  ON public.variantes_produit(produit_id);
CREATE INDEX idx_variantes_produit_marque_id
  ON public.variantes_produit(marque_id);
CREATE INDEX idx_variantes_produit_code_barres
  ON public.variantes_produit(code_barres)
  WHERE code_barres IS NOT NULL;
CREATE INDEX idx_variantes_produit_libelle_trigramme
  ON public.variantes_produit USING gin (pg_catalog.lower(libelle) gin_trgm_ops)
  WHERE libelle IS NOT NULL;

CREATE TRIGGER trg_variantes_produit_date_modification
  BEFORE UPDATE ON public.variantes_produit
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 1.7 ALIAS PRODUITS — RÉFÉRENTIEL GLOBAL
-- Les utilisateurs standards ne peuvent pas écrire directement ici.
-- =============================================================================
CREATE TABLE public.alias_produits (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  libelle_alias         TEXT NOT NULL,
  produit_id            UUID NOT NULL
                        REFERENCES public.produits(id) ON DELETE RESTRICT,
  variante_produit_id   UUID,
  origine               TEXT NOT NULL CHECK (
    origine IN ('manuel','ia','utilisateur_valide')
  ),
  cree_par              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  statut                TEXT NOT NULL DEFAULT 'actif' CHECK (
    statut IN ('actif','en_attente','rejete')
  ),
  confiance             NUMERIC(4,3) CHECK (confiance BETWEEN 0 AND 1),
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT alias_produits_libelle_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(libelle_alias)) > 0),
  CONSTRAINT alias_produits_variante_exige_produit
    CHECK (variante_produit_id IS NULL OR produit_id IS NOT NULL),
  CONSTRAINT fk_alias_variante_produit
    FOREIGN KEY (variante_produit_id, produit_id)
    REFERENCES public.variantes_produit(id, produit_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_alias_produits_actifs_sans_casse
  ON public.alias_produits (pg_catalog.lower(libelle_alias))
  WHERE statut = 'actif';
CREATE INDEX idx_alias_produits_produit_id
  ON public.alias_produits(produit_id);
CREATE INDEX idx_alias_produits_libelle_trigramme
  ON public.alias_produits
  USING gin (pg_catalog.lower(libelle_alias) gin_trgm_ops);

CREATE TRIGGER trg_alias_produits_date_modification
  BEFORE UPDATE ON public.alias_produits
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- RLS ET PRIVILÈGES
-- =============================================================================
ALTER TABLE public.enseignes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marques            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sous_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variantes_produit   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alias_produits      ENABLE ROW LEVEL SECURITY;

CREATE POLICY enseignes_lecture_authentifiee
  ON public.enseignes FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY enseignes_insertion_admin
  ON public.enseignes FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY enseignes_modification_admin
  ON public.enseignes FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

CREATE POLICY marques_lecture_authentifiee
  ON public.marques FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY marques_insertion_admin
  ON public.marques FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY marques_modification_admin
  ON public.marques FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

CREATE POLICY categories_lecture_authentifiee
  ON public.categories FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY categories_insertion_admin
  ON public.categories FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY categories_modification_admin
  ON public.categories FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

CREATE POLICY sous_categories_lecture_authentifiee
  ON public.sous_categories FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY sous_categories_insertion_admin
  ON public.sous_categories FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY sous_categories_modification_admin
  ON public.sous_categories FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

CREATE POLICY produits_lecture_authentifiee
  ON public.produits FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY produits_insertion_admin
  ON public.produits FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY produits_modification_admin
  ON public.produits FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

CREATE POLICY variantes_produit_lecture_authentifiee
  ON public.variantes_produit FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY variantes_produit_insertion_admin
  ON public.variantes_produit FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY variantes_produit_modification_admin
  ON public.variantes_produit FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

CREATE POLICY alias_produits_lecture_authentifiee
  ON public.alias_produits FOR SELECT TO authenticated
  USING (statut = 'actif' OR public.est_administrateur());
CREATE POLICY alias_produits_insertion_admin
  ON public.alias_produits FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY alias_produits_modification_admin
  ON public.alias_produits FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

REVOKE ALL ON TABLE
  public.enseignes,
  public.marques,
  public.categories,
  public.sous_categories,
  public.produits,
  public.variantes_produit,
  public.alias_produits
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.enseignes,
  public.marques,
  public.categories,
  public.sous_categories,
  public.produits,
  public.variantes_produit,
  public.alias_produits
TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT
-- =============================================================================
-- SELECT tablename
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'enseignes','marques','categories','sous_categories',
--     'produits','variantes_produit','alias_produits'
--   )
-- ORDER BY tablename;
-- Résultat attendu : 7 lignes.
-- =============================================================================
