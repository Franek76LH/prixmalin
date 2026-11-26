// Chantier 126 — carte du magasin retenu par le comparateur, dans la nouvelle
// interface. Présentation seule : le verdict (lib/comparaisonHonnete.js) et les
// lignes sont calculés par CompareTab, qui garde aussi l'action de validation.
import { T } from './theme';

const euros = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

export default function ResultatComparaison({
  magasin, complet, trouves, nbArticles, total, aPrixAVerifier = false,
  // Chantier 177 — badge et liseré fournis par CompareTab (classement honnête) ;
  // sans eux, comportement d'avant.
  etiquette = null, miseEnAvant = null, avertissement = null,
  lignes = [], alternatives = [], economie = null, dernierReleve = null, lienItineraire = '#', onValider,
  // Chantier 198 — phrase « N prix ont plus de 6 mois » (ou null).
  prixAnciens = null,
}) {
  const manquants = Math.max(0, nbArticles - trouves);
  const vert = miseEnAvant ?? complet;
  const badge = etiquette ?? (complet ? 'LE MOINS CHER POUR TA LISTE' : `LE MIEUX RENSEIGNÉ · ${trouves} PRODUIT${trouves > 1 ? 'S' : ''} SUR ${nbArticles}`);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden', border: `2px solid ${vert ? T.vert : T.trait}` }}>

        {/* Le magasin et le total */}
        <div style={{ padding: '16px 16px 14px' }}>
          <span style={{ display: 'inline-block', background: vert ? T.vertPale : T.jaunePale, color: vert ? T.vert : '#7A5B00', borderRadius: 99, padding: '4px 11px', fontFamily: T.police, fontWeight: 900, fontSize: 11.5, letterSpacing: '0.03em' }}>
            {badge}
          </span>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 22, color: T.texte, lineHeight: 1.15 }}>{magasin.nom}</div>
              {magasin.adresse && <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteLeger, marginTop: 3 }}>{magasin.adresse}</div>}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 28, color: T.texte, lineHeight: 1 }}>{euros(total)}</div>
              <div style={{ fontFamily: T.police, fontSize: 11.5, color: T.texteLeger, marginTop: 3 }}>
                {complet ? 'pour toute ta liste' : `pour ${trouves} produit${trouves > 1 ? 's' : ''}`}
              </div>
            </div>
          </div>
          {!complet && (
            <div style={{ fontFamily: T.police, fontSize: 12.5, color: '#7A5B00', background: T.jaunePale, borderRadius: 10, padding: '8px 10px', marginTop: 12 }}>
              Il manque le prix de {manquants} produit{manquants > 1 ? 's' : ''} dans ce magasin : ce total n'est pas celui de toute ta liste.
            </div>
          )}
          {aPrixAVerifier && (
            <div style={{ fontFamily: T.police, fontSize: 12, color: T.texteDoux, marginTop: 8 }}>Ce total contient au moins un prix à vérifier.</div>
          )}
          {avertissement && (
            <div style={{ fontFamily: T.police, fontSize: 12.5, color: '#9A3412', background: '#FFF1E6', borderRadius: 10, padding: '8px 10px', marginTop: 10, fontWeight: 800 }}>{avertissement}</div>
          )}
          {prixAnciens && (
            <div style={{ fontFamily: T.police, fontSize: 12.5, color: '#7A5B00', background: T.jaunePale, borderRadius: 10, padding: '8px 10px', marginTop: 10 }}>🕰️ {prixAnciens}</div>
          )}
          {economie && (
            <div style={{ fontFamily: T.police, fontSize: 13, color: T.vert, fontWeight: 800, marginTop: 10 }}>{economie}</div>
          )}
          {dernierReleve && (
            <div style={{ fontFamily: T.police, fontSize: 11.5, color: T.texteLeger, marginTop: 6 }}>{dernierReleve}</div>
          )}
        </div>

        {/* Le détail, produit par produit */}
        <div style={{ borderTop: `1px solid ${T.trait}` }}>
          {lignes.map((l, i) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: i === lignes.length - 1 ? 'none' : `1px solid ${T.trait}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 14, color: l.manquant ? T.texteLeger : T.texte, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.nom}
                  {l.marqueMagasin && <span style={{ marginLeft: 6, background: T.fond, color: T.texteDoux, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 900, verticalAlign: 'middle' }}>Marque de magasin</span>}
                </div>
                {l.sousTitre && <div style={{ fontFamily: T.police, fontSize: 12, color: T.texteLeger, marginTop: 1 }}>{l.sousTitre}</div>}
              </div>
              {l.manquant ? (
                <span style={{ fontFamily: T.police, fontSize: 12, fontWeight: 800, color: T.texteLeger, flexShrink: 0 }}>pas de prix ici</span>
              ) : (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte }}>{euros(l.total)}</div>
                  {l.detail && <div style={{ fontFamily: T.police, fontSize: 11, color: l.aVerifier ? '#B45309' : T.texteLeger, fontWeight: l.aVerifier ? 800 : 500, marginTop: 1 }}>{l.detail}</div>}
                  {l.ancien && <div style={{ fontFamily: T.police, fontSize: 11, color: '#B45309', fontWeight: 800, marginTop: 1 }}>{l.ancien}</div>}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Les actions */}
        <div style={{ padding: 14, borderTop: `1px solid ${T.trait}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onValider} style={{ width: '100%', border: 'none', background: T.rouge, color: '#fff', borderRadius: 14, padding: '15px', fontFamily: T.police, fontWeight: 900, fontSize: 15.5, cursor: 'pointer' }}>
            Je fais mes courses chez {magasin.nom}
          </button>
          <a href={lienItineraire} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', border: `1.5px solid ${T.trait}`, borderRadius: 14, padding: '12px', fontFamily: T.police, fontWeight: 800, fontSize: 14, color: T.texte, textDecoration: 'none' }}>
            Voir l'itinéraire
          </a>
        </div>
      </div>

      {/* Les produits absents de ce magasin, trouvés ailleurs */}
      {alternatives.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 12, color: T.texteLeger, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 4px 8px' }}>Trouvés dans un autre magasin</div>
          <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>
            {alternatives.map((a, i) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: i === alternatives.length - 1 ? 'none' : `1px solid ${T.trait}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 14, color: T.texte, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nom}</div>
                  <div style={{ fontFamily: T.police, fontSize: 12, color: T.texteLeger, marginTop: 1 }}>chez {a.magasin}</div>
                </div>
                <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte, flexShrink: 0 }}>{euros(a.prix)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
