// Chantier 126 — « Tu veux dire… ? » : les produits de la liste écrits en texte
// libre que le catalogue ne reconnaît pas tels quels, avec jusqu'à 3 fiches
// proposées. Un appui relie le produit ; rien n'est relié sans ce geste.
import { T } from './theme';

export default function ProduitsARelier({ items = [], propositions = {}, onRelier }) {
  const lignes = items.filter(i => propositions[i.id]?.length);
  if (lignes.length === 0) return null;
  return (
    <div style={{ background: T.bleuPale, border: '1px solid #CFE0FF', borderRadius: T.rayon, padding: 14, marginBottom: 14 }}>
      <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 14.5, color: T.texte }}>
        {lignes.length > 1 ? `${lignes.length} produits à préciser` : '1 produit à préciser'}
      </div>
      <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, margin: '2px 0 10px' }}>
        Choisis le bon produit pour qu'on trouve ses prix.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lignes.map(item => (
          <div key={item.id}>
            <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 13.5, color: T.texte, marginBottom: 5 }}>« {item.product} »</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {propositions[item.id].map(p => (
                <button key={p.produit_id} onClick={() => onRelier?.(item, p)} style={{
                  border: `1px solid ${T.bleu}`, background: '#fff', color: T.bleu, borderRadius: 99, padding: '7px 13px',
                  fontFamily: T.police, fontWeight: 800, fontSize: 13, cursor: 'pointer',
                }}>{p.produit_nom}{p.memorise ? ' · comme d\'habitude' : p.dejaAchete ? ' · déjà acheté' : ''}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
