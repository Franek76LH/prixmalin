import { describe, it, expect } from 'vitest';
import { compterAchats, nbAchats } from './habitudesAchat';

describe('habitudes d\'achat', () => {
  it('compte les lignes par fiche, ignore les lignes sans fiche', () => {
    expect(compterAchats([{ produit_id: 'a' }, { produit_id: 'a' }, { produit_id: null }, {}, null, { produit_id: 'b' }])).toEqual({ a: 2, b: 1 });
  });
  it('entrée illisible : aucune habitude', () => {
    expect(compterAchats(null)).toEqual({});
    expect(compterAchats('x')).toEqual({});
  });
  it('nbAchats ne plante jamais', () => {
    expect(nbAchats({ a: 2 }, 'a')).toBe(2);
    expect(nbAchats({ a: 2 }, 'z')).toBe(0);
    expect(nbAchats(null, 'a')).toBe(0);
    expect(nbAchats({ a: 'x' }, 'a')).toBe(0);
  });
});
