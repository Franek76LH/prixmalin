import { describe, it, expect } from 'vitest';
import { moisSiPrixAncien, mentionPrixAncien, phrasePrixAnciens } from './anciennetePrix';

const now = new Date('2026-11-26T12:00:00Z').getTime();
describe('âge des prix (chantier 198)', () => {
  it('rien jusqu’à 6 mois, le nombre de mois au-delà', () => {
    expect(moisSiPrixAncien('2026-11-20T10:00:00Z', now)).toBeNull();
    expect(moisSiPrixAncien('2026-06-01T10:00:00Z', now)).toBeNull(); // 178 jours
    expect(moisSiPrixAncien('2026-05-20T10:00:00Z', now)).toBe(6);
    expect(moisSiPrixAncien('2026-01-20T10:00:00Z', now)).toBe(10);
    expect(moisSiPrixAncien(null, now)).toBeNull();
    expect(moisSiPrixAncien('pas une date', now)).toBeNull();
  });
  it('les phrases', () => {
    expect(mentionPrixAncien(8)).toBe('relevé il y a 8 mois');
    expect(mentionPrixAncien(null)).toBeNull();
    expect(phrasePrixAnciens(0)).toBeNull();
    expect(phrasePrixAnciens(1)).toBe('1 prix a plus de 6 mois : il a pu changer depuis.');
    expect(phrasePrixAnciens(3)).toBe('3 prix ont plus de 6 mois : ils ont pu changer depuis.');
  });
});
