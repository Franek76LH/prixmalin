// Chantier 106 « Module de contribution aux codes-barres », LOT A — logique
// pure du parcours utilisateur (ni React, ni Supabase, ni réseau), pour être
// testable directement.
//
// Ce que fait ce module, et pourquoi :
//   1. Traduire ce qu'OpenFoodFacts raconte en texte libre vers ce que la base
//      attend. La table stocke off_quantite en NUMERIC et off_unite à part,
//      alors qu'OFF écrit « 500 g », « 1,5 L » ou « 6 x 60 g » dans un seul
//      champ. Une quantité mal découpée partirait en base comme une vérité.
//   2. Dire honnêtement à l'utilisateur ce qui s'est passé. Trois réponses
//      possibles de proposer_code_barres, trois messages distincts — dont deux
//      qui ne sont PAS des erreurs et ne doivent pas en avoir l'air.
import { analyserQuantiteTexte } from './coherenceCodeBarres';

// Origine de ce lot : l'utilisateur a scanné un article chez lui ou dans le
// rayon, sans ticket ni session de courses derrière.
export const ORIGINE_SCAN_LIBRE = 'scan_libre';

// Points crédités à l'auteur quand François valide (c'est la base qui les
// écrit, valider_proposition_code_barres ; la constante ne sert qu'à ne pas
// annoncer un chiffre différent de celui qui sera réellement versé).
export const POINTS_PAR_PROPOSITION_VALIDEE = 10;

export const RETOUR_EN_ATTENTE = 'en_attente';
export const RETOUR_DEJA_CONNU = 'deja_connu';
export const RETOUR_DEJA_PROPOSE = 'deja_propose';

// « 500 g » -> { quantite: 500, unite: 'g' }. On réutilise l'analyseur du
// garde-fou 105 : c'est LUI qui décide ce qui est lisible sans ambiguïté, et
// avoir deux lectures différentes du même texte (une pour comparer, une pour
// stocker) est exactement le genre d'écart qui finit en donnée fausse.
//
// Illisible -> { quantite: null, unite: null }, et rien de plus : mieux vaut
// une quantité absente qu'une quantité inventée. Un lot (« 6 x 60 g ») rend le
// TOTAL (360 g), la même valeur que celle qui a servi à la comparaison.
export function decouperQuantiteOff(texteQuantite) {
  const lu = analyserQuantiteTexte(texteQuantite);
  if (!lu) return { quantite: null, unite: null };
  return { quantite: lu.valeur, unite: lu.unite };
}

// Charge utile `p_off` de proposer_code_barres : exactement les six clés que la
// fonction lit (nom, marque, quantite, unite, photo_url, statut).
//
// quantite est un NOMBRE ou null, jamais une chaîne : la fonction fait
// (p_off->>'quantite')::numeric, et un texte non numérique y ferait échouer
// toute la proposition.
//
// OFF absent (inconnu ou injoignable) est un cas NORMAL, pas une erreur : on
// renvoie une charge vide mais on garde `statut`, qui dit pourquoi elle l'est.
export function chargeOffProposition({ off = null, statutOff = null } = {}) {
  const { quantite, unite } = decouperQuantiteOff(off?.quantite);
  return {
    nom: off?.nom ?? null,
    marque: off?.marque ?? null,
    quantite,
    unite,
    photo_url: off?.imageLarge || off?.imageSmall || null,
    statut: statutOff ?? null,
  };
}

// Ce qu'on affiche après l'envoi. Deux des trois réponses ne sont pas des
// échecs : « déjà connu » et « déjà proposé » veulent dire que le travail est
// déjà fait, pas que l'utilisateur s'est trompé. Ton neutre, jamais rouge, et
// aucune promesse de points dans ces deux cas — il n'y en aura pas.
export function messageRetourProposition(reponse) {
  const statut = reponse?.statut ?? null;
  if (statut === RETOUR_EN_ATTENTE) {
    return {
      ton: 'succes',
      titre: 'Merci !',
      detail: `Ta proposition part en validation, tu gagneras ${POINTS_PAR_PROPOSITION_VALIDEE} points quand elle sera acceptée.`,
    };
  }
  if (statut === RETOUR_DEJA_CONNU) {
    return {
      ton: 'neutre',
      titre: 'Ce code est déjà dans la base',
      detail: 'Merci quand même.',
    };
  }
  if (statut === RETOUR_DEJA_PROPOSE) {
    return {
      ton: 'neutre',
      titre: "Quelqu'un l'a déjà proposé",
      detail: 'Il est en attente de validation.',
    };
  }
  // Réponse d'une forme imprévue : on ne fait pas passer un doute pour un
  // succès. On ne prétend pas non plus que rien n'a été écrit — on n'en sait
  // rien, justement.
  return {
    ton: 'erreur',
    titre: 'Réponse inattendue du serveur',
    detail: "Impossible de dire si ta proposition a été enregistrée. Vérifie plus tard, ou réessaie.",
  };
}

// Exceptions levées par proposer_code_barres, traduites en français d'écran.
// Le message technique brut est conservé en dernier recours plutôt qu'un
// « une erreur est survenue » qui n'aide personne à comprendre.
export function messageErreurProposition(error) {
  const brut = error?.message || '';
  if (/module de contribution fermé/i.test(brut)) {
    return "Le module de contribution est fermé pour l'instant.";
  }
  if (/connexion requise/i.test(brut)) {
    return 'Il faut être connecté pour proposer un code-barres.';
  }
  if (/code-barres invalide/i.test(brut)) {
    return "Ce code-barres n'a pas été lu correctement, rescanne-le.";
  }
  if (/not find the function|schema cache/i.test(brut)) {
    return 'Fonction proposer_code_barres introuvable côté API — le SQL doit être appliqué.';
  }
  return brut || 'Envoi impossible, réessaie.';
}
