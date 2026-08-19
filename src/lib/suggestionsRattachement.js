// Chantier 111 « Suggestions de rattachement » — logique pure (ni React, ni
// Supabase, ni réseau).
//
// CE QUI A CHANGÉ EN BASE LE 19/08 (déjà en production) : la RPC
// enregistrer_ticket_core n'applique plus les rattachements incertains. Seuls
// deux chemins s'appliquent tout seuls — le code-barres scanné et la mémoire
// d'enseigne EXACTE. Tout le reste (ressemblance floue, alias sur le libellé
// normalisé) écrit désormais une SUGGESTION sans rattacher et sans écrire de
// prix :
//   produit_suggere_ia_id / variante_suggeree_ia_id = la devinette
//   confiance_produit_ia = le score, UNIQUEMENT si la suggestion vient de la
//                          mémoire floue ; NULL si elle vient d'un alias
//   produit_id reste NULL, statut_validation_produit = 'non_valide'
//
// Côté client, une seule règle gouverne ce fichier : UNE SUGGESTION S'AFFICHE,
// ELLE NE SE PRÉ-REMPLIT JAMAIS. C'est la leçon directe du chantier 110 — un
// état pré-rempli finit par être validé sans être lu, et c'est exactement
// comme ça que « Tendres perles à l'italienne » est parti pour un ketchup.
// La suggestion vit donc dans une prop d'affichage, jamais dans un état de
// sélection, et « Oui, c'est ça » passe par le récapitulatif du 110 comme
// n'importe quel autre choix.

// D'où vient la devinette, dit en français. Le score n'est renseigné que par
// la mémoire d'enseigne floue ; un alias n'en produit pas. Cette distinction
// aide à juger : « déjà vu ici » est un signal plus fort qu'une ressemblance
// de libellé, et François doit pouvoir en tenir compte sans connaître le
// modèle de données.
export const ORIGINE_MEMOIRE = 'memoire_enseigne';
export const ORIGINE_LIBELLE = 'libelle';

export function origineSuggestion(confiance) {
  return scoreOuNull(confiance) != null ? ORIGINE_MEMOIRE : ORIGINE_LIBELLE;
}

// null / undefined / chaîne vide DOIVENT être traités AVANT Number() :
// Number(null) vaut 0, qui est fini, et ferait passer une suggestion d'alias
// pour une mémoire d'enseigne avec un score de zéro. Le piège est le même que
// pour les dates plus bas (new Date(null) donne 1970).
export function scoreOuNull(confiance) {
  if (confiance == null || confiance === '') return null;
  const n = Number(confiance);
  return Number.isFinite(n) ? n : null;
}

export function texteOrigine(confiance) {
  return origineSuggestion(confiance) === ORIGINE_MEMOIRE
    ? 'déjà vu dans cette enseigne'
    : "d'après le libellé";
}

// Une ligne porte-t-elle une suggestion exploitable ? Un identifiant suggéré
// sans produit résolu (fiche supprimée, lecture partielle) ne vaut rien : on
// retombe alors sur l'écran de recherche habituel plutôt que d'afficher une
// carte vide. Ne jamais casser l'écran.
export function aUneSuggestion(suggestion) {
  return Boolean(suggestion?.produit?.id && suggestion?.produit?.nom_reference);
}

// Ce que la carte affiche. Construit ici pour que l'écran n'ait aucune
// décision à prendre — il rend ce qu'on lui donne.
//
// `marque` et `format` ne viennent QUE de la variante suggérée : sans
// variante, on n'affiche ni l'une ni l'autre plutôt que d'aller les chercher
// ailleurs. Une suggestion doit dire ce qu'elle a deviné, pas plus.
export function construireCarteSuggestion({ libelleTicket = null, suggestion = null } = {}) {
  if (!aUneSuggestion(suggestion)) return null;
  const brut = typeof libelleTicket === 'string' ? libelleTicket.trim() : '';
  const variante = suggestion.variante ?? null;

  return {
    libelleTicket: brut.length > 0 ? brut : null,
    libelleTicketDisponible: brut.length > 0,
    nomProduit: suggestion.produit.nom_reference,
    marque: variante?.marques?.nom ?? null,
    format: formatVarianteSuggeree(variante),
    origine: texteOrigine(suggestion.confiance),
    confiance: scoreOuNull(suggestion.confiance),
  };
}

// Même règle de format que le récapitulatif du 110 : quantité nette, et le
// nombre d'unités quand c'est un lot.
export function formatVarianteSuggeree(variante) {
  const quantite = Number(variante?.quantite_nette);
  const unite = variante?.unite_quantite;
  if (!Number.isFinite(quantite) || quantite <= 0 || !unite) return null;
  const unites = Number(variante?.nombre_unites);
  return Number.isFinite(unites) && unites > 1
    ? `${unites} × ${quantite} ${unite}`
    : `${quantite} ${unite}`;
}

// ── Le compte par jour de ticket ────────────────────────────────────────────
//
// Les archives n'ont pas de ticket_id : la correspondance avec lignes_ticket
// se fait par la DATE du ticket, comme partout ailleurs dans cet écran (voir
// trouverLignesTicket). On regroupe donc les lignes en attente par jour.
//
// Une ligne ne compte que si elle porte une suggestion ET n'est pas encore
// rattachée : dès que François confirme, elle disparaît du compte, ce qui est
// précisément ce qu'on veut voir bouger après chaque confirmation.
export function compterAConfirmerParJour(lignes) {
  const parJour = new Map();
  for (const ligne of (lignes || [])) {
    const jour = ligne?.tickets?.date_ticket;
    if (!jour) continue;
    parJour.set(jour, (parJour.get(jour) || 0) + 1);
  }
  return parJour;
}

// Jour d'une archive, au format de tickets.date_ticket (« YYYY-MM-DD »).
// Renvoie null sur une date illisible plutôt que « Invalid Date ».
export function jourArchive(date) {
  // null et '' passent AVANT new Date() : new Date(null) vaut le 1er janvier
  // 1970, une date parfaitement valide qui rangerait des archives sous un jour
  // inventé.
  if (date == null || date === '') return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
