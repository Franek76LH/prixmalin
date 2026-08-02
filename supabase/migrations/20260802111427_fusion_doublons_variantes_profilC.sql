-- Chantier « codes-barres multiples » — étape 2 : fusion des doublons PROFIL C
-- Groupe = >=2 variantes actives partageant produit_id, marque_id, quantite_nette,
-- unite_quantite, nombre_unites, avec marque renseignee et codes-barres distincts
-- (reeditions d'emballage). Attendu : 22 groupes, 24 variantes a supprimer.
--
-- Chaque doublon (🗑) est replie sur la variante gardee (✅ : la mieux rattachee ;
-- egalite -> cree_le -> id). Les CODES-BARRES sont CONSERVES : le code de chaque 🗑
-- est repointe vers la ✅ en est_principal=false (la ✅ garde son unique principal).
-- Toutes les autres references vivantes sont repointees comme au profil A.
-- _sauvegarde_libelle : laissee intacte.
--
-- Garde-fous transactionnels (toute anomalie -> exception -> ROLLBACK complet) :
--  * exactement 24 variantes ;
--  * codes_barres_variante : nombre total inchange (aucun code perdu) ;
--  * aucune variante avec plus d'un est_principal=true ;
--  * 0 reference residuelle vers les 24 variantes (tables vivantes).

-- 1) Correspondance 🗑 -> ✅ (profil C)
create temp table _map on commit drop as
with groupes as (
  select produit_id, marque_id, quantite_nette, unite_quantite, nombre_unites
  from variantes_produit where actif = true and marque_id is not null
  group by 1,2,3,4,5 having count(*) >= 2
),
vars as (
  select v.id, v.cree_le,
    dense_rank() over (order by v.produit_id, v.marque_id, v.quantite_nette, v.unite_quantite, v.nombre_unites) as groupe,
    (select count(*) from prix x where x.variante_produit_id = v.id and x.archive = false) as n_prix,
    (select count(*) from lignes_ticket lt where lt.variante_produit_id = v.id) as n_lignes,
    (select count(*) from correspondances_ticket_enseigne c where c.variante_produit_id = v.id) as n_mem,
    (select count(*) from alias_produits a where a.variante_produit_id = v.id) as n_alias
  from variantes_produit v
  join groupes g
    on v.produit_id     is not distinct from g.produit_id
   and v.marque_id      is not distinct from g.marque_id
   and v.quantite_nette is not distinct from g.quantite_nette
   and v.unite_quantite is not distinct from g.unite_quantite
   and v.nombre_unites  is not distinct from g.nombre_unites
  where v.actif = true and v.marque_id is not null
),
classe as (
  select vr.*, row_number() over (
    partition by groupe
    order by n_prix desc, n_lignes desc, n_mem desc, n_alias desc, cree_le asc, id asc
  ) as rang
  from vars vr
),
keep as (select groupe, id as keep_id from classe where rang = 1)
select c.id as del_id, k.keep_id
from classe c join keep k using (groupe)
where c.rang > 1;

-- Garde-fou : exactement 24 doublons attendus
do $$
declare n int;
begin
  select count(*) into n from _map;
  if n <> 24 then
    raise exception 'Correspondance inattendue : % lignes (24 attendues) — migration annulee', n;
  end if;
end $$;

-- 2) Sauvegarde des 24 variantes (lignes completes + cible de fusion)
create table _sauvegarde_variantes_fusion_profilC as
select v.*, m.keep_id as fusionnee_vers, now() as sauvegarde_le
from variantes_produit v
join _map m on m.del_id = v.id;

