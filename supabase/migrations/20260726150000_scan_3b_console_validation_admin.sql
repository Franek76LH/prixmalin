-- Chantier "Scan code-barres", bout 3B — console de validation admin.
-- Trois fonctions SECURITY DEFINER réservées à est_administrateur() :
-- - valider_proposition_scan : rejoue le mécanisme du bout 1
--   (relier_variante_scan_code_barres) pour valider une proposition.
-- - refuser_proposition_scan : marque une proposition refusée, sans
--   toucher aux données produit.
-- - lister_propositions_liaison_scan_en_attente : lecture jointe
--   (ligne de ticket + produit/variante/marque + pseudo du proposant) pour
--   la console. Nécessaire en SECURITY DEFINER (pas en embedding PostgREST
--   ni en vue security_invoker comme envisagé) car la policy RLS de lecture
--   sur lignes_ticket est strictement "t.utilisateur_id = auth.uid()", sans
--   volet admin : un admin ne peut pas lire le ticket d'un autre utilisateur
--   par une requête client classique, même via un embed FK.
-- Appliqué en base le 2026-07-26, vérifié (schéma, GRANT) avant et après.

create or replace function public.valider_proposition_scan(p_proposition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_prop public.propositions_liaison_scan;
  v_resultat jsonb;
begin
  if not public.est_administrateur() then
    raise exception 'réservé admin';
  end if;

  select * into v_prop from public.propositions_liaison_scan where id = p_proposition_id;
  if v_prop.id is null then
    raise exception 'proposition introuvable';
  end if;
  if v_prop.statut <> 'en_attente' then
    raise exception 'proposition déjà traitée';
  end if;

  v_resultat := public.relier_variante_scan_code_barres(
    v_prop.ligne_ticket_id, v_prop.produit_id, v_prop.variante_produit_id, v_prop.libelle_alias
  );

  update public.propositions_liaison_scan
  set statut = 'valide', traite_par = auth.uid(), traite_le = now()
  where id = p_proposition_id;

  return v_resultat;
end;
$$;

create or replace function public.refuser_proposition_scan(p_proposition_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.est_administrateur() then
    raise exception 'réservé admin';
  end if;
  update public.propositions_liaison_scan
  set statut = 'refuse', traite_par = auth.uid(), traite_le = now()
  where id = p_proposition_id and statut = 'en_attente';
  if not found then
    raise exception 'proposition introuvable ou déjà traitée';
  end if;
end;
$$;

grant execute on function public.valider_proposition_scan(uuid) to authenticated;
grant execute on function public.refuser_proposition_scan(uuid) to authenticated;

create or replace function public.lister_propositions_liaison_scan_en_attente()
returns table (
  id uuid,
  cree_le timestamptz,
  code_barres text,
  libelle_alias text,
  libelle_ticket text,
  produit_id uuid,
  variante_produit_id uuid,
  nom_produit text,
  libelle_variante text,
  quantite_nette numeric,
  unite_quantite text,
  url_image text,
  nom_marque text,
  propose_par uuid,
  propose_par_pseudo text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.est_administrateur() then
    raise exception 'réservé admin';
  end if;

  return query
    select
      p.id, p.cree_le, p.code_barres, p.libelle_alias,
      coalesce(lt.libelle_ticket, lt.libelle_brut),
      p.produit_id, p.variante_produit_id,
      pr.nom_reference,
      vp.libelle, vp.quantite_nette, vp.unite_quantite, vp.url_image,
      m.nom,
      p.propose_par,
      coalesce(pf.pseudo, pf.display_name)
    from public.propositions_liaison_scan p
    join public.lignes_ticket lt on lt.id = p.ligne_ticket_id
    join public.produits pr on pr.id = p.produit_id
    left join public.variantes_produit vp on vp.id = p.variante_produit_id
    left join public.marques m on m.id = vp.marque_id
    left join public.profiles pf on pf.id = p.propose_par
    where p.statut = 'en_attente'
    order by p.cree_le asc;
end;
$$;

grant execute on function public.lister_propositions_liaison_scan_en_attente() to authenticated;
