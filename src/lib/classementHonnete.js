// Chantier 177 — classement honnête des magasins (propositions 2 et 3 de
// l'audit du 25/11).
//
// Avant : le magasin qui avait le PLUS DE PRIX gagnait, puis seulement le
// moins cher. Comme Leclerc porte la majorité des prix relevés, il gagnait
// presque toujours, et pouvait être annoncé « le moins cher » alors qu'il
// était plus cher sur les produits que les autres vendent aussi.
//
// Maintenant :
//   1. Un magasin n'entre dans la comparaison que s'il a un prix pour au
//      moins la moitié de la liste (même règle que comparaisonHonnete.js).
//   2. Les magasins retenus (3 au plus, les mieux renseignés) sont comparés
//      sur le PANIER COMMUN : les seuls produits qu'ils ont tous.
//   3. « Le moins cher » = le plus bas sur ce panier commun, à condition que
//      ce panier soit assez grand (au moins la moitié des prix du magasin le
//      mieux renseigné) ; sinon personne n'est désigné.
//   4. « Le plus complet » = le magasin qui a le plus de prix (s'il n'est pas
//      déjà le moins cher).
// Tous les magasins restent affichés et choisissables : l'utilisateur fait
// ses courses où il veut.
//
// Module pur : il lit `ranked` (déjà trié par couverture puis total) et
// `analysis` tels que CompareTab les produit, sans les modifier.

export const ETAT_GAGNANT = 'gagnant';
export const ETAT_SANS_COMPARAISON = 'sans_comparaison';
export const ETAT_INSUFFISANT = 'insuffisant';

const arrondi = (n) => Math.round(n * 100) / 100;

function quantite(item) {
  const q = Number(item?.qty);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function prixDe(byStore, magasinId) {
  const p = byStore?.[magasinId];
  const prix = Number(p?.price);
  return p && Number.isFinite(prix) ? prix : null;
}

// Lignes de la liste dont TOUS les magasins donnés ont un prix.
export function produitsCommuns(analysis, magasinIds) {
  return (analysis || []).filter(({ byStore }) => magasinIds.every(id => prixDe(byStore, id) != null));
}

function totalSur(lignes, magasinId) {
  return arrondi(lignes.reduce((s, { item, byStore }) => s + prixDe(byStore, magasinId) * quantite(item), 0));
}

export function classerMagasinsComparables({ ranked, analysis, nbArticles, maxComparés = 3, maxAffichés = 5 }) {
  const tous = Array.isArray(ranked) ? ranked : [];
  const total = Number(nbArticles) || 0;
  const vide = { etat: ETAT_INSUFFISANT, magasins: [], moinsCherId: null, plusCompletId: null, nbCommuns: 0, idParDefaut: null };
  if (tous.length === 0 || total === 0) return vide;

  const assezRenseigne = (m) => (Number(m.found) || 0) * 2 >= total;
  const candidats = tous.filter(assezRenseigne);
  // « Le plus complet » seulement s'il a strictement plus de prix que les autres.
  const plusCompletId = (tous.length === 1 || (Number(tous[0].found) || 0) > (Number(tous[1].found) || 0)) ? tous[0].id : null;

  let groupe = candidats.slice(0, maxComparés);
  let communs = groupe.length >= 2 ? produitsCommuns(analysis, groupe.map(m => m.id)) : [];
  // Trop peu de produits en commun à trois : on compare les deux mieux renseignés.
  while (groupe.length > 2 && communs.length * 2 < (Number(groupe[0].found) || 0)) {
    groupe = groupe.slice(0, -1);
    communs = produitsCommuns(analysis, groupe.map(m => m.id));
  }
  const comparable = groupe.length >= 2 && communs.length > 0 && communs.length * 2 >= (Number(groupe[0].found) || 0);

  const totauxCommuns = new Map(comparable ? groupe.map(m => [m.id, totalSur(communs, m.id)]) : []);
  let moinsCherId = null;
  if (comparable) {
    // À égalité, le mieux renseigné (ordre de `groupe`).
    moinsCherId = groupe.reduce((meilleur, m) => (totauxCommuns.get(m.id) < totauxCommuns.get(meilleur.id) ? m : meilleur), groupe[0]).id;
  }

  const etat = candidats.length === 0 ? ETAT_INSUFFISANT : (moinsCherId ? ETAT_GAGNANT : ETAT_SANS_COMPARAISON);

  // Ordre d'affichage : le moins cher, puis les autres comparés (du moins
  // cher au plus cher sur le panier commun), puis les autres magasins assez
  // renseignés, puis les autres, par nombre de prix.
  const dansGroupe = new Set(totauxCommuns.keys());
  const comparés = [...groupe].filter(m => dansGroupe.has(m.id)).sort((a, b) => totauxCommuns.get(a.id) - totauxCommuns.get(b.id));
  const reste = tous.filter(m => !dansGroupe.has(m.id));
  const ordre = [...comparés, ...reste].slice(0, maxAffichés);

  const magasins = ordre.map(m => {
    const etiquettes = [];
    if (m.id === moinsCherId) etiquettes.push('moins_cher');
    if (m.id === plusCompletId && m.id !== moinsCherId && tous.length > 1) etiquettes.push('plus_complet');
    return {
      id: m.id,
      magasin: m,
      found: Number(m.found) || 0,
      total: Number(m.total) || 0,
      assezRenseigne: assezRenseigne(m),
      totalCommuns: totauxCommuns.has(m.id) ? totauxCommuns.get(m.id) : null,
      ecartCommuns: moinsCherId && totauxCommuns.has(m.id) && m.id !== moinsCherId
        ? arrondi(totauxCommuns.get(m.id) - totauxCommuns.get(moinsCherId)) : null,
      etiquettes,
    };
  });

  return {
    etat,
    magasins,
    moinsCherId,
    plusCompletId,
    nbCommuns: comparable ? communs.length : 0,
    idParDefaut: moinsCherId ?? tous[0].id,
  };
}
