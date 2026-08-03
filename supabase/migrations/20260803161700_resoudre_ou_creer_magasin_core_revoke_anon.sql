-- LOT 1 « reconnaissance magasin au scan » — correctif ACL.
--
-- La recréation d'une fonction dans le schéma public hérite des défauts Supabase
-- (EXECUTE accordé à anon + authenticated). Le `revoke all ... from public` de la
-- migration précédente ne retire PAS le grant direct que ces défauts posent sur
-- anon. On le révoque explicitement pour calquer exactement enregistrer_ticket_core :
-- EXECUTE réservé à authenticated + service_role, anon => aucun.
revoke all on function public.resoudre_ou_creer_magasin_core(uuid,text,text,text,text,numeric,numeric,text,text,boolean,uuid) from anon;
