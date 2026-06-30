-- =============================================================================
-- PRIXMALIN — PHASE 5 : INSTANTANÉS IMMUABLES DU COMPARATEUR
-- Version : 2.0 | Date : 2026-06-30
--
-- PRINCIPES
--   - Les instantanés constituent une preuve gelée du calcul effectué.
--   - Les utilisateurs ne peuvent ni les créer, ni les modifier directement.
--   - Leur création est réservée à une Edge Function ou à un traitement serveur
--     utilisant le service_role après calcul du comparateur.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.instantanes_recommandation') IS NOT NULL
     OR pg_catalog.to_regclass('public.lignes_instantane_recommandation') IS NOT NULL THEN
    RAISE EXCEPTION
      'La phase 5 semble déjà présente. Vérifier les tables d''instantanés.';
  END IF;
END;
$$;

-- =============================================================================
-- 5.1 ENTÊTE D'INSTANTANÉ
-- =============================================================================
CREATE TABLE public.instantanes_recommandation (
  id                      UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  utilisateur_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id               UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  genere_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  economie_totale         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_panier_initial    NUMERIC(12,2),
  total_panier_optimal    NUMERIC(12,2),
  devise                  TEXT NOT NULL DEFAULT 'EUR',
  note                    TEXT,
  algorithme_version      TEXT,
  cree_le                 TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT instantanes_montants_positifs
    CHECK (
      economie_totale >= 0
      AND (total_panier_initial IS NULL OR total_panier_initial >= 0)
      AND (total_panier_optimal IS NULL OR total_panier_optimal >= 0)
    ),
  CONSTRAINT instantanes_devise_format CHECK (devise ~ '^[A-Z]{3}$')
);

CREATE INDEX idx_instantanes_recommandation_utilisateur
  ON public.instantanes_recommandation(utilisateur_id, genere_le DESC);
CREATE INDEX idx_instantanes_recommandation_ticket
  ON public.instantanes_recommandation(ticket_id)
  WHERE ticket_id IS NOT NULL;

-- =============================================================================
-- 5.2 LIGNES D'INSTANTANÉ
-- =============================================================================
CREATE TABLE public.lignes_instantane_recommandation (
  id                        UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  instantane_id             UUID NOT NULL
                            REFERENCES public.instantanes_recommandation(id)
                            ON DELETE CASCADE,
  produit_id                UUID REFERENCES public.produits(id) ON DELETE SET NULL,
  variante_produit_id       UUID,

  magasin_initial_id        UUID REFERENCES public.magasins(id) ON DELETE SET NULL,
  prix_initial              NUMERIC(12,2),
  nom_magasin_initial       TEXT,

  meilleur_magasin_id       UUID REFERENCES public.magasins(id) ON DELETE SET NULL,
  meilleur_prix             NUMERIC(12,2),
  nom_meilleur_magasin      TEXT,

  economie                  NUMERIC(12,2),
  economie_vs_moyenne       NUMERIC(12,2),
  pourcentage_economie      NUMERIC(7,3),

  nom_produit_reference     TEXT,
  quantite                  NUMERIC(12,3) NOT NULL DEFAULT 1,
  unite_comparaison         TEXT,
  cree_le                   TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT lignes_instantane_quantite_positive CHECK (quantite > 0),
  CONSTRAINT lignes_instantane_prix_positifs
    CHECK (
      (prix_initial IS NULL OR prix_initial >= 0)
      AND (meilleur_prix IS NULL OR meilleur_prix >= 0)
    ),
  CONSTRAINT lignes_instantane_variante_exige_produit
    CHECK (variante_produit_id IS NULL OR produit_id IS NOT NULL),
  CONSTRAINT fk_lignes_instantane_variante_produit
    FOREIGN KEY (variante_produit_id, produit_id)
    REFERENCES public.variantes_produit(id, produit_id)
    ON DELETE SET NULL
);

CREATE INDEX idx_lignes_instantane_instantane_id
  ON public.lignes_instantane_recommandation(instantane_id);
CREATE INDEX idx_lignes_instantane_produit_id
  ON public.lignes_instantane_recommandation(produit_id)
  WHERE produit_id IS NOT NULL;

-- =============================================================================
-- RLS ET PRIVILÈGES — LECTURE SEULE POUR LE PROPRIÉTAIRE
-- =============================================================================
ALTER TABLE public.instantanes_recommandation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lignes_instantane_recommandation ENABLE ROW LEVEL SECURITY;

CREATE POLICY instantanes_lecture_propre
  ON public.instantanes_recommandation FOR SELECT TO authenticated
  USING (utilisateur_id = auth.uid());

CREATE POLICY lignes_instantane_lecture_propre
  ON public.lignes_instantane_recommandation FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.instantanes_recommandation ir
      WHERE ir.id = instantane_id
        AND ir.utilisateur_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE
  public.instantanes_recommandation,
  public.lignes_instantane_recommandation
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.instantanes_recommandation,
  public.lignes_instantane_recommandation
TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT
-- =============================================================================
-- SELECT has_table_privilege(
--   'authenticated','public.instantanes_recommandation','INSERT'
-- );
-- Résultat attendu : false.
-- =============================================================================
