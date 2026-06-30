-- =============================================================================
-- PRIXMALIN — PHASE 4 : TICKETS, LIGNES, PRIX ET CORRECTIONS SÉCURISÉES
-- Version : 2.1 | Date : 2026-06-30
--
-- RÈGLE CENTRALE
--   Un utilisateur peut corriger l'association IA de ses propres lignes de
--   ticket, mais uniquement par la RPC corriger_association_ligne_ticket().
--   Il ne peut jamais renommer directement le référentiel global.
--
-- SÉCURITÉ
--   - Aucun INSERT/UPDATE/DELETE direct sur lignes_ticket.
--   - Aucun INSERT/UPDATE/DELETE direct sur prix.
--   - Aucun INSERT direct dans alias_produits.
--   - Toute correction est historisée et répercutée sur le prix dérivé.
--   - Une ligne ticket historisée ne peut pas être supprimée tant que son
--     historique de correction existe (ON DELETE RESTRICT).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_objet TEXT;
BEGIN
  FOREACH v_objet IN ARRAY ARRAY[
    'tickets','images_ticket','lignes_ticket','prix',
    'historique_corrections_association','suggestions_alias_produit'
  ]
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', v_objet)) IS NOT NULL THEN
      RAISE EXCEPTION
        'Objet public.% déjà présent. Vérifier le schéma avant de relancer la phase 4.',
        v_objet;
    END IF;
  END LOOP;
END;
$$;

-- =============================================================================
-- 4.1 TICKETS
-- =============================================================================
CREATE TABLE public.tickets (
  id                      UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  utilisateur_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  magasin_id              UUID REFERENCES public.magasins(id) ON DELETE RESTRICT,
  scanne_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  date_ticket             DATE,
  montant_total           NUMERIC(12,2),
  devise                  TEXT NOT NULL DEFAULT 'EUR',

  empreinte               TEXT,
  version_empreinte       INTEGER NOT NULL DEFAULT 1,
  duplique_de_ticket_id   UUID REFERENCES public.tickets(id) ON DELETE SET NULL,

  statut_traitement       TEXT NOT NULL DEFAULT 'en_attente' CHECK (
    statut_traitement IN (
      'en_attente','en_cours','termine','echec','doublon'
    )
  ),
  texte_ocr_brut          TEXT,
  modele_ocr              TEXT,
  confiance_ocr           NUMERIC(4,3) CHECK (confiance_ocr BETWEEN 0 AND 1),
  message_erreur          TEXT,

  cercle_id               UUID REFERENCES public.cercles(id) ON DELETE SET NULL,
  cree_le                 TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le              TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT tickets_montant_total_positif
    CHECK (montant_total IS NULL OR montant_total >= 0),
  CONSTRAINT tickets_devise_format
    CHECK (devise ~ '^[A-Z]{3}$'),
  CONSTRAINT tickets_version_empreinte_positive
    CHECK (version_empreinte > 0),
  CONSTRAINT uq_tickets_utilisateur_empreinte
    UNIQUE (utilisateur_id, empreinte, version_empreinte)
);

CREATE INDEX idx_tickets_utilisateur_id ON public.tickets(utilisateur_id);
CREATE INDEX idx_tickets_magasin_id ON public.tickets(magasin_id)
  WHERE magasin_id IS NOT NULL;
CREATE INDEX idx_tickets_statut_traitement ON public.tickets(statut_traitement);
CREATE INDEX idx_tickets_cercle_id ON public.tickets(cercle_id)
  WHERE cercle_id IS NOT NULL;
CREATE INDEX idx_tickets_date_ticket ON public.tickets(date_ticket DESC)
  WHERE date_ticket IS NOT NULL;

CREATE TRIGGER trg_tickets_date_modification
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 4.2 IMAGES DE TICKET
-- =============================================================================
CREATE TABLE public.images_ticket (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  ticket_id             UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  chemin_stockage       TEXT NOT NULL,
  numero_page           INTEGER NOT NULL DEFAULT 1,
  type_mime             TEXT NOT NULL DEFAULT 'image/jpeg',
  taille_octets         BIGINT,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT images_ticket_chemin_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(chemin_stockage)) > 0),
  CONSTRAINT images_ticket_numero_page_positif
    CHECK (numero_page > 0),
  CONSTRAINT images_ticket_taille_positive
    CHECK (taille_octets IS NULL OR taille_octets >= 0),
  CONSTRAINT uq_images_ticket_page UNIQUE (ticket_id, numero_page)
);

