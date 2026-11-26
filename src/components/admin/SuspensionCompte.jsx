// Chantier 214 (143-E, côté app) — le filet, pour François seul.
// 1) « Mettre ce compte en pause » : annuler_contributions_compte en APERÇU
//    (p_appliquer = false, aucune écriture), puis, sur confirmation, la même
//    fonction avec p_appliquer = true (la base sauvegarde tout avant, chantier
//    212 : prix rejetés jamais supprimés, points annulés, fiches et codes
//    gardés et remis à revoir).
// 2) « Comptes en pause » : lister_comptes_suspendus + lever_suspension_compte
//    (la levée ne restaure rien : restauration par Claude, sur feu vert).

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { resumeApercuSuspension, messageErreurSuspension } from '../../lib/verificationCommunaute';

const F = "'Nunito',sans-serif";
const ROUGE = '#CC0000';

function Voile({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 450, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 430, borderRadius: '18px 18px 0 0', padding: '18px 18px calc(18px + env(safe-area-inset-bottom, 0px))', maxHeight: '85vh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

const boutonStyle = (fond, couleur = '#fff', actif = true) => ({
  width: '100%', padding: 12, borderRadius: 10, border: 'none', background: actif ? fond : '#ccc', color: couleur,
  fontFamily: F, fontWeight: 900, fontSize: 14, cursor: actif ? 'pointer' : 'default', marginTop: 8,
});

export function SuspendreCompteFenetre({ compteId, pseudo, onClose, onFait }) {
  const [apercu, setApercu] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(true);
  const [motif, setMotif] = useState('');
  const monte = useRef(true);
  useEffect(() => () => { monte.current = false; }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.rpc('annuler_contributions_compte', { p_utilisateur: compteId, p_motif: null, p_appliquer: false });
        if (!monte.current) return;
        if (error) setErreur(messageErreurSuspension(error));
        else setApercu(resumeApercuSuspension(data));
      } catch {
        if (monte.current) setErreur('Aperçu impossible, réessaie.');
      } finally {
        if (monte.current) setEnCours(false);
      }
    })();
  }, [compteId]);

  const appliquer = async () => {
    setEnCours(true);
    setErreur(null);
    try {
      const { error } = await supabase.rpc('annuler_contributions_compte', { p_utilisateur: compteId, p_motif: motif.trim() || null, p_appliquer: true });
      if (!monte.current) return;
      if (error) { setErreur(messageErreurSuspension(error)); return; }
      onFait?.(`Compte de ${pseudo || 'cet utilisateur'} mis en pause.`);
    } catch {
      if (monte.current) setErreur('Action impossible, réessaie.');
    } finally {
      if (monte.current) setEnCours(false);
    }
  };

  return (
    <Voile onClose={enCours ? undefined : onClose}>
      <div style={{ fontFamily: F, fontWeight: 900, fontSize: 17, color: '#1a1a1a' }}>⏸️ Mettre en pause le compte de {pseudo || 'cet utilisateur'} ?</div>
      {enCours && !apercu && <div style={{ fontFamily: F, fontSize: 13, color: '#888', marginTop: 14 }}>Je regarde ce que ce compte a apporté…</div>}
      {erreur && <div style={{ fontFamily: F, fontSize: 13, color: ROUGE, marginTop: 12 }}>⚠️ {erreur}</div>}
      {apercu && (
        <>
          {apercu.dejaSuspendu && <div style={{ fontFamily: F, fontSize: 13, color: '#B8860B', marginTop: 10 }}>Ce compte est déjà en pause : on peut encore annuler ce qu'il a apporté depuis.</div>}
          <div style={{ fontFamily: F, fontSize: 13, color: '#555', marginTop: 12 }}>Ce qui sera fait :</div>
          {apercu.vide
            ? <div style={{ fontFamily: F, fontSize: 14, color: '#1a1a1a', marginTop: 6 }}>{apercu.phrase}</div>
            : (
              <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontFamily: F, fontSize: 14, color: '#1a1a1a', lineHeight: 1.6 }}>
                {apercu.lignes.map(l => <li key={l}>{l}</li>)}
              </ul>
            )}
          <div style={{ fontFamily: F, fontSize: 12.5, color: '#666', marginTop: 10, lineHeight: 1.45 }}>
            Ses prochains prix resteront hors du comparateur et ses scans ne seront plus validés. Tout est sauvegardé avant : rien n'est supprimé.
          </div>
          <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Pourquoi ? (facultatif, pour toi)" maxLength={200}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1.5px solid #ddd', fontFamily: F, fontSize: 14 }} />
          <button onClick={appliquer} disabled={enCours} style={boutonStyle(ROUGE, '#fff', !enCours)}>{enCours ? '…' : '⏸️ Oui, mettre en pause'}</button>
        </>
      )}
      <button onClick={onClose} disabled={enCours && !!apercu} style={boutonStyle('#F5F6F8', '#1a1a1a')}>Annuler</button>
    </Voile>
  );
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function ComptesSuspendusPanneau({ onClose, onMessage }) {
  const [liste, setListe] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [aLever, setALever] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const monte = useRef(true);
  useEffect(() => () => { monte.current = false; }, []);

  const charger = async () => {
    try {
      const { data, error } = await supabase.rpc('lister_comptes_suspendus');
      if (!monte.current) return;
      if (error) { setErreur(messageErreurSuspension(error)); setListe([]); return; }
      setListe(Array.isArray(data) ? data : []);
    } catch {
      if (monte.current) { setErreur('Chargement impossible.'); setListe([]); }
    }
  };
  useEffect(() => { charger(); }, []);

  const lever = async (c) => {
    setEnCours(true);
    setErreur(null);
    try {
      const { error } = await supabase.rpc('lever_suspension_compte', { p_utilisateur: c.utilisateur_id });
      if (!monte.current) return;
      if (error) { setErreur(messageErreurSuspension(error)); return; }
      setALever(null);
      onMessage?.(`Pause levée pour ${c.pseudo || 'ce compte'}.`);
      charger();
    } catch {
      if (monte.current) setErreur('Action impossible, réessaie.');
    } finally {
      if (monte.current) setEnCours(false);
    }
  };

  return (
    <Voile onClose={onClose}>
      <div style={{ fontFamily: F, fontWeight: 900, fontSize: 17, color: '#1a1a1a' }}>⏸️ Comptes en pause</div>
      {erreur && <div style={{ fontFamily: F, fontSize: 13, color: ROUGE, marginTop: 10 }}>⚠️ {erreur}</div>}
      {liste === null && <div style={{ fontFamily: F, fontSize: 13, color: '#888', marginTop: 12 }}>Chargement…</div>}
      {liste && liste.length === 0 && !erreur && <div style={{ fontFamily: F, fontSize: 14, color: '#666', marginTop: 12 }}>Aucun compte en pause.</div>}
      {liste && liste.map(c => (
        <div key={c.utilisateur_id} style={{ borderTop: '1px solid #eee', padding: '12px 0', marginTop: 8 }}>
          <div style={{ fontFamily: F, fontWeight: 800, fontSize: 14, color: '#1a1a1a' }}>{c.pseudo || 'Compte sans pseudo'}</div>
          <div style={{ fontFamily: F, fontSize: 12, color: '#888', marginTop: 2 }}>En pause depuis le {formatDate(c.suspendu_le)}{c.motif ? ` · ${c.motif}` : ''}</div>
          {aLever === c.utilisateur_id ? (
            <>
              <div style={{ fontFamily: F, fontSize: 12.5, color: '#666', marginTop: 8, lineHeight: 1.45 }}>Ses prochains scans compteront à nouveau. Ce qui a été annulé n'est pas remis : demande-le à Claude si besoin.</div>
              <button onClick={() => lever(c)} disabled={enCours} style={boutonStyle('#00B341', '#fff', !enCours)}>{enCours ? '…' : 'Oui, lever la pause'}</button>
              <button onClick={() => setALever(null)} disabled={enCours} style={boutonStyle('#F5F6F8', '#1a1a1a')}>Annuler</button>
            </>
          ) : (
            <button onClick={() => setALever(c.utilisateur_id)} style={{ ...boutonStyle('#F5F6F8', '#1a1a1a'), padding: 9, fontSize: 13 }}>Lever la pause</button>
          )}
        </div>
      ))}
      <button onClick={onClose} style={boutonStyle('#1a1a1a')}>Fermer</button>
    </Voile>
  );
}
