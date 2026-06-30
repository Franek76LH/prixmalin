-- =============================================================================
-- PRIXMALIN — PHASE 3 : COMMUNAUTÉ ET CERCLES SÉCURISÉS
-- Version : 2.0 | Date : 2026-06-30
--
-- PRINCIPES
--   - Les tables legacy de communauté restent intactes.
--   - Aucun INSERT, UPDATE ou DELETE direct n'est accordé aux utilisateurs.
--   - La création, l'adhésion et la gestion passent par des RPC sécurisées.
--   - Un membre ne peut jamais s'auto-promouvoir.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.cercles') IS NOT NULL
     OR pg_catalog.to_regclass('public.membres_cercle') IS NOT NULL THEN
    RAISE EXCEPTION
      'La phase 3 semble déjà présente. Vérifier cercles et membres_cercle.';
  END IF;
END;
$$;

-- =============================================================================
-- 3.1 CERCLES
-- =============================================================================
CREATE TABLE public.cercles (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  nom                   TEXT NOT NULL,
  proprietaire_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_invitation       TEXT NOT NULL UNIQUE DEFAULT
                        pg_catalog.upper(
                          pg_catalog.substr(
                            pg_catalog.replace(pg_catalog.gen_random_uuid()::TEXT, '-', ''),
                            1,
                            12
                          )
                        ),
  nombre_max_membres    INTEGER NOT NULL DEFAULT 10,
  actif                 BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT cercles_nom_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(nom)) > 0),
  CONSTRAINT cercles_capacite_valide
    CHECK (nombre_max_membres BETWEEN 2 AND 100),
  CONSTRAINT uq_cercles_proprietaire_nom
    UNIQUE (proprietaire_id, nom)
);

CREATE INDEX idx_cercles_proprietaire_id
  ON public.cercles(proprietaire_id);
CREATE INDEX idx_cercles_code_invitation
  ON public.cercles(code_invitation);

CREATE TRIGGER trg_cercles_date_modification
  BEFORE UPDATE ON public.cercles
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 3.2 MEMBRES DES CERCLES
-- =============================================================================
CREATE TABLE public.membres_cercle (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  cercle_id             UUID NOT NULL REFERENCES public.cercles(id) ON DELETE CASCADE,
  utilisateur_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role                  TEXT NOT NULL DEFAULT 'membre' CHECK (
    role IN ('proprietaire','administrateur','membre')
  ),
  statut                TEXT NOT NULL DEFAULT 'actif' CHECK (
    statut IN ('actif','en_attente','banni','quitte')
  ),
  rejoint_le            TIMESTAMPTZ,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT uq_membres_cercle_utilisateur UNIQUE (cercle_id, utilisateur_id),
  CONSTRAINT membres_cercle_rejoint_coherent
    CHECK (
      (statut = 'actif' AND rejoint_le IS NOT NULL)
      OR statut <> 'actif'
    )
);

CREATE UNIQUE INDEX uq_membres_cercle_un_proprietaire
  ON public.membres_cercle(cercle_id)
  WHERE role = 'proprietaire' AND statut = 'actif';
CREATE INDEX idx_membres_cercle_utilisateur_id
  ON public.membres_cercle(utilisateur_id);
CREATE INDEX idx_membres_cercle_cercle_statut
  ON public.membres_cercle(cercle_id, statut);

CREATE TRIGGER trg_membres_cercle_date_modification
  BEFORE UPDATE ON public.membres_cercle
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 3.3 FONCTIONS DE CONTRÔLE POUR LA RLS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.est_membre_actif_cercle(p_cercle_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.membres_cercle mc
    WHERE mc.cercle_id = p_cercle_id
      AND mc.utilisateur_id = auth.uid()
      AND mc.statut = 'actif'
  );
$$;

