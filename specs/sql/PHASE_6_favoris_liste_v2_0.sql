-- =============================================================================
-- PRIXMALIN — PHASE 6 : FAVORIS ET LISTE DE COURSES
-- Version : 2.0 | Date : 2026-06-30
--
-- IMPORTANT
--   - Les tables legacy favorites et shopping_list restent intactes.
--   - Les nouvelles tables utilisent directement les noms métier français.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.favoris') IS NOT NULL
     OR pg_catalog.to_regclass('public.liste_courses') IS NOT NULL THEN
    RAISE EXCEPTION
      'La phase 6 semble déjà présente. Vérifier favoris et liste_courses.';
  END IF;
END;
$$;

-- =============================================================================
-- 6.1 FAVORIS
-- =============================================================================
CREATE TABLE public.favoris (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  utilisateur_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  produit_id            UUID NOT NULL REFERENCES public.produits(id) ON DELETE CASCADE,
  variante_produit_id   UUID,
  magasin_prefere_id    UUID REFERENCES public.magasins(id) ON DELETE SET NULL,
  notes                 TEXT,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT favoris_variante_exige_produit
    CHECK (variante_produit_id IS NULL OR produit_id IS NOT NULL),
  CONSTRAINT fk_favoris_variante_produit
    FOREIGN KEY (variante_produit_id, produit_id)
    REFERENCES public.variantes_produit(id, produit_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_favoris_utilisateur_produit UNIQUE (utilisateur_id, produit_id)
);

CREATE INDEX idx_favoris_utilisateur_id ON public.favoris(utilisateur_id);
CREATE INDEX idx_favoris_produit_id ON public.favoris(produit_id);

CREATE TRIGGER trg_favoris_date_modification
  BEFORE UPDATE ON public.favoris
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- 6.2 LISTE DE COURSES
-- =============================================================================
CREATE TABLE public.liste_courses (
  id                    UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  utilisateur_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  produit_id            UUID REFERENCES public.produits(id) ON DELETE SET NULL,
  variante_produit_id   UUID,
  format_selectionne    TEXT,
  quantite              NUMERIC(12,3) NOT NULL DEFAULT 1,
  statut                TEXT NOT NULL DEFAULT 'a_acheter' CHECK (
    statut IN ('a_acheter','achete','ignore')
  ),
  texte_libre           TEXT,
  magasin_cible_id      UUID REFERENCES public.magasins(id) ON DELETE SET NULL,
  notes                 TEXT,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  modifie_le            TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT liste_courses_quantite_positive CHECK (quantite > 0),
  CONSTRAINT liste_courses_produit_ou_texte
    CHECK (
      (produit_id IS NOT NULL)
      <> (NULLIF(pg_catalog.btrim(texte_libre), '') IS NOT NULL)
    ),
  CONSTRAINT liste_courses_variante_exige_produit
    CHECK (variante_produit_id IS NULL OR produit_id IS NOT NULL),
  CONSTRAINT fk_liste_courses_variante_produit
    FOREIGN KEY (variante_produit_id, produit_id)
    REFERENCES public.variantes_produit(id, produit_id)
    ON DELETE SET NULL
);

CREATE INDEX idx_liste_courses_utilisateur_statut
  ON public.liste_courses(utilisateur_id, statut);
CREATE INDEX idx_liste_courses_produit_id
  ON public.liste_courses(produit_id)
  WHERE produit_id IS NOT NULL;

CREATE TRIGGER trg_liste_courses_date_modification
  BEFORE UPDATE ON public.liste_courses
  FOR EACH ROW EXECUTE FUNCTION public.mettre_a_jour_date_modification();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.favoris ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liste_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY favoris_lecture_propre
  ON public.favoris FOR SELECT TO authenticated
  USING (utilisateur_id = auth.uid());
CREATE POLICY favoris_insertion_propre
  ON public.favoris FOR INSERT TO authenticated
  WITH CHECK (
    utilisateur_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.produits p
      WHERE p.id = produit_id AND p.actif = TRUE
    )
    AND (
      variante_produit_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.variantes_produit vp
        WHERE vp.id = variante_produit_id
          AND vp.produit_id = produit_id
          AND vp.actif = TRUE
      )
    )
    AND (
      magasin_prefere_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.magasins m
        WHERE m.id = magasin_prefere_id AND m.statut = 'actif'
      )
    )
  );
