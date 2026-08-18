// Chantier 106 « Module de contribution aux codes-barres », LOT A — écran
// ADMIN « Codes-barres à valider ».
//
// Volontairement SÉPARÉ de « 🔍 À valider », qui reste la file des lignes de
// ticket : ce sont deux gestes différents (rattacher une ligne d'achat vs
// attribuer un code-barres à un format), et les mélanger ferait perdre le
// contexte de chacun.
//
// Ce que François voit : ce que dit OpenFoodFacts du code à gauche, la fiche
// visée à droite — la même confrontation côte à côte que l'avertissement du
// 105, parce qu'elle marche. La décision se prend en regardant les deux
// colonnes, pas en faisant confiance à l'auteur de la proposition.
//
// Écritures : uniquement valider_proposition_code_barres (qui écrit le code et
// crédite 10 points) et refuser_proposition_code_barres. Aucune écriture
// directe sur codes_barres_variante depuis cet écran.

import { Component, useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { cloudinaryFetch } from '../../lib/photosProduits';
import { ColonneIdentite } from '../CartesScanCodeBarres';
import { texteQuantiteFiche } from '../../lib/coherenceCodeBarres';

const F = "'Nunito',sans-serif";

// Une carte qui plante (donnée inattendue) ne doit jamais faire disparaître
// toute la file : seule cette carte est remplacée.
class CarteErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error) { console.error('[PropositionsCodesBarresSheet] rendu d\'une proposition en échec :', error); }
  render() {
    if (this.state.crashed) {
      return (
        <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, fontFamily: F, fontSize: 12, color: '#CC0000' }}>
          ⚠️ Erreur d'affichage pour cette proposition (donnée inattendue) — le reste de la liste n'est pas affecté.
        </div>
      );
    }
    return this.props.children;
  }
}

function formatDateFr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function messageErreurRpc(error) {
  const brut = error?.message || '';
  if (/not find the function|schema cache/i.test(brut)) {
    return 'Fonction introuvable côté API — cache de schéma PostgREST à recharger.';
  }
  return brut || 'Action impossible, réessaie.';
}

// numeric PostgREST arrive en string : on repasse par Number avant d'afficher,
// sinon « 500.000 g ».
function texteQuantitePlate(quantite, unite) {
  const n = Number(quantite);
  if (!Number.isFinite(n) || !unite) return null;
  return `${n} ${unite}`;
}

