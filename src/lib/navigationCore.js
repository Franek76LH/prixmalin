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
