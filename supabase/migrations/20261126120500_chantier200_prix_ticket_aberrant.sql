-- Chantier 200 (= 143-D, 26/11/2026) — un prix de ticket aberrant n'entre pas tout seul dans le comparateur.
-- Décision de François (26/11, 11h53 et 11h56) : les prix des tickets entrent tout de suite, SAUF un prix
-- aberrant, mis de côté pour vérification. Aberrant = format à quantité fiable, au moins 2 autres prix
-- validés du MÊME format, et prix >= 2 × leur médiane, ou <= médiane / 2,5 (une promo ne doit pas être bloquée).
-- Seuils = réglages parametres_globaux (prix_aberrant_facteur_haut, prix_aberrant_facteur_bas, prix_aberrant_min_autres),
-- valeurs par défaut dans la fonction : aucune ligne à créer.
-- Ancienne version du déclencheur : table _sauv_fonction_valider_auto_200.
-- APPLIQUÉ EN PROD le 26/11/2026 à 12h02 via MCP Supabase (feu vert écrit de François à 12h00).
-- Retour arrière : recréer valider_auto_prix_ticket depuis _sauv_fonction_valider_auto_200.definition.

CREATE OR REPLACE FUNCTION public.prix_ticket_est_aberrant(p_variante uuid, p_prix numeric)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH reglages AS (
    SELECT
      COALESCE((SELECT nullif(valeur,'')::numeric FROM public.parametres_globaux WHERE cle = 'prix_aberrant_facteur_haut'), 2)   AS haut,
      COALESCE((SELECT nullif(valeur,'')::numeric FROM public.parametres_globaux WHERE cle = 'prix_aberrant_facteur_bas'), 2.5)  AS bas,
      COALESCE((SELECT nullif(valeur,'')::int     FROM public.parametres_globaux WHERE cle = 'prix_aberrant_min_autres'), 2)    AS min_autres
  ),
  autres AS (
    SELECT p.prix_total AS x
    FROM public.prix p
    WHERE p.variante_produit_id = p_variante
      AND p.statut_validation = 'valide'
      AND p.archive = false
      AND p.prix_total > 0
  ),
  stats AS (
    SELECT count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY x) AS med FROM autres
  )
  SELECT CASE
    WHEN p_variante IS NULL OR p_prix IS NULL OR p_prix <= 0 THEN false
    WHEN NOT COALESCE((SELECT v.quantite_fiable FROM public.variantes_produit v WHERE v.id = p_variante), true) THEN false
    WHEN (SELECT n FROM stats) < (SELECT min_autres FROM reglages) THEN false
    ELSE p_prix >= (SELECT haut FROM reglages) * (SELECT med FROM stats)
      OR p_prix <= (SELECT med FROM stats) / (SELECT bas FROM reglages)
  END;
$function$;

-- Pas de retrait de droit pour authenticated : le déclencheur s'exécute avec les droits de celui qui
-- insère le prix, et un refus ferait échouer l'enregistrement du ticket. La fonction ne rend qu'un booléen.
REVOKE ALL ON FUNCTION public.prix_ticket_est_aberrant(uuid, numeric) FROM anon;

CREATE OR REPLACE FUNCTION public.valider_auto_prix_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.source = 'ticket' and new.statut_validation = 'en_attente' then
    -- Chantier 200 : un prix aberrant reste « en attente » (hors comparateur,
    -- points en attente) jusqu'à la décision de l'administrateur.
    if public.prix_ticket_est_aberrant(new.variante_produit_id, new.prix_total) then
      return new;
    end if;
    new.statut_validation := 'valide';
    new.valide_le := coalesce(new.valide_le, now());
  end if;
  return new;
end;
$function$;

-- Écran admin « Prix à vérifier » : la liste…
CREATE OR REPLACE FUNCTION public.lister_prix_a_verifier()
 RETURNS TABLE(id uuid, observe_le timestamptz, prix_total numeric, mediane numeric, nb_autres integer,
               nom_produit text, nom_marque text, quantite_nette numeric, unite_quantite text, nombre_unites numeric,
               libelle_ticket text, quantite_ticket numeric, nom_magasin text, nom_enseigne text, releve_par_pseudo text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.est_administrateur() then
    raise exception 'ADMIN_REQUIS';
  end if;
  return query
  select p.id, p.observe_le::timestamptz, p.prix_total::numeric,
    (select round(percentile_cont(0.5) within group (order by o.prix_total)::numeric, 2)
       from public.prix o where o.variante_produit_id = p.variante_produit_id and o.statut_validation = 'valide' and o.archive = false and o.prix_total > 0),
    (select count(*)::int from public.prix o where o.variante_produit_id = p.variante_produit_id and o.statut_validation = 'valide' and o.archive = false and o.prix_total > 0),
    pr.nom_reference::text, ma.nom::text, v.quantite_nette::numeric, v.unite_quantite::text, v.nombre_unites::numeric,
    l.libelle_ticket::text, l.quantite::numeric, m.nom::text, e.nom::text, pf.pseudo::text
  from public.prix p
  join public.produits pr on pr.id = p.produit_id
  left join public.variantes_produit v on v.id = p.variante_produit_id
  left join public.marques ma on ma.id = v.marque_id
  left join public.lignes_ticket l on l.id = p.ligne_ticket_id
  left join public.magasins m on m.id = p.magasin_id
  left join public.enseignes e on e.id = m.enseigne_id
  left join public.profiles pf on pf.id = p.utilisateur_id
  where p.source = 'ticket' and p.statut_validation = 'en_attente' and p.archive = false
  order by p.observe_le desc nulls last;
end;
$function$;

-- … et la décision (valider = entre dans le comparateur ; rejeter = n'y entre jamais, points refusés).
CREATE OR REPLACE FUNCTION public.decider_prix_a_verifier(p_prix_id uuid, p_valider boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.est_administrateur() then
    raise exception 'ADMIN_REQUIS';
  end if;
  update public.prix
     set statut_validation = case when p_valider then 'valide' else 'rejete' end,
         valide_le = case when p_valider then now() else null end
   where id = p_prix_id and source = 'ticket' and statut_validation = 'en_attente' and archive = false;
  if not found then
    raise exception 'PRIX_INTROUVABLE_OU_DEJA_TRAITE';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.lister_prix_a_verifier() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decider_prix_a_verifier(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lister_prix_a_verifier() TO authenticated;
GRANT EXECUTE ON FUNCTION public.decider_prix_a_verifier(uuid, boolean) TO authenticated;