CREATE INDEX idx_images_ticket_ticket_id ON public.images_ticket(ticket_id);

-- =============================================================================
-- 4.3 LIGNES DE TICKET
-- =============================================================================
CREATE TABLE public.lignes_ticket (
  id                            UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  ticket_id                     UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  numero_ligne                  INTEGER,
  type_ligne                    TEXT NOT NULL DEFAULT 'produit' CHECK (
    type_ligne IN ('produit','remise','taxe','total','autre')
  ),

  libelle_brut                  TEXT NOT NULL,

  -- Proposition initiale de l'IA, conservée pour audit.
  produit_suggere_ia_id         UUID REFERENCES public.produits(id) ON DELETE SET NULL,
  variante_suggeree_ia_id       UUID,

  -- Association courante utilisée par PrixMalin.
  produit_id                    UUID REFERENCES public.produits(id) ON DELETE SET NULL,
  variante_produit_id           UUID,

  confiance_produit_ia          NUMERIC(4,3) CHECK (confiance_produit_ia BETWEEN 0 AND 1),
  confiance_variante_ia         NUMERIC(4,3) CHECK (confiance_variante_ia BETWEEN 0 AND 1),

  statut_validation_produit     TEXT NOT NULL DEFAULT 'non_valide' CHECK (
    statut_validation_produit IN ('non_valide','valide','rejete')
  ),
  methode_validation_produit    TEXT CHECK (
    methode_validation_produit IN ('automatique','humaine')
  ),
  produit_valide_le             TIMESTAMPTZ,
  produit_valide_par            UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  statut_validation_variante    TEXT NOT NULL DEFAULT 'non_validee' CHECK (
    statut_validation_variante IN (
      'non_validee','validee','rejetee','non_identifiee'
    )
  ),
  methode_validation_variante   TEXT CHECK (
    methode_validation_variante IN ('automatique','humaine')
  ),
  variante_validee_le           TIMESTAMPTZ,
  variante_validee_par          UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  association_corrigee_utilisateur BOOLEAN NOT NULL DEFAULT FALSE,

  montant_brut                  NUMERIC(12,2),
  montant_remise                NUMERIC(12,2) NOT NULL DEFAULT 0,
  montant_net                   NUMERIC(12,2),
  quantite                      NUMERIC(12,3) NOT NULL DEFAULT 1,
  prix_unitaire                 NUMERIC(12,4),

  cree_le                       TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le                    TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT lignes_ticket_libelle_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(libelle_brut)) > 0),
  CONSTRAINT lignes_ticket_numero_ligne_positif
    CHECK (numero_ligne IS NULL OR numero_ligne > 0),
  CONSTRAINT lignes_ticket_montants_positifs
    CHECK (
      (montant_brut IS NULL OR montant_brut >= 0)
      AND montant_remise >= 0
      AND (montant_net IS NULL OR montant_net >= 0)
      AND (prix_unitaire IS NULL OR prix_unitaire >= 0)
    ),
  CONSTRAINT lignes_ticket_quantite_positive CHECK (quantite > 0),
  CONSTRAINT lignes_ticket_variante_exige_produit
    CHECK (variante_produit_id IS NULL OR produit_id IS NOT NULL),
  CONSTRAINT lignes_ticket_variante_ia_exige_produit
    CHECK (variante_suggeree_ia_id IS NULL OR produit_suggere_ia_id IS NOT NULL),
  CONSTRAINT fk_lignes_ticket_variante_produit
    FOREIGN KEY (variante_produit_id, produit_id)
    REFERENCES public.variantes_produit(id, produit_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_lignes_ticket_variante_ia_produit
    FOREIGN KEY (variante_suggeree_ia_id, produit_suggere_ia_id)
    REFERENCES public.variantes_produit(id, produit_id)
    ON DELETE SET NULL,
  CONSTRAINT uq_lignes_ticket_numero UNIQUE (ticket_id, numero_ligne)
);

CREATE INDEX idx_lignes_ticket_ticket_id ON public.lignes_ticket(ticket_id);
CREATE INDEX idx_lignes_ticket_produit_id ON public.lignes_ticket(produit_id)
  WHERE produit_id IS NOT NULL;
