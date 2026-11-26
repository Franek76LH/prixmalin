import { describe, it, expect } from 'vitest';
import { moisSiPrixAncien, mentionPrixAncien, phrasePrixAnciens, compterPrixAnciensParMagasin, mentionPrixAnciensMagasin } from './anciennetePrix';

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

describe('prix anciens par magasin (chantier 207)', () => {
  const maintenant = new Date('2026-11-26T12:00:00Z').getTime();
  it('compte les prix de plus de 6 mois, magasin par magasin', () => {
    const analysis = [
      { byStore: { a: { date: '2026-03-01' }, b: { date: '2026-11-01' } } },
      { byStore: { a: { date: '2026-02-01' }, b: { date: '2026-01-15' } } },
      { byStore: { a: { date: null } } },
    ];
    const c = compterPrixAnciensParMagasin(analysis, maintenant);
    expect(c.get('a')).toBe(2);
    expect(c.get('b')).toBe(1);
  });
  it('rien quand tout est récent ou vide', () => {
    expect(compterPrixAnciensParMagasin([{ byStore: { a: { date: '2026-11-20' } } }], maintenant).size).toBe(0);
    expect(compterPrixAnciensParMagasin(null, maintenant).size).toBe(0);
  });
  it('mention', () => {
    expect(mentionPrixAnciensMagasin(0)).toBeNull();
    expect(mentionPrixAnciensMagasin(1)).toBe('1 prix de plus de 6 mois');
    expect(mentionPrixAnciensMagasin(3)).toBe('3 prix de plus de 6 mois');
  });
});
