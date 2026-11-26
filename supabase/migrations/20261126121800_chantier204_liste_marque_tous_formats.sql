-- Chantier 204 (26/11/2026, feu vert écrit de François à 12h15) — APPLIQUÉ EN PROD via MCP Supabase.
-- Décision de François (12h13) : une marque dite à plusieurs formats = « cette marque, tous formats ».
ALTER TABLE public.liste_courses ADD COLUMN marque_id uuid REFERENCES public.marques(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.liste_courses.marque_id IS 'Chantier 204 (26/11/2026) : marque dite, « cette marque, tous formats » (seulement sans variante).';
-- Retour arrière : ALTER TABLE public.liste_courses DROP COLUMN marque_id;  (l'app relit alors la liste sans la marque, filet lireListeCourses)
