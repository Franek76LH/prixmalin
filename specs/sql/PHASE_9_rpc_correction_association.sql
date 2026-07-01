-- ============================================================
-- PHASE 9 — RPC corriger_association_ligne_ticket v2.0
-- #55 PrixMalin — Correction association produit sur ligne ticket
-- Exécuté le 1er juillet 2026
-- ============================================================
-- Étape 1 : ajout colonnes contexte origine sur suggestions_alias_produit
-- Étape 2 : RPC corriger_association_ligne_ticket v2.0
-- ============================================================

-- ÉTAPE 1 — ALTER TABLE suggestions_alias_produit
BEGIN;

ALTER TABLE public.suggestions_alias_produit
  ADD COLUMN IF NOT EXISTS magasin_source_id   uuid REFERENCES public.magasins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enseigne_source_id  uuid REFERENCES public.enseignes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portee_proposee      text NOT NULL DEFAULT 'globale'
    CHECK (portee_proposee IN ('globale', 'enseigne')),
  ADD COLUMN IF NOT EXISTS enseigne_cible_id   uuid REFERENCES public.enseignes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.suggestions_alias_produit.enseigne_source_id IS 'Enseigne depuis laquelle le libellé a été rencontré';
COMMENT ON COLUMN public.suggestions_alias_produit.magasin_source_id  IS 'Magasin précis depuis lequel le libellé a été rencontré';
COMMENT ON COLUMN public.suggestions_alias_produit.portee_proposee    IS 'Portée proposée par défaut : globale. L''admin peut restreindre à une enseigne.';
COMMENT ON COLUMN public.suggestions_alias_produit.enseigne_cible_id  IS 'Enseigne à laquelle l''alias sera limité après validation. NULL = alias global.';

COMMIT;

-- ÉTAPE 2 — RPC corriger_association_ligne_ticket v2.0
BEGIN;

