-- ============================================================
-- PHASE 12.a — Kill switch Core (parametres_globaux + core_est_actif)
-- #56.3a PrixMalin — Bascule d'urgence, non branchée pour l'instant
-- Préparé le 7 juillet 2026, à exécuter manuellement par François après relecture
-- ============================================================
-- Défaut absolu = legacy. core_est_actif() ne doit jamais renvoyer true par
-- accident : absence de la clé, valeur NULL, ou erreur quelconque -> false.
-- Cette fonction n'est appelée nulle part pour l'instant (ni RPC, ni front).
-- ============================================================

BEGIN;

CREATE TABLE public.parametres_globaux (
  cle          TEXT PRIMARY KEY,
  valeur       TEXT,
  description  TEXT,
  modifie_le   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_parametres_globaux_date_modification
  BEFORE UPDATE ON public.parametres_globaux
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

INSERT INTO public.parametres_globaux (cle, valeur, description) VALUES
  ('core_actif', 'false', 'Bascule moteur Core : false = legacy (défaut), true = Core actif');

ALTER TABLE public.parametres_globaux ENABLE ROW LEVEL SECURITY;

CREATE POLICY parametres_globaux_lecture_authentifiee
  ON public.parametres_globaux FOR SELECT TO authenticated
  USING (true);
CREATE POLICY parametres_globaux_insertion_admin
  ON public.parametres_globaux FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY parametres_globaux_modification_admin
  ON public.parametres_globaux FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

REVOKE ALL ON TABLE public.parametres_globaux FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.parametres_globaux TO authenticated;

-- Lecture défensive : toute erreur (table absente, clé absente, valeur NULL,
-- ou n'importe quel incident imprévu) retombe sur legacy, jamais sur Core.
CREATE OR REPLACE FUNCTION public.core_est_actif()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_valeur text;
BEGIN
  BEGIN
    SELECT valeur INTO v_valeur
    FROM public.parametres_globaux
    WHERE cle = 'core_actif';
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF v_valeur IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_valeur = 'true';
END;
$$;

-- Pas de GRANT EXECUTE pour authenticated : cette fonction n'est branchée
-- nulle part pour l'instant (ni RPC #56.3a, ni front). À accorder au moment
-- où elle sera réellement appelée (bascule #56.6).
REVOKE ALL ON FUNCTION public.core_est_actif() FROM PUBLIC, anon, authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT
-- =============================================================================
-- SELECT cle, valeur FROM public.parametres_globaux WHERE cle = 'core_actif';
-- -- Attendu : 'core_actif' | 'false'
-- SELECT public.core_est_actif();
-- -- Ne s'exécutera que pour le propriétaire de la fonction ou un rôle avec
-- -- EXECUTE — normal qu'authenticated n'y ait pas accès à ce stade.
-- =============================================================================
