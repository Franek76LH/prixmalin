// Chantier 114 — chercher les fiches sur le TEXTE DE CAISSE du ticket.
//
// ── LE PIÈGE QUE CE FICHIER EXISTE POUR VERROUILLER ─────────────────────────
//
// Dans la table lignes_ticket, les deux colonnes portent des noms trompeurs :
//
//   libelle_brut    = le libellé REFORMULÉ PAR L'OCR. « Pâtes », « Plat
//                     cuisiné ». Malgré son nom, il n'a RIEN de brut : c'est
//                     une interprétation, appauvrie, du ticket.
//   libelle_ticket  = le VRAI texte imprimé par la caisse.
//                     « 4x1KG PENNE RIGATE B ».
//
// Chercher sur libelle_brut, c'est chercher sur « Pâtes » et proposer
// Coquillettes pour un paquet de Penne rigate. Chercher sur libelle_ticket,
// c'est retrouver PENNE et RIGATE. Toute la valeur du chantier tient dans ce
// choix de colonne — d'où une fonction dédiée, testée, plutôt qu'un accès
// direct au champ dispersé dans App.jsx.
//
// Logique pure (ni React, ni Supabase) : ce qui décide de la colonne lue et de
// ce qui s'affiche est vérifiable en test.

// Le nom exact de la RPC déjà créée et testée en base. On ne la modifie pas,
// on ne la recrée pas : elle renvoie déjà ses résultats TRIÉS.
export const RPC_CANDIDATS_TICKET = 'rechercher_candidats_ticket';

// Les deux colonnes, nommées ici une bonne fois pour toutes.
export const COLONNE_TEXTE_CAISSE = 'libelle_ticket'; // le vrai texte imprimé
export const COLONNE_LIBELLE_OCR = 'libelle_brut';    // la reformulation OCR

// Combien de fiches au maximum dans le bloc du haut. Au-delà, ce n'est plus
// une aide : c'est une deuxième liste à dépouiller.
export const LIMITE_CANDIDATS_TICKET = 8;

// Le texte de caisse d'une ligne de ticket, et RIEN D'AUTRE.
//
// Aucun repli sur libelle_brut. C'est délibéré et c'est le cœur du chantier :
// un repli silencieux sur la reformulation OCR ramènerait exactement le défaut
// qu'on corrige, en le rendant invisible (la recherche « marcherait », elle
// donnerait juste les mauvaises fiches). Une ligne ancienne sans texte de
// caisse renvoie null : le bloc du haut ne s'affiche simplement pas, et la
// recherche habituelle reste entière.
export function texteDeCaisse(ligne) {
  const brut = ligne?.[COLONNE_TEXTE_CAISSE];
  const texte = typeof brut === 'string' ? brut.trim() : '';
  return texte || null;
}

// ── Chantier 114b — ON N'INTERROGE PAS LA BASE AVANT DE SAVOIR OÙ ON EST ────
//
// LE CAS RÉEL, mesuré en base sur « 4x1KG PENNE RIGATE B » :
//   appel SANS enseigne        -> « Penne protéinées » en tête
//   appel AVEC enseigne (Carrefour) -> « Penne rigate » en tête
//
// L'enseigne arrive de façon asynchrone. Tant qu'on la laissait manquer, le
// bloc s'affichait d'abord avec la MAUVAISE fiche en première position, puis se
// corrigeait. Ce n'est pas un scintillement cosmétique : un doigt qui touche
// pendant cette fenêtre grave une correspondance fausse dans la mémoire de
// l'enseigne (chantier 113), qui se réappliquera toute seule aux tickets
// suivants. C'est exactement le piège du chantier 110, en plus rapide.
//
// D'où la règle : PAS D'APPEL tant que l'enseigne n'est pas RÉSOLUE.
//
// « Résolue » ne veut pas dire « non nulle ». Il y a trois situations, et deux
// seulement autorisent l'appel :
//   enseigneResolue !== true        -> on ne sait pas ENCORE : aucun appel.
//   enseigneResolue === true, uuid  -> on sait laquelle : appel trié.
//   enseigneResolue === true, null  -> on sait qu'il n'y en a pas (ticket sans
//                                     magasin) : UN appel, avec p_enseigne null.
//
// Le drapeau est donc obligatoire et sans valeur par défaut : un appelant qui
// l'oublie n'interroge rien, plutôt que d'interroger trop tôt. Un défaut à
// `true` aurait laissé le double appel revenir en silence.
export function enseigneEstResolue(enseigneResolue) {
  return enseigneResolue === true;
}

// Les arguments de la RPC, ou null s'il n'y a rien à chercher — ou pas encore.
//
// null veut dire « n'appelle pas la base » : sans texte de caisse, la RPC
// n'aurait aucune matière ; sans enseigne résolue, elle répondrait à côté.
export function argumentsCandidatsTicket({ libelleTicket, enseigne = null, enseigneResolue, limite = LIMITE_CANDIDATS_TICKET } = {}) {
  if (!enseigneEstResolue(enseigneResolue)) return null;
  const texte = texteDeCaisse({ [COLONNE_TEXTE_CAISSE]: libelleTicket });
  if (!texte) return null;
  return {
    p_libelle_ticket: texte,
    p_enseigne: enseigne ?? null,
    p_limite: limite,
  };
}

// Ce que la RPC a renvoyé, ramené à une liste utilisable.
//
// Toute défaillance — erreur réseau, erreur SQL, réponse d'une forme
// inattendue — donne une liste VIDE, jamais une exception. Le bloc du haut est
// une aide : son absence doit passer inaperçue, pas casser l'écran de
// correction. On ne retrie RIEN : la base a déjà classé, et un tri par-dessus
// (alphabétique ou autre) ferait redescendre la bonne fiche.
export function normaliserCandidatsTicket(data) {
  if (!Array.isArray(data)) return [];
  return data.filter(c => c && c.produit_id);
}

// Les deux listes, mises en ordre pour l'affichage.
//
// Une fiche présente des deux côtés n'apparaît qu'UNE fois, en haut : la voir
// deux fois donnerait à croire à deux fiches différentes, et c'est justement
// ce doute-là qu'on essaie de lever.
//
// L'ordre reçu est conservé des deux côtés.
export function fusionnerListesCandidats({ candidatsTicket = [], resultatsRecherche = [] } = {}) {
  const hautDeListe = normaliserCandidatsTicket(candidatsTicket);
  const dejaEnHaut = new Set(hautDeListe.map(c => c.produit_id));
  const resteRecherche = (Array.isArray(resultatsRecherche) ? resultatsRecherche : [])
    .filter(r => r && !dejaEnHaut.has(r.produit_id));
  return { hautDeListe, resteRecherche };
}

// Faut-il afficher le bloc « D'après le ticket » ?
//
// Zéro candidat -> NON, et sans un mot : ni encart vide, ni « aucune
// suggestion ». Sur « OKAY ESS TT XXL X2 » (un produit d'entretien dont aucune
// fiche n'existe), un encart vide ferait croire à une panne alors que la base
// a répondu correctement « je ne sais pas ».
export function doitAfficherBlocTicket(hautDeListe) {
  return normaliserCandidatsTicket(hautDeListe).length > 0;
}
