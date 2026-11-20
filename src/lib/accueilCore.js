// Chantier 123 — ce que l'accueil doit dire, calculé à part de l'écran.
//
// Retour du 17/11 : des amis à qui François montrait l'app étaient perdus dès
// l'accueil (grande illustration, gros bouton « Flasher », cagnotte, badges…
// et nulle part « ma liste »). Le nouvel accueil suit le chemin d'une app de
// courses classique : chercher, faire sa liste, comparer, scanner son ticket.
// Ce module décide QUOI montrer ; l'écran ne fait que l'afficher.

// Somme des économies CONFIRMÉES par un ticket scanné.
export function economiesConfirmees(archives) {
  return arrondir((archives || [])
    .filter(a => a?.ticket_scanned && a?.realized_saving != null)
    .reduce((s, a) => s + (Number(a.realized_saving) || 0), 0));
}

// Somme des économies ESTIMÉES au moment de choisir un magasin.
// Les anciennes estimations pouvaient être négatives (l'ancien calcul
// soustrayait deux paniers différents, cf. chantier 122) : une « économie »
// négative n'a aucun sens pour l'utilisateur, on ne compte que les positives.
export function economiesEstimees(archives) {
  return arrondir((archives || [])
    .reduce((s, a) => s + Math.max(0, Number(a?.potential_saving) || 0), 0));
}

function arrondir(n) {
  return Math.round(n * 100) / 100;
}

// Aperçu de la liste pour la carte « Ma liste » de l'accueil.
//   apercu : les premiers noms (non cochés d'abord), reste : combien d'autres.
export function apercuListe(items, max = 4) {
  const liste = Array.isArray(items) ? items : [];
  const aAcheter = liste.filter(i => !i?.checked);
  const noms = aAcheter
    .map(i => String(i?.product || '').trim())
    .filter(Boolean);
  return {
    total: liste.length,
    aAcheter: aAcheter.length,
    apercu: noms.slice(0, max),
    reste: Math.max(0, noms.length - max),
  };
}

// L'action principale proposée sur l'accueil, une seule à la fois, dans
// l'ordre où un utilisateur en a besoin.
export const ACTION_REPRENDRE_COURSES = 'reprendre_courses';
export const ACTION_COMPARER = 'comparer';
export const ACTION_COMMENCER_LISTE = 'commencer_liste';

export function actionPrincipale({ items, sessionCourses }) {
  if (sessionCourses) return ACTION_REPRENDRE_COURSES;
  if ((items || []).some(i => !i?.checked)) return ACTION_COMPARER;
  return ACTION_COMMENCER_LISTE;
}

// Le mode d'emploi en 3 étapes n'est montré qu'aux nouveaux : dès qu'un
// ticket a été scanné ou des courses validées, il disparaît.
export function montrerModeDemploi({ archives, items }) {
  return (archives || []).length === 0 && (items || []).length === 0;
}

// Chantier 160 — carte « Économies estimées » (accueil et Moi). Trois états,
// jamais de chiffre inventé :
//   - 'tickets'    : au moins un ticket analysé. Le prix PAYÉ est réel, mais la
//                    référence est le prix moyen du même produit, même format,
//                    dans les autres magasins : c'est donc une estimation.
//   - 'comparaison': aucun ticket analysé, mais des magasins choisis avec un
//                    écart estimé (produits trouvés dans plusieurs magasins).
//   - 'vide'       : rien à montrer, on invite à comparer.
export const PHRASE_ECONOMIES_TICKETS = 'Ce que tu as payé sur tes tickets, comparé au prix moyen du même produit, même format, dans les autres magasins.';
export const PHRASE_ECONOMIES_COMPARAISON = 'Écart calculé quand tu as choisi ton magasin, sur les produits trouvés dans plusieurs magasins. Scanne ton ticket pour le mesurer sur ce que tu as payé.';
export const PHRASE_ECONOMIES_VIDE = 'Compare ta liste : on te dira où elle coûte le moins cher.';

export function carteEconomies(archives) {
  const liste = Array.isArray(archives) ? archives : [];
  const analyses = liste.filter(a => a?.ticket_scanned && a?.realized_saving != null);
  if (analyses.length > 0) {
    return { etat: 'tickets', montant: economiesConfirmees(liste), nbTickets: analyses.length, phrase: PHRASE_ECONOMIES_TICKETS };
  }
  const estimees = economiesEstimees(liste);
  if (estimees > 0) {
    return { etat: 'comparaison', montant: estimees, nbTickets: 0, phrase: PHRASE_ECONOMIES_COMPARAISON };
  }
  return { etat: 'vide', montant: null, nbTickets: 0, phrase: PHRASE_ECONOMIES_VIDE };
}