CREATE OR REPLACE FUNCTION public.est_proprietaire_cercle(p_cercle_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cercles c
    WHERE c.id = p_cercle_id
      AND c.proprietaire_id = auth.uid()
      AND c.actif = TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.est_membre_actif_cercle(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.est_proprietaire_cercle(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.est_membre_actif_cercle(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.est_proprietaire_cercle(UUID)
  TO authenticated;

-- =============================================================================
-- 3.4 RPC — CRÉER UN CERCLE
-- =============================================================================
CREATE OR REPLACE FUNCTION public.creer_cercle(
  p_nom TEXT,
  p_nombre_max_membres INTEGER DEFAULT 10
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_utilisateur UUID := auth.uid();
  v_cercle_id UUID;
BEGIN
  IF v_utilisateur IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF p_nom IS NULL OR pg_catalog.length(pg_catalog.btrim(p_nom)) < 2 THEN
    RAISE EXCEPTION 'Le nom du cercle doit contenir au moins 2 caractères.'
      USING ERRCODE = '22023';
  END IF;

  IF p_nombre_max_membres NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'Le nombre maximal de membres doit être compris entre 2 et 100.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cercles (nom, proprietaire_id, nombre_max_membres)
  VALUES (pg_catalog.btrim(p_nom), v_utilisateur, p_nombre_max_membres)
  RETURNING id INTO v_cercle_id;

  INSERT INTO public.membres_cercle (
    cercle_id, utilisateur_id, role, statut, rejoint_le
  )
  VALUES (
    v_cercle_id, v_utilisateur, 'proprietaire', 'actif', pg_catalog.now()
  );

  RETURN v_cercle_id;
END;
$$;

-- =============================================================================
-- 3.5 RPC — REJOINDRE UN CERCLE PAR CODE
-- =============================================================================
CREATE OR REPLACE FUNCTION public.rejoindre_cercle(p_code_invitation TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_utilisateur UUID := auth.uid();
  v_cercle public.cercles%ROWTYPE;
  v_membre public.membres_cercle%ROWTYPE;
  v_nombre_actifs INTEGER;
BEGIN
  IF v_utilisateur IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  SELECT c.*
  INTO v_cercle
  FROM public.cercles c
  WHERE c.code_invitation = pg_catalog.upper(pg_catalog.btrim(p_code_invitation))
    AND c.actif = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Code d''invitation invalide.' USING ERRCODE = 'P0002';
  END IF;

  SELECT mc.*
  INTO v_membre
  FROM public.membres_cercle mc
  WHERE mc.cercle_id = v_cercle.id
    AND mc.utilisateur_id = v_utilisateur;

  IF FOUND AND v_membre.statut = 'banni' THEN
    RAISE EXCEPTION 'L''accès à ce cercle est interdit.' USING ERRCODE = '42501';
  END IF;

  IF FOUND AND v_membre.statut = 'actif' THEN
    RETURN v_cercle.id;
  END IF;

  SELECT pg_catalog.count(*)::INTEGER
  INTO v_nombre_actifs
  FROM public.membres_cercle mc
  WHERE mc.cercle_id = v_cercle.id
    AND mc.statut = 'actif';

  IF v_nombre_actifs >= v_cercle.nombre_max_membres THEN
    RAISE EXCEPTION 'Ce cercle a atteint sa capacité maximale.' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.membres_cercle (
    cercle_id, utilisateur_id, role, statut, rejoint_le
  )
  VALUES (
    v_cercle.id, v_utilisateur, 'membre', 'actif', pg_catalog.now()
  )
  ON CONFLICT (cercle_id, utilisateur_id)
  DO UPDATE SET
    role = 'membre',
    statut = 'actif',
    rejoint_le = pg_catalog.now();

  RETURN v_cercle.id;
END;
$$;

-- =============================================================================
-- 3.6 RPC — QUITTER UN CERCLE SANS SUPPRESSION D'HISTORIQUE
-- =============================================================================
CREATE OR REPLACE FUNCTION public.quitter_cercle(p_cercle_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_utilisateur UUID := auth.uid();
BEGIN
  IF v_utilisateur IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cercles c
    WHERE c.id = p_cercle_id AND c.proprietaire_id = v_utilisateur
  ) THEN
    RAISE EXCEPTION
      'Le propriétaire ne peut pas quitter son cercle sans transfert préalable.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.membres_cercle
  SET statut = 'quitte'
  WHERE cercle_id = p_cercle_id
    AND utilisateur_id = v_utilisateur
    AND statut = 'actif';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adhésion active introuvable.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- =============================================================================
-- 3.7 RPC — GÉRER LE RÔLE D'UN MEMBRE (PROPRIÉTAIRE UNIQUEMENT)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.definir_role_membre_cercle(
  p_membre_id UUID,
  p_nouveau_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_utilisateur UUID := auth.uid();
  v_cercle_id UUID;
  v_role_actuel TEXT;
BEGIN
  IF v_utilisateur IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF p_nouveau_role NOT IN ('administrateur','membre') THEN
    RAISE EXCEPTION 'Rôle non autorisé.' USING ERRCODE = '22023';
  END IF;

  SELECT mc.cercle_id, mc.role
  INTO v_cercle_id, v_role_actuel
  FROM public.membres_cercle mc
  WHERE mc.id = p_membre_id
    AND mc.statut = 'actif'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membre actif introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_role_actuel = 'proprietaire' THEN
    RAISE EXCEPTION 'Le rôle du propriétaire ne peut pas être modifié ici.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cercles c
    WHERE c.id = v_cercle_id
      AND c.proprietaire_id = v_utilisateur
      AND c.actif = TRUE
  ) THEN
    RAISE EXCEPTION 'Seul le propriétaire peut modifier les rôles.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.membres_cercle
  SET role = p_nouveau_role
  WHERE id = p_membre_id;
END;
$$;

-- =============================================================================
-- 3.8 RPC — RETIRER OU BANNIR UN MEMBRE
-- =============================================================================
CREATE OR REPLACE FUNCTION public.definir_statut_membre_cercle(
  p_membre_id UUID,
  p_nouveau_statut TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_utilisateur UUID := auth.uid();
  v_cercle_id UUID;
  v_role TEXT;
BEGIN
  IF v_utilisateur IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF p_nouveau_statut NOT IN ('actif','banni','quitte') THEN
    RAISE EXCEPTION 'Statut non autorisé.' USING ERRCODE = '22023';
  END IF;

  SELECT mc.cercle_id, mc.role
  INTO v_cercle_id, v_role
  FROM public.membres_cercle mc
  WHERE mc.id = p_membre_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membre introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_role = 'proprietaire' THEN
    RAISE EXCEPTION 'Le propriétaire ne peut pas être retiré ou banni.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cercles c
    WHERE c.id = v_cercle_id
      AND c.proprietaire_id = v_utilisateur
      AND c.actif = TRUE
  ) THEN
    RAISE EXCEPTION 'Seul le propriétaire peut modifier ce statut.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.membres_cercle
  SET
    statut = p_nouveau_statut,
    rejoint_le = CASE
      WHEN p_nouveau_statut = 'actif' THEN pg_catalog.now()
      ELSE rejoint_le
    END,
    role = CASE
      WHEN p_nouveau_statut = 'actif' THEN role
      ELSE 'membre'
    END
  WHERE id = p_membre_id;
END;
$$;

-- =============================================================================
-- 3.9 RPC — RENOUVELER LE CODE D'INVITATION
-- =============================================================================
CREATE OR REPLACE FUNCTION public.renouveler_code_invitation(p_cercle_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_utilisateur UUID := auth.uid();
  v_code TEXT;
BEGIN
  IF v_utilisateur IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.cercles c
  SET code_invitation = pg_catalog.upper(
    pg_catalog.substr(
      pg_catalog.replace(pg_catalog.gen_random_uuid()::TEXT, '-', ''),
      1,
      12
    )
  )
  WHERE c.id = p_cercle_id
    AND c.proprietaire_id = v_utilisateur
    AND c.actif = TRUE
  RETURNING c.code_invitation INTO v_code;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Cercle introuvable ou accès refusé.' USING ERRCODE = '42501';
  END IF;

  RETURN v_code;
END;
$$;

-- Droits d'exécution des RPC.
REVOKE ALL ON FUNCTION public.creer_cercle(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rejoindre_cercle(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quitter_cercle(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.definir_role_membre_cercle(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.definir_statut_membre_cercle(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renouveler_code_invitation(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.creer_cercle(TEXT, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rejoindre_cercle(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.quitter_cercle(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_role_membre_cercle(UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_statut_membre_cercle(UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.renouveler_code_invitation(UUID)
  TO authenticated;

-- =============================================================================
-- RLS ET PRIVILÈGES
-- =============================================================================
ALTER TABLE public.cercles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membres_cercle ENABLE ROW LEVEL SECURITY;

CREATE POLICY cercles_lecture_membres
  ON public.cercles FOR SELECT TO authenticated
  USING (public.est_membre_actif_cercle(id));

CREATE POLICY membres_cercle_lecture_membres
  ON public.membres_cercle FOR SELECT TO authenticated
  USING (public.est_membre_actif_cercle(cercle_id));

REVOKE ALL ON TABLE public.cercles, public.membres_cercle
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.cercles, public.membres_cercle
  TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT
-- =============================================================================
-- SELECT tablename
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('cercles','membres_cercle')
-- ORDER BY tablename;
--
-- SELECT routine_name
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'creer_cercle','rejoindre_cercle','quitter_cercle',
--     'definir_role_membre_cercle','definir_statut_membre_cercle',
--     'renouveler_code_invitation'
--   )
-- ORDER BY routine_name;
-- =============================================================================