CREATE POLICY favoris_modification_propre
  ON public.favoris FOR UPDATE TO authenticated
  USING (utilisateur_id = auth.uid())
  WITH CHECK (
    utilisateur_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.produits p
      WHERE p.id = produit_id AND p.actif = TRUE
    )
    AND (
      variante_produit_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.variantes_produit vp
        WHERE vp.id = variante_produit_id
          AND vp.produit_id = produit_id
          AND vp.actif = TRUE
      )
    )
    AND (
      magasin_prefere_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.magasins m
        WHERE m.id = magasin_prefere_id AND m.statut = 'actif'
      )
    )
  );
CREATE POLICY favoris_suppression_propre
  ON public.favoris FOR DELETE TO authenticated
  USING (utilisateur_id = auth.uid());

CREATE POLICY liste_courses_lecture_propre
  ON public.liste_courses FOR SELECT TO authenticated
  USING (utilisateur_id = auth.uid());
CREATE POLICY liste_courses_insertion_propre
  ON public.liste_courses FOR INSERT TO authenticated
  WITH CHECK (
    utilisateur_id = auth.uid()
    AND (
      produit_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.produits p
        WHERE p.id = produit_id AND p.actif = TRUE
      )
    )
    AND (
      variante_produit_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.variantes_produit vp
        WHERE vp.id = variante_produit_id
          AND vp.produit_id = produit_id
          AND vp.actif = TRUE
      )
    )
    AND (
      magasin_cible_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.magasins m
        WHERE m.id = magasin_cible_id AND m.statut = 'actif'
      )
    )
  );
CREATE POLICY liste_courses_modification_propre
  ON public.liste_courses FOR UPDATE TO authenticated
  USING (utilisateur_id = auth.uid())
  WITH CHECK (
    utilisateur_id = auth.uid()
    AND (
      produit_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.produits p
        WHERE p.id = produit_id AND p.actif = TRUE
      )
    )
    AND (
      variante_produit_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.variantes_produit vp
        WHERE vp.id = variante_produit_id
          AND vp.produit_id = produit_id
          AND vp.actif = TRUE
      )
    )
    AND (
      magasin_cible_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.magasins m
        WHERE m.id = magasin_cible_id AND m.statut = 'actif'
      )
    )
  );
CREATE POLICY liste_courses_suppression_propre
  ON public.liste_courses FOR DELETE TO authenticated
  USING (utilisateur_id = auth.uid());

-- =============================================================================
-- PRIVILÈGES PAR COLONNE
-- =============================================================================
REVOKE ALL ON TABLE public.favoris, public.liste_courses
  FROM anon, authenticated;

GRANT SELECT, DELETE ON TABLE public.favoris TO authenticated;
GRANT INSERT (
  utilisateur_id, produit_id, variante_produit_id,
  magasin_prefere_id, notes
) ON public.favoris TO authenticated;
GRANT UPDATE (
  produit_id, variante_produit_id, magasin_prefere_id, notes
) ON public.favoris TO authenticated;

GRANT SELECT, DELETE ON TABLE public.liste_courses TO authenticated;
GRANT INSERT (
  utilisateur_id, produit_id, variante_produit_id, format_selectionne,
  quantite, statut, texte_libre, magasin_cible_id, notes
) ON public.liste_courses TO authenticated;
GRANT UPDATE (
  produit_id, variante_produit_id, format_selectionne,
  quantite, statut, texte_libre, magasin_cible_id, notes
) ON public.liste_courses TO authenticated;

COMMIT;

-- =============================================================================
-- CHECKPOINT
-- =============================================================================
-- SELECT tablename
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('favoris','liste_courses')
-- ORDER BY tablename;
-- =============================================================================
