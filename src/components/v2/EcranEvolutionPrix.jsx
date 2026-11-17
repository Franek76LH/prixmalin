// Chantier 145 — « Évolution de mes prix » : la courbe de chaque produit que
// j'ai déjà acheté, et en tête ceux qui viennent de baisser.
// Demande de François (17/11) : revoir la courbe des prix, et être prévenu
// quand un produit habituel est relevé en baisse.
import { useState } from 'react';
import { T } from './theme';
import { IconeChevron } from './Icones';
import { produitsSuivis, produitsEnBaisse, phraseBaisse, resumeCourbe, traceCourbe, prixFr } from '../../lib/evolutionPrixCore';

const jour = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

function Courbe({ points, largeur = 280, hauteur = 70, couleur = T.rouge, detail = false }) {
  const trace = traceCourbe(points, largeur, hauteur, 8);
  if (trace.length === 0) return null;
  return (
    <svg viewBox={`0 0 ${largeur} ${hauteur}`} width="100%" role="img" aria-label={`Courbe de ${trace.length} prix relevés`} style={{ display: 'block' }}>
      <polyline points={trace.map(c => `${c.x},${c.y}`).join(' ')} fill="none" stroke={couleur} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {(detail ? trace : [trace[trace.length - 1]]).map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={detail ? 3 : 3.5} fill={couleur} />)}
    </svg>
  );
}

function LigneProduit({ p, ouvert, onBasculer, dernier }) {
  const resume = resumeCourbe(p.points);
  const enBaisse = !!p.baisse;
  const couleur = enBaisse ? T.vert : T.rouge;
  return (
    <div style={{ borderBottom: dernier ? 'none' : `1px solid ${T.trait}` }}>
      <button onClick={onBasculer} aria-expanded={ouvert} style={{ width: '100%', border: 'none', background: ouvert ? '#FAFAF8' : 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: T.police, fontWeight: 800, fontSize: 14.5, color: T.texte }}>{p.produit}</span>
          <span style={{ display: 'block', fontFamily: T.police, fontSize: 12.5, color: T.texteLeger, marginTop: 1 }}>
            {[p.marque, p.format, `${p.points.length} relevés`].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span style={{ width: 74, flexShrink: 0 }}><Courbe points={p.points} largeur={74} hauteur={32} couleur={couleur} /></span>
        <span style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte, flexShrink: 0, minWidth: 54, textAlign: 'right' }}>{prixFr(resume.dernier)}</span>
        <IconeChevron width={18} height={18} style={{ color: T.texteLeger, flexShrink: 0, transform: ouvert ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }} />
        {/* La baisse sur sa propre ligne, pleine largeur : lisible d'un coup d'œil. */}
        {enBaisse && (
          <span style={{ flexBasis: '100%', marginTop: 2 }}>
            <span style={{ display: 'inline-block', background: T.vertPale, color: T.vert, borderRadius: 99, padding: '3px 10px', fontFamily: T.police, fontWeight: 900, fontSize: 12 }}>
              En baisse · {phraseBaisse(p)}
            </span>
          </span>
        )}
      </button>
      {ouvert && (
        <div style={{ padding: '4px 14px 14px', background: '#FAFAF8' }}>
          <Courbe points={p.points} couleur={couleur} detail />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: T.police, fontSize: 12, color: T.texteLeger, margin: '2px 2px 10px' }}>
            <span>{jour(p.points[0].d)}</span>
            <span>Le plus bas : <strong style={{ color: T.texte }}>{prixFr(resume.mini)}</strong> · le plus haut : <strong style={{ color: T.texte }}>{prixFr(resume.maxi)}</strong></span>
            <span>{jour(p.points[p.points.length - 1].d)}</span>
          </div>
          {[...p.points].reverse().map((pt, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.trait}` }}>
              <span style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, width: 96, flexShrink: 0 }}>{jour(pt.d)}</span>
              <span style={{ flex: 1, minWidth: 0, fontFamily: T.police, fontWeight: 700, fontSize: 13, color: T.texte, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pt.m || 'Magasin'}</span>
              <span style={{ fontFamily: T.police, fontWeight: 800, fontSize: 13.5, color: T.texte, flexShrink: 0 }}>{prixFr(pt.p)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EcranEvolutionPrix({ evolution = null, onScanner }) {
  const [ouvert, setOuvert] = useState(null);
  const suivis = produitsSuivis(evolution);
  const enBaisse = produitsEnBaisse(evolution);
  const autres = suivis.filter(p => !p.baisse);

  if (suivis.length === 0) {
    return (
      <div style={{ padding: '24px 16px 110px' }}>
        <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, padding: '32px 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>📈</div>
          <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 19, color: T.texte, marginBottom: 6 }}>Pas encore de courbe</div>
          <div style={{ fontFamily: T.police, fontSize: 14, color: T.texteDoux, marginBottom: onScanner ? 20 : 0 }}>
            Dès qu'un produit que tu as acheté a deux prix relevés, sa courbe apparaît ici.
          </div>
          {onScanner && (
            <button onClick={onScanner} style={{ width: '100%', border: 'none', background: T.rouge, color: '#fff', borderRadius: 14, padding: 14, fontFamily: T.police, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}>
              Scanner un ticket
            </button>
          )}
        </div>
      </div>
    );
  }

  const bloc = (titre, liste) => liste.length > 0 && (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 16, color: T.texte, margin: '0 4px 8px' }}>{titre}</div>
      <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>
        {liste.map((p, i) => (
          <LigneProduit key={p.variante_id} p={p} ouvert={ouvert === p.variante_id} dernier={i === liste.length - 1}
            onBasculer={() => setOuvert(ouvert === p.variante_id ? null : p.variante_id)} />
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '16px 16px 110px' }}>
      <div style={{ fontFamily: T.police, fontSize: 13, color: T.texteDoux, margin: '0 4px 14px', lineHeight: 1.45 }}>
        Les prix relevés par toute la communauté sur les produits que tu as déjà achetés. Une baisse est signalée quand un magasin affiche au moins 8 % de moins que la fois d'avant.
      </div>
      {bloc(enBaisse.length > 1 ? `En baisse (${enBaisse.length})` : 'En baisse', enBaisse)}
      {bloc(enBaisse.length > 0 ? 'Mes autres produits' : `Mes produits suivis (${autres.length})`, autres)}
    </div>
  );
}
