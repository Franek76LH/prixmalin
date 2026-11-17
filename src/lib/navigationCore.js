// Chantier 125 — la carte de l'app : quel écran appartient à quelle entrée de
// la barre du bas, comment il s'appelle, et où ramène sa flèche « retour ».
// Séparé des composants pour être testé seul.

// Onglets rattachés à chaque entrée de la barre du bas.
const FAMILLES = {
  home: 'home',
  list: 'list', catalog: 'list', micro: 'list', courses: 'list',
  prices: 'scan',
  compare: 'compare',
  moi: 'moi', archive: 'moi', economies: 'moi', rejets: 'moi', evolution: 'moi',
};

const TITRES = {
  list: 'Ma liste', catalog: 'Ajouter des produits', micro: 'Dicter ma liste', courses: 'Mes courses',
  compare: 'Où c\'est le moins cher ?', prices: 'Scanner un ticket',
  moi: 'Mon espace', archive: 'Mes tickets', economies: 'Mes économies', rejets: 'Rejets', evolution: 'Évolution de mes prix',
};

// Écran vers lequel la flèche « retour » ramène. Absent = écran de premier
// niveau (il a sa propre entrée dans la barre du bas), donc pas de flèche.
const PARENTS = {
  catalog: 'list', micro: 'list', courses: 'list',
  archive: 'moi', economies: 'moi', rejets: 'moi', evolution: 'moi',
  prices: 'home',
};

export function entreeActive(tab) {
  return FAMILLES[tab] || 'home';
}
export function titreEcran(tab) {
  return TITRES[tab] || 'PrixMalin';
}
export function ecranParent(tab) {
  return PARENTS[tab] || null;
}
