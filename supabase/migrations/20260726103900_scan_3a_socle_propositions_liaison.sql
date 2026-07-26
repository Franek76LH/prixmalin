-- Chantier "Scan code-barres", bout 3A — socle (DB uniquement).
-- Prépare l'ouverture du scan aux utilisateurs non-admin : leurs propositions
-- de liaison partent dans une file d'attente (propositions_liaison_scan),
-- validée ensuite par l'admin (François) — même modèle que
-- suggestions_alias_produit / suggestions_magasin (propose_par, statut,
-- policies "lecture propre ou admin" + "modification admin").
-- Appliqué en base le 2026-07-26, vérifié (schéma, RLS, GRANT) avant et après.

-- 1) Marqueur admin sur profiles (additif, ne retire rien)
alter table public.profiles
  add column if not exists role text not null default 'user';

update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'francois.pimor@gmail.com');

-- est_administrateur() reconnaît désormais AUSSI profiles.role = 'admin', en plus du JWT
create or replace function public.est_administrateur()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 2) File d'attente des propositions de liaison par scan
create table if not exists public.propositions_liaison_scan (
  id uuid primary key default gen_random_uuid(),
  ligne_ticket_id uuid not null references public.lignes_ticket(id) on delete cascade,
  produit_id uuid not null references public.produits(id),
  variante_produit_id uuid references public.variantes_produit(id),
  code_barres text,
  libelle_alias text,
  propose_par uuid not null default auth.uid() references auth.users(id),
  statut text not null default 'en_attente' check (statut in ('en_attente','valide','refuse')),
  motif_refus text,
  traite_par uuid references auth.users(id),
  traite_le timestamptz,
  cree_le timestamptz not null default now()
);

-- une seule proposition « en attente » par ligne de ticket
create unique index if not exists uniq_proposition_en_attente_par_ligne
  on public.propositions_liaison_scan(ligne_ticket_id)
  where statut = 'en_attente';

alter table public.propositions_liaison_scan enable row level security;

create policy propositions_scan_lecture_propre_ou_admin
  on public.propositions_liaison_scan for select
  using (propose_par = auth.uid() or est_administrateur());

create policy propositions_scan_insertion_propre
  on public.propositions_liaison_scan for insert
  with check (propose_par = auth.uid() and statut = 'en_attente');

create policy propositions_scan_modification_admin
  on public.propositions_liaison_scan for update
  using (est_administrateur()) with check (est_administrateur());

-- 3) Fonction d'entrée : un utilisateur propose une liaison sur SA ligne de ticket
create or replace function public.proposer_liaison_scan(
  p_ligne_ticket_id uuid,
  p_produit_id uuid,
  p_variante_produit_id uuid,
  p_code_barres text,
  p_libelle_alias text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.lignes_ticket lt
    join public.tickets t on t.id = lt.ticket_id
    where lt.id = p_ligne_ticket_id and t.utilisateur_id = auth.uid()
  ) then
    raise exception 'ligne_ticket non autorisée';
  end if;

  insert into public.propositions_liaison_scan
    (ligne_ticket_id, produit_id, variante_produit_id, code_barres, libelle_alias, propose_par, statut)
  values
    (p_ligne_ticket_id, p_produit_id, p_variante_produit_id, p_code_barres, p_libelle_alias, auth.uid(), 'en_attente')
  on conflict (ligne_ticket_id) where (statut = 'en_attente')
  do update set
    produit_id = excluded.produit_id,
    variante_produit_id = excluded.variante_produit_id,
    code_barres = excluded.code_barres,
    libelle_alias = excluded.libelle_alias,
    cree_le = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.proposer_liaison_scan(uuid,uuid,uuid,text,text) to authenticated;