CREATE INDEX idx_lignes_ticket_variante_id ON public.lignes_ticket(variante_produit_id)
  WHERE variante_produit_id IS NOT NULL;

CREATE TRIGGER trg_lignes_ticket_date_modification
  BEFORE UPDATE ON public.lignes_ticket
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 4.4 PRIX
-- =============================================================================
CREATE TABLE public.prix (
  id                      UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  produit_id              UUID NOT NULL REFERENCES public.produits(id) ON DELETE RESTRICT,
  variante_produit_id     UUID,
  magasin_id              UUID NOT NULL REFERENCES public.magasins(id) ON DELETE RESTRICT,
  utilisateur_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ligne_ticket_id         UUID UNIQUE REFERENCES public.lignes_ticket(id) ON DELETE SET NULL,

  prix_total              NUMERIC(12,2) NOT NULL CHECK (prix_total >= 0),
  quantite_reference      NUMERIC(14,3),
  prix_unite_reference    NUMERIC(14,4),
  unite_prix_reference    TEXT,
  devise                  TEXT NOT NULL DEFAULT 'EUR',
  type_prix               TEXT NOT NULL DEFAULT 'normal' CHECK (
    type_prix IN ('normal','promotion','fidelite','destockage')
  ),
  fin_promotion           DATE,

  source                  TEXT NOT NULL DEFAULT 'ticket' CHECK (
    source IN ('ticket','manuel','communaute','import')
  ),
  statut_validation       TEXT NOT NULL DEFAULT 'en_attente' CHECK (
    statut_validation IN ('en_attente','valide','rejete')
  ),
  observe_le              TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  valide_jusqu_au         DATE,
  valide_le               TIMESTAMPTZ,

  archive                 BOOLEAN NOT NULL DEFAULT FALSE,
  archive_le              TIMESTAMPTZ,

  cree_le                 TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le              TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT prix_variante_exige_produit
    CHECK (variante_produit_id IS NULL OR produit_id IS NOT NULL),
  CONSTRAINT prix_reference_coherente
    CHECK (
      (quantite_reference IS NULL AND prix_unite_reference IS NULL
       AND unite_prix_reference IS NULL)
      OR
      (quantite_reference > 0 AND prix_unite_reference >= 0
       AND pg_catalog.length(pg_catalog.btrim(unite_prix_reference)) > 0)
    ),
  CONSTRAINT prix_devise_format CHECK (devise ~ '^[A-Z]{3}$'),
  CONSTRAINT prix_validation_coherente
    CHECK (
      (statut_validation = 'valide' AND valide_le IS NOT NULL)
      OR
      (statut_validation <> 'valide')
    ),
  CONSTRAINT prix_archivage_coherent
    CHECK (
      (archive = FALSE AND archive_le IS NULL)
      OR
      (archive = TRUE AND archive_le IS NOT NULL)
    ),
  CONSTRAINT fk_prix_variante_produit
    FOREIGN KEY (variante_produit_id, produit_id)
    REFERENCES public.variantes_produit(id, produit_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_prix_produit_id ON public.prix(produit_id);
CREATE INDEX idx_prix_magasin_id ON public.prix(magasin_id);
CREATE INDEX idx_prix_observe_le ON public.prix(observe_le DESC);
CREATE INDEX idx_prix_produit_magasin_actif
  ON public.prix(produit_id, magasin_id, observe_le DESC)
  WHERE archive = FALSE AND statut_validation = 'valide';
CREATE INDEX idx_prix_variante_id ON public.prix(variante_produit_id)
  WHERE variante_produit_id IS NOT NULL;

CREATE TRIGGER trg_prix_date_modification
  BEFORE UPDATE ON public.prix
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 4.5 HISTORIQUE DES CORRECTIONS D'ASSOCIATION
-- =============================================================================
CREATE TABLE public.historique_corrections_association (
  id                          UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  ligne_ticket_id             UUID NOT NULL
                              REFERENCES public.lignes_ticket(id) ON DELETE RESTRICT,
  corrige_par                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ancien_produit_id           UUID REFERENCES public.produits(id) ON DELETE SET NULL,
  ancienne_variante_id        UUID REFERENCES public.variantes_produit(id) ON DELETE SET NULL,
  nouveau_produit_id          UUID NOT NULL REFERENCES public.produits(id) ON DELETE RESTRICT,
  nouvelle_variante_id        UUID REFERENCES public.variantes_produit(id) ON DELETE RESTRICT,
  motif                       TEXT,
  cree_le                     TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX idx_historique_corrections_ligne_ticket
  ON public.historique_corrections_association(ligne_ticket_id, cree_le DESC);
CREATE INDEX idx_historique_corrections_corrige_par
  ON public.historique_corrections_association(corrige_par)
  WHERE corrige_par IS NOT NULL;

-- =============================================================================
-- 4.6 SUGGESTIONS D'ALIAS — SÉPARÉES DU RÉFÉRENTIEL GLOBAL
-- =============================================================================
CREATE TABLE public.suggestions_alias_produit (
  id                      UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  ligne_ticket_id         UUID NOT NULL
                          REFERENCES public.lignes_ticket(id) ON DELETE CASCADE,
  historique_correction_id UUID
                          REFERENCES public.historique_corrections_association(id)
                          ON DELETE SET NULL,
  libelle_propose         TEXT NOT NULL,
  produit_id              UUID NOT NULL REFERENCES public.produits(id) ON DELETE RESTRICT,
  variante_produit_id     UUID,
  propose_par             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  statut                  TEXT NOT NULL DEFAULT 'en_attente' CHECK (
    statut IN ('en_attente','validee','rejetee')
  ),
  examine_par             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  examine_le              TIMESTAMPTZ,
  commentaire_examen      TEXT,
  cree_le                 TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le              TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT suggestions_alias_libelle_non_vide
    CHECK (pg_catalog.length(pg_catalog.btrim(libelle_propose)) > 0),
  CONSTRAINT suggestions_alias_examen_coherent
    CHECK (
      (statut = 'en_attente' AND examine_le IS NULL)
      OR
      (statut IN ('validee','rejetee') AND examine_le IS NOT NULL)
    ),
  CONSTRAINT fk_suggestions_alias_variante_produit
    FOREIGN KEY (variante_produit_id, produit_id)
    REFERENCES public.variantes_produit(id, produit_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_suggestions_alias_sans_variante
  ON public.suggestions_alias_produit(ligne_ticket_id, produit_id)
  WHERE variante_produit_id IS NULL AND statut = 'en_attente';
CREATE UNIQUE INDEX uq_suggestions_alias_avec_variante
  ON public.suggestions_alias_produit(
    ligne_ticket_id, produit_id, variante_produit_id
  )
  WHERE variante_produit_id IS NOT NULL AND statut = 'en_attente';
CREATE INDEX idx_suggestions_alias_statut
  ON public.suggestions_alias_produit(statut);

CREATE TRIGGER trg_suggestions_alias_date_modification
  BEFORE UPDATE ON public.suggestions_alias_produit
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 4.7 RPC CENTRALE — CORRIGER L'ASSOCIATION D'UNE LIGNE
-- =============================================================================
CREATE OR REPLACE FUNCTION public.corriger_association_ligne_ticket(
  p_ligne_ticket_id UUID,
  p_nouveau_produit_id UUID,
  p_nouvelle_variante_produit_id UUID DEFAULT NULL,
  p_motif TEXT DEFAULT NULL,
  p_proposer_alias BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_utilisateur UUID := auth.uid();
  v_ligne public.lignes_ticket%ROWTYPE;
  v_proprietaire UUID;
  v_historique_id UUID;
  v_suggestion_id UUID;
  v_nombre_prix_mis_a_jour INTEGER := 0;
BEGIN
  IF v_utilisateur IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '42501';
  END IF;

  IF p_nouveau_produit_id IS NULL THEN
    RAISE EXCEPTION 'Le nouveau produit est obligatoire.' USING ERRCODE = '22023';
  END IF;

  IF p_motif IS NOT NULL AND pg_catalog.length(p_motif) > 1000 THEN
    RAISE EXCEPTION 'Le motif ne peut pas dépasser 1000 caractères.'
      USING ERRCODE = '22023';
  END IF;

  SELECT lt.*
  INTO v_ligne
  FROM public.lignes_ticket lt
  WHERE lt.id = p_ligne_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ligne de ticket introuvable.' USING ERRCODE = 'P0002';
  END IF;

  SELECT t.utilisateur_id
  INTO v_proprietaire
  FROM public.tickets t
  WHERE t.id = v_ligne.ticket_id;

  IF v_proprietaire IS DISTINCT FROM v_utilisateur THEN
    RAISE EXCEPTION 'Cette ligne de ticket ne vous appartient pas.'
      USING ERRCODE = '42501';
  END IF;

  IF v_ligne.type_ligne <> 'produit' THEN
    RAISE EXCEPTION 'Seules les lignes produit peuvent être réassociées.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.produits p
    WHERE p.id = p_nouveau_produit_id
      AND p.actif = TRUE
  ) THEN
    RAISE EXCEPTION 'Produit cible inconnu ou inactif.' USING ERRCODE = '23503';
  END IF;

  IF p_nouvelle_variante_produit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.variantes_produit vp
    WHERE vp.id = p_nouvelle_variante_produit_id
      AND vp.produit_id = p_nouveau_produit_id
      AND vp.actif = TRUE
  ) THEN
    RAISE EXCEPTION 'Variante inconnue, inactive ou rattachée à un autre produit.'
      USING ERRCODE = '23503';
  END IF;

  IF v_ligne.produit_id IS NOT DISTINCT FROM p_nouveau_produit_id
     AND v_ligne.variante_produit_id IS NOT DISTINCT FROM p_nouvelle_variante_produit_id THEN
    RAISE EXCEPTION 'La nouvelle association est identique à l''association actuelle.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.lignes_ticket
  SET
    produit_id = p_nouveau_produit_id,
    variante_produit_id = p_nouvelle_variante_produit_id,
    statut_validation_produit = 'valide',
    methode_validation_produit = 'humaine',
    produit_valide_le = pg_catalog.now(),
    produit_valide_par = v_utilisateur,
    statut_validation_variante = CASE
      WHEN p_nouvelle_variante_produit_id IS NULL THEN 'non_identifiee'
      ELSE 'validee'
    END,
    methode_validation_variante = 'humaine',
    variante_validee_le = pg_catalog.now(),
    variante_validee_par = v_utilisateur,
    association_corrigee_utilisateur = TRUE
  WHERE id = p_ligne_ticket_id;

  UPDATE public.prix
  SET
    produit_id = p_nouveau_produit_id,
    variante_produit_id = p_nouvelle_variante_produit_id
  WHERE ligne_ticket_id = p_ligne_ticket_id;

  GET DIAGNOSTICS v_nombre_prix_mis_a_jour = ROW_COUNT;

  INSERT INTO public.historique_corrections_association (
    ligne_ticket_id,
    corrige_par,
    ancien_produit_id,
    ancienne_variante_id,
    nouveau_produit_id,
    nouvelle_variante_id,
    motif
  )
  VALUES (
    p_ligne_ticket_id,
    v_utilisateur,
    v_ligne.produit_id,
    v_ligne.variante_produit_id,
    p_nouveau_produit_id,
    p_nouvelle_variante_produit_id,
    NULLIF(pg_catalog.btrim(p_motif), '')
  )
  RETURNING id INTO v_historique_id;

  IF p_proposer_alias THEN
    INSERT INTO public.suggestions_alias_produit (
      ligne_ticket_id,
      historique_correction_id,
      libelle_propose,
      produit_id,
      variante_produit_id,
      propose_par
    )
    VALUES (
      p_ligne_ticket_id,
      v_historique_id,
      pg_catalog.btrim(v_ligne.libelle_brut),
      p_nouveau_produit_id,
      p_nouvelle_variante_produit_id,
      v_utilisateur
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_suggestion_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ligne_ticket_id', p_ligne_ticket_id,
    'historique_correction_id', v_historique_id,
    'suggestion_alias_id', v_suggestion_id,
    'nombre_prix_mis_a_jour', v_nombre_prix_mis_a_jour,
    'produit_id', p_nouveau_produit_id,
    'variante_produit_id', p_nouvelle_variante_produit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.corriger_association_ligne_ticket(
  UUID, UUID, UUID, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corriger_association_ligne_ticket(
  UUID, UUID, UUID, TEXT, BOOLEAN
) TO authenticated;

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.images_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lignes_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prix ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historique_corrections_association ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suggestions_alias_produit ENABLE ROW LEVEL SECURITY;

CREATE POLICY tickets_lecture_propre
  ON public.tickets FOR SELECT TO authenticated
  USING (utilisateur_id = auth.uid());

CREATE POLICY tickets_insertion_propre
  ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (
    utilisateur_id = auth.uid()
    AND (
      magasin_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.magasins m
        WHERE m.id = magasin_id AND m.statut = 'actif'
      )
    )
    AND (
      cercle_id IS NULL
      OR public.est_membre_actif_cercle(cercle_id)
    )
  );

CREATE POLICY tickets_modification_propre
  ON public.tickets FOR UPDATE TO authenticated
  USING (utilisateur_id = auth.uid())
  WITH CHECK (
    utilisateur_id = auth.uid()
    AND (
      magasin_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.magasins m
        WHERE m.id = magasin_id AND m.statut = 'actif'
      )
    )
    AND (
      cercle_id IS NULL
      OR public.est_membre_actif_cercle(cercle_id)
    )
  );

CREATE POLICY images_ticket_lecture_propre
  ON public.images_ticket FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id AND t.utilisateur_id = auth.uid()
    )
  );
CREATE POLICY images_ticket_insertion_propre
  ON public.images_ticket FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id AND t.utilisateur_id = auth.uid()
    )
  );
