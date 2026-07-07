-- ============================================================
-- PHASE 12.d — RPC d'écriture Core (enregistrer_ticket_core, enregistrer_prix_manuel_core)
-- #56.3a PrixMalin — Alimentation continue sécurisée du Core, en shadow
-- Préparé le 7 juillet 2026, à exécuter manuellement par François après relecture
-- Dépend de : PHASE_12_b (rejets_ecriture_core), PHASE_12_c (helpers),
--             correspondance_magasins (PHASE_11, déjà en base)
-- ============================================================
-- Rien n'est branché côté App.jsx : ces RPC existent mais ne sont appelées
-- par aucun code client tant que #56.3a n'est pas explicitement validé et
-- câblé dans une étape ultérieure. Shadow strict.
--
-- Toutes les écritures se font avec statut_validation='en_attente',
-- valide_le=NULL (décision #56.3a : rien n'est validé automatiquement,
-- contrairement à la migration one-shot PHASE_8 qui avait mis 'valide').
-- ============================================================

BEGIN;

-- ==================================================================
-- enregistrer_prix_manuel_core — chemin manuel direct (PriceEntrySheet)
-- ==================================================================
CREATE OR REPLACE FUNCTION public.enregistrer_prix_manuel_core(p_prix JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_utilisateur_id      UUID := auth.uid();
  v_store_legacy_id     UUID;
  v_magasin_texte       TEXT;
  v_libelle_produit     TEXT;
  v_prix_total          NUMERIC;
  v_date_observation    TIMESTAMPTZ;
  v_magasin_id          UUID;
  v_produit_id          UUID;
  v_variante_produit_id UUID;
BEGIN
  IF v_utilisateur_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- Lecture défensive du payload : toute erreur de format tombe en rejet
  -- 'erreur_technique', jamais un plantage pour l'appelant.
  BEGIN
    v_store_legacy_id  := NULLIF(p_prix->>'store_legacy_id', '')::UUID;
    v_magasin_texte    := p_prix->>'magasin_texte';
    v_libelle_produit  := p_prix->>'libelle_produit';
    v_prix_total       := NULLIF(p_prix->>'prix_total', '')::NUMERIC;
    v_date_observation := COALESCE(NULLIF(p_prix->>'date_observation', '')::TIMESTAMPTZ, now());
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, message_erreur)
    VALUES (v_utilisateur_id, 'manuel', 'erreur_technique', p_prix, SQLERRM);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', SQLERRM)));
  END;

  IF v_libelle_produit IS NULL OR btrim(v_libelle_produit) = '' THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, message_erreur)
    VALUES (v_utilisateur_id, 'manuel', 'erreur_technique', p_prix, v_store_legacy_id, v_magasin_texte, 'libelle_produit manquant');
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', 'libelle_produit manquant')));
  END IF;

  IF v_prix_total IS NULL OR v_prix_total < 0 THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, message_erreur)
    VALUES (v_utilisateur_id, 'manuel', 'erreur_technique', p_prix, v_store_legacy_id, v_magasin_texte, 'prix_total manquant ou négatif');
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', 'prix_total manquant ou négatif')));
  END IF;

  -- Résolution magasin : pas de p_magasin_id direct dans ce payload.
  v_magasin_id := public.resoudre_magasin_core(NULL, v_store_legacy_id, v_magasin_texte);
  IF v_magasin_id IS NULL THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte)
    VALUES (v_utilisateur_id, 'manuel', 'magasin_non_resolu', p_prix, v_store_legacy_id, v_magasin_texte);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'magasin_non_resolu')));
  END IF;

  -- Résolution alias : libelle_produit est le SEUL champ utilisé (décision #56.3a).
  SELECT produit_id, variante_produit_id INTO v_produit_id, v_variante_produit_id
  FROM public.resoudre_alias_core(v_libelle_produit);

  IF v_produit_id IS NULL THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, libelle_non_resolu)
    VALUES (v_utilisateur_id, 'manuel', 'alias_non_trouve', p_prix, v_store_legacy_id, v_magasin_texte, v_libelle_produit);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'alias_non_trouve', 'libelle', v_libelle_produit)));
  END IF;

  INSERT INTO public.prix (
    produit_id, variante_produit_id, magasin_id, utilisateur_id, ligne_ticket_id,
    prix_total, source, statut_validation, valide_le, observe_le
  ) VALUES (
    v_produit_id, v_variante_produit_id, v_magasin_id, v_utilisateur_id, NULL,
    v_prix_total, 'manuel', 'en_attente', NULL, v_date_observation
  );

  RETURN jsonb_build_object('statut', 'ok', 'prix_ecrits', 1, 'rejets', '[]'::jsonb);

EXCEPTION WHEN OTHERS THEN
  -- Filet de sécurité pour tout ce qui n'a pas été anticipé explicitement
  -- ci-dessus (ex. violation de contrainte inattendue sur l'INSERT prix).
  INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, message_erreur)
  VALUES (v_utilisateur_id, 'manuel', 'erreur_technique', p_prix, SQLERRM);
  RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
    'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', SQLERRM)));
END;
$$;

