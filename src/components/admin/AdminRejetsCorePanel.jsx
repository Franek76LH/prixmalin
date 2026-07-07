// #56.3b — Panneau admin simple pour les rejets d'écriture Core
// (rejets_ecriture_core). Visible uniquement pour un administrateur (voir
// isAdmin dans App.jsx, basé sur la RPC est_administrateur()).
//
// Volontairement minimal : lister, cocher "traité". Aucune correction
// d'alias, aucun ajout de correspondance magasin, aucune suppression —
// ces actions restent manuelles dans Supabase pour l'instant.
//
// La sécurité repose entièrement sur la RLS de rejets_ecriture_core
// (lecture/écriture réservées à est_administrateur()) : ce composant ne
// réimplémente aucun filtre de sécurité côté client.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const F = "'Nunito',sans-serif";

const COULEUR_MOTIF = {
  magasin_non_resolu: '#CC0000',
  alias_non_trouve: '#B8860B',
  erreur_technique: '#8E44AD',
};

function formatDateFr(iso) {
  const d = new Date(iso);
  const jj = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const aaaa = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${jj}/${mm}/${aaaa} ${hh}:${min}`;
}

function detailPourMotif(rejet) {
  if (rejet.motif === 'magasin_non_resolu') {
    return rejet.magasin_texte && rejet.magasin_texte.trim() ? rejet.magasin_texte : 'magasin non renseigné';
  }
  if (rejet.motif === 'alias_non_trouve') {
    return rejet.libelle_non_resolu || '—';
  }
  if (rejet.motif === 'erreur_technique') {
    return rejet.message_erreur || '—';
  }
  return '—';
}

export default function AdminRejetsCorePanel({ modeCoreActif, onToggleModeCore }) {
  const [afficherTraites, setAfficherTraites] = useState(false);
  const [rejets, setRejets] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    (async () => {
      let requete = supabase.from('rejets_ecriture_core').select('*').order('cree_le', { ascending: false });
      if (!afficherTraites) requete = requete.eq('traite', false);
      const { data, error } = await requete;
      if (annule) return;
      if (error) {
        setErreur("Impossible de charger les rejets.");
        setRejets([]);
      } else {
        setErreur(null);
        setRejets(data || []);
      }
      setChargement(false);
    })();
    return () => { annule = true; };
  }, [afficherTraites]);

  const marquerTraite = async (id) => {
    const { error } = await supabase.from('rejets_ecriture_core').update({ traite: true }).eq('id', id);
    if (error) { setErreur("Échec de la mise à jour, réessaie."); return; }
    setRejets(prev => afficherTraites
      ? prev.map(r => (r.id === id ? { ...r, traite: true } : r))
      : prev.filter(r => r.id !== id)
    );
  };

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <div style={{ fontFamily: F, fontWeight: 900, fontSize: 20, color: '#111', marginBottom: 4 }}>
        Rejets d'écriture Core
      </div>
      <div style={{ fontFamily: F, fontSize: 12, color: '#777', marginBottom: 16 }}>
        Panneau admin — #56.3a
      </div>

      {/* #56.4 — état porté par App.jsx (modeCoreActif), pas un state local :
          c'est ce qui permet à cette case d'influencer l'écran Comparer. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontFamily: F, fontSize: 13, fontWeight: 700, color: '#8E44AD', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!modeCoreActif} onChange={e => onToggleModeCore(e.target.checked)} />
        🔧 Voir le comparateur en mode Core (debug)
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontFamily: F, fontSize: 13, color: '#333', cursor: 'pointer' }}>
        <input type="checkbox" checked={afficherTraites} onChange={e => setAfficherTraites(e.target.checked)} />
        Afficher aussi les rejets traités
      </label>

      {chargement && (
        <div style={{ fontFamily: F, fontSize: 13, color: '#777' }}>Chargement…</div>
      )}

      {erreur && (
        <div style={{ fontFamily: F, fontSize: 13, color: '#CC0000', marginBottom: 12 }}>{erreur}</div>
      )}

      {!chargement && !erreur && rejets.length === 0 && (
        <div style={{ fontFamily: F, fontSize: 13, color: '#777' }}>
          {afficherTraites ? "Aucun rejet." : "Aucun rejet en attente."}
        </div>
      )}

      {!chargement && rejets.map(rejet => (
        <div
          key={rejet.id}
          style={{
            background: rejet.traite ? '#F5F5F5' : '#fff',
            border: '1px solid #E5E5E5',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 10,
            opacity: rejet.traite ? 0.6 : 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontFamily: F, fontSize: 11, color: '#999' }}>{formatDateFr(rejet.cree_le)}</span>
            <span style={{
              fontFamily: F, fontWeight: 800, fontSize: 11, color: '#fff',
              background: COULEUR_MOTIF[rejet.motif] || '#999',
              borderRadius: 99, padding: '3px 10px',
            }}>
              {rejet.motif}
            </span>
          </div>

          <div style={{ fontFamily: F, fontSize: 12, color: '#555', marginBottom: 4 }}>
            source : <strong>{rejet.source}</strong>
          </div>

          <div style={{ fontFamily: F, fontSize: 14, color: '#111', fontWeight: 700, marginBottom: 10 }}>
            {detailPourMotif(rejet)}
          </div>

          {!rejet.traite && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: F, fontSize: 13, color: '#333', cursor: 'pointer' }}>
              <input type="checkbox" checked={false} onChange={() => marquerTraite(rejet.id)} />
              Traité
            </label>
          )}
          {rejet.traite && (
            <div style={{ fontFamily: F, fontSize: 12, color: '#999', fontStyle: 'italic' }}>Traité</div>
          )}
        </div>
      ))}
    </div>
  );
}
