// Chantier 163 — un seul écran pour terminer ses courses : ce qui a été
// retrouvé, les achats en plus, ce qui reste à acheter (gardé dans Ma liste
// par défaut) et, replié, ce qui est à vérifier. Le calcul vient de
// lib/bilanFinCoursesCore.js ; cet écran ne décide rien d'autre que
// l'affichage et les choix de l'utilisateur. Plein écran au-dessus de tout
// (y compris la pastille d'administration, qui couvrait la croix).
import { useMemo, useState } from 'react';
import { T } from './theme';
import { construireBilanFin, planClotureListe } from '../../lib/bilanFinCoursesCore';

const euros = (n) => (n == null ? '' : `${Number(n).toFixed(2).replace('.', ',')} €`);
const LIBELLE_RAISON = {
  introuvable: 'non trouvé en rayon',
  pas_pris: 'pas pris',
  partiel: 'pas tout pris',
  ajoute_depuis: 'ajouté depuis',
};

function Rubrique({ titre, detail = null, couleur = T.texte, children }) {
  return (
    <div style={{ background: T.carte, borderRadius: 16, padding: '14px 14px 6px', marginBottom: 12, boxShadow: T.ombre }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: couleur }}>{titre}</div>
        {detail && <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 13, color: T.texteDoux, flexShrink: 0 }}>{detail}</div>}
      </div>
      {children}
    </div>
  );
}

