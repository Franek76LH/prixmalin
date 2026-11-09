// Chantier 118 — Historique des tickets + identification des lignes par scan
// de code-barres (flux « zéro saisie »). SHADOW (monté pour François seul).
//
// Trois vues dans le même écran plein cadre :
//   - liste      : tickets de l'utilisateur, plus récents en premier, avec
//                  date, magasin, total et « N produits à identifier » ;
//   - detail     : lignes du ticket, chacune ✓ reconnu / ? suggéré / ✗ inconnu,
//                  les « à identifier » en haut ;
//   - a_completer: produits créés au scan dont la fiche est incomplète
//                  (LECTURE SEULE — la demande de photo est hors périmètre).
//
// Rien n'est bloquant : on peut fermer à tout moment, les lignes vrac restent
// « inconnu » sans gêner. Toute erreur = message court, état inchangé.
import { useCallback, useEffect, useRef, useState } from 'react';
import BarcodeScannerSheet from './BarcodeScannerSheet';
import { formaterAdresseMagasin } from '../lib/selecteurMagasinCore';
import {
  etatLigne, ETAT_RECONNU, ETAT_SUGGERE,
  compterAIdentifierParTicket, trierLignesTicket, ligneSuivanteAIdentifier,
  titreLigneInconnue, pisteLigneInconnue, formatVariante, prixArticle,
  traiterScanLigne, estFonctionAbsente, MESSAGE_INDISPONIBLE,
  SCAN_RECONNU, SCAN_CREE, issueScan,
  annulerScanLigne, appliquerAnnulation, resumeAnnulation, DUREE_ANNULATION_MS,
} from '../lib/scanDepuisHistorique';
import {
  chargerTicketsUtilisateur, chargerLignesAIdentifier, chargerDetailTicket,
  confirmerSuggestion, chargerVarianteAffichage, depsScanLigne, chargerProduitsACompleter,
  annulerScanLigneRpc,
} from '../lib/historiqueTicketsCore';

const F = "'Nunito',sans-serif";
const ROUGE = '#CC0000';
const BLEU = '#0066FF';
const VERT = '#00A03C';
const GRIS = '#888';
const TEXTE = '#1a1a1a';

