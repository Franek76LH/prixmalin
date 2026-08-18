// Chantier 106 « Module de contribution aux codes-barres », LOT A — parcours
// UTILISATEUR, ouvert depuis la carte « Complète la base » de l'accueil.
//
// Ce que fait cet écran : on scanne un produit du placard ou du rayon, on
// demande à OpenFoodFacts à quoi ce code correspond, l'utilisateur choisit la
// fiche du catalogue qu'il désigne, et la proposition part dans une file que
// François tranche. Rien n'est JAMAIS écrit dans codes_barres_variante ici :
// la seule écriture possible est une ligne dans propositions_codes_barres,
// entièrement réversible.
//
// Le parcours est volontairement le MÊME que celui du scan d'un code inconnu
// depuis un ticket (chantiers 103 puis 105) : mêmes cartes, même garde-fou,
// mêmes mots. Elles sont importées, pas recopiées (CartesScanCodeBarres).
//
// L'écran d'avertissement du 105 a ici DEUX sorties, pour tout le monde :
//   - « Je vérifie l'emballage » : rien n'est envoyé, aucune proposition n'est
//     créée. Même promesse que côté administrateur.
//   - « Envoyer quand même » : la proposition part en file de validation.
// passerOutreAutorise ne gouverne rien dans cet écran, et c'est normal : il
// décide qui peut ÉCRIRE malgré un désaccord (AValiderSheet), or ici aucune
// des deux branches n'écrit — la seule différence entre un administrateur et
// un contributeur tient aux mots du lien discret.
import { useCallback, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import BarcodeScannerSheet from './BarcodeScannerSheet';
import RechercheProduitSheet from './admin/RechercheProduitSheet';
import { AssistantOffCard, AvertissementCoherenceCard, ColonneIdentite } from './CartesScanCodeBarres';
import { ficheOFFAvecStatut } from '../lib/photosProduits';
import { termesRechercheOff } from '../lib/rechercheRepli';
import {
  texteQuantiteFiche,
  OFF_INCONNU,
  OFF_INDISPONIBLE,
} from '../lib/coherenceCodeBarres';
import {
  creerParcoursContribution,
  libelleEnvoyerQuandMeme,
  SORTIE_AVERTIR,
  SORTIE_REFUS_FICHE,
} from '../lib/parcoursContributionCodesBarres';
import {
  chargeOffProposition,
  messageRetourProposition,
  messageErreurProposition,
  ORIGINE_SCAN_LIBRE,
  RETOUR_DEJA_CONNU,
} from '../lib/contributionCodesBarres';

const F = "'Nunito',sans-serif";

// Note affichée à la place de l'identité OpenFoodFacts quand il n'y en a pas.
// Les deux cas sont distincts et n'appellent pas la même phrase, mais ils
// finissent au même endroit : personne ne peut vérifier à la place de
// l'utilisateur, donc on le lui dit au lieu de laisser un blanc rassurant.
function noteOffAbsent(statutOff) {
  if (statutOff === OFF_INCONNU) {
    return "Open Food Facts ne connaît pas ce code-barres : personne ne peut vérifier à ta place, vérifie l'emballage avant de choisir la fiche.";
  }
  if (statutOff === OFF_INDISPONIBLE) {
    return "Open Food Facts n'a pas répondu : personne ne peut vérifier à ta place, vérifie l'emballage avant de choisir la fiche.";
  }
  return "Aucune information extérieure sur ce code : personne ne peut vérifier à ta place, vérifie l'emballage avant de choisir la fiche.";
}

const COULEUR_TON = { succes: '#00B341', neutre: '#1a1a1a', erreur: '#CC0000' };

// Écran de retour. Il porte parfois EN PLUS la confrontation côte à côte : cas
// d'un non-administrateur dont la fiche choisie ne concorde pas avec ce que
// dit OFF. Sa proposition part quand même (elle n'écrit rien), mais lui cacher
// le désaccord reviendrait à lui faire signer sans lire.
function ResultatCard({ resultat, onRescanner, onFermer }) {
  const { ton, titre, detail, verdict, nomProduit, code } = resultat;
  const couleur = COULEUR_TON[ton] || '#1a1a1a';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 565, display: 'flex', alignItems: 'flex-end' }} onClick={onFermer}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <div style={{ fontFamily: F, fontWeight: 900, fontSize: 18, color: couleur }}>{titre}</div>
        <div style={{ fontFamily: F, fontSize: 13, color: '#666', marginTop: 6, lineHeight: 1.5 }}>{detail}</div>
        {code && (
          <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 6 }}>Code : {code}</div>
        )}

        {verdict && (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'stretch' }}>
              <ColonneIdentite
                etiquette="LE CODE DÉSIGNE (OFF)"
                nom={verdict.off?.nom}
                marque={verdict.off?.marque}
                quantiteTexte={verdict.off?.quantite}
                fond="#FFF3F3"
              />
              <ColonneIdentite
                etiquette="LA FICHE CHOISIE"
                nom={nomProduit || verdict.fiche?.nomProduit}
                marque={verdict.fiche?.marque}
                quantiteTexte={texteQuantiteFiche(verdict.fiche)}
                fond="#F5F6F8"
              />
            </div>
            <div style={{ marginTop: 10, padding: 12, background: '#FFF8E1', border: '1px solid #F0DFA0', borderRadius: 10, fontFamily: F, fontSize: 12, color: '#7A6000', lineHeight: 1.5 }}>
              ⚠️ Ces deux descriptions ne concordaient pas, et tu as choisi d'envoyer quand même. François tranchera ; rien n'a été écrit dans la base. Si tu vois que tu t'es trompé, rescanne et propose la bonne fiche.
            </div>
          </>
        )}

        <button
          onClick={onRescanner}
          style={{ width: '100%', marginTop: 16, padding: 14, border: 'none', borderRadius: 12, background: '#00B341', color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}
        >
          📷 Scanner un autre produit
        </button>
        <button
          onClick={onFermer}
          style={{ width: '100%', marginTop: 8, padding: 12, border: '1px solid #ddd', borderRadius: 12, background: 'transparent', color: '#333', fontFamily: F, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

export default function ContributionCodeBarresSheet({ estAdmin = false, onClose }) {
  // La caméra s'ouvre tout de suite : la carte d'accueil a déjà servi de
  // bouton, un deuxième écran intermédiaire ne dirait rien de plus.
  const [scannerOuvert, setScannerOuvert] = useState(true);
  const [chargement, setChargement] = useState(null);
  const [assistant, setAssistant] = useState(null);       // { code, off, statutOff }
  const [recherche, setRecherche] = useState(false);
  const [avertissement, setAvertissement] = useState(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [resultat, setResultat] = useState(null);

  // Le parcours (garde-fou + arbitrage) vit hors de React : c'est lui qui
  // décide quand une proposition est créée, et c'est lui que les tests
  // exercent. Créé une seule fois — `envoyer` ne lit aucun état, tous ses
  // paramètres lui sont passés explicitement.
  const parcours = useRef(null);
  if (parcours.current === null) {
    parcours.current = creerParcoursContribution({ envoyerProposition: (p) => envoyer(p) });
  }

  const rescanner = () => {
    setResultat(null);
    setAssistant(null);
    setAvertissement(null);
    setRecherche(false);
    setScannerOuvert(true);
  };

  // Étape 1 — code lu. Aucune écriture ici, pas même une proposition : on
  // cherche seulement à quoi ce code correspond.
  const onCodeDetecte = useCallback(async (codeBrut) => {
    setScannerOuvert(false);
    const code = (codeBrut || '').replace(/\s+/g, '').trim();
    if (!code) {
      setResultat({ ton: 'erreur', titre: 'Code illisible', detail: "Le code-barres n'a pas été lu, réessaie." });
      return;
    }

    setChargement('Lecture du code-barres...');
    try {
      // Pré-vérification « déjà connu », avec EXACTEMENT la règle de la RPC
      // (égalité stricte sur le code, sans variante UPC-A/EAN-13) : annoncer
      // « déjà connu » là où proposer_code_barres accepterait la proposition
      // priverait la base d'une contribution valable. Échec de lecture =
      // on continue, la RPC reste l'autorité.
      let dejaConnu = false;
      try {
        const { data, error } = await supabase
          .from('codes_barres_variante')
          .select('variante_produit_id')
          .eq('code_barres', code)
          .limit(1);
        dejaConnu = !error && Array.isArray(data) && data.length > 0;
      } catch (e) {
        console.error('[Contribution] pré-vérification du code :', e);
      }
      if (dejaConnu) {
        setResultat({ ...messageRetourProposition({ statut: RETOUR_DEJA_CONNU }), code });
        return;
      }

      // OpenFoodFacts : jamais bloquant. Réseau coupé, réponse illisible,
      // code absent de leur base -> on continue avec une identité vide et on
      // le dit sur la carte suivante.
      setChargement('Recherche du produit sur Open Food Facts...');
      let off = null;
      let statutOff = OFF_INDISPONIBLE;
      try {
        const r = await ficheOFFAvecStatut(code);
        off = r.fiche;
        statutOff = r.statut;
      } catch (e) {
        console.error('[Contribution] fiche Open Food Facts :', e);
        off = null;
        statutOff = OFF_INDISPONIBLE;
      }
      setAssistant({ code, off, statutOff });
    } finally {
      setChargement(null);
    }
  }, []);

  // LA seule écriture du parcours : une ligne dans propositions_codes_barres.
  // Retourne { ok, message } pour que RechercheProduitSheet puisse afficher
  // l'échec sans se refermer.
  const envoyer = async ({ code, off, statutOff, varianteId, nomProduit, verdict = null }) => {
    setEnvoiEnCours(true);
    try {
      const { data, error } = await supabase.rpc('proposer_code_barres', {
        p_code_barres: code,
        p_variante_produit_id: varianteId,
        p_off: chargeOffProposition({ off, statutOff }),
        p_origine: ORIGINE_SCAN_LIBRE,
        p_magasin_id: null,
      });
      if (error) {
        const message = messageErreurProposition(error);
        return { ok: false, message };
      }
      setRecherche(false);
      setAssistant(null);
      setAvertissement(null);
      setResultat({ ...messageRetourProposition(data), code, nomProduit, verdict });
      return { ok: true };
    } catch (e) {
      console.error('[Contribution] proposer_code_barres :', e);
      return { ok: false, message: 'Envoi impossible, réessaie.' };
    } finally {
      setEnvoiEnCours(false);
    }
  };

  // Étape 2 — l'utilisateur a choisi une fiche du catalogue. Le garde-fou du
  // 105 s'intercale ici, exactement comme sur le parcours ticket.
  // produitId est ignoré à dessein : proposer_code_barres retrouve le produit
  // à partir de la variante, et un code-barres n'a de sens que sur un format.
  const choisirFiche = async ({ varianteId, nomProduit, variante = null }) => {
    const a = assistant;
    if (!a) return { ok: false, message: 'Scan perdu, rescanne le produit.' };

    const res = await parcours.current.choisirFiche({
      code: a.code,
      off: a.off,
      statutOff: a.statutOff,
      varianteId,
      nomProduit,
      fiche: {
        nomProduit,
        marque: variante?.marques?.nom ?? null,
        libelleVariante: variante?.libelle ?? null,
        quantite_nette: variante?.quantite_nette ?? null,
        unite_quantite: variante?.unite_quantite ?? null,
        nombre_unites: variante?.nombre_unites ?? null,
      },
    });

    if (res.sortie === SORTIE_REFUS_FICHE) return { ok: false, message: res.message };

    if (res.sortie === SORTIE_AVERTIR) {
      // On referme la recherche et la carte OFF pour que l'avertissement soit
      // seul à l'écran. `ok: true` ne veut pas dire « envoyé » : il veut dire
      // « aucune erreur à afficher dans la feuille de recherche », qui peut
      // donc se fermer. Rien n'est parti tant que l'utilisateur n'a pas tranché.
      setRecherche(false);
      setAssistant(null);
      setAvertissement(res.avertissement);
      return { ok: true };
    }

    return res.retour;
  };

  // « Je vérifie l'emballage » — pour TOUT LE MONDE, administrateur ou non :
  // aucune proposition n'est créée, on le dit explicitement plutôt que de
  // refermer en silence.
  const renoncerApresAvertissement = () => {
    parcours.current.renoncer();
    setAvertissement(null);
    setResultat({
      ton: 'neutre',
      titre: "Rien n'a été envoyé",
      detail: "Vérifie l'emballage, puis rescanne le produit. Aucune proposition n'a été créée.",
    });
  };

  // « Envoyer quand même, François tranchera » — la proposition part en file.
  // Elle n'écrit toujours rien dans la base : c'est François qui tranche.
  const envoyerMalgreAvertissement = async () => {
    const res = await parcours.current.envoyerQuandMeme();
    if (res.retour?.ok) return; // envoyer() a déjà posé l'écran de retour
    setAvertissement(null);
    setResultat({
      ton: 'erreur',
      titre: 'Envoi impossible',
      detail: res.retour?.message || "Réessaie plus tard. Rien n'a été enregistré.",
    });
  };

  const abandonnerAssistant = () => {
    setAssistant(null);
    setRecherche(false);
    setResultat({
      ton: 'neutre',
      titre: "Rien n'a été envoyé",
      detail: "Tu peux rescanner ce produit ou en scanner un autre quand tu veux.",
    });
  };

  return (
    <>
      {scannerOuvert && (
        <BarcodeScannerSheet onDetected={onCodeDetecte} onClose={() => { setScannerOuvert(false); onClose?.(); }} />
      )}

      {chargement && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 550, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '16px 22px', fontFamily: F, fontSize: 13, fontWeight: 800, color: '#1a1a1a', textAlign: 'center', maxWidth: '80%' }}>
            {chargement}
          </div>
        </div>
      )}

      {/* Carte « Ce produit ? » du chantier 103, réutilisée telle quelle.
          Quand OFF n'a rien à dire, elle affiche la note honnête plutôt qu'un
          bloc d'identité vide — et le parcours continue quand même. */}
      {assistant && !recherche && (
        <AssistantOffCard
          assistant={assistant}
          enCours={envoiEnCours}
          sousTitre={assistant.off
            ? `Code inconnu de notre base · ${assistant.code} · fiche Open Food Facts`
            : `Code inconnu de notre base · ${assistant.code}`}
          noteOff={assistant.off ? null : noteOffAbsent(assistant.statutOff)}
          libelleNon="Ce n'est pas ça / je ne trouve pas"
          noteBas="Rien n'est écrit dans la base : ta proposition passe d'abord par une validation."
          onOuiChoisir={() => setRecherche(true)}
          onCeNestPasCa={abandonnerAssistant}
          onFermer={abandonnerAssistant}
        />
      )}

      {/* Garde-fou du chantier 105, écran bloquant, au-dessus de tout le reste.
          Deux sorties pour TOUT LE MONDE : « Je vérifie l'emballage » (vert,
          mis en avant) n'envoie rien du tout, « Envoyer quand même » met la
          proposition en file. On avertit, on n'interdit pas — et on ne force
          pas non plus. `peutPasserOutre` est donc vrai ici quel que soit le
          rôle : aucune des deux branches n'écrit dans la base, seuls les mots
          du lien discret changent selon qui regarde. */}
      {avertissement && (
        <AvertissementCoherenceCard
          avertissement={avertissement}
          enCours={envoiEnCours}
          peutPasserOutre
          consequence="Si ce code part sur cette fiche et qu'il est validé, il rattachera cet article à cette fiche à chaque scan suivant. Une erreur se propage."
          noteVerifier="Rien n'est envoyé, aucune proposition n'est créée : tu pourras rescanner le produit."
          libellePasserOutre={libelleEnvoyerQuandMeme(estAdmin)}
          onVerifier={renoncerApresAvertissement}
          onApprendreQuandMeme={envoyerMalgreAvertissement}
        />
      )}

      {assistant && recherche && (
        <RechercheProduitSheet
          titre="Choisir la fiche du catalogue"
          sousTitre={[assistant.off?.marque, assistant.off?.nom, assistant.off?.quantite].filter(Boolean).join(' · ') || assistant.code}
          requeteInitiale={termesRechercheOff(assistant.off)}
          repliProgressif
          onClose={() => setRecherche(false)}
          onChoisir={choisirFiche}
        />
      )}

      {resultat && (
        <ResultatCard
          resultat={resultat}
          onRescanner={rescanner}
          onFermer={() => { setResultat(null); onClose?.(); }}
        />
      )}
    </>
  );
}
