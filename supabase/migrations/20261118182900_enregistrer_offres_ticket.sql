-- 18/11/2026 — Chantier 148 : fonction qui range dans le carnet (offres_promotion)
-- les offres constatées sur les lignes d'UN ticket de l'appelant.
-- Appliquée en prod le 18/11/2026 à 18h29. Essai à blanc fait et annulé : François
-- sur son ticket du 18/11 (1 offre écrite, 3 demandes invalides ignorées), Nico sur
-- le ticket de François (refus « ticket_introuvable »).
-- Le magasin, le produit, le prix normal, la quantité, la remise et la date viennent
-- de la base, jamais de l'app : l'app ne fournit que la règle comprise.
-- Retour arrière : drop function public.enregistrer_offres_ticket(uuid, jsonb);
create or replace function public.enregistrer_offres_ticket(p_ticket_id uuid, p_offres jsonb)
returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ticket record;
  v_offre jsonb;
  v_ligne record;
  v_ecrites int := 0;
  v_ignorees int := 0;
  n int;
begin
  if v_uid is null then return json_build_object('statut', 'refus', 'raison', 'non_connecte'); end if;
  if p_offres is null or jsonb_typeof(p_offres) <> 'array' or jsonb_array_length(p_offres) > 200 then
    return json_build_object('statut', 'refus', 'raison', 'offres_invalides');
  end if;
  select id, magasin_id, date_ticket into v_ticket from tickets where id = p_ticket_id and utilisateur_id = v_uid;
  if not found then return json_build_object('statut', 'refus', 'raison', 'ticket_introuvable'); end if;
  if v_ticket.magasin_id is null then return json_build_object('statut', 'refus', 'raison', 'magasin_inconnu'); end if;

  for v_offre in select * from jsonb_array_elements(p_offres) loop
    begin
      select l.id, l.produit_id, l.variante_produit_id, l.libelle_ticket, l.prix_unitaire, l.quantite, l.montant_remise
        into v_ligne
        from lignes_ticket l
       where l.id = (v_offre->>'ligne_ticket_id')::uuid and l.ticket_id = v_ticket.id and l.montant_remise > 0;
      if not found
         or (v_offre->>'mecanique') is null or (v_offre->>'origine') not in ('ticket_texte', 'ticket_chiffres')
         or (v_offre->>'mecanique') not in ('lot_gratuit', 'nieme_remise', 'pourcentage', 'montant', 'inconnue') then
        v_ignorees := v_ignorees + 1;
        continue;
      end if;
      insert into offres_promotion (magasin_id, produit_id, variante_produit_id, libelle_ticket, ligne_ticket_id, utilisateur_id,
                                    mecanique, parametres, origine, texte_imprime, prix_normal, quantite, montant_remise, vue_le)
      values (v_ticket.magasin_id, v_ligne.produit_id, v_ligne.variante_produit_id, v_ligne.libelle_ticket, v_ligne.id, v_uid,
              v_offre->>'mecanique',
              case when jsonb_typeof(v_offre->'parametres') = 'object' then v_offre->'parametres' else '{}'::jsonb end,
              v_offre->>'origine',
              nullif(left(btrim(coalesce(v_offre->>'texte_imprime', '')), 80), ''),
              nullif(v_ligne.prix_unitaire, 0), nullif(v_ligne.quantite, 0), v_ligne.montant_remise,
              coalesce(v_ticket.date_ticket, current_date))
      on conflict (ligne_ticket_id) where ligne_ticket_id is not null do nothing;
      get diagnostics n = row_count;
      if n = 1 then v_ecrites := v_ecrites + 1; else v_ignorees := v_ignorees + 1; end if;
    exception when others then
      v_ignorees := v_ignorees + 1;
    end;
  end loop;
  return json_build_object('statut', 'ok', 'offres_ecrites', v_ecrites, 'offres_ignorees', v_ignorees);
end;
$function$;
revoke all on function public.enregistrer_offres_ticket(uuid, jsonb) from public, anon;
grant execute on function public.enregistrer_offres_ticket(uuid, jsonb) to authenticated;
