-- =============================================================================
-- PRIXMALIN — PHASE 2 : MAGASINS ET PROPOSITIONS UTILISATEURS
-- Version : 2.1 | Date : 2026-06-30
--
-- IMPORTANT
--   - La table legacy public.stores n'est ni modifiée, ni renommée, ni supprimée.
--   - La cible française public.magasins est créée en parallèle.
--   - Un utilisateur ne peut pas écrire directement dans le référentiel magasins.
--   - Une proposition passe par la RPC sécurisée proposer_magasin().
--   - Les magasins fusionnés restent lisibles afin que la vue security_invoker
--     puisse résoudre leur magasin canonique ; les magasins fermés restent masqués.
-- =============================================================================

BEGIN;
SET LOCAL search_path = pg_catalog, public, extensions;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.magasins') IS NOT NULL
     OR pg_catalog.to_regclass('public.suggestions_magasin') IS NOT NULL THEN
    RAISE EXCEPTION
      'La phase 2 semble déjà présente. Vérifier magasins et suggestions_magasin.';
  END IF;
END;
$$;

-- =============================================================================
-- 2.1 MAGASINS — RÉFÉRENTIEL GLOBAL
-- =============================================================================
CREATE TABLE public.magasins (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  enseigne_id           UUID REFERENCES public.enseignes(id) ON DELETE SET NULL,
  nom                   TEXT NOT NULL,
  adresse               TEXT,
  code_postal           TEXT,
  ville                 TEXT,
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),
  statut                TEXT NOT NULL DEFAULT 'actif' CHECK (
    statut IN ('actif','ferme','fusionne')
  ),
  fusionne_vers_id      UUID REFERENCES public.magasins(id) ON DELETE SET NULL,
  source                TEXT NOT NULL DEFAULT 'administrateur' CHECK (
    source IN ('administrateur','migration','suggestion_validee','import')
  ),
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT magasins_nom_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(nom)) > 0),
  CONSTRAINT magasins_latitude_valide
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT magasins_longitude_valide
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT magasins_fusion_coherente
    CHECK (
      (statut = 'fusionne' AND fusionne_vers_id IS NOT NULL)
      OR
      (statut <> 'fusionne' AND fusionne_vers_id IS NULL)
    ),
  CONSTRAINT magasins_pas_autofusion
    CHECK (fusionne_vers_id IS NULL OR fusionne_vers_id <> id)
);

CREATE INDEX idx_magasins_enseigne_id ON public.magasins(enseigne_id);
CREATE INDEX idx_magasins_statut ON public.magasins(statut);
CREATE INDEX idx_magasins_ville ON public.magasins(pg_catalog.lower(ville))
  WHERE ville IS NOT NULL;
CREATE INDEX idx_magasins_nom_trigramme
  ON public.magasins USING gin (pg_catalog.lower(nom) gin_trgm_ops);

CREATE TRIGGER trg_magasins_date_modification
  BEFORE UPDATE ON public.magasins
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 2.2 SUGGESTIONS MAGASIN — FILE DE VALIDATION
-- =============================================================================
CREATE TABLE public.suggestions_magasin (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  propose_par           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enseigne_id           UUID REFERENCES public.enseignes(id) ON DELETE SET NULL,
  nom                   TEXT NOT NULL,
  adresse               TEXT,
  code_postal           TEXT,
  ville                 TEXT,
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),
  statut                TEXT NOT NULL DEFAULT 'en_attente' CHECK (
    statut IN ('en_attente','validee','rejetee')
  ),
  magasin_cree_id       UUID REFERENCES public.magasins(id) ON DELETE SET NULL,
  commentaire_validation TEXT,
  valide_par            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  valide_le             TIMESTAMPTZ,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT suggestions_magasin_nom_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(nom)) > 0),
  CONSTRAINT suggestions_magasin_latitude_valide
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT suggestions_magasin_longitude_valide
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT suggestions_magasin_validation_coherente
    CHECK (
      (statut = 'en_attente' AND valide_le IS NULL)
      OR
      (statut IN ('validee','rejetee') AND valide_le IS NOT NULL)
    )
);

CREATE INDEX idx_suggestions_magasin_propose_par
  ON public.suggestions_magasin(propose_par);
CREATE INDEX idx_suggestions_magasin_statut
  ON public.suggestions_magasin(statut);

CREATE TRIGGER trg_suggestions_magasin_date_modification
  BEFORE UPDATE ON public.suggestions_magasin
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 2.3 RPC — PROPOSER UN MAGASIN
-- =============================================================================
CREATE OR REPLACE FUNCTION public.proposer_magasin(
  p_nom TEXT,
  p_adresse TEXT DEFAULT NULL,
  p_code_postal TEXT DEFAULT NULL,
  p_ville TEXT DEFAULT NULL,
  p_enseigne_id UUID DEFAULT NULL,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_utilisateur UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_utilisateur IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF p_nom IS NULL OR pg_catalog.length(pg_catalog.btrim(p_nom)) < 2 THEN
    RAISE EXCEPTION 'Le nom du magasin est obligatoire.' USING ERRCODE = '22023';
  END IF;

  IF p_latitude IS NOT NULL AND NOT (p_latitude BETWEEN -90 AND 90) THEN
    RAISE EXCEPTION 'Latitude invalide.' USING ERRCODE = '22023';
  END IF;

  IF p_longitude IS NOT NULL AND NOT (p_longitude BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Longitude invalide.' USING ERRCODE = '22023';
  END IF;

  IF p_enseigne_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.enseignes e
    WHERE e.id = p_enseigne_id AND e.actif = TRUE
  ) THEN
    RAISE EXCEPTION 'Enseigne inconnue ou inactive.' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.suggestions_magasin (
    propose_par, enseigne_id, nom, adresse, code_postal, ville,
    latitude, longitude
  )
  VALUES (
    v_utilisateur,
    p_enseigne_id,
    pg_catalog.btrim(p_nom),
    NULLIF(pg_catalog.btrim(p_adresse), ''),
    NULLIF(pg_catalog.btrim(p_code_postal), ''),
    NULLIF(pg_catalog.btrim(p_ville), ''),
    p_latitude,
    p_longitude
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.proposer_magasin(
  TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proposer_magasin(
  TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC
) TO authenticated;

-- =============================================================================
-- RLS ET PRIVILÈGES
-- =============================================================================
ALTER TABLE public.magasins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suggestions_magasin ENABLE ROW LEVEL SECURITY;

CREATE POLICY magasins_lecture_authentifiee
  ON public.magasins FOR SELECT TO authenticated
  USING (statut IN ('actif','fusionne') OR public.est_administrateur());
CREATE POLICY magasins_insertion_admin
  ON public.magasins FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY magasins_modification_admin
  ON public.magasins FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

CREATE POLICY suggestions_magasin_lecture_propre_ou_admin
  ON public.suggestions_magasin FOR SELECT TO authenticated
  USING (propose_par = auth.uid() OR public.est_administrateur());
CREATE POLICY suggestions_magasin_modification_admin
  ON public.suggestions_magasin FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

REVOKE ALL ON TABLE public.magasins, public.suggestions_magasin
  FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.magasins
  TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.suggestions_magasin
  TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT
-- =============================================================================
-- SELECT tablename
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('magasins','suggestions_magasin')
-- ORDER BY tablename;
-- Résultat attendu : 2 lignes.
-- =============================================================================
