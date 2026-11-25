// Chantier 180 — carte « Nutri-Score de ton caddie » : une répartition
// A-B / C / D-E (jamais une lettre moyenne), le nombre de produits sur lequel
// elle repose, et rien du tout tant que moins de la moitié des produits
// alimentaires sont notés (sauf `discretSiInsuffisant` : une ligne qui
// l'explique). Le calcul vient de lib/nutriPanierCore.js.
import { useEffect, useMemo, useState } from 'react';
import { T } from './theme';
import { calculerNutriPanier, chargerInfosNutri } from '../../lib/nutriPanierCore';

const SEGMENTS = [
  { cle: 'ab', libelle: 'A-B', couleur: '#038141' },
  { cle: 'c', libelle: 'C', couleur: '#FECB02' },
  { cle: 'de', libelle: 'D-E', couleur: '#E63E11' },
];

export default function CarteNutriCaddie({ articles = [], titre = 'Nutri-Score de ton caddie', discretSiInsuffisant = false }) {
  const ids = useMemo(() => [...new Set((articles || []).map(a => a?.variante_produit_id).filter(Boolean))].sort(), [articles]);
  const cleIds = ids.join(',');
  const [infos, setInfos] = useState(null);
  useEffect(() => {
    let annule = false;
    chargerInfosNutri(cleIds ? cleIds.split(',') : [])
      .then(m => { if (!annule) setInfos(m); })
      .catch(() => { if (!annule) setInfos(new Map()); }); // jamais bloquant
    return () => { annule = true; };
  }, [cleIds]);
  if (!infos) return null;
  const r = calculerNutriPanier(articles, infos);
  if (r.etat === 'vide') return null;
  if (r.etat === 'insuffisant') {
    if (!discretSiInsuffisant || r.nbNotes === 0) return null;
    return (
      <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, background: T.carte, borderRadius: 14, padding: '10px 14px', marginBottom: 12, boxShadow: T.ombre }}>
        🥗 Nutri-Score de ton caddie : {r.nbNotes * 2 >= r.nbAlimentaires
          ? `seulement ${r.nbNotes} produit${r.nbNotes > 1 ? 's' : ''} noté${r.nbNotes > 1 ? 's' : ''}, trop peu pour en dire quelque chose.`
          : `${r.nbNotes} produit${r.nbNotes > 1 ? 's' : ''} noté${r.nbNotes > 1 ? 's' : ''} sur ${r.nbAlimentaires}, pas assez pour en dire quelque chose.`} Scanner les codes-barres de tes produits l'améliore.
      </div>
    );
  }
  return (
    <div role="group" aria-label={titre} style={{ background: T.carte, borderRadius: 16, padding: 14, marginBottom: 12, boxShadow: T.ombre }}>
      <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte, marginBottom: 10 }}>🥗 {titre}</div>
      <div style={{ display: 'flex', height: 14, borderRadius: 99, overflow: 'hidden', background: '#F0F0F0' }}>
        {SEGMENTS.map(s => r.parts[s.cle] > 0 && (
          <div key={s.cle} style={{ width: `${r.parts[s.cle]}%`, background: s.couleur }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        {SEGMENTS.map(s => (
          <span key={s.cle} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: T.police, fontWeight: 800, fontSize: 13, color: T.texte }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: s.couleur }} />
            {s.libelle} {r.parts[s.cle]} %
          </span>
        ))}
      </div>
      {r.nbFrais > 0 && (
        <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.vert, fontWeight: 800, marginTop: 6 }}>
          + {r.nbFrais} produit{r.nbFrais > 1 ? 's' : ''} frais (fruits, légumes)
        </div>
      )}
      <div style={{ fontFamily: T.police, fontSize: 11.5, color: T.texteLeger, marginTop: 6 }}>
        Sur {r.nbNotes} produit{r.nbNotes > 1 ? 's' : ''} noté{r.nbNotes > 1 ? 's' : ''} sur {r.nbAlimentaires} · {r.pondere ? 'selon les quantités' : 'article par article'} · Open Food Facts
      </div>
    </div>
  );
}
