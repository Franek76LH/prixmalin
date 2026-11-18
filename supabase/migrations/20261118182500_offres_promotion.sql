-- 18/11/2026 — Chantier 148 : carnet des offres constatées.
-- Appliqué en prod le 18/11/2026 à 18h25 (feu vert écrit de François, 18h24).
-- Table vide, lue par aucun écran. Le prix normal reste dans `prix` : une offre
-- n'est jamais un prix. Sans `fin_le`, une offre est considérée finie 14 jours
-- après `vue_le`. Aucune écriture possible depuis l'app pour l'instant (elle
-- passera par une fonction dédiée) ; chacun ne lit que ses propres offres.
-- Retour arrière : drop table public.offres_promotion;
create table public.offres_promotion (
  id uuid primary key default gen_random_uuid(),
  magasin_id uuid not null references public.magasins(id),
  produit_id uuid references public.produits(id),
  variante_produit_id uuid references public.variantes_produit(id),
  libelle_ticket text,
  ligne_ticket_id uuid references public.lignes_ticket(id) on delete set null,
  utilisateur_id uuid default auth.uid(),
  mecanique text not null check (mecanique in ('lot_gratuit','nieme_remise','pourcentage','montant','inconnue')),
  parametres jsonb not null default '{}'::jsonb,
  origine text not null check (origine in ('ticket_texte','ticket_chiffres','rayon')),
  texte_imprime text,
  prix_normal numeric check (prix_normal is null or prix_normal > 0),
  quantite numeric check (quantite is null or quantite > 0),
  montant_remise numeric check (montant_remise is null or montant_remise >= 0),
  vue_le date not null default current_date,
  fin_le date,
  cree_le timestamptz not null default now(),
  constraint offres_promotion_fin_apres_vue check (fin_le is null or fin_le >= vue_le)
);
comment on table public.offres_promotion is 'Chantier 148 — carnet des offres constatées (2+1 offert, 2e à -50 %…). Le prix normal reste dans prix ; une offre n''est jamais un prix. Sans fin_le, une offre est considérée finie 14 jours après vue_le.';
create unique index uq_offres_promotion_ligne_ticket on public.offres_promotion (ligne_ticket_id) where ligne_ticket_id is not null;
create index idx_offres_promotion_magasin_vue on public.offres_promotion (magasin_id, vue_le desc);
create index idx_offres_promotion_produit on public.offres_promotion (produit_id) where produit_id is not null;
alter table public.offres_promotion enable row level security;
revoke all on public.offres_promotion from anon, authenticated;
grant select on public.offres_promotion to authenticated;
create policy offres_promotion_lecture_propre on public.offres_promotion for select to authenticated using (utilisateur_id = auth.uid() or est_administrateur());
