// Chantier 125 — la carte de l'app : quel écran appartient à quelle entrée de
// la barre du bas, comment il s'appelle, et où ramène sa flèche « retour ».
// Séparé des composants pour être testé seul.
//
// Chantier 160 (20/11) — barre « Accueil · Courses · Scanner · Comparer ·
// Moi ». « Courses » réunit Ma liste (achats en préparation) et Mes courses
// (la liste validée, une fois le magasin choisi). « Scanner » (bouton rond au
// centre) ouvre le scan du ticket de caisse.

// Onglets rattachés à chaque entrée de la barre du bas.
const FAMILLES = {
  home: 'home', prices: 'scan',
  list: 'courses', catalog: 'courses', micro: 'courses', courses: 'courses',
  compare: 'compare',
  moi: 'moi', archive: 'moi', economies: 'moi', rejets: 'moi', evolution: 'moi',
};

const TITRES = {
  list: 'Ma liste', catalog: 'Ajouter des produits', micro: 'Dicter mes courses', courses: 'Mes courses',
  compare: 'Où c\'est le moins cher ?', prices: 'Scanner un ticket',
  moi: 'Mon espace', archive: 'Mes tickets', economies: 'Mes économies', rejets: 'Rejets', evolution: 'Évolution de mes prix',
};

// Écran vers lequel la flèche « retour » ramène par défaut. Absent = écran de
// premier niveau (Ma liste et Mes courses sont les deux états de « Courses »),
// donc pas de flèche.
const PARENTS = {
  catalog: 'list', micro: 'list',
  archive: 'moi', economies: 'moi', rejets: 'moi', evolution: 'moi',
  prices: 'home',
};

// Écrans qu'on ouvre depuis plusieurs endroits : leur flèche ramène là d'où
// l'on vient (l'accueil, Ma liste, le catalogue, Mes courses…), pas toujours
// au parent. Le scan du ticket aussi : annuler ramène à l'écran de départ.
export const ECRANS_A_ORIGINE = ['catalog', 'micro', 'prices'];

export function entreeActive(tab) {
  return FAMILLES[tab] || 'home';
}
export function titreEcran(tab) {
  return TITRES[tab] || 'PrixMalin';
}
export function ecranParent(tab) {
  return PARENTS[tab] || null;
}

// Flèche « retour » : l'écran d'origine quand on le connaît (et qu'il existe),
// sinon le parent par défaut.
export function ecranRetour(tab, origines = {}) {
  const parent = ecranParent(tab);
  if (!parent) return null;
  const origine = ECRANS_A_ORIGINE.includes(tab) ? origines?.[tab] : null;
  if (origine && origine !== tab && FAMILLES[origine]) return origine;
  return parent;
}

// Mémorise d'où l'on vient quand on ouvre un écran « à origine ». Un retour en
// arrière (on revient sur l'écran d'où l'on était parti) ne réécrit rien :
// sinon catalogue → micro → retour → le catalogue renverrait vers le micro.
export function noterOrigine(origines, depuis, vers) {
  if (!ECRANS_A_ORIGINE.includes(vers) || !depuis || depuis === vers) return origines;
  if (origines?.[depuis] === vers) return origines;
  return { ...origines, [vers]: depuis };
}

// L'entrée « Courses » de la barre : Mes courses s'il y a une liste validée
// en cours, sinon Ma liste.
export function ecranCourses(sessionActive) {
  return sessionActive ? 'courses' : 'list';
}

// Chantier 176 — à l'ouverture de l'app, des courses touchées il y a moins de
// 12 heures (dernière coche, ou création) : on rouvre directement dessus, sans
// page de garde. Au-delà, ce sont de vieilles courses oubliées : on reste sur
// l'accueil, qui propose « Reprendre » ou « Abandonner ».
export const DELAI_REPRISE_COURSES_MS = 12 * 60 * 60 * 1000;
export function ouvrirSurCourses(sessionCourses, maintenantMs = Date.now()) {
  if (!sessionCourses || sessionCourses.statut !== 'active') return false;
  const derniere = Date.parse(sessionCourses.modifie_le || sessionCourses.cree_le || '');
  if (!Number.isFinite(derniere)) return false;
  const ecart = maintenantMs - derniere;
  return ecart >= 0 && ecart <= DELAI_REPRISE_COURSES_MS;
}

// Chantier 185 — historique de navigation. Chaque changement d'écran ajoute
// une page à l'historique du téléphone : le bouton « retour » d'Android (ou
// le geste de retour) ramène à l'écran précédent au lieu de quitter l'app, et
// un rechargement rouvre le même écran. On ne touche pas à l'adresse de la
// page : l'écran est rangé dans l'état de l'historique (et, en secours, dans
// la mémoire de l'onglet).
export const CLE_ECRAN_SESSION = 'prixmalin_ecran_v1';
export const ECRANS_CONNUS = Object.keys(FAMILLES);

export function ecranValide(ecran) {
  return typeof ecran === 'string' && ECRANS_CONNUS.includes(ecran);
}

// L'écran rangé dans une page d'historique (ou null si ce n'est pas une page
// de PrixMalin).
export function lireEtatHistorique(etat) {
  if (!etat || typeof etat !== 'object') return null;
  const ecran = etat.prixmalin;
  if (!ecranValide(ecran)) return null;
  const n = Number.isInteger(etat.n) && etat.n >= 0 ? etat.n : 0;
  return { ecran, n };
}

export function etatHistorique(ecran, n) {
  return { prixmalin: ecran, n };
}

// Après un rechargement : quel écran rouvrir. Le scan du ticket et le micro
// ne se rouvrent pas tout seuls (caméra ou micro qui se relancent sans qu'on
// l'ait demandé) : on revient à l'écran d'où on les ouvre.
const APRES_RECHARGEMENT = { prices: 'home', micro: 'list' };
export function ecranApresRechargement(ecran) {
  if (!ecranValide(ecran)) return null;
  return APRES_RECHARGEMENT[ecran] || ecran;
}

// Flèche « retour » de l'en-tête : si l'écran visé est justement la page
// d'avant dans l'historique, on recule dans l'historique (sinon le retour du
// téléphone ramènerait ensuite sur l'écran qu'on vient de quitter).
export function reculerDansHistorique(pile, index, cible) {
  return Array.isArray(pile) && Number.isInteger(index) && index > 0 && pile[index - 1] === cible;
}