CREATE POLICY images_ticket_suppression_propre
  ON public.images_ticket FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id AND t.utilisateur_id = auth.uid()
    )
  );

CREATE POLICY lignes_ticket_lecture_propre
  ON public.lignes_ticket FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id AND t.utilisateur_id = auth.uid()
    )
  );

CREATE POLICY prix_lecture_authentifiee
  ON public.prix FOR SELECT TO authenticated
  USING (
    (statut_validation = 'valide' AND archive = FALSE)
    OR utilisateur_id = auth.uid()
    OR public.est_administrateur()
  );

CREATE POLICY historique_corrections_lecture_propre
  ON public.historique_corrections_association FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.lignes_ticket lt
      JOIN public.tickets t ON t.id = lt.ticket_id
      WHERE lt.id = ligne_ticket_id
        AND t.utilisateur_id = auth.uid()
    )
    OR public.est_administrateur()
  );

CREATE POLICY suggestions_alias_lecture_propre_ou_admin
  ON public.suggestions_alias_produit FOR SELECT TO authenticated
  USING (propose_par = auth.uid() OR public.est_administrateur());
CREATE POLICY suggestions_alias_modification_admin
  ON public.suggestions_alias_produit FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

-- =============================================================================
-- PRIVILÈGES OBJET ET COLONNES
-- =============================================================================
REVOKE ALL ON TABLE
  public.tickets,
  public.images_ticket,
  public.lignes_ticket,
  public.prix,
  public.historique_corrections_association,
  public.suggestions_alias_produit
