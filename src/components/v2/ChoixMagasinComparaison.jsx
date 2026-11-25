// Chantier 177 — la liste des magasins comparés (propositions 2 et 3 de
// l'audit du 25/11). Chaque ligne dit sur quoi repose la comparaison
// (« 7 prix sur 8 », total sur les produits communs) ; toucher une ligne
// choisit ce magasin : son détail s'affiche juste en dessous, avec « Je fais
// mes courses chez… ». Présentation seule : le classement vient de
// lib/classementHonnete.js.
import { T } from './theme';

const euros = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

const ETIQUETTES = {
  moins_cher: { texte: 'Le moins cher', fond: T.vertPale, couleur: T.vert },
  plus_complet: { texte: 'Le plus complet', fond: '#EEF2FF', couleur: T.bleu },
};

export default function ChoixMagasinComparaison({ classement, nbArticles, choisiId, onChoisir }) {
  if (!classement?.magasins?.length) return null;
  const { magasins, nbCommuns, moinsCherId } = classement;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 12, color: T.texteLeger, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 4px 4px' }}>
        {magasins.length > 1 ? 'Choisis ton magasin' : 'Magasin'}
      </div>
      <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, margin: '0 4px 8px' }}>
        {moinsCherId
          ? `Comparés sur les ${nbCommuns} produit${nbCommuns > 1 ? 's' : ''} qu'ils ont tous, pour que ce soit juste.`
          : 'Pas assez de produits en commun pour désigner le moins cher : choisis selon les prix connus.'}
      </div>
      <div role="radiogroup" aria-label="Magasins comparés" style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>
        {magasins.map((m, i) => {
          const choisi = m.id === choisiId;
          const detail = [
            `${m.found} prix sur ${nbArticles}`,
            m.totalCommuns != null && moinsCherId
              ? (m.ecartCommuns ? `+${euros(m.ecartCommuns)} sur les produits communs` : `${euros(m.totalCommuns)} sur les produits communs`)
              : null,
          ].filter(Boolean).join(' · ');
          return (
            <button key={m.id} role="radio" aria-checked={choisi} onClick={() => onChoisir?.(m.id)} style={{
              width: '100%', border: 'none', borderBottom: i === magasins.length - 1 ? 'none' : `1px solid ${T.trait}`,
              background: choisi ? '#FFF7F7' : 'transparent', cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', minHeight: 56,
              boxShadow: choisi ? `inset 4px 0 0 ${T.rouge}` : 'none',
            }}>
              <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box', border: `2px solid ${choisi ? T.rouge : '#C9CDD4'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {choisi && <span style={{ width: 10, height: 10, borderRadius: '50%', background: T.rouge }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte }}>{m.magasin.name}</span>
                  {m.etiquettes.map(e => (
                    <span key={e} style={{ background: ETIQUETTES[e].fond, color: ETIQUETTES[e].couleur, borderRadius: 99, padding: '2px 8px', fontFamily: T.police, fontWeight: 900, fontSize: 10.5 }}>{ETIQUETTES[e].texte}</span>
                  ))}
                </span>
                <span style={{ display: 'block', fontFamily: T.police, fontSize: 12, color: T.texteLeger, marginTop: 2 }}>{detail}</span>
              </span>
              <span style={{ textAlign: 'right', flexShrink: 0 }}>
                <span style={{ display: 'block', fontFamily: T.police, fontWeight: 900, fontSize: 16, color: T.texte }}>{euros(m.total)}</span>
                <span style={{ display: 'block', fontFamily: T.police, fontSize: 11, color: T.texteLeger }}>{m.found >= nbArticles ? 'toute ta liste' : `${m.found} produit${m.found > 1 ? 's' : ''}`}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
