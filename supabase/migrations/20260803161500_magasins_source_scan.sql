-- LOT 1 « reconnaissance magasin au scan » — étape 1/2 : autoriser la source
-- 'scan' sur magasins.
--
-- Contexte : jusqu'ici un magasin INCONNU au scan n'était créé que dans le
-- legacy `stores`, jamais dans le Core `magasins` (+ correspondance_magasins).
-- Résultat : `resoudre_magasin_core` renvoyait NULL -> rejet `magasin_non_resolu`
-- -> aucun ticket écrit. Le LOT 1 crée désormais la fiche Core au moment de la
-- validation du magasin (RPC resoudre_ou_creer_magasin_core, étape 2/2).
--
-- Ces magasins doivent être traçables comme issus du scan : on ajoute la valeur
-- 'scan' au CHECK de magasins.source (jusqu'ici : administrateur, migration,
-- suggestion_validee, import).

alter table public.magasins drop constraint magasins_source_check;

alter table public.magasins add constraint magasins_source_check
  check (source = any (array[
    'administrateur'::text,
    'migration'::text,
    'suggestion_validee'::text,
    'import'::text,
    'scan'::text
  ]));
