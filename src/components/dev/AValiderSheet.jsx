import { Component, useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import BarcodeScannerSheet from '../BarcodeScannerSheet';
import RechercheProduitSheet from '../admin/RechercheProduitSheet';
import { ficheOFF, cloudinaryFetch } from '../../lib/photosProduits';
import { termesRechercheOff } from '../../lib/rechercheRepli';

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

// Chantier 101 — filet de sécurité du scan. Le code-barres fait autorité côté
// base (lever_doute_par_code_barres relie sans rien demander), donc viser la
// mauvaise ligne écrit instantanément une fausse association, un faux alias ET
// un faux prix. On regarde donc le code AVANT d'appeler la RPC, on montre à
// quoi il correspond, et on n'écrit qu'après confirmation explicite.

// Mots significatifs d'un libellé, pour comparer « ce que dit le ticket » et
// « ce que dit le code-barres ». Volontairement grossier : il ne s'agit pas de
// décider à la place de l'utilisateur, seulement de lever un drapeau quand les
// deux n'ont visiblement rien en commun.
function motsCles(texte) {
  return new Set(
    (texte || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(mot => mot.length >= 4)
  );
}

function libellesConcordent(libelleTicket, nomProduit) {
  const a = motsCles(libelleTicket);
  const b = motsCles(nomProduit);
  if (a.size === 0 || b.size === 0) return true; // rien à comparer : pas d'alerte
  for (const mot of a) if (b.has(mot)) return true;
  return false;
}


// Chantier 103 — la carte « Ce produit ? ». La PHOTO est le point de
// vérification : elle est affichée AVANT toute écriture, et rien n'est écrit
// tant que l'utilisateur n'a pas reconnu l'article qu'il tient en main.
// Cloudinary indisponible -> repli sur l'URL OFF brute -> repli sur un carré
// vide : à aucun moment un échec d'image ne bloque l'écran.
function AssistantOffCard({ assistant, enCours, onOuiChoisir, onCeNestPasCa, onFermer }) {
  const { off, libelle, libelleTicket, code } = assistant;
  const sourceOff = off.imageLarge || off.imageSmall || null;
  const [srcImage, setSrcImage] = useState(() => cloudinaryFetch(sourceOff, 'large'));
  const identite = [off.marque, off.nom, off.quantite].filter(Boolean).join(' · ');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 560, display: 'flex', alignItems: 'flex-end' }} onClick={onFermer}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontFamily: F, fontWeight: 900, fontSize: 18, color: '#1a1a1a' }}>Ce produit ?</div>
            <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 2 }}>
              Code inconnu de notre base · {code} · fiche Open Food Facts
            </div>
          </div>
          <button onClick={onFermer} style={{ flexShrink: 0, background: '#F5F6F8', border: 'none', borderRadius: 99, width: 28, height: 28, color: '#999', fontSize: 14, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ marginTop: 14, padding: 12, background: '#F5F6F8', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 96, height: 96, borderRadius: 10, background: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {srcImage ? (
              <img
                src={srcImage}
                alt=""
                loading="lazy"
                onError={() => setSrcImage(prev => (prev !== sourceOff ? sourceOff : null))}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <span style={{ fontSize: 26 }}>📦</span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#666' }}>OPEN FOOD FACTS DIT</div>
            <div style={{ fontFamily: F, fontSize: 15, fontWeight: 900, color: '#1a1a1a', marginTop: 3, lineHeight: 1.3 }}>
              {identite || '(fiche sans nom)'}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, padding: 12, background: '#F5F6F8', borderRadius: 12 }}>
          <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#666' }}>LIGNE DU TICKET</div>
          <div style={{ fontFamily: F, fontSize: 14, fontWeight: 800, color: '#1a1a1a', marginTop: 3 }}>
            « {libelle || '(libellé vide)'} »
          </div>
          {libelleTicket && libelleTicket !== libelle && (
            <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: '#666', marginTop: 5 }}>
              Texte imprimé : {libelleTicket}
            </div>
          )}
        </div>

        <div style={{ fontFamily: F, fontSize: 14, fontWeight: 900, color: '#1a1a1a', marginTop: 14, lineHeight: 1.4 }}>
          C'est bien le produit que tu tiens en main ?
        </div>
        <div style={{ fontFamily: F, fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.4 }}>
          Aucune fiche n'est créée automatiquement : tu choisis toi-même la fiche du catalogue.
        </div>

        <button
          onClick={onOuiChoisir}
          disabled={enCours}
          style={{ width: '100%', marginTop: 14, padding: 14, border: 'none', borderRadius: 12, background: enCours ? '#ccc' : '#00B341', color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 15, cursor: enCours ? 'default' : 'pointer' }}
        >
          ✓ Oui — choisir la fiche du catalogue
        </button>
        <button
          onClick={onCeNestPasCa}
          disabled={enCours}
          style={{ width: '100%', marginTop: 8, padding: 12, border: '1px solid #ddd', borderRadius: 12, background: 'transparent', color: '#333', fontFamily: F, fontWeight: 800, fontSize: 14, cursor: enCours ? 'default' : 'pointer' }}
        >
          Ce n'est pas ça / je ne trouve pas
        </button>
        <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 8, textAlign: 'center', lineHeight: 1.4 }}>
          « Ce n'est pas ça » reprend le comportement habituel : la ligne part en file de validation. Fermer (✕) ne change rien.
        </div>
      </div>
    </div>
  );
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

