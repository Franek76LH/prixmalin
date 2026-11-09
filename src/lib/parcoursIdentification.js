// Chantier 119 — « Identifier ce produit » : parcours plein écran, ligne par
// ligne, avec VALIDATION CONSCIENTE. SHADOW.
//
// Le 118 écrivait dès la lecture du code puis offrait « ↩ Annuler » 8 s. Test
// iPhone du 09/11 : une bière scannée sur CHOU FLEUR PIECE a écrit un faux
// prix. Désormais : code lu -> RECHERCHE SEULE -> fiche de vérification (photo,
// nom, marque, format) -> écriture UNIQUEMENT sur « ✓ C'est bien ça ».
//
// Ce module porte TOUT l'enchaînement (sans React, sans Supabase en direct :
// les accès sont injectés), pour que les règles qui comptent soient testées :
// rien n'est écrit avant ✓, la bonne RPC selon le cas, refus du poids
// variable, enchaînement automatique puis « Ticket complet ».
//
// deps :
//   chercherVarianteParCode, chercherOff   -> lecture (rechercherScanLigne)
//   relier, creerDepuisCode                -> écriture (ecrireScanLigne)
//   annuler(ligneId)                       -> annuler_scan_ligne_ticket
//   marquer(ligneId, valeur)               -> marquer_ligne_sans_code_barres
// options :
//   attendre(ms) : pause du ✓ animé (1 s) — injectable pour les tests.
//   journal      : console par défaut ([C119] refus — <ean> — <ligne>).
import {
  estAIdentifier, trierLignesTicket, prixArticle, titreLigneInconnue,
  rechercherScanLigne, ecrireScanLigne, annulerScanLigne, ligneApresAnnulation,
  libelleProduitCree, RECHERCHE_CONNU, RECHERCHE_INCONNU, SOURCE_AUCUNE, normaliserCode,
  marquerSansCodeBarres,
} from './scanDepuisHistorique';

export const PHASE_CAMERA = 'camera';
export const PHASE_RECHERCHE = 'recherche';
export const PHASE_VERIFICATION = 'verification';
export const PHASE_REFUS = 'refus';
export const PHASE_ECRITURE = 'ecriture';
export const PHASE_SUCCES = 'succes';
export const PHASE_FIN = 'fin';

export const DUREE_SUCCES_MS = 1000;

// Correctif du 09/11 (test iPhone) : sur V.BOVINE 1 X RUMSTEC le lecteur a
// rendu 11128663 — code partiel, inconnu de notre base ET d'Open Food Facts —
// alors que l'étiquette porte 2250328887977. « ✓ C'est bien ça » aurait créé
// une fiche fantôme. Quand personne ne connaît le code (« aucune info »), il
// faut donc une SECONDE LECTURE IDENTIQUE avant de pouvoir créer.
export const AVERTISSEMENT_AUCUNE_INFO = 'Produit inconnu partout. Vérifie que le code affiché est bien celui imprimé sous les barres du produit.';

export function doubleLectureRequise(recherche) {
  return recherche?.statut === RECHERCHE_INCONNU && recherche?.fiche?.source === SOURCE_AUCUNE;
}
export const PHRASE_ENGAGEMENT = 'Vérifie bien : chaque produit confirmé aide tout le monde à comparer juste.';

// File des lignes à identifier, dans l'ordre du ticket, en commençant par la
// ligne choisie puis en bouclant (les lignes d'avant passent en dernier).
export function fileDepuis(lignes, ligneDepartId) {
  const aFaire = trierLignesTicket(lignes).filter(estAIdentifier);
  const i = aFaire.findIndex(l => l.id === ligneDepartId);
  return i <= 0 ? aFaire : [...aFaire.slice(i), ...aFaire.slice(0, i)];
}

