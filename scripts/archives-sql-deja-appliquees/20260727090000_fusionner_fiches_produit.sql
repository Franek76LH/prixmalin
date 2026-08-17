-- Chantier "modèle produit", étape 2 — outil de fusion de fiches produit
-- réutilisable. Réservé admin, atomique, ne fusionne aucune donnée tant
-- qu'on ne l'appelle pas explicitement (la migration ne crée QUE la
-- fonction, aucune ligne n'est déplacée ou supprimée par ce fichier).
--
-- Difficulté centrale : plusieurs tables référencent une variante par le
-- COUPLE composite (variante_produit_id, produit_id) -> variantes_produit
-- (id, produit_id), via des contraintes NOT DEFERRABLE. Une contrainte NOT
-- DEFERRABLE est vérifiée à la fin de CHAQUE INSTRUCTION SQL (pas à la fin
-- de la transaction, pas ligne par ligne) : si on déplace
-- variantes_produit.produit_id dans une instruction UPDATE séparée, la
-- vérification déclenchée à la fin de CETTE instruction verrait aussitôt des
-- lignes filles (prix, alias_produits, ...) encore accrochées à l'ANCIEN
-- produit_id et lèverait une violation RESTRICT, avant même d'avoir eu la
-- main pour les mettre à jour à leur tour.
--
-- Solution : re-pointer variantes_produit ET toutes ses tables filles à
-- couple composite dans UNE SEULE instruction SQL (une chaîne de CTE de
-- modification -- WITH maj_x AS (UPDATE ... RETURNING ...), maj_y AS (...)
-- ...). Toute la chaîne ne compte que comme UNE instruction pour Postgres :
-- la vérification de contrainte n'a lieu qu'une fois, une fois que TOUTES
-- les tables de la chaîne sont déjà cohérentes entre elles.
-- (SET LOCAL session_replication_role='replica' a été envisagé mais écarté :
-- le rôle propriétaire des fonctions ici, "postgres", n'est PAS superuser
-- sur ce projet Supabase -- rolsuper=false, vérifié -- et n'a donc pas le
-- droit de changer ce paramètre.)
--
-- Deux dédoublonnages mécaniques, sans rapport avec la logique de contrainte
-- composite ci-dessus, sont nécessaires pour que la fusion puisse aboutir
-- quand une table a SA PROPRE contrainte UNIQUE indépendante liée à
-- produit_id :
-- - favoris : UNIQUE (utilisateur_id, produit_id). Si un utilisateur a déjà
--   la cible en favori ET une source (ou deux sources), le déplacement
--   créerait un doublon exact -> on ne garde que le plus ancien avant de
--   déplacer le reste.
-- - suggestions_alias_produit : deux index uniques partiels sur
--   (ligne_ticket_id, produit_id[, variante_produit_id]) WHERE statut =
--   'en_attente'. Même logique si la même ligne de ticket a une suggestion
--   en attente sur la cible ET sur une source.
-- Dans les deux cas il ne s'agit QUE de retirer un doublon structurel
-- (même utilisateur/même ligne de ticket, même cible finale) -- aucune
-- décision de fusion de données produit n'est prise ici.

create or replace function public.fusionner_fiches_produit(
  p_source_ids uuid[],
  p_cible_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_source_ids uuid[];
  v_nb_cible int;
  v_nb_sources int;
  v_nb_variantes int;
  v_nb_prix int;
  v_nb_alias int;
  v_nb_favoris int;
  v_nb_instantane int;
  v_nb_lignes_ticket int;
  v_nb_liste_courses int;
  v_nb_suggestions_ia int;
  v_nb_suggestions_alias int;
  v_nb_propositions_scan int;
  v_nb_historique int;
  v_nb_sources_supprimees int;
begin
  if not public.est_administrateur() then
    raise exception 'réservé admin';
  end if;

  if p_cible_id is null then
    raise exception 'p_cible_id est obligatoire';
  end if;

  -- Dédoublonne p_source_ids : sinon un id répété deux fois dans le tableau
  -- ferait échouer à tort la vérification d'existence ci-dessous
  -- (array_length compterait le doublon, count(*) sur produits non).
  select coalesce(array_agg(distinct s), '{}') into v_source_ids
  from unnest(p_source_ids) as s;

  if array_length(v_source_ids, 1) is null then
    raise exception 'p_source_ids ne peut pas être vide';
  end if;

  if p_cible_id = any(v_source_ids) then
    raise exception 'la fiche cible ne peut pas figurer parmi les fiches sources';
  end if;

  select count(*) into v_nb_cible from public.produits where id = p_cible_id;
  if v_nb_cible = 0 then
    raise exception 'fiche cible introuvable : %', p_cible_id;
  end if;

  select count(*) into v_nb_sources from public.produits where id = any(v_source_ids);
  if v_nb_sources <> array_length(v_source_ids, 1) then
    raise exception 'une ou plusieurs fiches sources sont introuvables';
  end if;

  -- Dédoublonnage favoris (voir commentaire en tête de fichier) : conserve
  -- pour chaque (utilisateur, cible-finale-après-fusion) la ligne la plus
  -- ancienne, supprime les autres AVANT le déplacement en masse plus bas.
  delete from public.favoris f
  using (
    select id, row_number() over (
      partition by utilisateur_id,
                   case when produit_id = any(v_source_ids) then p_cible_id else produit_id end
      order by cree_le asc, id asc
    ) as rn
    from public.favoris
    where produit_id = any(v_source_ids) or produit_id = p_cible_id
  ) doublons
  where f.id = doublons.id and doublons.rn > 1;

  -- Dédoublonnage suggestions_alias_produit en_attente (voir commentaire en
  -- tête de fichier), même principe. Le partitionnement par
  -- variante_produit_id regroupe correctement les lignes à variante NULL
  -- entre elles (PARTITION BY traite les NULL comme un groupe), ce qui
  -- correspond exactement au périmètre de l'index partiel "sans_variante".
  delete from public.suggestions_alias_produit s
  using (
    select id, row_number() over (
      partition by ligne_ticket_id,
                   case when produit_id = any(v_source_ids) then p_cible_id else produit_id end,
                   variante_produit_id
      order by cree_le asc, id asc
    ) as rn
    from public.suggestions_alias_produit
    where statut = 'en_attente'
      and (produit_id = any(v_source_ids) or produit_id = p_cible_id)
  ) doublons
  where s.id = doublons.id and doublons.rn > 1;

  -- Re-pointage en une seule instruction (voir commentaire en tête de
  -- fichier) : variantes_produit + toutes les tables filles à couple
  -- composite (variante_produit_id, produit_id), plus les tables à FK
  -- simple sur produit_id (propositions_liaison_scan, historique) rejointes
  -- ici par simplicité, sans contrainte d'ordre pour elles.
  with
  maj_variantes as (
    update public.variantes_produit
    set produit_id = p_cible_id, modifie_le = now()
    where produit_id = any(v_source_ids)
    returning 1
  ),
  maj_prix as (
    update public.prix
    set produit_id = p_cible_id, modifie_le = now()
    where produit_id = any(v_source_ids)
    returning 1
  ),
  maj_alias as (
    update public.alias_produits
    set produit_id = p_cible_id, modifie_le = now()
    where produit_id = any(v_source_ids)
    returning 1
  ),
  maj_favoris as (
    update public.favoris
    set produit_id = p_cible_id, modifie_le = now()
    where produit_id = any(v_source_ids)
    returning 1
  ),
  maj_instantane as (
    update public.lignes_instantane_recommandation
    set produit_id = p_cible_id
    where produit_id = any(v_source_ids)
    returning 1
  ),
  maj_lignes_ticket as (
    update public.lignes_ticket
    set
      produit_id = case when produit_id = any(v_source_ids) then p_cible_id else produit_id end,
      produit_suggere_ia_id = case when produit_suggere_ia_id = any(v_source_ids) then p_cible_id else produit_suggere_ia_id end,
      modifie_le = now()
    where produit_id = any(v_source_ids) or produit_suggere_ia_id = any(v_source_ids)
    returning 1
  ),
  maj_liste_courses as (
    update public.liste_courses
    set produit_id = p_cible_id, modifie_le = now()
    where produit_id = any(v_source_ids)
    returning 1
  ),
  maj_suggestions_ia as (
    update public.suggestions_alias_core_ia
    set produit_id = p_cible_id
    where produit_id = any(v_source_ids)
    returning 1
  ),
  maj_suggestions_alias as (
    update public.suggestions_alias_produit
    set produit_id = p_cible_id, modifie_le = now()
    where produit_id = any(v_source_ids)
    returning 1
  ),
  maj_propositions_scan as (
    update public.propositions_liaison_scan
    set produit_id = p_cible_id
    where produit_id = any(v_source_ids)
    returning 1
  ),
  maj_historique as (
    update public.historique_corrections_association
    set
      ancien_produit_id = case when ancien_produit_id = any(v_source_ids) then p_cible_id else ancien_produit_id end,
      nouveau_produit_id = case when nouveau_produit_id = any(v_source_ids) then p_cible_id else nouveau_produit_id end
    where ancien_produit_id = any(v_source_ids) or nouveau_produit_id = any(v_source_ids)
    returning 1
  )
  select
    (select count(*) from maj_variantes),
    (select count(*) from maj_prix),
    (select count(*) from maj_alias),
    (select count(*) from maj_favoris),
    (select count(*) from maj_instantane),
    (select count(*) from maj_lignes_ticket),
    (select count(*) from maj_liste_courses),
    (select count(*) from maj_suggestions_ia),
    (select count(*) from maj_suggestions_alias),
    (select count(*) from maj_propositions_scan),
    (select count(*) from maj_historique)
  into
    v_nb_variantes, v_nb_prix, v_nb_alias, v_nb_favoris, v_nb_instantane,
    v_nb_lignes_ticket, v_nb_liste_courses, v_nb_suggestions_ia,
    v_nb_suggestions_alias, v_nb_propositions_scan, v_nb_historique;

  -- Les fiches sources n'ont plus aucune référence : suppression finale.
  delete from public.produits where id = any(v_source_ids);
  get diagnostics v_nb_sources_supprimees = row_count;

  return jsonb_build_object(
    'cible_id', p_cible_id,
    'sources_supprimees', v_nb_sources_supprimees,
    'variantes_deplacees', v_nb_variantes,
    'prix_deplaces', v_nb_prix,
    'alias_deplaces', v_nb_alias,
    'favoris_deplaces', v_nb_favoris,
    'lignes_instantane_deplacees', v_nb_instantane,
    'lignes_ticket_deplacees', v_nb_lignes_ticket,
    'liste_courses_deplacees', v_nb_liste_courses,
    'suggestions_ia_deplacees', v_nb_suggestions_ia,
    'suggestions_alias_deplacees', v_nb_suggestions_alias,
    'propositions_scan_deplacees', v_nb_propositions_scan,
    'historique_deplace', v_nb_historique
  );
end;
$$;

grant execute on function public.fusionner_fiches_produit(uuid[], uuid) to authenticated;
