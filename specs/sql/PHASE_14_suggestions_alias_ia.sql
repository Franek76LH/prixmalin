-- ============================================================
-- PHASE 14 — Suggestions d'alias Core par IA (#67 v1)
-- Préparé le 13 juillet 2026, à exécuter manuellement par François après relecture
-- Dépend de : PHASE_1 (produits, variantes_produit, alias_produits, marques),
--             PHASE_12_b (rejets_ecriture_core), PHASE_12_c (resoudre_magasin_core),
--             extensions.pg_trgm, extensions.unaccent (PHASE_0, confirmées en base)
-- ============================================================
-- Étape 0 (lecture seule) a établi que la table suggestions_alias_produit
-- (PHASE_4/PHASE_9, #55) existe déjà mais sert un usage différent : proposition
-- par un UTILISATEUR lors de la correction d'une ligne de SON ticket déjà en
-- base (ligne_ticket_id NOT NULL, produit_id NOT NULL — incompatible avec le
-- cas "produit inconnu du référentiel" et avec l'absence de ligne_ticket_id
-- côté rejets_ecriture_core). Cette table n'est appelée nulle part dans le
-- front actuel (confirmé par grep) — non touchée par ce script.
--
-- Vérifications demandées par François avant ce script :
--   - alias_produits.origine CHECK admet déjà 'manuel','ia','utilisateur_valide'
--     → 'ia' est déjà une valeur valide, AUCUNE modification de contrainte
--     nécessaire sur alias_produits.
--   - alias_produits.statut CHECK admet déjà 'actif','en_attente','rejete'
--     → 'actif' déjà valide, AUCUNE modification nécessaire.
--   - La table public.marques existe bien (PHASE_1, colonne "nom") et est
--     utilisée telle quelle par rechercher_candidats_core ci-dessous.
-- Aucun ALTER sur alias_produits ou marques dans ce script.
--
-- Rappel #67 : rejets_ecriture_core n'a pas de colonne ligne_ticket_id (jamais
-- eu). Le prix rétroactif écrit par valider_suggestion_alias_core a donc
-- ligne_ticket_id = NULL — pattern déjà existant et normal (identique à
-- enregistrer_prix_manuel_core, PHASE_12_d), pas une régression introduite ici.
-- Aucune trace dans historique_corrections_association (ligne_ticket_id y est
-- NOT NULL, incompatible) : l'audit de #67 repose entièrement sur la table
-- ci-dessous (rejet_ecriture_core_id, produit_id choisi, decide_par, decide_le).
--
-- Corrections apportées après relecture de François (13 juillet 2026) :
--   1. rechercher_candidats_core : le LIMIT portait sur le résultat trié par
--      (p.id, vp.id) à cause de DISTINCT ON, pas par score — corrigé en
--      enveloppant le DISTINCT ON dans une sous-requête, tri par score DESC
--      et LIMIT appliqués seulement dans la requête externe, plus un filtre
--      score > 0.1 pour ne jamais envoyer de candidats sans rapport à l'IA.
--   2. valider_suggestion_alias_core : source du prix rétroactif était 'ticket'
--      en dur — corrigé pour reprendre v_rejet.source ('manuel' -> 'manuel',
--      sinon 'ticket'). prix.source CHECK (PHASE_4) admet bien 'manuel'.
--   3. refuser_suggestion_alias_core : p_commentaire était déclaré mais jamais
--      stocké — ajout de la colonne commentaire_decision, renseignée par le
--      refus (et laissée NULL pour une validation, qui n'a pas de commentaire).
-- ============================================================

BEGIN;

-- ==================================================================
-- 1. Table suggestions_alias_core_ia
-- ==================================================================
CREATE TABLE public.suggestions_alias_core_ia (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rejet_ecriture_core_id  BIGINT NOT NULL UNIQUE
                          REFERENCES public.rejets_ecriture_core(id) ON DELETE CASCADE,
  libelle_source          TEXT NOT NULL,
  produit_id              UUID REFERENCES public.produits(id) ON DELETE RESTRICT,
  variante_produit_id     UUID,
  score_confiance         SMALLINT CHECK (score_confiance BETWEEN 0 AND 100),
  raison_ia               TEXT,
  resultat                TEXT NOT NULL CHECK (
    resultat IN ('suggestion', 'produit_inconnu_du_referentiel')
  ),
  statut                  TEXT NOT NULL DEFAULT 'en_attente' CHECK (
    statut IN ('en_attente', 'validee', 'refusee')
  ),
  -- V1 : seule 'ia' est utilisée. 'utilisateur'/'utilisateur_ean' préparés
  -- pour une V2 non implémentée ici (aucun scan EAN, aucune auto-validation).
  origine                 TEXT NOT NULL DEFAULT 'ia' CHECK (
    origine IN ('ia', 'utilisateur', 'utilisateur_ean')
  ),
  code_ean                TEXT,
  modele_ia               TEXT,
  prompt_version          TEXT,
  cree_par                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cree_le                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  decide_par              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decide_le               TIMESTAMPTZ,
  commentaire_decision    TEXT,

  CONSTRAINT suggestions_ia_libelle_non_vide
    CHECK (length(btrim(libelle_source)) > 0),
  CONSTRAINT fk_suggestions_ia_variante_produit
    FOREIGN KEY (variante_produit_id, produit_id)
    REFERENCES public.variantes_produit(id, produit_id) ON DELETE RESTRICT,
  CONSTRAINT suggestions_ia_produit_coherent CHECK (
    (resultat = 'suggestion' AND produit_id IS NOT NULL)
    OR
    (resultat = 'produit_inconnu_du_referentiel' AND produit_id IS NULL AND variante_produit_id IS NULL)
  ),
  CONSTRAINT suggestions_ia_decision_coherente CHECK (
    (statut = 'en_attente' AND decide_le IS NULL AND decide_par IS NULL)
    OR
    (statut IN ('validee', 'refusee') AND decide_le IS NOT NULL)
  )
);

CREATE INDEX idx_suggestions_ia_statut
  ON public.suggestions_alias_core_ia(statut);

ALTER TABLE public.suggestions_alias_core_ia ENABLE ROW LEVEL SECURITY;

CREATE POLICY suggestions_ia_lecture_admin
  ON public.suggestions_alias_core_ia FOR SELECT TO authenticated
  USING (public.est_administrateur());

-- Aucun GRANT INSERT/UPDATE/DELETE à authenticated : tout passe par les RPC
-- SECURITY DEFINER ci-dessous, pour ne jamais permettre un changement de
-- statut sans les effets liés (alias créé, rejet marqué traité, prix écrit).
REVOKE ALL ON TABLE public.suggestions_alias_core_ia FROM anon, authenticated;
GRANT SELECT ON TABLE public.suggestions_alias_core_ia TO authenticated;

-- ==================================================================
-- 2. lister_rejets_alias_eligibles — rejets à traiter par le bouton IA
-- ==================================================================
CREATE OR REPLACE FUNCTION public.lister_rejets_alias_eligibles(p_limite INTEGER DEFAULT 25)
RETURNS SETOF public.rejets_ecriture_core
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.est_administrateur() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  RETURN QUERY
  SELECT r.*
  FROM public.rejets_ecriture_core r
  WHERE r.motif = 'alias_non_trouve'
    AND r.traite = false
    AND NOT EXISTS (
      SELECT 1 FROM public.suggestions_alias_core_ia s
      WHERE s.rejet_ecriture_core_id = r.id
    )
  ORDER BY r.cree_le ASC
  LIMIT GREATEST(p_limite, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.lister_rejets_alias_eligibles(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lister_rejets_alias_eligibles(INTEGER)
  TO authenticated;

-- ==================================================================
-- 3. rechercher_candidats_core — shortlist déterministe (pg_trgm) pour l'IA
-- ==================================================================
CREATE OR REPLACE FUNCTION public.rechercher_candidats_core(
  p_libelle TEXT,
  p_limite INTEGER DEFAULT 15
)
RETURNS TABLE(
  produit_id UUID,
  variante_produit_id UUID,
  nom_reference TEXT,
  marque TEXT,
  libelle_variante TEXT,
  score REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.est_administrateur() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Le DISTINCT ON (p.id, vp.id) impose que la requête interne trie d'abord
  -- par (p.id, vp.id) — un LIMIT à ce niveau tronquerait donc par identifiant,
  -- pas par pertinence. On isole ce dédoublonnage dans une sous-requête, puis
  -- on trie par score DESC et on applique LIMIT seulement dans la requête
  -- externe, sur le résultat déjà dédoublonné.
  RETURN QUERY
  SELECT c.produit_id, c.variante_produit_id, c.nom_reference, c.marque, c.libelle_variante, c.score
  FROM (
    SELECT DISTINCT ON (p.id, vp.id)
      p.id AS produit_id,
      vp.id AS variante_produit_id,
      p.nom_reference,
      m.nom AS marque,
      vp.libelle AS libelle_variante,
      GREATEST(
        extensions.similarity(lower(extensions.unaccent(p.nom_reference)), lower(extensions.unaccent(coalesce(p_libelle, '')))),
        extensions.similarity(lower(extensions.unaccent(coalesce(vp.libelle, ''))), lower(extensions.unaccent(coalesce(p_libelle, '')))),
        extensions.similarity(lower(extensions.unaccent(a.libelle_alias)), lower(extensions.unaccent(coalesce(p_libelle, ''))))
      ) AS score
    FROM public.produits p
    LEFT JOIN public.variantes_produit vp ON vp.produit_id = p.id AND vp.actif = TRUE
    LEFT JOIN public.marques m ON m.id = vp.marque_id
    LEFT JOIN public.alias_produits a ON a.produit_id = p.id AND a.statut = 'actif'
    WHERE p.actif = TRUE
    ORDER BY p.id, vp.id, score DESC
  ) c
  -- Filtre de pertinence minimale : ne jamais envoyer à l'IA un candidat sans
  -- aucun rapport avec le libellé (bruit inutile, coût de prompt inutile).
  WHERE c.score > 0.1
  ORDER BY c.score DESC
  LIMIT GREATEST(p_limite, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.rechercher_candidats_core(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rechercher_candidats_core(TEXT, INTEGER)
  TO authenticated;

-- ==================================================================
-- 4. enregistrer_suggestion_alias_core_ia — persistance d'un résultat IA
-- ==================================================================
CREATE OR REPLACE FUNCTION public.enregistrer_suggestion_alias_core_ia(
  p_rejet_id BIGINT,
  p_libelle_source TEXT,
  p_resultat TEXT,
  p_produit_id UUID,
  p_variante_produit_id UUID,
  p_score INTEGER,
  p_raison TEXT,
  p_modele TEXT,
  p_prompt_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resultat_final TEXT := p_resultat;
  v_produit_final UUID := p_produit_id;
  v_variante_final UUID := p_variante_produit_id;
  v_id BIGINT;
BEGIN
  IF NOT public.est_administrateur() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_resultat NOT IN ('suggestion', 'produit_inconnu_du_referentiel') THEN
    RAISE EXCEPTION 'RESULTAT_INVALIDE';
  END IF;

  -- Seuil de confiance vérifié SERVEUR, pas seulement dans le prompt IA :
  -- en dessous de 85, toujours rabattu sur produit_inconnu_du_referentiel.
  -- Trace conservée (raison/score d'origine gardés), aucune suggestion
  -- 'en_attente' validable n'est créée pour une confiance insuffisante.
  IF v_resultat_final = 'suggestion' AND (p_score IS NULL OR p_score < 85) THEN
    v_resultat_final := 'produit_inconnu_du_referentiel';
    v_produit_final := NULL;
    v_variante_final := NULL;
  END IF;

  INSERT INTO public.suggestions_alias_core_ia (
    rejet_ecriture_core_id, libelle_source, produit_id, variante_produit_id,
    score_confiance, raison_ia, resultat, origine, modele_ia, prompt_version, cree_par
  ) VALUES (
    p_rejet_id, p_libelle_source, v_produit_final, v_variante_final,
    p_score, p_raison, v_resultat_final, 'ia', p_modele, p_prompt_version, auth.uid()
  )
  ON CONFLICT (rejet_ecriture_core_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('suggestion_id', v_id, 'resultat', v_resultat_final);
END;
$$;

REVOKE ALL ON FUNCTION public.enregistrer_suggestion_alias_core_ia(
  BIGINT, TEXT, TEXT, UUID, UUID, INTEGER, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enregistrer_suggestion_alias_core_ia(
  BIGINT, TEXT, TEXT, UUID, UUID, INTEGER, TEXT, TEXT, TEXT
) TO authenticated;

-- ==================================================================
-- 5. valider_suggestion_alias_core — action atomique (alias + rejet + prix)
-- ==================================================================
CREATE OR REPLACE FUNCTION public.valider_suggestion_alias_core(p_suggestion_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sugg public.suggestions_alias_core_ia%ROWTYPE;
  v_rejet public.rejets_ecriture_core%ROWTYPE;
  v_libelle_alias TEXT;
  v_magasin_id UUID;
  v_quantite NUMERIC;
  v_montant NUMERIC;
  v_observe_le TIMESTAMPTZ;
  v_alias_id UUID;
  v_prix_id UUID;
BEGIN
  IF NOT public.est_administrateur() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_sugg
  FROM public.suggestions_alias_core_ia
  WHERE id = p_suggestion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUGGESTION_NOT_FOUND';
  END IF;
  IF v_sugg.statut <> 'en_attente' THEN
    RAISE EXCEPTION 'SUGGESTION_ALREADY_DECIDED';
  END IF;
  IF v_sugg.resultat <> 'suggestion' OR v_sugg.produit_id IS NULL THEN
    RAISE EXCEPTION 'NO_PRODUCT_TO_VALIDATE';
  END IF;
  IF v_sugg.score_confiance IS NULL OR v_sugg.score_confiance < 85 THEN
    RAISE EXCEPTION 'CONFIDENCE_TOO_LOW';
  END IF;

  SELECT * INTO v_rejet
  FROM public.rejets_ecriture_core
  WHERE id = v_sugg.rejet_ecriture_core_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REJET_NOT_FOUND';
  END IF;
  IF v_rejet.motif <> 'alias_non_trouve' THEN
    RAISE EXCEPTION 'REJET_MOTIF_INVALID';
  END IF;
  IF v_rejet.traite THEN
    RAISE EXCEPTION 'REJET_ALREADY_TRAITE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.produits WHERE id = v_sugg.produit_id AND actif = TRUE
  ) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  IF v_sugg.variante_produit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.variantes_produit
    WHERE id = v_sugg.variante_produit_id
      AND produit_id = v_sugg.produit_id
      AND actif = TRUE
  ) THEN
    RAISE EXCEPTION 'VARIANT_MISMATCH';
  END IF;

  -- Libellé de l'alias : priorité au texte réel du ticket (#68), sinon
  -- l'indice IA/OCR conservé sur le rejet lui-même.
  v_libelle_alias := coalesce(
    nullif(btrim(v_rejet.payload->>'libelle_ticket'), ''),
    v_rejet.libelle_non_resolu
  );
  IF v_libelle_alias IS NULL THEN
    RAISE EXCEPTION 'LIBELLE_INTROUVABLE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.alias_produits
    WHERE statut = 'actif'
      AND lower(extensions.unaccent(libelle_alias)) = lower(extensions.unaccent(v_libelle_alias))
  ) THEN
    RAISE EXCEPTION 'ALIAS_ALREADY_EXISTS';
  END IF;

  v_magasin_id := public.resoudre_magasin_core(NULL, v_rejet.store_legacy_id, v_rejet.magasin_texte);
  IF v_magasin_id IS NULL THEN
    RAISE EXCEPTION 'MAGASIN_INTROUVABLE';
  END IF;

  -- Reconstruction du montant : les deux RPC d'écriture Core alimentent
  -- rejets_ecriture_core.payload avec des clés différentes selon la source
  -- (source='scan' -> payload = v_ligne de enregistrer_ticket_core ;
  --  source='manuel' -> payload = p_prix de enregistrer_prix_manuel_core).
  IF v_rejet.source = 'manuel' THEN
    v_montant := nullif(v_rejet.payload->>'prix_total', '')::NUMERIC;
    v_observe_le := coalesce(nullif(v_rejet.payload->>'date_observation', '')::TIMESTAMPTZ, v_rejet.cree_le);
  ELSE
    v_quantite := coalesce(nullif(v_rejet.payload->>'quantite', '')::NUMERIC, 1);
    v_montant := coalesce(
      nullif(v_rejet.payload->>'prix_total', '')::NUMERIC,
      nullif(v_rejet.payload->>'prix_unitaire', '')::NUMERIC * v_quantite
    );
    -- Pas de date_ticket au niveau de la ligne (v_ligne) : cree_le du rejet
    -- est le meilleur proxy disponible (accepté explicitement, Étape 0 pt.2).
    v_observe_le := v_rejet.cree_le;
  END IF;

  IF v_montant IS NULL OR v_montant < 0 THEN
    RAISE EXCEPTION 'MONTANT_INVALIDE';
  END IF;

  INSERT INTO public.alias_produits (
    libelle_alias, produit_id, variante_produit_id, origine, cree_par, statut
  ) VALUES (
    v_libelle_alias, v_sugg.produit_id, v_sugg.variante_produit_id, 'ia', auth.uid(), 'actif'
  )
  RETURNING id INTO v_alias_id;

  -- ligne_ticket_id = NULL : rejets_ecriture_core n'a jamais référencé la
  -- lignes_ticket d'origine (Étape 0, pt. 4) — pattern déjà existant et
  -- normal, identique à enregistrer_prix_manuel_core (PHASE_12_d).
  -- source du prix : reprend v_rejet.source (le rejet distingue déjà
  -- 'scan'/'manuel' — prix.source, lui, distingue 'ticket'/'manuel'/autres ;
  -- CHECK confirmé PHASE_4, 'manuel' est admis).
  INSERT INTO public.prix (
    produit_id, variante_produit_id, magasin_id, utilisateur_id, ligne_ticket_id,
    prix_total, source, statut_validation, valide_le, observe_le
  ) VALUES (
    v_sugg.produit_id, v_sugg.variante_produit_id, v_magasin_id, v_rejet.user_id, NULL,
    v_montant, CASE WHEN v_rejet.source = 'manuel' THEN 'manuel' ELSE 'ticket' END,
    'en_attente', NULL, v_observe_le
  )
  RETURNING id INTO v_prix_id;

  UPDATE public.rejets_ecriture_core
  SET traite = true
  WHERE id = v_rejet.id;

  UPDATE public.suggestions_alias_core_ia
  SET statut = 'validee', decide_par = auth.uid(), decide_le = now()
  WHERE id = p_suggestion_id;

  RETURN jsonb_build_object(
    'succes', true,
    'alias_id', v_alias_id,
    'prix_id', v_prix_id,
    'rejet_id', v_rejet.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.valider_suggestion_alias_core(BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valider_suggestion_alias_core(BIGINT)
  TO authenticated;

-- ==================================================================
-- 6. refuser_suggestion_alias_core — aucun effet secondaire
-- ==================================================================
CREATE OR REPLACE FUNCTION public.refuser_suggestion_alias_core(
  p_suggestion_id BIGINT,
  p_commentaire TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.est_administrateur() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE public.suggestions_alias_core_ia
  SET statut = 'refusee', decide_par = auth.uid(), decide_le = now(),
      commentaire_decision = nullif(btrim(coalesce(p_commentaire, '')), '')
  WHERE id = p_suggestion_id AND statut = 'en_attente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUGGESTION_NOT_FOUND_OR_ALREADY_DECIDED';
  END IF;

  RETURN jsonb_build_object('succes', true);
END;
$$;

REVOKE ALL ON FUNCTION public.refuser_suggestion_alias_core(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuser_suggestion_alias_core(BIGINT, TEXT)
  TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT — à exécuter avec un compte authenticated ADMIN réel
-- =============================================================================
-- 1. Table créée, vide :
-- SELECT count(*) FROM public.suggestions_alias_core_ia;
-- -- Attendu : 0
--
-- 2. Rejets éligibles (doit refléter les ~19 rejets alias_non_trouve non traités) :
-- SELECT * FROM public.lister_rejets_alias_eligibles(25);
--
-- 3. Shortlist sur un libellé connu (à adapter avec un vrai libellé du référentiel) :
-- SELECT * FROM public.rechercher_candidats_core('Lait demi-écrémé', 15);
-- -- Attendu : résultats triés par score DESC (le meilleur score en premier),
-- -- pas par produit_id — vérifier notamment avec p_limite bas (ex. 2) que ce
-- -- sont bien les 2 meilleurs scores qui sortent, pas les 2 premiers UUID.
--
-- 4. Enregistrement d'une suggestion factice sous le seuil (doit être rabattue) :
-- ⚠️ Écrit une VRAIE ligne liée à un vrai rejet (pas un no-op) : ce rejet
-- devient ensuite ineligible à lister_rejets_alias_eligibles (comportement
-- normal, identique à un vrai résultat IA sous le seuil). Pour annuler ce
-- test avant de lancer le bouton "Proposer des alias" en conditions réelles :
-- DELETE FROM public.suggestions_alias_core_ia WHERE raison_ia = 'test seuil bas';
-- SELECT public.enregistrer_suggestion_alias_core_ia(
--   (SELECT id FROM public.rejets_ecriture_core WHERE motif='alias_non_trouve' AND traite=false LIMIT 1),
--   'Test libelle', 'suggestion', (SELECT id FROM public.produits LIMIT 1), NULL,
--   70, 'test seuil bas', 'test-modele', 'v1'
-- );
-- -- Attendu : resultat = 'produit_inconnu_du_referentiel' (70 < 85), produit_id NULL en base
--
-- 5. Sécurité : un compte non-admin doit échouer partout ci-dessus (NOT_AUTHORIZED).
-- =============================================================================
