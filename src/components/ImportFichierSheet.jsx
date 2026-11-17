// Chantier 120 — « Importer un ticket » : image longue (Lidl Plus), PDF
// (Leclerc Drive, Carrefour) ou plusieurs captures d'écran (Netto). SHADOW,
// réservé à François.
//
// Cet écran ne fait QUE l'amont : choisir, ordonner, lire, et vérifier la
// date AVANT tout magasin et toute écriture. Dès que le ticket est lisible et
// daté de moins de 6 mois, le résultat repart dans le parcours exact du scan
// photo (onSuccess -> ImportTicketSheet : contrôle 108, magasin 115, partage,
// enregistrer_ticket_core). Rien n'est écrit ici.
import { useRef, useState } from 'react';
import { fichierEnMorceaux } from '../lib/preparationImport';
import {
  verifierBornesImport, deplacer, retirer, normaliserResultatImport, verifierDateImport,
  affichageRemise, totalLigneLue, MAX_IMAGES, MESSAGE_TICKET_TROP_ANCIEN,
} from '../lib/importTicketFichier';
import { scanTicketsImportes, MESSAGES_SCAN } from '../scanTicket';

const F = "'Nunito',sans-serif";
const BLEU = '#4A90D9';
const VERT = '#00B341';
const ROUGE = '#CC0000';

const euros = (n) => (Number.isFinite(Number(n)) ? `${Number(n).toFixed(2).replace('.', ',')} €` : '');
const aujourdHuiIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Bouton({ children, onClick, couleur = BLEU, desactive = false, plein = true }) {
  return (
    <button onClick={onClick} disabled={desactive}
      style={{ width: '100%', padding: '14px', borderRadius: 14, border: plein ? 'none' : `2px solid ${couleur}`, background: desactive ? '#ddd' : (plein ? couleur : 'transparent'), color: desactive ? '#999' : (plein ? '#fff' : couleur), fontFamily: F, fontWeight: 900, fontSize: 15, cursor: desactive ? 'default' : 'pointer' }}>
      {children}
    </button>
  );
}

