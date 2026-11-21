-- Chantier 169 (21/11/2026) — appliqué en prod par le connecteur Supabase.
-- La fiche proposée par ranger-produit est refusée si elle porte un
-- pourcentage (matière grasse…) différent de celui du ticket ou d'Open Food
-- Facts. Constat : « AUCHAN SH FB 5% 4X.. » rangé dans « Steak haché pur bœuf
-- 15% MG ». Ancienne définition sauvegardée dans _sauv_fonction_creer_produit_20261121.
insert into public._sauv_fonction_creer_produit_20261121 (def)
  values (pg_get_functiondef('public.creer_produit_depuis_code_barres(uuid,text,jsonb)'::regprocedure));
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.creer_produit_depuis_code_barres(uuid,text,jsonb)'::regprocedure);
  n := replace(d,
    $a$    if v_produit_id is not null then v_ia_utilisee := true; v_raisons := array_append(v_raisons, 'rattache_par_ia'::text); end if;$a$,
    $b$    -- chantier 169 : pourcentage du ticket / d'OFF différent de celui de la fiche proposée -> proposition refusée
    if v_produit_id is not null then
      select array_agg(distinct replace(x[1], ',', '.')) into v_m
      from regexp_matches(coalesce(v_libelle_ticket, '') || ' ' || coalesce(v_nom_off, ''), '(\d+(?:[.,]\d+)?)\s*%', 'g') as x;
      if v_m is not null and exists (
        select 1 from regexp_matches((select nom_reference from public.produits where id = v_produit_id), '(\d+(?:[.,]\d+)?)\s*%', 'g') as y
        where not (replace(y[1], ',', '.') = any (v_m))) then
        v_produit_id := null; v_sous_cat := null;
        v_raisons := array_append(v_raisons, 'ia_refusee_taux_different'::text);
      end if;
    end if;
    if v_produit_id is not null then v_ia_utilisee := true; v_raisons := array_append(v_raisons, 'rattache_par_ia'::text); end if;$b$);
  if n = d then raise exception 'ligne à remplacer introuvable'; end if;
  execute n;
end $$;
