-- 18/11/2026 — Chantiers 93 et 149 : l'app n'avait pas le droit d'écrire
-- tickets.empreinte ni tickets.texte_ocr_brut (droits par colonne limités à
-- cercle_id, date_ticket, devise, magasin_id, montant_total). Conséquence :
-- 0 empreinte sur 22 tickets, aucune lecture conservée.
-- Appliqué en prod le 18/11/2026 à 17h (feu vert écrit de François).
-- La règle « chacun ne modifie que ses propres tickets » (tickets_modification_propre)
-- reste inchangée. Retour arrière :
--   revoke update (texte_ocr_brut, empreinte) on public.tickets from authenticated;
grant update (texte_ocr_brut, empreinte) on public.tickets to authenticated;
