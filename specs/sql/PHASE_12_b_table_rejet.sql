-- ============================================================
-- PHASE 12.b — Table de rejet des écritures Core (rejets_ecriture_core)
-- #56.3a PrixMalin — Observabilité de la double écriture
-- Préparé le 7 juillet 2026, à exécuter manuellement par François après relecture
-- Dépend de : rien (peut être exécuté indépendamment des autres PHASE_12_*)
-- ============================================================
-- Aucune écriture directe pour authenticated : seules les futures RPC
-- SECURITY DEFINER (PHASE_12_d) y écrivent, avec les privilèges de leur
-- propriétaire, indépendamment des droits de l'appelant. La lecture reste
-- réservée à l'administrateur (panneau de rattrapage à construire plus tard).
-- ============================================================

BEGIN;

CREATE TABLE public.rejets_ecriture_core (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cree_le             TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source              TEXT NOT NULL CHECK (source IN ('scan','manuel')),
  -- Liste extensible : d'autres motifs pourront être ajoutés plus tard sans
  -- recréer la table (ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT).
  motif               TEXT NOT NULL CHECK (motif IN (
                         'magasin_non_resolu','alias_non_trouve','erreur_technique'
                       )),
  payload             JSONB,
  store_legacy_id     UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  magasin_texte       TEXT,
  libelle_non_resolu  TEXT,
  message_erreur      TEXT,
  traite              BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_rejets_ecriture_core_a_traiter
  ON public.rejets_ecriture_core(cree_le DESC)
  WHERE traite = false;
CREATE INDEX idx_rejets_ecriture_core_motif
  ON public.rejets_ecriture_core(motif);

ALTER TABLE public.rejets_ecriture_core ENABLE ROW LEVEL SECURITY;

CREATE POLICY rejets_ecriture_core_lecture_admin
  ON public.rejets_ecriture_core FOR SELECT TO authenticated
  USING (public.est_administrateur());
CREATE POLICY rejets_ecriture_core_modification_admin
  ON public.rejets_ecriture_core FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

REVOKE ALL ON TABLE public.rejets_ecriture_core FROM anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.rejets_ecriture_core TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT
-- =============================================================================
-- SELECT count(*) FROM public.rejets_ecriture_core;
-- -- Attendu : 0 (table vide, rien ne l'alimente avant PHASE_12_d)
-- =============================================================================
