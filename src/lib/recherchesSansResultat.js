// Chantier 175 — carnet ANONYME des recherches du catalogue qui ne trouvent
// rien (mot + date, aucun identifiant d'utilisateur), pour savoir quels
// produits ajouter. La base revérifie qu'il n'y a vraiment aucun résultat.
//
// Pour ne pas noter les mots à moitié tapés (« nut », « nute »…), on attend
// que la recherche reste vide 2 secondes sans nouvelle frappe ; un même mot
// n'est noté qu'une fois par ouverture de l'app. Jamais bloquant.
import { supabase } from './supabase';

const DELAI_MS = 2000;
let minuteur = null;
const dejaNotes = new Set();

export function normaliserTermeRecherche(terme) {
  return String(terme ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Faut-il noter ce mot ? (pur)
export function termeANoter(terme, deja = dejaNotes) {
  const t = normaliserTermeRecherche(terme);
  return t.length >= 3 && t.length <= 60 && !deja.has(t);
}

// À appeler à chaque fin de recherche. `vide` : la recherche n'a rien trouvé.
export function suivreRecherche(terme, vide, { delaiMs = DELAI_MS, envoyer = envoyerTerme } = {}) {
  if (minuteur) { clearTimeout(minuteur); minuteur = null; }
  if (!vide || !termeANoter(terme)) return;
  const t = normaliserTermeRecherche(terme);
  minuteur = setTimeout(() => {
    minuteur = null;
    dejaNotes.add(t);
    try { envoyer(t); } catch { /* jamais bloquant */ }
  }, delaiMs);
}

// Annule une note en attente (nouvelle frappe, recherche effacée…).
export function annulerSuiviRecherche() {
  if (minuteur) { clearTimeout(minuteur); minuteur = null; }
}

async function envoyerTerme(t) {
  try { await supabase.rpc('noter_recherche_sans_resultat', { p_terme: t }); } catch { /* muet */ }
}

// Pour les tests.
export function _reinitialiserSuivi() { annulerSuiviRecherche(); dejaNotes.clear(); }
