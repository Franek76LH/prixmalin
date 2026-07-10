-- ============================================================
-- PHASE 13 — Conservation du libellé réel du ticket (#68)
-- Préparé le 10 juillet 2026, à exécuter manuellement par François après relecture
-- Dépend de : PHASE_4 (lignes_ticket), PHASE_12_b (rejets_ecriture_core),
--             PHASE_12_d (RPC enregistrer_ticket_core / enregistrer_prix_manuel_core)
-- ============================================================
-- Objectif #68 : l'IA OCR de scan-ticket interprète parfois le libellé
-- imprimé sur le ticket (ex: "6X1L BP LT MONT UH" → "Bière blonde" au lieu
-- de lait). Le texte réellement imprimé n'était conservé nulle part.
--
-- Ce script :
--   1. ajoute lignes_ticket.libelle_ticket (nullable, texte OCR brut/visible)
--      sans renommer ni toucher à libelle_brut (toujours le libellé
--      interprété, toujours utilisé par le matching d'alias) ;
--   2. étend enregistrer_ticket_core pour lire libelle_ticket dans chaque
--      ligne JSON si présent et l'insérer dans lignes_ticket.libelle_ticket ;
--      aucun changement de matching (resoudre_alias_core continue de
--      travailler sur libelle_brut) ;
--   3. ne crée AUCUNE colonne sur rejets_ecriture_core : le payload JSONB
--      existant stocke déjà la ligne JSON complète (v_ligne) pour le motif
--      alias_non_trouve, donc libelle_ticket y apparaît automatiquement dès
--      que le client l'envoie dans lignes[] — décision Étape 0 (Option B) ;
--   4. corrige le filet de sécurité sur rejets_ecriture_core.traite : la
--      colonne a déjà DEFAULT false et aucun INSERT existant ne précisait
--      traite, donc la valeur par défaut s'appliquait déjà correctement.
--      Par prudence (incident id 28 constaté le 10/07, cause non identifiée
--      dans le code, considéré comme un tap accidentel côté panneau admin),
--      ce script rend traite=false EXPLICITE dans tous les INSERT INTO
--      rejets_ecriture_core des deux RPC, en plus du DEFAULT déjà correct.
-- ============================================================

BEGIN;

-- ==================================================================
-- 1. lignes_ticket.libelle_ticket
-- ==================================================================
ALTER TABLE public.lignes_ticket
ADD COLUMN IF NOT EXISTS libelle_ticket text;

COMMENT ON COLUMN public.lignes_ticket.libelle_brut IS
'Libellé interprété/normalisé par l''IA OCR, utilisé par le matching Core actuel. Ne correspond pas nécessairement au texte imprimé sur le ticket.';

COMMENT ON COLUMN public.lignes_ticket.libelle_ticket IS
'Texte OCR brut/visible recopié depuis le ticket scanné, sans reformulation volontaire. Peut être NULL pour les anciennes lignes ou la saisie manuelle.';

-- ==================================================================
-- 2. enregistrer_prix_manuel_core — traite=false explicite uniquement
--    (chemin manuel, pas de libelle_ticket ici : PriceEntrySheet n'a pas
--    de texte ticket à recopier, hors périmètre #68 pour la saisie
--    manuelle).
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
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, message_erreur, traite)
    VALUES (v_utilisateur_id, 'manuel', 'erreur_technique', p_prix, SQLERRM, false);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', SQLERRM)));
  END;

  IF v_libelle_produit IS NULL OR btrim(v_libelle_produit) = '' THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, message_erreur, traite)
    VALUES (v_utilisateur_id, 'manuel', 'erreur_technique', p_prix, v_store_legacy_id, v_magasin_texte, 'libelle_produit manquant', false);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', 'libelle_produit manquant')));
  END IF;

  IF v_prix_total IS NULL OR v_prix_total < 0 THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, message_erreur, traite)
    VALUES (v_utilisateur_id, 'manuel', 'erreur_technique', p_prix, v_store_legacy_id, v_magasin_texte, 'prix_total manquant ou négatif', false);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', 'prix_total manquant ou négatif')));
  END IF;

  -- Résolution magasin : pas de p_magasin_id direct dans ce payload.
  v_magasin_id := public.resoudre_magasin_core(NULL, v_store_legacy_id, v_magasin_texte);
  IF v_magasin_id IS NULL THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, traite)
    VALUES (v_utilisateur_id, 'manuel', 'magasin_non_resolu', p_prix, v_store_legacy_id, v_magasin_texte, false);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'magasin_non_resolu')));
  END IF;

  -- Résolution alias : libelle_produit est le SEUL champ utilisé (décision #56.3a).
  SELECT produit_id, variante_produit_id INTO v_produit_id, v_variante_produit_id
  FROM public.resoudre_alias_core(v_libelle_produit);

  IF v_produit_id IS NULL THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, libelle_non_resolu, traite)
    VALUES (v_utilisateur_id, 'manuel', 'alias_non_trouve', p_prix, v_store_legacy_id, v_magasin_texte, v_libelle_produit, false);
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
  INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, message_erreur, traite)
  VALUES (v_utilisateur_id, 'manuel', 'erreur_technique', p_prix, SQLERRM, false);
  RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
    'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', SQLERRM)));
