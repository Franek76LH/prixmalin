import { supabase } from './supabase';
import { resoudreFamilleEtCoefficient, familleDepuisTypeUnite, calculerPrixReference } from './unitesCore';

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

// Deux formats sont identiques seulement si la même unité littérale est
// utilisée des deux côtés : aucune conversion g/kg ou ml/L n'est tentée,
// pour ne jamais déduire silencieusement une équivalence non démontrée.
function memeFormat(cible, prix) {
  if (normUnite(cible.unite_quantite) !== normUnite(prix.unite_quantite)) return false;
  const totalCible = quantiteTotale(cible.quantite_nette, cible.nombre_unites);
  const totalPrix = quantiteTotale(prix.quantite_nette, prix.nombre_unites);
  return Math.abs(totalCible - totalPrix) < 1e-9;
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

function trouverCorrespondances(itemId, resultatsFaireCorrespondrePrix) {
  return (resultatsFaireCorrespondrePrix || []).find(r => r.itemId === itemId)?.correspondances || [];
}

// Le nom n'est jamais déduit du seul id : il est lu dans le prix Core déjà
// résolu par le pipeline (prix_comparables porte nom_magasin/nom_enseigne),
// avec un repli optionnel sur un dictionnaire de référence fourni par l'appelant.
function resoudreNomMagasin(entreeClassement, magasinsRef) {
  return entreeClassement?.nomMagasin
    ?? entreeClassement?.articlesTrouves?.[0]?.prix?.nom_magasin
    ?? magasinsRef?.[entreeClassement?.magasinId]?.nom
    ?? null;
}

function resoudreNomEnseigne(entreeClassement, magasinsRef) {
  return entreeClassement?.nomEnseigne
    ?? entreeClassement?.articlesTrouves?.[0]?.prix?.nom_enseigne
    ?? magasinsRef?.[entreeClassement?.magasinId]?.enseigne
    ?? null;
}

function normEnseigne(nom) {
  return String(nom || '').trim().toLowerCase();
}

/**
 * Compare le meilleur résultat du moteur legacy (regroupé par enseigne) et du
 * moteur Core (regroupé par magasin réel), et produit un rapport d'écarts
 * réservé au développement. Fonction pure, diagnostic uniquement — n'affecte
 * jamais l'affichage, le classement ou les économies visibles.
 *
 * N'effectue AUCUNE requête Supabase et ne refait AUCUNE logique de matching :
 * elle agrège uniquement ce que le pipeline #56.1 a déjà produit.
 *
 * @param {{ best: { id, name, total, found } | null }} legacy
 *   Reprend la forme de `best` dans CompareTab (id/name = enseigne).
 * @param {{
 *   correspondancesBrutes: ReturnType<typeof faireCorrespondrePrix>,
 *   correspondancesFraiches: ReturnType<typeof faireCorrespondrePrix>,
 *   classement: ReturnType<typeof classerMagasins>,
 * }} core
 *   `correspondancesBrutes` = faireCorrespondrePrix SANS staleCutoffISO (pour
 *   distinguer « donnée absente » de « trop ancienne ») ; `correspondancesFraiches`
 *   = faireCorrespondrePrix AVEC le cutoff réellement utilisé ; `classement` =
 *   sortie brute de classerMagasins (les noms sont résolus depuis les prix
 *   imbriqués dans articlesTrouves, ou depuis meta.magasinsRef si absents).
 * @param {{ legacyOnly: array, produitIdSansFormat: array }} exclusions
 *   Sortie de construireCiblesComparaison().exclusions.
 * @param {{ totalItems: number, magasinsRef?: Record<string, {nom, enseigne}> }} meta
 */
export function comparerResultatsLegacyEtCore(legacy, core, exclusions, meta) {
  const correspondancesBrutes = core?.correspondancesBrutes || [];
  const correspondancesFraiches = core?.correspondancesFraiches || [];
  const classement = core?.classement || [];
  const legacyOnly = exclusions?.legacyOnly || [];
  const produitIdSansFormat = exclusions?.produitIdSansFormat || [];
  const magasinsRef = meta?.magasinsRef;

  const meilleurLegacyEntree = legacy?.best ?? null;
  const meilleurCoreEntree = classement[0] ?? null;

  let nbArticlesTrouves = 0;
  let nbDonneeCoreAbsente = 0;
  let nbPrixTropAncien = 0;

  for (const cible of correspondancesFraiches) {
    const nbBrutes = trouverCorrespondances(cible.itemId, correspondancesBrutes).length;
    const nbFraiches = (cible.correspondances || []).length;

    if (nbBrutes === 0) nbDonneeCoreAbsente += 1;
    else if (nbFraiches === 0) nbPrixTropAncien += 1;
    else nbArticlesTrouves += 1;
  }

  const nbArticlesEligiblesCore = correspondancesFraiches.length;
  const nbArticlesManquants = nbArticlesEligiblesCore - nbArticlesTrouves;

  const totalLegacy = meilleurLegacyEntree ? meilleurLegacyEntree.total : null;
  const totalCore = meilleurCoreEntree ? meilleurCoreEntree.total : null;
  const differenceTotale = (totalLegacy != null && totalCore != null) ? totalCore - totalLegacy : null;

  // Si le meilleur magasin Core appartient à la même enseigne que le meilleur
  // legacy, l'écart vient probablement du regroupement (legacy = toute
  // l'enseigne, Core = un magasin réel), pas nécessairement d'un vrai écart
  // de prix. Sinon, l'écart est attribué à un écart de prix réel.
  const enseigneCore = meilleurCoreEntree ? resoudreNomEnseigne(meilleurCoreEntree, magasinsRef) : null;
  const memeEnseigne = !!meilleurLegacyEntree && !!enseigneCore
    && normEnseigne(meilleurLegacyEntree.name) === normEnseigne(enseigneCore);

  const differenceRegroupementEnseigneMagasin = memeEnseigne && differenceTotale !== 0;
  const ecartPrixReel = (differenceTotale != null && !memeEnseigne) ? differenceTotale : null;

  return {
    nbArticlesTotal: meta?.totalItems ?? 0,
    nbArticlesEligiblesCore,
    nbArticlesTrouves,
    nbArticlesManquants,
    nbExclusSansProduitId: legacyOnly.length,
    nbExclusSansFormat: produitIdSansFormat.length,
    nbMagasinsCandidatsCore: classement.length,
    meilleurLegacy: meilleurLegacyEntree
      ? { enseigne: meilleurLegacyEntree.name, total: meilleurLegacyEntree.total }
      : null,
    meilleurCore: meilleurCoreEntree
      ? { id: meilleurCoreEntree.magasinId, nom: resoudreNomMagasin(meilleurCoreEntree, magasinsRef), total: meilleurCoreEntree.total }
      : null,
    totalLegacy,
    totalCore,
    differenceTotale,
    raisons: {
      articleNonEligible: legacyOnly.length,
      formatImpossibleAVerifier: produitIdSansFormat.length,
      donneeCoreAbsente: nbDonneeCoreAbsente,
      prixTropAncien: nbPrixTropAncien,
      differenceRegroupementEnseigneMagasin,
      ecartPrixReel,
    },
  };
}

// #58.1.A — comparaison format-indifférent (prix unitaire kg/L/pièce), mode
// shadow. Contrairement à faireCorrespondrePrix (formats strictement
// identiques, aucune conversion), cette fonction retient aussi les prix Core
// exprimés dans une unité différente mais de la même famille physique
// (ex. cible 500 g vs prix observé 1 kg). Ne modifie rien à
// faireCorrespondrePrix ni aux fonctions existantes.
//
// Critères d'éligibilité stricts, exclusion silencieuse dès qu'un critère
// échoue :
//   - même produit_id (jamais élargi) ;
//   - format démontrable des deux côtés (réutilise formatDemontrable et
//     formatDemontrablePrix, sans dupliquer leur logique) ;
//   - unité reconnue par la table de coefficients (unitesCore) des deux
//     côtés — une unité inconnue exclut, jamais un coefficient par défaut ;
//   - même famille physique (poids/volume/pièce jamais mélangées entre
//     elles) et famille cohérente avec le type_unite du produit (lu depuis
//     la ligne de prix Core, qui porte déjà type_unite via la vue
//     prix_comparables — même produit_id des deux côtés, donc même produit).
//
// N'appelle jamais calculerPrixReference et n'attache aucune valeur €/kg,
// €/L ou €/pièce aux correspondances : cette brique construit uniquement
// l'ensemble des prix éligibles. Le calcul du prix de référence, son
// enrichissement sur les correspondances, leur classement et leur affichage
// sont laissés à #58.1.B.
//
// Ne filtre ni sur la fraîcheur (observe_le) ni sur le rayon de recherche :
// cette brique se limite à l'éligibilité par format, comme faireCorrespondrePrix
// laisse déjà ces filtres à la charge de l'appelant.
export function faireCorrespondrePrixFormatIndifferent(cibles, prixComparables) {
  const prix = Array.isArray(prixComparables) ? prixComparables : [];

  return (cibles || []).map(cible => {
    if (!formatDemontrable(cible.item)) {
      return { ...cible, correspondances: [] };
    }

    const resolutionCible = resoudreFamilleEtCoefficient(cible.unite_quantite);
    if (resolutionCible.exclusion) {
      return { ...cible, correspondances: [] };
    }

    const correspondances = prix.filter(p => {
      if (p.produit_id !== cible.produit_id) return false;
      if (!formatDemontrablePrix(p)) return false;

      const resolutionPrix = resoudreFamilleEtCoefficient(p.unite_quantite);
      if (resolutionPrix.exclusion) return false;
      if (resolutionPrix.famille !== resolutionCible.famille) return false;

      if (familleDepuisTypeUnite(p.type_unite) !== resolutionCible.famille) return false;

      return true;
    });

    return { ...cible, correspondances };
  });
}

// #58.1.B — enrichissement et classement par prix unitaire (€/kg, €/L, €/pièce),
// mode shadow. Branche calculerPrixReference (unitesCore) sur les
// correspondances déjà jugées éligibles par faireCorrespondrePrixFormatIndifferent
// (#58.1.A) — ne refait aucune logique d'éligibilité, ne modifie rien à cette
// fonction ni aux autres fonctions existantes.
//
// Pour chaque correspondance :
//   - calculerPrixReference est appelée avec les champs bruts du prix Core
//     (prix_total, quantite_nette, unite_quantite, nombre_unites, type_unite) ;
//   - en cas de succès, le prix Core est conservé avec deux champs ajoutés :
//     prix_reference (nombre) et unite_reference ('kg' | 'L' | 'piece') ;
//   - en cas d'exclusion (unité inconnue, type_unite 'lot', incohérence
//     poids/volume/pièce, quantité invalide...), la correspondance est
//     RETIRÉE — jamais de prix_reference par défaut — et tracée dans
//     `exclusions` (motif conservé pour le diagnostic).
//
// Les correspondances retenues sont triées par prix_reference croissant
// (le moins cher en tête). Le tri natif est stable (spec ES2019+).
export function enrichirEtClasserPrixUnitaire(correspondancesFormatIndifferent) {
  return (correspondancesFormatIndifferent || []).map(cible => {
    const correspondancesEnrichies = [];
    const exclusions = [];

    for (const prix of cible.correspondances || []) {
      const reference = calculerPrixReference({
        prix_total: prix.prix_total,
        quantite_nette: prix.quantite_nette,
        unite_quantite: prix.unite_quantite,
        nombre_unites: prix.nombre_unites,
        type_unite: prix.type_unite,
      });

      if (reference.exclusion) {
        exclusions.push({ prix, motif: reference.exclusion });
        continue;
      }

      correspondancesEnrichies.push({ ...prix, prix_reference: reference.prix_reference, unite_reference: reference.unite });
    }

    correspondancesEnrichies.sort((a, b) => a.prix_reference - b.prix_reference);

    return { ...cible, correspondancesEnrichies, exclusions, nbExclusions: exclusions.length };
  });
}
