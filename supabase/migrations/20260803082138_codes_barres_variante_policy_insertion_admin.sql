-- Chantier « codes-barres multiples » — étape 4b : policy d'ECRITURE (INSERT).
-- Permet au scan d'apprendre un code inconnu en l'inserant dans
-- codes_barres_variante. Calquee EXACTEMENT sur le standard du projet
-- (variantes_produit_insertion_admin) : INSERT, role authenticated,
-- WITH CHECK est_administrateur().
--
-- La lecture (policy 4a) et les autres policies restent inchangees.
-- Pas de policy UPDATE/DELETE ici.

create policy codes_barres_variante_insertion_admin
  on public.codes_barres_variante
  for insert
  to authenticated
  with check (est_administrateur());
