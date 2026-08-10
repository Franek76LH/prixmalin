-- Chantier 87 — Recherche catalogue par famille (accordéon complet).
--
-- Nouveau RPC DÉDIÉ au catalogue, distinct de rechercher_produits_pour_correction
-- (qui reste INTACT car partagé avec le rapprochement des tickets de caisse).
--
-- Seule différence de fond avec le RPC ticket : chaque mot du terme doit
-- apparaître dans la concaténation nom_reference + famille + sous_famille
-- (unaccent + minuscules), et non plus dans le seul nom_reference. Ainsi taper
-- « pâtes » remonte Penne / Fusilli / Spaghetti (dont la famille = « Pâtes »).
--
-- Mêmes garde-fous que l'original : min 2 caractères utiles, extensions.unaccent
-- (jamais unaccent() seul), découpage multi-mots, actif = true, SECURITY DEFINER,
-- même search_path. Limite élargie à 100 (l'accordéon regroupe ensuite par
-- famille côté front, et recharge la famille complète pour ne jamais tronquer).
CREATE OR REPLACE FUNCTION public.rechercher_produits_catalogue(p_terme text)
 RETURNS TABLE(produit_id uuid, nom_reference text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_normalise text;
  v_mots text[];
BEGIN
  -- Règle du projet : toujours extensions.unaccent(...), jamais unaccent() seul.
  v_normalise := trim(both ' ' from lower(extensions.unaccent(coalesce(p_terme, ''))));

  -- Garde-fou : moins de 2 caractères utiles => aucun résultat.
  IF length(v_normalise) < 2 THEN
    RETURN;
  END IF;

  v_mots := array_remove(regexp_split_to_array(v_normalise, '\s+'), '');

  IF array_length(v_mots, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.nom_reference
  FROM public.produits p
  WHERE p.actif = true
    AND NOT EXISTS (
      SELECT 1 FROM unnest(v_mots) AS mot
      WHERE position(
        mot IN lower(extensions.unaccent(
          p.nom_reference
          || ' ' || coalesce(p.famille, '')
          || ' ' || coalesce(p.sous_famille, '')
        ))
      ) = 0
    )
  ORDER BY p.nom_reference
  LIMIT 100;
END;
$function$;

-- Droits identiques à l'ancien RPC (PUBLIC a déjà EXECUTE par défaut ; on
-- explicite anon/authenticated pour l'appel depuis l'app cliente).
GRANT EXECUTE ON FUNCTION public.rechercher_produits_catalogue(text) TO anon, authenticated, service_role;