-- 3) Repointages + verifications
do $$
declare c bigint; n_codes_avant bigint; n_codes_apres bigint; n_multi_principal bigint; n_resid bigint;
begin
  select count(*) into n_codes_avant from codes_barres_variante;

  -- Codes-barres : repointer vers la gardee et rendre SECONDAIRES
  update codes_barres_variante t set variante_produit_id = m.keep_id, est_principal = false
    from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'codes_barres_variante : % repointes (est_principal=false)', c;

  -- Autres references vivantes (comme profil A)
  update prix t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'prix : % repointes', c;

  update lignes_ticket t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'lignes_ticket.variante_produit_id : % repointes', c;

  update lignes_ticket t set variante_suggeree_ia_id = m.keep_id from _map m where t.variante_suggeree_ia_id = m.del_id;
  get diagnostics c = row_count; raise notice 'lignes_ticket.variante_suggeree_ia_id : % repointes', c;

  update alias_produits t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'alias_produits : % repointes', c;

  update correspondances_ticket_enseigne t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'correspondances_ticket_enseigne : % repointes', c;

  update liste_courses t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'liste_courses : % repointes', c;

  update favoris t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'favoris : % repointes', c;

  update lignes_instantane_recommandation t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'lignes_instantane_recommandation : % repointes', c;

  update suggestions_alias_core_ia t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'suggestions_alias_core_ia : % repointes', c;

  delete from suggestions_alias_produit s using _map m
   where s.variante_produit_id = m.del_id and s.statut = 'en_attente'
     and exists (select 1 from suggestions_alias_produit s2
       where s2.ligne_ticket_id = s.ligne_ticket_id and s2.produit_id = s.produit_id
         and s2.variante_produit_id = m.keep_id and s2.statut = 'en_attente' and s2.id <> s.id);
  get diagnostics c = row_count; raise notice 'suggestions_alias_produit : % doublons en_attente supprimes', c;
  update suggestions_alias_produit t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'suggestions_alias_produit : % repointes', c;

  update propositions_liaison_scan t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'propositions_liaison_scan : % repointes', c;

  update historique_corrections_association t set ancienne_variante_id = m.keep_id from _map m where t.ancienne_variante_id = m.del_id;
  get diagnostics c = row_count; raise notice 'historique.ancienne_variante_id : % repointes', c;

  update historique_corrections_association t set nouvelle_variante_id = m.keep_id from _map m where t.nouvelle_variante_id = m.del_id;
  get diagnostics c = row_count; raise notice 'historique.nouvelle_variante_id : % repointes', c;

  -- Verif 1 : aucun code perdu (total inchange)
  select count(*) into n_codes_apres from codes_barres_variante;
  if n_codes_apres <> n_codes_avant then
    raise exception 'Codes perdus : % avant / % apres — migration annulee', n_codes_avant, n_codes_apres;
  end if;
  raise notice 'codes_barres_variante : % lignes (inchange)', n_codes_apres;

  -- Verif 2 : un seul est_principal=true par variante
  select count(*) into n_multi_principal from (
    select variante_produit_id from codes_barres_variante where est_principal = true
    group by variante_produit_id having count(*) > 1
  ) x;
  if n_multi_principal <> 0 then
    raise exception '% variantes avec plusieurs principaux — migration annulee', n_multi_principal;
  end if;

  -- Verif 3 : 0 reference residuelle (tables vivantes, hors _sauvegarde_libelle)
  select
     (select count(*) from codes_barres_variante where variante_produit_id in (select del_id from _map))
    +(select count(*) from prix where variante_produit_id in (select del_id from _map))
    +(select count(*) from lignes_ticket where variante_produit_id in (select del_id from _map))
    +(select count(*) from lignes_ticket where variante_suggeree_ia_id in (select del_id from _map))
    +(select count(*) from alias_produits where variante_produit_id in (select del_id from _map))
    +(select count(*) from correspondances_ticket_enseigne where variante_produit_id in (select del_id from _map))
    +(select count(*) from liste_courses where variante_produit_id in (select del_id from _map))
    +(select count(*) from favoris where variante_produit_id in (select del_id from _map))
    +(select count(*) from lignes_instantane_recommandation where variante_produit_id in (select del_id from _map))
    +(select count(*) from suggestions_alias_core_ia where variante_produit_id in (select del_id from _map))
    +(select count(*) from suggestions_alias_produit where variante_produit_id in (select del_id from _map))
    +(select count(*) from propositions_liaison_scan where variante_produit_id in (select del_id from _map))
    +(select count(*) from historique_corrections_association where ancienne_variante_id in (select del_id from _map))
    +(select count(*) from historique_corrections_association where nouvelle_variante_id in (select del_id from _map))
    into n_resid;
  if n_resid <> 0 then
    raise exception 'References residuelles (tables vivantes) : % (0 attendu) — migration annulee', n_resid;
  end if;
  raise notice 'References residuelles (tables vivantes) : % (OK)', n_resid;
end $$;

-- 4) Suppression des 24 variantes repliees
delete from variantes_produit v using _map m where v.id = m.del_id;

-- 5) Controle final : 24 supprimees, plus aucune presente
do $$
declare n int;
begin
  select count(*) into n
  from variantes_produit v join _sauvegarde_variantes_fusion_profilC s on s.id = v.id;
  if n <> 0 then
    raise exception 'Suppression incomplete : % variantes subsistent — migration annulee', n;
  end if;
  raise notice 'Fusion profil C terminee : 24 variantes supprimees, codes conserves, sauvegarde OK.';
end $$;
