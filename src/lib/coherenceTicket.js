// Chantier 108 « Contrôle de cohérence de la lecture d'un ticket » — logique
// pure (ni React, ni Supabase, ni réseau).
//
// LE CAS RÉEL (18/08) : ticket Netto de 45,33 € et 20 articles. L'OCR a rendu
// 31 lignes dont la somme fait 115,45 €, avec des libellés hallucinés (« NETTO
// SUCCION BLEU DE » pour NETTO CORDON BLEU), des doublons inventés, et une date
// au 20 avril 2009 — vraisemblablement lue sur le numéro de téléphone du
// magasin (04.96.20.32.10). Tout ça est passé sans un mot. Aucun prix n'a été
// écrit (la validation ligne par ligne a tenu), mais 31 lignes fausses ont
// atterri dans la file de validation, où une fausse manœuvre suffit à en faire
// entrer une.
//
// Le principe qui gouverne le fichier : ON NE REFUSE QUE CE QU'ON A PU MESURER.
// Total illisible, nombre d'articles illisible : aucun contrôle, on continue
// exactement comme avant. Une absence de donnée n'est jamais une anomalie.

// Sous 2 %, on ne dit rien : les écarts d'arrondi, les consignes et les
// remises non lues vivent là, et crier à chaque ticket rendrait l'alerte
// invisible le jour où elle compte.
export const SEUIL_AVERTISSEMENT = 0.02;
// Au-delà de 10 %, on REFUSE au lieu d'avertir. Choix assumé : importer trente
// lignes fausses ne rend service à personne, et reprendre une photo coûte peu.
export const SEUIL_BLOCAGE = 0.10;

export const NIVEAU_OK = 'ok';
export const NIVEAU_AVERTISSEMENT = 'avertissement';
export const NIVEAU_BLOCAGE = 'blocage';

export const MOTIF_MONTANT = 'montant';
// Chantier 108c — raison pour laquelle le contrôle du MONTANT n'a pas pu être
// fait. Exposée pour que l'écran puisse le dire si besoin, jamais pour
// alerter : une absence de mesure n'est pas une anomalie.
export const MONTANT_SANS_TOTAL = 'sans_total_ticket';
export const MONTANT_REMISES_INCONNUES = 'remises_inconnues';
export const MOTIF_ARTICLES = 'articles';

// Excédent d'articles en dessous duquel le contrôle du COMPTE ne dit rien du
// tout — ni avertissement, ni blocage.
//
// Pourquoi un plancher ABSOLU en plus du pourcentage : sur de petits nombres,
// un pourcentage ne veut rien dire. Un seul article de trop sur un ticket de 5
// fait 20 % et refuserait l'import ; sur un ticket de 20 il fait 5 % et
// déclencherait un bandeau. Or +1 est banal — les tickets ne comptent pas tous
// les articles de la même façon (consignes, lots, articles au poids).
//
// Le risque réel n'est pas de rater un doublon : c'est d'alerter si souvent que
// le bandeau devient invisible le jour où trente lignes sont fausses. Le cas
// Netto, lui, est à +11 articles : très au-dessus de ce plancher.
export const EXCEDENT_ARTICLES_MINI = 3;

const nombreOuNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Montant d'une ligne lue. On prend `total` (le montant réellement facturé pour
// la ligne, prix unitaire × quantité), avec repli sur prix × quantité puis sur
// le prix seul : le prompt garantit `total`, mais une lecture dégradée peut ne
// remplir que `price`. Jamais NaN — une ligne illisible vaut 0 et ne gonfle pas
// artificiellement la somme.
export function montantLigne(produit) {
  const total = nombreOuNull(produit?.total);
  if (total != null && total > 0) return total;
  const prix = nombreOuNull(produit?.price);
  if (prix == null || prix <= 0) return 0;
  const qte = nombreOuNull(produit?.qty);
  return qte != null && qte > 0 ? prix * qte : prix;
}

