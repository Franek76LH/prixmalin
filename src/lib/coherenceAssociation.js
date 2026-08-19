// Chantier 110 « Écran de correction d'association » — SHADOW.
//
// LE CAS RÉEL, établi en base le 19/08 dans historique_corrections_association :
// cinq corrections manuelles où le produit envoyé n'a aucun rapport avec la
// ligne corrigée.
//   16/08 10:39 — « Glace vanille » (ticket : CONES CREME BRULEE X6 426G MR)
//                 -> « Tendres perles à l'italienne »
//   16/08 10:48 — « Ketchup allégé en sucre et sel »
//                 -> « Tendres perles à l'italienne »
//   17/08 13:16 — « Boisson énergisante Red Bull winter edition »
//                 -> « Pulpe de tomates »
// Le MÊME produit part pour une glace puis pour un ketchup, à neuf minutes
// d'écart. La RPC corriger_association_ligne_ticket est saine : elle applique
// le produit qu'on lui passe à la ligne qu'on lui désigne. Le mauvais couple
// vient donc du client — la sélection n'était pas remise à zéro d'une ligne à
// l'autre.
//
// POURQUOI C'EST PLUS GRAVE QU'UNE ERREUR D'AFFICHAGE : une correction manuelle
// écrit methode='humaine', crée une correspondance dans
// correspondances_ticket_enseigne qui se réappliquera TOUTE SEULE aux tickets
// suivants, et propose un alias global. L'erreur s'auto-propage avec l'autorité
// d'une validation humaine. Cinq correspondances ont dû être neutralisées à la
// main le 19/08.
//
// Logique pure (ni React, ni Supabase, ni réseau) pour être testable seule.
import { motsCommuns, motsSignifiants } from './coherenceCodeBarres';

// ── 1. Remise à zéro de la sélection ────────────────────────────────────────
//
// LA liste, en un seul endroit. Chaque entrée est un état de CorrigerProduitSheet
// qui porte, de près ou de loin, « quel produit l'utilisateur a choisi » ou
// « qu'a-t-il cherché ». Tous repartent vides dès qu'on change de ligne.
//
// Pourquoi une fonction et pas une constante : `results` est un tableau et
// `selectionVide()` est appelée à chaque changement de ligne — une constante
// partagée ferait que deux lignes se passeraient la MÊME référence de tableau,
// exactement le genre de partage silencieux que ce chantier corrige.
//
// Pourquoi ici plutôt que dans le composant : le test de non-régression parcourt
// cette liste et vérifie que le composant remet bien CHAQUE état à zéro. Ajouter
// un état de sélection sans l'ajouter ici ne protège de rien — mais l'ajouter
// ici sans le remettre à zéro dans le composant fait rougir la suite.
export function selectionVide() {
  return {
    // Recherche par nom
    query: '',                    // terme tapé
    results: [],                  // résultats affichés
    // Choix du produit et de sa variante
    produitEnAttente: null,       // produit tapé, en attente du choix de variante
    variantesAChoisir: null,      // liste de variantes proposée
    varianteChoisie: null,        // variante cochée (l'« index sélectionné »)
    recapitulatif: null,          // relecture avant d'appliquer (voir plus bas)
    // Chemin code-barres
    barcodeConfirmation: null,    // variante trouvée par code, en attente de confirmation
    barcodeCandidats: null,       // plusieurs variantes partagent le code
    barcodeMessage: null,         // message du chemin code-barres
    codeBarresEnAttente: null,    // code scanné inconnu, gardé pour apprentissage
    conflitCodeBarres: null,      // la variante choisie a déjà un autre code
    scanDiag: null,               // diagnostic du lecteur (shadow)
    // Retours à l'écran
    error: null,
    confirmation: null,
  };
}

// Les noms d'états ci-dessus, pour le test de non-régression.
export const ETATS_SELECTION = Object.freeze(Object.keys(selectionVide()));

// ── 2. Le garde-fou de mots communs ─────────────────────────────────────────
//
// ⚠️ POINT CRITIQUE, et c'est tout l'intérêt du garde-fou : la comparaison porte
// sur lignes_ticket.libelle_ticket — le TEXTE BRUT IMPRIMÉ — et JAMAIS sur
// libelle_brut, le libellé normalisé par l'OCR.
//
// Sur le normalisé, le garde-fou comparerait « Chips nature » à la fiche
// « Chips nature » et se tairait toujours : il validerait sa propre erreur.
// C'est exactement ce qui a laissé passer les six mauvais rattachements du
// ticket Netto. Le texte brut est la seule version que l'OCR n'a pas
// réinterprétée, donc la seule contre laquelle une vérification a un sens.
//
// Même logique qu'aux chantiers 105 et 107, et mêmes helpers (motsSignifiants /
// motsCommuns) : un seul endroit décide de ce qu'est un « mot significatif ».
//
// Le produit est décrit par son nom ET sa marque. Le FORMAT est volontairement
// exclu de la comparaison : « 435 g » contre « 435GR » ferait apparaître un mot
// commun purement numérique entre deux produits sans aucun rapport, et le
// garde-fou se tairait sur le cas même qu'il doit attraper.
//
// (Le côté produit a été élargi au chantier 111b — voir juste en dessous. Le
// côté ticket, lui, n'a pas bougé et ne doit pas bouger.)

