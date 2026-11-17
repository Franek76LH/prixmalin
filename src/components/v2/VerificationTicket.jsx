// Chantier 132 — étape « Vérifie ton ticket » après le scan, dans la nouvelle
// interface. Présentation SEULEMENT : aucune règle ne change (mêmes lignes,
// mêmes cases, mêmes prix modifiables, mêmes boutons). L'ancien écran
// empilait des cadres rouges et jaunes et finissait par « Coller un autre
// JSON » ; celui-ci se lit comme un ticket.
import { T } from './theme';
import { IconeCoche } from './Icones';
import { euros } from '../../lib/ticketsCore';

const ETIQUETTES = {
  reconnu: { texte: 'Reconnu', couleur: T.vert, fond: T.vertPale },
  suggere: { texte: 'À confirmer', couleur: T.bleu, fond: T.bleuPale },
  a_verifier: { texte: 'À vérifier', couleur: '#B25900', fond: '#FFF1DC' },
};

export default function VerificationTicket({
  magasin = '',
  date = null,
  totalImprime = null,
  produits = [],
  libelle = (p) => p.name || '',
  format = (p) => p.format || '',
  etiquette = () => null,
  remise = () => null,
  onBasculer,
  onPrix,
  onModifierMagasin,
  onContinuer,
  onRecommencer,
  children = null,
}) {
  const gardes = produits.filter(p => p.keep);
  const somme = gardes.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);

  return (
    <>
      <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 17, color: T.texte, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{magasin || 'Magasin'}</div>
            {date && (
              <div style={{ fontFamily: T.police, fontSize: 13, color: T.texteDoux, marginTop: 1 }}>
                {new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            )}
          </div>
          {onModifierMagasin && (
            <button onClick={onModifierMagasin} style={{ border: `1px solid ${T.trait}`, background: '#fff', borderRadius: 99, padding: '6px 13px', fontFamily: T.police, fontWeight: 800, fontSize: 12.5, color: T.texte, cursor: 'pointer', flexShrink: 0 }}>Modifier</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.trait}` }}>
          <div>
            <div style={{ fontFamily: T.police, fontSize: 11.5, fontWeight: 800, color: T.texteLeger }}>Produits</div>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 18, color: T.texte }}>{gardes.length}</div>
          </div>
          <div>
            <div style={{ fontFamily: T.police, fontSize: 11.5, fontWeight: 800, color: T.texteLeger }}>Somme des lignes</div>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 18, color: T.texte }}>{euros(somme)}</div>
          </div>
          {totalImprime != null && (
            <div>
              <div style={{ fontFamily: T.police, fontSize: 11.5, fontWeight: 800, color: T.texteLeger }}>Total du ticket</div>
              <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 18, color: T.texte }}>{euros(totalImprime)}</div>
            </div>
          )}
        </div>
      </div>

      {children}

      <div style={{ fontFamily: T.police, fontSize: 13, color: T.texteDoux, margin: '0 4px 8px' }}>
        Vérifie les prix. Décoche une ligne pour ne pas l'enregistrer.
      </div>
      <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden', marginBottom: 18 }}>
        {produits.map((p, i) => {
          const e = ETIQUETTES[etiquette(p)];
          const texteRemise = remise(p);
          const leFormat = format(p);
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: i === produits.length - 1 ? 'none' : `1px solid ${T.trait}`, opacity: p.keep ? 1 : 0.45 }}>
              <button onClick={() => onBasculer?.(p.id)} role="checkbox" aria-checked={!!p.keep} aria-label={p.keep ? 'Ne pas enregistrer cette ligne' : 'Enregistrer cette ligne'}
                style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, cursor: 'pointer', border: `2px solid ${p.keep ? T.rouge : T.texteLeger}`, background: p.keep ? T.rouge : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                {p.keep && <IconeCoche width={15} height={15} />}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 14, color: T.texte, textDecoration: p.keep ? 'none' : 'line-through' }}>
                  {p.brand ? `${p.brand} · ` : ''}{libelle(p)}
                </div>
                {(leFormat || e) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                    {leFormat && <span style={{ fontFamily: T.police, fontSize: 12, color: T.texteLeger }}>{leFormat}</span>}
                    {e && <span style={{ fontFamily: T.police, fontSize: 10.5, fontWeight: 900, color: e.couleur, background: e.fond, borderRadius: 99, padding: '2px 8px' }}>{e.texte}</span>}
                  </div>
                )}
                {texteRemise && <div style={{ fontFamily: T.police, fontSize: 12, fontWeight: 800, color: T.vert, marginTop: 2 }}>{texteRemise}</div>}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, background: T.fond, border: `1.5px solid ${T.trait}`, borderRadius: 10, padding: '5px 9px' }}>
                <input type="number" inputMode="decimal" step="0.01" min="0" value={p.price} onChange={ev => onPrix?.(p.id, ev.target.value)} aria-label={`Prix de ${libelle(p)}`}
                  style={{ width: 58, border: 'none', background: 'transparent', textAlign: 'right', fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte, outline: 'none', padding: 0 }} />
                <span style={{ fontFamily: T.police, fontWeight: 800, fontSize: 14, color: T.texteDoux }}>€</span>
              </label>
            </div>
          );
        })}
      </div>

      <button onClick={onContinuer}
        style={{ width: '100%', padding: 16, border: 'none', borderRadius: 14, background: T.rouge, fontFamily: T.police, fontWeight: 900, fontSize: 16, color: '#fff', cursor: 'pointer', marginBottom: 10 }}>
        Continuer
      </button>
      {onRecommencer && (
        <button onClick={onRecommencer} style={{ width: '100%', padding: 13, border: `1.5px solid ${T.trait}`, borderRadius: 14, background: '#fff', fontFamily: T.police, fontWeight: 800, fontSize: 14, color: T.texteDoux, cursor: 'pointer' }}>
          Recommencer le scan
        </button>
      )}
    </>
  );
}
