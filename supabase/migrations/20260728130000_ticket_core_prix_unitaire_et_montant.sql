-- Chantier 75 — Ticket fidèle + comparateur au prix unitaire.
--
-- Deux rôles distincts, corrigés ici dans enregistrer_ticket_core :
--   1. lignes_ticket = photocopie fidèle du ticket : on stocke désormais le
--      MONTANT de la ligne (montant_net = PU × Qté) — avant il valait
--      v_prix_ligne_total, envoyé NULL par le front lors d'un scan, donc le
--      total de ligne n'était stocké nulle part (ex. Jambon 3×2,29 : montant
--      6,87 perdu).
--   2. prix (comparateur) = prix d'UN SEUL article = le prix unitaire. Avant,
--      prix.prix_total valait v_montant_ligne (= PU × Qté), donc le TOTAL de
--      la ligne : Jambon écrivait 6,87 au lieu de 2,29, Lardons 6,18 au lieu
--      de 3,09. Corrigé : prix.prix_total = v_prix_unitaire.
--
-- Rien d'autre n'est modifié dans la fonction (résolution magasin/alias,
-- rejets, statuts, méthode #73...). Les prix restent créés en 'en_attente'
-- comme avant. Aucun prix existant n'est recalculé par cette migration : elle
-- ne redéfinit que la fonction, elle ne touche aucune donnée. Les lignes déjà
-- écrites (dont les 8 prix de ce ticket) restent inchangées — re-scan requis
-- pour les corriger.

CREATE OR REPLACE FUNCTION public.enregistrer_ticket_core(p_ticket jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_nb_exact         INTEGER;   -- #73
  v_methode          TEXT;      -- #73
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

  v_magasin_id := public.resoudre_magasin_core(NULL, v_store_legacy_id, v_magasin_texte);
  IF v_magasin_id IS NULL THEN
    INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, traite)
    VALUES (v_utilisateur_id, 'scan', 'magasin_non_resolu', p_ticket, v_store_legacy_id, v_magasin_texte, false);
    RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
      'rejets', jsonb_build_array(jsonb_build_object('motif', 'magasin_non_resolu')));
  END IF;

  -- PAS DE DEDUPLICATION (empreinte NULL) : decision #56.3a, inchange.
  INSERT INTO public.tickets (utilisateur_id, magasin_id, date_ticket, montant_total, statut_traitement)
  VALUES (v_utilisateur_id, v_magasin_id, v_date_ticket, v_montant_total, 'termine')
  RETURNING id INTO v_ticket_id;

  FOR v_ligne IN SELECT * FROM jsonb_array_elements(v_lignes)
  LOOP
    v_libelle_brut     := v_ligne->>'libelle_brut';
    v_libelle_ticket   := v_ligne->>'libelle_ticket';
    v_quantite         := COALESCE(NULLIF(v_ligne->>'quantite', '')::NUMERIC, 1);
    v_prix_unitaire    := NULLIF(v_ligne->>'prix_unitaire', '')::NUMERIC;
    v_prix_ligne_total := NULLIF(v_ligne->>'prix_total', '')::NUMERIC;

    -- Chantier 75 — le prix unitaire est le prix d'UN SEUL article. Si le
    -- front n'envoie que le total de ligne (cas manuel/legacy), on le derive.
    IF v_prix_unitaire IS NULL AND v_prix_ligne_total IS NOT NULL AND v_quantite > 0 THEN
      v_prix_unitaire := v_prix_ligne_total / v_quantite;
    END IF;

    -- Chantier 75 — montant de la ligne = total (photocopie fidele du ticket,
    -- PU x Qte). Prefere un total explicite, sinon le recalcule.
    v_montant_ligne := COALESCE(v_prix_ligne_total, v_prix_unitaire * v_quantite);

    IF v_libelle_brut IS NULL OR btrim(v_libelle_brut) = '' THEN
      INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, message_erreur, traite)
      VALUES (v_utilisateur_id, 'scan', 'erreur_technique', v_ligne, v_store_legacy_id, v_magasin_texte, 'libelle_brut manquant sur une ligne', false);
      v_rejets := v_rejets || jsonb_build_object('motif', 'erreur_technique', 'message', 'libelle_brut manquant');
      CONTINUE;
    END IF;

    SELECT produit_id, variante_produit_id INTO v_produit_id, v_variante_id
    FROM public.resoudre_alias_core(v_libelle_brut);

    -- #73 : distinguer 'auto_scan' (rattrape par la normalisation) de
    -- 'automatique' (deja resolu par l'ancienne regle accents/casse).
    IF v_produit_id IS NOT NULL THEN
      SELECT count(*) INTO v_nb_exact
      FROM public.alias_produits a
      WHERE a.statut = 'actif'
        AND lower(extensions.unaccent(a.libelle_alias)) = lower(extensions.unaccent(v_libelle_brut));
      v_methode := CASE WHEN v_nb_exact = 1 THEN 'automatique' ELSE 'auto_scan' END;
    ELSE
      v_methode := NULL;
    END IF;

    INSERT INTO public.lignes_ticket (
      ticket_id, libelle_brut, libelle_ticket, produit_id, variante_produit_id,
      statut_validation_produit, methode_validation_produit, produit_valide_le,
      statut_validation_variante, methode_validation_variante, variante_validee_le,
      quantite, prix_unitaire, montant_net
    ) VALUES (
      v_ticket_id, v_libelle_brut, v_libelle_ticket, v_produit_id, v_variante_id,
      CASE WHEN v_produit_id IS NOT NULL THEN 'valide' ELSE 'non_valide' END,
      v_methode,
      CASE WHEN v_produit_id IS NOT NULL THEN now() ELSE NULL END,
      CASE WHEN v_variante_id IS NOT NULL THEN 'validee' ELSE 'non_validee' END,
      CASE WHEN v_variante_id IS NOT NULL THEN v_methode ELSE NULL END,
      CASE WHEN v_variante_id IS NOT NULL THEN now() ELSE NULL END,
      v_quantite, v_prix_unitaire, v_montant_ligne
    ) RETURNING id INTO v_ligne_ticket_id;

    IF v_produit_id IS NULL THEN
      INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, libelle_non_resolu, traite)
      VALUES (v_utilisateur_id, 'scan', 'alias_non_trouve', v_ligne, v_store_legacy_id, v_magasin_texte, v_libelle_brut, false);
      v_rejets := v_rejets || jsonb_build_object('motif', 'alias_non_trouve', 'libelle', v_libelle_brut);
      CONTINUE;
    END IF;

    -- Chantier 75 — garde-fou sur le PRIX UNITAIRE (ce qui va dans prix).
    IF v_prix_unitaire IS NULL OR v_prix_unitaire < 0 THEN
      INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, store_legacy_id, magasin_texte, libelle_non_resolu, message_erreur, traite)
      VALUES (v_utilisateur_id, 'scan', 'erreur_technique', v_ligne, v_store_legacy_id, v_magasin_texte, v_libelle_brut, 'prix unitaire manquant ou negatif', false);
      v_rejets := v_rejets || jsonb_build_object('motif', 'erreur_technique', 'message', 'prix unitaire manquant ou negatif');
      CONTINUE;
    END IF;

    -- Chantier 75 — comparateur : on stocke le PRIX UNITAIRE (un seul
    -- article), plus jamais le total de la ligne.
    INSERT INTO public.prix (
      produit_id, variante_produit_id, magasin_id, utilisateur_id, ligne_ticket_id,
      prix_total, source, statut_validation, valide_le, observe_le
    ) VALUES (
      v_produit_id, v_variante_id, v_magasin_id, v_utilisateur_id, v_ligne_ticket_id,
      v_prix_unitaire, 'ticket', 'en_attente', NULL, now()
    );
    v_prix_ecrits := v_prix_ecrits + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'statut', CASE WHEN jsonb_array_length(v_rejets) = 0 THEN 'ok' ELSE 'rejet_partiel' END,
    'prix_ecrits', v_prix_ecrits,
    'rejets', v_rejets
  );

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.rejets_ecriture_core (user_id, source, motif, payload, message_erreur, traite)
  VALUES (v_utilisateur_id, 'scan', 'erreur_technique', p_ticket, SQLERRM, false);
  RETURN jsonb_build_object('statut', 'rejet', 'prix_ecrits', 0,
    'rejets', jsonb_build_array(jsonb_build_object('motif', 'erreur_technique', 'message', SQLERRM)));
END;
$function$;
