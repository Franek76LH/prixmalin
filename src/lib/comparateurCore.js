import { supabase } from './supabase';

// #56.1 — module isolé, lecture seule, non importé ailleurs pour l'instant (shadow).

// Charge les prix comparables du Core, limité aux produits présents dans la liste.
// Protection obligatoire : jamais de requête si produitIds est vide (pas de select('*') global).
export async function chargerPrixComparables(produitIds, { staleCutoffISO } = {}) {
  const ids = Array.isArray(produitIds) ? produitIds.filter(id => id != null) : [];
  if (ids.length === 0) return [];

  let query = supabase
    .from('prix_comparables')
    .select('*')
    .in('produit_id', ids);

  if (staleCutoffISO) {
    query = query.gte('observe_le', staleCutoffISO);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Un format n'est démontrable que si la variante est résolue avec une
// quantité nette et une unité — jamais déduit du produit_id seul.
function formatDemontrable(item) {
  const variante = item?.variante;
  return !!item?.variante_produit_id
    && !!variante
    && variante.quantite_nette != null
    && !!variante.unite_quantite;
}

// Classe les articles de la liste de courses en cibles de comparaison Core
// exploitables, et en exclusions explicites (jamais un mélange silencieux de formats).
export function construireCiblesComparaison(items) {
  const cibles = [];
  const legacyOnly = [];
  const produitIdSansFormat = [];

  for (const item of items || []) {
    if (!item?.produit_id) {
      legacyOnly.push(item);
      continue;
    }

    if (!formatDemontrable(item)) {
      produitIdSansFormat.push(item);
      continue;
    }

    const { variante } = item;
    cibles.push({
      itemId: item.id,
      produit_id: item.produit_id,
      variante_produit_id: item.variante_produit_id,
      quantite_nette: variante.quantite_nette,
      unite_quantite: variante.unite_quantite,
      nombre_unites: variante.nombre_unites ?? 1,
      item,
    });
  }

  return { cibles, exclusions: { legacyOnly, produitIdSansFormat } };
}

// Haversine — copie locale et pure (App.jsx n'exporte rien, on ne l'importe pas).
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Un prix Core n'est éligible à la comparaison que si son propre format est
// démontrable — jamais de repli sur le produit_id seul côté prix non plus.
function formatDemontrablePrix(prix) {
  return prix?.variante_produit_id != null
    && prix?.quantite_nette != null
    && !!prix?.unite_quantite;
}

function normUnite(unite) {
  return String(unite || '').trim().toLowerCase();
}

function quantiteTotale(quantiteNette, nombreUnites) {
  return quantiteNette * (Number(nombreUnites) || 1);
}

// Chantier 230 — conversions EXACTES seulement, à l'intérieur d'une même
// famille (poids : g/kg ; volume : ml/cl/l). « 500 g » et « 0,5 kg » sont le
// même format ; « 500 g » et « 1 kg » restent différents. Aucune autre unité
// n'est convertie (pièce, lot…) : l'unité littérale doit alors être la même.
const FACTEURS_UNITE = {
  g: ['poids', 1], kg: ['poids', 1000],
  ml: ['volume', 1], cl: ['volume', 10], l: ['volume', 1000],
};

function enBase(quantiteNette, unite, nombreUnites) {
  const u = normUnite(unite);
  const total = quantiteTotale(Number(quantiteNette), nombreUnites);
  const f = FACTEURS_UNITE[u];
  return f ? { famille: f[0], valeur: total * f[1] } : { famille: `brut:${u}`, valeur: total };
}

// Deux formats sont identiques si, ramenés à la même unité de leur famille
// (g ou ml), ils ont exactement la même quantité totale.
function memeFormat(cible, prix) {
  const a = enBase(cible.quantite_nette, cible.unite_quantite, cible.nombre_unites);
  const b = enBase(prix.quantite_nette, prix.unite_quantite, prix.nombre_unites);
  if (a.famille !== b.famille) return false;
  return Math.abs(a.valeur - b.valeur) < 1e-6;
}

// Fait correspondre chaque cible aux prix Core du même produit_id et du même
// format démontrable. Ne retient jamais un prix dont le format n'est pas
// démontrable, même si le produit_id correspond.
export function faireCorrespondrePrix(cibles, prixComparables, { userPos, searchRadius, staleCutoffISO } = {}) {
  const prix = Array.isArray(prixComparables) ? prixComparables : [];

  return (cibles || []).map(cible => {
    const correspondances = prix.filter(p => {
      if (p.produit_id !== cible.produit_id) return false;
      if (!formatDemontrablePrix(p)) return false;
      if (!memeFormat(cible, p)) return false;

      if (staleCutoffISO && p.observe_le && new Date(p.observe_le) < new Date(staleCutoffISO)) {
        return false;
      }

      if (userPos && searchRadius != null && p.latitude != null && p.longitude != null) {
        const distance = distanceKm(userPos.lat, userPos.lng, p.latitude, p.longitude);
        if (distance > searchRadius) return false;
      }

      return true;
    });

    return { ...cible, correspondances };
  });
}

// Regroupe les correspondances par magasin_id réel (jamais par enseigne).
// Pour un même (produit_id + format + magasin_id), ne garde que
// l'observation avec observe_le le plus récent.
export function regrouperParMagasin(correspondances) {
  const parMagasin = {};

  for (const cible of correspondances || []) {
    const formatKey = `${cible.produit_id}::${normUnite(cible.unite_quantite)}::${quantiteTotale(cible.quantite_nette, cible.nombre_unites)}`;

    for (const prix of cible.correspondances || []) {
      if (prix.magasin_id == null) continue;

      if (!parMagasin[prix.magasin_id]) parMagasin[prix.magasin_id] = {};
      const parFormat = parMagasin[prix.magasin_id];

      const existant = parFormat[formatKey];
      if (!existant || new Date(prix.observe_le) > new Date(existant.prix.observe_le)) {
        parFormat[formatKey] = { itemId: cible.itemId, produit_id: cible.produit_id, prix };
      }
    }
  }

  const resultat = {};
  for (const [magasinId, parFormat] of Object.entries(parMagasin)) {
    resultat[magasinId] = Object.values(parFormat);
  }
  return resultat;
}

// Additionne, par magasin_id réel, les prix des articles trouvés (pondérés
// par la quantité demandée item.qty, comme le legacy : total += price * item.qty),
// et liste les cibles éligibles sans prix dans ce magasin.
export function calculerTotauxMagasins(regroupement, cibles) {
  const ciblesEligibles = cibles || [];
  const resultat = {};

  for (const [magasinId, lignes] of Object.entries(regroupement || {})) {
    const parItemId = new Map((lignes || []).map(l => [l.itemId, l]));
    const articlesTrouves = [];
    const articlesManquants = [];
    let total = 0;

    for (const cible of ciblesEligibles) {
      const ligne = parItemId.get(cible.itemId);
      if (ligne) {
        const qty = Number(cible.item?.qty) || 1;
        total += ligne.prix.prix_total * qty;
        articlesTrouves.push({ itemId: cible.itemId, produit_id: cible.produit_id, prix: ligne.prix });
      } else {
        articlesManquants.push(cible);
      }
    }

    resultat[magasinId] = { total, found: articlesTrouves.length, articlesTrouves, articlesManquants };
  }

  return resultat;
}

// Classe les magasins avec exactement la règle du comparateur legacy
// (App.jsx, CompareTab > const ranked = ...) : found décroissant, puis
// total croissant. Le tri natif étant stable (spec ES2019+), une égalité
// parfaite (found, total) conserve l'ordre d'entrée — déterministe.
export function classerMagasins(totauxParMagasin) {
  return Object.entries(totauxParMagasin || {})
    .map(([magasinId, totaux]) => ({ magasinId, ...totaux }))
    .filter(m => m.found > 0)
    .sort((a, b) => (b.found !== a.found ? b.found - a.found : a.total - b.total));
}