REVOKE ALL ON FUNCTION public.enregistrer_prix_manuel_core(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enregistrer_prix_manuel_core(JSONB)
  TO authenticated;

-- ==================================================================
-- enregistrer_ticket_core — chemin scan / OCR (ImportTicketSheet)
-- ==================================================================
CREATE OR REPLACE FUNCTION public.enregistrer_ticket_core(p_ticket JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_utilisateur_id   UUID := auth.uid();
  v_store_legacy_id  UUID;
  v_magasin_texte    TEXT;
  v_date_ticket      DATE;
  v_montant_total    NUMERIC;
  v_magasin_id       UUID;
  v_ticket_id        UUID;
  v_lignes           JSONB;
  v_ligne            JSONB;
  v_libelle_brut     TEXT;
  v_quantite         NUMERIC;
  v_prix_unitaire    NUMERIC;
  v_prix_ligne_total NUMERIC;
  v_montant_ligne    NUMERIC;
  v_produit_id       UUID;
  v_variante_id      UUID;
  v_ligne_ticket_id  UUID;
  v_prix_ecrits      INTEGER := 0;
  v_rejets           JSONB := '[]'::jsonb;
BEGIN
  IF v_utilisateur_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  BEGIN
    v_store_legacy_id := NULLIF(p_ticket->>'store_legacy_id', '')::UUID;
    v_magasin_texte    := p_ticket->>'magasin_texte';
    v_date_ticket      := NULLIF(p_ticket->>'date_ticket', '')::DATE;
    v_montant_total    := NULLIF(p_ticket->>'montant_total', '')::NUMERIC;
    v_lignes           := COALESCE(p_ticket->'lignes', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, message_erreur)
    VALUES (v_utilisateur_id, 'scan', 'erreur_technique', p_ticket, SQLERRM);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', SQLERRM)));
  END;

  -- Résolution magasin : un seul essai pour tout le ticket. Si NULL, rien
  -- n'est écrit (ni ticket, ni lignes_ticket, ni prix) — un seul rejet.
  v_magasin_id := public.resoudre_magasin_core(NULL, v_store_legacy_id, v_magasin_texte);
  IF v_magasin_id IS NULL THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte)
    VALUES (v_utilisateur_id, 'scan', 'magasin_non_resolu', p_ticket, v_store_legacy_id, v_magasin_texte);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'magasin_non_resolu')));
  END IF;

  -- ⚠️ PAS DE DÉDUPLICATION : `empreinte` (utilisée par la contrainte
  -- uq_tickets_utilisateur_empreinte) reste NULL ici — deux NULL ne se
  -- bloquent jamais mutuellement dans une contrainte UNIQUE, donc un même
  -- ticket scanné deux fois créera deux lignes distinctes. Décision #56.3a
  -- (François, 7 juillet 2026) : accepté pour l'instant, shadow en cercle
  -- restreint (François + 2 bêta-testeurs), risque de doublon jugé
  -- acceptable à ce stade. La déduplication par empreinte sera traitée
  -- avant la bascule visible, probablement #56.6/#56.7 — ne pas l'oublier.
  INSERT INTO public.tickets (utilisateur_id, magasin_id, date_ticket, montant_total, statut_traitement)
  VALUES (v_utilisateur_id, v_magasin_id, v_date_ticket, v_montant_total, 'termine')
  RETURNING id INTO v_ticket_id;

  -- Chaque ligne est créée dans lignes_ticket dans tous les cas (schéma déjà
  -- prévu pour un produit_id NULL). Le prix, lui, n'est créé QUE si l'alias
  -- est résolu — les lignes non résolues n'interrompent pas les suivantes.
  FOR v_ligne IN SELECT * FROM jsonb_array_elements(v_lignes)
  LOOP
    v_libelle_brut     := v_ligne->>'libelle_brut';
    v_quantite         := COALESCE(NULLIF(v_ligne->>'quantite', '')::NUMERIC, 1);
    v_prix_unitaire    := NULLIF(v_ligne->>'prix_unitaire', '')::NUMERIC;
    v_prix_ligne_total := NULLIF(v_ligne->>'prix_total', '')::NUMERIC;

    IF v_libelle_brut IS NULL OR btrim(v_libelle_brut) = '' THEN
      INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, message_erreur)
      VALUES (v_utilisateur_id, 'scan', 'erreur_technique', v_ligne, v_store_legacy_id, v_magasin_texte, 'libelle_brut manquant sur une ligne');
      v_rejets := v_rejets || jsonb_build_object('motif', 'erreur_technique', 'message', 'libelle_brut manquant');
      CONTINUE;
    END IF;

    SELECT produit_id, variante_produit_id INTO v_produit_id, v_variante_id
    FROM public.resoudre_alias_core(v_libelle_brut);

    -- lignes_ticket.statut_validation_produit/variante : 'valide'/'automatique'
    -- si l'alias a résolu un produit (même logique que la validation humaine
    -- de corriger_association_ligne_ticket, PHASE_9, avec methode='automatique'
    -- au lieu de 'humaine') ; sinon 'non_valide'/'non_validee', valeurs par
    -- défaut du schéma. Interprétation #56.3a : aucune instruction explicite
    -- ne fixait ce détail, à revalider si besoin.
    INSERT INTO public.lignes_ticket (
      ticket_id, libelle_brut, produit_id, variante_produit_id,
      statut_validation_produit, methode_validation_produit, produit_valide_le,
      statut_validation_variante, methode_validation_variante, variante_validee_le,
      quantite, prix_unitaire, montant_net
    ) VALUES (
      v_ticket_id, v_libelle_brut, v_produit_id, v_variante_id,
      CASE WHEN v_produit_id IS NOT NULL THEN 'valide' ELSE 'non_valide' END,
      CASE WHEN v_produit_id IS NOT NULL THEN 'automatique' ELSE NULL END,
      CASE WHEN v_produit_id IS NOT NULL THEN now() ELSE NULL END,
      CASE WHEN v_variante_id IS NOT NULL THEN 'validee' ELSE 'non_validee' END,
      CASE WHEN v_variante_id IS NOT NULL THEN 'automatique' ELSE NULL END,
      CASE WHEN v_variante_id IS NOT NULL THEN now() ELSE NULL END,
      v_quantite, v_prix_unitaire, v_prix_ligne_total
    ) RETURNING id INTO v_ligne_ticket_id;

    IF v_produit_id IS NULL THEN
      INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, libelle_non_resolu)
      VALUES (v_utilisateur_id, 'scan', 'alias_non_trouve', v_ligne, v_store_legacy_id, v_magasin_texte, v_libelle_brut);
      v_rejets := v_rejets || jsonb_build_object('motif', 'alias_non_trouve', 'libelle', v_libelle_brut);
      CONTINUE;
    END IF;

    v_montant_ligne := COALESCE(v_prix_ligne_total, v_prix_unitaire * v_quantite);
    IF v_montant_ligne IS NULL OR v_montant_ligne < 0 THEN
      INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, libelle_non_resolu, message_erreur)
      VALUES (v_utilisateur_id, 'scan', 'erreur_technique', v_ligne, v_store_legacy_id, v_magasin_texte, v_libelle_brut, 'prix de ligne manquant ou négatif');
      v_rejets := v_rejets || jsonb_build_object('motif', 'erreur_technique', 'message', 'prix de ligne manquant ou négatif');
      CONTINUE;
    END IF;

    INSERT INTO public.prix (
      produit_id, variante_produit_id, magasin_id, utilisateur_id, ligne_ticket_id,
      prix_total, source, statut_validation, valide_le, observe_le
    ) VALUES (
      v_produit_id, v_variante_id, v_magasin_id, v_utilisateur_id, v_ligne_ticket_id,
      v_montant_ligne, 'ticket', 'en_attente', NULL, now()
    );
    v_prix_ecrits := v_prix_ecrits + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'statut', CASE WHEN jsonb_array_length(v_rejets) = 0 THEN 'ok' ELSE 'rejet_partiel' END,
    'prix_ecrits', v_prix_ecrits,
    'rejets', v_rejets
  );

