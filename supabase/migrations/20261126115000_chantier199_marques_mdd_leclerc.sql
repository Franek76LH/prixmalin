-- Chantier 199 (26/11/2026, feu vert écrit de François à 11h47) — APPLIQUÉ EN PROD via MCP Supabase.
-- Turini, Pêche Océan, Tables du Monde, Chaque Jour Sans Gluten = marques distributeur Leclerc
-- (tous leurs prix, 74 sur 39 fiches, sont chez Leclerc). Sauvegarde (RLS) : _sauv_marques_mdd_199.
-- Retour arrière : update marques m set est_mdd = s.est_mdd, enseigne_id = s.enseigne_id from _sauv_marques_mdd_199 s where s.id = m.id;
UPDATE public.marques m SET est_mdd = true, enseigne_id = '590444df-dda7-42ae-94ef-a58ad86290e6'
FROM public._sauv_marques_mdd_199 s WHERE m.id = s.id AND m.est_mdd = false;
