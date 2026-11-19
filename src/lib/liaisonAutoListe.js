// Chantier 122 — liaison automatique d'un produit dicté (ou tapé) au catalogue.
//
// Constat du 09/11 : 6 produits dictés, « 0 relié · 6 à relier ». Il fallait
// ouvrir « Relier au catalogue » six fois. Et tant qu'un produit n'est pas
// relié, le comparateur ne lui trouve aucun prix — d'où une comparaison fausse.
//
// Ce module décide, pour un nom entendu, entre trois issues :
//   - RELIE      : une fiche porte exactement ce nom -> reliée sans rien demander ;
//   - SUGGESTIONS: des fiches ressemblent -> jusqu'à 3 propositions, un seul appui ;
//   - A_RELIER   : rien de sérieux -> on laisse la main (recherche manuelle).
// Jamais de liaison automatique sur une simple ressemblance : un produit relié
// à tort fausserait les prix sans que personne ne le voie.
//
// La recherche en base (rechercher_produits_catalogue) exige que TOUS les mots
// soient présents et trie par ordre alphabétique : « des pâtes » ou
// « Coca-Cola » n'y trouvent rien d'utile. On nettoie donc le terme avant, on
// élargit mot par mot si besoin, et on reclasse ici par ressemblance.

import { nbAchats } from './habitudesAchat';

export const LIAISON_RELIE = 'relie';
export const LIAISON_SUGGESTIONS = 'suggestions';
export const LIAISON_A_RELIER = 'a_relier';

export const SEUIL_SUGGESTION = 0.5;
// Chantier 130 — une fiche que la recherche en base a trouvée avec TOUS les
// mots dits (dans son nom, sa famille, sa marque ou ses libellés de caisse)
// mérite d'être proposée même si son nom ne ressemble pas : « fromage râpé »
// -> « Emmental râpé ». Assez pour proposer, jamais pour relier seul.
export const NOTE_TROUVE_PAR_TOUS_LES_MOTS = 0.55;
export const MAX_SUGGESTIONS = 3;
// Chantier 157 — « tes achats en premier ». Une fiche que l'utilisateur a déjà
// achetée (ses tickets le disent) gagne un petit bonus ; et quand aucun nom ne
// ressemble, les fiches achetées trouvées avec le terme complet sont proposées.
// Jamais assez pour relier seul : le bonus s'arrête sous SEUIL_MEME_NOM.
export const BONUS_DEJA_ACHETE = 0.1;
export const NOTE_ACHETE_ET_TROUVE = 0.6;
export const PLAFOND_SANS_NOM_EXACT = 0.89;

// Mots qui ne désignent aucun produit (« du lait », « des pâtes », « l'huile »).
const MOTS_VIDES = new Set(['du', 'de', 'des', 'la', 'le', 'les', 'l', 'd', 'un', 'une', 'au', 'aux', 'et', 'a']);

