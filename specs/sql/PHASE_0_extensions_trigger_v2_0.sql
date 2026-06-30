-- =============================================================================
-- PRIXMALIN — PHASE 0 : SOCLE TECHNIQUE ET FONCTIONS COMMUNES
-- Version : 2.0 | Date : 2026-06-30
--
-- OBJET
--   - Installer les extensions nécessaires sans modifier les objets legacy.
--   - Créer les fonctions communes utilisées par les phases suivantes.
--
-- SÉCURITÉ
--   - Aucun DROP.
--   - Aucune table legacy modifiée.
--   - Les fonctions ne sont pas exécutables par anon.
--
-- PRÉREQUIS
--   - Exécuter auparavant ETAPE_A_CONTROLE_PREALABLE_LECTURE_SEULE_v1.0.sql.
-- =============================================================================

BEGIN;

-- Supabase utilise généralement le schéma extensions pour les extensions.
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- Mise à jour automatique de la colonne modifie_le.
-- Fonction SECURITY INVOKER : aucun privilège élevé n'est nécessaire.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mettre_a_jour_date_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.modifie_le := pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mettre_a_jour_date_modification()
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Vérification centralisée du rôle applicatif administrateur.
-- Le rôle est lu dans app_metadata, que l'utilisateur ne peut pas modifier
-- directement depuis son profil.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.est_administrateur()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.est_administrateur()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.est_administrateur()
  TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT
-- =============================================================================
-- SELECT extname, extversion
-- FROM pg_extension
-- WHERE extname IN ('pgcrypto','pg_trgm','unaccent')
-- ORDER BY extname;
--
-- SELECT routine_name, security_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'mettre_a_jour_date_modification',
--     'est_administrateur'
--   );
-- =============================================================================
