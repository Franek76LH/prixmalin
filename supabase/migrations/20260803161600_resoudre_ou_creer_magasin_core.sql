-- LOT 1 « reconnaissance magasin au scan » — étape 2/2 : RPC de création Core.
--
-- Appelée par le front (resoudreOuCreerStore) JUSTE APRÈS insertStoreInDB, une
-- fois qu'on a une fiche legacy `stores` (p_store_legacy_id) + l'adresse
-- d'en-tête corrigée par l'utilisateur. La RPC :
--   0) idempotence : si le legacy est déjà rattaché -> renvoie le magasin lié ;
--   1) enseigne : slug front -> enseigne_id (tolérant, '-' ignoré), sinon NULL ;
--   2) anti-doublon parmi les magasins ACTIFS de la même enseigne :
--        - GPS < 150 m OU (même code postal ET trigram(adresse) >= 0.85)
--          -> RATTACHE le magasin existant (aucune création) ;
--        - 0.70 <= trigram < 0.85 (zone grise) -> renvoie 'ambigu' + candidat,
--          le front demande à l'utilisateur (« ce magasin, ou un nouveau ? ») ;
--   3) sinon -> CRÉE la fiche `magasins` (source='scan', statut='actif') puis la
--      correspondance legacy -> magasin.
-- Toutes les correspondances sont posées en ON CONFLICT DO NOTHING (idempotent :
-- correspondance_magasins.store_id_legacy est clé primaire).
--
-- Le front peut re-appeler la RPC après le choix utilisateur de la zone grise :
--   * p_rattacher_magasin_id -> rattache ce magasin ;
--   * p_forcer_creation=true -> saute l'anti-doublon et crée.
--
-- SECURITY DEFINER : les INSERT dans magasins / correspondance_magasins passent
-- outre la RLS (pas de policy d'écriture ouverte au front). Aucune modification
-- de enregistrer_ticket_core / resoudre_magasin_core : une fois la
-- correspondance créée, resoudre_magasin_core résout enfin -> ticket écrit.
--
-- Distance GPS calculée par haversine en SQL (ni cube ni earthdistance en base).
-- Trigram/unaccent via le schéma `extensions` (pg_trgm, unaccent) préfixés
-- explicitement, comme le reste du projet.

create or replace function public.resoudre_ou_creer_magasin_core(
  p_store_legacy_id      uuid,
  p_nom                  text,
  p_adresse              text,
  p_code_postal          text,
  p_ville                text,
  p_latitude             numeric,
  p_longitude            numeric,
  p_enseigne_slug        text,
  p_categorie            text    default null,
  p_forcer_creation      boolean default false,
  p_rattacher_magasin_id uuid    default null
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user         uuid := auth.uid();
  v_enseigne_id  uuid;
  v_enseigne_nom text;
  v_slug_norm    text;
  v_cp           text;
  v_categorie    text;
  v_nom          text;
  v_magasin_id  uuid;
  v_best_sim    real := 0;
  v_cand_id     uuid;
  v_cand_nom    text;
  v_cand_adr    text;
  v_dist        double precision;
  v_sim         real;
  r             record;
begin
  if v_user is null then
    return jsonb_build_object('statut', 'erreur', 'message', 'NOT_AUTHENTICATED');
  end if;

  -- 0) Idempotence : le legacy est déjà rattaché à un magasin Core
  select magasin_id into v_magasin_id
  from public.correspondance_magasins
  where store_id_legacy = p_store_legacy_id;
  if v_magasin_id is not null then
    return jsonb_build_object('statut', 'deja_rattache', 'magasin_id', v_magasin_id);
  end if;

  -- 1) Enseigne : slug front -> enseigne_id (tolérant : on ignore tout ce qui
  --    n'est pas alphanumérique, donc 'uexpress' matche 'u-express'). 'autre' ou
  --    inconnu -> enseigne_id NULL (autorisé).
  v_slug_norm := regexp_replace(lower(coalesce(p_enseigne_slug, '')), '[^a-z0-9]', '', 'g');
  if v_slug_norm <> '' and v_slug_norm <> 'autre' then
    select id, nom into v_enseigne_id, v_enseigne_nom
    from public.enseignes
    where regexp_replace(lower(slug), '[^a-z0-9]', '', 'g') = v_slug_norm
    limit 1;
  end if;

  v_cp        := nullif(btrim(coalesce(p_code_postal, '')), '');
  v_categorie := case when p_categorie in ('grande_surface', 'proximite') then p_categorie else null end;

  -- 2a) Zone grise déjà tranchée par l'utilisateur : rattacher le magasin choisi
  if p_rattacher_magasin_id is not null then
    if exists (select 1 from public.magasins where id = p_rattacher_magasin_id and statut = 'actif') then
      insert into public.correspondance_magasins (store_id_legacy, magasin_id, cree_par, commentaire)
      values (p_store_legacy_id, p_rattacher_magasin_id, v_user, 'scan: rattachement validé utilisateur')
      on conflict (store_id_legacy) do nothing;
      return jsonb_build_object('statut', 'rattache', 'magasin_id', p_rattacher_magasin_id);
    end if;
  end if;

  -- 2b) Anti-doublon (sauf création forcée)
  if not p_forcer_creation then
    for r in
      select id, nom, adresse, code_postal, latitude, longitude
      from public.magasins
      where statut = 'actif'
        and (v_enseigne_id is null or enseigne_id is not distinct from v_enseigne_id)
    loop
      -- Distance GPS (haversine, mètres) si les deux points existent
      v_dist := null;
      if p_latitude is not null and p_longitude is not null
         and r.latitude is not null and r.longitude is not null then
        v_dist := 2 * 6371000 * asin(sqrt(
            power(sin(radians((r.latitude  - p_latitude ) / 2)), 2)
          + cos(radians(p_latitude)) * cos(radians(r.latitude))
            * power(sin(radians((r.longitude - p_longitude) / 2)), 2)
        ));
      end if;

      -- Similarité de rue seulement si même code postal
      v_sim := 0;
      if v_cp is not null and r.code_postal = v_cp
         and p_adresse is not null and r.adresse is not null then
        v_sim := extensions.similarity(
          extensions.unaccent(lower(p_adresse)),
          extensions.unaccent(lower(r.adresse)));
      end if;

      -- Rattachement automatique fort
      if (v_dist is not null and v_dist < 150) or v_sim >= 0.85 then
        insert into public.correspondance_magasins (store_id_legacy, magasin_id, cree_par, commentaire)
        values (p_store_legacy_id, r.id, v_user,
                'scan: rattachement auto (dist='
                  || coalesce(round(v_dist::numeric)::text, '-') || 'm, sim='
                  || round(v_sim::numeric, 2) || ')')
        on conflict (store_id_legacy) do nothing;
        return jsonb_build_object('statut', 'rattache', 'magasin_id', r.id);
      end if;

      -- Meilleur candidat "zone grise"
      if v_sim > v_best_sim then
        v_best_sim := v_sim; v_cand_id := r.id; v_cand_nom := r.nom; v_cand_adr := r.adresse;
      end if;
    end loop;

    -- Zone grise : 0.70 <= sim < 0.85 -> on laisse l'utilisateur trancher
    if v_best_sim >= 0.70 and v_cand_id is not null then
      return jsonb_build_object(
        'statut', 'ambigu',
        'candidat', jsonb_build_object(
          'magasin_id', v_cand_id,
          'nom',        v_cand_nom,
          'adresse',    v_cand_adr,
          'similarite', round(v_best_sim::numeric, 2)));
    end if;
  end if;

  -- 3) Création de la fiche Core.
  -- Nom GARANTI non vide (CHECK magasins_nom_non_vide) : on retombe sur le nom
  -- d'enseigne si p_nom est vide/espaces, sinon sur un libellé générique. La RPC
  -- ne plante donc jamais sur un nom manquant.
  v_nom := coalesce(
    nullif(btrim(coalesce(p_nom, '')), ''),
    nullif(btrim(coalesce(v_enseigne_nom, '')), ''),
    'Magasin'
  );

  insert into public.magasins
    (enseigne_id, nom, adresse, code_postal, ville, latitude, longitude, statut, source, categorie)
  values
    (v_enseigne_id, v_nom, nullif(btrim(coalesce(p_adresse, '')), ''), v_cp,
     nullif(btrim(coalesce(p_ville, '')), ''), p_latitude, p_longitude, 'actif', 'scan', v_categorie)
  returning id into v_magasin_id;

  insert into public.correspondance_magasins (store_id_legacy, magasin_id, cree_par, commentaire)
  values (p_store_legacy_id, v_magasin_id, v_user, 'scan: magasin créé')
  on conflict (store_id_legacy) do nothing;

  return jsonb_build_object('statut', 'cree', 'magasin_id', v_magasin_id);
end;
$function$;

-- Accès calqué sur enregistrer_ticket_core : authenticated + service_role, pas anon.
revoke all on function public.resoudre_ou_creer_magasin_core(uuid,text,text,text,text,numeric,numeric,text,text,boolean,uuid) from public;
grant execute on function public.resoudre_ou_creer_magasin_core(uuid,text,text,text,text,numeric,numeric,text,text,boolean,uuid) to authenticated, service_role;
