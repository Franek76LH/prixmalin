-- Chantier 169 (21/11/2026) — appliqué en prod par le connecteur Supabase.
-- Un 2e code-barres pour une variante qui a déjà un code principal (Barilla
-- Spaghettoni 500 g : 8076809585385 connu, 8076808150072 scanné) faisait
-- échouer creer_produit_depuis_code_barres (uq_codes_barres_variante_principal,
-- « Création impossible pour le moment »). Le nouveau code est désormais
-- enregistré comme code secondaire. Ancienne définition sauvegardée dans
-- public._sauv_fonction_creer_produit_20261121 (retour arrière : execute de def).
create table if not exists public._sauv_fonction_creer_produit_20261121 (def text, sauve_le timestamptz default now());
alter table public._sauv_fonction_creer_produit_20261121 enable row level security;
insert into public._sauv_fonction_creer_produit_20261121 (def)
  values (pg_get_functiondef('public.creer_produit_depuis_code_barres(uuid,text,jsonb)'::regprocedure));
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.creer_produit_depuis_code_barres(uuid,text,jsonb)'::regprocedure);
  n := replace(d,
    $a$values (v_variante_id, v_ean, true, 'scan');$a$,
    $b$values (v_variante_id, v_ean,
          not exists (select 1 from public.codes_barres_variante c where c.variante_produit_id = v_variante_id and c.est_principal),
          'scan');$b$);
  if n = d then raise exception 'ligne à remplacer introuvable'; end if;
  execute n;
end $$;
