-- 19/11/2026 — Chantier 157 : mémoire personnelle de la liste.
-- Feu vert écrit de François le 19/11 à 9h01 (« go »). Appliqué en prod le 19/11 à 15h30, après essai à blanc.
-- Un carnet privé par utilisateur : ce qu'il a dit ou tapé (mots utiles, sans
-- accents) -> la fiche qu'il a choisie. Visible et modifiable par lui seul,
-- pas même par un administrateur. Rien d'autre n'est touché.
-- Retour arrière : drop table public.memoire_liste;
create table public.memoire_liste (
  id uuid primary key default gen_random_uuid(),
  utilisateur_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  texte_normalise text not null check (char_length(texte_normalise) between 1 and 80),
  produit_id uuid not null references public.produits(id) on delete cascade,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  constraint memoire_liste_un_choix_par_texte unique (utilisateur_id, texte_normalise)
);
comment on table public.memoire_liste is 'Chantier 157 — mémoire personnelle de la liste : pour un utilisateur, les mots dits ou tapés -> la fiche qu''il a choisie. Privé : chacun ne voit que ses lignes.';
alter table public.memoire_liste enable row level security;
revoke all on public.memoire_liste from anon, authenticated;
grant select, insert, update, delete on public.memoire_liste to authenticated;
create policy memoire_liste_lecture_propre on public.memoire_liste for select to authenticated using (utilisateur_id = auth.uid());
create policy memoire_liste_insertion_propre on public.memoire_liste for insert to authenticated with check (utilisateur_id = auth.uid());
create policy memoire_liste_modification_propre on public.memoire_liste for update to authenticated using (utilisateur_id = auth.uid()) with check (utilisateur_id = auth.uid());
create policy memoire_liste_suppression_propre on public.memoire_liste for delete to authenticated using (utilisateur_id = auth.uid());
