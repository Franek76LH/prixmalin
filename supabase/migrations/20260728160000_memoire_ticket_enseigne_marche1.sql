-- Chantier 76, marche 1 — apprendre le TEXTE BRUT du ticket, par enseigne.
--
-- Objectif : quand un utilisateur valide/corrige l'association d'une ligne de
-- ticket, mémoriser une correspondance réutilisable
--   (enseigne + texte brut imprimé sur le ticket) -> (produit, variante),
-- EN PLUS de ce qui existe déjà. La reconnaissance auto au re-scan viendra en
-- marche 2 (elle N'EST PAS branchée ici).
--
-- Tout est ADDITIF :
--   * resoudre_alias_core et enregistrer_ticket_core NE SONT PAS touchés
--     (reconnaissance au scan strictement inchangée).
--   * alias_produits et son index unique NE SONT PAS touchés (chantier 73
--     intact).
--   * corriger_association_ligne_ticket est étendue sans rien retirer : on
--     ajoute la lecture de lt.libelle_ticket et un upsert dans la nouvelle
--     table. Sa signature reste identique (pas de nouveau paramètre), donc
--     aucun appelant (front, valider_ligne_dev_avec_alias,
--     relier_variante_scan_code_barres, creer_produit_et_valider_ligne_dev)
--     n'est impacté.
--
-- Couverture des 3 chemins de validation : A (correction utilisateur), B
-- (console admin « À valider » / « Nouveau produit »), C (scan code-barres)
-- passent TOUS par corriger_association_ligne_ticket (vérifié en base), donc
-- placer l'écriture de la mémoire ici les couvre tous d'un coup. La colonne
-- `source` porte une valeur commune 'correction_association' : distinguer
-- finement A/B/C imposerait un paramètre supplémentaire (surcharge de
-- signature) — écarté ici au profit de l'écriture centralisée unique.

-- 1) Table de mémoire dédiée -------------------------------------------------
-- Clé métier = (enseigne, texte brut normalisé). Le même texte brut peut
-- exister sous plusieurs enseignes et viser des produits différents : d'où
-- une table dédiée (impossible à exprimer proprement sous l'index unique
-- GLOBAL de alias_produits) et une unicité sur (enseigne_id, libelle
-- normalisé). Normalisation via la fonction existante normaliser_libelle,
-- la même que le resolver de scan, pour que la marche 2 matche de façon
-- symétrique.
create table if not exists public.correspondances_ticket_enseigne (
  id                       uuid primary key default gen_random_uuid(),
  enseigne_id              uuid not null references public.enseignes(id) on delete cascade,
  libelle_ticket_normalise text not null,
  produit_id               uuid not null references public.produits(id) on delete cascade,
  variante_produit_id      uuid references public.variantes_produit(id) on delete set null,
  -- statut : tout est 'actif' en marche 1 (François = validateur de confiance).
  -- La colonne existe pour brancher une modération quand on ouvrira aux testeurs.
  statut                   text not null default 'actif' check (statut in ('actif','en_attente','rejete')),
  source                   text,
  cree_par                 uuid references auth.users(id) on delete set null,
  cree_le                  timestamptz not null default now(),
  modifie_le               timestamptz not null default now(),
  constraint correspondances_ticket_enseigne_libelle_non_vide
    check (length(btrim(libelle_ticket_normalise)) > 0),
  constraint uq_correspondance_enseigne_libelle
    unique (enseigne_id, libelle_ticket_normalise)
);

create index if not exists idx_correspondances_ticket_enseigne_produit
  on public.correspondances_ticket_enseigne (produit_id);

-- RLS : lecture réservée admin (mémoire interne, inspectable par François).
-- Aucune policy d'écriture pour les clients : la seule écriture passe par la
-- fonction SECURITY DEFINER corriger_association_ligne_ticket (propriétaire
-- postgres, BYPASSRLS), donc les clients ne peuvent jamais falsifier la table
-- directement.
alter table public.correspondances_ticket_enseigne enable row level security;

create policy correspondances_ticket_enseigne_lecture_admin
  on public.correspondances_ticket_enseigne for select
  using (public.est_administrateur());

