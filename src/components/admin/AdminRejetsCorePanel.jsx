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
import {
  chargerSuggestionsPourRejets,
  proposerAliasCore,
  validerSuggestionAliasCore,
  refuserSuggestionAliasCore,
} from '../../lib/suggestionsAliasCore';

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

export default function AdminRejetsCorePanel({ modeCoreActif, onToggleModeCore, coreActifGlobal }) {
  const [afficherTraites, setAfficherTraites] = useState(false);
  const [rejets, setRejets] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  // #56.5.B — économies Core confirmées. lignesInjectees===null => données
  // réelles Supabase ; sinon => simulation dev, aucune requête Supabase.
  const [economies, setEconomies] = useState(null);
  const [chargementEconomies, setChargementEconomies] = useState(false);
  const [lignesInjectees, setLignesInjectees] = useState(null);

  // #67 — suggestions d'alias par IA, indexées par rejet_ecriture_core_id.
  const [suggestions, setSuggestions] = useState({});
  const [lotEnCours, setLotEnCours] = useState(false);
  const [lotResume, setLotResume] = useState(null);
  const [suggestionEnCours, setSuggestionEnCours] = useState(null);
  const [suggestionErreurs, setSuggestionErreurs] = useState({});

  const rechargerSuggestions = async (listeRejets) => {
    const idsAliasNonTrouve = listeRejets.filter(r => r.motif === 'alias_non_trouve').map(r => r.id);
    const data = await chargerSuggestionsPourRejets(idsAliasNonTrouve);
    setSuggestions(Object.fromEntries(data.map(s => [s.rejet_ecriture_core_id, s])));
  };

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
        await rechargerSuggestions(data || []);
      }
      setChargement(false);
    })();
    return () => { annule = true; };
  }, [afficherTraites]);

  const lancerPropositionAlias = async () => {
    setLotEnCours(true);
    setLotResume(null);
    const resultat = await proposerAliasCore();
    setLotEnCours(false);
    if (!resultat) {
      setErreur("Échec de la proposition d'alias, réessaie.");
      return;
    }
    setLotResume(resultat);
    await rechargerSuggestions(rejets);
  };

  const validerSuggestion = async (suggestion) => {
    setSuggestionEnCours(suggestion.id);
    setSuggestionErreurs(prev => ({ ...prev, [suggestion.id]: null }));
    const resultat = await validerSuggestionAliasCore(suggestion.id);
    setSuggestionEnCours(null);
    if (!resultat?.succes) {
      setSuggestionErreurs(prev => ({ ...prev, [suggestion.id]: resultat?.erreur || "Échec de la validation." }));
      return;
    }
    setRejets(prev => afficherTraites
      ? prev.map(r => (r.id === suggestion.rejet_ecriture_core_id ? { ...r, traite: true } : r))
      : prev.filter(r => r.id !== suggestion.rejet_ecriture_core_id)
    );
    setSuggestions(prev => {
      const { [suggestion.rejet_ecriture_core_id]: _retire, ...reste } = prev;
      return reste;
    });
  };

  const refuserSuggestion = async (suggestion) => {
    setSuggestionEnCours(suggestion.id);
    setSuggestionErreurs(prev => ({ ...prev, [suggestion.id]: null }));
    const resultat = await refuserSuggestionAliasCore(suggestion.id);
    setSuggestionEnCours(null);
    if (!resultat?.succes) {
      setSuggestionErreurs(prev => ({ ...prev, [suggestion.id]: resultat?.erreur || "Échec du refus." }));
      return;
    }
    setSuggestions(prev => ({ ...prev, [suggestion.rejet_ecriture_core_id]: { ...suggestion, statut: 'refusee' } }));
  };

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

      {/* #56.6 — modeCoreActif est un tri-état porté par App.jsx (pas un state
          local) : null = suivre coreActifGlobal (le kill switch, valable pour
          tout le monde), true/false = override explicite pour comparer
          ponctuellement l'autre moteur sans changer le réglage global. */}
      <div style={{ marginBottom: 16, padding: '10px 12px', background: '#F6F0FA', borderRadius: 10, border: '1px solid #E0D0EE' }}>
        <div style={{ fontFamily: F, fontSize: 12, color: '#555', marginBottom: 8 }}>
          Réglage global (<code>parametres_globaux.core_actif</code>) : <strong>{coreActifGlobal ? 'Core actif' : 'Legacy'}</strong>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { valeur: null,  label: 'Suivre le réglage global' },
            { valeur: true,  label: 'Forcer Core' },
            { valeur: false, label: 'Forcer legacy' },
          ].map(({ valeur, label }) => (
            <button
              key={String(valeur)}
              onClick={() => onToggleModeCore(valeur)}
              style={{
                flex: 1, padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
                fontFamily: F, fontWeight: 800, fontSize: 11,
                border: modeCoreActif === valeur ? '2px solid #8E44AD' : '1px solid #D9C7E8',
                background: modeCoreActif === valeur ? '#8E44AD' : '#fff',
                color: modeCoreActif === valeur ? '#fff' : '#8E44AD',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* #56.5.B — économies Core confirmées, debug admin explicite uniquement
          (override "Forcer Core"), pas juste parce que le global est actif. */}
      {modeCoreActif === true && (
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

      {/* #67 — bouton admin déclenchant le lot de suggestions IA. N'affecte
          aucun rejet directement : ne fait qu'enregistrer des suggestions
          'en_attente' (voir plus bas, par rejet), jamais un alias ni un prix. */}
      {rejets.some(r => r.motif === 'alias_non_trouve' && !r.traite) && (
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={lancerPropositionAlias}
            disabled={lotEnCours}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none',
              background: lotEnCours ? '#B39DDB' : '#8E44AD', color: '#fff',
              fontFamily: F, fontWeight: 800, fontSize: 13, cursor: lotEnCours ? 'default' : 'pointer',
            }}
          >
            {lotEnCours ? 'Analyse en cours…' : '🧠 Proposer des alias'}
          </button>
          {lotResume && !lotEnCours && (
            <div style={{ fontFamily: F, fontSize: 12, color: '#555', marginTop: 6 }}>
              Terminé — {lotResume.traites} rejet(s) traité(s), {lotResume.suggestions_creees} suggestion(s) créée(s),
              {' '}{lotResume.sans_proposition} sans proposition, {lotResume.erreurs} en erreur.
            </div>
          )}
        </div>
      )}

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

          {/* #67 — suggestion IA rattachée à ce rejet, si le bouton "Proposer
              des alias" en a créé une. Aucun impact sur la case "Traité"
              ci-dessous tant que la suggestion n'est pas validée (RPC
              valider_suggestion_alias_core, seule à marquer traite=true). */}
          {rejet.motif === 'alias_non_trouve' && suggestions[rejet.id] && (() => {
            const suggestion = suggestions[rejet.id];
            const enCours = suggestionEnCours === suggestion.id;
            const erreurSuggestion = suggestionErreurs[suggestion.id];
            return (
              <div style={{ background: '#F6F0FA', border: '1px solid #E0D0EE', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                {suggestion.resultat === 'produit_inconnu_du_referentiel' ? (
                  <div style={{ fontFamily: F, fontSize: 12, color: '#8E44AD', fontWeight: 700 }}>
                    Suggestion IA : produit inconnu du référentiel
                  </div>
                ) : (
                  <div style={{ fontFamily: F, fontSize: 12, color: '#8E44AD', fontWeight: 700 }}>
                    Suggestion IA : {suggestion.produit_nom || suggestion.produit_id}
                    {suggestion.variante_libelle ? ` — ${suggestion.variante_libelle}` : ''}
                    {' '}— confiance {suggestion.score_confiance}%
                  </div>
                )}
                {suggestion.raison_ia && (
                  <div style={{ fontFamily: F, fontSize: 11, color: '#777', marginTop: 2 }}>Raison : {suggestion.raison_ia}</div>
                )}

                {suggestion.statut === 'en_attente' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {suggestion.resultat === 'suggestion' && (
                      <button
                        onClick={() => validerSuggestion(suggestion)}
                        disabled={enCours}
                        style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: 'none', background: '#00B341', color: '#fff', fontFamily: F, fontWeight: 800, fontSize: 12, cursor: enCours ? 'default' : 'pointer' }}
                      >
                        Valider
                      </button>
                    )}
                    <button
                      onClick={() => refuserSuggestion(suggestion)}
                      disabled={enCours}
                      style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #CC0000', background: '#fff', color: '#CC0000', fontFamily: F, fontWeight: 800, fontSize: 12, cursor: enCours ? 'default' : 'pointer' }}
                    >
                      Refuser
                    </button>
                  </div>
                )}
                {suggestion.statut === 'refusee' && (
                  <div style={{ fontFamily: F, fontSize: 11, color: '#999', fontStyle: 'italic', marginTop: 6 }}>Refusée</div>
                )}
                {erreurSuggestion && (
                  <div style={{ fontFamily: F, fontSize: 11, color: '#CC0000', marginTop: 6 }}>{erreurSuggestion}</div>
                )}
              </div>
            );
          })()}

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
