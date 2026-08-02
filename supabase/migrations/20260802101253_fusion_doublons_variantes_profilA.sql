-- Chantier nettoyage doublons variantes_produit — PROFIL A
-- Groupe = >=2 variantes actives partageant produit_id, marque_id, quantite_nette,
-- unite_quantite, nombre_unites. Profil A = marque_id NULL ET aucune variante du
-- groupe n'a de code_barres (toutes NULL) : doublons sans element distinctif.
--
-- Regle de conservation : la variante la plus riche en rattachements
-- (prix -> lignes_ticket -> memoire -> alias), egalite tranchee par cree_le puis id.
-- Chaque doublon est REPLIE (repointe) sur la variante gardee AVANT suppression.
--
-- Consignes appliquees :
--  * _sauvegarde_libelle : NON touchee (instantane historique ; aucune FK ne bloque).
--    La verification "zero reference" ne porte donc que sur les tables VIVANTES.
--  * Pas de deduplication des alias (repointes tels quels).
--  * Filet de securite : copie des 57 variantes supprimees dans
--    _sauvegarde_variantes_fusion_profilA avant le DELETE.
-- Transactionnel : toute anomalie (nb <> 57, reference residuelle, suppression
-- incomplete) leve une exception et annule l'ensemble.

-- 1) Correspondance doublon (del) -> garde (keep) du profil A
create temp table _map on commit drop as
with groupes as (
  select produit_id, quantite_nette, unite_quantite, nombre_unites
  from variantes_produit where actif = true and marque_id is null
  group by produit_id, quantite_nette, unite_quantite, nombre_unites
  having count(*) >= 2 and bool_and(code_barres is null)
),
vars as (
  select v.id, v.cree_le,
    dense_rank() over (order by v.produit_id, v.quantite_nette, v.unite_quantite, v.nombre_unites) as groupe,
    (select count(*) from prix x where x.variante_produit_id = v.id and x.archive = false) as n_prix,
    (select count(*) from lignes_ticket lt where lt.variante_produit_id = v.id) as n_lignes,
    (select count(*) from correspondances_ticket_enseigne c where c.variante_produit_id = v.id) as n_mem,
    (select count(*) from alias_produits a where a.variante_produit_id = v.id) as n_alias
  from variantes_produit v
  join groupes g on v.produit_id = g.produit_id
   and v.quantite_nette is not distinct from g.quantite_nette
   and v.unite_quantite is not distinct from g.unite_quantite
   and v.nombre_unites  is not distinct from g.nombre_unites
  where v.actif = true and v.marque_id is null and v.code_barres is null
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

-- Garde-fou : exactement 57 doublons attendus
do $$
declare n int;
begin
  select count(*) into n from _map;
  if n <> 57 then
    raise exception 'Correspondance inattendue : % lignes (57 attendues) — migration annulee', n;
  end if;
end $$;

-- 2) Filet de securite : sauvegarde des 57 variantes (lignes completes + cible de fusion)
create table _sauvegarde_variantes_fusion_profilA as
select v.*, m.keep_id as fusionnee_vers, now() as sauvegarde_le
from variantes_produit v
join _map m on m.del_id = v.id;

-- 3) Repointage de TOUTES les references vivantes, puis verification "zero reference"
do $$
declare c bigint;
begin
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

  -- suggestions_alias_produit : garde anti-doublon sur l'index partiel
  -- (ligne_ticket_id, produit_id, variante_produit_id) WHERE statut='en_attente',
  -- puis repointage.
  delete from suggestions_alias_produit s using _map m
   where s.variante_produit_id = m.del_id and s.statut = 'en_attente'
     and exists (
       select 1 from suggestions_alias_produit s2
       where s2.ligne_ticket_id = s.ligne_ticket_id and s2.produit_id = s.produit_id
         and s2.variante_produit_id = m.keep_id and s2.statut = 'en_attente' and s2.id <> s.id);
  get diagnostics c = row_count; raise notice 'suggestions_alias_produit : % doublons en_attente supprimes', c;

  update suggestions_alias_produit t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'suggestions_alias_produit : % repointes', c;

  update propositions_liaison_scan t set variante_produit_id = m.keep_id from _map m where t.variante_produit_id = m.del_id;
  get diagnostics c = row_count; raise notice 'propositions_liaison_scan : % repointes', c;

  update historique_corrections_association t set ancienne_variante_id = m.keep_id from _map m where t.ancienne_variante_id = m.del_id;
  get diagnostics c = row_count; raise notice 'historique_corrections_association.ancienne_variante_id : % repointes', c;

  update historique_corrections_association t set nouvelle_variante_id = m.keep_id from _map m where t.nouvelle_variante_id = m.del_id;
  get diagnostics c = row_count; raise notice 'historique_corrections_association.nouvelle_variante_id : % repointes', c;

  -- Verification : 0 reference residuelle dans les tables VIVANTES (exclut
  -- volontairement _sauvegarde_libelle, laissee intacte).
  select
     (select count(*) from prix where variante_produit_id in (select del_id from _map))
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
    into c;
  if c <> 0 then
    raise exception 'References residuelles (tables vivantes) : % (0 attendu) — migration annulee', c;
  end if;
  raise notice 'References residuelles (tables vivantes) : % (OK)', c;
end $$;

-- 4) Suppression des 57 variantes repliees
delete from variantes_produit v using _map m where v.id = m.del_id;

-- 5) Controle final : les 57 variantes sauvegardees ne doivent plus exister
do $$
declare n int;
begin
  select count(*) into n
  from variantes_produit v
  join _sauvegarde_variantes_fusion_profilA s on s.id = v.id;
  if n <> 0 then
    raise exception 'Suppression incomplete : % variantes subsistent — migration annulee', n;
  end if;
  raise notice 'Fusion profil A terminee : 57 variantes supprimees, sauvegarde OK.';
end $$;