-- 2) corriger_association_ligne_ticket — extension additive ------------------
-- Deux seules différences vs la version précédente :
--   (a) on lit aussi lt.libelle_ticket (étape 2) ;
--   (b) nouvelle étape 11bis : upsert de la mémoire (enseigne + texte brut
--       normalisé) -> (produit, variante), le plus récent gagne.
-- Tout le reste est identique.
create or replace function public.corriger_association_ligne_ticket(p_ligne_ticket_id uuid, p_produit_id uuid, p_variante_produit_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
DECLARE
  v_utilisateur_id        uuid;
  v_ticket_user_id        uuid;
  v_libelle_brut          text;
  v_libelle_ticket        text;   -- Chantier 76 (marche 1)
  v_texte_ticket_norm     text;   -- Chantier 76 (marche 1)
  v_magasin_id            uuid;
  v_enseigne_id           uuid;
  v_ancien_produit_id     uuid;
  v_ancienne_variante_id  uuid;
  v_historique_id         uuid;
  v_suggestion_id         uuid;
  v_nb_prix_maj           integer := 0;
  v_nb_suggestions        integer := 0;
  v_alias_cree            boolean := false;
  -- Chantier #72 — création du prix manquant
  v_montant_net           numeric;
  v_prix_unitaire         numeric;
  v_quantite              numeric;
  v_date_ticket           date;
  v_montant               numeric;
  v_observe_le            timestamptz;
  v_date_repli_utilisee   boolean := false;
  v_prix_cree             boolean := false;
  v_motif_prix_non_cree   text;
BEGIN

  -- 1. Utilisateur connecté
  v_utilisateur_id := auth.uid();
  IF v_utilisateur_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- 2. Verrouiller la ligne et vérifier la propriété
  --    Chantier #72 : on récupère en plus tout ce qu'il faut pour calculer
  --    le montant et la date d'observation d'un éventuel prix à créer.
  --    Chantier 76 : on récupère aussi lt.libelle_ticket (texte brut).
  SELECT
    lt.produit_id,
    lt.variante_produit_id,
    lt.libelle_brut,
    lt.libelle_ticket,
    lt.montant_net,
    lt.prix_unitaire,
    lt.quantite,
    t.utilisateur_id,
    t.magasin_id,
    t.date_ticket
  INTO
    v_ancien_produit_id,
    v_ancienne_variante_id,
    v_libelle_brut,
    v_libelle_ticket,
    v_montant_net,
    v_prix_unitaire,
    v_quantite,
    v_ticket_user_id,
    v_magasin_id,
    v_date_ticket
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

  -- 6. Cas sans changement — retour immédiat SEULEMENT si un prix existe
  --    déjà pour cette ligne (Chantier #72). Sinon on continue : c'est
  --    précisément le cas d'une ligne déjà bien rattachée mais jamais
  --    alimentée en prix (alias non résolu au scan), qui doit être réparée.
  IF v_ancien_produit_id IS NOT DISTINCT FROM p_produit_id
  AND v_ancienne_variante_id IS NOT DISTINCT FROM p_variante_produit_id
  AND EXISTS (SELECT 1 FROM public.prix WHERE ligne_ticket_id = p_ligne_ticket_id)
  THEN
    RETURN jsonb_build_object(
      'succes',                 true,
      'modification_effectuee', false,
      'nb_prix_mis_a_jour',     0,
      'alias_cree',             false,
      'prix_cree',              false
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
    methode_validation_produit       = 'humaine',
    produit_valide_le                = now(),
    produit_valide_par               = v_utilisateur_id,
    statut_validation_variante       = CASE
                                         WHEN p_variante_produit_id IS NOT NULL THEN 'validee'
                                         ELSE 'non_validee'
                                       END,
    methode_validation_variante      = CASE
                                         WHEN p_variante_produit_id IS NOT NULL THEN 'humaine'
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
    modifie_le           = now()
  WHERE ligne_ticket_id = p_ligne_ticket_id;

  GET DIAGNOSTICS v_nb_prix_maj = ROW_COUNT;

  -- 10bis. Chantier #72 — aucun prix existant pour cette ligne : on le crée.
  --        Montant = coalesce(montant_net, prix_unitaire * quantite), comme
  --        enregistrer_ticket_core. observe_le = date du ticket, jamais
  --        now() — repli sur now() uniquement si date_ticket est NULL,
  --        signalé dans le retour JSON. Ne bloque jamais la correction du
  --        produit si le montant n'est pas calculable.
  IF v_nb_prix_maj = 0 AND p_produit_id IS NOT NULL THEN
    v_montant := COALESCE(v_montant_net, v_prix_unitaire * v_quantite);

    IF v_montant IS NULL THEN
      v_motif_prix_non_cree := 'montant_non_calculable';
    ELSE
      v_date_repli_utilisee := (v_date_ticket IS NULL);
      v_observe_le := COALESCE(v_date_ticket::timestamptz, now());

      INSERT INTO public.prix (
        produit_id, variante_produit_id, magasin_id, utilisateur_id, ligne_ticket_id,
        prix_total, source, statut_validation, valide_le, observe_le
      ) VALUES (
        p_produit_id, p_variante_produit_id, v_magasin_id, v_utilisateur_id, p_ligne_ticket_id,
        v_montant, 'ticket', 'en_attente', NULL, v_observe_le
      );
      v_prix_cree := true;
    END IF;
  END IF;

  -- 11. Suggestion d'alias — si le libellé normalisé est inconnu
  --     Vérifie alias_produits ET suggestions en_attente, tous produits confondus
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

  -- 11bis. Chantier 76 (marche 1) — mémoire réutilisable : texte brut du
  --        ticket (libelle_ticket) rattaché à l'ENSEIGNE du magasin ->
  --        produit + variante que l'utilisateur vient de valider. Purement
  --        additif : n'alimente pas le scan (marche 2), ne touche pas
  --        alias_produits. On n'écrit que si on a une enseigne ET un texte
  --        brut normalisable. Conflit sur (enseigne, texte normalisé) : le
  --        plus récent gagne (dernière validation humaine).
  IF v_enseigne_id IS NOT NULL AND v_libelle_ticket IS NOT NULL THEN
    v_texte_ticket_norm := public.normaliser_libelle(v_libelle_ticket);
    IF v_texte_ticket_norm IS NOT NULL AND v_texte_ticket_norm <> '' THEN
      INSERT INTO public.correspondances_ticket_enseigne (
        enseigne_id, libelle_ticket_normalise, produit_id, variante_produit_id,
        statut, source, cree_par
      ) VALUES (
        v_enseigne_id, v_texte_ticket_norm, p_produit_id, p_variante_produit_id,
        'actif', 'correction_association', v_utilisateur_id
      )
      ON CONFLICT (enseigne_id, libelle_ticket_normalise) DO UPDATE SET
        produit_id          = EXCLUDED.produit_id,
        variante_produit_id = EXCLUDED.variante_produit_id,
        statut              = 'actif',
        source              = EXCLUDED.source,
        modifie_le          = now();
    END IF;
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
    'suggestion_alias_id',    v_suggestion_id,
    'prix_cree',              v_prix_cree,
    'motif_prix_non_cree',    v_motif_prix_non_cree,
    'date_repli_utilisee',    v_date_repli_utilisee
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$function$;
