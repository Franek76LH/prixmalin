-- Chantier fusion de fiches produit — autorise le déplacement d'une variante
-- d'une fiche produit à une autre (UPDATE variantes_produit.produit_id).
--
-- Contexte : plusieurs tables référencent une variante par le COUPLE
-- composite (variante_produit_id, produit_id) -> variantes_produit(id,
-- produit_id). Ces contraintes sont ON DELETE RESTRICT/SET NULL mais SANS
-- ON UPDATE explicite (donc NO ACTION implicite) : changer
-- variantes_produit.produit_id casse aussitôt la contrainte pour toute ligne
-- fille encore accrochée à l'ancien produit_id, même dans la même
-- transaction. Ce fichier recrée chaque contrainte à l'identique (mêmes
-- colonnes, même action ON DELETE déjà en place) en ajoutant ON UPDATE
-- CASCADE : déplacer une variante propage désormais automatiquement le
-- nouveau produit_id à toutes ses lignes filles, dans une simple UPDATE.
--
-- Périmètre vérifié en base (pg_constraint, confrelid = variantes_produit) :
-- la demande citait prix + "vérifie alias_produits et lignes_ticket" ; l'audit
-- a trouvé EXACTEMENT 9 contraintes composites sur 8 tables (dont 6 non
-- citées dans la demande : suggestions_alias_produit,
-- lignes_instantane_recommandation, favoris, liste_courses,
-- suggestions_alias_core_ia, et le second FK de lignes_ticket pour la
-- suggestion IA). Toutes sont traitées ici pour que la fusion fonctionne
-- réellement de bout en bout — à retirer du fichier avant application si tu
-- préfères te limiter aux 3 tables citées.
--
-- Hors périmètre, volontairement inchangé : historique_corrections_association
-- (ancienne_variante_id/nouvelle_variante_id) et propositions_liaison_scan
-- (variante_produit_id) référencent variantes_produit(id) SEUL, sans
-- produit_id associé — aucun risque de rupture de couple, ON UPDATE CASCADE
-- n'y change rien d'utile.

-- 1) prix (citée explicitement)
alter table public.prix
  drop constraint fk_prix_variante_produit;
alter table public.prix
  add constraint fk_prix_variante_produit
  foreign key (variante_produit_id, produit_id)
  references public.variantes_produit(id, produit_id)
  on delete restrict on update cascade;

-- 2) alias_produits (citée explicitement)
alter table public.alias_produits
  drop constraint fk_alias_variante_produit;
alter table public.alias_produits
  add constraint fk_alias_variante_produit
  foreign key (variante_produit_id, produit_id)
  references public.variantes_produit(id, produit_id)
  on delete restrict on update cascade;

-- 3) lignes_ticket — association réelle (citée explicitement)
alter table public.lignes_ticket
  drop constraint fk_lignes_ticket_variante_produit;
alter table public.lignes_ticket
  add constraint fk_lignes_ticket_variante_produit
  foreign key (variante_produit_id, produit_id)
  references public.variantes_produit(id, produit_id)
  on delete restrict on update cascade;

-- 4) lignes_ticket — suggestion IA (même table, second couple de colonnes,
-- non cité dans la demande mais même risque de blocage)
alter table public.lignes_ticket
  drop constraint fk_lignes_ticket_variante_ia_produit;
alter table public.lignes_ticket
  add constraint fk_lignes_ticket_variante_ia_produit
  foreign key (variante_suggeree_ia_id, produit_suggere_ia_id)
  references public.variantes_produit(id, produit_id)
  on delete set null on update cascade;

-- 5) suggestions_alias_produit (non citée dans la demande)
alter table public.suggestions_alias_produit
  drop constraint fk_suggestions_alias_variante_produit;
alter table public.suggestions_alias_produit
  add constraint fk_suggestions_alias_variante_produit
  foreign key (variante_produit_id, produit_id)
  references public.variantes_produit(id, produit_id)
  on delete restrict on update cascade;

-- 6) lignes_instantane_recommandation (non citée dans la demande)
alter table public.lignes_instantane_recommandation
  drop constraint fk_lignes_instantane_variante_produit;
alter table public.lignes_instantane_recommandation
  add constraint fk_lignes_instantane_variante_produit
  foreign key (variante_produit_id, produit_id)
  references public.variantes_produit(id, produit_id)
  on delete set null on update cascade;

-- 7) favoris (non citée dans la demande)
alter table public.favoris
  drop constraint fk_favoris_variante_produit;
alter table public.favoris
  add constraint fk_favoris_variante_produit
  foreign key (variante_produit_id, produit_id)
  references public.variantes_produit(id, produit_id)
  on delete restrict on update cascade;

-- 8) liste_courses (non citée dans la demande)
alter table public.liste_courses
  drop constraint fk_liste_courses_variante_produit;
alter table public.liste_courses
  add constraint fk_liste_courses_variante_produit
  foreign key (variante_produit_id, produit_id)
  references public.variantes_produit(id, produit_id)
  on delete set null on update cascade;

-- 9) suggestions_alias_core_ia (non citée dans la demande)
alter table public.suggestions_alias_core_ia
  drop constraint fk_suggestions_ia_variante_produit;
alter table public.suggestions_alias_core_ia
  add constraint fk_suggestions_ia_variante_produit
  foreign key (variante_produit_id, produit_id)
  references public.variantes_produit(id, produit_id)
  on delete restrict on update cascade;
