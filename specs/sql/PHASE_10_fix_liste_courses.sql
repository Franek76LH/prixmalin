-- ============================================================
-- PHASE 10 — Correction saisie manuelle liste de courses v1.0
-- #61 PrixMalin — Conserver le libellé tapé + droits INSERT/UPDATE manquants
-- Exécuté le 6 juillet 2026
-- ============================================================
-- Trace des commandes déjà appliquées manuellement en base (Supabase SQL
-- Editor) — ce fichier ne les rejoue pas, il documente ce qui a été fait.
-- ============================================================

-- Conserve le texte tapé par l'utilisateur quand la reconnaissance d'alias
-- résout un produit_id à sa place, pour l'afficher tel quel plutôt que le
-- nom_reference du catalogue (voir App.jsx addItem / catalogueCore.js
-- mapperLigneListeCourses).
ALTER TABLE public.liste_courses ADD COLUMN IF NOT EXISTS libelle_saisi text;

-- Droits INSERT/UPDATE manquants sur liste_courses pour le rôle authenticated
-- (cause de l'échec silencieux "Sauvegarde échouée" à l'ajout manuel d'articles).
GRANT INSERT, UPDATE ON public.liste_courses TO authenticated;
