// Chantier 200 (= 143-D) — écran ADMIN « Prix à vérifier ».
//
// Un prix lu sur un ticket qui s'écarte trop des prix connus du même format
// (≥ 2 × la médiane, ou ≤ médiane / 2,5) reste « en attente » : il n'entre pas
// dans le comparateur. Ici François le compare à la médiane et au texte du
// ticket, puis décide. Écritures : uniquement decider_prix_a_verifier (RPC
// réservée à l'administrateur).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const F = "'Nunito',sans-serif";
const euros = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(2).replace('.', ',')} €`);

function formatPrixAVerifier(p) {
  const q = Number(p?.quantite_nette);
  const u = (p?.unite_quantite || '').trim();
  const n = Number(p?.nombre_unites) || 1;
  if (!Number.isFinite(q) || q <= 0 || !u) return '';
  const base = `${Number.isInteger(q) ? q : q.toString().replace('.', ',')} ${u}`;
  return n > 1 ? `${n} × ${base}` : base;
}

function formatDateFr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PrixAVerifierSheet({ onClose, onCountChange }) {
  const [lignes, setLignes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(null);
  const [message, setMessage] = useState(null);

  const charger = useCallback(async () => {
    setChargement(true); setErreur(null);
    try {
      const { data, error } = await supabase.rpc('lister_prix_a_verifier');
      if (error) throw error;
      setLignes(data || []);
      onCountChange?.((data || []).length);
    } catch (e) {
      console.error('[PrixAVerifierSheet] liste :', e);
      setErreur('Impossible de charger les prix à vérifier.');
    } finally {
      setChargement(false);
    }
  }, [onCountChange]);
  useEffect(() => { charger(); }, [charger]);

  const decider = async (p, valider) => {
    setEnCours(p.id);
    try {
      const { error } = await supabase.rpc('decider_prix_a_verifier', { p_prix_id: p.id, p_valider: valider });
      if (error) throw error;
      const reste = lignes.filter(l => l.id !== p.id);
      setLignes(reste);
      onCountChange?.(reste.length);
      setMessage(valider ? `✓ ${euros(p.prix_total)} validé : il entre dans le comparateur` : `${euros(p.prix_total)} rejeté : il n'entrera pas dans le comparateur`);
      setTimeout(() => setMessage(null), 3500);
    } catch (e) {
      console.error('[PrixAVerifierSheet] décision :', e);
      setErreur('Action impossible, réessaie.');
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#F5F6F8', zIndex: 400, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#1a1a1a', color: '#fff', padding: '16px 20px calc(12px + env(safe-area-inset-top, 0px))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 16 }}>💰 Prix à vérifier</div>
          <div style={{ fontFamily: F, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{lignes.length} en attente · hors comparateur tant que tu n'as pas décidé</div>
        </div>
        <button onClick={onClose} aria-label="Fermer" style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 99, width: 30, height: 30, color: '#fff', fontSize: 15, cursor: 'pointer' }}>✕</button>
      </div>
      {message && <div style={{ background: '#00B341', color: '#fff', padding: '10px 20px', fontFamily: F, fontWeight: 800, fontSize: 12, textAlign: 'center', flexShrink: 0 }}>{message}</div>}
      <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, padding: '14px 14px calc(14px + env(safe-area-inset-bottom, 0px))' }}>
        {chargement && <div style={{ textAlign: 'center', padding: '30px 0', fontFamily: F, fontSize: 13, color: '#888' }}>Chargement...</div>}
        {erreur && <div style={{ fontFamily: F, fontSize: 13, color: '#CC0000', padding: '12px 0' }}>⚠️ {erreur}</div>}
        {!chargement && !erreur && lignes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 0', fontFamily: F, fontSize: 13, color: '#888' }}>Aucun prix à vérifier.</div>
        )}
        {lignes.map(p => {
          const rapport = Number(p.mediane) > 0 ? Number(p.prix_total) / Number(p.mediane) : null;
          const sens = rapport == null ? '' : rapport >= 1 ? `${rapport.toFixed(1).replace('.', ',')} fois plus cher` : `${(1 / rapport).toFixed(1).replace('.', ',')} fois moins cher`;
          return (
            <div key={p.id} style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ fontFamily: F, fontSize: 11, color: '#999' }}>
                {formatDateFr(p.observe_le)} · {[p.nom_enseigne, p.nom_magasin].filter(Boolean).join(' · ')} · relevé par {p.releve_par_pseudo || 'un utilisateur'}
              </div>
              <div style={{ fontFamily: F, fontWeight: 900, fontSize: 15, color: '#1a1a1a', marginTop: 4 }}>
                {p.nom_produit}{p.nom_marque ? ` · ${p.nom_marque}` : ''}{formatPrixAVerifier(p) ? ` · ${formatPrixAVerifier(p)}` : ''}
              </div>
              {p.libelle_ticket && (
                <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: '#555', marginTop: 4 }}>
                  Ticket : {p.libelle_ticket}{Number(p.quantite_ticket) > 1 ? ` (× ${Number(p.quantite_ticket)})` : ''}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8, fontFamily: F }}>
                <span style={{ fontWeight: 900, fontSize: 20, color: '#B45309' }}>{euros(p.prix_total)}</span>
                <span style={{ fontSize: 12.5, color: '#555' }}>habituellement {euros(p.mediane)} ({p.nb_autres} prix)</span>
              </div>
              {sens && <div style={{ fontFamily: F, fontSize: 12, fontWeight: 800, color: '#B45309', marginTop: 2 }}>{sens} que d'habitude</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => decider(p, true)} disabled={enCours === p.id} style={{ flex: 1, border: 'none', background: '#0A8F3C', color: '#fff', borderRadius: 12, padding: '11px', fontFamily: F, fontWeight: 900, fontSize: 13.5, cursor: 'pointer' }}>Valider ce prix</button>
                <button onClick={() => decider(p, false)} disabled={enCours === p.id} style={{ flex: 1, border: '1.5px solid #E8E8E4', background: '#fff', color: '#CC0000', borderRadius: 12, padding: '11px', fontFamily: F, fontWeight: 900, fontSize: 13.5, cursor: 'pointer' }}>Rejeter</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
