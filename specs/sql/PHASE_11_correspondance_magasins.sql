-- ============================================================
-- PHASE 11 — Correspondance magasins legacy (stores) <-> Core (magasins)
-- #56.3 PrixMalin — Fondation du pont magasin, préalable à l'écriture Core
-- Préparé le 6 juillet 2026, à exécuter manuellement par François après relecture
-- ============================================================
-- Contenu, dans l'ordre :
--   1. Table public.correspondance_magasins (+ RLS, même modèle que magasins)
--   2. Deux fusions de magasins Core (mécanisme statut/fusionne_vers_id existant)
--   3. Les 17 correspondances validées (GPS/terrain, François, 6 juillet 2026)
--   4. Vérifications de fin de script (lecture seule)
--
-- Les 3 stores legacy cf7b4fce-443d-4d9d-96dd-9e1d8cca6f98,
-- 27af986e-0225-4dcc-9bfd-07d4392a234f, c316a421-e5a6-49b7-ae56-a18140ab8fe2
-- n'ont volontairement AUCUNE ligne : aucun équivalent Core identifié.
-- ============================================================

BEGIN;

-- =============================================================================
-- 1. TABLE DE CORRESPONDANCE
-- =============================================================================
CREATE TABLE public.correspondance_magasins (
  store_id_legacy   UUID PRIMARY KEY REFERENCES public.stores(id),
  magasin_id        UUID NOT NULL REFERENCES public.magasins(id),
  cree_par          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cree_le           TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  commentaire       TEXT
);

CREATE INDEX idx_correspondance_magasins_magasin_id
  ON public.correspondance_magasins(magasin_id);

ALTER TABLE public.correspondance_magasins ENABLE ROW LEVEL SECURITY;

-- Même modèle que public.magasins (PHASE_2) : lecture authenticated,
-- écriture réservée à l'administrateur.
CREATE POLICY correspondance_magasins_lecture_authentifiee
  ON public.correspondance_magasins FOR SELECT TO authenticated
  USING (true);
CREATE POLICY correspondance_magasins_insertion_admin
  ON public.correspondance_magasins FOR INSERT TO authenticated
  WITH CHECK (public.est_administrateur());
CREATE POLICY correspondance_magasins_modification_admin
  ON public.correspondance_magasins FOR UPDATE TO authenticated
  USING (public.est_administrateur())
  WITH CHECK (public.est_administrateur());

REVOKE ALL ON TABLE public.correspondance_magasins FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.correspondance_magasins TO authenticated;