EXCEPTION WHEN OTHERS THEN
  -- Filet de sécurité global : toute erreur inattendue en cours de boucle
  -- annule TOUT le ticket (ticket + lignes_ticket + prix déjà insérés dans
  -- cet appel, y compris les lignes traitées avec succès avant l'incident),
  -- et journalise un seul rejet 'erreur_technique' pour le ticket entier.
  -- C'est un choix de sécurité pour cette première passe (tout ou rien face
  -- à l'imprévu) — pas une garantie de traitement ligne par ligne totalement
  -- indépendant en cas de bug technique. Les rejets 'alias_non_trouve' et
  -- 'magasin_non_resolu' ci-dessus, eux, sont des cas ATTENDUS et ne
  -- déclenchent jamais ce filet : les autres lignes continuent normalement.
  INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, message_erreur)
  VALUES (v_utilisateur_id, 'scan', 'erreur_technique', p_ticket, SQLERRM);
  RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
    'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', SQLERRM)));
END;
$$;

REVOKE ALL ON FUNCTION public.enregistrer_ticket_core(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enregistrer_ticket_core(JSONB)
  TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT — à tester avec un compte authenticated réel (pas la clé anon)
-- =============================================================================
-- Cas magasin non résolu (un des 3 stores sans équivalent Core) :
-- SELECT public.enregistrer_prix_manuel_core('{
--   "store_legacy_id": "c316a421-e5a6-49b7-ae56-a18140ab8fe2",
--   "magasin_texte": "Magasin test",
--   "libelle_produit": "Lait demi-écrémé",
--   "prix_total": 1.15
-- }'::jsonb);
-- -- Attendu : {"statut":"rejet","prix_ecrits":0,"rejets":[{"motif":"magasin_non_resolu"}]}
-- -- et une ligne dans rejets_ecriture_core (motif='magasin_non_resolu').
--
-- SELECT count(*) FROM public.rejets_ecriture_core WHERE motif = 'magasin_non_resolu';
-- SELECT count(*) FROM public.prix WHERE source = 'manuel';
-- -- Attendu : 0 (rien écrit dans prix pour le cas ci-dessus)
-- =============================================================================
