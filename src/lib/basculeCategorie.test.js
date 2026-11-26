import { describe, it, expect } from 'vitest';
import { autreCategorie, doitBasculer, phraseBascule } from './basculeCategorie';

describe('bascule de catégorie (chantier 215)', () => {
  it('cas du pain de mie : proximité vide, grandes surfaces avec un prix → bascule', () => {
    expect(doitBasculer({ categorieAuto: true, nbMagasinsCategorie: 0, nbMagasinsAutre: 1 })).toBe(true);
  });
  it('jamais quand l\'utilisateur a choisi lui-même', () => {
    expect(doitBasculer({ categorieAuto: false, nbMagasinsCategorie: 0, nbMagasinsAutre: 3 })).toBe(false);
  });
  it('pas de bascule si la catégorie choisie a des prix', () => {
    expect(doitBasculer({ categorieAuto: true, nbMagasinsCategorie: 2, nbMagasinsAutre: 5 })).toBe(false);
  });
  it('pas de bascule si l\'autre est vide aussi', () => {
    expect(doitBasculer({ categorieAuto: true, nbMagasinsCategorie: 0, nbMagasinsAutre: 0 })).toBe(false);
  });
  it('autre catégorie', () => {
    expect(autreCategorie('proximite')).toBe('grande_surface');
    expect(autreCategorie('grande_surface')).toBe('proximite');
  });
  it('phrase', () => {
    expect(phraseBascule({ de: 'proximite', vers: 'grande_surface' })).toBe('Pas de prix en proximité pour ta liste : voici les grandes surfaces.');
    expect(phraseBascule({ de: 'grande_surface', vers: 'proximite' })).toBe('Pas de prix en grandes surfaces pour ta liste : voici les magasins de proximité.');
    expect(phraseBascule(null)).toBeNull();
  });
});