-- =============================================================================
-- 2. FUSIONS DE MAGASINS CORE
-- =============================================================================
-- Mécanisme déjà prévu par le schéma (PHASE_2_magasins_v2_1.sql) : marquer le
-- doublon 'fusionne' et pointer fusionne_vers_id vers le magasin canonique.
--
-- Sort des prix déjà rattachés au magasin fusionné : NE PAS les ré-attacher
-- (pas d'UPDATE prix SET magasin_id). La vue public.prix_comparables
-- (PHASE_7_vue_prix_comparables_v2_1.sql:12-14, 100-107) résout DÉJÀ
-- fusionne_vers_id à la lecture :
--   "Lorsqu'un magasin source est marqué « fusionne », la vue conserve la
--    provenance du prix mais expose le magasin canonique indiqué par
--    fusionne_vers_id pour les comparaisons."
-- Réécrire prix.magasin_id serait redondant avec ce que la vue fait déjà,
-- et effacerait la provenance réelle (le magasin où le prix a été observé)
-- que le schéma prend explicitement soin de préserver. Les 3 prix du Drive
-- restent donc rattachés à a823fc27-c7e4-4c6d-b87c-bf18692a528c ; ils
-- apparaîtront resolus vers le magasin canonique via prix_comparables
-- (vérifié en fin de script).

-- 2.a — E.Leclerc Drive Marseille Sormiou -> Leclerc, Baou de Sormiou
UPDATE public.magasins
SET statut = 'fusionne',
    fusionne_vers_id = 'a1000007-0000-0000-0000-000000000007'
WHERE id = 'a823fc27-c7e4-4c6d-b87c-bf18692a528c';

-- 2.b — Magasin non identifié -> U Express (même adresse, 0 prix rattaché)
UPDATE public.magasins
SET statut = 'fusionne',
    fusionne_vers_id = 'a1000012-0000-0000-0000-000000000012'
WHERE id = 'a1000015-0000-0000-0000-000000000015';

-- =============================================================================
-- 3. CORRESPONDANCES VALIDÉES (17 lignes)
-- =============================================================================
INSERT INTO public.correspondance_magasins (store_id_legacy, magasin_id, commentaire) VALUES
  ('c42e3f20-ce8a-4937-90f6-02a6bd1489c8', 'a1000002-0000-0000-0000-000000000002', 'validé GPS/terrain François 6 juil 2026 — Carrefour Mazargues'),
  ('fcec5b71-b78b-47fe-81de-ed123fe47c2d', 'a1000003-0000-0000-0000-000000000003', 'validé GPS/terrain François 6 juil 2026 — Carrefour Claude Bernard'),
  ('c9dcd7a0-7b02-461c-9dc3-eeb36c5c41b3', 'a1000004-0000-0000-0000-000000000004', 'validé GPS/terrain François 6 juil 2026 — Carrefour Hambourg'),
  ('75e3c649-ca58-4b21-8a4f-61c4f2f73a2b', 'a1000005-0000-0000-0000-000000000005', 'validé GPS/terrain François 6 juil 2026 — Franprix'),
  ('3c7ed9f1-112b-47d8-8cbf-c4dbfbaee955', 'a1000006-0000-0000-0000-000000000006', 'validé GPS/terrain François 6 juil 2026 — Intermarché'),
  ('f412c7ce-90c6-4e8d-a47c-92ef996207d3', 'a1000008-0000-0000-0000-000000000008', 'validé GPS/terrain François 6 juil 2026 — Leclerc Les Sablettes'),
  ('ba832612-96dd-4fe0-b3ae-ac06688134af', 'a1000007-0000-0000-0000-000000000007', 'validé GPS/terrain François 6 juil 2026 — Leclerc Sormiou'),
  ('20dca58a-91fe-4902-a8ad-746042f8e240', 'a1000007-0000-0000-0000-000000000007', 'validé GPS/terrain François 6 juil 2026 — Leclerc Sormiou, doublon legacy assumé'),
  ('e648f3f4-97a5-486f-bec7-b245b3764cb0', 'a1000009-0000-0000-0000-000000000009', 'validé GPS/terrain François 6 juil 2026 — Lidl Pointe Rouge'),
  ('8ad91c3c-7021-432f-9e10-49da964f3dec', 'a1000010-0000-0000-0000-000000000010', 'validé GPS/terrain François 6 juil 2026 — Lidl Prado'),
  ('544e7918-d5a0-4123-9e3c-2fd34fa819c0', 'a1000011-0000-0000-0000-000000000011', 'validé GPS/terrain François 6 juil 2026 — Netto'),
  ('35709add-6c53-4f23-a8cc-9351a80b0b87', 'a1000001-0000-0000-0000-000000000001', 'validé GPS/terrain François 6 juil 2026 — Utile Sanary'),
  ('4185061a-90e0-4852-9c91-35d7409998ff', 'a1000001-0000-0000-0000-000000000001', 'validé GPS/terrain François 6 juil 2026 — Utile Sanary, écart GPS 2,3 km mais même magasin confirmé terrain'),
  ('72fdc871-c856-47fb-b57a-fda10fc4bd59', 'a1000013-0000-0000-0000-000000000013', 'validé GPS/terrain François 6 juil 2026 — Vival Pointe Rouge'),
  ('4d69efb3-68f5-4ad5-a5fd-f40fde2bc86d', 'a1000014-0000-0000-0000-000000000014', 'validé GPS/terrain François 6 juil 2026 — Vival Tiboulen'),
  ('9e463f6f-fef4-42c2-b5c5-12d4dc0d74a1', 'a1000012-0000-0000-0000-000000000012', 'validé GPS/terrain François 6 juil 2026 — U Express, slug legacy superu'),
  ('21edf731-4478-49ab-80e0-b38ac2816002', 'a1000012-0000-0000-0000-000000000012', 'validé GPS/terrain François 6 juil 2026 — U Express, slug legacy superu');

COMMIT;

-- =============================================================================
-- 4. VÉRIFICATIONS (lecture seule, à lancer après le COMMIT)
-- =============================================================================

-- 4.1 — Nombre de correspondances (attendu : 17)
SELECT count(*) AS nb_correspondances FROM public.correspondance_magasins;

-- 4.2 — Les 2 magasins fusionnés
SELECT id, nom, statut, fusionne_vers_id
FROM public.magasins
WHERE statut = 'fusionne';

-- 4.3 — Prix encore rattachés au magasin Drive fusionné.
-- Attendu : 3 (inchangé, volontairement — voir commentaire section 2 ci-dessus,
-- ce n'est PAS une anomalie : prix.magasin_id garde sa provenance réelle).
SELECT count(*) AS nb_prix_encore_sur_drive
FROM public.prix
WHERE magasin_id = 'a823fc27-c7e4-4c6d-b87c-bf18692a528c';

-- 4.4 — Preuve que la vue résout bien ces 3 prix vers le magasin canonique
-- (magasin_id doit afficher a1000007-..., magasin_source_id doit afficher
-- l'id du Drive, magasin_a_ete_fusionne doit valoir true).
SELECT prix_id, magasin_id, magasin_source_id, magasin_a_ete_fusionne
FROM public.prix_comparables
WHERE magasin_source_id = 'a823fc27-c7e4-4c6d-b87c-bf18692a528c';