END;
$$;

-- ==================================================================
-- 3. enregistrer_ticket_core — lecture/insertion de libelle_ticket +
--    traite=false explicite. Aucun changement de matching : la résolution
--    d'alias continue d'utiliser exclusivement v_libelle_brut.
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
  v_libelle_ticket   TEXT;
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
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, message_erreur, traite)
    VALUES (v_utilisateur_id, 'scan', 'erreur_technique', p_ticket, SQLERRM, false);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', SQLERRM)));
  END;

  -- Résolution magasin : un seul essai pour tout le ticket. Si NULL, rien
  -- n'est écrit (ni ticket, ni lignes_ticket, ni prix) — un seul rejet.
  v_magasin_id := public.resoudre_magasin_core(NULL, v_store_legacy_id, v_magasin_texte);
  IF v_magasin_id IS NULL THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, traite)
    VALUES (v_utilisateur_id, 'scan', 'magasin_non_resolu', p_ticket, v_store_legacy_id, v_magasin_texte, false);
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
    -- #68 — texte OCR brut/visible du ticket, si le client le transmet.
    -- N'intervient dans AUCUNE résolution d'alias : uniquement conservé
    -- pour audit/#67 futur. NULL accepté (anciens payloads, saisie sans
    -- ce champ) : lignes_ticket.libelle_ticket reste nullable.
    v_libelle_ticket   := v_ligne->>'libelle_ticket';
    v_quantite         := COALESCE(NULLIF(v_ligne->>'quantite', '')::NUMERIC, 1);
    v_prix_unitaire    := NULLIF(v_ligne->>'prix_unitaire', '')::NUMERIC;
    v_prix_ligne_total := NULLIF(v_ligne->>'prix_total', '')::NUMERIC;

    IF v_libelle_brut IS NULL OR btrim(v_libelle_brut) = '' THEN
      INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, message_erreur, traite)
      VALUES (v_utilisateur_id, 'scan', 'erreur_technique', v_ligne, v_store_legacy_id, v_magasin_texte, 'libelle_brut manquant sur une ligne', false);
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
      ticket_id, libelle_brut, libelle_ticket, produit_id, variante_produit_id,
      statut_validation_produit, methode_validation_produit, produit_valide_le,
      statut_validation_variante, methode_validation_variante, variante_validee_le,
      quantite, prix_unitaire, montant_net
    ) VALUES (
      v_ticket_id, v_libelle_brut, v_libelle_ticket, v_produit_id, v_variante_id,
      CASE WHEN v_produit_id IS NOT NULL THEN 'valide' ELSE 'non_valide' END,
      CASE WHEN v_produit_id IS NOT NULL THEN 'automatique' ELSE NULL END,
      CASE WHEN v_produit_id IS NOT NULL THEN now() ELSE NULL END,
      CASE WHEN v_variante_id IS NOT NULL THEN 'validee' ELSE 'non_validee' END,
      CASE WHEN v_variante_id IS NOT NULL THEN 'automatique' ELSE NULL END,
      CASE WHEN v_variante_id IS NOT NULL THEN now() ELSE NULL END,
      v_quantite, v_prix_unitaire, v_prix_ligne_total
    ) RETURNING id INTO v_ligne_ticket_id;

    IF v_produit_id IS NULL THEN
      -- payload = v_ligne (objet JSON complet de la ligne) : si le client a
      -- envoyé libelle_ticket dans lignes[], il est déjà présent ici sans
      -- colonne dédiée sur rejets_ecriture_core (Étape 0, Option B, #68).
      INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, libelle_non_resolu, traite)
      VALUES (v_utilisateur_id, 'scan', 'alias_non_trouve', v_ligne, v_store_legacy_id, v_magasin_texte, v_libelle_brut, false);
      v_rejets := v_rejets || jsonb_build_object('motif', 'alias_non_trouve', 'libelle', v_libelle_brut);
      CONTINUE;
    END IF;

    v_montant_ligne := COALESCE(v_prix_ligne_total, v_prix_unitaire * v_quantite);
    IF v_montant_ligne IS NULL OR v_montant_ligne < 0 THEN
      INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, libelle_non_resolu, message_erreur, traite)
      VALUES (v_utilisateur_id, 'scan', 'erreur_technique', v_ligne, v_store_legacy_id, v_magasin_texte, v_libelle_brut, 'prix de ligne manquant ou négatif', false);
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
  INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, message_erreur, traite)
  VALUES (v_utilisateur_id, 'scan', 'erreur_technique', p_ticket, SQLERRM, false);
  RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
    'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', SQLERRM)));
