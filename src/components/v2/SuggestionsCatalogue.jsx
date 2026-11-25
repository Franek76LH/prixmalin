// Chantier 183 — sous un champ de saisie pendant les courses : les fiches du
// catalogue qui correspondent à ce qui est tapé. Un appui choisit la fiche
// (l'article sera reconnu sur le ticket) ; sinon le texte tapé reste
// utilisable tel quel. Jamais bloquant : une erreur réseau n'affiche rien.
import { useEffect, useState } from 'react';
import { T } from './theme';
import { chercherProduitsCatalogue } from '../../lib/suggestionsCatalogue';

export default function SuggestionsCatalogue({ texte, onChoisir, decalage = 0 }) {
  const [resultats, setResultats] = useState([]);
  useEffect(() => {
    let annule = false;
    const q = String(texte || '').trim();
    const t = setTimeout(() => {
      if (q.length < 2) { setResultats([]); return; }
      chercherProduitsCatalogue(q)
        .then(r => { if (!annule) setResultats(r); })
        .catch(() => { if (!annule) setResultats([]); });
    }, 300);
    return () => { annule = true; clearTimeout(t); };
  }, [texte]);
  if (resultats.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: `6px 0 4px ${decalage}px` }}>
      {resultats.map(p => (
        <button key={p.id} onClick={() => onChoisir?.(p)} style={{
          border: `1px solid ${T.bleu}`, background: '#fff', color: T.bleu, borderRadius: 99, padding: '7px 12px', minHeight: 36,
          fontFamily: T.police, fontWeight: 800, fontSize: 13, cursor: 'pointer',
        }}>{p.nom}</button>
      ))}
    </div>
  );
}
