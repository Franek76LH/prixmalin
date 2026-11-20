// Chantier 160 — quand une liste validée est en cours (« Mes courses ») ET
// qu'une liste se prépare (« Ma liste »), on passe de l'une à l'autre par ces
// deux onglets, en haut des deux écrans. Rien n'est recopié ni écrasé : ce
// sont deux listes distinctes, chacune garde ses cases cochées.
import { T } from './theme';

export default function BasculeCourses({ ecran, setTab, nbListe = 0, progression = null, magasin = null }) {
  const onglets = [
    { id: 'list', titre: 'Ma liste', detail: nbListe > 0 ? `${nbListe} à acheter` : 'à préparer' },
    { id: 'courses', titre: 'Mes courses', detail: progression ? `${progression.pris}/${progression.total} dans le caddie` : (magasin || 'en cours') },
  ];
  return (
    <div style={{ padding: '12px 16px 0' }}>
      <div role="tablist" aria-label="Ma liste ou Mes courses" style={{ display: 'flex', gap: 4, background: '#ECEEF1', borderRadius: 14, padding: 4 }}>
        {onglets.map(o => {
          const actif = ecran === o.id;
          return (
            <button key={o.id} role="tab" aria-selected={actif} onClick={() => { if (!actif) setTab(o.id); }} style={{
              flex: 1, border: 'none', cursor: actif ? 'default' : 'pointer', borderRadius: 11, padding: '8px 6px',
              background: actif ? '#fff' : 'transparent', boxShadow: actif ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <span style={{ fontFamily: T.police, fontWeight: 900, fontSize: 14, color: actif ? T.texte : T.texteDoux }}>{o.titre}</span>
              <span style={{ fontFamily: T.police, fontWeight: 700, fontSize: 11.5, color: T.texteLeger, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.detail}</span>
            </button>
          );
        })}
      </div>
      {ecran === 'list' && (
        <div style={{ fontFamily: T.police, fontSize: 12, color: T.texteDoux, margin: '8px 4px 0' }}>
          Courses en cours{magasin ? ` chez ${magasin}` : ''} : coche tes articles dans « Mes courses ». Ce que tu fais ici n'y touche pas.
        </div>
      )}
    </div>
  );
}
