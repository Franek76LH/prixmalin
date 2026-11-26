// Chantier 214 (143-C, côté app) — « Produits à vérifier » : un membre de
// confiance (testeur, Contributeur 300 points et plus) confirme ou non le
// produit qu'un débutant a scanné. Deux « oui » concordants et aucun « non »
// → la base valide d'elle-même (chantier 211). Jamais le nom de l'auteur.
//
// Lecture : lister_propositions_scan_a_verifier. Écriture : uniquement
// donner_avis_proposition_scan (une ligne d'avis ; la validation éventuelle
// est faite par la base, au nom de l'auteur).

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { carteProposition, trierPropositions, nbAvisAttendus, messageApresAvis, messageErreurAvis } from '../lib/verificationCommunaute';

const F = "'Nunito',sans-serif";
const VERT = '#00B341';
const ROUGE = '#CC0000';
const TEXTE = '#1a1a1a';

function Carte({ p, enCours, erreur, onAvis }) {
  const c = carteProposition(p);
  const bouton = (avis, libelle, couleur, fond) => {
    const choisi = c.monAvis === avis;
    return (
      <button onClick={() => onAvis(avis)} disabled={enCours}
        style={{ flex: 1, padding: '11px 8px', borderRadius: 10, border: choisi ? `2px solid ${couleur}` : 'none', background: choisi ? '#fff' : fond, color: choisi ? couleur : (fond === '#F5F6F8' ? couleur : '#fff'), fontFamily: F, fontWeight: 900, fontSize: 14, cursor: enCours ? 'default' : 'pointer', opacity: enCours ? 0.6 : 1 }}>
        {choisi ? `${libelle} ✓` : libelle}
      </button>
    );
  };
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontFamily: F, fontSize: 11, color: '#999', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sur le ticket</div>
      <div style={{ fontFamily: F, fontWeight: 900, fontSize: 15, color: TEXTE, marginTop: 2 }}>« {c.titre} »</div>
      <div style={{ fontFamily: F, fontSize: 11, color: '#999', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 10 }}>Produit scanné</div>
      <div style={{ fontFamily: F, fontWeight: 800, fontSize: 14, color: c.produit ? TEXTE : '#B8860B', marginTop: 2 }}>
        {c.produit || 'Produit inconnu'}{c.inconnu && c.produit ? ' (nouveau produit)' : ''}
      </div>
      {c.code && <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 2 }}>Code-barres : {c.code}</div>}
      {c.inconnu && <div style={{ fontFamily: F, fontSize: 12, color: '#888', marginTop: 6 }}>Nouveau produit : il sera rangé dans le catalogue par l'équipe après vos avis.</div>}
      {erreur && <div style={{ fontFamily: F, fontSize: 12, color: ROUGE, marginTop: 8 }}>⚠️ {erreur}</div>}
      <div style={{ fontFamily: F, fontSize: 13, color: '#555', marginTop: 12 }}>Est-ce bien le même produit ?</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {bouton('confirme', '👍 Oui', VERT, VERT)}
        {bouton('refuse', '👎 Non', ROUGE, '#F5F6F8')}
      </div>
    </div>
  );
}

