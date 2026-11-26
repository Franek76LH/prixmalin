import { describe, it, expect } from 'vitest';
import { autreCategorie, doitBasculer, phraseBascule, libelleBoutonAutre } from './basculeCategorie';

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
  it('bouton vers l\'autre catégorie (choix manuel)', () => {
    expect(libelleBoutonAutre('grande_surface', 1)).toBe('Voir les grandes surfaces (1 magasin a des prix)');
    expect(libelleBoutonAutre('proximite', 3)).toBe('Voir les petites et moyennes surfaces (3 magasins ont des prix)');
    expect(libelleBoutonAutre('grande_surface', 0)).toBeNull();
  });
  it('phrase', () => {
    expect(phraseBascule({ de: 'proximite', vers: 'grande_surface' })).toBe('Pas de prix en petites et moyennes surfaces pour ta liste : voici les grandes surfaces.');
    expect(phraseBascule({ de: 'grande_surface', vers: 'proximite' })).toBe('Pas de prix en grandes surfaces pour ta liste : voici les petites et moyennes surfaces.');
    expect(phraseBascule(null)).toBeNull();
  });
});
