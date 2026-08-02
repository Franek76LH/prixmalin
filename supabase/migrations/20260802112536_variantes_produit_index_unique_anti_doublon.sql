-- Chantier « codes-barres multiples » — étape 3 : règle anti-doublon.
-- Empêche l'existence de deux variantes ACTIVES partageant les 5 mêmes valeurs
-- (produit_id, marque_id, quantite_nette, unite_quantite, nombre_unites).
--
-- NULLS NOT DISTINCT (Postgres 15+) : deux variantes "sans marque" (marque_id
-- NULL) ou "sans quantité" (NULL) sont bien considérées comme doublons et
-- bloquées — sinon le profil A (marque NULL) ne serait pas couvert et pourrait
-- réapparaître.
--
-- WHERE actif = true : on ne contraint que les variantes actives (les variantes
-- désactivées / historiques ne sont pas concernées).
--
-- Prérequis vérifié avant application : 0 groupe de doublons actif sur ces 5
-- colonnes (profils A et C nettoyés aux étapes précédentes).

create unique index uq_variantes_produit_actives_sans_doublon
  on variantes_produit (produit_id, marque_id, quantite_nette, unite_quantite, nombre_unites)
  nulls not distinct
  where actif = true;
