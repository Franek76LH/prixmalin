// Chantier 215 — bascule automatique de catégorie de magasins dans le
// comparateur. Constat du 26/11 : avec un seul article (pain de mie), la règle
// « moins de 6 articles → proximité » cherchait seulement dans les supérettes,
// n'y trouvait rien et affichait « Aucun prix » alors que le Lidl le plus
// proche en avait un. Décision de François (26/11, option 1) : si la catégorie
// choisie D'OFFICE n'a aucun prix mais que l'autre en a, on montre l'autre et
// on le dit. Jamais quand l'utilisateur a choisi lui-même.

export const GRANDE_SURFACE = 'grande_surface';
export const PROXIMITE = 'proximite';

export function autreCategorie(categorie) {
  return categorie === GRANDE_SURFACE ? PROXIMITE : GRANDE_SURFACE;
}

export function doitBasculer({ categorieAuto, nbMagasinsCategorie, nbMagasinsAutre }) {
  return categorieAuto === true && !(nbMagasinsCategorie > 0) && nbMagasinsAutre > 0;
}

// Chantier 216 — « Proximité » devient « Petites surfaces » à l'écran (François, 26/11).
// Chantier 223 — « Petites et moyennes surfaces » (supermarchés + supérettes).
const libelle = (c) => (c === PROXIMITE ? 'petites et moyennes surfaces' : 'grandes surfaces');

// Chantier 218 — l'utilisateur a choisi lui-même une catégorie vide : on
// respecte son choix, mais un bouton mène à l'autre catégorie si elle a des prix.
export function libelleBoutonAutre(categorie, nbMagasins) {
  const n = Number(nbMagasins) || 0;
  if (!categorie || n <= 0) return null;
  return `Voir les ${libelle(categorie)} (${n} magasin${n > 1 ? 's ont' : ' a'} des prix)`;
}

export function phraseBascule(bascule) {
  if (!bascule?.de || !bascule?.vers) return null;
  const vers = libelle(bascule.vers);
  return `Pas de prix en ${libelle(bascule.de)} pour ta liste : voici les ${vers}.`;
}
