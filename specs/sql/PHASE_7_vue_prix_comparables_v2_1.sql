-- =============================================================================
-- PRIXMALIN — PHASE 7 : VUE SÉCURISÉE DES PRIX COMPARABLES
-- Version : 2.1 | Date : 2026-06-30
--
-- PRINCIPES
--   - SECURITY INVOKER : droits et RLS de l'utilisateur appelant.
--   - SECURITY BARRIER : le filtre de sécurité est appliqué avant les fonctions
--     ou opérateurs éventuellement ajoutés par une requête appelante.
--   - Aucun identifiant du contributeur n'est exposé.
--   - Seuls les prix validés, non archivés et rattachés à des objets actifs
--     apparaissent dans le comparateur.
--   - Lorsqu'un magasin source est marqué « fusionne », la vue conserve la
--     provenance du prix mais expose le magasin canonique indiqué par
--     fusionne_vers_id pour les comparaisons.
--
-- PRÉREQUIS
--   - La politique RLS de public.magasins créée en phase 2 doit permettre la
--     lecture des statuts « actif » et « fusionne » aux utilisateurs
--     authentifiés. Les magasins « ferme » restent exclus hors administration.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.prix_comparables') IS NOT NULL THEN
    RAISE EXCEPTION
      'La vue public.prix_comparables existe déjà. Vérifier avant toute modification.';
  END IF;
END;
$$;

CREATE VIEW public.prix_comparables
WITH (
  security_invoker = TRUE,
  security_barrier = TRUE
)
AS
SELECT
  px.id                               AS prix_id,
  px.produit_id,
  px.variante_produit_id,

  -- Le magasin_id exposé est le magasin canonique utilisé pour comparer.
  magasin_canonique.id                AS magasin_id,
  -- La provenance reste disponible sans altérer le ticket ou le prix source.
  magasin_source.id                   AS magasin_source_id,
  (magasin_source.id <> magasin_canonique.id) AS magasin_a_ete_fusionne,

  px.prix_total,
  px.quantite_reference,
  px.prix_unite_reference,
  px.unite_prix_reference,
  px.devise,
  px.type_prix,
  px.fin_promotion,
  px.observe_le,
  px.valide_jusqu_au,

  p.nom_reference                    AS nom_produit,
  p.type_unite,
  p.unite_base,

  vp.code_barres,
  vp.quantite_nette,
  vp.unite_quantite,
  vp.nombre_unites,
  vp.libelle                         AS libelle_variante,
  vp.est_bio,
  vp.nutri_score,

  m.nom                              AS nom_marque,
  m.est_mdd,

  sc.nom                             AS nom_sous_categorie,
  c.nom                              AS nom_categorie,

  magasin_canonique.nom              AS nom_magasin,
  magasin_canonique.adresse          AS adresse_magasin,
  magasin_canonique.code_postal,
  magasin_canonique.ville,
  magasin_canonique.latitude,
  magasin_canonique.longitude,

  e.nom                              AS nom_enseigne,
  e.slug                             AS slug_enseigne

FROM public.prix px
JOIN public.produits p
  ON p.id = px.produit_id
JOIN public.sous_categories sc
  ON sc.id = p.sous_categorie_id
JOIN public.categories c
  ON c.id = sc.categorie_id

-- Magasin réellement enregistré sur le prix ou le ticket.
JOIN public.magasins magasin_source
  ON magasin_source.id = px.magasin_id

-- Magasin utilisé dans le comparateur : le magasin source s'il est actif,
-- sinon sa cible canonique s'il est fusionné.
JOIN public.magasins magasin_canonique
  ON magasin_canonique.id = CASE
    WHEN magasin_source.statut = 'fusionne'
      THEN magasin_source.fusionne_vers_id
    ELSE magasin_source.id
  END

LEFT JOIN public.variantes_produit vp
  ON vp.id = px.variante_produit_id
LEFT JOIN public.marques m
  ON m.id = vp.marque_id
LEFT JOIN public.enseignes e
  ON e.id = magasin_canonique.enseigne_id
WHERE
  px.statut_validation = 'valide'
  AND px.archive = FALSE
  AND (px.valide_jusqu_au IS NULL OR px.valide_jusqu_au >= CURRENT_DATE)
  AND p.actif = TRUE
  AND sc.actif = TRUE
  AND c.visible = TRUE
  AND magasin_source.statut IN ('actif','fusionne')
  AND magasin_canonique.statut = 'actif'
  AND (vp.id IS NULL OR vp.actif = TRUE)
  AND (m.id IS NULL OR m.actif = TRUE)
  AND (e.id IS NULL OR e.actif = TRUE);

REVOKE ALL ON TABLE public.prix_comparables FROM anon, authenticated;
GRANT SELECT ON TABLE public.prix_comparables TO authenticated;

COMMENT ON VIEW public.prix_comparables IS
  'PrixMalin : prix validés et comparables, résolus vers le magasin canonique en cas de fusion, sans identifiant de contributeur.';

COMMIT;

-- =============================================================================
-- CHECKPOINT
-- =============================================================================
-- 1. Vérifier la vue :
-- SELECT viewname
-- FROM pg_views
-- WHERE schemaname = 'public'
--   AND viewname = 'prix_comparables';
--
-- 2. Vérifier les magasins fusionnés résolus :
-- SELECT magasin_source_id, magasin_id, magasin_a_ete_fusionne, COUNT(*)
-- FROM public.prix_comparables
-- GROUP BY magasin_source_id, magasin_id, magasin_a_ete_fusionne
-- ORDER BY magasin_a_ete_fusionne DESC, magasin_source_id;
-- =============================================================================