function PropositionCard({ p, pseudo, ficheDuCode, enCours, erreurAction, onValider, onRefuser }) {
  const [motifOuvert, setMotifOuvert] = useState(false);
  const [motif, setMotif] = useState('');

  const photo = cloudinaryFetch(p.off_photo_url, 'thumb') || p.off_photo_url || null;
  const quantiteOff = texteQuantitePlate(p.off_quantite, p.off_unite);
  const quantiteFiche = texteQuantiteFiche({
    quantite_nette: p.fiche_quantite,
    unite_quantite: p.fiche_unite,
    nombre_unites: p.fiche_nombre_unites,
  });

  // Le code a pu être attribué à une AUTRE fiche entre la proposition et
  // maintenant. On le dit AVANT le clic : valider ici ne créerait rien, la
  // base refuserait la proposition d'elle-même, et François aurait cru
  // trancher alors qu'il n'a fait que constater.
  const conflit = p.code_deja_pris_par && p.code_deja_pris_par !== p.variante_produit_id;

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontFamily: F, fontSize: 11, color: '#999' }}>
        {formatDateFr(p.cree_le)} · proposé par {pseudo || 'un utilisateur'}
        {p.origine ? ` · ${p.origine}` : ''}
      </div>
      <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginTop: 4 }}>
        {p.code_barres}
      </div>

      {conflit && (
        <div style={{ marginTop: 10, padding: 10, background: '#FFF3F3', border: '1px solid #F3C5C5', borderRadius: 10, fontFamily: F, fontSize: 12, fontWeight: 800, color: '#CC0000', lineHeight: 1.5 }}>
          ⚠️ Ce code appartient déjà à une autre fiche{ficheDuCode ? ` : « ${ficheDuCode} »` : ''}.
          <div style={{ fontWeight: 600, color: '#666', marginTop: 4 }}>
            Valider ne l'écrira pas : la proposition sera refusée automatiquement.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'stretch' }}>
        <ColonneIdentite
          etiquette="OPEN FOOD FACTS DIT"
          nom={p.off_nom}
          marque={p.off_marque}
          quantiteTexte={quantiteOff}
          fond="#F5F6F8"
          photoUrl={photo}
        />
        <ColonneIdentite
          etiquette="LA FICHE VISÉE"
          nom={p.fiche_nom}
          marque={p.fiche_marque}
          quantiteTexte={quantiteFiche}
          fond="#F0F7FF"
        />
      </div>

      {!p.off_nom && !p.off_marque && !photo && (
        <div style={{ marginTop: 8, fontFamily: F, fontSize: 11, color: '#999', lineHeight: 1.4 }}>
          Open Food Facts n'avait rien sur ce code au moment du scan — seule la fiche visée est vérifiable.
        </div>
      )}

      {erreurAction && (
        <div style={{ marginTop: 10, fontFamily: F, fontSize: 12, color: '#CC0000', lineHeight: 1.4 }}>⚠️ {erreurAction}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={onValider}
          disabled={enCours}
          style={{ flex: 1, padding: 12, border: 'none', borderRadius: 10, fontFamily: F, fontWeight: 900, fontSize: 13, color: '#fff', background: enCours ? '#ccc' : '#00B341', cursor: enCours ? 'default' : 'pointer' }}
        >
          {enCours ? '...' : '✓ Valider'}
        </button>
        <button
          onClick={() => setMotifOuvert(o => !o)}
          disabled={enCours}
          style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 10, fontFamily: F, fontWeight: 800, fontSize: 13, color: '#CC0000', background: 'transparent', cursor: enCours ? 'default' : 'pointer' }}
        >
          Refuser
        </button>
      </div>

      {motifOuvert && (
        <div style={{ marginTop: 10 }}>
          <input
            value={motif}
            onChange={e => setMotif(e.target.value)}
            placeholder="Motif (facultatif)"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '2px solid #F5F6F8', fontFamily: F, fontSize: 13, color: '#1a1a1a', outline: 'none', boxSizing: 'border-box' }}
          />
          <button
            onClick={() => onRefuser(motif)}
            disabled={enCours}
            style={{ width: '100%', marginTop: 8, padding: 12, border: 'none', borderRadius: 10, fontFamily: F, fontWeight: 900, fontSize: 13, color: '#fff', background: enCours ? '#ccc' : '#CC0000', cursor: enCours ? 'default' : 'pointer' }}
          >
            {enCours ? '...' : 'Confirmer le refus'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function PropositionsCodesBarresSheet({ onClose, onCountChange }) {
  const [propositions, setPropositions] = useState([]);
  const [pseudos, setPseudos] = useState({});          // uuid auteur -> pseudo
  const [fichesDuCode, setFichesDuCode] = useState({}); // uuid variante -> libellé
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [message, setMessage] = useState(null);
  const [enCoursParId, setEnCoursParId] = useState({});
  const [erreurActionParId, setErreurActionParId] = useState({});

  const afficherMessage = (texte) => {
    setMessage(texte);
    setTimeout(() => setMessage(null), 4000);
  };

  // Enrichissements d'affichage (pseudo de l'auteur, nom de la fiche qui
  // détient déjà le code). Strictement best effort : la RPC ne renvoie que des
  // identifiants, et un échec ici ne doit jamais empêcher de trancher.
  const enrichir = useCallback(async (lignes) => {
    const idsAuteurs = [...new Set(lignes.map(l => l.propose_par).filter(Boolean))];
    const idsVariantes = [...new Set(lignes.map(l => l.code_deja_pris_par).filter(Boolean))];

    if (idsAuteurs.length > 0) {
      try {
        const { data } = await supabase.from('profiles').select('id, pseudo').in('id', idsAuteurs);
        if (data) setPseudos(Object.fromEntries(data.map(p => [p.id, p.pseudo])));
      } catch (e) {
        console.error('[PropositionsCodesBarresSheet] pseudos :', e);
      }
    }
    if (idsVariantes.length > 0) {
      try {
        const { data } = await supabase
          .from('variantes_produit')
          .select('id, quantite_nette, unite_quantite, produits(nom_reference), marques(nom)')
          .in('id', idsVariantes);
        if (data) {
          setFichesDuCode(Object.fromEntries(data.map(v => [
            v.id,
            [v.produits?.nom_reference, v.marques?.nom, texteQuantitePlate(v.quantite_nette, v.unite_quantite)]
              .filter(Boolean).join(' · '),
          ])));
        }
      } catch (e) {
        console.error('[PropositionsCodesBarresSheet] fiches en conflit :', e);
      }
    }
  }, []);

  const charger = useCallback(async ({ avecSpinner = true } = {}) => {
    if (avecSpinner) setChargement(true);
    setErreur(null);
    try {
      const { data, error } = await supabase.rpc('lister_propositions_codes_barres_en_attente');
      if (error) {
        setErreur(messageErreurRpc(error));
        return;
      }
      const lignes = data || [];
      setPropositions(lignes);
      onCountChange?.(lignes.length);
      enrichir(lignes);
    } catch (e) {
      console.error('[PropositionsCodesBarresSheet] chargement :', e);
      setErreur('Chargement impossible, réessaie.');
    } finally {
      setChargement(false);
    }
  }, [enrichir, onCountChange]);

  useEffect(() => { charger(); }, [charger]);

  const retirer = (id) => {
    setPropositions(prev => {
      const restantes = prev.filter(p => p.id !== id);
      onCountChange?.(restantes.length);
      return restantes;
    });
  };

  const valider = async (p) => {
    setEnCoursParId(prev => ({ ...prev, [p.id]: true }));
    setErreurActionParId(prev => ({ ...prev, [p.id]: null }));
    try {
      const { data, error } = await supabase.rpc('valider_proposition_code_barres', { p_proposition_id: p.id });
      if (error) {
        setErreurActionParId(prev => ({ ...prev, [p.id]: messageErreurRpc(error) }));
        return;
      }
      retirer(p.id);
      // La base peut refuser d'elle-même : le code avait été attribué entre
      // temps. Ce n'est pas un succès, on ne l'annonce pas comme tel.
      afficherMessage(data?.resultat === 'conflit'
        ? `⚠️ ${p.code_barres} appartenait déjà à une autre fiche — proposition refusée automatiquement`
        : `✓ ${p.code_barres} appris sur « ${p.fiche_nom || 'la fiche visée'} » — 10 points crédités`);
    } catch (e) {
      console.error('[PropositionsCodesBarresSheet] valider :', e);
      setErreurActionParId(prev => ({ ...prev, [p.id]: 'Validation impossible, réessaie.' }));
    } finally {
      setEnCoursParId(prev => ({ ...prev, [p.id]: false }));
    }
  };

  const refuser = async (p, motif) => {
    setEnCoursParId(prev => ({ ...prev, [p.id]: true }));
    setErreurActionParId(prev => ({ ...prev, [p.id]: null }));
    try {
      const { error } = await supabase.rpc('refuser_proposition_code_barres', {
        p_proposition_id: p.id,
        p_motif: (motif || '').trim() || null,
      });
      if (error) {
        setErreurActionParId(prev => ({ ...prev, [p.id]: messageErreurRpc(error) }));
        return;
      }
      retirer(p.id);
      afficherMessage(`Proposition refusée pour ${p.code_barres}`);
    } catch (e) {
      console.error('[PropositionsCodesBarresSheet] refuser :', e);
      setErreurActionParId(prev => ({ ...prev, [p.id]: 'Refus impossible, réessaie.' }));
    } finally {
      setEnCoursParId(prev => ({ ...prev, [p.id]: false }));
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#F5F6F8', zIndex: 400, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#1a1a1a', color: '#fff', padding: '16px 20px calc(12px + env(safe-area-inset-top, 0px))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 16 }}>🏷️ Codes-barres à valider</div>
          <div style={{ fontFamily: F, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            {propositions.length} en attente
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 99, width: 30, height: 30, color: '#fff', fontSize: 15, cursor: 'pointer' }}>✕</button>
      </div>

      {message && (
        <div style={{ background: '#00B341', color: '#fff', padding: '10px 20px', fontFamily: F, fontWeight: 800, fontSize: 12, textAlign: 'center', flexShrink: 0, lineHeight: 1.4 }}>
          {message}
        </div>
      )}

      <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, padding: '14px 14px calc(14px + env(safe-area-inset-bottom, 0px))' }}>
        {chargement && (
          <div style={{ textAlign: 'center', padding: '30px 0', fontFamily: F, fontSize: 13, color: '#888' }}>Chargement...</div>
        )}
        {erreur && (
          <div style={{ fontFamily: F, fontSize: 13, color: '#CC0000', padding: '12px 0' }}>⚠️ {erreur}</div>
        )}
        {/* Liste vide : ce n'est pas une anomalie, c'est le cas normal la
            plupart du temps. Ton calme, aucun écran d'erreur. */}
        {!chargement && !erreur && propositions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 0', fontFamily: F, fontSize: 13, color: '#888' }}>
            Aucune proposition en attente.
          </div>
        )}

        {propositions.map(p => (
          <CarteErrorBoundary key={p.id}>
            <PropositionCard
              p={p}
              pseudo={pseudos[p.propose_par]}
              ficheDuCode={fichesDuCode[p.code_deja_pris_par]}
              enCours={!!enCoursParId[p.id]}
              erreurAction={erreurActionParId[p.id]}
              onValider={() => valider(p)}
              onRefuser={(motif) => refuser(p, motif)}
            />
          </CarteErrorBoundary>
        ))}
      </div>
    </div>
  );
}
