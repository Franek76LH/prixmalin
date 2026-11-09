// Chantier 119 — écran PLEIN « Identifier ce produit » (SHADOW, François seul).
//
// Une ligne de ticket à la fois : caméra -> recherche (rien d'écrit) -> fiche
// de vérification avec photo -> l'utilisateur confirme lui-même. Toute la
// logique vit dans lib/parcoursIdentification (testée) ; ce composant ne fait
// qu'afficher l'état et relayer les gestes.
//
// Jamais de plantage : caméra refusée -> message + retour ; RPC absente ->
// « Indisponible pour le moment » sur la fiche ; photo en échec -> cadre gris.
import { useCallback, useEffect, useState } from 'react';
import BarcodeScannerSheet from './BarcodeScannerSheet';
import { cloudinaryFetch } from '../lib/photosProduits';
import {
  creerParcoursIdentification, PHRASE_ENGAGEMENT, AVERTISSEMENT_AUCUNE_INFO, doubleLectureRequise,
  PHASE_CAMERA, PHASE_RECHERCHE, PHASE_VERIFICATION, PHASE_REFUS, PHASE_ECRITURE, PHASE_SUCCES, PHASE_FIN,
} from '../lib/parcoursIdentification';
import { DUREE_ANNULATION_MS, SOURCE_BASE, SOURCE_OFF, SCAN_POIDS_VARIABLE, SCAN_ARCHIVE } from '../lib/scanDepuisHistorique';

const F = "'Nunito',sans-serif";
const FOND = '#121417';
const VERT = '#00B341';
const BLEU = '#2E7BFF';
const GRIS_TEXTE = 'rgba(255,255,255,0.65)';

const euros = (n) => (n == null || !Number.isFinite(Number(n)) ? '' : `${Number(n).toFixed(2).replace('.', ',')} €`);
const libelleSource = (s) => (s === SOURCE_BASE ? 'notre base' : s === SOURCE_OFF ? 'Open Food Facts' : 'aucune info');

const STYLE_ANIM = `
@keyframes c119-pop { 0% { transform: scale(0.3); opacity: 0 } 55% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
@keyframes c119-spin { to { transform: rotate(360deg) } }
`;

