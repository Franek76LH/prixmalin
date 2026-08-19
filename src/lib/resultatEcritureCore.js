// Chantier 109 « Dire quand la base refuse le ticket » — logique pure
// (ni React, ni Supabase, ni réseau).
//
// LE CAS RÉEL (18/08, 15h41) : François scanne son ticket Netto, va au bout,
// partage. L'app affiche « partagé ». En réalité le Core n'a RIEN écrit — ni
// ticket, ni ligne, ni prix. La RPC enregistrer_ticket_core avait répondu
// HTTP 200 avec {"statut":"rejet"} ; personne n'a lu ce corps. Seuls price_db
// et community_prices ont été alimentés.
//
// Même famille que le chantier 96 : la cascade silencieuse. Un appel qui
// « réussit » techniquement mais refuse métier, et une interface qui annonce
// un succès qu'elle n'a pas constaté.
//
// LE contrat de la RPC, lu dans sa définition :
//   statut 'ok'            -> aucun rejet, tout est écrit
//   statut 'rejet_partiel' -> le ticket et les lignes SONT écrits, mais au
//                             moins une ligne n'a pas produit de prix
//   statut 'rejet'         -> RIEN n'est écrit (magasin non résolu, ou
//                             exception technique)
//   prix_ecrits : entier ; rejets : [{motif, message?, libelle?}]
//
// Chantier 111 — la RPC a changé en base le 19/08 : elle n'applique plus les
// rattachements incertains. Seuls le code-barres scanné et la mémoire
// d'enseigne EXACTE s'appliquent seuls ; la ressemblance floue et les alias
// écrivent une SUGGESTION sans rattacher et sans écrire de prix. Le compte de
// ces lignes arrive dans un nouveau champ, lignes_a_confirmer.
//
// ⚠️ Une ligne à confirmer N'EST PAS UN REJET, et ne doit jamais alimenter le
// chemin d'échec ci-dessous. C'est l'état normal du nouveau fonctionnement :
// crier à chaque ticket rendrait le message invisible en trois jours, et le
// vrai échec du 18/08 repasserait inaperçu — soit exactement le défaut que le
// chantier 109 vient de réparer.
//
// Règle qui gouverne le fichier : DANS LE DOUTE, ON ANNONCE L'ÉCHEC. Une
// réponse absente, illisible ou d'un statut inconnu ne devient jamais un
// succès — c'est exactement l'erreur qu'on répare.

export const NIVEAU_SUCCES = 'succes';
export const NIVEAU_INFO = 'info';
export const NIVEAU_ECHEC = 'echec';

export const MOTIF_MAGASIN_NON_RESOLU = 'magasin_non_resolu';
export const MOTIF_ERREUR_TECHNIQUE = 'erreur_technique';
// alias_non_trouve n'est PAS une erreur : c'est le fonctionnement normal, la
// ligne part en file de validation. La confondre avec un échec ferait crier
// l'app sur presque chaque ticket, et le vrai échec passerait inaperçu.
export const MOTIF_ALIAS_NON_TROUVE = 'alias_non_trouve';

const TITRE_ECHEC = "Tes prix n'ont pas été enregistrés dans le comparateur";

const entier = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};

const listeRejets = (resultat) => (Array.isArray(resultat?.rejets) ? resultat.rejets : []);

function premierMessage(rejets, motif) {
  const trouve = rejets.find(r => r?.motif === motif && typeof r?.message === 'string' && r.message.trim());
  return trouve ? trouve.message.trim() : null;
}

// Motif de rejet global -> ce qu'on en dit à l'écran, et ce que François peut
// faire. On traduit ; on ne recopie pas du jargon de base de données.
function expliquerRejetGlobal(rejets) {
  const motifs = rejets.map(r => r?.motif).filter(Boolean);

  if (motifs.includes(MOTIF_MAGASIN_NON_RESOLU)) {
    return {
      detail: "Le magasin n'a pas été reconnu. Rescanne le ticket en choisissant ton magasin dans la liste proposée.",
      messageTechnique: null,
    };
  }
  if (motifs.includes(MOTIF_ERREUR_TECHNIQUE)) {
    return {
      detail: "Un problème technique a bloqué l'enregistrement. Tes prix restent dans ton historique personnel, mais ils ne sont pas partis dans le comparateur.",
      messageTechnique: premierMessage(rejets, MOTIF_ERREUR_TECHNIQUE),
    };
  }
  return {
    detail: "La base a refusé l'enregistrement sans en donner la raison. Tes prix restent dans ton historique personnel.",
    messageTechnique: motifs.length > 0 ? `motifs : ${motifs.join(', ')}` : null,
  };
}

