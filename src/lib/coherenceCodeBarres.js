// Chantier 105 « Garde-fou code-barres » — SHADOW.
//
// Pourquoi ce fichier : depuis le 103, quand un code-barres est inconnu de notre
// base, OpenFoodFacts dit à quoi il correspond et l'utilisateur choisit une
// fiche du catalogue. Rien ne vérifiait que la fiche choisie avait le moindre
// rapport avec le produit désigné par le code. Incident du 17/08 : le code
// 3380380055393 (OFF : « Boulgour Petit Épeautre », Priméal, 500 g) a été
// appris sur la fiche « Cônes glacés » / Trium / 432 g. Le code-barres faisant
// autorité par la suite, une seule erreur de ce genre empoisonne durablement le
// scan : le code sera « reconnu » et rattachera silencieusement des glaces à du
// boulgour.
//
// Ce module compare donc les deux identités AVANT toute écriture. Logique pure
// (ni React, ni Supabase, ni réseau) pour être testable directement.
//
// Deux principes qui gouvernent tout le fichier :
//   1. On avertit, on n'interdit pas. OFF se trompe parfois, tous les produits
//      n'y sont pas, et un emballage change de format sans changer d'EAN.
//   2. On ne fabrique JAMAIS un faux sentiment de sécurité. Quand on n'a rien
//      pu vérifier, on le dit ; on ne fait pas passer « pas vérifiable » pour
//      « vérifié ».
import { resoudreFamilleEtCoefficient } from './unitesCore';

// Écart relatif au-delà duquel deux quantités ne décrivent plus le même
// article. 20 % laisse passer les arrondis d'affichage OFF (« 1 kg » pour 1,02
// kg) et les poids égouttés, tout en attrapant les vrais changements de format
// (500 g vs 1 kg).
export const SEUIL_ECART_QUANTITE = 0.20;

// Même seuil qu'au 103c, et pour la même raison : à 4 lettres, « riz », « sel »,
// « eau », « thé » — les mots les plus utiles d'un catalogue de courses —
// étaient purement ignorés.
const LONGUEUR_MOT_MINI = 3;

const sansAccent = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Mots signifiants d'un texte libre : minuscules, sans accents, au moins 3
// caractères. Les chiffres sont conservés (« 500 » dans un libellé de variante
// est un signal comme un autre).
export function motsSignifiants(texte) {
  const mots = new Set();
  for (const brut of sansAccent(texte).split(/[^a-z0-9]+/)) {
    if (brut.length >= LONGUEUR_MOT_MINI) mots.add(brut);
  }
  return mots;
}

// Mots présents des DEUX côtés. Zéro mot commun = les deux textes ne parlent
// visiblement pas du même produit.
export function motsCommuns(texteA, texteB) {
  const a = motsSignifiants(texteA);
  const b = motsSignifiants(texteB);
  const communs = [];
  for (const mot of a) if (b.has(mot)) communs.push(mot);
  return communs;
}

// Quantité écrite en texte libre par OFF (« 500 g », « 1,5 L », « 6 x 60 g »)
// ramenée à l'unité canonique de sa famille (kg ou L).
//
// Retourne null dès que le texte n'est pas interprétable SANS AMBIGUÏTÉ : mieux
// vaut renoncer à comparer que déclencher un avertissement sur une lecture
// hasardeuse. La famille « pièce » est exclue volontairement — OFF ne remplit
// quasiment jamais un comptage exploitable, et une comparaison de pièces contre
// un poids ne veut rien dire.
export function analyserQuantiteTexte(texte) {
  const brut = sansAccent(texte).replace(/,/g, '.').trim();
  if (!brut) return null;

  // Lots « 6 x 60 g » : la quantité qui compte est le total (360 g), c'est elle
  // qu'on comparera à quantite_nette x nombre_unites côté fiche.
  //
  // Le « × » Unicode (U+00D7) est accepté au même titre que le « x » ASCII :
  // OFF utilise les deux, et ne reconnaître que l'ASCII faisait lire « 6 × 60 g »
  // comme 60 g — soit un faux écart de quantité, donc un faux avertissement.
  const lot = brut.match(/(\d+(?:\.\d+)?)\s*[x*×]\s*(\d+(?:\.\d+)?)\s*([a-z]+)/);
  const simple = brut.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/);

  let valeur = null;
  let uniteTexte = null;
  if (lot) {
    valeur = Number(lot[1]) * Number(lot[2]);
    uniteTexte = lot[3];
  } else if (simple) {
    valeur = Number(simple[1]);
    uniteTexte = simple[2];
  }
  if (!Number.isFinite(valeur) || valeur <= 0 || !uniteTexte) return null;

  const resolution = resoudreFamilleEtCoefficient(uniteTexte);
  if (resolution.exclusion) return null;
  if (resolution.famille === 'piece') return null;

  return {
    valeur,
    unite: uniteTexte,
    famille: resolution.famille,
    canonique: valeur * resolution.coefficient,
  };
}

