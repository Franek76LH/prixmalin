// Chantier "Scan code-barres", bout 3B — console de validation admin.
// Liste les propositions_liaison_scan en attente (RPC
// lister_propositions_liaison_scan_en_attente, SECURITY DEFINER : la lecture
// directe de lignes_ticket d'un autre utilisateur est bloquée par sa RLS
// "lecture propre", donc pas d'embedding PostgREST possible ici — voir la
// migration 20260726150000). Confirmer rejoue relier_variante_scan_code_barres
// via valider_proposition_scan ; refuser ne touche à aucune donnée produit.
// Une fois traitée, une proposition disparaît de la liste (pas d'onglet
// "traitées" à ce stade).

import { Component, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { nomComposeVariante } from '../../lib/nomProduit';

const F = "'Nunito',sans-serif";

class LigneErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error) { console.error('[ValidationScanSheet] rendu d\'une proposition en échec :', error); }
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
  if (/not find the function|schema cache/i.test(error?.message || '')) {
    return "Fonction introuvable côté API — cache de schéma PostgREST à recharger.";
  }
  return error?.message || "Action impossible, réessaie.";
}

function PropositionCard({ p, enCours, erreurAction, onConfirmer, onRefuser }) {
  // Réutilise le helper d'affichage produit du bout 1 (nomComposeVariante),
  // à partir des colonnes à plat renvoyées par la RPC (elle ne peut pas
  // renvoyer les objets imbriqués marques/produits d'un embed PostgREST
  // puisqu'elle interroge la base en SECURITY DEFINER, pas via PostgREST).
  const nomAffiche = nomComposeVariante({
    marques: { nom: p.nom_marque },
    libelle: p.libelle_variante,
    quantite_nette: p.quantite_nette,
    unite_quantite: p.unite_quantite,
    produits: { nom_reference: p.nom_produit },
  });

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontFamily: F, fontSize: 11, color: '#999' }}>
        {formatDateFr(p.cree_le)} · proposé par {p.propose_par_pseudo || 'un utilisateur'}
      </div>
      <div style={{ fontFamily: F, fontWeight: 900, fontSize: 14, color: '#1a1a1a', marginTop: 4 }}>
        « {p.libelle_ticket || '(libellé vide)'} »
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTop: '1px solid #eee' }}>
        {p.url_image && (
          <img src={p.url_image} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', background: '#F5F6F8', flexShrink: 0 }} />
        )}
        <div>
          <div style={{ fontFamily: F, fontWeight: 800, fontSize: 13, color: '#1a1a1a' }}>{nomAffiche}</div>
          {p.code_barres && (
            <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 2 }}>{p.code_barres}</div>
          )}
        </div>
      </div>

      {erreurAction && <div style={{ fontFamily: F, fontSize: 12, color: '#CC0000', marginTop: 8 }}>⚠️ {erreurAction}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={onConfirmer} disabled={enCours} style={{ flex: 1, padding: 9, borderRadius: 8, border: 'none', background: enCours ? '#ccc' : '#00B341', color: '#fff', fontFamily: F, fontWeight: 800, fontSize: 13, cursor: enCours ? 'default' : 'pointer' }}>
          {enCours ? '...' : '✓ Confirmer'}
        </button>
        <button onClick={onRefuser} disabled={enCours} style={{ flex: 1, padding: 9, borderRadius: 8, border: 'none', background: enCours ? '#eee' : '#F5F6F8', color: '#CC0000', fontFamily: F, fontWeight: 800, fontSize: 13, cursor: enCours ? 'default' : 'pointer' }}>
          Refuser
        </button>
      </div>
    </div>
  );
}

export default function ValidationScanSheet({ onClose, onCountChange }) {
  const [propositions, setPropositions] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [enCoursParId, setEnCoursParId] = useState({});
  const [erreurActionParId, setErreurActionParId] = useState({});
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      setChargement(true);
      setErreur(null);
      try {
        const { data, error } = await supabase.rpc('lister_propositions_liaison_scan_en_attente');
        if (annule) return;
        if (error) {
          setErreur(messageErreurRpc(error));
          setPropositions([]);
          onCountChange?.(0);
        } else {
          const liste = Array.isArray(data) ? data : [];
          setPropositions(liste);
          onCountChange?.(liste.length);
        }
      } catch (e) {
        if (!annule) { console.error('[ValidationScanSheet] chargement :', e); setErreur("Impossible de charger les propositions."); setPropositions([]); }
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const afficherMessage = (texte) => {
    setMessage(texte);
    setTimeout(() => setMessage(m => (m === texte ? null : m)), 3500);
  };

  const traiter = async (id, rpc, texteSucces) => {
    setEnCoursParId(prev => ({ ...prev, [id]: true }));
    setErreurActionParId(prev => ({ ...prev, [id]: null }));
    try {
      const { error } = await supabase.rpc(rpc, { p_proposition_id: id });
      if (error) {
        setErreurActionParId(prev => ({ ...prev, [id]: messageErreurRpc(error) }));
        return;
      }
      const restantes = propositions.filter(p => p.id !== id);
      setPropositions(restantes);
      onCountChange?.(restantes.length);
      afficherMessage(texteSucces);
    } catch (e) {
      console.error(`[ValidationScanSheet] ${rpc} :`, e);
      setErreurActionParId(prev => ({ ...prev, [id]: "Action impossible, réessaie." }));
    } finally {
      setEnCoursParId(prev => ({ ...prev, [id]: false }));
    }
  };

  const confirmer = (p) => traiter(p.id, 'valider_proposition_scan', `✓ Liaison créée pour « ${p.libelle_ticket || 'cet article'} »`);
  const refuser = (p) => traiter(p.id, 'refuser_proposition_scan', `Proposition refusée pour « ${p.libelle_ticket || 'cet article'} »`);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#F5F6F8', zIndex: 400, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#1a1a1a', color: '#fff', padding: '16px 20px calc(12px + env(safe-area-inset-top, 0px))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 16 }}>🧾 Validation scan</div>
          <div style={{ fontFamily: F, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            {propositions.length} en attente
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 99, width: 30, height: 30, color: '#fff', fontSize: 15, cursor: 'pointer' }}>✕</button>
      </div>

      {message && (
        <div style={{ background: '#00B341', color: '#fff', padding: '10px 20px', fontFamily: F, fontWeight: 800, fontSize: 12, textAlign: 'center', flexShrink: 0 }}>
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
        {!chargement && !erreur && propositions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 0', fontFamily: F, fontSize: 13, color: '#888' }}>
            Aucune proposition en attente.
          </div>
        )}

        {propositions.map(p => (
          <LigneErrorBoundary key={p.id}>
            <PropositionCard
              p={p}
              enCours={!!enCoursParId[p.id]}
              erreurAction={erreurActionParId[p.id]}
              onConfirmer={() => confirmer(p)}
              onRefuser={() => refuser(p)}
            />
          </LigneErrorBoundary>
        ))}
      </div>
    </div>
  );
}
