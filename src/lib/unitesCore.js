// #58.1.A — table de coefficients figée pour la comparaison au prix unitaire
// (kg/L/pièce), mode shadow. Module isolé, non branché à l'UI ni à Supabase.
//
// Construite à partir des unités réellement observées en base à l'étape 0
// (g, kg, l, cl, ml, casse variable L/l). mg et les tokens de la famille
// pièce/comptage (piece/pièce/unite/unité) n'ont eux jamais été observés
// dans unite_quantite à ce jour — ajoutés par anticipation (cohérence
// physique pour mg, exigence du ticket pour la famille pièce), à réviser
// si le panneau shadow révèle d'autres libellés réels.

const FAMILLE_POIDS = 'poids';
const FAMILLE_VOLUME = 'volume';
const FAMILLE_PIECE = 'piece';

// Coefficients vers l'unité canonique de la famille : kg (poids), L (volume),
// 1 pièce (comptage). Table figée : toute unité absente d'ici est une
// exclusion explicite ('unite_inconnue'), jamais un coefficient par défaut.
const TABLE_COEFFICIENTS = Object.freeze({
  mg: { famille: FAMILLE_POIDS, coefficient: 0.000001 },
  g: { famille: FAMILLE_POIDS, coefficient: 0.001 },
  kg: { famille: FAMILLE_POIDS, coefficient: 1 },

  ml: { famille: FAMILLE_VOLUME, coefficient: 0.001 },
  cl: { famille: FAMILLE_VOLUME, coefficient: 0.01 },
  dl: { famille: FAMILLE_VOLUME, coefficient: 0.1 },
  l: { famille: FAMILLE_VOLUME, coefficient: 1 },

  piece: { famille: FAMILLE_PIECE, coefficient: 1 },
  pièce: { famille: FAMILLE_PIECE, coefficient: 1 },
  unite: { famille: FAMILLE_PIECE, coefficient: 1 },
  unité: { famille: FAMILLE_PIECE, coefficient: 1 },
});

// Correspondance déclarative type_unite (colonne produits) -> famille
// attendue. 'lot' n'a volontairement aucune entrée : un lot est un contenu
// hétérogène, jamais réductible à une seule famille d'unité.
const FAMILLE_PAR_TYPE_UNITE = Object.freeze({
  poids: FAMILLE_POIDS,
  volume: FAMILLE_VOLUME,
  piece: FAMILLE_PIECE,
});

function normaliserUnite(texte) {
  return String(texte ?? '').trim().toLowerCase();
}

// Résout la famille et le coefficient d'une unité texte libre. Ne retourne
// JAMAIS de coefficient par défaut : une unité absente de la table est une
// exclusion explicite ('unite_inconnue'), jamais une supposition.
export function resoudreFamilleEtCoefficient(uniteTexteLibre) {
  const entree = TABLE_COEFFICIENTS[normaliserUnite(uniteTexteLibre)];
  if (!entree) return { exclusion: 'unite_inconnue' };
  return { famille: entree.famille, coefficient: entree.coefficient };
}

// Famille attendue pour un type_unite de produit donné, ou null si le
// type_unite est absent, inconnu, ou 'lot' (jamais convertible en une seule
// unité canonique).
export function familleDepuisTypeUnite(typeUnite) {
  return FAMILLE_PAR_TYPE_UNITE[normaliserUnite(typeUnite)] ?? null;
}

function estNumeriquePositif(valeur) {
  if (typeof valeur === 'boolean' || valeur == null || valeur === '') return false;
  const n = Number(valeur);
  return Number.isFinite(n) && n > 0;
}

