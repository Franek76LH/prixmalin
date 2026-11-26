// Chantier 194 — carte « Même prix, meilleure note » de Ma liste. Les règles
// sont dans lib/memePrixMeilleureNote.js ; ici seulement l'affichage. Rien du
// tout si aucune proposition honnête (jamais une carte vide), jamais bloquant
// si la lecture échoue.
import { useEffect, useMemo, useState } from 'react';
import { T } from './theme';
import { COULEURS_NUTRI } from '../../lib/nutriScoreCore';
import { formatFormatStructure } from '../../lib/catalogueCore';
import {
  chargerRelevesPourListe, trouverAlternatives, libelleMarque, ageReleve, formaterParUnite, lireRefus, ajouterRefus,
} from '../../lib/memePrixMeilleureNote';

function Lettre({ lettre }) {
  const c = COULEURS_NUTRI[lettre];
  if (!c) return null;
  return (
    <span aria-label={`Nutri-Score ${lettre}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 22, borderRadius: 6, background: c.fond, color: c.texte, fontFamily: T.police, fontWeight: 900, fontSize: 13 }}>{lettre}</span>
  );
}

function etiquetteAlternative(alt) {
  const format = formatFormatStructure(alt) || '';
  const marque = libelleMarque(alt);
  return [marque, format].filter(Boolean).join(' · ');
}

export default function CarteMemePrixMeilleureNote({ items = [], onRemplacer, chargeur = chargerRelevesPourListe }) {
  const cle = useMemo(() => (items || []).filter(i => i && !i.checked && i.variante_produit_id).map(i => `${i.produit_id}:${i.variante_produit_id}`).sort().join(','), [items]);
  const [releves, setReleves] = useState(null);
  const [refus, setRefus] = useState(() => lireRefus());
  const [enCours, setEnCours] = useState(null);
  useEffect(() => {
    let annule = false;
    if (!cle) { setReleves([]); return undefined; }
    chargeur(items)
      .then(r => { if (!annule) setReleves(r); })
      .catch(() => { if (!annule) setReleves([]); }); // jamais bloquant
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, chargeur]);
  if (!releves || releves.length === 0) return null;
  const propositions = trouverAlternatives(items, releves, { refus });
  if (propositions.length === 0) return null;

  const refuser = (p) => setRefus(new Set(ajouterRefus(`${p.actuel.variante_produit_id}>${p.alternative.variante_produit_id}`)));
  const prendre = async (p) => {
    if (!onRemplacer || enCours) return;
    setEnCours(p.item.id);
    try {
      const alt = p.alternative;
      const format = formatFormatStructure(alt) || '';
      await onRemplacer({
        ...p.item, variante_produit_id: alt.variante_produit_id, variante: null, format: '',
        formatDisplay: alt.est_mdd ? format : [alt.nom_marque, format].filter(Boolean).join(' · '),
      });
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div role="group" aria-label="Même prix, meilleure note" style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, padding: '14px 14px 10px', marginBottom: 16 }}>
      <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte }}>🥗 Même prix, meilleure note</div>
      <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, marginTop: 2, marginBottom: 6 }}>
        Dans le même rayon, pas plus cher au kilo, et mieux noté.
      </div>
      {propositions.map((p, i) => {
        const famille = p.actuel.famille;
        const age = ageReleve(Math.min(p.actuel.date, p.alternative.date));
        return (
          <div key={p.item.id} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${T.trait}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Lettre lettre={p.actuel.lettre} />
              <span aria-hidden="true" style={{ color: T.texteLeger, fontWeight: 900 }}>→</span>
              <Lettre lettre={p.alternative.lettre} />
              <span style={{ flex: 1, minWidth: 0, fontFamily: T.police, fontWeight: 900, fontSize: 14.5, color: T.texte, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 4 }}>{p.item.product}</span>
            </div>
            <div style={{ fontFamily: T.police, fontSize: 13, color: T.texte, marginTop: 6 }}>
              <b>{etiquetteAlternative(p.alternative)}</b> au lieu de {p.item.formatDisplay || 'ton format'}
            </div>
            <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.vert, fontWeight: 800, marginTop: 2 }}>
              {formaterParUnite(p.alternative.parUnite, famille)} au lieu de {formaterParUnite(p.actuel.parUnite, famille)}
            </div>
            <div style={{ fontFamily: T.police, fontSize: 11.5, color: T.texteLeger, marginTop: 2 }}>
              Prix relevés{p.alternative.enseigne ? ` chez ${p.alternative.enseigne}` : ''}{age ? ` ${age}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => prendre(p)} disabled={!!enCours} style={{ flex: 1, border: 'none', background: T.vert, color: '#fff', borderRadius: 12, padding: '10px', minHeight: 42, fontFamily: T.police, fontWeight: 900, fontSize: 13.5, cursor: enCours ? 'default' : 'pointer', opacity: enCours && enCours !== p.item.id ? 0.6 : 1 }}>
                {enCours === p.item.id ? 'Je change…' : 'Prendre celui-ci'}
              </button>
              <button onClick={() => refuser(p)} style={{ border: `1.5px solid ${T.trait}`, background: '#fff', color: T.texteDoux, borderRadius: 12, padding: '10px 14px', minHeight: 42, fontFamily: T.police, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                Non merci
              </button>
            </div>
          </div>
        );
      })}
      <div style={{ fontFamily: T.police, fontSize: 11, color: T.texteLeger, marginTop: 4 }}>
        Même produit, même magasin · Nutri-Score : Open Food Facts
      </div>
    </div>
  );
}
