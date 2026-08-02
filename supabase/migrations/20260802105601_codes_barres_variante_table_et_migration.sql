-- Chantier « codes-barres multiples » — étape 1 (ADDITIF)
-- Crée la table dédiée codes_barres_variante et y migre les codes existants.
-- On ne touche PAS variantes_produit.code_barres : il reste en place tel quel.
--
-- Contexte vérifié : 832 variantes actives ont un code non vide, tous distincts
-- (0 doublon) → la contrainte UNIQUE(code_barres) passe.

-- 1) Table
create table codes_barres_variante (
  id                  uuid primary key default gen_random_uuid(),
  -- ON DELETE NO ACTION volontaire : le code-barres est une cle de reconnaissance
  -- precieuse. On prefere etre bloque/alerte plutot que perdre des codes en
  -- silence si une variante etait supprimee. A l'etape 2 (fusion profil C), les
  -- codes seront repointes explicitement vers la variante gardee AVANT suppression.
  variante_produit_id uuid not null references variantes_produit(id) on delete no action,
  code_barres         text not null,
  est_principal       boolean not null default false,
  source              text,
  cree_le             timestamptz not null default now(),
  constraint uq_codes_barres_variante_code unique (code_barres)   -- un code = une seule variante
);

-- Un seul est_principal=true par variante
create unique index uq_codes_barres_variante_principal
  on codes_barres_variante (variante_produit_id)
  where est_principal = true;

-- Accès par variante
create index idx_codes_barres_variante_variante
  on codes_barres_variante (variante_produit_id);

-- RLS activée sans policy (table verrouillée) : non exposée à l'API tant que
-- les étapes suivantes n'ajoutent pas de règles. Cohérent avec les autres tables.
alter table codes_barres_variante enable row level security;

-- 2) Migration des codes existants + garde-fous (transaction : ROLLBACK si anomalie)
do $$
declare n_insere bigint; n_attendu bigint; n_dup bigint;
begin
  select count(*) into n_attendu
  from variantes_produit
  where actif = true and code_barres is not null and btrim(code_barres) <> '';

  insert into codes_barres_variante (variante_produit_id, code_barres, est_principal, source)
  select v.id, v.code_barres, true, 'migration'
  from variantes_produit v
  where v.actif = true and v.code_barres is not null and btrim(v.code_barres) <> '';
  get diagnostics n_insere = row_count;

  if n_insere <> n_attendu then
    raise exception 'Codes migres % <> attendus % — migration annulee', n_insere, n_attendu;
  end if;

  select count(*) - count(distinct code_barres) into n_dup from codes_barres_variante;
  if n_dup <> 0 then
    raise exception 'Doublons de code_barres detectes : % — migration annulee', n_dup;
  end if;

  raise notice 'codes_barres_variante : % codes migres (attendu %), 0 doublon.', n_insere, n_attendu;
end $$;
