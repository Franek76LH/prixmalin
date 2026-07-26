-- Chantier géoloc comparateur — point de référence persistant par utilisateur.
-- Additif uniquement (3 colonnes nullables sur profiles, déjà en RLS
-- "owner_write" pour ALL sur sa propre ligne + "profiles_select" en lecture
-- authentifiée) : aucune policy à ajouter. Même mécanisme que les favoris
-- (persistance Supabase liée au compte), pour retrouver son point d'un
-- appareil à l'autre.
alter table public.profiles
  add column if not exists zone_lat double precision,
  add column if not exists zone_lng double precision,
  add column if not exists zone_label text;