function minuscules(texte) {
  return String(texte ?? '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}

function sansAccents(texte) {
  return minuscules(texte).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Singulier approximatif : « yaourts » -> « yaourt », « choux » -> « chou ».
// Les mots très courts (« riz », « jus ») restent tels quels.
function racine(mot) {
  if (mot.length >= 4 && (mot.endsWith('s') || mot.endsWith('x'))) return mot.slice(0, -1);
  return mot;
}

// Découpe un nom en mots, accents CONSERVÉS, mots vides retirés.
function motsBruts(texte) {
  return minuscules(texte)
    .replace(/[^a-z0-9à-ÿ]+/g, ' ')
    .split(' ')
    .filter(m => m.length > 0 && !MOTS_VIDES.has(sansAccents(m)));
}

// Mots utiles d'un nom, sans accents, sans mots vides, au singulier : la forme
// la plus large, celle qu'on envoie à la recherche en base.
export function motsUtiles(texte) {
  return motsBruts(texte).map(m => racine(sansAccents(m)));
}

// Terme envoyé à la recherche en base : mots utiles séparés par une espace.
export function termeDeRecherche(texte) {
  return motsUtiles(texte).join(' ');
}

// À quel point deux mots sont « le même mot », de 0 à 1.
//   1    : identiques ;
//   0,95 : seul le pluriel change (« yaourts » / « yaourt ») ;
//   0,9  : seul un accent change (« pate » tapé sans accent / « pâte ») ;
//   0,75 : pluriel ET accent changent — « pâtes » et « pâté » se retrouvent
//          ici : assez proche pour proposer, jamais assez pour relier seul.
function proximiteMots(a, b) {
  if (a === b) return 1;
  if (racine(a) === racine(b)) return 0.95;
  const a2 = sansAccents(a), b2 = sansAccents(b);
  if (a2 === b2) return 0.9;
  if (racine(a2) === racine(b2)) return 0.75;
  // Une lettre d'écart sur un mot assez long (« knacky » / « knacki », faute de
  // frappe ou de transcription) : assez proche pour proposer, jamais pour relier.
  const ra = racine(a2), rb = racine(b2);
  if (Math.min(ra.length, rb.length) >= 5 && uneLettreDEcart(ra, rb)) return 0.7;
  return 0;
}

// Vrai si les deux mots diffèrent d'UNE lettre : remplacée, ajoutée ou retirée.
function uneLettreDEcart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [court, long] = a.length < b.length ? [a, b] : [b, a];
  return court.slice(i) === long.slice(i + 1);
}

// Seuil au-dessus duquel deux noms faits des mêmes mots sont « le même nom ».
export const SEUIL_MEME_NOM = 0.9;

// Ressemblance entre le nom entendu et le nom d'une fiche, de 0 à 1.
//   >= 0,9 : mêmes mots (ordre indifférent, pluriel ou accent près) -> même produit ;
//   ~0,7+  : tous les mots entendus sont dans la fiche (« yaourt » / « Yaourt nature ») ;
//   ~0,6   : la fiche est contenue dans ce qui a été dit (« coca cola » / « Cola ») ;
//   < 0,5  : simple mot en commun.
export function ressemblance(entendu, nomFiche) {
  const t = [...new Set(motsBruts(entendu))];
  const c = [...new Set(motsBruts(nomFiche))];
  if (t.length === 0 || c.length === 0) return 0;

  // Pour chaque mot entendu, le mot de la fiche qui lui ressemble le plus.
  const poidsT = t.map(mt => Math.max(...c.map(mc => proximiteMots(mt, mc))));
  const poidsC = c.map(mc => Math.max(...t.map(mt => proximiteMots(mt, mc))));
  const communs = poidsT.filter(p => p > 0).length;
  if (communs === 0) return 0;
  const plusFaible = Math.min(...poidsT.filter(p => p > 0));
  const toutEntenduTrouve = communs === t.length;
  const touteFicheTrouvee = poidsC.every(p => p > 0);

  if (toutEntenduTrouve && touteFicheTrouvee) return plusFaible;
  if (toutEntenduTrouve) {
    // La fiche précise ce qui a été dit. Plus elle ajoute de mots, moins c'est sûr.
    const debut = proximiteMots(t[0], c[0]) > 0 ? 0.1 : 0;
    return Math.min(0.89, (0.6 + 0.3 * (t.length / c.length) + debut) * plusFaible);
  }
  if (touteFicheTrouvee) return 0.6 * plusFaible; // fiche plus générale que ce qui a été dit
  return 0.5 * (communs / t.length) * plusFaible;
}

// Classe les fiches candidates et rend la décision.
//   candidats : [{ produit_id, nom_reference, dernier_prix }]
//   options.achats : { [produit_id]: nombre d'achats } — les habitudes de
//   l'utilisateur (lib/habitudesAchat). Absent : comportement d'avant.
export function deciderLiaison(entendu, candidats, options = {}) {
  const achats = options?.achats || null;
  // Une même fiche peut revenir de plusieurs recherches : on garde ce que
  // chacune a établi (trouvée avec tous les mots, trouvée par le terme complet).
  const parFiche = new Map();
  for (const c of candidats || []) {
    if (!c?.produit_id) continue;
    const deja = parFiche.get(c.produit_id);
    if (!deja) parFiche.set(c.produit_id, { ...c });
    else {
      deja.tousLesMotsTrouves = deja.tousLesMotsTrouves || c.tousLesMotsTrouves;
      deja.termeComplet = deja.termeComplet || c.termeComplet;
    }
  }
  const notes = [];
  for (const c of parFiche.values()) {
    let score = ressemblance(entendu, c.nom_reference);
    if (c.tousLesMotsTrouves) score = Math.max(score, NOTE_TROUVE_PAR_TOUS_LES_MOTS);
    const achete = nbAchats(achats, c.produit_id);
    if (achete > 0 && score > 0 && score < SEUIL_MEME_NOM) score = Math.min(PLAFOND_SANS_NOM_EXACT, score + BONUS_DEJA_ACHETE);
    notes.push({ produit_id: c.produit_id, produit_nom: c.nom_reference, score, aUnPrix: c.dernier_prix != null, nbAchats: achete, dejaAchete: achete > 0, termeComplet: !!c.termeComplet });
  }
  // Repli : aucun nom ne ressemble à ce qui a été dit (« coca » -> « Cola
  // zéro », trouvée par la marque). Les fiches DÉJÀ ACHETÉES que la recherche a
  // trouvées avec le terme entier sont alors proposées. Seulement dans ce cas :
  // dès qu'un nom ressemble, la recherche ramène trop de voisins lointains
  // (« jambon » trouve aussi des chips goût jambon).
  if (!notes.some(n => n.score >= SEUIL_SUGGESTION)) {
    for (const n of notes) if (n.dejaAchete && n.termeComplet) n.score = Math.max(n.score, NOTE_ACHETE_ET_TROUVE);
  }
  for (let i = notes.length - 1; i >= 0; i--) {
    if (notes[i].score <= 0) notes.splice(i, 1); else delete notes[i].termeComplet;
  }
  // À ressemblance égale : d'abord ce que l'utilisateur achète le plus, puis
  // une fiche qui a déjà des prix (c'est elle qui rendra la comparaison possible).
  notes.sort((a, b) => (b.score - a.score) || (b.nbAchats - a.nbAchats) || (Number(b.aUnPrix) - Number(a.aUnPrix)) || a.produit_nom.localeCompare(b.produit_nom, 'fr'));

  const exacts = notes.filter(n => n.score >= SEUIL_MEME_NOM);
  if (exacts.length === 1) {
    return { issue: LIAISON_RELIE, produit: exacts[0], suggestions: [] };
  }
  const suggestions = notes.filter(n => n.score >= SEUIL_SUGGESTION).slice(0, MAX_SUGGESTIONS);
  if (suggestions.length > 0) return { issue: LIAISON_SUGGESTIONS, produit: null, suggestions };
  return { issue: LIAISON_A_RELIER, produit: null, suggestions: [] };
}

// Cherche puis décide. `chercher(terme)` est la recherche en base (injectée
// pour les tests) : elle rend la liste des fiches, ou lève une exception.
// Trois recherches au plus par produit : le terme complet, puis ses deux mots
// les plus longs (« coca cola » ne donne rien ? on essaie « cola »).
// Ne lève jamais : en cas de panne, le produit reste simplement « à relier ».
export async function proposerLiaison(entendu, chercher, options = {}) {
  const mots = motsUtiles(entendu);
  if (mots.length === 0 || typeof chercher !== 'function') {
    return { issue: LIAISON_A_RELIER, produit: null, suggestions: [] };
  }
  // Chantier 157 — mémoire personnelle : l'utilisateur a déjà choisi une fiche
  // pour ces mots-là. C'est SA décision, on la reprend sans rien demander
  // (options.memoire : { [mots utiles]: { produit_id, produit_nom } }).
  const souvenir = options?.memoire?.[mots.join(' ')];
  if (souvenir?.produit_id && souvenir?.produit_nom) {
    return { issue: LIAISON_RELIE, produit: { produit_id: souvenir.produit_id, produit_nom: souvenir.produit_nom, score: 1, memorise: true }, suggestions: [] };
  }
  const candidats = [];
  const lancer = async (terme, tousLesMotsTrouves = false, termeComplet = false) => {
    if (terme.length < 2) return;
    try {
      const lignes = await chercher(terme);
      if (Array.isArray(lignes)) candidats.push(...lignes.map(l => ({ ...l, tousLesMotsTrouves, termeComplet })));
    } catch { /* panne réseau : on fait avec ce qu'on a */ }
  };

  // Deux mots ou plus : ce que la base trouve avec le terme complet contient
  // tous les mots dits. Un mot seul est trop vague (« riz » est dans « chorizo »).
  await lancer(mots.join(' '), mots.length >= 2, true);
  let decision = deciderLiaison(entendu, candidats, options);
  if (decision.issue === LIAISON_RELIE) return decision;
  if (mots.length === 1) {
    // Un seul mot et rien de sérieux : la recherche exige le mot exact, donc
    // une faute sur la dernière lettre (« knacky ») ne trouve rien. On réessaie
    // une fois sans cette lettre (« knack »), et la ressemblance tranche.
    if (decision.issue === LIAISON_A_RELIER && mots[0].length >= 5) {
      await lancer(mots[0].slice(0, -1));
      decision = deciderLiaison(entendu, candidats, options);
    }
    return decision;
  }

  const motsLongs = [...new Set(mots)].filter(m => m.length >= 3).sort((a, b) => b.length - a.length).slice(0, 2);
  for (const mot of motsLongs) await lancer(mot);
  decision = deciderLiaison(entendu, candidats, options);
  return decision;
}