const euros = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(2).replace('.', ',')} €`);

function dateFr(iso) {
  if (!iso) return 'Date inconnue';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date inconnue';
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function Pastille({ n }) {
  if (!n) return null;
  return (
    <span style={{ fontFamily: F, fontSize: 11, fontWeight: 900, color: '#B25900', background: '#FFE7C2', borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>
      {n} produit{n > 1 ? 's' : ''} à identifier
    </span>
  );
}

function BoutonScanner({ onClick, gros = false, desactive = false }) {
  return (
    <button onClick={onClick} disabled={desactive}
      style={{ padding: gros ? '12px 16px' : '9px 12px', border: 'none', borderRadius: 10, background: desactive ? '#ccc' : BLEU, color: '#fff', fontFamily: F, fontWeight: 900, fontSize: gros ? 14 : 13, cursor: desactive ? 'default' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
      📷 Scanner
    </button>
  );
}

// ticketInitial : ticket à ouvrir directement (pastille « dernier ticket » de
// l'accueil) ; « ← » ramène alors à la liste complète.
export default function HistoriqueTicketsSheet({ userId, onClose, onCompteChange, ticketInitial = null }) {
  const [vue, setVue] = useState(ticketInitial ? 'detail' : 'liste');
  const [tickets, setTickets] = useState(null);
  const [comptes, setComptes] = useState(() => new Map());
  const [erreurListe, setErreurListe] = useState(null);
  const [aCompleter, setACompleter] = useState(null); // null = pas encore chargé

  const [ticketOuvert, setTicketOuvert] = useState(ticketInitial);
  const [detail, setDetail] = useState(null); // { lignes, produits, variantes }
  const [erreurDetail, setErreurDetail] = useState(null);
  const [enCours, setEnCours] = useState(null); // texte d'attente
  const [retour, setRetour] = useState(null); // { ton, titre, detail, aCompleter }
  const [enEvidence, setEnEvidence] = useState(null);
  const [scanOuvert, setScanOuvert] = useState(false);
  const scanCibleRef = useRef(null);
  const refsLignes = useRef({});
  // Filet « ↩ Annuler » : { ligneId, libelle } pendant 8 s après un scan
  // réussi. Disparaît au bout du délai, au scan suivant, ou en quittant le
  // ticket.
  const [annulable, setAnnulable] = useState(null);
  const minuterieAnnulationRef = useRef(null);
  const fermerAnnulation = useCallback(() => {
    if (minuterieAnnulationRef.current) clearTimeout(minuterieAnnulationRef.current);
    minuterieAnnulationRef.current = null;
    setAnnulable(null);
  }, []);
  const ouvrirAnnulation = useCallback((ligneId, libelle) => {
    if (minuterieAnnulationRef.current) clearTimeout(minuterieAnnulationRef.current);
    setAnnulable({ ligneId, libelle });
    minuterieAnnulationRef.current = setTimeout(() => {
      minuterieAnnulationRef.current = null;
      setAnnulable(null);
    }, DUREE_ANNULATION_MS);
  }, []);
  useEffect(() => () => { if (minuterieAnnulationRef.current) clearTimeout(minuterieAnnulationRef.current); }, []);

  const rechargerListe = useCallback(async () => {
    setErreurListe(null);
    const [t, l] = await Promise.all([chargerTicketsUtilisateur(userId), chargerLignesAIdentifier(userId)]);
    if (t.error) { setErreurListe("Impossible de charger tes tickets, vérifie ta connexion."); setTickets(prev => prev ?? []); return; }
    setTickets(t.data);
    if (!l.error) {
      setComptes(compterAIdentifierParTicket(l.data));
      onCompteChange?.(l.data.length);
    }
    const ac = await chargerProduitsACompleter(userId);
    if (!ac.error) setACompleter(ac.data);
  }, [userId, onCompteChange]);

  useEffect(() => { rechargerListe(); }, [rechargerListe]);

  // Seule la DERNIÈRE relecture demandée s'affiche : un « ↩ Annuler » tapé
  // pendant la relecture d'après-scan ne doit pas être écrasé par celle-ci,
  // qui peut revenir après (elle montrerait encore la ligne rattachée).
  const seqDetailRef = useRef(0);
  const rechargerDetail = useCallback(async (ticketId) => {
    const seq = ++seqDetailRef.current;
    const r = await chargerDetailTicket(ticketId);
    if (seq !== seqDetailRef.current) return null;
    if (r.error) { setErreurDetail("Impossible de charger ce ticket, vérifie ta connexion."); return null; }
    setErreurDetail(null);
    const d = { lignes: trierLignesTicket(r.lignes), produits: r.produits, variantes: r.variantes };
    setDetail(d);
    return d;
  }, []);

  // Ouverture directe sur le ticket demandé (une seule fois, au montage).
  useEffect(() => {
    if (ticketInitial?.id) rechargerDetail(ticketInitial.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ouvrirTicket = (t) => {
    setTicketOuvert(t);
    setDetail(null);
    setRetour(null);
    setEnEvidence(null);
    setVue('detail');
    rechargerDetail(t.id);
  };

  const retourListe = () => {
    fermerAnnulation();
    setVue('liste');
    setTicketOuvert(null);
    setDetail(null);
    setRetour(null);
    rechargerListe();
  };

  // Après une ligne traitée : relecture de la base (vérité), puis mise en
  // évidence de la ligne suivante à identifier.
  const apresTraitement = async (ligneId) => {
    if (!ticketOuvert) return;
    const d = await rechargerDetail(ticketOuvert.id);
    const suivante = d ? ligneSuivanteAIdentifier(d.lignes, ligneId) : null;
    setEnEvidence(suivante);
    if (suivante) setTimeout(() => refsLignes.current[suivante]?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 60);
    chargerLignesAIdentifier(userId).then(l => { if (!l.error) { setComptes(compterAIdentifierParTicket(l.data)); onCompteChange?.(l.data.length); } });
  };

  const confirmer = async (ligne) => {
    setRetour(null);
    setEnCours('Enregistrement…');
    try {
      const { data, error } = await confirmerSuggestion(ligne);
      if (error || (data && typeof data === 'object' && data.succes === false)) {
        setRetour({ ton: 'erreur', titre: estFonctionAbsente(error) ? MESSAGE_INDISPONIBLE : 'Confirmation impossible, réessaie.', detail: data?.message || null });
        return;
      }
      setRetour({ ton: 'succes', titre: `✓ Confirmé : ${detail?.produits?.[ligne.produit_suggere_ia_id]?.nom_reference || 'produit suggéré'}` });
      await apresTraitement(ligne.id);
    } finally {
      setEnCours(null);
    }
  };

  const annuler = async () => {
    const cible = annulable;
    if (!cible || !ticketOuvert) return;
    setEnCours('Annulation…');
    try {
      const r = await annulerScanLigne({ ligneId: cible.ligneId, deps: { annuler: annulerScanLigneRpc } });
      if (!r.ok) {
        // État inchangé : on affiche le message de la base, rien d'autre.
        setRetour({ ton: 'erreur', titre: r.message });
        return;
      }
      fermerAnnulation();
      // Affichage immédiat (la ligne remonte, le compteur aussi), puis
      // relecture de la base qui fait foi.
      setDetail(prev => (prev ? { ...prev, lignes: appliquerAnnulation(prev.lignes, cible.ligneId) } : prev));
      setComptes(prev => { const m = new Map(prev); m.set(ticketOuvert.id, (m.get(ticketOuvert.id) || 0) + 1); return m; });
      setRetour({ ton: 'attente', titre: `↩ Annulé : ${cible.libelle}`, detail: [resumeAnnulation(r.bilan), 'La ligne est de nouveau à identifier.'].filter(Boolean).join(' ') });
      setEnEvidence(cible.ligneId);
      const d = await rechargerDetail(ticketOuvert.id);
      if (d) setTimeout(() => refsLignes.current[cible.ligneId]?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 60);
      chargerLignesAIdentifier(userId).then(l => { if (!l.error) { setComptes(compterAIdentifierParTicket(l.data)); onCompteChange?.(l.data.length); } });
    } finally {
      setEnCours(null);
    }
  };

  const boutonAnnuler = (
    <button onClick={annuler} disabled={!!enCours}
      style={{ padding: '8px 12px', border: `1.5px solid ${TEXTE}`, borderRadius: 9, background: '#fff', color: TEXTE, fontFamily: F, fontWeight: 900, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
      ↩ Annuler
    </button>
  );

  // « Rattaché : … ↩ Annuler » sur la ligne scannée, quel que soit l'état
  // affiché : pendant le rechargement, la ligne peut encore apparaître
  // « inconnu » ou « suggéré » — le bouton doit être là quand même.
  const blocAnnulable = (l) => (annulable?.ligneId === l.id ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '8px 10px', background: '#DFF7E8', borderRadius: 10 }}>
      <div style={{ flex: 1, minWidth: 0, fontFamily: F, fontSize: 12, fontWeight: 800, color: TEXTE }}>Rattaché : {annulable.libelle}</div>
      {boutonAnnuler}
    </div>
  ) : null);

  const scanner = (ligne) => {
    fermerAnnulation(); // le scan suivant clôt la fenêtre d'annulation
    scanCibleRef.current = ligne;
    setRetour(null);
    setScanOuvert(true);
  };

  // Identité stable : le lecteur @zxing garde onDetected en dépendance d'effet,
  // une nouvelle fonction à chaque rendu rouvrirait la caméra en boucle.
  const onCodeDetecte = useCallback(async (codeBrut) => {
    const ligne = scanCibleRef.current;
    scanCibleRef.current = null;
    setScanOuvert(false);
    if (!ligne) return;
    setEnCours('Lecture du code-barres…');
    try {
      const r = await traiterScanLigne({
        ligne,
        codeBrut,
        deps: {
          ...depsScanLigne,
          chercherOff: async (ean) => { setEnCours('Recherche sur Open Food Facts…'); return depsScanLigne.chercherOff(ean); },
        },
      });
      const succes = r.ecrit === true && (r.statut === SCAN_RECONNU || r.statut === SCAN_CREE);
      const v = succes ? (r.variante || (r.varianteId ? await chargerVarianteAffichage(r.varianteId) : null)) : null;
      const issue = issueScan(r, { ligne, variante: v, prix: prixArticle(ligne) });
      setRetour(issue.retour);
      if (issue.annulable) {
        // Correctif du 09/11 : l'écran d'attente se lève AVANT le rechargement
        // du ticket. Avant, la fenêtre de 8 s courait derrière le voile
        // « Lecture du code-barres… » pendant les allers-retours réseau, et
        // pouvait expirer avant d'être vue.
        setEnCours(null);
        ouvrirAnnulation(issue.annulable.ligneId, issue.annulable.libelle);
        console.info('[C118] scan réussi —', issue.annulable.chemin, '— « ↩ Annuler » ouvert 8 s');
        await apresTraitement(ligne.id);
      }
    } catch (e) {
      console.error('[C118] scan depuis l\'historique :', e);
      setRetour({ ton: 'erreur', titre: 'Scan impossible, réessaie.' });
    } finally {
      setEnCours(null);
    }
    // apresTraitement lit ticketOuvert : on suit sa valeur courante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketOuvert]);

  const fermerScanner = useCallback(() => { scanCibleRef.current = null; setScanOuvert(false); }, []);

  const totalAIdentifier = [...comptes.values()].reduce((a, n) => a + n, 0);

  // ── Rendu ────────────────────────────────────────────────────────────────
  const entete = (titre, onRetour) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px 12px', borderBottom: '1px solid #eee', background: '#fff', position: 'sticky', top: 0, zIndex: 2 }}>
      <button onClick={onRetour} style={{ background: 'none', border: 'none', fontFamily: F, fontWeight: 900, fontSize: 15, color: BLEU, cursor: 'pointer', padding: 0 }}>←</button>
      <div style={{ flex: 1, fontFamily: F, fontWeight: 900, fontSize: 17, color: TEXTE }}>{titre}</div>
      <button onClick={onClose} aria-label="Fermer" style={{ background: '#f0f0f0', border: 'none', borderRadius: 99, width: 30, height: 30, fontSize: 14, cursor: 'pointer' }}>✕</button>
    </div>
  );

  const bandeauRetour = retour && (
    <div style={{ margin: '12px 16px 0', padding: '12px 14px', borderRadius: 12, fontFamily: F,
      background: retour.ton === 'succes' ? '#DFF7E8' : retour.ton === 'attente' ? '#FFF4E0' : '#FFE5E5',
      border: `1.5px solid ${retour.ton === 'succes' ? VERT : retour.ton === 'attente' ? '#F5A623' : ROUGE}` }}>
      <div style={{ fontWeight: 900, fontSize: 14, color: TEXTE, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {retour.titre}
        {retour.aCompleter && (
          <span style={{ fontSize: 10, fontWeight: 900, color: '#7A6000', background: '#FFF1B8', borderRadius: 99, padding: '2px 8px' }}>à compléter</span>
        )}
      </div>
      {retour.detail && <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>{retour.detail}</div>}
      {annulable && <div style={{ marginTop: 8 }}>{boutonAnnuler}</div>}
      {retour.ligneId && retour.ton === 'attente' && (
        <button onClick={() => { const l = detail?.lignes?.find(x => x.id === retour.ligneId); if (l) scanner(l); }}
          style={{ marginTop: 8, padding: '8px 12px', border: 'none', borderRadius: 9, background: BLEU, color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 12, cursor: 'pointer' }}>
          📷 Scanner un autre code
        </button>
      )}
    </div>
  );

  let contenu;
  if (vue === 'a_completer') {
    contenu = (
      <>
        {entete('Produits à compléter', () => setVue('liste'))}
        <div style={{ padding: '12px 16px 40px' }}>
          <div style={{ fontFamily: F, fontSize: 12, color: GRIS, marginBottom: 12, lineHeight: 1.5 }}>
            Produits créés au scan dont la fiche est incomplète : quantité non fiable ou fiche « À reclasser » (Open Food Facts n'avait pas tout). Lecture seule pour l'instant.
          </div>
          {(aCompleter || []).length === 0 ? (
            <div style={{ fontFamily: F, fontSize: 13, color: GRIS, textAlign: 'center', padding: '30px 0' }}>Rien à compléter 🎉</div>
          ) : aCompleter.map(p => (
            <div key={p.varianteId} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ fontFamily: F, fontWeight: 900, fontSize: 14, color: TEXTE }}>{p.nom}</div>
              {p.libelleTicket && p.libelleTicket !== p.nom && <div style={{ fontFamily: F, fontSize: 11, color: GRIS, marginTop: 2 }}>Ticket : {p.libelleTicket}</div>}
              <div style={{ fontFamily: F, fontSize: 12, color: '#555', marginTop: 4 }}>
                EAN {p.ean}{[p.quantiteNonFiable ? 'quantité à préciser' : null, p.aReclasser ? 'à reclasser' : null].filter(Boolean).map(t => ` · ${t}`).join('')}
              </div>
              <div style={{ fontFamily: F, fontSize: 11, color: GRIS, marginTop: 2 }}>{[p.magasin, p.dateTicket ? dateFr(p.dateTicket) : null].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </div>
      </>
    );
  } else if (vue === 'detail' && ticketOuvert) {
    const lignes = detail?.lignes || [];
    const nb = lignes.filter(l => etatLigne(l) !== ETAT_RECONNU).length;
    contenu = (
      <>
        {entete(ticketOuvert.magasins?.nom || 'Ticket', retourListe)}
        <div style={{ padding: '10px 16px 0', fontFamily: F }}>
          <div style={{ fontSize: 12, color: GRIS }}>{dateFr(ticketOuvert.date_ticket)} · total {euros(ticketOuvert.montant_total)}</div>
          {detail && (
            <div style={{ marginTop: 6 }}>
              {nb > 0 ? <Pastille n={nb} /> : <span style={{ fontSize: 12, fontWeight: 900, color: VERT }}>✓ Tout est identifié</span>}
            </div>
          )}
        </div>
        {bandeauRetour}
        <div style={{ padding: '12px 16px 40px' }}>
          {erreurDetail && <div style={{ fontFamily: F, fontSize: 13, color: ROUGE, marginBottom: 10 }}>{erreurDetail}</div>}
          {!detail && !erreurDetail && <div style={{ fontFamily: F, fontSize: 13, color: GRIS }}>Chargement…</div>}
          {lignes.map(l => {
            const etat = etatLigne(l);
            const prix = prixArticle(l);
            const qte = Number(l.quantite) > 1 ? ` × ${Number(l.quantite)}` : '';
            const evidence = enEvidence === l.id;
            const cadre = { background: '#fff', borderRadius: 12, padding: '12px 14px', marginBottom: 8, border: evidence ? `2px solid ${BLEU}` : '1px solid #eee', boxShadow: evidence ? '0 0 0 4px rgba(0,102,255,0.12)' : 'none' };
            const prixTxt = <div style={{ fontFamily: F, fontWeight: 900, fontSize: 14, color: ROUGE, whiteSpace: 'nowrap' }}>{euros(prix)}{qte}</div>;

            if (etat === ETAT_RECONNU) {
              const p = detail.produits[l.produit_id];
              const v = detail.variantes[l.variante_produit_id];
              return (
                <div key={l.id} ref={el => { refsLignes.current[l.id] = el; }} style={{ ...cadre, opacity: annulable?.ligneId === l.id ? 1 : 0.85 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F, fontWeight: 900, fontSize: 14, color: TEXTE }}>
                        <span style={{ color: VERT }}>✓ </span>{p?.nom_reference || titreLigneInconnue(l)}
                      </div>
                      <div style={{ fontFamily: F, fontSize: 12, color: GRIS, marginTop: 2 }}>
                        {[v?.marques?.nom, formatVariante(v)].filter(Boolean).join(' · ') || 'Sans marque'}
                      </div>
                    </div>
                    {prixTxt}
                  </div>
                  {blocAnnulable(l)}
                </div>
              );
            }

            if (etat === ETAT_SUGGERE) {
              const p = detail.produits[l.produit_suggere_ia_id];
              const v = detail.variantes[l.variante_suggeree_ia_id];
              const nomSuggere = [p?.nom_reference || 'ce produit', v?.marques?.nom, formatVariante(v)].filter(Boolean).join(' · ');
              return (
                <div key={l.id} ref={el => { refsLignes.current[l.id] = el; }} style={cadre}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F, fontWeight: 900, fontSize: 14, color: TEXTE }}><span style={{ color: BLEU }}>? </span>{titreLigneInconnue(l)}</div>
                      <div style={{ fontFamily: F, fontSize: 13, color: '#333', marginTop: 4 }}>Est-ce bien <b>{nomSuggere}</b> ?</div>
                    </div>
                    {prixTxt}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button onClick={() => confirmer(l)} disabled={!!enCours}
                      style={{ flex: 1, padding: '10px', border: 'none', borderRadius: 10, background: VERT, color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 14, cursor: 'pointer' }}>
                      ✓ Oui
                    </button>
                    <BoutonScanner onClick={() => scanner(l)} desactive={!!enCours} />
                  </div>
                  {blocAnnulable(l)}
                </div>
              );
            }

            const piste = pisteLigneInconnue(l);
            return (
              <div key={l.id} ref={el => { refsLignes.current[l.id] = el; }} style={cadre}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: F, fontWeight: 900, fontSize: 14, color: TEXTE }}><span style={{ color: ROUGE }}>✗ </span>{titreLigneInconnue(l)}</div>
                    {piste && <div style={{ fontFamily: F, fontSize: 11, color: GRIS, marginTop: 2 }}>piste : {piste}</div>}
                  </div>
                  {prixTxt}
                </div>
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => scanner(l)} disabled={!!enCours}
                    style={{ width: '100%', padding: '13px', border: 'none', borderRadius: 10, background: enCours ? '#ccc' : BLEU, color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}>
                    📷 Scanner le code-barres
                  </button>
                </div>
                {blocAnnulable(l)}
              </div>
            );
          })}
        </div>
      </>
    );
  } else {
    contenu = (
      <>
        {entete('Mes tickets', onClose)}
        <div style={{ padding: '12px 16px 40px' }}>
          {totalAIdentifier > 0 && (
            <div style={{ fontFamily: F, fontSize: 13, color: '#7A4A00', background: '#FFF4E0', borderRadius: 12, padding: '10px 12px', marginBottom: 12, lineHeight: 1.45 }}>
              <b>{totalAIdentifier} produit{totalAIdentifier > 1 ? 's' : ''} à identifier.</b> Ouvre un ticket et scanne le code-barres de chaque produit en rangeant tes courses.
            </div>
          )}
          <button onClick={() => setVue('a_completer')} disabled={aCompleter == null}
            style={{ width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '11px 14px', marginBottom: 12, fontFamily: F, fontWeight: 800, fontSize: 13, color: TEXTE, cursor: 'pointer' }}>
            🧩 Produits à compléter ({aCompleter == null ? '…' : aCompleter.length}) <span style={{ float: 'right', color: GRIS }}>›</span>
          </button>
          {erreurListe && <div style={{ fontFamily: F, fontSize: 13, color: ROUGE, marginBottom: 10 }}>{erreurListe}</div>}
          {tickets == null && !erreurListe && <div style={{ fontFamily: F, fontSize: 13, color: GRIS }}>Chargement…</div>}
          {tickets && tickets.length === 0 && !erreurListe && (
            <div style={{ fontFamily: F, fontSize: 13, color: GRIS, textAlign: 'center', padding: '30px 0' }}>Aucun ticket enregistré pour l'instant.</div>
          )}
          {(tickets || []).map(t => {
            const n = comptes.get(t.id) || 0;
            const adresse = formaterAdresseMagasin(t.magasins);
            return (
              <div key={t.id} onClick={() => ouvrirTicket(t)}
                style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: '13px 14px', marginBottom: 8, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: F, fontWeight: 900, fontSize: 15, color: TEXTE }}>{t.magasins?.nom || 'Magasin inconnu'}</div>
                    {adresse && <div style={{ fontFamily: F, fontSize: 11, color: GRIS, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adresse}</div>}
                    <div style={{ fontFamily: F, fontSize: 12, color: '#555', marginTop: 3 }}>{dateFr(t.date_ticket)}</div>
                  </div>
                  <div style={{ fontFamily: F, fontWeight: 900, fontSize: 15, color: BLEU, whiteSpace: 'nowrap' }}>{euros(t.montant_total)}</div>
                </div>
                {n > 0 && <div style={{ marginTop: 8 }}><Pastille n={n} /></div>}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: '#F6F7F9', zIndex: 560, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {contenu}
      </div>
      {scanOuvert && <BarcodeScannerSheet onDetected={onCodeDetecte} onClose={fermerScanner} />}
      {enCours && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 605, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '16px 22px', fontFamily: F, fontSize: 13, fontWeight: 800, color: TEXTE, maxWidth: '80%', textAlign: 'center' }}>{enCours}</div>
        </div>
      )}
    </>
  );
}