// Calcule le prix de référence (€/kg, €/L ou €/pièce) d'une ligne de prix.
// Toute donnée manquante, non numérique, négative, ou incohérence entre
// type_unite et l'unité produit une exclusion explicite — jamais un nombre
// faux calculé sur une supposition.
export function calculerPrixReference({ prix_total, quantite_nette, unite_quantite, nombre_unites, type_unite }) {
  if (!estNumeriquePositif(prix_total)) return { exclusion: 'prix_total_invalide' };
  if (!estNumeriquePositif(quantite_nette)) return { exclusion: 'quantite_nette_invalide' };
  if (!estNumeriquePositif(nombre_unites)) return { exclusion: 'nombre_unites_invalide' };

  const resolution = resoudreFamilleEtCoefficient(unite_quantite);
  if (resolution.exclusion) return resolution;

  const familleAttendue = familleDepuisTypeUnite(type_unite);
  if (!familleAttendue) return { exclusion: 'type_unite_non_supporte' };
  if (familleAttendue !== resolution.famille) return { exclusion: 'type_unite_incoherent' };

  if (resolution.famille === FAMILLE_PIECE) {
    return { prix_reference: Number(prix_total) / Number(nombre_unites), famille: FAMILLE_PIECE, unite: 'piece' };
  }

  const quantite_totale_native = Number(quantite_nette) * Number(nombre_unites);
  const quantite_totale_canonique = quantite_totale_native * resolution.coefficient;
  const unite = resolution.famille === FAMILLE_POIDS ? 'kg' : 'L';

  return { prix_reference: Number(prix_total) / quantite_totale_canonique, famille: resolution.famille, unite };
}

// Chantier « Catalogue épuré » — €/kg ou €/L ROBUSTE à partir de la seule unité
// stockée (unite_quantite), sans exiger type_unite. Convertit g/kg/mg et
// ml/cl/dl/l vers l'unité canonique (kg ou L) : une variante stockée en grammes
// donne donc un €/kg CORRECT (bug du classement ~1000× trop bas fermé). Retourne
// null (jamais un nombre faux) si l'unité n'est pas une unité de poids/volume
// connue (ex. 'pièce', 'unite_inconnue') ou si une donnée est invalide.
export function calculerPrixReferenceParUnite({ prix_total, quantite_nette, unite_quantite, nombre_unites }) {
  if (!estNumeriquePositif(prix_total)) return null;
  if (!estNumeriquePositif(quantite_nette)) return null;

  const nuBrut = Number(nombre_unites);
  const nombreUnites = Number.isFinite(nuBrut) && nuBrut > 0 ? nuBrut : 1;

  const resolution = resoudreFamilleEtCoefficient(unite_quantite);
  if (resolution.exclusion) return null;
  if (resolution.famille === FAMILLE_PIECE) return null; // pas de €/kg pour une pièce

  const totalCanonique = Number(quantite_nette) * nombreUnites * resolution.coefficient;
  if (!(totalCanonique > 0)) return null;

  const unite = resolution.famille === FAMILLE_POIDS ? 'kg' : 'L';
  return { valeur: Number(prix_total) / totalCanonique, unite };
}

// #58.2.A — classe des entrées (une par magasin) selon leur prix unitaire
// (€/kg ou €/L), du moins cher au plus cher. Pure, ne mute jamais le tableau
// d'entrée : chaque entrée retournée est une copie. Les entrées sans
// prixUnitaire exploitable vont dans nonComparables (triées par prixBrut),
// jamais mêlées au classement.
export function classerParPrixUnitaire(entrees) {
  const liste = Array.isArray(entrees) ? entrees : [];

  const comparables = [];
  const nonComparables = [];
  liste.forEach((entree) => {
    if (Number.isFinite(entree.prixUnitaire)) {
      comparables.push({ ...entree });
    } else {
      nonComparables.push({ ...entree });
    }
  });

  comparables.sort((a, b) => a.prixUnitaire - b.prixUnitaire);
  nonComparables.sort((a, b) => a.prixBrut - b.prixBrut);

  let rangCourant = 0;
  let dernierPrixUnitaire = null;
  const classes = comparables.map((entree, index) => {
    if (dernierPrixUnitaire === null || entree.prixUnitaire !== dernierPrixUnitaire) {
      rangCourant = index + 1;
      dernierPrixUnitaire = entree.prixUnitaire;
    }
    return { ...entree, rang: rangCourant, estMoinsCher: rangCourant === 1 };
  });

  return { classes, nonComparables };
}