function LigneCard({ ligne, resultat, validation, enCours, erreurAction, onValider, onCreerProduit, onAnnuler, nouveauProduitOuvert, onToggleNouveauProduit, onScanner }) {
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

        {/* Chantier 101 — le scan du code-barres tranche la ligne tout de suite
            (code = vérité). Option EN PLUS : le raccrochage manuel ci-dessous
            reste strictement inchangé. */}
        <button
          onClick={onScanner}
          disabled={enCours}
          style={{ width: '100%', padding: '9px 12px', marginBottom: 10, border: '1.5px dashed #0066FF', borderRadius: 10, background: 'transparent', color: '#0066FF', fontFamily: F, fontWeight: 800, fontSize: 13, cursor: enCours ? 'default' : 'pointer', opacity: enCours ? 0.6 : 1 }}
        >
          📷 Scanner le code-barres
        </button>

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
  // Chantier 101 — scanCible : ligne dont on scanne le code-barres (caméra
  // ouverte). resultatScan : bandeau de résultat, volontairement PERSISTANT
  // (fermé par l'utilisateur, jamais par une minuterie) — après un scan, la
  // ligne disparaît de la liste et un message fugace laisserait croire à une
  // ligne « perdue ». Forme : { ton, titre, detail, libelle }.
  const [scanCible, setScanCible] = useState(null);
  const [resultatScan, setResultatScan] = useState(null);
  // Chantier 101 — confirmation obligatoire avant toute écriture :
  // { ligneId, libelle, code, variante | null, concordent }.
  const [confirmationScan, setConfirmationScan] = useState(null);
  // Texte de l'écran d'attente (null = pas d'attente) — il change selon l'étape
  // (lecture du code, puis interrogation d'Open Food Facts).
  const [rechercheCode, setRechercheCode] = useState(null);
  // Chantier 103 — assistant OpenFoodFacts pour un code INCONNU :
  // { ligneId, libelle, libelleTicket, code, off }. Purement additif : il ne
  // s'intercale que là où la ligne partait en file sans autre information.
  const [assistantOff, setAssistantOff] = useState(null);
  const [rechercheCatalogue, setRechercheCatalogue] = useState(false);

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

  // Chantier 101 — retire une ligne tranchée (validée ou partie en file) de la
  // liste, et nettoie les états attachés à son identifiant.
  const retirerLigne = (ligneId) => {
    setLignes(prev => prev.filter(l => l.id !== ligneId));
    setCandidatsParLigne(prev => { const next = { ...prev }; delete next[ligneId]; return next; });
    setErreurActionParLigne(prev => { const next = { ...prev }; delete next[ligneId]; return next; });
    setNouveauProduitOuvertPour(prev => (prev === ligneId ? null : prev));
  };

  // Chantier 101 — code décodé : la base tranche (lever_doute_par_code_barres,
  // SECURITY DEFINER). Le front n'envoie que le code brut (le rattrapage
  // UPC-A/EAN-13 et le garde-fou de propriété sont côté base) et se contente de
  // réagir au statut renvoyé. Toute erreur laisse la ligne en place.
  // useCallback : identité stable tant que la même ligne est scannée — le
  // lecteur @zxing garde `onDetected` en dépendance d'effet, une nouvelle
  // identité à chaque rendu rouvrirait la caméra en boucle. La cible porte son
  // libellé pour que le bandeau puisse nommer l'article même une fois la ligne
  // retirée de la liste.
  const echecScan = (ligneId, libelle, texte) => {
    setErreurActionParLigne(prev => ({ ...prev, [ligneId]: texte }));
    setResultatScan({ ton: 'erreur', titre: 'Scan impossible, réessaie', detail: "La ligne reste dans la liste ci-dessous.", libelle });
  };

  // Étape 1 — code décodé : on NE PROPAGE RIEN encore. On cherche à quoi ce
  // code correspond (même rattrapage UPC-A/EAN-13 que la base) et on prépare
  // l'écran de confirmation. Aucune écriture à ce stade.
  const onCodeDetecte = useCallback(async (codeBrut) => {
    const cible = scanCible;
    if (!cible?.id) return;
    const ligneId = cible.id;
    const libelle = cible.libelle;
    setScanCible(null);
    const code = (codeBrut || '').replace(/\s+/g, '');
    if (!code) { echecScan(ligneId, libelle, "Scan impossible, réessaie."); return; }

    setRechercheCode('Lecture du code-barres...');
    try {
      const candidats = [code];
      if (/^\d{12}$/.test(code)) candidats.push('0' + code);
      if (/^0\d{12}$/.test(code)) candidats.push(code.slice(1));

      const { data: cbv, error: errCbv } = await supabase
        .from('codes_barres_variante')
        .select('variante_produit_id')
        .in('code_barres', candidats)
        .limit(1);
      if (errCbv) { echecScan(ligneId, libelle, "Recherche du code-barres impossible, réessaie."); return; }

      let variante = null;
      if (cbv && cbv[0]) {
        const { data } = await supabase
          .from('variantes_produit')
          .select('id, produit_id, libelle, quantite_nette, unite_quantite, url_image, produits(nom_reference), marques(nom)')
          .eq('id', cbv[0].variante_produit_id)
          .eq('actif', true)
          .maybeSingle();
        variante = data ?? null;
      }

      // Chantier 103 — CODE INCONNU : avant de laisser la ligne partir en file,
      // on demande à OpenFoodFacts à quoi ce code correspond. Si OFF sait, on
      // montre sa photo et on propose l'assignation en un geste ; s'il ne sait
      // pas (ou est indisponible/lent), on retombe exactement sur l'écran de
      // confirmation d'avant. Aucune écriture n'est déclenchée ici.
      if (!variante) {
        setRechercheCode('Recherche du produit sur Open Food Facts...');
        let off = null;
        try {
          off = await ficheOFF(code);
        } catch (e) {
          console.error('[AValiderSheet] fiche Open Food Facts :', e);
          off = null;
        }
        if (off) {
          setAssistantOff({ ligneId, libelle, libelleTicket: cible.libelleTicket, code, off });
          return;
        }
      }

      const nomProduit = variante?.produits?.nom_reference || '';
      // La comparaison porte sur le libellé affiché ET le texte brut du ticket :
      // quand le mapping d'import s'est trompé (« Pâte à tartiner » pour
      // MADELEINE PEPITE CHOC), c'est le texte du ticket qui dit vrai, et lui
      // seul concorde avec le produit désigné par le code.
      setConfirmationScan({
        ligneId,
        libelle,
        libelleTicket: cible.libelleTicket,
        code,
        variante,
        concordent: variante
          ? libellesConcordent(`${libelle} ${cible.libelleTicket || ''}`, `${nomProduit} ${variante.libelle || ''} ${variante.marques?.nom || ''}`)
          : true,
      });
    } catch (e) {
      console.error('[AValiderSheet] recherche du code-barres :', e);
      echecScan(ligneId, libelle, "Recherche du code-barres impossible, réessaie.");
    } finally {
      setRechercheCode(null);
    }
  }, [scanCible]);

  // Chantier 103 — l'utilisateur a reconnu le produit sur la photo OFF puis
  // choisi une fiche du catalogue. On emprunte le MÊME chemin que l'assignation
  // manuelle existante (valider_ligne_dev_avec_alias : association + prix +
  // alias), puis on rejoue le scan habituel (lever_doute_par_code_barres) : la
  // ligne portant maintenant produit + variante, la base apprend le code
  // elle-même ('appris_direct'). Aucune fiche n'est jamais créée ici.
  const assignerDepuisAssistant = async ({ produitId, varianteId, nomProduit }) => {
    const a = assistantOff;
    if (!a) return { ok: false, message: "Assistant fermé, refais le scan." };
    const { ligneId, libelle, code } = a;
    const ligne = lignes.find(l => l.id === ligneId);
    const libelleAlias = ligne ? (ligne.libelle_brut || ligne.libelle_ticket) : libelle;

    setEnCoursParLigne(prev => ({ ...prev, [ligneId]: true }));
    setErreurActionParLigne(prev => ({ ...prev, [ligneId]: null }));
    try {
      const { error } = await supabase.rpc('valider_ligne_dev_avec_alias', {
        p_ligne_ticket_id: ligneId,
        p_produit_id: produitId,
        p_variante_produit_id: varianteId ?? null,
        p_libelle_alias: libelleAlias,
      });
      if (error) {
        // Rien n'a été écrit : la feuille de recherche reste ouverte avec le
        // message, la ligne reste dans la liste.
        const message = messageErreurRpc(error, 'valider_ligne_dev_avec_alias');
        setErreurActionParLigne(prev => ({ ...prev, [ligneId]: message }));
        return { ok: false, message };
      }

      // Le rattachement est acquis. L'apprentissage du code est une étape EN
      // PLUS : s'il échoue, on le dit, on ne fait pas croire à un demi-succès.
      let statut = null;
      let erreurApprentissage = null;
      try {
        const { data, error: errCode } = await supabase.rpc('lever_doute_par_code_barres', {
          p_ligne_ticket_id: ligneId,
          p_code_barres: code,
        });
        if (errCode) erreurApprentissage = messageErreurRpc(errCode, 'lever_doute_par_code_barres');
        else statut = data?.statut ?? null;
      } catch (e) {
        console.error('[AValiderSheet] apprentissage du code après assistant OFF :', e);
        erreurApprentissage = "le code-barres n'a pas pu être appris";
      }

      setRechercheCatalogue(false);
      setAssistantOff(null);
      retirerLigne(ligneId);

      if (statut === 'appris_direct' || statut === 'valide_auto') {
        setResultatScan({
          ton: 'succes',
          titre: `✓ Rattaché à « ${nomProduit} » — code-barres appris`,
          detail: "La ligne a quitté cette liste : au prochain scan, ce code sera reconnu tout seul.",
          libelle,
        });
      } else if (statut === 'inconnu_en_file' || statut === 'conflit_en_file') {
        setResultatScan({
          ton: 'attente',
          titre: `Rattaché à « ${nomProduit} » — le code-barres part en file`,
          detail: "L'article est rattaché, mais le code attend une validation dans 🧾 Validation scan (cas fréquent quand la fiche choisie n'a aucun format enregistré).",
          libelle,
        });
      } else {
        setResultatScan({
          ton: 'attente',
          titre: `Rattaché à « ${nomProduit} » — code-barres NON appris`,
          detail: erreurApprentissage
            ? `L'article est bien rattaché, mais ${erreurApprentissage}. Tu peux rescanner ce code plus tard.`
            : "L'article est bien rattaché, mais la réponse du serveur sur le code-barres était inattendue. Tu peux rescanner ce code plus tard.",
          libelle,
        });
      }
      return { ok: true };
    } catch (e) {
      console.error('[AValiderSheet] assignation depuis l\'assistant OFF :', e);
      const message = "Assignation impossible, réessaie.";
      setErreurActionParLigne(prev => ({ ...prev, [ligneId]: message }));
      return { ok: false, message };
    } finally {
      setEnCoursParLigne(prev => ({ ...prev, [ligneId]: false }));
    }
  };

  // Chantier 103 — « ce n'est pas ça » / abandon de l'assistant : on repasse
  // exactement par l'écran de confirmation d'avant (code inconnu -> file).
  const retomberSurLaFile = () => {
    const a = assistantOff;
    if (!a) return;
    setAssistantOff(null);
    setConfirmationScan({
      ligneId: a.ligneId,
      libelle: a.libelle,
      libelleTicket: a.libelleTicket,
      code: a.code,
      variante: null,
      concordent: true,
    });
  };

  // Étape 2 — l'utilisateur a confirmé : là seulement on écrit.
  const appliquerScan = async () => {
    const c = confirmationScan;
    if (!c) return;
    const { ligneId, libelle, code } = c;
    setConfirmationScan(null);
    const echec = (texte) => echecScan(ligneId, libelle, texte);
    setEnCoursParLigne(prev => ({ ...prev, [ligneId]: true }));
    setErreurActionParLigne(prev => ({ ...prev, [ligneId]: null }));
    try {
      const { data, error } = await supabase.rpc('lever_doute_par_code_barres', {
        p_ligne_ticket_id: ligneId,
        p_code_barres: code,
      });
      if (error) {
        echec(`Scan impossible, réessaie — ${messageErreurRpc(error, 'lever_doute_par_code_barres')}`);
        return;
      }
      const statut = data?.statut;
      if (statut === 'valide_auto' || statut === 'appris_direct') {
        retirerLigne(ligneId);
        setResultatScan({
          ton: 'succes',
          titre: '✓ Reconnu et validé — article rattaché (+10 points)',
          detail: "La ligne a quitté cette liste : elle est traitée, il n'y a plus rien à faire.",
          libelle,
        });
      } else if (statut === 'conflit_en_file' || statut === 'inconnu_en_file') {
        retirerLigne(ligneId);
        setResultatScan({
          ton: 'attente',
          titre: 'Envoyé pour validation — retrouve-le dans 🧾 Validation scan',
          detail: "La ligne a quitté cette liste : elle attend maintenant dans la console de validation (+10 points en attente).",
          libelle,
        });
      } else {
        // Statut inattendu : on ne touche à rien et on le dit honnêtement.
        console.warn('[AValiderSheet] statut inattendu de lever_doute_par_code_barres :', data);
        echec("Réponse inattendue du serveur — la ligne reste à valider.");
      }
    } catch (e) {
      console.error('[AValiderSheet] levée de doute par code-barres :', e);
      echec("Scan impossible, réessaie.");
    } finally {
      setEnCoursParLigne(prev => ({ ...prev, [ligneId]: false }));
    }
  };

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

      {/* Chantier 101 — bandeau de résultat du scan : reste affiché jusqu'à ce
          que l'utilisateur ferme (aucune minuterie), parce qu'un scan réussi
          fait disparaître la ligne de la liste et que le message est la seule
          explication de cette disparition. */}
      {resultatScan && (
        <div style={{
          background: resultatScan.ton === 'succes' ? '#00B341' : resultatScan.ton === 'attente' ? '#0066FF' : '#CC0000',
          color: '#fff', padding: '12px 16px calc(12px)', flexShrink: 0,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F, fontWeight: 900, fontSize: 13 }}>{resultatScan.titre}</div>
            {resultatScan.libelle && (
              <div style={{ fontFamily: F, fontWeight: 800, fontSize: 12, opacity: 0.9, marginTop: 3 }}>
                « {resultatScan.libelle} »
              </div>
            )}
            {resultatScan.detail && (
              <div style={{ fontFamily: F, fontSize: 12, lineHeight: 1.4, opacity: 0.9, marginTop: 3 }}>{resultatScan.detail}</div>
            )}
          </div>
          <button
            onClick={() => setResultatScan(null)}
            style={{ flexShrink: 0, background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 8, padding: '7px 14px', color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 13, cursor: 'pointer' }}
          >
            OK
          </button>
        </div>
      )}

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
              onScanner={() => {
                setErreurActionParLigne(prev => ({ ...prev, [ligne.id]: null }));
                setResultatScan(null);
                setScanCible({
                  id: ligne.id,
                  libelle: ligne.libelle_brut || ligne.libelle_ticket || '',
                  libelleTicket: ligne.libelle_ticket || '',
                });
              }}
            />
          </LigneErrorBoundary>
        ))}
      </div>

      {/* Chantier 101 — même lecteur @zxing que CorrigerProduitSheet (composant
          partagé, configuration inchangée). Caméra fermée dès qu'un code est lu
          ou à l'annulation. */}
      {scanCible && (
        <BarcodeScannerSheet onDetected={onCodeDetecte} onClose={() => setScanCible(null)} />
      )}

      {rechercheCode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 550, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '16px 22px', fontFamily: F, fontSize: 13, fontWeight: 800, color: '#1a1a1a', textAlign: 'center', maxWidth: '80%' }}>
            {rechercheCode}
          </div>
        </div>
      )}

      {/* Chantier 103 — assistant OpenFoodFacts (code inconnu uniquement).
          Il ne remplace jamais le filet du chantier 101 : soit l'utilisateur
          reconnaît le produit et choisit une fiche, soit on revient à l'écran
          de confirmation « Code inconnu de la base ». */}
      {assistantOff && !rechercheCatalogue && (
        <AssistantOffCard
          assistant={assistantOff}
          enCours={!!enCoursParLigne[assistantOff.ligneId]}
          onOuiChoisir={() => setRechercheCatalogue(true)}
          onCeNestPasCa={retomberSurLaFile}
          onFermer={() => setAssistantOff(null)}
        />
      )}

      {assistantOff && rechercheCatalogue && (
        <RechercheProduitSheet
          titre="Choisir la fiche du catalogue"
          sousTitre={[assistantOff.off.marque, assistantOff.off.nom, assistantOff.off.quantite].filter(Boolean).join(' · ') || assistantOff.code}
          requeteInitiale={termesRechercheOff(assistantOff.off)}
          repliProgressif
          onClose={() => setRechercheCatalogue(false)}
          onChoisir={assignerDepuisAssistant}
        />
      )}

      {/* Chantier 101 — LE filet de sécurité : rien n'est écrit tant que
          l'utilisateur n'a pas vu à quoi le code correspond, en face du libellé
          de la ligne visée. C'est ce qui manquait quand un code de pâtes scanné
          sur une ligne de glace a été rattaché sans un mot. */}
      {confirmationScan && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 560, display: 'flex', alignItems: 'flex-end' }} onClick={() => setConfirmationScan(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
            <div style={{ fontFamily: F, fontWeight: 900, fontSize: 16, color: '#1a1a1a' }}>
              {confirmationScan.variante ? 'Confirmer le rattachement' : 'Code inconnu de la base'}
            </div>
            <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 2 }}>Code lu : {confirmationScan.code}</div>

            <div style={{ marginTop: 14, padding: 12, background: '#F5F6F8', borderRadius: 10 }}>
              <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#666' }}>LIGNE DU TICKET</div>
              <div style={{ fontFamily: F, fontSize: 14, fontWeight: 800, color: '#1a1a1a', marginTop: 3 }}>
                « {confirmationScan.libelle || '(libellé vide)'} »
              </div>
              {confirmationScan.libelleTicket && confirmationScan.libelleTicket !== confirmationScan.libelle && (
                <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: '#666', marginTop: 5 }}>
                  Texte imprimé : {confirmationScan.libelleTicket}
                </div>
              )}
            </div>

            <div style={{ marginTop: 10, padding: 12, background: '#F5F6F8', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
              {confirmationScan.variante?.url_image && (
                <img src={confirmationScan.variante.url_image} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', background: '#fff', flexShrink: 0 }} />
              )}
              <div>
                <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#666' }}>CE CODE-BARRES DÉSIGNE</div>
                {confirmationScan.variante ? (
                  <div style={{ fontFamily: F, fontSize: 14, fontWeight: 800, color: '#1a1a1a', marginTop: 3 }}>
                    {[confirmationScan.variante.marques?.nom, confirmationScan.variante.produits?.nom_reference, confirmationScan.variante.quantite_nette != null && confirmationScan.variante.unite_quantite
                      ? `${versNombre(confirmationScan.variante.quantite_nette)}${confirmationScan.variante.unite_quantite}` : null].filter(Boolean).join(' · ')}
                  </div>
                ) : (
                  <div style={{ fontFamily: F, fontSize: 13, color: '#666', marginTop: 3, lineHeight: 1.4 }}>
                    Aucun article connu. En continuant, la ligne part en file de validation (ou le code est appris sur le produit déjà associé à cette ligne).
                  </div>
                )}
              </div>
            </div>

            {confirmationScan.variante && !confirmationScan.concordent && (
              <div style={{ marginTop: 10, padding: 12, background: '#FFF3F3', border: '1px solid #F3C5C5', borderRadius: 10, fontFamily: F, fontSize: 13, color: '#CC0000', fontWeight: 700, lineHeight: 1.4 }}>
                ⚠️ Le libellé du ticket et ce produit n'ont rien en commun. Vérifie que tu as bien scanné l'article de CETTE ligne.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={appliquerScan}
                style={{ flex: 1, padding: 13, border: 'none', borderRadius: 12, fontFamily: F, fontWeight: 900, fontSize: 14, color: '#fff', background: confirmationScan.variante && !confirmationScan.concordent ? '#CC0000' : '#00B341', cursor: 'pointer' }}
              >
                {confirmationScan.variante && !confirmationScan.concordent ? 'Rattacher quand même' : 'Oui, rattacher'}
              </button>
              <button
                onClick={() => setConfirmationScan(null)}
                style={{ padding: '13px 18px', border: 'none', borderRadius: 12, fontFamily: F, fontWeight: 800, fontSize: 14, color: '#333', background: '#eee', cursor: 'pointer' }}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
