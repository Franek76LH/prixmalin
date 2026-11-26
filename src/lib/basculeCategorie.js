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

const libelle = (c) => (c === PROXIMITE ? 'proximité' : 'grandes surfaces');

export function phraseBascule(bascule) {
  if (!bascule?.de || !bascule?.vers) return null;
  const vers = bascule.vers === PROXIMITE ? 'magasins de proximité' : 'grandes surfaces';
  return `Pas de prix en ${libelle(bascule.de)} pour ta liste : voici les ${vers}.`;
}