// Liste des lignes lues (écran de refus pour ancienneté) : on montre quand
// même ce qui a été lu, remises comprises, pour que rien ne soit opaque.
function LignesLues({ produits }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
      {(produits || []).map((p, i) => {
        const remise = affichageRemise(totalLigneLue(p), p?.remise);
        return (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontFamily: F, fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ flex: 1, minWidth: 0, color: '#222', fontWeight: 700 }}>
              {p?.libelle_ticket || p?.name || '—'}
              {Number(p?.qty) > 1 && <span style={{ color: '#888', fontWeight: 600 }}> · {p.qty} × {euros(p.unit_price ?? p.price)}</span>}
            </div>
            <div style={{ whiteSpace: 'nowrap', fontWeight: 900, color: remise ? VERT : '#333' }}>{remise || euros(totalLigneLue(p))}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function ImportFichierSheet({ onClose, onSuccess, refProducts = [] }) {
  const [phase, setPhase] = useState('choix'); // choix | lecture | date | trop_ancien | echec
  const [images, setImages] = useState([]);     // [{ base64, apercu, nom }]
  const [preparation, setPreparation] = useState(false);
  const [message, setMessage] = useState(null);
  const [avertissement, setAvertissement] = useState(null);
  const [resultat, setResultat] = useState(null);
  const [dateSaisie, setDateSaisie] = useState('');
  const inputRef = useRef(null);
  const occupe = preparation || phase === 'lecture';

  const ajouterFichiers = async (e) => {
    const fichiers = Array.from(e.target.files || []);
    e.target.value = '';
    if (fichiers.length === 0) return;
    setPreparation(true);
    setMessage(null);
    setAvertissement(null);
    const nouveaux = [];
    const erreurs = [];
    const avertissements = [];
    for (const f of fichiers) {
      const r = await fichierEnMorceaux(f);
      if (r.erreur) erreurs.push(r.erreur);
      if (r.avertissement) avertissements.push(r.avertissement);
      nouveaux.push(...r.morceaux);
    }
    setImages(prev => [...prev, ...nouveaux]);
    if (erreurs.length) setMessage(erreurs.join(' '));
    if (avertissements.length) setAvertissement(avertissements.join(' '));
    setPreparation(false);
  };

  // Garde-fous de date (AVANT tout magasin, toute écriture), puis passage au
  // parcours du scan photo.
  const conclure = (r, date) => {
    const v = verifierDateImport(date);
    if (v.statut === 'manquante') { setResultat(r); setPhase('date'); return; }
    if (v.statut === 'trop_ancienne') { setResultat({ ...r, date: v.date }); setPhase('trop_ancien'); return; }
    onSuccess?.({ ...r, date: v.date, origine: 'import_fichier' });
  };

  const lire = async () => {
    const borne = verifierBornesImport(images);
    if (borne) { setMessage(borne); return; }
    setMessage(null);
    setPhase('lecture');
    const lecture = await scanTicketsImportes(images.map(im => im.base64), refProducts);
    if (lecture.statut !== 'ok') {
      setMessage(lecture.statut === 'lecture_vide' ? MESSAGES_SCAN.lecture_vide : MESSAGES_SCAN.service_indisponible);
      setPhase('echec');
      return;
    }
    // v13 encore déployée : remise / captures absents -> valeurs par défaut.
    const r = normaliserResultatImport(lecture.resultat);
    conclure(r, r?.date);
  };

  // ── Rendu ────────────────────────────────────────────────────────────────
  let corps;
  if (phase === 'lecture') {
    corps = (
      <div style={{ textAlign: 'center', padding: '50px 10px', fontFamily: F }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🧾</div>
        <div style={{ fontWeight: 900, fontSize: 17, color: '#222' }}>Lecture du ticket…</div>
        <div style={{ fontSize: 13, color: '#777', marginTop: 6 }}>{images.length} image{images.length > 1 ? 's' : ''} · ça peut prendre une trentaine de secondes</div>
      </div>
    );
  } else if (phase === 'echec') {
    corps = (
      <div style={{ padding: '20px 4px', fontFamily: F }}>
        <div style={{ fontWeight: 900, fontSize: 16, color: ROUGE, marginBottom: 8 }}>Le ticket n'a pas pu être lu</div>
        <div style={{ fontSize: 13, color: '#555', lineHeight: 1.5, marginBottom: 16 }}>{message}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Bouton onClick={lire}>Réessayer</Bouton>
          <Bouton plein={false} onClick={() => { setPhase('choix'); setMessage(null); }}>Revoir les images</Bouton>
        </div>
      </div>
    );
  } else if (phase === 'date') {
    corps = (
      <div style={{ padding: '16px 4px', fontFamily: F }}>
        <div style={{ fontWeight: 900, fontSize: 16, color: '#222' }}>Quelle est la date de ce ticket ?</div>
        <div style={{ fontSize: 13, color: '#666', marginTop: 4, lineHeight: 1.5 }}>Elle n'a pas pu être lue. Les prix seront datés de ce jour-là.</div>
        <input type="date" value={dateSaisie} max={aujourdHuiIso()} onChange={e => setDateSaisie(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: 14, padding: '12px', borderRadius: 12, border: `2px solid ${BLEU}`, fontFamily: F, fontSize: 16 }} />
        <div style={{ marginTop: 14 }}>
          <Bouton desactive={!dateSaisie} onClick={() => conclure(resultat, dateSaisie)}>Continuer</Bouton>
        </div>
      </div>
    );
  } else if (phase === 'trop_ancien') {
    const produits = resultat?.products || [];
    corps = (
      <div style={{ padding: '12px 4px', fontFamily: F }}>
        <div style={{ background: '#FFF1F0', border: `1.5px solid ${ROUGE}`, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontWeight: 900, fontSize: 15, color: ROUGE }}>{MESSAGE_TICKET_TROP_ANCIEN}</div>
          <div style={{ fontSize: 12, color: '#7a3a3a', marginTop: 4 }}>Ticket du {resultat?.date ? new Date(`${resultat.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'} · rien n'a été enregistré.</div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 16 }}>Ce qui a été lu ({produits.length} ligne{produits.length > 1 ? 's' : ''})</div>
        <LignesLues produits={produits} />
        <div style={{ marginTop: 16 }}><Bouton onClick={onClose}>Fermer</Bouton></div>
      </div>
    );
  } else {
    corps = (
      <div style={{ padding: '8px 4px', fontFamily: F }}>
        <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" onChange={ajouterFichiers} style={{ display: 'none' }} />
        {images.length === 0 && !preparation && (
          <div style={{ textAlign: 'center', padding: '24px 10px', color: '#666' }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>📄</div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#222', marginBottom: 6 }}>Ticket dématérialisé</div>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>Image longue (Lidl Plus), PDF (Leclerc Drive, Carrefour)<br />ou plusieurs captures d'écran, dans l'ordre.</div>
          </div>
        )}
        {preparation && <div style={{ textAlign: 'center', padding: 16, fontSize: 14, color: '#666' }}>⏳ Préparation des images…</div>}
        {images.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {images.map((im, i) => (
              <div key={`${i}-${im.nom}`} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 8 }}>
                <div style={{ width: 52, height: 68, borderRadius: 8, overflow: 'hidden', background: '#f2f2f2', flexShrink: 0 }}>
                  <img src={im.apercu} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 13, color: '#222' }}>{i + 1}.</div>
                  <div style={{ fontSize: 12, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{im.nom}</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[['▲', -1], ['▼', 1]].map(([t, sens]) => (
                    <button key={t} onClick={() => setImages(l => deplacer(l, i, sens))} disabled={occupe || (sens < 0 ? i === 0 : i === images.length - 1)}
                      style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid #ddd', background: '#fafafa', fontSize: 14, cursor: 'pointer', opacity: (sens < 0 ? i === 0 : i === images.length - 1) ? 0.3 : 1 }}>{t}</button>
                  ))}
                  <button onClick={() => setImages(l => retirer(l, i))} disabled={occupe} aria-label="Retirer"
                    style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid #f3c4c4', background: '#fff5f5', color: ROUGE, fontSize: 14, cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {avertissement && <div style={{ fontSize: 12, color: '#7A6000', background: '#FFF8E1', borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>{avertissement}</div>}
        {message && <div style={{ fontSize: 13, fontWeight: 700, color: ROUGE, marginBottom: 10 }}>⚠️ {message}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Bouton plein={images.length > 0} desactive={occupe} onClick={() => inputRef.current?.click()}>
            {images.length === 0 ? '📂 Choisir des fichiers' : '➕ Ajouter des fichiers'}
          </Bouton>
          {images.length > 0 && (
            <Bouton couleur={VERT} desactive={occupe || images.length > MAX_IMAGES} onClick={lire}>
              🔎 Lire le ticket ({images.length} image{images.length > 1 ? 's' : ''})
            </Bouton>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}
      onClick={occupe ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: BLEU, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '20px 20px 0 0', flexShrink: 0 }}>
          <div style={{ fontFamily: F, fontWeight: 900, fontSize: 17, color: '#fff' }}>📄 Importer un ticket</div>
          <button onClick={occupe ? undefined : onClose} aria-label="Fermer"
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 99, width: 28, height: 28, fontSize: 14, color: '#fff', cursor: occupe ? 'default' : 'pointer', opacity: occupe ? 0.4 : 1 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 16px calc(24px + env(safe-area-inset-bottom, 0px))' }}>
          {corps}
        </div>
      </div>
    </div>
  );
}
