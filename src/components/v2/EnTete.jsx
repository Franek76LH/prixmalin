// Chantier 125 — en-tête des écrans (tout sauf l'accueil) : une barre claire,
// le titre de l'écran, et une flèche « retour » sur les écrans qu'on ouvre
// depuis un autre (Catalogue depuis Ma liste, Mes tickets depuis Moi…).
// Le menu du compte qui s'y trouvait est désormais l'espace « Moi ».
import { T } from './theme';
import { IconeRetour } from './Icones';
import { titreEcran, ecranParent } from '../../lib/navigationCore';


export default function EnTete({ tab, setTab, droite = null }) {
  const parent = ecranParent(tab);
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 40, background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${T.trait}`, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, minHeight: 56, boxSizing: 'border-box',
    }}>
      {parent && (
        <button onClick={() => setTab(parent)} aria-label="Retour" style={{
          border: 'none', background: T.fond, color: T.texte, width: 36, height: 36, borderRadius: 12, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <IconeRetour width={20} height={20} />
        </button>
      )}
      <h1 style={{ flex: 1, minWidth: 0, margin: 0, fontFamily: T.police, fontWeight: 900, fontSize: 20, color: T.texte, letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {titreEcran(tab)}
      </h1>
      {droite}
    </header>
  );
}