export default function AVerifierScansSheet({ onClose, onCountChange }) {
  const [liste, setListe] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState({});
  const [erreurs, setErreurs] = useState({});
  const [message, setMessage] = useState(null);
  const monte = useRef(true);
  useEffect(() => () => { monte.current = false; }, []);

  const charger = async () => {
    setErreur(null);
    try {
      const { data, error } = await supabase.rpc('lister_propositions_scan_a_verifier');
      if (!monte.current) return;
      if (error) { setErreur('Impossible de charger les produits à vérifier.'); setListe([]); onCountChange?.(0); return; }
      const l = trierPropositions(data);
      setListe(l);
      onCountChange?.(nbAvisAttendus(l));
    } catch {
      if (monte.current) { setErreur('Impossible de charger les produits à vérifier.'); setListe([]); }
    } finally {
      if (monte.current) setChargement(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, []);

  const afficher = (texte) => {
    setMessage(texte);
    setTimeout(() => { if (monte.current) setMessage(m => (m === texte ? null : m)); }, 3500);
  };

  const donnerAvis = async (p, avis) => {
    const id = p.proposition_id;
    setEnCours(e => ({ ...e, [id]: true }));
    setErreurs(e => ({ ...e, [id]: null }));
    try {
      const { data, error } = await supabase.rpc('donner_avis_proposition_scan', { p_proposition_id: id, p_avis: avis });
      if (!monte.current) return;
      if (error) {
        const msg = messageErreurAvis(error);
        if (/Déjà traitée|n'existe plus/.test(msg)) {
          const reste = liste.filter(x => x.proposition_id !== id);
          setListe(reste); onCountChange?.(nbAvisAttendus(reste)); afficher(msg);
        } else {
          setErreurs(e => ({ ...e, [id]: msg }));
        }
        return;
      }
      afficher(messageApresAvis(data, avis));
      // Validée : elle sort. Sinon elle reste, avec mon avis, et passe en bas.
      const reste = data?.validee === true
        ? liste.filter(x => x.proposition_id !== id)
        : trierPropositions(liste.map(x => (x.proposition_id === id ? { ...x, mon_avis: avis, nb_confirmations: data?.confirmations ?? x.nb_confirmations } : x)));
      setListe(reste);
      onCountChange?.(nbAvisAttendus(reste));
    } catch {
      if (monte.current) setErreurs(e => ({ ...e, [id]: 'Avis non enregistré, réessaie.' }));
    } finally {
      if (monte.current) setEnCours(e => ({ ...e, [id]: false }));
    }
  };

  const attendus = nbAvisAttendus(liste);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#F5F6F8', zIndex: 400, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #eee', padding: 'calc(14px + env(safe-area-inset-top, 0px)) 18px 12px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 17, color: TEXTE }}>🔎 Produits à vérifier</div>
          <div style={{ fontFamily: F, fontSize: 12, color: '#888', marginTop: 2 }}>
            {chargement ? '…' : attendus > 0 ? `${attendus} attend${attendus > 1 ? 'ent' : ''} ton avis` : 'Tu as tout vérifié, merci !'}
          </div>
        </div>
        <button onClick={onClose} aria-label="Fermer" style={{ background: '#f0f0f0', border: 'none', borderRadius: 99, width: 30, height: 30, fontSize: 14, cursor: 'pointer' }}>✕</button>
      </div>

      {message && (
        <div style={{ background: VERT, color: '#fff', padding: '10px 20px', fontFamily: F, fontWeight: 800, fontSize: 13, textAlign: 'center', flexShrink: 0 }}>{message}</div>
      )}

      <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, padding: '14px 14px calc(14px + env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ fontFamily: F, fontSize: 13, color: '#555', lineHeight: 1.45, marginBottom: 12 }}>
          D'autres membres ont scanné ces produits. Regarde si le produit correspond bien à la ligne du ticket : deux « Oui » et c'est validé pour tout le monde.
        </div>
        {chargement && <div style={{ textAlign: 'center', padding: '30px 0', fontFamily: F, fontSize: 13, color: '#888' }}>Chargement…</div>}
        {erreur && <div style={{ fontFamily: F, fontSize: 13, color: ROUGE, padding: '12px 0' }}>⚠️ {erreur}</div>}
        {!chargement && !erreur && liste.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 0', fontFamily: F, fontSize: 14, color: '#888' }}>Rien à vérifier pour le moment 👍</div>
        )}
        {liste.map(p => (
          <Carte key={p.proposition_id} p={p} enCours={!!enCours[p.proposition_id]} erreur={erreurs[p.proposition_id]} onAvis={(a) => donnerAvis(p, a)} />
        ))}
      </div>
    </div>
  );
}
