-- Chantier « codes-barres multiples » — étape 4a : policy de LECTURE.
-- codes_barres_variante devient la source de verite pour la recherche au scan.
-- Les codes-barres ne sont pas des donnees sensibles : lecture ouverte aux
-- utilisateurs authentifies pour que la recherche par code fonctionne.
--
-- Pas de policy d'ECRITURE ici (ce sera l'etape 4b, reservee admin/Francois).

create policy codes_barres_variante_lecture_authentifiee
  on public.codes_barres_variante
  for select
  to authenticated
  using (true);
