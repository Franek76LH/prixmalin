-- PHASE 8 : Migration des données legacy vers la nouvelle architecture
-- Exécuté le 1er juillet 2026
-- Résultat : 169 produits, 407 alias, 503 prix migrés (97% couverture)
-- Note : script reconstitué après exécution manuelle dans Supabase SQL Editor

-- 8.1 : 9 enseignes + 15 magasins insérés avec UUID fixes a1000001 à a1000015
-- 8.2 : 14 catégories + 44 sous-catégories + 169 produits + 407 alias
-- 8.4 : Migration prix via alias_produits + enseignes (source='import', statut='valide')

-- Taux de couverture final : 546/562 lignes price_db matchées (97%)
-- 16 lignes ignorées (ustensiles, lentilles de contact, adoucissant)
