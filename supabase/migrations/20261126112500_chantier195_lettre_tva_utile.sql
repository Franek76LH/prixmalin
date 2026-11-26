-- Chantier 195 (26/11/2026, feu vert écrit de François à 11h25) — APPLIQUÉ EN PROD via MCP Supabase.
-- Sauvegardes (RLS) : _sauv_memoire_cles_195 (113 lignes de correspondances_ticket_enseigne), _sauv_fonction_normaliser_195.
-- Données : 14 clés Utile de correspondances_ticket_enseigne recalculées depuis leur ligne de ticket source
-- (appariement exact, garde anti-collision, 14 attendues / 14 faites). Exemple : 'a 1x just four classi' -> 'just four classi'.

CREATE OR REPLACE FUNCTION public.normaliser_libelle_ticket(txt text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Chantier 113. Retire le CODE DE RAYON en tête d'une ligne de ticket
  -- (Carrefour : « 4* » alimentaire, « 6* » non alimentaire), puis applique
  -- la normalisation habituelle.
  --
  -- L'OCR lit tantôt « * » tantôt « x » : deux caractères quasi identiques sur
  -- un ticket de caisse. Sans ce nettoyage, le même produit produit deux clés
  -- de mémoire différentes et n'est jamais reconnu deux fois de suite.
  --
  -- Le motif exige un chiffre SUIVI de « * » ou « x » : c'est ce qui distingue
  -- un code de rayon d'un vrai chiffre. « 4RLX PAP HYG » (4 rouleaux) et
  -- « 25 SACS POUB » restent donc intacts.
  -- Un seul préfixe est retiré : « 4x4X125G » devient « 4X125G », le format survit.
  --
  -- Chantier 195 (26/11/2026, feu vert de François). Retire AUSSI, avant, le
  -- CODE DE TVA d'une lettre imprimé par Utile en tête de ligne (« A 1X JUST
  -- FOUR CLASSI », « B 1X B/BLDE LEFFE RIT ») : la même ligne sortait tantôt
  -- avec, tantôt sans cette lettre, et la mémoire ne la reconnaissait plus.
  -- Seule une lettre A à D SUIVIE D'UN ESPACE est retirée : « B/BLDE » (bière
  -- blonde) garde son B. Ancienne version : table _sauv_fonction_normaliser_195.
  select public.normaliser_libelle(
    regexp_replace(
      regexp_replace(coalesce(txt,''), '^\s*[A-Da-d]\s+', ''),
      '^\s*[0-9]+[*xX]', '')
  );
$function$;
