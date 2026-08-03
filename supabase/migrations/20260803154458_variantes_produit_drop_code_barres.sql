-- Chantier « codes-barres multiples » — étape 4c : retrait de
-- variantes_produit.code_barres (champ mort depuis la 4b).
--
-- Contexte : la 4a a redirigé la LECTURE du scan sur codes_barres_variante, la 4b
-- a basculé l'ÉCRITURE (INSERT dans codes_barres_variante). Le champ
-- variantes_produit.code_barres n'est donc plus ni lu ni écrit.
-- Seule dépendance : la vue prix_comparables (colonne vp.code_barres), non
-- consommée par le front (chargerPrixComparables fait select('*'), aucun code ne
-- lit ce champ). Rien d'autre ne dépend de la vue.
--
-- Postgres impose DROP VIEW + CREATE VIEW pour retirer une colonne d'une vue.
-- On préserve les options (security_invoker/security_barrier) et les privilèges
-- (authenticated -> SELECT, service_role -> ALL), à l'identique de l'existant.

-- 1) Retirer la dépendance de la vue à la colonne
drop view if exists public.prix_comparables;

-- 2) Supprimer la colonne (les 2 index/contraintes qui en dépendent —
--    variantes_produit_code_barres_key et idx_variantes_produit_code_barres —
--    tombent automatiquement).
alter table public.variantes_produit drop column code_barres;

-- 3) Recréer la vue À L'IDENTIQUE, SAUF la colonne vp.code_barres
create view public.prix_comparables
  with (security_invoker = true, security_barrier = true) as
 SELECT px.id AS prix_id,
    px.produit_id,
    px.variante_produit_id,
    magasin_canonique.id AS magasin_id,
    magasin_source.id AS magasin_source_id,
    magasin_source.id <> magasin_canonique.id AS magasin_a_ete_fusionne,
    px.prix_total,
    px.quantite_reference,
    px.prix_unite_reference,
    px.unite_prix_reference,
    px.devise,
    px.type_prix,
    px.fin_promotion,
    px.observe_le,
    px.valide_jusqu_au,
    p.nom_reference AS nom_produit,
    p.type_unite,
    p.unite_base,
    vp.quantite_nette,
    vp.unite_quantite,
    vp.nombre_unites,
    vp.libelle AS libelle_variante,
    vp.est_bio,
    vp.nutri_score,
    m.nom AS nom_marque,
    m.est_mdd,
    sc.nom AS nom_sous_categorie,
    c.nom AS nom_categorie,
    magasin_canonique.nom AS nom_magasin,
    magasin_canonique.adresse AS adresse_magasin,
    magasin_canonique.code_postal,
    magasin_canonique.ville,
    magasin_canonique.latitude,
    magasin_canonique.longitude,
    e.nom AS nom_enseigne,
    e.slug AS slug_enseigne
   FROM prix px
     JOIN produits p ON p.id = px.produit_id
     JOIN sous_categories sc ON sc.id = p.sous_categorie_id
     JOIN categories c ON c.id = sc.categorie_id
     JOIN magasins magasin_source ON magasin_source.id = px.magasin_id
     JOIN magasins magasin_canonique ON magasin_canonique.id =
        CASE
            WHEN magasin_source.statut = 'fusionne'::text THEN magasin_source.fusionne_vers_id
            ELSE magasin_source.id
        END
     LEFT JOIN variantes_produit vp ON vp.id = px.variante_produit_id
     LEFT JOIN marques m ON m.id = vp.marque_id
     LEFT JOIN enseignes e ON e.id = magasin_canonique.enseigne_id
  WHERE px.statut_validation = 'valide'::text
    AND px.archive = false
    AND (px.valide_jusqu_au IS NULL OR px.valide_jusqu_au >= CURRENT_DATE)
    AND p.actif = true
    AND sc.actif = true
    AND c.visible = true
    AND (magasin_source.statut = ANY (ARRAY['actif'::text, 'fusionne'::text]))
    AND magasin_canonique.statut = 'actif'::text
    AND (vp.id IS NULL OR vp.actif = true)
    AND (m.id IS NULL OR m.actif = true)
    AND (e.id IS NULL OR e.actif = true);

-- 4) Restaurer l'ACL EXACTE d'origine. La recréation d'une vue hérite des droits
--    par défaut Supabase du schéma public (anon + authenticated = ALL) ; on les
--    révoque pour ne garder que : authenticated -> SELECT, service_role -> ALL,
--    anon -> aucun (identique à l'existant avant la migration).
revoke all on public.prix_comparables from anon;
revoke all on public.prix_comparables from authenticated;
grant select on public.prix_comparables to authenticated;
grant all    on public.prix_comparables to service_role;