export function sommeLignes(produits) {
  return (produits || []).reduce((somme, p) => somme + montantLigne(p), 0);
}

// Nombre d'ARTICLES lus, pas de lignes : une ligne « ×3 » vaut trois articles.
// C'est la seule façon de comparer à ce qui est imprimé sur le ticket, qui
// compte les unités.
export function articlesLus(produits) {
  return (produits || []).reduce((n, p) => {
    const qte = nombreOuNull(p?.qty);
    return n + (qte != null && qte > 0 ? qte : 1);
  }, 0);
}

const niveauPourEcart = (ecart) => {
  if (ecart > SEUIL_BLOCAGE) return NIVEAU_BLOCAGE;
  if (ecart > SEUIL_AVERTISSEMENT) return NIVEAU_AVERTISSEMENT;
  return NIVEAU_OK;
};

const PIRE = { [NIVEAU_OK]: 0, [NIVEAU_AVERTISSEMENT]: 1, [NIVEAU_BLOCAGE]: 2 };

// LE point d'entrée. Compare ce que l'OCR a lu à ce que le ticket annonce.
//
// Renvoie toujours un objet complet : `niveau`, les chiffres des deux côtés
// (pour les afficher côte à côte, c'est la confrontation qui convainc), et les
// motifs déclenchés.
export function controlerCoherenceTicket({ products = [], total_ticket = null, nombre_articles = null, total_remises = null } = {}) {
  const somme = sommeLignes(products);
  const articles = articlesLus(products);
  const totalTicket = nombreOuNull(total_ticket);
  const articlesTicket = nombreOuNull(nombre_articles);

  // Chantier 108c — LES REMISES. Les lignes du ticket portent des prix AVANT
  // remise, le total imprimé est APRÈS remise : sans cette déduction, tout
  // ticket en promotion déclenche une alerte injustifiée. Constaté sur le
  // Netto : 47,22 € de lignes contre 45,33 € imprimés, soit exactement la
  // remise « 2+1 PRINGLES » de 1,89 €.
  //
  // Une remise est une magnitude : le modèle peut l'écrire 1.89 ou -1.89, on
  // prend la valeur absolue plutôt que de dépendre d'une convention de signe.
  const remisesLues = nombreOuNull(total_remises);
  const remises = remisesLues != null ? Math.abs(remisesLues) : null;
  const sommeApresRemises = remises != null ? somme - remises : null;

  const detail = {
    sommeLignes: somme,
    remises,
    sommeApresRemises,
    montantNonMesure: null,
    totalTicket: totalTicket != null && totalTicket > 0 ? totalTicket : null,
    articlesLus: articles,
    articlesTicket: articlesTicket != null && articlesTicket > 0 ? articlesTicket : null,
    nbLignes: (products || []).length,
    ecartMontant: null,
    ecartArticles: null,
    motifs: [],
  };

  let niveau = NIVEAU_OK;
  const retenir = (n, motif) => {
    if (PIRE[n] > PIRE[niveau]) niveau = n;
    if (n !== NIVEAU_OK) detail.motifs.push(motif);
  };

  // Montant. Deux conditions pour que la comparaison ait un sens :
  //   - le ticket annonce un total exploitable ;
  //   - on connaît le total des remises (0 compris — un ticket sans promotion
  //     est le cas le plus courant et doit rester contrôlé).
  //
  // Remises inconnues : on NE COMPARE PAS. On ne saurait pas distinguer une
  // mauvaise lecture d'une promotion non comptée, et alerter à tort apprend à
  // ignorer l'alerte. Même règle que partout : on ne signale que ce qu'on a pu
  // mesurer.
  if (detail.totalTicket == null) {
    detail.montantNonMesure = MONTANT_SANS_TOTAL;
  } else if (remises == null) {
    detail.montantNonMesure = MONTANT_REMISES_INCONNUES;
  } else {
    detail.ecartMontant = Math.abs(sommeApresRemises - detail.totalTicket) / detail.totalTicket;
    retenir(niveauPourEcart(detail.ecartMontant), MOTIF_MONTANT);
  }

  // Nombre d'articles. On ne regarde QUE le sur-comptage : lire PLUS d'articles
  // que le ticket n'en annonce est le signe des doublons hallucinés.
  //
  // Le sous-comptage est volontairement ignoré : il est banal et légitime
  // (lignes au poids, articles regroupés, tickets qui comptent autrement), et
  // en faire un motif de blocage refuserait des lectures parfaitement bonnes.
  // Une lecture réellement incomplète se voit de toute façon sur le montant.
  if (detail.articlesTicket != null && articles - detail.articlesTicket >= EXCEDENT_ARTICLES_MINI) {
    detail.ecartArticles = (articles - detail.articlesTicket) / detail.articlesTicket;
    retenir(niveauPourEcart(detail.ecartArticles), MOTIF_ARTICLES);
  }

  return {
    ...detail,
    niveau,
    mesurable: detail.montantNonMesure === null || detail.articlesTicket != null,
  };
}