// ── 2 bis. Chantier 111b — LE VOCABULAIRE DU PRODUIT.
//
// Constat mesuré sur les 6 suggestions du ticket Carrefour : le bandeau se
// déclenchait 3 fois, dont 2 à tort. Un signal juste une fois sur trois cesse
// d'être lu — et un garde-fou qu'on n'écoute plus ne protège de rien.
//
// Les deux fausses alertes avaient la même cause : on ne comparait qu'à
// produits.nom_reference, alors que l'app SAIT déjà autre chose du produit.
//   « 4*BANANES » contre la fiche « Banane » : la fiche porte l'alias actif
//   « Bananes ». Le « s » suffisait à faire crier.
//   « 4*35,5 CL RED BULL R » contre « Boisson énergisante » : une variante
//   active de cette fiche porte la marque « Red Bull ». Le ticket nomme la
//   marque, la fiche nomme la catégorie — aucun mot commun, et pourtant le
//   rapprochement est juste.
//
// On élargit donc le vocabulaire du côté PRODUIT :
//   1. nom_reference (comme avant) ;
//   2. les libellés des alias ACTIFS de ce produit ;
//   3. les noms des marques de ses variantes ACTIVES ;
//   4. la marque de la variante suggérée ou choisie.
// Le côté TICKET ne change pas : toujours le texte de caisse brut.
//
// ⚠️ La mécanique de comparaison (motsSignifiants / motsCommuns) n'est PAS
// touchée : elle est partagée avec les chantiers 105 et 107. On lui donne plus
// de mots à lire, on ne change pas sa façon de lire. Les 105 et 107 profitent
// du même élargissement là où ils décrivent un produit — c'est voulu.
//
// ⚠️ Le format et la quantité restent EXCLUS (règle du 110) : « 435GR » contre
// « 435 g » fabriquerait un faux mot commun entre deux produits sans rapport,
// et ferait taire le garde-fou sur le cas même qu'il doit attraper.
//
// Listes absentes ou vides : on retombe exactement sur le comportement d'avant
// (nom + marque). Un garde-fou dégradé vaut mieux qu'un écran cassé.
export function vocabulaireProduit({ nomProduit = null, marque = null, alias = [], marquesVariantes = [] } = {}) {
  const morceaux = [nomProduit, marque];
  for (const liste of [alias, marquesVariantes]) {
    if (Array.isArray(liste)) morceaux.push(...liste);
  }
  return morceaux
    .filter(m => typeof m === 'string' && m.trim())
    .map(m => m.trim())
    .join(' ');
}

export function divergenceAssociation({ libelleTicket = null, nomProduit = null, marque = null, alias = [], marquesVariantes = [] } = {}) {
  const texteProduit = vocabulaireProduit({ nomProduit, marque, alias, marquesVariantes });

  // Fallback du point 4 : pas de texte brut (anciennes lignes), ou pas de nom de
  // produit -> on ne crie pas faute de données. Une absence n'est pas un
  // désaccord, et le silence n'est jamais un « tout va bien ».
  if (motsSignifiants(libelleTicket).size === 0) return false;
  if (motsSignifiants(texteProduit).size === 0) return false;

  return motsCommuns(libelleTicket, texteProduit).length === 0;
}

// ── 3. Le récapitulatif de relecture ────────────────────────────────────────
//
// Ce que l'écran met face à face, en toutes lettres, avant l'appel à la RPC.
// Construit ici pour que l'écran n'ait aucune décision à prendre : il affiche
// ce qu'on lui donne.
//
// libelleTicketDisponible distingue « pas de texte brut » de « texte brut
// vide » : dans les deux cas le récapitulatif s'affiche quand même (point 4 —
// ne jamais casser l'écran), avec le libellé de repli, et le garde-fou se tait.
export function construireRecapitulatif({
  libelleTicket = null,
  libelleAffiche = null,
  produit = null,
  varianteId = null,
  variante = null,
  // Chantier 111b — vocabulaire élargi du produit. Non fourni (appelant qui ne
  // l'a pas chargé, lecture en base en échec) : comportement d'avant, à
  // l'identique.
  alias = [],
  marquesVariantes = [],
} = {}) {
  const brut = typeof libelleTicket === 'string' ? libelleTicket.trim() : '';
  const disponible = brut.length > 0;
  const marque = variante?.marques?.nom ?? null;

  return {
    produit,
    varianteId: varianteId ?? null,
    // Ce qu'on compare et ce qu'on montre : le texte brut quand on l'a, sinon
    // le libellé affiché — signalé comme tel, jamais présenté pour du brut.
    libelleTicket: disponible ? brut : null,
    libelleAffiche: libelleAffiche ?? null,
    libelleTicketDisponible: disponible,
    nomProduit: produit?.nom_reference ?? null,
    marque,
    format: variante ? formatVariante(variante) : null,
    divergent: disponible && divergenceAssociation({
      libelleTicket: brut,
      nomProduit: produit?.nom_reference ?? null,
      marque,
      alias,
      marquesVariantes,
    }),
  };
}

// Format lisible d'une variante pour le récapitulatif : la quantité nette, et
// le nombre d'unités quand c'est un lot. Volontairement distinct de
// formatEtiquetteVariante (qui préfixe la marque) : ici la marque est déjà
// affichée sur sa propre ligne, la répéter brouillerait la relecture.
export function formatVariante(variante) {
  const quantite = Number(variante?.quantite_nette);
  const unite = variante?.unite_quantite;
  if (!Number.isFinite(quantite) || quantite <= 0 || !unite) return null;
  const unites = Number(variante?.nombre_unites);
  return Number.isFinite(unites) && unites > 1
    ? `${unites} × ${quantite} ${unite}`
    : `${quantite} ${unite}`;
}
