import { describe, it, expect } from 'vitest';
import { lettreNutri, resumeNutri } from './nutriScoreCore';

describe('Nutri-Score (chantier 178)', () => {
  it('lit une lettre propre', () => {
    expect(lettreNutri('c')).toBe('C');
    expect(lettreNutri(' A ')).toBe('A');
    expect(lettreNutri('F')).toBeNull();
    expect(lettreNutri(null)).toBeNull();
  });
  it('résume les variantes notées sans inventer les autres', () => {
    expect(resumeNutri([{ nutri_score: 'D' }, { nutri_score: 'B' }, { nutri_score: null }])).toEqual({ min: 'B', max: 'D', nbNotees: 2, nbTotal: 3 });
    expect(resumeNutri([{ nutri_score: 'A' }])).toEqual({ min: 'A', max: 'A', nbNotees: 1, nbTotal: 1 });
    expect(resumeNutri([{ nutri_score: null }])).toBeNull();
    expect(resumeNutri(null)).toBeNull();
  });
});