// ── Date ────────────────────────────────────────────────────────────────────
// Un ticket daté de 2009 ne doit jamais s'enregistrer en silence. Sur le ticket
// Netto, la date lue venait vraisemblablement du numéro de téléphone du magasin
// (04.96.20.32.10 -> 20 avril 2009).
export const JOURS_ANCIENNETE_MAX = 90;

export const DATE_FUTURE = 'future';
export const DATE_TROP_ANCIENNE = 'trop_ancienne';

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

// « YYYY-MM-DD » -> Date à midi UTC (midi et pas minuit : à minuit, un décalage
// de fuseau fait basculer la date d'un jour et fabrique de faux « demain »).
function lireDateIso(texte) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texte || '').trim());
  if (!m) return null;
  const [, a, mo, j] = m;
  const d = new Date(Date.UTC(Number(a), Number(mo) - 1, Number(j), 12));
  if (Number.isNaN(d.getTime())) return null;
  // Rejette les dates qui « débordent » (31 février -> 3 mars).
  if (d.getUTCFullYear() !== Number(a) || d.getUTCMonth() !== Number(mo) - 1 || d.getUTCDate() !== Number(j)) return null;
  return d;
}

export function dateDuJourIso(aujourdHui = new Date()) {
  const a = aujourdHui.getFullYear();
  const m = String(aujourdHui.getMonth() + 1).padStart(2, '0');
  const j = String(aujourdHui.getDate()).padStart(2, '0');
  return `${a}-${m}-${j}`;
}

// Date illisible ou absente -> `suspecte: false` : on ne signale que ce qu'on a
// pu mesurer, ici comme ailleurs. `dateProposee` est toujours la date du jour,
// c'est le défaut le plus probable pour un ticket qu'on scanne.
export function controlerDateTicket(dateLue, aujourdHui = new Date()) {
  const proposee = dateDuJourIso(aujourdHui);
  const d = lireDateIso(dateLue);
  if (!d) return { suspecte: false, raison: null, dateLue: null, dateProposee: proposee };

  const reference = lireDateIso(proposee);
  const ecartJours = Math.round((reference.getTime() - d.getTime()) / MS_PAR_JOUR);

  if (ecartJours < 0) {
    return { suspecte: true, raison: DATE_FUTURE, dateLue, dateProposee: proposee, ecartJours };
  }
  if (ecartJours > JOURS_ANCIENNETE_MAX) {
    return { suspecte: true, raison: DATE_TROP_ANCIENNE, dateLue, dateProposee: proposee, ecartJours };
  }
  return { suspecte: false, raison: null, dateLue, dateProposee: proposee, ecartJours };
}

// Montant à la française pour l'affichage côte à côte.
export function formatEuros(montant) {
  const n = Number(montant);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(2).replace('.', ',')} €`;
}
