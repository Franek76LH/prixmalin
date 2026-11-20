// Chantier 123 — barre du bas, comme dans une app de courses classique :
// des entrées fixes, toujours au même endroit, l'action principale (scanner
// son ticket) au centre.
// Chantier 160 (20/11) — « Accueil · Courses · Scanner · Comparer · Moi ».
// « Courses » ouvre Mes courses quand une liste validée est en cours (point
// rouge), sinon Ma liste. « Scanner » est un bouton d'action rond, surélevé :
// il ouvre le scan du ticket sans changer l'onglet allumé.
import { T } from './theme';
import { entreeActive } from '../../lib/navigationCore';
import { IconeAccueil, IconeListe, IconeScanner, IconeComparer, IconeMoi } from './Icones';

// Hauteur visible de la barre (hors barre de gestes) et débord du bouton
// central : les boutons flottants des écrans se posent au-dessus.
export const HAUTEUR_BARRE = 62;
export const DEBORD_SCANNER = 20;

export default function BarreNavigation({ tab, setTab, onCourses, onScanner, nbListe = 0, coursesEnCours = false, pastilleMoi = false }) {
  const active = entreeActive(tab);
  const entrees = [
    { id: 'home', libelle: 'Accueil', Icone: IconeAccueil, action: () => setTab('home') },
    { id: 'courses', libelle: 'Courses', Icone: IconeListe, action: onCourses || (() => setTab('list')), compteur: coursesEnCours ? 0 : nbListe, point: coursesEnCours },
    { id: 'scan', libelle: 'Scanner', Icone: IconeScanner, action: onScanner, central: true },
    { id: 'compare', libelle: 'Comparer', Icone: IconeComparer, action: () => setTab('compare') },
    { id: 'moi', libelle: 'Moi', Icone: IconeMoi, action: () => setTab('moi'), point: pastilleMoi },
  ];

  return (
    <nav aria-label="Navigation principale" style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, zIndex: 50,
      background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      borderTop: `1px solid ${T.trait}`, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around',
      padding: '6px 4px calc(6px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box', minHeight: HAUTEUR_BARRE,
      userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation',
    }}>
      {entrees.map((entree) => {
        const { id, libelle, action, compteur, point, central } = entree;
        const Icone = entree.Icone;
        const allume = active === id;
        const couleur = allume ? T.rouge : T.texteLeger;
        if (central) {
          return (
            <button key={id} onClick={action} aria-label="Scanner un ticket de caisse" style={{
              border: 'none', background: 'none', padding: 0, cursor: 'pointer', flex: 1, minWidth: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: -DEBORD_SCANNER,
            }}>
              <span style={{
                width: 54, height: 54, boxSizing: 'border-box', borderRadius: '50%', background: T.rouge, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '4px solid #fff', boxShadow: '0 6px 16px rgba(204,0,0,0.35)',
              }}>
                <Icone width={25} height={25} />
              </span>
              <span style={{ fontFamily: T.police, fontSize: 11, fontWeight: 900, color: allume ? T.rouge : T.texte }}>{libelle}</span>
            </button>
          );
        }
        return (
          <button key={id} onClick={action} aria-current={allume ? 'page' : undefined}
            aria-label={id === 'courses' && point ? 'Courses — des courses sont en cours' : undefined} style={{
            border: 'none', background: 'none', padding: '4px 0 0', cursor: 'pointer', flex: 1, minWidth: 0, minHeight: 48,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: couleur,
          }}>
            <span style={{ position: 'relative', display: 'flex' }}>
              <Icone />
              {compteur > 0 && (
                <span style={{
                  position: 'absolute', top: -6, right: -11, minWidth: 17, height: 17, padding: '0 4px', boxSizing: 'border-box',
                  borderRadius: 99, background: T.rouge, color: '#fff', border: '2px solid #fff',
                  fontFamily: T.police, fontSize: 10, fontWeight: 900, lineHeight: '13px', textAlign: 'center',
                }}>{compteur > 99 ? '99+' : compteur}</span>
              )}
              {point && (
                <span style={{ position: 'absolute', top: -2, right: -4, width: 9, height: 9, borderRadius: '50%', background: T.rouge, border: '2px solid #fff' }} />
              )}
            </span>
            <span style={{ fontFamily: T.police, fontSize: 11, fontWeight: allume ? 900 : 700 }}>{libelle}</span>
          </button>
        );
      })}
    </nav>
  );
}
