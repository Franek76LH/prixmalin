-- Chantier 124 — recherche catalogue v2 (ADDITIVE : l'ancienne fonction
-- rechercher_produits_catalogue n'est ni modifiée ni supprimée ; la prod
-- continue de l'appeler. Seule la branche de test appelle la v2.)
--
-- Défauts de la v1 relevés le 17/11 :
--   « coca-cola » (tiret) ne trouve rien ; « des pâtes » ramène des produits
--   sans rapport (le mot « des » est cherché comme un mot du produit) ;
--   tri alphabétique : « lait » propose « Chocolat au lait » avant le lait.
-- La v2 nettoie le terme (tirets, apostrophes, mots vides, pluriel) et classe
-- par ressemblance du NOM avant l'ordre alphabétique.

create or replace function public._mots_recherche(p_texte text)
returns text[]
language sql
stable
set search_path to 'pg_catalog', 'public', 'extensions'
as $f$
  select coalesce(array_agg(
           case when length(m) >= 4 then regexp_replace(m, '[sx]$', '') else m end
           order by ord), '{}')
  from unnest(regexp_split_to_array(
         regexp_replace(lower(extensions.unaccent(replace(replace(coalesce(p_texte, ''), 'œ', 'oe'), 'Œ', 'oe'))), '[^a-z0-9]+', ' ', 'g'),
         '\s+')) with ordinality as t(m, ord)
  where m <> ''
    and m not in ('du', 'de', 'des', 'la', 'le', 'les', 'l', 'd', 'un', 'une', 'au', 'aux', 'et', 'a');
$f$;

create or replace function public.rechercher_produits_catalogue_v2(p_terme text, p_enseigne uuid default null::uuid)
returns table(produit_id uuid, nom_reference text, marques text, formats text, dernier_prix numeric, dernier_prix_observe_le timestamp with time zone, deja_vu_dans_enseigne boolean)
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare v_mots text[]; v_cle text; v_bruts text[];
begin
  v_mots := public._mots_recherche(p_terme);
  -- Mots tels que tapés, accents CONSERVÉS (pluriel retiré) : sert seulement à
  -- départager « pâtes » et « pâté », que la recherche sans accent confond.
  select coalesce(array_agg(case when length(m) >= 4 then regexp_replace(m, '[sx]$', '') else m end), '{}')
    into v_bruts
    from unnest(regexp_split_to_array(regexp_replace(lower(coalesce(p_terme, '')), '[^[:alpha:][:digit:]]+', ' ', 'g'), '\s+')) as m
   where m <> '' and extensions.unaccent(m) not in ('du', 'de', 'des', 'la', 'le', 'les', 'l', 'd', 'un', 'une', 'au', 'aux', 'et', 'a');
  if array_length(v_mots, 1) is null then return; end if;
  v_cle := array_to_string(v_mots, ' ');
  if length(v_cle) < 2 then return; end if;

  return query
  with base as (
    select p.id, p.nom_reference as nom,
      public._mots_recherche(p.nom_reference) as mots_nom,
      (select string_agg(distinct mq.nom, ', ' order by mq.nom)
         from public.variantes_produit vp join public.marques mq on mq.id = vp.marque_id
        where vp.produit_id = p.id and vp.actif) as les_marques,
      (select string_agg(distinct
                 trim(trailing '.' from trim(to_char(vp.quantite_nette,'FM999999990.999')))
                 || ' ' || coalesce(vp.unite_quantite,''), ', ')
         from public.variantes_produit vp
        where vp.produit_id = p.id and vp.actif and vp.quantite_nette is not null
          and coalesce(vp.quantite_fiable, true) = true) as les_formats,
      array_to_string(public._mots_recherche(
        p.nom_reference || ' ' || coalesce(p.famille,'') || ' ' || coalesce(p.sous_famille,'')
        || ' ' || coalesce((select string_agg(distinct mq.nom,' ')
                              from public.variantes_produit vp join public.marques mq on mq.id=vp.marque_id
                             where vp.produit_id=p.id and vp.actif),'')
        || ' ' || coalesce((select string_agg(distinct a.libelle_alias,' ')
                              from public.alias_produits a
                             where a.produit_id=p.id and coalesce(a.statut,'actif')='actif'),'')
      ), ' ') as blob
    from public.produits p where p.actif = true
  ), candidats as (
    select b.*,
      case
        -- 0 : le nom EST ce qui est cherché (mêmes mots, ordre indifférent)
        when b.mots_nom @> v_mots and v_mots @> b.mots_nom then 0
        -- 1 : tous les mots cherchés sont dans le nom, qui commence par le premier
        when b.mots_nom @> v_mots and b.mots_nom[1] = v_mots[1] then 1
        -- 2 : tous les mots cherchés sont dans le nom
        when b.mots_nom @> v_mots then 2
        -- 3 : mots entiers trouvés ailleurs (marque, famille, libellé de caisse)
        when (select bool_and(b.blob ~ ('\m'||mot||'\M')) from unnest(v_mots) as mot) then 3
        -- 4 : début de mot
        when (select bool_and(b.blob ~ ('\m'||mot)) from unnest(v_mots) as mot) then 4
        else 5
      end as rang
    from base b
    where not exists (select 1 from unnest(v_mots) as mot where position(mot in b.blob) = 0)
  ), dp as (
    select distinct on (px.produit_id) px.produit_id as pid, px.prix_total, px.observe_le
    from public.prix px
    where px.produit_id in (select id from candidats)
      and px.archive = false and px.statut_validation <> 'rejete'
    order by px.produit_id, px.observe_le desc
  ), vus as (
    select distinct px.produit_id as pid
    from public.prix px join public.magasins m on m.id = px.magasin_id
    where p_enseigne is not null and m.enseigne_id = p_enseigne
      and px.produit_id in (select id from candidats)
  )
  select c.id, c.nom, c.les_marques, c.les_formats, d.prix_total, d.observe_le, (v.pid is not null)
  from candidats c
  left join dp d on d.pid = c.id
  left join vus v on v.pid = c.id
  order by c.rang,
           (not exists (select 1 from unnest(v_bruts) as mb where position(mb in lower(c.nom)) = 0)) desc,
           (v.pid is not null) desc, (d.pid is not null) desc, array_length(c.mots_nom, 1), c.nom
  limit 100;
end;
$function$;
