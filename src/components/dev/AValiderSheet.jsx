import { Component, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// PANNEAU DEV UNIQUEMENT — chantier anti-doublon. Ne monte JAMAIS ce
// composant hors de import.meta.env.DEV (voir App.jsx). Liste les
// lignes_ticket pas encore rattachées à un produit, propose des candidats
// via la RPC trouver_produits_proches, et permet de valider ligne par ligne.
//
// Écritures (uniquement quand l'utilisateur tape un candidat) :
// - valider_ligne_dev_avec_alias (déjà installée en base, SECURITY DEFINER,
//   testée pour un utilisateur non-admin) : association produit/variante +
//   prix + alias d'apprentissage actif, en une seule transaction.
// - annuler_validation_ligne_dev (déjà installée en base) : défait tout ce
//   que valider_ligne_dev_avec_alias vient de créer, à partir de l'état
//   "avant" renvoyé par cette dernière.
// - creer_produit_et_valider_ligne_dev / annuler_creation_produit_dev (idem,
//   déjà installées) : mêmes garanties pour le bouton "Nouveau produit",
//   avec en plus la création du produit/variante et leur suppression au undo.

const F = "'Nunito',sans-serif";

// Petit error boundary local : une ligne dont le rendu plante (champ
// inattendu, forme de donnée imprévue) ne doit jamais faire disparaître tout
// l'écran — seule cette carte est remplacée par un message d'erreur.
class LigneErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error) { console.error('[AValiderSheet] rendu d\'une ligne en échec :', error); }
  render() {
    if (this.state.crashed) {
      return (
        <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, fontFamily: F, fontSize: 12, color: '#CC0000' }}>
          ⚠️ Erreur d'affichage pour cette ligne (donnée inattendue) — le reste de la liste n'est pas affecté.
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
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// numeric Postgres arrive en string via PostgREST (ex "1.000") — toujours
// repasser par Number() avant tout calcul, jamais supposer un type numérique.
function versNombre(valeur, repli = null) {
  if (valeur == null) return repli;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : repli;
}

function formatMontant(ligne) {
  const montantNet = versNombre(ligne.montant_net);
  const prixUnitaire = versNombre(ligne.prix_unitaire);
  const quantite = versNombre(ligne.quantite, 1);
  const montant = montantNet ?? (prixUnitaire != null ? prixUnitaire * quantite : null);
  return montant != null ? `${montant.toFixed(2).replace('.', ',')} €` : '—';
}

function messageErreurRpc(error, nomFonction) {
  if (/not find the function|schema cache/i.test(error?.message || '')) {
    return `Fonction ${nomFonction} introuvable côté API — le SQL fourni doit d'abord être exécuté (ou le cache de schéma PostgREST rechargé : NOTIFY pgrst, 'reload schema';).`;
  }
  return error?.message || "Action impossible, réessaie.";
}

// Nom proposé pour un nouveau produit : on part du libellé brut du ticket, on
// enlève un éventuel prix accroché en fin de chaîne (ex "Comté râpé 3,45")
// et on met une majuscule initiale — l'utilisateur reste libre de tout éditer.
function nomProduitPropose(libelle) {
  if (!libelle) return '';
  const s = libelle.trim().replace(/\s*\d+[.,]\d{1,2}\s*€?\s*$/, '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const UNITES_PAR_TYPE_VENTE = {
  poids: ['g', 'kg'],
  volume: ['ml', 'cl', 'l'],
  piece: ['pièce'],
};
const UNITE_BASE_PAR_TYPE_VENTE = { poids: 'kg', volume: 'l', piece: 'pièce' };

function NouveauProduitForm({ ligne, enCours, erreur, onCreer, onFermer }) {
  const libelleDepart = ligne.libelle_brut || ligne.libelle_ticket || '';
  const [nom, setNom] = useState(() => nomProduitPropose(libelleDepart));
  const [typeVente, setTypeVente] = useState(null); // 'poids' | 'volume' | 'piece'
  const [tailleValeur, setTailleValeur] = useState('');
  const [tailleUnite, setTailleUnite] = useState('');

  useEffect(() => {
    const unites = typeVente ? UNITES_PAR_TYPE_VENTE[typeVente] : [];
    if (unites.length && !unites.includes(tailleUnite)) setTailleUnite(unites[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeVente]);

  const peutCreer = nom.trim().length > 0 && !!typeVente && !enCours;

  const creer = () => {
    if (!peutCreer) return;
    const brut = tailleValeur.trim();
    const valeur = brut === '' ? null : Number(brut.replace(',', '.'));
    // Contrainte de la base : quantité et unité vont ensemble, ou aucune des deux.
    const tailleValide = valeur != null && Number.isFinite(valeur) && valeur > 0;
    onCreer({
      nom: nom.trim(),
      typeUnite: typeVente,
      uniteBase: UNITE_BASE_PAR_TYPE_VENTE[typeVente],
      quantiteNette: tailleValide ? valeur : null,
      uniteQuantite: tailleValide ? tailleUnite : null,
    });
  };

  return (
    <div style={{ marginTop: 8, padding: 12, background: '#F5F6F8', borderRadius: 8 }}>
      <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#666', marginBottom: 4 }}>Nom</div>
      <input
        value={nom}
        onChange={e => setNom(e.target.value)}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontFamily: F, fontSize: 13, boxSizing: 'border-box', marginBottom: 10 }}
      />

      <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#666', marginBottom: 4 }}>Vendu comment ?</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['poids', 'Au poids'], ['volume', 'Au litre'], ['piece', 'À la pièce']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTypeVente(id)}
            style={{ flex: 1, padding: '8px 4px', borderRadius: 8, border: 'none', background: typeVente === id ? '#1a1a1a' : '#e8e8e8', color: typeVente === id ? '#fff' : '#333', fontFamily: F, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#666', marginBottom: 4 }}>Taille (facultatif)</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          value={tailleValeur}
          onChange={e => setTailleValeur(e.target.value)}
          placeholder="ex : 500"
          inputMode="decimal"
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontFamily: F, fontSize: 13, boxSizing: 'border-box' }}
        />
        <select
          value={tailleUnite}
          onChange={e => setTailleUnite(e.target.value)}
          disabled={!typeVente}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontFamily: F, fontSize: 13 }}
        >
          {(typeVente ? UNITES_PAR_TYPE_VENTE[typeVente] : []).map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      {erreur && <div style={{ fontFamily: F, fontSize: 12, color: '#CC0000', marginBottom: 8 }}>⚠️ {erreur}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={creer}
          disabled={!peutCreer}
          style={{ flex: 1, padding: 9, borderRadius: 8, border: 'none', background: peutCreer ? '#00B341' : '#ccc', color: '#fff', fontFamily: F, fontWeight: 800, fontSize: 13, cursor: peutCreer ? 'pointer' : 'default' }}
        >
          {enCours ? 'Création...' : 'Créer'}
        </button>
        <button onClick={onFermer} disabled={enCours} style={{ padding: '9px 14px', borderRadius: 8, border: 'none', background: '#eee', color: '#333', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          Fermer
        </button>
      </div>
    </div>
  );
}

function CandidatLigne({ c, enCours, onValider }) {
  const nom = (typeof c?.nom_reference === 'string' && c.nom_reference.trim()) ? c.nom_reference : 'Produit sans nom';
  const quantite = versNombre(c?.quantite);
  const unite = typeof c?.unite === 'string' ? c.unite : '';
  const score = versNombre(c?.score, 0);
  const sur = c?.via === 'alias';
  const desactive = enCours || !c?.produit_id;
  return (
    <div
      onClick={() => { if (!desactive) onValider(c.produit_id, c.variante_id ?? null, nom); }}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px', background: '#F5F6F8', borderRadius: 8, cursor: desactive ? 'default' : 'pointer', opacity: enCours ? 0.6 : 1 }}
    >
      <div style={{ fontFamily: F, fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
        {nom}
        {quantite != null && (
          <span style={{ fontWeight: 500, color: '#999' }}> · {quantite}{unite}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {sur && (
          <span style={{ fontFamily: F, fontSize: 10, fontWeight: 900, color: '#fff', background: '#00B341', borderRadius: 99, padding: '2px 7px' }}>SÛR</span>
        )}
        <span style={{ fontFamily: F, fontSize: 12, fontWeight: 800, color: '#666' }}>{Math.round(score * 100)}%</span>
      </div>
    </div>
  );
}

function LigneCard({ ligne, resultat, validation, enCours, erreurAction, onValider, onCreerProduit, onAnnuler, nouveauProduitOuvert, onToggleNouveauProduit }) {
  if (validation) {
    return (
      <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderLeft: '4px solid #00B341' }}>
        <div style={{ fontFamily: F, fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
          {ligne.libelle_brut || ligne.libelle_ticket || '(libellé vide)'}
        </div>
        <div style={{ fontFamily: F, fontSize: 13, fontWeight: 800, color: '#00B341', marginTop: 6 }}>
          {validation.creationProduit
            ? `✓ créé et rattaché : ${validation.produitNom}`
            : `✓ rattaché à « ${validation.produitNom} »`}
        </div>
        {erreurAction && <div style={{ fontFamily: F, fontSize: 12, color: '#CC0000', marginTop: 6 }}>⚠️ {erreurAction}</div>}
        <button onClick={onAnnuler} disabled={enCours} style={{ marginTop: 8, padding: '7px 12px', borderRadius: 8, border: 'none', background: '#eee', color: '#333', fontFamily: F, fontWeight: 800, fontSize: 12, cursor: enCours ? 'default' : 'pointer', opacity: enCours ? 0.6 : 1 }}>
          {enCours ? 'Annulation...' : 'Annuler'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 14, color: '#1a1a1a' }}>
            {ligne.libelle_brut || ligne.libelle_ticket || '(libellé vide)'}
          </div>
          <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 2 }}>
            {formatDateFr(ligne.tickets?.date_ticket)} · ×{versNombre(ligne.quantite, 1)}
          </div>
        </div>
        <div style={{ fontFamily: F, fontWeight: 800, fontSize: 13, color: '#1a1a1a', flexShrink: 0 }}>
          {formatMontant(ligne)}
        </div>
      </div>

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #eee' }}>
        {erreurAction && <div style={{ fontFamily: F, fontSize: 12, color: '#CC0000', marginBottom: 8 }}>⚠️ {erreurAction}</div>}
        {!resultat && (
          <div style={{ fontFamily: F, fontSize: 12, color: '#aaa' }}>Recherche de candidats...</div>
        )}
        {resultat?.erreur && (
          <div style={{ fontFamily: F, fontSize: 12, color: '#CC0000' }}>⚠️ {resultat.erreur}</div>
        )}
        {resultat?.candidats && resultat.candidats.length === 0 && (
          <div style={{ fontFamily: F, fontSize: 12, color: '#aaa' }}>Aucun candidat proche trouvé.</div>
        )}
        {resultat?.candidats && resultat.candidats.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {resultat.candidats.map((c, i) => (
              <CandidatLigne
                key={`${c?.produit_id ?? 'x'}_${c?.variante_id ?? 'sv'}_${i}`}
                c={c}
                enCours={enCours}
                onValider={onValider}
              />
            ))}
          </div>
        )}

        <button onClick={onToggleNouveauProduit} disabled={enCours} style={{ marginTop: 8, padding: '7px 12px', borderRadius: 8, border: '1px dashed #ccc', background: 'transparent', color: '#666', fontFamily: F, fontWeight: 700, fontSize: 12, cursor: enCours ? 'default' : 'pointer' }}>
          + Nouveau produit
        </button>
        {nouveauProduitOuvert && (
          <NouveauProduitForm
            ligne={ligne}
            enCours={enCours}
            erreur={erreurAction}
            onCreer={onCreerProduit}
            onFermer={onToggleNouveauProduit}
          />
        )}
      </div>
    </div>
  );
}

export default function AValiderSheet({ onClose }) {
  const [lignes, setLignes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [candidatsParLigne, setCandidatsParLigne] = useState({});
  const [validations, setValidations] = useState({}); // ligneId -> { produitNom, ancienEtat, prixCree, aliasId }
  const [enCoursParLigne, setEnCoursParLigne] = useState({});
  const [erreurActionParLigne, setErreurActionParLigne] = useState({});
  const [nouveauProduitOuvertPour, setNouveauProduitOuvertPour] = useState(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      setChargement(true);
      setErreur(null);
      try {
        const { data, error } = await supabase
          .from('lignes_ticket')
          .select(`
            id, libelle_brut, libelle_ticket, quantite, montant_net, prix_unitaire,
            produit_id, variante_produit_id, statut_validation_produit, methode_validation_produit,
            produit_valide_le, produit_valide_par, statut_validation_variante, methode_validation_variante,
            variante_validee_le, variante_validee_par, association_corrigee_utilisateur,
            tickets!inner(date_ticket)
          `)
          .eq('type_ligne', 'produit')
          .or('statut_validation_produit.eq.non_valide,produit_id.is.null')
          .order('cree_le', { ascending: false })
          .limit(50);
        if (annule) return;
        if (error) {
          setErreur("Impossible de charger les lignes à valider.");
          setLignes([]);
        } else {
          setLignes(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (!annule) { console.error('[AValiderSheet] chargement des lignes :', e); setErreur("Impossible de charger les lignes à valider."); setLignes([]); }
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, []);

  useEffect(() => {
    if (lignes.length === 0) return;
    let annule = false;
    (async () => {
      const resultats = {};
      await Promise.all(lignes.map(async (ligne) => {
        const libelle = ligne.libelle_brut || ligne.libelle_ticket;
        if (!libelle) { resultats[ligne.id] = { candidats: [] }; return; }
        try {
          const { data, error } = await supabase.rpc('trouver_produits_proches', {
            p_libelle: libelle,
            p_quantite: null,
          });
          if (error) {
            const cacheProbable = /not find the function|schema cache/i.test(error.message || '');
            resultats[ligne.id] = {
              erreur: cacheProbable
                ? "Fonction introuvable côté API — cache de schéma PostgREST à recharger (NOTIFY pgrst, 'reload schema';)."
                : "Recherche de candidats impossible pour cette ligne.",
            };
            return;
          }
          resultats[ligne.id] = { candidats: Array.isArray(data) ? data.slice(0, 4) : [] };
        } catch (e) {
          console.error('[AValiderSheet] recherche de candidats :', e);
          resultats[ligne.id] = { erreur: "Recherche de candidats impossible pour cette ligne." };
        }
      }));
      if (!annule) setCandidatsParLigne(resultats);
    })();
    return () => { annule = true; };
  }, [lignes]);

  const valider = async (ligne, produitId, varianteId, produitNom) => {
    const ligneId = ligne.id;
    const libelleAlias = ligne.libelle_brut || ligne.libelle_ticket;
    setEnCoursParLigne(prev => ({ ...prev, [ligneId]: true }));
    setErreurActionParLigne(prev => ({ ...prev, [ligneId]: null }));
    try {
      const { data, error } = await supabase.rpc('valider_ligne_dev_avec_alias', {
        p_ligne_ticket_id: ligneId,
        p_produit_id: produitId,
        p_variante_produit_id: varianteId,
        p_libelle_alias: libelleAlias,
      });
      if (error) {
        setErreurActionParLigne(prev => ({ ...prev, [ligneId]: messageErreurRpc(error, 'valider_ligne_dev_avec_alias') }));
        return;
      }
      setValidations(prev => ({
        ...prev,
        [ligneId]: {
          produitNom,
          ancienEtat: data?.ancien_etat ?? null,
          prixCree: !!data?.prix_cree,
          aliasId: data?.alias_id ?? null,
        },
      }));
    } catch (e) {
      console.error('[AValiderSheet] validation :', e);
      setErreurActionParLigne(prev => ({ ...prev, [ligneId]: "Action impossible, réessaie." }));
    } finally {
      setEnCoursParLigne(prev => ({ ...prev, [ligneId]: false }));
    }
  };

  const creerProduit = async (ligne, valeurs) => {
    const ligneId = ligne.id;
    const libelleAlias = ligne.libelle_brut || ligne.libelle_ticket;
    setEnCoursParLigne(prev => ({ ...prev, [ligneId]: true }));
    setErreurActionParLigne(prev => ({ ...prev, [ligneId]: null }));
    try {
      const { data, error } = await supabase.rpc('creer_produit_et_valider_ligne_dev', {
        p_ligne_ticket_id: ligneId,
        p_nom: valeurs.nom,
        p_type_unite: valeurs.typeUnite,
        p_unite_base: valeurs.uniteBase,
        p_quantite_nette: valeurs.quantiteNette,
        p_unite_quantite: valeurs.uniteQuantite,
        p_libelle_alias: libelleAlias,
      });
      if (error) {
        // Message de la RPC affiché tel quel (ex : produit déjà existant).
        setErreurActionParLigne(prev => ({ ...prev, [ligneId]: messageErreurRpc(error, 'creer_produit_et_valider_ligne_dev') }));
        return;
      }
      setValidations(prev => ({
        ...prev,
        [ligneId]: {
          produitNom: valeurs.nom,
          ancienEtat: data?.ancien_etat ?? null,
          prixCree: !!data?.prix_cree,
          aliasId: data?.alias_id ?? null,
          creationProduit: { produitId: data?.produit_id ?? null, varianteId: data?.variante_id ?? null },
        },
      }));
      setNouveauProduitOuvertPour(null);
    } catch (e) {
      console.error('[AValiderSheet] création produit :', e);
      setErreurActionParLigne(prev => ({ ...prev, [ligneId]: "Création impossible, réessaie." }));
    } finally {
      setEnCoursParLigne(prev => ({ ...prev, [ligneId]: false }));
    }
  };

  const annuler = async (ligne) => {
    const ligneId = ligne.id;
    const validation = validations[ligneId];
    if (!validation) return;
    setEnCoursParLigne(prev => ({ ...prev, [ligneId]: true }));
    setErreurActionParLigne(prev => ({ ...prev, [ligneId]: null }));
    try {
      const { error } = validation.creationProduit
        ? await supabase.rpc('annuler_creation_produit_dev', {
            p_ligne_ticket_id: ligneId,
            p_ancien_etat: validation.ancienEtat,
            p_alias_id: validation.aliasId,
            p_produit_id: validation.creationProduit.produitId,
            p_variante_id: validation.creationProduit.varianteId,
          })
        : await supabase.rpc('annuler_validation_ligne_dev', {
            p_ligne_ticket_id: ligneId,
            p_ancien_etat: validation.ancienEtat,
            p_prix_cree: validation.prixCree,
            p_alias_id: validation.aliasId,
          });
      if (error) {
        setErreurActionParLigne(prev => ({ ...prev, [ligneId]: messageErreurRpc(error, validation.creationProduit ? 'annuler_creation_produit_dev' : 'annuler_validation_ligne_dev') }));
        return;
      }
      setValidations(prev => { const next = { ...prev }; delete next[ligneId]; return next; });
    } catch (e) {
      console.error('[AValiderSheet] annulation :', e);
      setErreurActionParLigne(prev => ({ ...prev, [ligneId]: "Annulation impossible, réessaie." }));
    } finally {
      setEnCoursParLigne(prev => ({ ...prev, [ligneId]: false }));
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#F5F6F8', zIndex: 400, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#1a1a1a', color: '#fff', padding: '16px 20px calc(12px + env(safe-area-inset-top, 0px))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 16 }}>🔍 À valider — dev</div>
          <div style={{ fontFamily: F, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            Chantier anti-doublon — validation ligne par ligne
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 99, width: 30, height: 30, color: '#fff', fontSize: 15, cursor: 'pointer' }}>✕</button>
      </div>

      <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, padding: '14px 14px calc(14px + env(safe-area-inset-bottom, 0px))' }}>
        {chargement && (
          <div style={{ textAlign: 'center', padding: '30px 0', fontFamily: F, fontSize: 13, color: '#888' }}>Chargement...</div>
        )}
        {erreur && (
          <div style={{ fontFamily: F, fontSize: 13, color: '#CC0000', padding: '12px 0' }}>⚠️ {erreur}</div>
        )}
        {!chargement && !erreur && lignes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 0', fontFamily: F, fontSize: 13, color: '#888' }}>
            Aucune ligne à valider — tout est déjà rattaché.
          </div>
        )}

        {lignes.map(ligne => (
          <LigneErrorBoundary key={ligne.id}>
            <LigneCard
              ligne={ligne}
              resultat={candidatsParLigne[ligne.id]}
              validation={validations[ligne.id]}
              enCours={!!enCoursParLigne[ligne.id]}
              erreurAction={erreurActionParLigne[ligne.id]}
              onValider={(produitId, varianteId, produitNom) => valider(ligne, produitId, varianteId, produitNom)}
              onCreerProduit={(valeurs) => creerProduit(ligne, valeurs)}
              onAnnuler={() => annuler(ligne)}
              nouveauProduitOuvert={nouveauProduitOuvertPour === ligne.id}
              onToggleNouveauProduit={() => setNouveauProduitOuvertPour(prev => prev === ligne.id ? null : ligne.id)}
            />
          </LigneErrorBoundary>
        ))}
      </div>
    </div>
  );
}
