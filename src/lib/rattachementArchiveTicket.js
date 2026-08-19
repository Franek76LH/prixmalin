// Chantier 112 « Un ticket scanné produit toujours une archive » — logique pure
// (ni React, ni Supabase, ni réseau).
//
// LE DÉFAUT, confirmé en base le 19/08. L'import choisissait l'archive à
// rattacher ainsi :
//
//   const openArchive = [...archives].reverse().find(a => !a.ticket_scanned);
//
// La SEULE condition était « pas encore scannée ». Une archive n'était donc
// créée que s'il n'en existait aucune en attente — et sept sessions de courses
// abandonnées le 11/08 (Carrefour, de 1,95 € à 7,23 €) en laissaient une en
// permanence. Résultat : depuis huit jours, plus AUCUNE archive n'était créée
// par un scan. Les tickets Netto du 18/08 et Carrefour du 19/08 n'en ont jamais
// eu, et sont restés invisibles dans l'onglet Archives.
//
// La règle qui gouverne ce fichier : ON NE RATTACHE QUE CE QUI CORRESPOND
// VRAIMENT. Dans le doute, on crée. Une archive en trop se voit et se
// supprime ; un ticket qui n'apparaît nulle part ne se voit pas — et c'est
// justement pour ça qu'il a fallu huit jours pour s'en apercevoir.

// Au-delà de 24 h, une session de courses et un ticket ne décrivent plus la
// même sortie. C'est large à dessein : on couvre les courses commencées la
// veille au soir et payées le lendemain matin, sans jamais aller repêcher une
// session de la semaine passée.
export const FENETRE_RATTACHEMENT_MS = 24 * 60 * 60 * 1000;

// Les trois raisons possibles d'un refus, exposées pour être traçables et
// testables une par une.
export const REFUS_DEJA_SCANNEE = 'deja_scannee';
export const REFUS_AUTRE_MAGASIN = 'autre_magasin';
export const REFUS_TROP_ANCIENNE = 'trop_ancienne';

const horodatage = (valeur) => {
  if (valeur == null || valeur === '') return null;
  const t = new Date(valeur).getTime();
  return Number.isFinite(t) ? t : null;
};

// Identifiant d'enseigne d'une archive (archives.store est un JSON
// {id, name, logo, …}). On compare des IDENTIFIANTS, jamais des noms : deux
// magasins peuvent s'appeler « Carrefour » et « Carrefour Market », et un même
// magasin change de libellé au fil des lectures OCR.
export function identifiantMagasinArchive(archive) {
  const id = archive?.store?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

// Une archive est-elle rattachable à CE ticket ? Les trois conditions doivent
// être réunies ; il en manque une, on crée.
//
// Renvoie { rattachable, refus } — le motif sert aux tests et à la trace, il
// n'est jamais montré tel quel à l'utilisateur.
export function archiveRattachable(archive, { magasinId = null, maintenant = null } = {}) {
  if (archive?.ticket_scanned) return { rattachable: false, refus: REFUS_DEJA_SCANNEE };

  // Magasin. Une archive sans identifiant exploitable, ou un ticket dont on ne
  // connaît pas l'enseigne, ne permettent PAS d'affirmer qu'il s'agit du même
  // magasin — donc on ne rattache pas. Ne rien savoir n'est pas une raison de
  // rapprocher ; c'est une raison de créer.
  const idArchive = identifiantMagasinArchive(archive);
  const idTicket = typeof magasinId === 'string' && magasinId.trim() ? magasinId.trim() : null;
  if (!idArchive || !idTicket || idArchive !== idTicket) {
    return { rattachable: false, refus: REFUS_AUTRE_MAGASIN };
  }

  // Ancienneté. Date illisible ou absente : même raisonnement, on ne rattache
  // pas. Une archive datée du futur est acceptée dans la fenêtre (horloge
  // décalée), mais jamais au-delà.
  const dateArchive = horodatage(archive?.date);
  const reference = horodatage(maintenant);
  if (dateArchive == null || reference == null) {
    return { rattachable: false, refus: REFUS_TROP_ANCIENNE };
  }
  if (Math.abs(reference - dateArchive) > FENETRE_RATTACHEMENT_MS) {
    return { rattachable: false, refus: REFUS_TROP_ANCIENNE };
  }

  return { rattachable: true, refus: null };
}

// LE point d'entrée. Parmi les archives connues, celle à laquelle rattacher ce
// ticket — ou null s'il faut en créer une.
//
// On parcourt de la plus récente à la plus ancienne (les archives arrivent
// triées par date croissante) : à conditions égales, la session la plus proche
// du passage en caisse est la bonne.
export function choisirArchiveARattacher(archives, { magasinId = null, maintenant = null } = {}) {
  if (!Array.isArray(archives)) return null;
  for (let i = archives.length - 1; i >= 0; i--) {
    const archive = archives[i];
    if (archiveRattachable(archive, { magasinId, maintenant }).rattachable) return archive;
  }
  return null;
}
