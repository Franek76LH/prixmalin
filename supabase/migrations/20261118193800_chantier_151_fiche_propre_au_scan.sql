-- 18/11/2026 — Chantier 151, lot 1 : une fiche propre dès sa création au scan d'un code-barres.
-- Appliqué en prod le 18/11/2026 (objets créés vers 19h25, bascule à 19h38, feu vert écrit de François).
--
-- ⚠️ TRACE PARTIELLE. Ce fichier porte les tables et les deux petites fonctions. Ne sont PAS recopiés ici,
-- parce qu'ils ont été écrits directement en base :
--   - les 145 lignes de correspondances_categories_off (catégorie Open Food Facts -> rayon, avec un poids) ;
--   - la fonction creer_produit_depuis_code_barres (nouvelle version) et sa version précédente, conservée
--     sous le nom creer_produit_depuis_code_barres_avant_151 (sans droit d'appel).
-- Leur définition exacte se lit en base :
--   select pg_get_functiondef(oid) from pg_proc where proname like 'creer_produit_depuis_code_barres%';
--   select * from correspondances_categories_off order by sous_categorie_id, tag;
--
-- Retour arrière de la bascule :
--   alter function public.creer_produit_depuis_code_barres(uuid, text, jsonb) rename to creer_produit_depuis_code_barres_v151;
--   revoke all on function public.creer_produit_depuis_code_barres_v151(uuid, text, jsonb) from public, anon, authenticated;
--   alter function public.creer_produit_depuis_code_barres_avant_151(uuid, text, jsonb) rename to creer_produit_depuis_code_barres;
--   grant execute on function public.creer_produit_depuis_code_barres(uuid, text, jsonb) to authenticated;

create table public.correspondances_categories_off (
  tag text primary key,
  sous_categorie_id uuid not null references public.sous_categories(id),
  poids int not null default 0,
  cree_le timestamptz not null default now()
);
comment on table public.correspondances_categories_off is 'Chantier 151 — catégorie Open Food Facts -> rayon PrixMalin. Le poids le plus fort gagne ; à poids égal, la catégorie la plus précise (la dernière de la liste OFF).';
alter table public.correspondances_categories_off enable row level security;
revoke all on public.correspondances_categories_off from anon, authenticated;

create table public.fiches_a_verifier (
  id uuid primary key default gen_random_uuid(),
  produit_id uuid not null references public.produits(id) on delete cascade,
  variante_produit_id uuid references public.variantes_produit(id) on delete set null,
  code_barres text,
  raisons text[] not null default '{}',
  off jsonb,
  cree_par uuid,
  cree_le timestamptz not null default now(),
  traite_le timestamptz
);
comment on table public.fiches_a_verifier is 'Chantier 151 — file des fiches créées au scan d''un code-barres, à relire (nom à généraliser, rayon inconnu, format incomplet, marque absente). Traitée par l''administration, jamais montrée aux utilisateurs.';
alter table public.fiches_a_verifier enable row level security;
revoke all on public.fiches_a_verifier from anon, authenticated;

create or replace function public.rayon_depuis_categories_off(p_tags jsonb)
returns uuid language sql stable security definer set search_path to 'pg_catalog', 'public' as $f$
  select c.sous_categorie_id
  from jsonb_array_elements_text(case when jsonb_typeof(p_tags) = 'array' then p_tags else '[]'::jsonb end) with ordinality as t(tag, rang)
  join public.correspondances_categories_off c on c.tag = lower(t.tag)
  join public.sous_categories sc on sc.id = c.sous_categorie_id and sc.actif
  order by c.poids desc, t.rang desc
  limit 1;
$f$;
revoke all on function public.rayon_depuis_categories_off(jsonb) from public, anon, authenticated;

create or replace function public.deviner_rayon_off(p_tags jsonb)
returns json language sql stable security definer set search_path to 'pg_catalog', 'public' as $f$
  select json_build_object('id', sc.id, 'nom', sc.nom)
  from public.sous_categories sc where sc.id = public.rayon_depuis_categories_off(p_tags);
$f$;
revoke all on function public.deviner_rayon_off(jsonb) from public, anon;
grant execute on function public.deviner_rayon_off(jsonb) to authenticated;