CREATE OR REPLACE FUNCTION public.corriger_association_ligne_ticket(
  p_ligne_ticket_id     uuid,
  p_produit_id          uuid,
  p_variante_produit_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_utilisateur_id        uuid;
  v_ticket_user_id        uuid;
  v_libelle_brut          text;
  v_magasin_id            uuid;
  v_enseigne_id           uuid;
  v_ancien_produit_id     uuid;
  v_ancienne_variante_id  uuid;
  v_historique_id         uuid;
  v_suggestion_id         uuid;
  v_nb_prix_maj           integer := 0;
  v_nb_suggestions        integer := 0;
  v_alias_cree            boolean := false;
BEGIN

  -- 1. Utilisateur connecté
  v_utilisateur_id := auth.uid();
  IF v_utilisateur_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- 2. Verrouiller la ligne et vérifier la propriété
  SELECT
    lt.produit_id,
    lt.variante_produit_id,
    lt.libelle_brut,
    t.utilisateur_id,
    t.magasin_id
  INTO
    v_ancien_produit_id,
    v_ancienne_variante_id,
    v_libelle_brut,
    v_ticket_user_id,
    v_magasin_id
  FROM public.lignes_ticket lt
  JOIN public.tickets t ON t.id = lt.ticket_id
  WHERE lt.id = p_ligne_ticket_id
  FOR UPDATE OF lt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LINE_NOT_FOUND';
  END IF;

  -- 3. Vérifier la propriété du ticket
  IF v_ticket_user_id <> v_utilisateur_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- 4. Vérifier que le produit cible existe
  IF NOT EXISTS (SELECT 1 FROM public.produits WHERE id = p_produit_id) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  -- 5. Vérifier que la variante appartient au produit cible
  IF p_variante_produit_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.variantes_produit
      WHERE id = p_variante_produit_id
        AND produit_id = p_produit_id
    ) THEN
      RAISE EXCEPTION 'VARIANT_MISMATCH';
    END IF;
  END IF;

  -- 6. Cas sans changement — retour immédiat sans écriture
  IF v_ancien_produit_id IS NOT DISTINCT FROM p_produit_id
  AND v_ancienne_variante_id IS NOT DISTINCT FROM p_variante_produit_id
  THEN
    RETURN jsonb_build_object(
      'succes',                 true,
      'modification_effectuee', false,
      'nb_prix_mis_a_jour',     0,
      'alias_cree',             false
    );
  END IF;

  -- 7. Récupérer l'enseigne source depuis le magasin
  SELECT enseigne_id INTO v_enseigne_id
  FROM public.magasins
  WHERE id = v_magasin_id;

  -- 8. Écrire l'historique AVANT la modification
  INSERT INTO public.historique_corrections_association (
    ligne_ticket_id,
    ancien_produit_id,
    ancienne_variante_id,
    nouveau_produit_id,
    nouvelle_variante_id,
    motif,
    corrige_par,
    cree_le
  ) VALUES (
    p_ligne_ticket_id,
    v_ancien_produit_id,
    v_ancienne_variante_id,
    p_produit_id,
    p_variante_produit_id,
    'utilisateur',
    v_utilisateur_id,
    now()
  )
  RETURNING id INTO v_historique_id;

  -- 9. Mettre à jour lignes_ticket
  UPDATE public.lignes_ticket SET
    produit_id                       = p_produit_id,
    variante_produit_id              = p_variante_produit_id,
    statut_validation_produit        = 'valide',
    methode_validation_produit       = 'utilisateur',
    produit_valide_le                = now(),
    produit_valide_par               = v_utilisateur_id,
    statut_validation_variante       = CASE
                                         WHEN p_variante_produit_id IS NOT NULL THEN 'validee'
                                         ELSE 'non_validee'
                                       END,
    methode_validation_variante      = CASE
                                         WHEN p_variante_produit_id IS NOT NULL THEN 'utilisateur'
                                         ELSE NULL
                                       END,
    variante_validee_le              = CASE
                                         WHEN p_variante_produit_id IS NOT NULL THEN now()
                                         ELSE NULL
                                       END,
    variante_validee_par             = CASE
                                         WHEN p_variante_produit_id IS NOT NULL THEN v_utilisateur_id
                                         ELSE NULL
                                       END,
    association_corrigee_utilisateur = true,
    modifie_le                       = now()
  WHERE id = p_ligne_ticket_id;

  -- 10. Mettre à jour uniquement le rattachement produit dans prix
  UPDATE public.prix SET
    produit_id          = p_produit_id,
    variante_produit_id = p_variante_produit_id,
    modifie_le          = now()
  WHERE ligne_ticket_id = p_ligne_ticket_id;

  GET DIAGNOSTICS v_nb_prix_maj = ROW_COUNT;

  -- 11. Suggestion d'alias — si le libellé normalisé est inconnu
  IF NOT EXISTS (
    SELECT 1 FROM public.alias_produits
    WHERE lower(trim(libelle_alias)) = lower(trim(v_libelle_brut))
      AND statut = 'actif'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.suggestions_alias_produit
    WHERE lower(trim(libelle_propose)) = lower(trim(v_libelle_brut))
      AND statut = 'en_attente'
  )
  THEN
    INSERT INTO public.suggestions_alias_produit (
      ligne_ticket_id,
      historique_correction_id,
      libelle_propose,
      produit_id,
      variante_produit_id,
      propose_par,
      magasin_source_id,
      enseigne_source_id,
      portee_proposee,
      enseigne_cible_id,
      statut
    ) VALUES (
      p_ligne_ticket_id,
      v_historique_id,
      v_libelle_brut,
      p_produit_id,
      p_variante_produit_id,
      v_utilisateur_id,
      v_magasin_id,
      v_enseigne_id,
      'globale',
      NULL,
      'en_attente'
    )
    RETURNING id INTO v_suggestion_id;

    GET DIAGNOSTICS v_nb_suggestions = ROW_COUNT;
    v_alias_cree := (v_nb_suggestions > 0);
  END IF;

  -- 12. Retour complet
  RETURN jsonb_build_object(
    'succes',                 true,
    'modification_effectuee', true,
    'ligne_ticket_id',        p_ligne_ticket_id,
    'ancien_produit_id',      v_ancien_produit_id,
    'nouveau_produit_id',     p_produit_id,
    'ancienne_variante_id',   v_ancienne_variante_id,
    'nouvelle_variante_id',   p_variante_produit_id,
    'nb_prix_mis_a_jour',     v_nb_prix_maj,
    'historique_id',          v_historique_id,
    'alias_cree',             v_alias_cree,
    'suggestion_alias_id',    v_suggestion_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.corriger_association_ligne_ticket(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corriger_association_ligne_ticket(uuid, uuid, uuid) TO authenticated;

COMMIT;
