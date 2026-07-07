-- ============================================================
-- PHASE 12.c — Helpers de résolution (magasin, alias produit)
-- #56.3a PrixMalin — Fonctions internes utilisées par les RPC d'écriture
-- Préparé le 7 juillet 2026, à exécuter manuellement par François après relecture
-- Dépend de : correspondance_magasins (PHASE_11, déjà en base, confirmé),
--             alias_produits (PHASE_1), magasins (PHASE_2), extension
--             extensions.unaccent (PHASE_0, confirmé en base)
-- ============================================================
-- Fonctions internes uniquement : aucun GRANT EXECUTE à authenticated.
-- Seules les RPC SECURITY DEFINER de PHASE_12_d les appellent, avec les
-- privilèges de leur propriétaire.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------------
-- resoudre_magasin_core — résout un magasin_id Core à partir de ce qui est
-- disponible côté appelant.
--
-- Ordre de résolution :
--   1. p_magasin_id, s'il correspond déjà à un magasin Core existant.
--   2. correspondance_magasins, via p_store_legacy_id -> store_id_legacy
--      (nom réel de la colonne dans le DDL exécuté, PHASE_11 ; différent du
--      nom de paramètre p_store_legacy_id utilisé ici et dans les payloads
--      jsonb — écart de nommage assumé, pas une divergence de schéma).
--   3. Aucune tentative de résolution texte (p_magasin_texte) : décision
--      #56.3a explicite — correspondance_magasins est la SEULE source de
--      vérité, aucune comparaison lower(unaccent(...)) sur magasins.nom
--      n'est faite ici, pour ne jamais créer de correspondance devinée.
--      p_magasin_texte est accepté en paramètre uniquement pour être
--      journalisé tel quel par l'appelant en cas de rejet, pas pour résoudre.
--   4. Si rien ne matche : NULL.
--
-- correspondance_magasins encode déjà les fusions de magasins Core
-- (magasin_id qu'elle renvoie peut être un magasin fusionné ; c'est
-- public.prix_comparables, en lecture, qui résout fusionne_vers_id — cette
-- fonction ne s'en préoccupe pas, elle ne fait qu'écrire).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resoudre_magasin_core(
  p_magasin_id       UUID,
  p_store_legacy_id  UUID,
  p_magasin_texte    TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_magasin_id UUID;
BEGIN
  IF p_magasin_id IS NOT NULL THEN
    SELECT id INTO v_magasin_id FROM public.magasins WHERE id = p_magasin_id;
    IF v_magasin_id IS NOT NULL THEN
      RETURN v_magasin_id;
    END IF;
  END IF;

  IF p_store_legacy_id IS NOT NULL THEN
    SELECT magasin_id INTO v_magasin_id
    FROM public.correspondance_magasins
    WHERE store_id_legacy = p_store_legacy_id;
    IF v_magasin_id IS NOT NULL THEN
      RETURN v_magasin_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resoudre_magasin_core(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------
-- resoudre_alias_core — résout produit_id/variante_produit_id à partir d'un
-- libellé brut, sur alias_produits actifs uniquement.
--
-- Comparaison : lower(extensions.unaccent(libelle_alias)) = lower(extensions.unaccent(p_libelle))
-- (extensions.unaccent qualifié explicitement : l'extension est installée
-- dans le schéma extensions, jamais public — confirmé en base).
--
-- L'index unique existant (uq_alias_produits_actifs_sans_casse) garantit
-- l'unicité de lower(libelle_alias) SANS le passage par unaccent. Deux alias
-- actifs distincts qui ne diffèrent que par un accent (ex. "café" / "cafe")
-- passeraient donc chacun l'index unique, mais collisionneraient ici une
-- fois désaccentués. Dans ce cas (0 ou >1 résultat), la fonction ne renvoie
-- RIEN plutôt que de choisir arbitrairement — traité à l'identique d'un
-- alias non trouvé côté appelant, jamais un choix au hasard.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resoudre_alias_core(p_libelle TEXT)
RETURNS TABLE(produit_id UUID, variante_produit_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nb INTEGER;
BEGIN
  SELECT count(*) INTO v_nb
  FROM public.alias_produits a
  WHERE a.statut = 'actif'
    AND lower(extensions.unaccent(a.libelle_alias)) = lower(extensions.unaccent(coalesce(p_libelle, '')));

  IF v_nb = 1 THEN
    RETURN QUERY
    SELECT a.produit_id, a.variante_produit_id
    FROM public.alias_produits a
    WHERE a.statut = 'actif'
      AND lower(extensions.unaccent(a.libelle_alias)) = lower(extensions.unaccent(coalesce(p_libelle, '')));
  END IF;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.resoudre_alias_core(TEXT)
  FROM PUBLIC, anon, authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT (à exécuter avec un rôle ayant EXECUTE, ex. service_role, ou
-- temporairement en tant que propriétaire pour valider avant branchement)
-- =============================================================================
-- SELECT public.resoudre_magasin_core(NULL, 'c42e3f20-ce8a-4937-90f6-02a6bd1489c8', NULL);
-- -- Attendu : 'a1000002-0000-0000-0000-000000000002' (Carrefour Mazargues)
-- SELECT public.resoudre_magasin_core(NULL, 'c316a421-e5a6-49b7-ae56-a18140ab8fe2', 'Un magasin quelconque');
-- -- Attendu : NULL (un des 3 stores legacy sans équivalent Core)
-- SELECT * FROM public.resoudre_alias_core('un libellé qui n''existe pas');
-- -- Attendu : aucune ligne
-- =============================================================================
