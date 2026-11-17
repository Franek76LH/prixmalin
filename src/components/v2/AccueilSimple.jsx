// Chantier 123 — nouvel accueil.
//
// Un seul fil : chercher un produit -> faire sa liste -> voir où c'est le
// moins cher -> scanner son ticket. Tout le reste (cagnotte, badges, cercle,
// statistiques) vit dans l'espace « Moi ». L'écran ne décide rien : ce qu'il
// montre vient de lib/accueilCore.js.
import { useState } from 'react';
import { T } from './theme';
import { IconeLoupe, IconeChevron, IconeMicro, IconeScanner } from './Icones';
import {
  apercuListe, actionPrincipale, montrerModeDemploi, economiesConfirmees,
  ACTION_COMPARER, ACTION_COMMENCER_LISTE,
} from '../../lib/accueilCore';

const euros = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

function Carte({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, padding: 16, cursor: onClick ? 'pointer' : 'default', ...style }}>
      {children}
    </div>
  );
}

function Bouton({ children, onClick, plein = true, couleur = T.rouge, style }) {
  return (
    <button onClick={onClick} style={{
      border: plein ? 'none' : `1.5px solid ${T.trait}`, background: plein ? couleur : '#fff', color: plein ? '#fff' : T.texte,
      borderRadius: 14, padding: '13px 16px', fontFamily: T.police, fontWeight: 900, fontSize: 15, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', boxSizing: 'border-box', ...style,
    }}>{children}</button>
  );
}