function Ligne({ gauche, sous = null, droite = null, avant = null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${T.trait}` }}>
      {avant}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 14, color: T.texte, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gauche}</div>
        {sous && <div style={{ fontFamily: T.police, fontSize: 12, color: T.texteDoux, marginTop: 1 }}>{sous}</div>}
      </div>
      {droite && <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 13, color: T.texteDoux, flexShrink: 0 }}>{droite}</div>}
    </div>
  );
}

// `demo` : courses fictives (adresse « ?demo=bilan ») — « Terminer » n'écrit
// rien et montre ce que l'app AURAIT fait dans Ma liste.
export default function EcranFinCourses({ session, items = [], onTerminer, onPlusTard, onScannerTicket = null, demo = false }) {
  const [resultatDemo, setResultatDemo] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [garder, setGarder] = useState({});
  const [voirVerif, setVoirVerif] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  // Quantité ACTUELLE de chaque ligne de Ma liste (id -> quantité).
  const quantitesListe = useMemo(() => new Map((items || []).filter(i => i?.id != null).map(i => [String(i.id), Number(i.qty) || 1])), [items]);
  const bilan = useMemo(() => construireBilanFin({
    articles: session?.articles, lignesTicket: session?.ticket_lignes ?? null, quantitesListe, decisions,
  }), [session, quantitesListe, decisions]);

  const magasin = session?.magasin?.nom;
  const totalReel = session?.ticket_total_reel;
  const nbGardes = bilan.reste.filter(r => garder[r.cle] !== false).length;

  const terminer = async () => {
    if (envoi) return;
    setEnvoi(true);
    const plan = planClotureListe({ articles: session?.articles, bilan, quantitesListe, garder });
    if (demo) {
      const nomDe = (id) => (session?.articles || []).find(a => String(a.cle) === String(id))?.nom_affiche || id;
      const touches = new Set([...plan.supprimer, ...plan.majQuantite.map(m => m.id)].map(String));
      setResultatDemo([
        ...plan.majQuantite.map(m => `${nomDe(m.id)} : reste dans Ma liste, quantité ${quantitesListe.get(String(m.id))} → ${m.quantite}`),
        ...bilan.reste.filter(r => garder[r.cle] !== false && !touches.has(String(r.cle))).map(r => `${r.nom} : reste dans Ma liste (× ${r.quantite})`),
        ...plan.supprimer.map(id => `${nomDe(id)} : retiré de Ma liste`),
        ...(items || []).filter(i => !(session?.articles || []).some(a => String(a.cle) === String(i.id))).map(i => `${i.nom || 'Autre article'} : pas touché, il ne faisait pas partie de ces courses`),
        ...bilan.enPlus.map(e => `${e.nom} : acheté en plus, Ma liste n'est pas touchée`),
      ]);
      setEnvoi(false);
      return;
    }
    try { await onTerminer?.({ bilan, plan }); } finally { setEnvoi(false); }
  };

  return (
    <div role="dialog" aria-label="Terminer mes courses" style={{ position: 'fixed', inset: 0, zIndex: 600, background: T.fond, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ maxWidth: 430, margin: '0 auto', padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px calc(130px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ flex: 1, fontFamily: T.police, fontWeight: 900, fontSize: 22, color: T.texte }}>Terminer mes courses</div>
          <button onClick={onPlusTard} aria-label="Fermer" style={{ border: 'none', background: '#ECEEF1', borderRadius: 99, width: 34, height: 34, fontSize: 16, cursor: 'pointer', color: T.texteDoux }}>✕</button>
        </div>
        {demo && (
          <div style={{ background: T.jaunePale, borderRadius: 12, padding: '10px 12px', marginBottom: 12, fontFamily: T.police, fontSize: 13, fontWeight: 800, color: T.texte }}>
            🧪 Démo avec des courses fictives : rien n'est enregistré, ta vraie liste n'est pas touchée.
          </div>
        )}
        {resultatDemo && (
          <div style={{ background: T.vertPale, borderRadius: 14, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 14.5, color: T.vert, marginBottom: 6 }}>Voici ce que l'app aurait fait :</div>
            {resultatDemo.map((t, i) => <div key={i} style={{ fontFamily: T.police, fontSize: 13, color: T.texte, padding: '3px 0' }}>• {t}</div>)}
            <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, marginTop: 6 }}>Change les cases ou « Pas pris », puis retouche « Terminer » pour comparer.</div>
          </div>
        )}
        <div style={{ fontFamily: T.police, fontSize: 13.5, color: T.texteDoux, marginBottom: 14 }}>
          {magasin ? `${magasin} · ` : ''}
          {bilan.avecTicket
            ? (totalReel != null ? `Ticket : ${euros(totalReel)}` : 'Ticket rattaché')
            : 'Sans ticket : bilan d\'après tes cases cochées'}
        </div>

        {!bilan.avecTicket && onScannerTicket && (
          <button onClick={onScannerTicket} style={{ width: '100%', marginBottom: 12, padding: '12px 14px', border: `1.5px solid ${T.trait}`, borderRadius: 14, background: T.carte, fontFamily: T.police, fontWeight: 900, fontSize: 14, color: T.texte, cursor: 'pointer', textAlign: 'left' }}>
            🧾 Scanner mon ticket d'abord <span style={{ fontWeight: 700, color: T.texteDoux }}>— pour vérifier ce qui a été acheté</span>
          </button>
        )}

        {bilan.retrouves.length > 0 && (
          <Rubrique titre={bilan.avecTicket ? `✓ Retrouvés sur le ticket (${bilan.retrouves.length})` : `✓ Pris (${bilan.retrouves.length})`} couleur={T.vert}>
            {bilan.retrouves.map(r => (
              <Ligne key={r.cle} gauche={r.nom}
                sous={[
                  r.achete < r.prevu ? `${r.achete} sur ${r.prevu}` : (r.prevu > 1 ? `× ${r.achete}` : null),
                  r.autreFormat ? 'autre format' : null,
                  r.incertain ? 'coché, pas vu sur le ticket' : null,
                ].filter(Boolean).join(' · ') || null}
                droite={euros(r.montant)} />
            ))}
          </Rubrique>
        )}

        {bilan.enPlus.length > 0 && (
          <Rubrique titre={`➕ Achats en plus (${bilan.enPlus.length})`} detail={bilan.totalEnPlus ? euros(bilan.totalEnPlus) : null} couleur={T.bleu}>
            {bilan.enPlus.map((e, i) => (
              <Ligne key={i} gauche={e.nom} sous={e.quantite > 1 ? `× ${e.quantite}` : null} droite={euros(e.montant)} />
            ))}
          </Rubrique>
        )}

        {bilan.reste.length > 0 && (
          <Rubrique titre={`↩︎ Reste à acheter (${bilan.reste.length})`} couleur={T.texte}>
            <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, marginBottom: 4 }}>Coché = gardé dans Ma liste. Décoche ce dont tu n'as plus besoin.</div>
            {bilan.reste.map(r => {
              const garde = garder[r.cle] !== false;
              const sous = r.ajouteDepuis > 0 && r.raison !== 'ajoute_depuis'
                ? `${LIBELLE_RAISON[r.raison]} · dont ${r.ajouteDepuis} ajouté${r.ajouteDepuis > 1 ? 's' : ''} depuis`
                : LIBELLE_RAISON[r.raison];
              return (
                <Ligne key={r.cle} gauche={`${r.nom}${r.quantite > 1 ? ` × ${r.quantite}` : ''}`} sous={sous}
                  avant={(
                    <button role="checkbox" aria-checked={garde} aria-label={`Garder « ${r.nom} » dans Ma liste`}
                      onClick={() => setGarder(g => ({ ...g, [r.cle]: !garde }))}
                      style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, cursor: 'pointer', border: `2px solid ${garde ? T.vert : T.texteLeger}`, background: garde ? T.vert : '#fff', color: '#fff', fontWeight: 900, fontSize: 15, lineHeight: '20px', padding: 0 }}>
                      {garde ? '✓' : ''}
                    </button>
                  )} />
              );
            })}
          </Rubrique>
        )}

        {(bilan.aVerifier.length > 0 || bilan.nonReconnues.length > 0) && (
          <div style={{ background: T.carte, borderRadius: 16, marginBottom: 12, boxShadow: T.ombre, overflow: 'hidden' }}>
            <button onClick={() => setVoirVerif(v => !v)} aria-expanded={voirVerif} style={{ width: '100%', border: 'none', background: 'none', padding: 14, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ flex: 1, fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte }}>
                ? À vérifier ({bilan.aVerifier.length + bilan.nonReconnues.length}) <span style={{ fontWeight: 700, fontSize: 12.5, color: T.texteDoux }}>— facultatif</span>
              </span>
              <span style={{ color: T.texteLeger, fontSize: 14 }}>{voirVerif ? '▾' : '▸'}</span>
            </button>
            {voirVerif && (
              <div style={{ padding: '0 14px 8px' }}>
                {bilan.aVerifier.map(v => (
                  <Ligne key={v.cle} gauche={v.nom} sous="coché en rayon, pas vu sur le ticket"
                    droite={(
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setDecisions(d => { const n = { ...d }; delete n[v.cle]; return n; })} aria-pressed={!v.pasPris}
                          style={{ border: 'none', borderRadius: 9, padding: '6px 9px', cursor: 'pointer', fontFamily: T.police, fontWeight: 900, fontSize: 12, background: !v.pasPris ? T.vertPale : '#F1F2F4', color: !v.pasPris ? T.vert : T.texteDoux }}>Acheté ✓</button>
                        <button onClick={() => setDecisions(d => ({ ...d, [v.cle]: 'pas_pris' }))} aria-pressed={v.pasPris}
                          style={{ border: 'none', borderRadius: 9, padding: '6px 9px', cursor: 'pointer', fontFamily: T.police, fontWeight: 900, fontSize: 12, background: v.pasPris ? T.rougePale : '#F1F2F4', color: v.pasPris ? T.rouge : T.texteDoux }}>Pas pris</button>
                      </span>
                    )} />
                ))}
                {bilan.nonReconnues.map((n, i) => (
                  <Ligne key={`n${i}`} gauche={n.libelle} sous="ligne du ticket non reconnue" droite={euros(n.montant)} />
                ))}
              </div>
            )}
          </div>
        )}

        {bilan.retrouves.length + bilan.enPlus.length + bilan.reste.length + bilan.aVerifier.length === 0 && (
          <div style={{ fontFamily: T.police, fontSize: 14, color: T.texteDoux, padding: '20px 4px' }}>Rien à signaler.</div>
        )}
      </div>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'rgba(248,248,248,0.97)', borderTop: `1px solid ${T.trait}`, padding: '10px 16px calc(10px + env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ maxWidth: 398, margin: '0 auto' }}>
          <button onClick={terminer} disabled={envoi} style={{ width: '100%', padding: 14, border: 'none', borderRadius: 14, background: envoi ? '#D6D8DC' : T.rouge, color: '#fff', fontFamily: T.police, fontWeight: 900, fontSize: 15.5, cursor: envoi ? 'default' : 'pointer' }}>
            {envoi ? '…' : 'Terminer mes courses'}
          </button>
          <div style={{ fontFamily: T.police, fontSize: 12, color: T.texteDoux, textAlign: 'center', marginTop: 6 }}>
            {nbGardes > 0 ? `${nbGardes} article${nbGardes > 1 ? 's' : ''} gardé${nbGardes > 1 ? 's' : ''} dans Ma liste · ` : ''}
            <button onClick={onPlusTard} style={{ border: 'none', background: 'none', padding: 0, fontFamily: T.police, fontWeight: 800, fontSize: 12, color: T.texteDoux, textDecoration: 'underline', cursor: 'pointer' }}>Plus tard</button>
          </div>
        </div>
      </div>
    </div>
  );
}
