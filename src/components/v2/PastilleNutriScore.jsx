// Chantier 178 — pastille Nutri-Score (A à E). Volontairement simple : une
// lettre colorée, pas une copie du logo officiel. `resume` vient de
// lib/nutriScoreCore.js (resumeNutri) ; `lettre` force une lettre unique.
import { T } from './theme';
import { COULEURS_NUTRI, lettreNutri } from '../../lib/nutriScoreCore';

function Lettre({ l }) {
  const c = COULEURS_NUTRI[l];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, background: c.fond, color: c.texte, fontFamily: T.police, fontWeight: 900, fontSize: 15 }}>{l}</span>
  );
}

export default function PastilleNutriScore({ lettre = null, resume = null, precision = null }) {
  const unique = lettreNutri(lettre) ?? (resume && resume.min === resume.max ? resume.min : null);
  if (!unique && !resume) return null;
  return (
    <div aria-label={unique ? `Nutri-Score ${unique}` : `Nutri-Score de ${resume.min} à ${resume.max} selon la marque et le format`}
      style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F7F8FA', borderRadius: 12, padding: '8px 12px', marginBottom: 14 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {unique ? <Lettre l={unique} /> : (<><Lettre l={resume.min} /><span style={{ color: T.texteLeger, fontWeight: 900 }}>→</span><Lettre l={resume.max} /></>)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: T.police, fontWeight: 900, fontSize: 13.5, color: T.texte }}>
          {unique ? `Nutri-Score ${unique}` : `Nutri-Score de ${resume.min} à ${resume.max}`}
        </span>
        <span style={{ display: 'block', fontFamily: T.police, fontSize: 11.5, color: T.texteDoux }}>
          {precision ?? (unique ? 'selon Open Food Facts' : 'selon la marque et le format · Open Food Facts')}
        </span>
      </span>
    </div>
  );
}