// Bandeau « quelque chose t'attend » : une ligne, une action.
function Rappel({ pastille, titre, detail, action, onAction, onFermer, libelleFermer }) {
  return (
    <Carte style={{ padding: 14, borderLeft: `4px solid ${T.jaune}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, background: T.jaunePale, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>{pastille}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 14, color: T.texte }}>{titre}</div>
          {detail && <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, marginTop: 2 }}>{detail}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={onAction} style={{ border: 'none', background: T.texte, color: '#fff', borderRadius: 10, padding: '8px 14px', fontFamily: T.police, fontWeight: 900, fontSize: 13, cursor: 'pointer' }}>{action}</button>
            {onFermer && (
              <button onClick={onFermer} style={{ border: 'none', background: 'none', color: T.texteLeger, padding: '8px 6px', fontFamily: T.police, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>{libelleFermer}</button>
            )}
          </div>
        </div>
      </div>
    </Carte>
  );
}

function Confirmation({ titre, detail, libelle, onConfirmer, onAnnuler }) {
  return (
    <div onClick={onAnnuler} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, padding: 20, maxWidth: 320, width: '100%' }}>
        <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 16, color: T.texte, marginBottom: 6 }}>{titre}</div>
        <div style={{ fontFamily: T.police, fontSize: 13.5, color: T.texteDoux, marginBottom: 16 }}>{detail}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Bouton onClick={onConfirmer} style={{ flex: 1 }}>{libelle}</Bouton>
          <Bouton onClick={onAnnuler} plein={false} style={{ flex: 1 }}>Annuler</Bouton>
        </div>
      </div>
    </div>
  );
}

const ETAPES = [
  { n: 1, titre: 'Fais ta liste', detail: 'Cherche tes produits ou parcours les rayons.' },
  { n: 2, titre: 'Compare', detail: 'On te dit dans quel magasin ta liste coûte le moins cher.' },
  { n: 3, titre: 'Scanne ton ticket', detail: 'Tes prix mettent la comparaison à jour, pour toi et pour les autres.' },
];

export default function AccueilSimple({
  pseudo, items = [], archives = [], setTab, onScanner,
  scanEnCours = null, onReprendreScan, onAbandonnerScan,
  ticketAScanner = null, onOuvrirTicket = null,
  sessionCourses = null, progressionCourses = null, joursCourses = 0, onReprendreCourses, onAbandonnerCourses,
  microDisponible = false, contributionVisible = false, onContribuer,
}) {
  const [confirme, setConfirme] = useState(null); // 'scan' | 'courses' | null
  const liste = apercuListe(items);
  const action = actionPrincipale({ items, sessionCourses });
  const confirmees = economiesConfirmees(archives);
  const prenom = (pseudo || '').trim();

  return (
    <div style={{ background: T.fond, minHeight: '100vh', padding: '0 0 110px' }}>

      {/* En-tête : qui, et la recherche — le premier geste d'une app de courses */}
      <div style={{ background: T.rouge, padding: '18px 18px 22px', borderRadius: '0 0 24px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 24, color: '#fff', letterSpacing: '-0.5px' }}>
            Prix<span style={{ color: T.jaune }}>Malin</span>
          </div>
          <div style={{ fontFamily: T.police, fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
            {prenom ? `Bonjour ${prenom}` : 'Bonjour'}
          </div>
        </div>
        <button onClick={() => setTab('catalog')} aria-label="Chercher un produit" style={{
          width: '100%', border: 'none', background: '#fff', borderRadius: 14, padding: '13px 14px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10, color: T.texteLeger, boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
        }}>
          <IconeLoupe width={20} height={20} />
          <span style={{ fontFamily: T.police, fontWeight: 700, fontSize: 15 }}>Chercher un produit, une marque…</span>
        </button>
      </div>

      <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Ce qui attend l'utilisateur, s'il y a quelque chose */}
        {sessionCourses && progressionCourses && (
          <Rappel
            pastille="🛒"
            titre={`Courses en cours${sessionCourses.magasin?.nom ? ` chez ${sessionCourses.magasin.nom}` : ''}`}
            detail={`${progressionCourses.pris} article${progressionCourses.pris > 1 ? 's' : ''} sur ${progressionCourses.total} dans le caddie${joursCourses >= 2 ? ` · commencées il y a ${joursCourses} jours` : ''}`}
            action="Reprendre" onAction={onReprendreCourses}
            onFermer={() => setConfirme('courses')} libelleFermer="Abandonner"
          />
        )}
        {onOuvrirTicket && ticketAScanner && (
          <Rappel pastille="🧾" titre={ticketAScanner.titre} detail={ticketAScanner.sousTitre} action="Compléter" onAction={onOuvrirTicket} />
        )}
        {scanEnCours && (
          <Rappel
            pastille="📷" titre="Un ticket n'est pas terminé"
            detail={[scanEnCours.etape ? `Étape : ${scanEnCours.etape}` : null, scanEnCours.date ? `commencé le ${scanEnCours.date}` : null].filter(Boolean).join(' · ')}
            action="Reprendre" onAction={onReprendreScan}
            onFermer={() => setConfirme('scan')} libelleFermer="Abandonner"
          />
        )}

        {/* Ma liste — le cœur de l'accueil */}
        <Carte>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: liste.total > 0 ? 10 : 6 }}>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 18, color: T.texte }}>Ma liste de courses</div>
            {liste.total > 0 && (
              <button onClick={() => setTab('list')} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, color: T.rouge, fontFamily: T.police, fontWeight: 800, fontSize: 13 }}>
                Voir tout <IconeChevron width={16} height={16} />
              </button>
            )}
          </div>

          {action === ACTION_COMMENCER_LISTE ? (
            <>
              <div style={{ fontFamily: T.police, fontSize: 14, color: T.texteDoux, marginBottom: 14 }}>
                {liste.total > 0
                  ? 'Tout est coché. Ajoute ce qu\'il te manque pour la prochaine fois.'
                  : 'Ajoute ce qu\'il te faut : on te dira où ta liste coûte le moins cher.'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Bouton onClick={() => setTab('catalog')} style={{ flex: 1 }}>Ajouter des produits</Bouton>
                {microDisponible && (
                  <Bouton onClick={() => setTab('micro')} plein={false} style={{ width: 'auto', flexShrink: 0 }}>
                    <IconeMicro width={18} height={18} /> Dicter
                  </Bouton>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {liste.apercu.map((nom, i) => (
                  <span key={`${nom}-${i}`} style={{ background: T.fond, border: `1px solid ${T.trait}`, borderRadius: 99, padding: '6px 12px', fontFamily: T.police, fontWeight: 700, fontSize: 13, color: T.texte, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nom}</span>
                ))}
                {liste.reste > 0 && (
                  <span style={{ borderRadius: 99, padding: '6px 10px', fontFamily: T.police, fontWeight: 800, fontSize: 13, color: T.texteLeger }}>+ {liste.reste} autre{liste.reste > 1 ? 's' : ''}</span>
                )}
              </div>
              {action === ACTION_COMPARER && (
                <Bouton onClick={() => setTab('compare')}>Où c'est le moins cher ?</Bouton>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Bouton onClick={() => setTab('catalog')} plein={false} style={{ flex: 1, padding: '11px 12px', fontSize: 14 }}>Ajouter des produits</Bouton>
                {microDisponible && (
                  <Bouton onClick={() => setTab('micro')} plein={false} style={{ width: 'auto', flexShrink: 0, padding: '11px 14px', fontSize: 14 }}>
                    <IconeMicro width={18} height={18} /> Dicter
                  </Bouton>
                )}
              </div>
            </>
          )}
        </Carte>

        {/* Chantier 134 — le catalogue a son entrée à lui sur l'accueil : sans
            elle, on ne le trouvait qu'en passant par « Ajouter des produits ». */}
        <Carte onClick={() => setTab('catalog')} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 46, height: 46, borderRadius: 14, background: T.jaunePale, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 23, flexShrink: 0 }}>🛒</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte }}>Parcourir les rayons</div>
            <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, marginTop: 2 }}>Tout le catalogue, rayon par rayon, avec les prix.</div>
            <div aria-hidden="true" style={{ fontSize: 17, letterSpacing: 5, marginTop: 6 }}>🥦🥩🐟🥛🧂🍫🥤</div>
          </div>
          <IconeChevron width={20} height={20} style={{ color: T.texteLeger, flexShrink: 0 }} />
        </Carte>

        {/* Scanner un ticket : ce qui nourrit les prix */}
        <Carte onClick={onScanner} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 46, height: 46, borderRadius: 14, background: T.rougePale, color: T.rouge, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <IconeScanner width={24} height={24} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte }}>Scanner un ticket de caisse</div>
            <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, marginTop: 2 }}>Une photo, et tes prix sont à jour.</div>
          </div>
          <IconeChevron width={20} height={20} style={{ color: T.texteLeger, flexShrink: 0 }} />
        </Carte>

        {/* Économies confirmées : seulement quand il y en a */}
        {confirmees > 0 && (
          <Carte onClick={() => setTab('economies')} style={{ display: 'flex', alignItems: 'center', gap: 14, background: T.vertPale, boxShadow: 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.police, fontSize: 12.5, fontWeight: 800, color: T.vert }}>Économisé grâce à tes tickets</div>
              <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 24, color: T.vert, marginTop: 1 }}>{euros(confirmees)}</div>
            </div>
            <IconeChevron width={20} height={20} style={{ color: T.vert, flexShrink: 0 }} />
          </Carte>
        )}

        {/* Mode d'emploi : pour un nouveau seulement */}
        {montrerModeDemploi({ archives, items }) && (
          <Carte style={{ boxShadow: 'none', border: `1px solid ${T.trait}` }}>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte, marginBottom: 12 }}>Comment ça marche</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ETAPES.map(e => (
                <div key={e.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: T.jaune, color: T.texte, fontFamily: T.police, fontWeight: 900, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{e.n}</span>
                  <div>
                    <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 14, color: T.texte }}>{e.titre}</div>
                    <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, marginTop: 1 }}>{e.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Carte>
        )}

        {/* Contribution codes-barres : discrète, en bas */}
        {contributionVisible && (
          <button onClick={onContribuer} style={{ border: `1px dashed ${T.trait}`, background: 'none', borderRadius: 14, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
            <span style={{ fontSize: 18 }}>🏷️</span>
            <span style={{ flex: 1, fontFamily: T.police, fontSize: 13, color: T.texteDoux }}>
              <strong style={{ color: T.texte }}>Aide à compléter la base</strong> — scanne le code-barres d'un produit du placard.
            </span>
            <IconeChevron width={18} height={18} style={{ color: T.texteLeger }} />
          </button>
        )}
      </div>

      {confirme === 'courses' && (
        <Confirmation
          titre="Abandonner ces courses ?"
          detail={`La progression (${progressionCourses?.pris ?? 0} sur ${progressionCourses?.total ?? 0}) sera perdue. Ta liste n'est pas touchée.`}
          libelle="Abandonner"
          onConfirmer={() => { onAbandonnerCourses?.(); setConfirme(null); }}
          onAnnuler={() => setConfirme(null)}
        />
      )}
      {confirme === 'scan' && (
        <Confirmation
          titre="Abandonner ce ticket ?"
          detail="Le ticket scanné et tes corrections seront perdus."
          libelle="Abandonner"
          onConfirmer={() => { onAbandonnerScan?.(); setConfirme(null); }}
          onAnnuler={() => setConfirme(null)}
        />
      )}
    </div>
  );
}
