-- Chantier « Liste de courses » — Lot 4 : filet Supabase de la session de courses.
-- Table ADDITIVE : ne modifie aucune table existante. Une ligne par session ;
-- l'instantané figé complet (articles, états, magasin, total prévu) est le
-- document jsonb `donnees` — strictement le même que celui du localStorage
-- (clé prixmalin_sessionCourses_v1), pour une restauration à deux sources
-- sans transformation.

create table public.sessions_courses (
  id              uuid primary key default gen_random_uuid(),
  utilisateur_id  uuid not null references auth.users(id) on delete cascade,
  -- Simple référence dénormalisée pour d'éventuelles requêtes/statistiques ;
  -- le magasin réel est FIGÉ dans `donnees` et y survit à une fusion ou une
  -- disparition du magasin (d'où l'absence volontaire de contrôle « magasin
  -- actif » dans les politiques RLS ci-dessous : un magasin fusionné ne doit
  -- jamais faire échouer une sauvegarde de session — règle « aucune perte
  -- silencieuse »).
  magasin_id      uuid references public.magasins(id) on delete set null,
  donnees         jsonb not null,
  statut          text not null default 'active'
                  check (statut in ('active', 'terminee', 'abandonnee')),
  cree_le         timestamptz not null default now(),
  -- Écrit par l'application à chaque sauvegarde (même horloge que le
  -- localStorage) : sert d'arbitre « dernière écriture gagne » entre la copie
  -- locale et la copie base à la restauration. Pas de trigger.
  modifie_le      timestamptz not null default now(),
  terminee_le     timestamptz
);

comment on table public.sessions_courses is
  'Sessions de courses (chantier Liste de courses). Une ligne par session ; instantané figé complet dans `donnees` (miroir du localStorage). Une seule session active par utilisateur (index partiel).';

-- Arbitrage Q1 (2026-08-11) : UNE seule session active à la fois, garanti en base.
-- Le flux « remplacer » bascule d'abord l'ancienne session en 'abandonnee',
-- puis insère la nouvelle 'active' (ordre géré côté application, Lot 4).
create unique index sessions_courses_une_active_par_utilisateur
  on public.sessions_courses (utilisateur_id)
  where statut = 'active';

alter table public.sessions_courses enable row level security;

-- Contrôle par propriétaire uniquement, sur les quatre verbes (correction
-- François 2026-08-11 : pas de contrôle « magasin actif », cf. commentaire
-- de la colonne magasin_id).

create policy sessions_courses_lecture_propre on public.sessions_courses
  for select using (utilisateur_id = auth.uid());

create policy sessions_courses_insertion_propre on public.sessions_courses
  for insert with check (utilisateur_id = auth.uid());

create policy sessions_courses_modification_propre on public.sessions_courses
  for update using (utilisateur_id = auth.uid())
  with check (utilisateur_id = auth.uid());

create policy sessions_courses_suppression_propre on public.sessions_courses
  for delete using (utilisateur_id = auth.uid());
