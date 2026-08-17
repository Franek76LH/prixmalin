// Chantier 103b/103c « Repli progressif de la recherche catalogue » — SHADOW.
//
// Pourquoi ce fichier : la RPC rechercher_produits_pour_correction exige que
// TOUS les mots du terme soient présents dans produits.nom_reference. Or les
// nom_reference du catalogue sont courts et génériques (« Épeautre ») et ne
// contiennent JAMAIS la marque (elle vit dans marques, via
// variantes_produit.marque_id). Un nom commercial complet venu d'Open Food
// Facts (« Boulgour Petit Épeautre ») ne peut donc pas matcher : plus la
// requête est longue, moins elle a de chances d'aboutir.
//
// D'où le repli progressif : à défaut de résultat sur la phrase entière, on
// cherche mot par mot et on fusionne. Logique pure et sans dépendance (ni
// React, ni Supabase) pour être testable directement.

// Chantier 103b — termes de recherche catalogue issus d'OpenFoodFacts : le nom
// produit SEUL, jamais la marque.
//
// Le 103 injectait la marque, ce qui garantissait 0 résultat pour la raison
// ci-dessus (un nom_reference ne contient jamais la marque). Mesuré sur le cas
// réel : « Boulgour Petit Épeautre Priméal » -> 0, « Priméal » -> 0. La marque
// n'est pas perdue : elle reste affichée sur la carte OFF et dans l'en-tête de
// la feuille de recherche.
export function termesRechercheOff(off) {
  return (off?.nom || '').trim().slice(0, 70).trim();
}

// ————— Les deux plafonds, en clair —————
const PLAFOND_FICHES = 20;   // total affiché, toutes recherches confondues
const PLAFOND_PAR_MOT = 4;   // fiches qu'UN SEUL mot peut apporter à la liste

// Chantier 103c — seuil abaissé de 4 à 3 lettres. À 4, « riz », « sel », « eau »,
// « jus », « thé » étaient purement ignorés : soit les mots les plus utiles d'un
// catalogue de courses. Mesuré sur les 902 produits actifs, la longueur d'un mot
// ne dit RIEN de son utilité (miel, 4 lettres -> 1 fiche ; chocolat, 8 -> 20).
const LONGUEUR_MOT_MINI = 3;
const MOTS_MAXI = 6; // borne le nombre d'appels réseau sur un nom à rallonge

const sansAccent = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Mots candidats au repli, dans l'ordre du nom OFF (doublons et mots de moins
// de 3 lettres écartés). Le classement par pertinence n'a PAS lieu ici : il
// suppose de savoir combien de fiches chaque mot ramène, donc il se fait APRÈS
// les recherches, dans fusionnerResultatsParMot.
export function motsPourRepli(terme) {
  const vus = new Set();
  const mots = [];
  for (const brut of String(terme || '').split(/[^\p{L}\p{N}]+/u)) {
    const mot = brut.trim();
    if (mot.length < LONGUEUR_MOT_MINI) continue;
    const cle = sansAccent(mot);
    if (vus.has(cle)) continue;
    vus.add(cle);
    mots.push(mot);
    if (mots.length >= MOTS_MAXI) break;
  }
  return mots;
}

// Fusionne les résultats des recherches par mot.
//
// Chantier 103c — le classement se fait au NOMBRE DE FICHES RAMENÉES, croissant :
// peu de fiches = mot discriminant. C'est le seul signal fiable (« épeautre »
// -> 1 fiche, « petit » -> 17), là où la longueur n'en est pas un.
// À égalité, l'ordre d'apparition dans le nom OFF départage.
//
// Les mots bruyants ne sont PAS écartés : ils finissent en queue de liste,
// limités à 4 fiches chacun. C'est un fail-safe assumé — sur un nom dont tous
// les mots sont bruyants (« Chocolat au lait bio »), mieux vaut des propositions
// imparfaites qu'une liste vide.
//
// Dédoublonnage par produit_id en gardant la PREMIÈRE occurrence, donc celle du
// mot le plus discriminant. Renvoie aussi les mots réellement utiles — ceux qui
// ont apporté au moins une fiche affichée, dans ce même ordre — pour que le
// bandeau d'explication corresponde à l'ordre réel de la liste.
export function fusionnerResultatsParMot(mots, lots, plafond = PLAFOND_FICHES) {
  const parPertinence = mots
    .map((mot, rang) => ({ mot, rang, lot: Array.isArray(lots[rang]) ? lots[rang] : [] }))
    .sort((a, b) => (a.lot.length - b.lot.length) || (a.rang - b.rang));

  const vus = new Set();
  const fiches = [];
  const motsUtilises = [];
  for (const { mot, lot } of parPertinence) {
    let apportees = 0;
    for (const fiche of lot) {
      if (apportees >= PLAFOND_PAR_MOT || fiches.length >= plafond) break;
      const id = fiche?.produit_id;
      if (!id || vus.has(id)) continue;
      vus.add(id);
      fiches.push(fiche);
      apportees++;
    }
    if (apportees > 0) motsUtilises.push(mot);
  }
  return { fiches, motsUtilises };
}
