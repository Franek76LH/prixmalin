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
import { chargerEtCalculerEconomiesConfirmeesCore } from '../../lib/economiesCoreConfirmees';

const F = "'Nunito',sans-serif";

// #56.5.B complément — jeu de lignes fictif pour le bouton dev "Simuler
// tickets Core". Mix volontaire : une ligne moins chère que le marché, une
// plus chère, une quasi neutre — le total n'est pas artificiellement positif.
// Format identique à celui produit par chargerEtCalculerEconomiesConfirmeesCore
// après lecture Supabase : aucune logique parallèle nécessaire côté calcul.
const LIGNES_SIMULEES_DEV = [
  { ligneTicketId: 'sim-1', produitId: 'sim-lait',  magasinId: 'sim-magasin', prixPaye: 0.95, prixReferenceMarche: 1.15 },
  { ligneTicketId: 'sim-2', produitId: 'sim-cafe',  magasinId: 'sim-magasin', prixPaye: 4.80, prixReferenceMarche: 4.20 },
  { ligneTicketId: 'sim-3', produitId: 'sim-pates', magasinId: 'sim-magasin', prixPaye: 1.10, prixReferenceMarche: 1.12 },
];

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

  // #56.5.B — économies Core confirmées. lignesInjectees===null => données
  // réelles Supabase ; sinon => simulation dev, aucune requête Supabase.
  const [economies, setEconomies] = useState(null);
  const [chargementEconomies, setChargementEconomies] = useState(false);
  const [lignesInjectees, setLignesInjectees] = useState(null);

  useEffect(() => {
    if (!modeCoreActif) return;
    let annule = false;
    setChargementEconomies(true);
    chargerEtCalculerEconomiesConfirmeesCore(lignesInjectees ? { lignesInjectees } : {})
      .then(resultat => { if (!annule) setEconomies(resultat); })
      .finally(() => { if (!annule) setChargementEconomies(false); });
    return () => { annule = true; };
  }, [modeCoreActif, lignesInjectees]);

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

      {/* #56.5.B — économies Core confirmées, réutilise le toggle ci-dessus */}
      {modeCoreActif && (
        <div style={{ background: '#F6F0FA', border: '1px solid #E0D0EE', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontFamily: F, fontWeight: 800, fontSize: 13, color: '#8E44AD', marginBottom: 8 }}>
            💶 Économies Core confirmées (debug)
          </div>

          {chargementEconomies && (
            <div style={{ fontFamily: F, fontSize: 12, color: '#777' }}>Calcul en cours…</div>
          )}

          {!chargementEconomies && economies && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: F, fontWeight: 900, fontSize: 20, color: economies.total >= 0 ? '#00B341' : '#CC0000' }}>
                  {economies.total >= 0 ? '+' : ''}{economies.total.toFixed(2)} €
                </span>
                {economies.simule && (
                  <span style={{ fontFamily: F, fontSize: 11, fontStyle: 'italic', color: '#8E44AD' }}>(données simulées)</span>
                )}
              </div>

              {economies.lignes.length === 0 && (
                <div style={{ fontFamily: F, fontSize: 12, color: '#777', marginBottom: 8 }}>
                  Aucune ligne confirmée (source='ticket') en base pour l'instant.
                </div>
              )}

              {economies.lignes.map(ligne => (
                <div key={ligne.ligneTicketId} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F, fontSize: 12, color: '#333', padding: '4px 0', borderBottom: '1px solid #EBDCF5' }}>
                  <span>{ligne.produitId} — payé {ligne.prixPaye.toFixed(2)} € / marché {ligne.prixReferenceMarche != null ? ligne.prixReferenceMarche.toFixed(2) + ' €' : '—'}</span>
                  <span style={{ fontWeight: 800, color: ligne.economie == null ? '#999' : ligne.economie >= 0 ? '#00B341' : '#CC0000' }}>
                    {ligne.economie == null ? '—' : `${ligne.economie >= 0 ? '+' : ''}${ligne.economie.toFixed(2)} €`}
                  </span>
                </div>
              ))}
            </>
          )}

          {import.meta.env.DEV && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={() => setLignesInjectees(LIGNES_SIMULEES_DEV)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', background: '#8E44AD', color: '#fff', fontFamily: F, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
              >
                🧪 Simuler tickets Core
              </button>
              {lignesInjectees && (
                <button
                  onClick={() => setLignesInjectees(null)}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #8E44AD', background: '#fff', color: '#8E44AD', fontFamily: F, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
                >
                  Revenir aux données réelles
                </button>
              )}
            </div>
          )}
        </div>
      )}

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

          <div style={{ fontFamily: F, fontSize: 14, color: '#111', fontWeight: 700, marginBottom: rejet.motif === 'alias_non_trouve' && rejet.payload?.libelle_ticket ? 2 : 10 }}>
            {detailPourMotif(rejet)}
          </div>

          {/* #68 — texte réel du ticket, si dispo (payload JSONB, aucune
              colonne dédiée). Affiché seulement pour alias_non_trouve, aucun
              changement pour les autres motifs ni pour les non-admin. */}
          {rejet.motif === 'alias_non_trouve' && rejet.payload?.libelle_ticket && (
            <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginBottom: 10 }}>
              ticket : {rejet.payload.libelle_ticket}
            </div>
          )}

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