FROM anon, authenticated;

-- Tickets : l'utilisateur ne peut écrire que les métadonnées non techniques.
GRANT SELECT ON TABLE public.tickets TO authenticated;
GRANT INSERT (
  utilisateur_id,
  magasin_id,
  date_ticket,
  montant_total,
  devise,
  empreinte,
  version_empreinte,
  cercle_id
) ON public.tickets TO authenticated;
GRANT UPDATE (
  magasin_id,
  date_ticket,
  montant_total,
  devise,
  cercle_id
) ON public.tickets TO authenticated;

-- Images : l'utilisateur peut rattacher ou retirer ses propres images.
GRANT SELECT, INSERT, DELETE ON TABLE public.images_ticket TO authenticated;

-- Lignes, prix et historique : lecture seulement.
GRANT SELECT ON TABLE
  public.lignes_ticket,
  public.prix,
  public.historique_corrections_association
TO authenticated;

-- Suggestions : lecture par le proposant, validation uniquement par un admin.
GRANT SELECT, UPDATE ON TABLE public.suggestions_alias_produit
  TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT DE SÉCURITÉ
-- =============================================================================
-- 1. Vérifier qu'authenticated n'a pas UPDATE sur lignes_ticket :
-- SELECT has_table_privilege('authenticated','public.lignes_ticket','UPDATE');
-- Résultat attendu : false.
--
-- 2. Vérifier qu'authenticated n'a pas UPDATE sur prix :
-- SELECT has_table_privilege('authenticated','public.prix','UPDATE');
-- Résultat attendu : false.
--
-- 3. Vérifier la RPC :
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.corriger_association_ligne_ticket(uuid,uuid,uuid,text,boolean)',
--   'EXECUTE'
-- );
-- Résultat attendu : true.
-- =============================================================================