// Quantité totale d'une variante du catalogue, ramenée à la même unité
// canonique. nombre_unites absent = 1 (cas de loin le plus fréquent).
export function analyserQuantiteFiche({ quantite_nette, unite_quantite, nombre_unites } = {}) {
  const q = Number(quantite_nette);
  if (!Number.isFinite(q) || q <= 0) return null;

  const nu = Number(nombre_unites);
  const unites = Number.isFinite(nu) && nu > 0 ? nu : 1;

  const resolution = resoudreFamilleEtCoefficient(unite_quantite);
  if (resolution.exclusion) return null;
  if (resolution.famille === 'piece') return null;

  const valeur = q * unites;
  return {
    valeur,
    unite: String(unite_quantite ?? '').trim(),
    famille: resolution.famille,
    canonique: valeur * resolution.coefficient,
  };
}

// Compare les deux quantités. « comparable: false » n'est JAMAIS un signal :
// c'est l'aveu qu'on ne sait pas, et l'appelant n'en tire aucune conclusion.
// Deux familles différentes (500 g contre 50 cl) sont traitées comme non
// comparables : ce désaccord vient plus souvent de notre propre modélisation
// que d'une erreur de code-barres.
export function comparerQuantites(quantiteOffTexte, fiche) {
  const off = analyserQuantiteTexte(quantiteOffTexte);
  const cat = analyserQuantiteFiche(fiche);
  if (!off || !cat) return { comparable: false, raison: 'quantite_illisible', off, fiche: cat };
  if (off.famille !== cat.famille) return { comparable: false, raison: 'familles_differentes', off, fiche: cat };

  const ecart = Math.abs(off.canonique - cat.canonique) / Math.max(off.canonique, cat.canonique);
  return {
    comparable: true,
    ecart,
    divergent: ecart > SEUIL_ECART_QUANTITE,
    off,
    fiche: cat,
  };
}

// Les trois niveaux de sortie, et ce que l'écran en fait :
//   'silencieux'    -> rien de nouveau à l'affichage. Le garde-fou ne se
//                      manifeste que quand il a quelque chose à dire.
//   'note'          -> note honnête non bloquante (« personne ne peut vérifier
//                      à ta place »). Aucun bouton, aucun blocage.
//   'avertissement' -> écran bloquant montrant les deux versions côte à côte.
export const NIVEAU_SILENCIEUX = 'silencieux';
export const NIVEAU_NOTE = 'note';
export const NIVEAU_AVERTISSEMENT = 'avertissement';

export const SIGNAL_AUCUN_MOT_COMMUN = 'aucun_mot_commun';
export const SIGNAL_QUANTITE_DIVERGENTE = 'quantite_divergente';

// Statuts renvoyés par ficheOFFAvecStatut (voir photosProduits.js).
export const OFF_TROUVE = 'trouve';
export const OFF_INCONNU = 'inconnu';
export const OFF_INDISPONIBLE = 'indisponible';

