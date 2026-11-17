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
