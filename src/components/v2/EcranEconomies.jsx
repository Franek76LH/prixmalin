// Chantier 128 — écran « Mes économies » dans la nouvelle interface.
// Mêmes chiffres qu'avant (lib/economiesCore.js) ; ce qui change, c'est qu'on
// dit en clair ce que le chiffre veut dire.
import { useState } from 'react';
import { T } from './theme';
import { IconeChevron, IconeRetour } from './Icones';
import { bilanEconomies, coursesDuMois, nomDuMois } from '../../lib/economiesCore';

const signe = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2).replace('.', ',')} €`;
const couleur = (n) => (n > 0 ? T.vert : n < 0 ? '#B45309' : T.texteLeger);

export default function EcranEconomies({ archives = [], onScanner }) {
  const bilan = bilanEconomies(archives);
  const [annee, setAnnee] = useState(() => bilan.annees[0] ?? new Date().getFullYear());
  const [moisOuvert, setMoisOuvert] = useState(null);

  if (bilan.nbCourses === 0) {
    return (
      <div style={{ padding: '24px 16px 110px' }}>
        <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, padding: '32px 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>🧾</div>
          <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 19, color: T.texte, marginBottom: 6 }}>Pas encore d'économies mesurées</div>
          <div style={{ fontFamily: T.police, fontSize: 14, color: T.texteDoux, marginBottom: 20 }}>
            Fais tes courses dans le magasin conseillé, puis scanne ton ticket : on compare ce que tu as payé au prix moyen des autres magasins.
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

  const moisAffiches = bilan.mois.filter(m => m.mois.startsWith(`${annee}-`));

  return (
    <div style={{ padding: '16px 16px 110px' }}>
      <div style={{ background: T.vertPale, borderRadius: T.rayon, padding: '18px 18px 16px', marginBottom: 16 }}>
        <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 13, color: T.vert }}>Économisé au total</div>
        <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 36, color: bilan.total >= 0 ? T.vert : '#B45309', lineHeight: 1.1, marginTop: 2 }}>{signe(bilan.total)}</div>
        <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, marginTop: 8 }}>
          Sur {bilan.nbCourses} course{bilan.nbCourses > 1 ? 's' : ''} dont tu as scanné le ticket, par rapport au prix moyen des autres magasins.
          {bilan.meilleurMois ? ` Ton meilleur mois : ${nomDuMois(bilan.meilleurMois)}.` : ''}
        </div>
      </div>

      {moisOuvert ? (
        <>
          <button onClick={() => setMoisOuvert(null)} style={{ border: 'none', background: 'none', padding: '0 0 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: T.police, fontWeight: 900, fontSize: 16, color: T.texte }}>
            <IconeRetour width={18} height={18} /> {nomDuMois(moisOuvert)}
          </button>
          <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>
            {coursesDuMois(archives, moisOuvert).map((c, i, tous) => (
              <div key={c.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: i === tous.length - 1 ? 'none' : `1px solid ${T.trait}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 14.5, color: T.texte, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.store?.name || 'Courses'}</div>
                  <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteLeger, marginTop: 1 }}>
                    {new Date(c.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </div>
                </div>
                <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: couleur(c.realized_saving || 0), flexShrink: 0 }}>{signe(c.realized_saving || 0)}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {bilan.annees.length > 1 && (
            <div style={{ display: 'inline-flex', background: T.trait, borderRadius: 11, padding: 3, marginBottom: 12 }}>
              {bilan.annees.map(a => (
                <button key={a} onClick={() => setAnnee(a)} aria-pressed={a === annee} style={{ border: 'none', cursor: 'pointer', borderRadius: 9, padding: '6px 16px', fontFamily: T.police, fontWeight: 800, fontSize: 13, background: a === annee ? '#fff' : 'transparent', color: a === annee ? T.texte : T.texteDoux, boxShadow: a === annee ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}>{a}</button>
              ))}
            </div>
          )}
          <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>
            {moisAffiches.map((m, i) => (
              <button key={m.mois} onClick={() => setMoisOuvert(m.mois)} style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: i === moisAffiches.length - 1 ? 'none' : `1px solid ${T.trait}` }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: T.police, fontWeight: 800, fontSize: 15, color: T.texte }}>{nomDuMois(m.mois)}</span>
                  <span style={{ display: 'block', fontFamily: T.police, fontSize: 12.5, color: T.texteLeger, marginTop: 1 }}>{m.nb} course{m.nb > 1 ? 's' : ''}</span>
                </span>
                <span style={{ fontFamily: T.police, fontWeight: 900, fontSize: 15, color: couleur(m.total) }}>{signe(m.total)}</span>
                <IconeChevron width={18} height={18} style={{ color: T.texteLeger, flexShrink: 0 }} />
              </button>
            ))}
          </div>
          <div style={{ fontFamily: T.police, fontSize: 12, color: T.texteLeger, margin: '10px 4px 0' }}>
            Un montant négatif veut dire que tes courses ont coûté plus cher que la moyenne ce mois-là.
          </div>
        </>
      )}
    </div>
  );
}
