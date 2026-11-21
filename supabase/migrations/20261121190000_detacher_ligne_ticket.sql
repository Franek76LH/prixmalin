-- Chantier 170 (21/11/2026) — « Ce n'est pas ça » sur une ligne de ticket DÉJÀ
-- rattachée, quelle que soit la façon (confirmation d'une suggestion, mémoire
-- d'enseigne, scan, correction). Constat : Pepsi Zéro validé « Cola » par
-- erreur, impossible à corriger depuis l'app.
-- Défait, pour cette ligne seulement : le prix créé à partir d'elle (et ses
-- points), l'alias du texte de caisse créé par l'utilisateur vers ce produit,
-- et la mémoire d'enseigne qui ferait recommencer l'erreur au prochain ticket.
-- Ne supprime AUCUNE fiche ni variante. Trace dans historique_corrections_association.
create or replace function public.detacher_ligne_ticket(p_ligne_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'extensions'
as $function$
declare
  v_user uuid := auth.uid();
  v_l record;
  v_enseigne_id uuid;
  v_norm text;
  v_prix_id uuid;
  v_n_prix int := 0;
  v_n_alias int := 0;
  v_n_corr int := 0;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select lt.*, t.utilisateur_id as ticket_user, t.magasin_id into v_l
  from public.lignes_ticket lt join public.tickets t on t.id = lt.ticket_id
  where lt.id = p_ligne_ticket_id for update of lt;
  if not found then return jsonb_build_object('succes', false, 'message', 'Ligne introuvable'); end if;
  if v_l.ticket_user <> v_user then raise exception 'NOT_AUTHORIZED'; end if;
  if v_l.produit_id is null then return jsonb_build_object('succes', false, 'message', 'Ligne déjà non rattachée'); end if;

  select enseigne_id into v_enseigne_id from public.magasins where id = v_l.magasin_id;

  for v_prix_id in select id from public.prix where ligne_ticket_id = p_ligne_ticket_id loop
    delete from public.mouvements_points where reference_type = 'prix' and reference_id = v_prix_id;
    delete from public.prix where id = v_prix_id;
    v_n_prix := v_n_prix + 1;
  end loop;

  delete from public.alias_produits
  where produit_id = v_l.produit_id and cree_par = v_user
    and lower(trim(libelle_alias)) = lower(trim(coalesce(v_l.libelle_ticket, '')));
  get diagnostics v_n_alias = row_count;

  if v_enseigne_id is not null and v_l.libelle_ticket is not null then
    v_norm := public.normaliser_libelle_ticket(v_l.libelle_ticket);
    delete from public.correspondances_ticket_enseigne
    where enseigne_id = v_enseigne_id and libelle_ticket_normalise = v_norm and produit_id = v_l.produit_id;
    get diagnostics v_n_corr = row_count;
  end if;

  insert into public.historique_corrections_association (ligne_ticket_id, ancien_produit_id, ancienne_variante_id, nouveau_produit_id, nouvelle_variante_id, motif, corrige_par)
  values (p_ligne_ticket_id, v_l.produit_id, v_l.variante_produit_id, v_l.produit_id, null, 'detachement_utilisateur', v_user);

  update public.lignes_ticket set
    produit_id = null, variante_produit_id = null,
    produit_suggere_ia_id = null, variante_suggeree_ia_id = null,
    statut_validation_produit = 'non_valide', methode_validation_produit = null, produit_valide_le = null, produit_valide_par = null,
    statut_validation_variante = 'non_validee', methode_validation_variante = null, variante_validee_le = null, variante_validee_par = null,
    association_corrigee_utilisateur = false, sans_code_barres = false, sans_code_barres_le = null, modifie_le = now()
  where id = p_ligne_ticket_id;

  return jsonb_build_object('succes', true, 'message', 'Ligne détachée',
    'prix_supprimes', v_n_prix, 'alias_supprimes', v_n_alias, 'memoires_supprimees', v_n_corr);
end;
$function$;
revoke all on function public.detacher_ligne_ticket(uuid) from public, anon;
grant execute on function public.detacher_ligne_ticket(uuid) to authenticated;