END;
$$;

COMMIT;

-- =============================================================================
-- CHECKPOINT — à tester avec un compte authenticated réel (pas la clé anon)
-- =============================================================================
-- 1. Colonne ajoutée, anciennes lignes non affectées :
-- SELECT count(*) FROM public.lignes_ticket WHERE libelle_ticket IS NOT NULL;
-- -- Attendu juste après migration : 0 (aucune ligne existante rétroactivement remplie)
--
-- 2. Propagation libelle_ticket sur une ligne résolue :
-- SELECT public.enregistrer_ticket_core('{
--   "store_legacy_id": null,
--   "magasin_texte": "Carrefour Bonneveine",
--   "date_ticket": "2026-07-10",
--   "montant_total": 1.15,
--   "lignes": [
--     {"libelle_brut": "Lait demi-écrémé", "libelle_ticket": "6X1L BP LT MONT UH", "quantite": 1, "prix_unitaire": 1.15, "prix_total": 1.15}
--   ]
-- }'::jsonb);
-- SELECT libelle_brut, libelle_ticket FROM public.lignes_ticket ORDER BY cree_le DESC LIMIT 1;
-- -- Attendu : libelle_brut = 'Lait demi-écrémé', libelle_ticket = '6X1L BP LT MONT UH'
--
-- 3. Rejet alias_non_trouve conserve libelle_ticket dans payload :
-- SELECT payload->>'libelle_ticket', libelle_non_resolu, traite
-- FROM public.rejets_ecriture_core WHERE motif = 'alias_non_trouve' ORDER BY cree_le DESC LIMIT 1;
-- -- Attendu : payload->>'libelle_ticket' = le texte ticket envoyé, traite = false
--
-- 4. Tout nouveau rejet naît à traite=false, y compris sans libelle_ticket :
-- SELECT motif, traite FROM public.rejets_ecriture_core ORDER BY cree_le DESC LIMIT 5;
-- -- Attendu : traite = false pour toutes les lignes fraîchement créées
-- =============================================================================
