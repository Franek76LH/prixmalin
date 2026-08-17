-- Chantier « Catalogue épuré » — Partie A : normalisation des unités (le RESTE).
--
-- ⚠️ NE PAS APPLIQUER seule en prod : elle doit partir EN MÊME TEMPS que le
-- nouvel écran Catalogue (Partie C). Convertir les unités sans la nouvelle règle
-- d'affichage active provoquerait une régression d'affichage (Partie D).
--
-- Déjà fait cette session (NE PAS refaire, sauvegardes _sauv_norm_* existantes) :
-- 16 fiches mixtes kg/g passées en kg, Dentifrice passé en volume, 5 relevés
-- aberrants retirés. Cette migration convertit UNIQUEMENT le reste :
--   * poids encore en grammes  -> kg  (quantite_nette / 1000, unite = 'kg') ;
--   * volumes en cl -> /100 et ml -> /1000, unite = 'l' ;
--   * produits.unite_base aligné : 'kg' (type_unite='poids'), 'l' ('volume').
-- Le prix (prix_total = prix du paquet) est INDÉPENDANT de l'unité : non touché.
-- Le €/kg est calculé côté app (unitesCore) et reste correct avant/après.
--
-- Réversible : snapshot AVANT conversion des lignes modifiées dans
-- _sauv_norm2_variantes / _sauv_norm2_produits (restauration par id possible).

-- 1) Snapshot des variantes à convertir (poids en g, volumes en cl/ml)
create table if not exists public._sauv_norm2_variantes as
select vp.*, now() as sauvegarde_le
from public.variantes_produit vp
where lower(btrim(vp.unite_quantite)) in ('g', 'cl', 'ml');

-- 2) Snapshot des produits dont unite_base va changer
create table if not exists public._sauv_norm2_produits as
select p.*, now() as sauvegarde_le
from public.produits p
where (p.type_unite = 'poids'  and coalesce(lower(btrim(p.unite_base)), '') <> 'kg')
   or (p.type_unite = 'volume' and coalesce(lower(btrim(p.unite_base)), '') <> 'l');

-- 3) Conversion des variantes (quantite_nette NULL reste NULL : NULL/1000 = NULL)
update public.variantes_produit
set quantite_nette = quantite_nette / 1000.0, unite_quantite = 'kg'
where lower(btrim(unite_quantite)) = 'g';

update public.variantes_produit
set quantite_nette = quantite_nette / 100.0, unite_quantite = 'l'
where lower(btrim(unite_quantite)) = 'cl';

update public.variantes_produit
set quantite_nette = quantite_nette / 1000.0, unite_quantite = 'l'
where lower(btrim(unite_quantite)) = 'ml';

-- 4) Alignement de produits.unite_base sur l'unité canonique de la famille
update public.produits set unite_base = 'kg'
where type_unite = 'poids' and coalesce(lower(btrim(unite_base)), '') <> 'kg';

update public.produits set unite_base = 'l'
where type_unite = 'volume' and coalesce(lower(btrim(unite_base)), '') <> 'l';

-- 5) Garde-fou : plus aucune variante en g/cl/ml (sinon rollback complet)
do $$
declare n int;
begin
  select count(*) into n
  from public.variantes_produit
  where lower(btrim(unite_quantite)) in ('g', 'cl', 'ml');
  if n <> 0 then
    raise exception 'Normalisation incomplète : % variantes encore en g/cl/ml — migration annulée', n;
  end if;
end $$;
