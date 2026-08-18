// Chantier 106 « Module de contribution aux codes-barres », LOT A — ARBITRAGE
// du parcours, sorti de React exprès.
//
// Pourquoi un module à part : la seule chose qui compte vraiment ici, c'est
// « à quel moment une proposition est-elle créée, et à quel moment ne l'est-elle
// PAS ». Tant que cette décision vivait dans des gestionnaires de clic au
// milieu du rendu, on ne pouvait que la relire et espérer. Ici elle est
// exécutable, donc vérifiable : les tests appellent ces fonctions et comptent
// les envois réellement déclenchés.
//
// Règle qui gouverne le fichier : `renoncer()` n'appelle JAMAIS
// envoyerProposition, quel que soit le rôle de l'utilisateur. C'est la même
// promesse que côté administrateur — « Je vérifie l'emballage » veut dire que
// rien n'est parti.
import { verifierCoherenceCodeBarres, NIVEAU_AVERTISSEMENT } from './coherenceCodeBarres';

export const SORTIE_AVERTIR = 'avertir';
export const SORTIE_ENVOI = 'envoi';
export const SORTIE_REFUS_FICHE = 'refus_fiche';
export const SORTIE_RIEN = 'rien';

// Un code-barres désigne toujours UN format précis. Une fiche sans variante
// active (vrac, frais) n'en a aucun : la proposition serait typée
// « nouveau_produit », que valider_proposition_code_barres ne sait pas encore
// traiter. On le dit plutôt que d'envoyer une proposition invalidable.
export const MESSAGE_FICHE_SANS_FORMAT =
  "Cette fiche n'a aucun format enregistré — un code-barres désigne un format précis. Choisis une autre fiche.";

// Le lien discret sous « Je vérifie l'emballage ». Il existe pour TOUT LE
// MONDE : dans ce parcours, aucune des deux branches n'écrit dans la base, la
// seule différence est qu'un désaccord signalé part quand même en file. Seuls
// les mots changent selon qui regarde l'écran.
export function libelleEnvoyerQuandMeme(estAdmin) {
  return estAdmin
    ? "C'est bien ça, proposer quand même"
    : 'Envoyer quand même, François tranchera';
}

// `envoyerProposition(parametres)` est le SEUL chemin vers une écriture. Le
// parcours ne l'appelle qu'à deux endroits, et les tests le remplacent par un
// espion pour compter les envois.
export function creerParcoursContribution({ envoyerProposition }) {
  // Écriture mise en pause en attendant l'arbitrage de l'utilisateur.
  let enAttente = null;

  // La fiche du catalogue vient d'être choisie. Le garde-fou du 105 s'intercale
  // ici : soit il n'a rien à dire et la proposition part, soit il montre la
  // confrontation et RIEN ne part avant que l'utilisateur ait tranché.
  //
  // Un garde-fou qui plante serait pire que pas de garde-fou : toute exception
  // inattendue le rend muet et laisse passer la proposition.
  const choisirFiche = async ({ code, off, statutOff, varianteId, nomProduit, fiche }) => {
    if (!varianteId) return { sortie: SORTIE_REFUS_FICHE, message: MESSAGE_FICHE_SANS_FORMAT };

    let verdict = null;
    try {
      verdict = verifierCoherenceCodeBarres({ statutOff, off, fiche });
    } catch (e) {
      console.error('[contribution] garde-fou code-barres :', e);
      verdict = null;
    }

    const parametres = { code, off, statutOff, varianteId, nomProduit };
    if (verdict?.niveau === NIVEAU_AVERTISSEMENT) {
      enAttente = { verdict, nomProduit, code, parametres };
      return { sortie: SORTIE_AVERTIR, avertissement: enAttente };
    }
    return { sortie: SORTIE_ENVOI, retour: await envoyerProposition(parametres) };
  };

  // « Je vérifie l'emballage ». Aucune proposition n'est créée, pour personne :
  // c'est exactement la même promesse que côté administrateur. La fonction est
  // synchrone et n'a aucun accès à envoyerProposition dans son corps — c'est
  // volontaire, et c'est ce que vérifie le test.
  const renoncer = () => {
    const avaitUnAvertissement = enAttente !== null;
    enAttente = null;
    return { sortie: SORTIE_RIEN, avaitUnAvertissement };
  };

  // « Envoyer quand même » / « proposer quand même ». On rejoue l'écriture mise
  // en pause, telle quelle, et on rend le verdict pour que l'écran de retour
  // puisse rappeler ce qui avait été signalé.
  const envoyerQuandMeme = async () => {
    if (!enAttente) return { sortie: SORTIE_RIEN, avaitUnAvertissement: false };
    const { parametres, verdict } = enAttente;
    enAttente = null;
    // Le verdict voyage avec l'envoi : l'écran de retour doit pouvoir rappeler
    // ce qui avait été signalé, sinon l'utilisateur a validé un avertissement
    // qui disparaît sans laisser de trace.
    return { sortie: SORTIE_ENVOI, verdict, retour: await envoyerProposition({ ...parametres, verdict }) };
  };

  return { choisirFiche, renoncer, envoyerQuandMeme, avertissementEnCours: () => enAttente };
}