// LE point d'entrée. Décide si l'on doit avertir avant d'apprendre un
// code-barres sur une fiche produit.
//
// statutOff distingue trois situations que le 103 confondait en un seul `null` :
//   - OFF_INDISPONIBLE (réseau KO, trop lent) : on n'a rien demandé de plus au
//     parcours habituel, on ne montre RIEN. Un OFF en panne ne doit pas
//     ajouter un message d'erreur technique sur un écran qui fonctionne.
//   - OFF_INCONNU (OFF a répondu, il ne connaît pas ce code) : il n'y a rien à
//     comparer, donc aucun avertissement d'erreur — mais on le dit, parce que
//     laisser croire que le code a été vérifié serait un mensonge.
//   - OFF_TROUVE : on compare pour de bon.
export function verifierCoherenceCodeBarres({ statutOff, off = null, fiche = null } = {}) {
  const vide = { signaux: [], motsCommuns: [], quantite: null, off, fiche };

  if (statutOff === OFF_INDISPONIBLE) {
    return { ...vide, niveau: NIVEAU_SILENCIEUX, raison: 'off_indisponible' };
  }
  if (statutOff === OFF_INCONNU || !off) {
    return { ...vide, niveau: NIVEAU_NOTE, raison: 'off_ne_connait_pas_le_code' };
  }

  // Côté OFF : le nom commercial et la marque. Côté catalogue : le nom de
  // fiche, la marque et le libellé de variante — le libellé porte souvent le
  // parfum ou le format, qui est justement ce qui distingue deux articles.
  const texteOff = [off.nom, off.marque].filter(Boolean).join(' ');
  const texteFiche = [fiche?.nomProduit, fiche?.marque, fiche?.libelleVariante].filter(Boolean).join(' ');

  const communs = motsCommuns(texteOff, texteFiche);
  const quantite = comparerQuantites(off.quantite, fiche);

  const signaux = [];
  // Deux textes dont l'un est vide n'ont rien en commun mécaniquement : ce
  // n'est pas un désaccord, c'est une absence de données. Pas de signal.
  if (motsSignifiants(texteOff).size > 0 && motsSignifiants(texteFiche).size > 0 && communs.length === 0) {
    signaux.push(SIGNAL_AUCUN_MOT_COMMUN);
  }
  if (quantite.comparable && quantite.divergent) {
    signaux.push(SIGNAL_QUANTITE_DIVERGENTE);
  }

  return {
    niveau: signaux.length > 0 ? NIVEAU_AVERTISSEMENT : NIVEAU_SILENCIEUX,
    signaux,
    motsCommuns: communs,
    quantite,
    off,
    fiche,
  };
}

// numeric Postgres arrive en string via PostgREST (ex "1.000") — toujours
// repasser par Number() avant tout calcul, jamais supposer un type numérique.
export function versNombre(valeur, repli = null) {
  if (valeur == null) return repli;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : repli;
}

// Quantité de la fiche telle qu'elle a RÉELLEMENT été comparée ci-dessus. Sur
// un lot (nombre_unites > 1), afficher « 432 g » alors que le calcul a porté
// sur 2 592 g rendrait le pourcentage d'écart incompréhensible : on détaille
// donc l'opération. Vit ici, à côté du calcul qu'elle explique, pour que
// l'avertissement du 105 et l'écran admin du 106 disent exactement la même
// chose.
export function texteQuantiteFiche(fiche) {
  const quantiteNette = versNombre(fiche?.quantite_nette);
  const unites = versNombre(fiche?.nombre_unites);
  if (quantiteNette == null || !fiche?.unite_quantite) return null;
  return (unites != null && unites > 1)
    ? `${quantiteNette} ${fiche.unite_quantite} × ${unites} = ${quantiteNette * unites} ${fiche.unite_quantite}`
    : `${quantiteNette} ${fiche.unite_quantite}`;
}

// LA décision « apprendre quand même », isolée exprès dans une seule fonction.
//
// Aujourd'hui l'écran 🔍 À valider n'est monté que pour un administrateur, donc
// le bouton existe toujours dans les faits. Quand le scan sera ouvert à tous,
// il suffira que cette fonction renvoie false pour un non-administrateur : le
// bouton disparaît de l'écran sans qu'une seule ligne d'UI ne soit réécrite, et
// le désaccord partira dans la file de propositions au lieu d'écrire en base.
export function passerOutreAutorise({ estAdmin = false } = {}) {
  return estAdmin === true;
}
