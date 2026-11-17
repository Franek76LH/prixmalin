-- Chantier 139 — chiffres de la communauté pour l'accueil (ADDITIF : une
-- fonction de lecture, aucune table ni donnée modifiée).
--
-- Rend seulement des TOTAUX : jamais qui a relevé quoi. « mes_prix_30j » ne
-- concerne que l'utilisateur qui appelle (auth.uid()).
create or replace function public.stats_communaute()
returns json
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $f$
  select json_build_object(
    'prix_30j',          count(*) filter (where p.observe_le >= now() - interval '30 days'),
    'prix_total',        count(*),
    'produits',          count(distinct p.produit_id),
    'magasins',          count(distinct p.magasin_id),
    'contributeurs_30j', count(distinct p.utilisateur_id) filter (where p.observe_le >= now() - interval '30 days'),
    'mes_prix_30j',      count(*) filter (where p.observe_le >= now() - interval '30 days' and p.utilisateur_id = auth.uid())
  )
  from public.prix p
  where p.archive = false and p.statut_validation <> 'rejete';
$f$;

revoke all on function public.stats_communaute() from public, anon;
grant execute on function public.stats_communaute() to authenticated;