export function creerParcoursIdentification({
  lignes, ligneDepartId = null, deps, onChange = () => {},
  attendre = (ms) => new Promise(r => setTimeout(r, ms)),
  journal = console,
}) {
  let file = fileDepuis(lignes, ligneDepartId);
  let etat = {
    phase: file.length ? PHASE_CAMERA : PHASE_FIN,
    ligne: file[0] || null,
    recherche: null,
    message: null,
    confirmes: 0,
    passees: 0,            // lignes laissées SANS marquage (RPC en échec) : restent à identifier
    sansCode: 0,           // lignes marquées « Pas de code-barres » : sortent des compteurs
    refus: 0,
    annulable: null,       // { ligneId, libelle } — 8 s, géré par l'écran
    complet: file.length === 0,
    // Cas « aucune info » : { code, relu } — relu = seconde lecture identique.
    doubleLecture: null,
    attenteRelecture: false, // caméra rouverte pour relire le même code
  };
  // Incrémenté à chaque changement de ligne imposé (annulation) : une pause
  // de ✓ animé en cours ne doit pas ensuite faire avancer la mauvaise ligne.
  let version = 0;

  const publier = (patch) => {
    etat = { ...etat, ...patch };
    onChange(etat);
    return etat;
  };

  const restantes = () => file.length;
  // « LIGNE n / N » : N = lignes encore concernées par le scan (restantes +
  // déjà confirmées + laissées sans marquage). Une ligne marquée « Pas de
  // code-barres » en sort : elle n'est plus à identifier.
  const position = () => {
    const total = file.length + etat.confirmes + etat.passees;
    return { rang: Math.min(Math.max(1, etat.confirmes + etat.passees + 1), Math.max(1, total)), total };
  };
  let marquageEnCours = false;

  // Ligne suivante, ou fin. complet = plus rien à identifier sur le ticket
  // (aucune ligne passée laissée en attente).
  const avancer = () => {
    if (file.length === 0) {
      return publier({ phase: PHASE_FIN, ligne: null, recherche: null, message: null, complet: etat.passees === 0, doubleLecture: null, attenteRelecture: false });
    }
    return publier({ phase: PHASE_CAMERA, ligne: file[0], recherche: null, message: null, doubleLecture: null, attenteRelecture: false });
  };

  return {
    etat: () => etat,
    position,
    restantes,
    prixLigne: () => prixArticle(etat.ligne),
    texteCaisse: () => titreLigneInconnue(etat.ligne),

    // Code lu par la caméra : RECHERCHE SEULE.
    async codeLu(codeBrut) {
      if (etat.phase !== PHASE_CAMERA || !etat.ligne) return etat;
      const ligne = etat.ligne;
      // Relecture demandée : même code -> la création devient possible, sans
      // nouvel appel réseau ; code différent -> on repart sur la fiche du
      // nouveau code (recherche normale ci-dessous).
      if (etat.attenteRelecture && etat.recherche && etat.doubleLecture) {
        const identique = normaliserCode(codeBrut) === etat.doubleLecture.code;
        try { journal?.info?.(`[C119] double lecture — ${identique ? 'identique' : 'différente'} — ${etat.doubleLecture.code} / ${normaliserCode(codeBrut)}`); } catch { /* jamais bloquant */ }
        if (identique) {
          return publier({ phase: PHASE_VERIFICATION, attenteRelecture: false, doubleLecture: { ...etat.doubleLecture, relu: true }, message: null });
        }
      }
      publier({ phase: PHASE_RECHERCHE, message: null, annulable: null, attenteRelecture: false, doubleLecture: null });
      let recherche;
      try {
        recherche = await rechercherScanLigne({ ligne, codeBrut, deps, photoPourConnu: true });
      } catch {
        recherche = { statut: 'erreur', message: 'Recherche impossible, réessaie.' };
      }
      if (etat.ligne !== ligne) return etat; // ligne changée entre-temps
      if (recherche.statut === RECHERCHE_CONNU || recherche.statut === RECHERCHE_INCONNU) {
        return publier({
          phase: PHASE_VERIFICATION,
          recherche,
          doubleLecture: doubleLectureRequise(recherche) ? { code: recherche.code, relu: false } : null,
        });
      }
      return publier({ phase: PHASE_REFUS, recherche, message: recherche.message });
    },

    // « ✓ C'est bien ça » — SEUL geste qui écrit.
    async confirmer() {
      if (etat.phase !== PHASE_VERIFICATION || !etat.recherche) return etat;
      // « aucune info » : PAS d'écriture sans seconde lecture identique.
      if (doubleLectureRequise(etat.recherche) && !(etat.doubleLecture?.relu === true && etat.doubleLecture.code === etat.recherche.code)) {
        return etat;
      }
      const ligne = etat.ligne;
      const recherche = etat.recherche;
      publier({ phase: PHASE_ECRITURE, message: null });
      let r;
      try {
        r = await ecrireScanLigne({ ligne, recherche, deps });
      } catch {
        r = { ecrit: false, message: 'Enregistrement impossible, réessaie.' };
      }
      if (!r?.ecrit) {
        // Rien d'écrit : retour sur la même fiche, avec le message.
        return publier({ phase: PHASE_VERIFICATION, message: r?.message || 'Indisponible pour le moment.' });
      }
      file = file.filter(l => l.id !== ligne.id);
      const libelle = libelleProduitCree({ variante: r.variante || recherche.variante, off: recherche.off, ligne })
        || recherche.fiche?.nom || titreLigneInconnue(ligne);
      publier({
        phase: PHASE_SUCCES,
        confirmes: etat.confirmes + 1,
        annulable: { ligneId: ligne.id, libelle, ligne },
        dernierResultat: r,
      });
      const v = version;
      await attendre(DUREE_SUCCES_MS);
      if (v !== version || etat.phase !== PHASE_SUCCES) return etat;
      return avancer();
    },

    // « ✗ Ce n'est pas ça » — rien n'est écrit, caméra rouverte sur la MÊME ligne.
    refuser() {
      if (etat.phase !== PHASE_VERIFICATION) return etat;
      try {
        journal?.info?.(`[C119] refus — ${etat.recherche?.code ?? '?'} — ${titreLigneInconnue(etat.ligne)}`);
      } catch { /* jamais bloquant */ }
      return publier({ phase: PHASE_CAMERA, recherche: null, message: null, refus: etat.refus + 1, doubleLecture: null, attenteRelecture: false });
    },

    // « Rescanner pour confirmer » (cas « aucune info ») : caméra rouverte sur
    // la même ligne, en attente du MÊME code. Rien n'est écrit.
    rescannerPourConfirmer() {
      if (etat.phase !== PHASE_VERIFICATION || !etat.doubleLecture || etat.doubleLecture.relu) return etat;
      return publier({ phase: PHASE_CAMERA, attenteRelecture: true, message: `Relis le même code pour confirmer : ${etat.doubleLecture.code}` });
    },

    // Écran de refus (poids variable, archivé, erreur) : autre code, même ligne.
    scannerAutre() {
      if (etat.phase !== PHASE_REFUS && etat.phase !== PHASE_VERIFICATION) return etat;
      return publier({ phase: PHASE_CAMERA, recherche: null, message: null, doubleLecture: null, attenteRelecture: false });
    },

    // « Passer cette ligne » — rien d'écrit, ligne suivante.
    passer() {
      if (!etat.ligne || etat.phase === PHASE_ECRITURE || etat.phase === PHASE_SUCCES) return etat;
      const id = etat.ligne.id;
      file = file.filter(l => l.id !== id);
      publier({ passees: etat.passees + 1 });
      return avancer();
    },

    // « Pas de code-barres (vrac, boucherie…) » : marque la ligne en base puis
    // enchaîne. RPC en échec -> message court, on enchaîne QUAND MÊME, sans
    // marquer (la ligne reste à identifier, le ticket n'est donc pas complet).
    async sansCodeBarres() {
      if (!etat.ligne || marquageEnCours) return etat;
      if (![PHASE_CAMERA, PHASE_VERIFICATION, PHASE_REFUS].includes(etat.phase)) return etat;
      const ligne = etat.ligne;
      marquageEnCours = true;
      let r;
      try {
        r = await marquerSansCodeBarres({ ligneId: ligne.id, valeur: true, deps });
      } finally {
        marquageEnCours = false;
      }
      if (etat.ligne !== ligne) return etat;
      file = file.filter(l => l.id !== ligne.id);
      publier(r.ok ? { sansCode: etat.sansCode + 1 } : { passees: etat.passees + 1 });
      avancer();
      if (!r.ok) publier({ message: `Ligne non marquée (${r.message}) — elle reste à identifier.` });
      return etat;
    },

    // La croix : FERMER n'est pas PASSER. Aucun appel, aucun changement
    // d'état ; on rend seulement le bilan à l'écran appelant.
    fermer() {
      return { confirmes: etat.confirmes, sansCode: etat.sansCode, passees: etat.passees };
    },

    // Fin des 8 s : le bouton disparaît, rien d'autre.
    expirerAnnulation() {
      return etat.annulable ? publier({ annulable: null }) : etat;
    },

    // « ↩ Annuler » (en-tête) : annuler_scan_ligne_ticket. Succès -> la ligne
    // revient en tête de file et la caméra se rouvre dessus. Échec -> message,
    // rien ne bouge.
    async annuler() {
      const a = etat.annulable;
      if (!a) return { ok: false, message: null };
      const r = await annulerScanLigne({ ligneId: a.ligneId, deps: { annuler: deps.annuler } });
      if (!r.ok) {
        publier({ message: r.message });
        return r;
      }
      version += 1;
      const ligne = ligneApresAnnulation(a.ligne);
      file = [ligne, ...file.filter(l => l.id !== ligne.id)];
      publier({
        annulable: null,
        confirmes: Math.max(0, etat.confirmes - 1),
        phase: PHASE_CAMERA,
        ligne,
        recherche: null,
        complet: false,
        doubleLecture: null,
        attenteRelecture: false,
        message: `↩ Annulé : ${a.libelle} — rescanne le bon produit.`,
      });
      return r;
    },
  };
}