// Photo : Cloudinary fetch sur l'image OFF ; absente ou en échec -> cadre gris.
function PhotoVerification({ urlOff }) {
  const url = urlOff ? cloudinaryFetch(urlOff, 'large') : null;
  const [echec, setEchec] = useState(false);
  if (!url || echec) {
    return (
      <div style={{ width: '100%', aspectRatio: '1 / 1', maxHeight: '38vh', borderRadius: 16, background: '#3A3F46', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, boxSizing: 'border-box', textAlign: 'center', fontFamily: F, fontWeight: 800, fontSize: 14, color: '#C9CED6' }}>
        Pas de photo disponible — vérifie bien le nom
      </div>
    );
  }
  return (
    <div style={{ width: '100%', aspectRatio: '1 / 1', maxHeight: '38vh', borderRadius: 16, background: '#fff', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={url} alt="" onError={() => setEchec(true)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  );
}

function GrosBouton({ children, onClick, couleur, desactive = false }) {
  return (
    <button onClick={onClick} disabled={desactive}
      style={{ width: '100%', padding: '18px 16px', border: 'none', borderRadius: 16, background: desactive ? '#555' : couleur, color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 19, cursor: desactive ? 'default' : 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,0.35)' }}>
      {children}
    </button>
  );
}

function LienDiscret({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', color: GRIS_TEXTE, fontFamily: F, fontWeight: 800, fontSize: 13, textDecoration: 'underline', cursor: 'pointer', padding: '10px' }}>
      {children}
    </button>
  );
}

export default function IdentifierProduitPlein({ lignes, ligneDepartId, deps, onFermer, onRetourAccueil }) {
  const [etat, setEtat] = useState(null);
  // Un seul parcours pour toute la vie de l'écran (initialisation paresseuse).
  const [p] = useState(() => creerParcoursIdentification({ lignes, ligneDepartId, deps, onChange: (x) => setEtat(x) }));
  const e = etat || p.etat();
  const [imageFigee, setImageFigee] = useState(null);
  const [erreurCamera, setErreurCamera] = useState(null);

  // « ↩ Annuler » : 8 s puis disparition.
  const idAnnulable = e.annulable?.ligneId ?? null;
  useEffect(() => {
    if (!idAnnulable) return;
    const t = setTimeout(() => p.expirerAnnulation(), DUREE_ANNULATION_MS);
    return () => clearTimeout(t);
  }, [idAnnulable, p]);

  // Identité stable (le lecteur garde onDetected en dépendance d'effet).
  const onDetected = useCallback((code, _format, image) => {
    setImageFigee(image || null);
    p.codeLu(code);
  }, [p]);
  const onErreurCamera = useCallback((message) => setErreurCamera(message), []);

  // La croix : fermer ≠ passer — rien n'est marqué ni écrit.
  const fermer = () => onFermer?.(p.fermer());
  const LIBELLE_SANS_CODE = 'Pas de code-barres (vrac, boucherie…)';

  const { rang, total } = p.position();
  const ligne = e.ligne;

  // ── En-tête : ligne du ticket en gros + phrase d'engagement ──────────────
  const entete = (avecFermer) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: F, fontSize: 11, fontWeight: 900, color: GRIS_TEXTE, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {ligne ? `Ligne ${rang} / ${total}` : 'Identifier ce produit'}
        </span>
        {e.annulable && (
          <button onClick={() => p.annuler()}
            style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 99, padding: '4px 10px', color: '#fff', fontFamily: F, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
            ↩ Annuler
          </button>
        )}
        {avecFermer && (
          <button onClick={fermer} aria-label="Fermer"
            style={{ marginLeft: e.annulable ? 0 : 'auto', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 99, width: 30, height: 30, color: '#fff', fontSize: 15, cursor: 'pointer', flexShrink: 0 }}>✕</button>
        )}
      </div>
      {ligne && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
          <div style={{ flex: 1, minWidth: 0, fontFamily: F, fontWeight: 900, fontSize: 21, color: '#fff', lineHeight: 1.2, wordBreak: 'break-word' }}>{p.texteCaisse()}</div>
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 19, color: '#FFB020', whiteSpace: 'nowrap' }}>{euros(p.prixLigne())}</div>
        </div>
      )}
      <div style={{ fontFamily: F, fontSize: 12, fontWeight: 700, color: '#9FE3B4', marginTop: 6, lineHeight: 1.35 }}>{PHRASE_ENGAGEMENT}</div>
      {e.message && e.phase === PHASE_CAMERA && (
        <div style={{ fontFamily: F, fontSize: 12, fontWeight: 800, color: '#FFD27A', marginTop: 6 }}>{e.message}</div>
      )}
      {/* Sur la caméra aussi : une banane n'a pas de code à viser. */}
      {!avecFermer && ligne && (
        <button onClick={() => p.sansCodeBarres()}
          style={{ marginTop: 8, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 99, padding: '6px 12px', color: '#fff', fontFamily: F, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
          {LIBELLE_SANS_CODE}
        </button>
      )}
    </div>
  );

  // ── Caméra plein écran (lecteur existant) ────────────────────────────────
  if (e.phase === PHASE_CAMERA && !erreurCamera) {
    return (
      <BarcodeScannerSheet key={ligne?.id} onDetected={onDetected} onClose={fermer} onErreurCamera={onErreurCamera} entete={entete(false)} />
    );
  }

  let corps;
  if (erreurCamera) {
    corps = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18, textAlign: 'center' }}>
        <div style={{ fontSize: 46 }}>📷</div>
        <div style={{ fontFamily: F, fontWeight: 800, fontSize: 16, color: '#fff', lineHeight: 1.45 }}>{erreurCamera}</div>
        <GrosBouton couleur={BLEU} onClick={fermer}>Retour à la liste</GrosBouton>
      </div>
    );
  } else if (e.phase === PHASE_RECHERCHE) {
    corps = (
      <div style={{ flex: 1, position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', minHeight: 260 }}>
        {imageFigee && <img src={imageFigee} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }} />}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', animation: 'c119-spin 0.8s linear infinite' }} />
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 18, color: '#fff' }}>Recherche…</div>
        </div>
      </div>
    );
  } else if (e.phase === PHASE_REFUS) {
    const statut = e.recherche?.statut;
    corps = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 50 }}>{statut === SCAN_POIDS_VARIABLE ? '⚖️' : statut === SCAN_ARCHIVE ? '🗄️' : '⚠️'}</div>
        <div style={{ fontFamily: F, fontWeight: 900, fontSize: 20, color: '#fff', lineHeight: 1.3 }}>
          {statut === SCAN_POIDS_VARIABLE ? 'Code poids variable, non réutilisable' : statut === SCAN_ARCHIVE ? 'Produit archivé' : (e.message || 'Recherche impossible')}
        </div>
        <div style={{ fontFamily: F, fontSize: 13, color: GRIS_TEXTE, lineHeight: 1.45 }}>
          {statut === SCAN_POIDS_VARIABLE ? 'Ce code change avec le poids et le magasin : il ne peut pas identifier un produit. Rien n\'a été enregistré.'
            : statut === SCAN_ARCHIVE ? 'Ce code n\'est plus utilisable. Scanne un autre code de l\'emballage. Rien n\'a été enregistré.'
              : 'Rien n\'a été enregistré.'}
          {e.recherche?.code ? <><br />Code : {e.recherche.code}</> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <GrosBouton couleur={BLEU} onClick={() => p.scannerAutre()}>📷 Scanner un autre code</GrosBouton>
          <LienDiscret onClick={() => p.sansCodeBarres()}>{LIBELLE_SANS_CODE}</LienDiscret>
        </div>
      </div>
    );
  } else if (e.phase === PHASE_VERIFICATION || e.phase === PHASE_ECRITURE) {
    const f = e.recherche?.fiche || {};
    const ecriture = e.phase === PHASE_ECRITURE;
    // Cas « aucune info » : code inconnu de notre base ET d'Open Food Facts.
    // Pas de gros ✓ vert : création possible seulement après une seconde
    // lecture identique du code (correctif du 09/11, 11128663 lu sur le rumsteck).
    const aucuneInfo = doubleLectureRequise(e.recherche);
    const relu = aucuneInfo && e.doubleLecture?.relu === true;
    corps = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PhotoVerification key={e.recherche?.code || 'x'} urlOff={f.photoOff} />
        <div>
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 24, color: '#fff', lineHeight: 1.2, wordBreak: 'break-word' }}>{f.nom}</div>
          <div style={{ fontFamily: F, fontWeight: 800, fontSize: 16, color: f.marque ? '#fff' : GRIS_TEXTE, marginTop: 4 }}>{f.marque || 'marque inconnue'}</div>
          <div style={{ fontFamily: F, fontWeight: 700, fontSize: 15, color: f.format ? '#fff' : '#FFD27A', marginTop: 2 }}>{f.format || 'quantité à préciser'}</div>
          {aucuneInfo ? (
            <div style={{ fontFamily: F, fontWeight: 900, fontSize: 26, color: '#fff', letterSpacing: '0.08em', marginTop: 10 }}>{e.recherche?.code}</div>
          ) : null}
          <div style={{ fontFamily: F, fontSize: 11, color: GRIS_TEXTE, marginTop: 6 }}>Code : {e.recherche?.code} · source : {libelleSource(f.source)}</div>
        </div>
        {aucuneInfo && (
          <div style={{ fontFamily: F, fontSize: 14, fontWeight: 800, color: '#FFD27A', background: 'rgba(255,176,32,0.12)', border: '1px solid rgba(255,176,32,0.4)', borderRadius: 12, padding: '10px 12px', lineHeight: 1.4 }}>
            ⚠ {AVERTISSEMENT_AUCUNE_INFO}
            {relu && <div style={{ marginTop: 6, color: '#9FE3B4' }}>✓ Code relu à l'identique.</div>}
          </div>
        )}
        {e.message && (
          <div style={{ fontFamily: F, fontSize: 13, fontWeight: 800, color: '#FFB4B4', background: 'rgba(255,80,80,0.12)', borderRadius: 10, padding: '8px 12px' }}>{e.message}</div>
        )}
        {aucuneInfo ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
            <GrosBouton couleur="#7A2E2E" onClick={() => p.refuser()} desactive={ecriture}>✗ Ce n'est pas ça</GrosBouton>
            {!relu && <GrosBouton couleur={BLEU} onClick={() => p.rescannerPourConfirmer()} desactive={ecriture}>📷 Rescanner pour confirmer</GrosBouton>}
            <button onClick={() => p.confirmer()} disabled={!relu || ecriture}
              style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.35)', background: 'transparent', color: relu ? '#fff' : 'rgba(255,255,255,0.35)', fontFamily: F, fontWeight: 800, fontSize: 15, cursor: relu && !ecriture ? 'pointer' : 'default' }}>
              {ecriture ? 'Enregistrement…' : 'Créer quand même ce produit'}
            </button>
            {!relu && <div style={{ fontFamily: F, fontSize: 12, color: GRIS_TEXTE, textAlign: 'center' }}>Rescanne le même code pour pouvoir créer ce produit.</div>}
            {!ecriture && <LienDiscret onClick={() => p.sansCodeBarres()}>{LIBELLE_SANS_CODE}</LienDiscret>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
            <GrosBouton couleur={VERT} onClick={() => p.confirmer()} desactive={ecriture}>{ecriture ? 'Enregistrement…' : '✓ C\'est bien ça'}</GrosBouton>
            <GrosBouton couleur="#7A2E2E" onClick={() => p.refuser()} desactive={ecriture}>✗ Ce n'est pas ça</GrosBouton>
            {!ecriture && <LienDiscret onClick={() => p.sansCodeBarres()}>{LIBELLE_SANS_CODE}</LienDiscret>}
          </div>
        )}
      </div>
    );
  } else if (e.phase === PHASE_SUCCES) {
    corps = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, textAlign: 'center' }}>
        <div style={{ width: 130, height: 130, borderRadius: '50%', background: VERT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 74, color: '#fff', animation: 'c119-pop 0.5s ease-out both', boxShadow: '0 10px 30px rgba(0,179,65,0.45)' }}>✓</div>
        <div style={{ fontFamily: F, fontWeight: 900, fontSize: 18, color: '#fff' }}>{e.annulable?.libelle || 'Enregistré'}</div>
      </div>
    );
  } else if (e.phase === PHASE_FIN) {
    corps = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 58 }}>{e.complet ? '🎉' : '👍'}</div>
        <div style={{ fontFamily: F, fontWeight: 900, fontSize: 24, color: '#fff' }}>{e.complet ? 'Ticket complet 🎉' : 'C\'est tout pour ce ticket'}</div>
        <div style={{ fontFamily: F, fontSize: 15, color: GRIS_TEXTE, lineHeight: 1.45 }}>
          {e.confirmes} produit{e.confirmes > 1 ? 's' : ''} confirmé{e.confirmes > 1 ? 's' : ''}
          {e.sansCode > 0 && <><br />{e.sansCode} sans code-barres (vrac, boucherie…)</>}
          {e.passees > 0 && <><br />{e.passees} ligne{e.passees > 1 ? 's' : ''} non marquée{e.passees > 1 ? 's' : ''} — elle{e.passees > 1 ? 's restent' : ' reste'} à identifier dans « Mes tickets »</>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          <GrosBouton couleur={VERT} onClick={() => onRetourAccueil?.({ confirmes: e.confirmes })}>Retour à l'accueil</GrosBouton>
          <LienDiscret onClick={fermer}>Revoir le ticket</LienDiscret>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: FOND, zIndex: 620, display: 'flex', flexDirection: 'column', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <style>{STYLE_ANIM}</style>
      <div style={{ padding: 'calc(14px + env(safe-area-inset-top, 0px)) 18px 14px', display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        {entete(true)}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 18px calc(18px + env(safe-area-inset-bottom, 0px))' }}>
        {corps}
      </div>
    </div>
  );
}
