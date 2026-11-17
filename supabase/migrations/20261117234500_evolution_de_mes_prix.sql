-- Chantier 145 — évolution du prix de MES produits, et baisses notables
-- (ADDITIF : une fonction de lecture, aucune table ni donnée modifiée).
--
-- « Mes produits » = les variantes (produit + marque + format) pour lesquelles
-- la personne connectée a déjà relevé un prix. On ne compare jamais deux
-- formats différents : tout est calculé par variante.
--
-- Baisse notable = dans un MÊME magasin, le dernier prix relevé (par n'importe
-- qui) est inférieur d'au moins 8 % ET d'au moins 0,10 € au relevé précédent
-- de ce magasin (et de 45 % au plus), et il date de moins de 60 jours. Comparer deux magasins
-- différents, c'est le travail du comparateur, pas une « baisse ».
--
-- Ne rend que des prix, des dates et des noms de magasins : jamais qui a relevé quoi.
create or replace function public.evolution_de_mes_prix()
returns json
language sql
stable security definer
set search_path to 'pg_catalog', 'public'
as $f$
  with p as (
    select x.variante_produit_id as v, x.magasin_id as m, x.prix_total as px, x.observe_le as d, x.utilisateur_id as u, x.source as src
    from public.prix x
    where x.archive = false and x.statut_validation <> 'rejete'
      and x.variante_produit_id is not null and x.prix_total > 0
  ), miennes as (
    -- relevés faits par la personne elle-même (ticket ou saisie), pas les imports
    select distinct v from p where u = auth.uid() and src in ('ticket', 'manuel')
  ), s as (
    select p.v, p.m, p.px, p.d from p join miennes using (v)
  ), rangs as (
    select s.*,
           row_number() over (partition by v, m order by d desc) as r,
           lead(px) over (partition by v, m order by d desc) as px_avant
    from s
  ), baisses as (
    select distinct on (v) v, m, px as apres, px_avant as avant, d,
           round((1 - px / px_avant) * 100) as pct
    from rangs
    where r = 1 and px_avant is not null
      and px < px_avant * 0.92 and px_avant - px >= 0.10
      -- au-delà de 45 %, c'est presque toujours une quantité différente (2 achetés
      -- contre 1), pas une baisse : on n'alerte pas, la courbe le montre quand même
      and px >= px_avant * 0.55
      and d >= now() - interval '60 days'
    order by v, (1 - px / px_avant) desc
  ), compte as (
    select v, count(*) as n from s group by v having count(*) >= 2
  ), lignes as (
    select json_build_object(
      'variante_id', c.v,
      'produit', pr.nom_reference,
      'marque', mq.nom,
      'format', nullif(trim(
          coalesce(trim(to_char(vp.quantite_nette, 'FM999990.###'), '.') || ' ' || coalesce(vp.unite_quantite, ''), '')
          || case when coalesce(vp.nombre_unites, 1) > 1 then ' × ' || vp.nombre_unites else '' end), ''),
      'nb', c.n,
      'baisse', case when b.v is not null then json_build_object(
          'avant', b.avant, 'apres', b.apres, 'pct', b.pct, 'magasin', mg.nom, 'date', b.d) end,
      'points', (
        select json_agg(json_build_object('d', q.d, 'p', q.px, 'm', m2.nom) order by q.d)
        from (select s.m, s.px, s.d from s where s.v = c.v order by s.d desc limit 40) q
        left join public.magasins m2 on m2.id = q.m)
    ) as obj, b.pct, pr.nom_reference as nom
    from compte c
    join public.variantes_produit vp on vp.id = c.v
    join public.produits pr on pr.id = vp.produit_id
    left join public.marques mq on mq.id = vp.marque_id
    left join baisses b on b.v = c.v
    left join public.magasins mg on mg.id = b.m
  )
  select coalesce(json_agg(obj order by pct desc nulls last, nom), '[]'::json) from lignes;
$f$;

revoke all on function public.evolution_de_mes_prix() from public, anon;
grant execute on function public.evolution_de_mes_prix() to authenticated;
