// Chantier 224 — petite icône de chaque ligne de « Ma liste ».
// Règle (décision de François du 26/11/2026, option « mélange ») : la vraie
// photo du produit quand on l'a (PhotoProduit, inchangé), sinon le dessin du
// rayon. Ce module ne choisit QUE le dessin de repli, sans aucun appel réseau.
//
// Ordre : 1) sous-catégorie puis rayon réel du produit (base : produits → sous_categories →
// categories) ; 2) pour une ligne tapée sans produit relié, le rayon deviné
// sur le nom (guessCategory de App.jsx, passé en argument) ; 3) panier 🧺.
import { emojiRayon } from './sessionCoursesCore';

export const EMOJI_PAR_DEFAUT = '🧺';

// Libellés renvoyés par guessCategory (App.jsx) → même dessin que le rayon réel.
const EMOJI_CATEGORIE_DEVINEE = {
  'Produits laitiers, œufs & fromages': '🥛',
  'Boissons alcoolisées': '🍷',
  'Boissons non alcoolisées': '🥤',
  'Fruits et légumes': '🥦',
  'Poissons & fruits de mer': '🐟',
  'Viandes & charcuterie': '🥩',
  'Légumes surgelés': '❄️',
  'Hygiène & Maison': '🧴',
  'Épicerie sucrée & petit déjeuner': '🍫',
  'Épicerie salée': '🧂',
};

// Dessin plus précis par sous-catégorie (le rayon « Épicerie salée » couvre
// 6 produits sur 10 : un seul 🧂 pour tous serait peu parlant).
const EMOJI_SOUS_CATEGORIE = {
  'Bières': '🍺', 'Vins': '🍷', 'Spiritueux & apéritifs': '🥃', 'Champagnes & effervescents': '🍾',
  'Café, thé & chaud': '☕', 'Sodas & colas': '🥤', 'Boissons végétales': '🥛', 'Eaux': '💧', 'Jus de fruits': '🧃',
  'Nettoyants ménagers': '🧽', 'Essuie-tout & papier': '🧻',
  'Conserves': '🥫', 'Chips & tuiles': '🥔', 'Fruits secs & graines': '🥜', 'Pâtes': '🍝',
  'Biscuits & crackers apéritifs': '🥨', 'Sauces & condiments': '🫙', 'Riz, semoules & céréales': '🍚',
  'Soufflés & snacks apéritifs': '🥨', 'Olives, tapenades & dips': '🫒', 'Huiles, vinaigres & assaisonnements': '🫙',
  'Farines & préparations culinaires': '🌾', 'Légumes secs': '🫘', 'Apéritif salé': '🥨',
  'Chocolat & confiserie': '🍫', 'Petit déjeuner & boulangerie industrielle': '🍞', 'Biscuits & gâteaux': '🍪',
  'Compotes & fruits transformés': '🍎', 'Sucre & aides pâtisserie': '🧁',
  'Fruits frais': '🍎', 'Légumes frais': '🥕', 'Salades & herbes': '🥬', "Légumes prêts à l'emploi": '🥗',
  'Hygiène corporelle': '🧴', 'Soin du visage & dents': '🪥',
  'Plats cuisinés': '🥘', 'Traiteur & snacking': '🥪',
  'Poisson pané & transformé': '🐟', 'Fruits de mer & coquillages': '🦐', 'Poisson frais': '🐟',
  'Fromages': '🧀', 'Yaourts & desserts lactés': '🥛', 'Lait': '🥛', 'Beurre & crème': '🧈', 'Œufs': '🥚',
  'Surgelés salés': '❄️', 'Glaces & desserts glacés': '🍨',
  'Charcuterie': '🥓', 'Bœuf': '🥩', 'Volaille': '🍗', 'Porc': '🥩', 'Autres viandes': '🥩',
};

export function emojiSousCategorie(nom) {
  return EMOJI_SOUS_CATEGORIE[nom] || null;
}

export function emojiCategorieDevinee(nomCategorie) {
  return EMOJI_CATEGORIE_DEVINEE[nomCategorie] || null;
}

// Chantier 225 — « Pommes », « Tomates », « Poireaux » : la fonction qui
// devine le rayon ne connaît que le singulier. On retente donc avec chaque mot
// sans son « s » / « x » final (mots de plus de 3 lettres). Sert UNIQUEMENT
// au dessin de « Ma liste ».
export function auSingulier(texte) {
  return String(texte || '')
    .split(/(\s+)/)
    .map(m => (m.length > 3 && /[sx]$/i.test(m) ? m.slice(0, -1) : m))
    .join('');
}

// item : ligne de la liste ; rayons : Map produit_id → rayon (chargerRayonsProduits) ;
// deviner : (nom) → libellé de catégorie (facultatif).
export function emojiArticleListe(item, rayons, deviner = null) {
  const rayon = item?.produit_id != null && rayons?.get ? rayons.get(item.produit_id) : null;
  if (rayon) return emojiSousCategorie(rayon.sous_categorie_nom) || emojiRayon(rayon);
  if (deviner && item?.product) {
    const e = emojiCategorieDevinee(deviner(item.product)) || emojiCategorieDevinee(deviner(auSingulier(item.product)));
    if (e) return e;
  }
  return EMOJI_PAR_DEFAUT;
}

// Clé stable des produits de la liste : sert à ne recharger les rayons que
// quand l'ensemble des produits change (pas à chaque coche).
export function cleProduitsListe(items) {
  const ids = [...new Set((items || []).map(i => i?.produit_id).filter(id => id != null).map(String))];
  return ids.sort().join(',');
}

// Chantier 227 — ligne « Format indifférent » (produit sans variante précise) :
// on montre la photo du format que la personne achète le plus souvent (ses
// propres lignes de ticket). lignes : [{ produit_id, variante_produit_id }].
// Rend { [produit_id]: variante_produit_id }. Égalité → identifiant le plus
// petit, pour que l'image ne change pas d'un affichage à l'autre.
export function varianteHabituelleParProduit(lignes) {
  const compte = new Map(); // produit -> Map(variante -> n)
  for (const l of Array.isArray(lignes) ? lignes : []) {
    const p = l?.produit_id, v = l?.variante_produit_id;
    if (typeof p !== 'string' || !p || typeof v !== 'string' || !v) continue;
    if (!compte.has(p)) compte.set(p, new Map());
    const m = compte.get(p);
    m.set(v, (m.get(v) || 0) + 1);
  }
  const res = {};
  for (const [p, m] of compte) {
    let meilleure = null, n = 0;
    for (const [v, c] of m) {
      if (c > n || (c === n && v < meilleure)) { meilleure = v; n = c; }
    }
    if (meilleure) res[p] = meilleure;
  }
  return res;
}

// Variante dont on montre la photo pour une ligne de la liste : la variante
// choisie si la ligne en a une, sinon le format habituel du produit, sinon rien.
export function variantePourPhoto(item, habituelles) {
  if (item?.variante_produit_id) return item.variante_produit_id;
  const p = item?.produit_id;
  return (p != null && habituelles && habituelles[p]) || null;
}