// LE point d'entrée. `lignesEnvoyees` est le nombre de lignes qu'on a
// transmises : sans lui on ne peut pas parler de réussite partielle, et on
// s'en abstient plutôt que d'inventer un dénominateur.
export function interpreterResultatCore(resultat, { lignesEnvoyees = null } = {}) {
  const attendues = entier(lignesEnvoyees);
  const socle = {
    niveau: NIVEAU_ECHEC,
    titre: TITRE_ECHEC,
    detail: null,
    messageTechnique: null,
    prixEcrits: null,
    lignesEnvoyees: attendues,
    aRattacher: 0,
    // Chantier 111 — lignes devinées, en attente d'une confirmation humaine.
    aConfirmer: 0,
    motifs: [],
  };

  // Réponse absente (RPC en erreur réseau, exception) ou d'une forme
  // imprévue : on ne sait pas ce qui s'est passé, donc on ne promet rien.
  if (!resultat || typeof resultat !== 'object' || typeof resultat.statut !== 'string') {
    return {
      ...socle,
      detail: "La base n'a pas confirmé l'enregistrement. Tes prix restent dans ton historique personnel, mais ils ne sont peut-être pas partis dans le comparateur.",
    };
  }

  const rejets = listeRejets(resultat);
  const motifs = [...new Set(rejets.map(r => r?.motif).filter(Boolean))];
  const aRattacher = rejets.filter(r => r?.motif === MOTIF_ALIAS_NON_TROUVE).length;
  const prixEcrits = entier(resultat.prix_ecrits);
  // Chantier 111 — champ absent (ancienne réponse) ou illisible : 0, donc tout
  // se comporte exactement comme avant.
  const aConfirmer = entier(resultat.lignes_a_confirmer) ?? 0;
  const base = { ...socle, motifs, aRattacher, aConfirmer, prixEcrits };

  if (resultat.statut === 'rejet') {
    const { detail, messageTechnique } = expliquerRejetGlobal(rejets);
    return { ...base, niveau: NIVEAU_ECHEC, titre: TITRE_ECHEC, detail, messageTechnique };
  }

  if (resultat.statut === 'ok' || resultat.statut === 'rejet_partiel') {
    // Un problème RÉEL sur une ligne : ni « tout va bien », ni un échec total
    // (le ticket et les lignes sont bien en base).
    const technique = motifs.includes(MOTIF_ERREUR_TECHNIQUE);
    const manquants = (attendues != null && prixEcrits != null) ? attendues - prixEcrits : null;

    const morceaux = [];
    if (aConfirmer > 0) {
      // Chantier 111 — état d'ATTENTE. On compte ce qui s'est appliqué tout
      // seul, ce que l'app a deviné et qui attend un avis, et ce qu'elle n'a
      // pas su rapprocher. Trois nombres, aucun jugement : « 0 ligne reconnue,
      // 6 à confirmer, 35 à rattacher » décrit un travail à faire, pas une
      // panne.
      const reconnues = prixEcrits ?? 0;
      const compte = [`${reconnues} ligne${reconnues > 1 ? 's' : ''} reconnue${reconnues > 1 ? 's' : ''}`, `${aConfirmer} à confirmer`];
      if (aRattacher > 0) compte.push(`${aRattacher} à rattacher`);
      // Virgules et non « · » : les trois nombres forment UNE phrase qui se lit
      // d'un trait, pas trois informations séparées.
      morceaux.push(compte.join(', '));
    } else {
      if (attendues != null && prixEcrits != null && prixEcrits < attendues) {
        morceaux.push(`${prixEcrits} prix enregistré${prixEcrits > 1 ? 's' : ''} sur ${attendues}`);
      }
      if (aRattacher > 0) {
        morceaux.push(`${aRattacher} ligne${aRattacher > 1 ? 's' : ''} à rattacher`);
      }
    }

    if (technique) {
      return {
        ...base,
        niveau: NIVEAU_INFO,
        titre: 'Enregistrement incomplet',
        detail: morceaux.length > 0 ? morceaux.join(' · ') : 'Une partie des lignes n\'a pas pu être enregistrée.',
        messageTechnique: premierMessage(rejets, MOTIF_ERREUR_TECHNIQUE),
      };
    }

    // Uniquement des alias non trouvés (ou rien du tout) : fonctionnement
    // normal. Ton neutre, aucune alarme.
    if (morceaux.length > 0) {
      return { ...base, niveau: NIVEAU_INFO, titre: null, detail: morceaux.join(' · '), messageTechnique: null };
    }

    // Tout est passé, et le compte y est : on ne dit RIEN de plus. Le succès
    // habituel s'affiche, sans bandeau « tout va bien » qui n'apprend rien.
    if (manquants != null && manquants > 0) {
      return { ...base, niveau: NIVEAU_INFO, titre: null, detail: `${prixEcrits} prix enregistré${prixEcrits > 1 ? 's' : ''} sur ${attendues}`, messageTechnique: null };
    }
    return { ...base, niveau: NIVEAU_SUCCES, titre: null, detail: null };
  }

  // Statut inconnu : dans le doute, l'échec.
  return {
    ...base,
    niveau: NIVEAU_ECHEC,
    titre: TITRE_ECHEC,
    detail: "La base a répondu quelque chose d'inattendu. Tes prix restent dans ton historique personnel, mais ils ne sont peut-être pas partis dans le comparateur.",
    messageTechnique: `statut inconnu : ${resultat.statut}`,
  };
}
