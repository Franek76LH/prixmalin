// Chantier 123 — barre du bas, comme dans une app de courses classique :
// cinq entrées fixes, toujours au même endroit, l'action principale (scanner
// son ticket) au centre. Remplace les pastilles flottantes animées.
import { T } from './theme';
import { IconeAccueil, IconeListe, IconeScanner, IconeComparer, IconeMoi } from './Icones';

// Onglets de l'app rattachés à chaque entrée (pour savoir laquelle allumer).
const FAMILLES = {
  home: 'home',
  list: 'list', catalog: 'list', micro: 'list', courses: 'list',
  prices: 'scan',
  compare: 'compare',
  moi: 'moi', archive: 'moi', economies: 'moi', rejets: 'moi',
};

export function entreeActive(tab) {
  return FAMILLES[tab] || 'home';
}

export default function BarreNavigation({ tab, setTab, onScanner, nbListe = 0, pastilleMoi = false }) {
  const active = entreeActive(tab);
  const entrees = [
    { id: 'home', libelle: 'Accueil', Icone: IconeAccueil, action: () => setTab('home') },
    { id: 'list', libelle: 'Ma liste', Icone: IconeListe, action: () => setTab('list'), compteur: nbListe },
    { id: 'scan', libelle: 'Scanner', Icone: IconeScanner, action: onScanner, central: true },
    { id: 'compare', libelle: 'Comparer', Icone: IconeComparer, action: () => setTab('compare') },
    { id: 'moi', libelle: 'Moi', Icone: IconeMoi, action: () => setTab('moi'), point: pastilleMoi },
  ];

  return (
    <nav aria-label="Navigation principale" style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, zIndex: 50,
      background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      borderTop: `1px solid ${T.trait}`, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around',
      padding: '6px 6px calc(6px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box',
      userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation',
    }}>
      {entrees.map(({ id, libelle, Icone, action, compteur, central, point }) => {
        const allume = active === id;
        const couleur = allume ? T.rouge : T.texteLeger;
        if (central) {
          return (
            <button key={id} onClick={action} aria-label="Scanner un ticket de caisse" style={{
              border: 'none', background: 'none', padding: 0, cursor: 'pointer', flex: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, marginTop: -22,
            }}>
              <span style={{
                width: 56, height: 56, borderRadius: '50%', background: T.rouge, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '4px solid #fff', boxShadow: '0 6px 16px rgba(217,18,26,0.35)',
              }}>
                <Icone width={26} height={26} />
              </span>
              <span style={{ fontFamily: T.police, fontSize: 11, fontWeight: 800, color: allume ? T.rouge : T.texteDoux }}>{libelle}</span>
            </button>
          );
        }
        return (
          <button key={id} onClick={action} aria-current={allume ? 'page' : undefined} style={{
            border: 'none', background: 'none', padding: '4px 0 0', cursor: 'pointer', flex: 1,
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
