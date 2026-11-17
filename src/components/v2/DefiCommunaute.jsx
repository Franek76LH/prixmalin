// Chantier 139 — carte « Le défi de la communauté » sur l'accueil.
// Le manque de prix récents devient un objectif commun : une barre qui avance,
// la part de chacun, et les vrais chiffres. Tout est calculé dans
// lib/communauteCore.js ; sans chiffres, la carte ne s'affiche pas.
import { T } from './theme';
import { defiCommunaute, motPourToi, nombre } from '../../lib/communauteCore';

export default function DefiCommunaute({ stats, onScanner }) {
  const defi = defiCommunaute(stats);
  if (!defi) return null;

  return (
    <div style={{ background: '#14060A', borderRadius: T.rayon, padding: 16, color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 16 }}>Le défi de la communauté</div>
        {defi.membres && (
          <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 12, color: T.jaune, flexShrink: 0 }}>{nombre(defi.membres)} membres actifs</div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
        <span style={{ fontFamily: T.police, fontWeight: 900, fontSize: 34, lineHeight: 1, color: T.jaune }}>{nombre(defi.recents)}</span>
        <span style={{ fontFamily: T.police, fontWeight: 800, fontSize: 14, color: '#D3D1C7' }}>prix frais sur {nombre(defi.palier)}</span>
      </div>

      <div role="progressbar" aria-valuemin={0} aria-valuemax={defi.palier} aria-valuenow={defi.recents} aria-label="Avancement du défi de la communauté"
        style={{ height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.14)', marginTop: 10, overflow: 'hidden' }}>
        <div style={{ width: `${defi.pourcentage}%`, height: '100%', borderRadius: 99, background: T.jaune }} />
      </div>

      <div style={{ fontFamily: T.police, fontSize: 13, color: '#F1EFE8', marginTop: 10, lineHeight: 1.45 }}>
        Encore <strong>{nombre(defi.reste)} prix</strong> relevés ce mois-ci et le palier est atteint. {motPourToi(defi)}
      </div>

      {onScanner && (
        <button onClick={onScanner} style={{ width: '100%', marginTop: 14, border: 'none', background: T.jaune, color: '#16181D', borderRadius: 13, padding: 12, fontFamily: T.police, fontWeight: 900, fontSize: 14.5, cursor: 'pointer' }}>
          Scanner un ticket
        </button>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.14)' }}>
        {[{ n: defi.total, t: 'prix' }, { n: defi.produits, t: 'produits' }, { n: defi.magasins, t: 'magasins' }].map(c => (
          <div key={c.t} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 17 }}>{nombre(c.n)}</div>
            <div style={{ fontFamily: T.police, fontWeight: 700, fontSize: 11.5, color: '#B4B2A9' }}>{c.t}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
