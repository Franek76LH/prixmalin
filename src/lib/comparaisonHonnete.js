// Chantier 122 — comparaison honnête de la liste de courses.
//
// Constat du 09/11 : avec 6 produits dans la liste, l'écran annonçait
// « MEILLEUR PRIX PARTIEL — Carrefour 11,22 € » alors que Carrefour n'avait
// que 2 prix sur 6. Il n'était pas le moins cher : il était le seul à avoir
// deux prix. Et la phrase « tu économises X € » comparait deux paniers qui ne
// contenaient pas les mêmes produits — économie fausse, qui partait en plus
// dans la cagnotte.
//
// Règles (décidées le 09/11, brief chantier « liste honnête ») :
//   1. Si le magasin le mieux renseigné couvre moins de la moitié de la liste,
//      AUCUN gagnant n'est désigné.
//   2. La couverture passe avant le prix (déjà le cas du classement : on ne le
//      refait pas ici, on le lit).
//   3. Une économie ne se calcule QUE sur les produits que les deux magasins
//      ont en commun, et on dit sur combien de produits.
//
// Module pur : aucune requête, aucun effet. Il lit `ranked` et `analysis` tels
// que CompareTab les produit déjà (legacy ou Core), sans les modifier.

export const ETAT_AUCUN_PRIX = 'aucun_prix';
export const ETAT_INSUFFISANT = 'insuffisant';
export const ETAT_GAGNANT = 'gagnant';

function quantite(item) {
  const q = Number(item?.qty);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function prixDe(byStore, magasinId) {
  const p = byStore?.[magasinId];
  const prix = Number(p?.price);
  return p && Number.isFinite(prix) ? prix : null;
}

// Compare deux magasins sur les SEULS produits qu'ils ont tous les deux.
// ecart > 0 : `autreId` est plus cher que `gagnantId` sur ce panier commun.
export function comparerSurProduitsCommuns(analysis, gagnantId, autreId) {
  let nbCommuns = 0;
  let totalGagnant = 0;
  let totalAutre = 0;
  for (const { item, byStore } of analysis || []) {
    const a = prixDe(byStore, gagnantId);
    const b = prixDe(byStore, autreId);
    if (a == null || b == null) continue;
    const q = quantite(item);
    nbCommuns += 1;
    totalGagnant += a * q;
    totalAutre += b * q;
  }
  const arrondi = (n) => Math.round(n * 100) / 100;
  return {
    nbCommuns,
    totalGagnant: arrondi(totalGagnant),
    totalAutre: arrondi(totalAutre),
    ecart: arrondi(totalAutre - totalGagnant),
  };
}

// Verdict de la comparaison.
//   ranked     : magasins classés (couverture décroissante puis total croissant)
//   analysis   : [{ item, byStore: { [magasinId]: { price } } }]
//   nbArticles : nombre de lignes de la liste
export function evaluerComparaison({ ranked, analysis, nbArticles }) {
  const classement = Array.isArray(ranked) ? ranked : [];
  const total = Number(nbArticles) || 0;
  const vide = { etat: ETAT_AUCUN_PRIX, gagnant: null, reference: null, economie: 0, nbCommuns: 0, couvertureMax: 0, complet: false };
  if (classement.length === 0 || total === 0) return vide;

  const gagnant = classement[0];
  const couvertureMax = Number(gagnant.found) || 0;

  // Règle 1 — moins de la moitié de la liste : personne ne gagne.
  if (couvertureMax * 2 < total) {
    return { ...vide, etat: ETAT_INSUFFISANT, couvertureMax };
  }

  // Règle 3 — magasin de référence : celui qui partage le plus de produits
  // avec le gagnant (à égalité, le mieux classé). C'est face à lui seul qu'une
  // économie a un sens.
  let reference = null;
  let meilleure = null;
  for (const autre of classement.slice(1)) {
    const c = comparerSurProduitsCommuns(analysis, gagnant.id, autre.id);
    if (c.nbCommuns === 0) continue;
    if (!meilleure || c.nbCommuns > meilleure.nbCommuns) { meilleure = c; reference = autre; }
  }

  // Une économie n'est annoncée que si elle porte sur au moins la moitié des
  // produits trouvés chez le gagnant : en dessous, ce serait encore comparer
  // deux paniers différents.
  const comparable = meilleure && meilleure.nbCommuns * 2 >= couvertureMax;
  const economie = comparable && meilleure.ecart > 0 ? meilleure.ecart : 0;

  return {
    etat: ETAT_GAGNANT,
    gagnant,
    reference: comparable ? reference : null,
    economie,
    nbCommuns: comparable ? meilleure.nbCommuns : 0,
    couvertureMax,
    complet: couvertureMax >= total,
  };
}
