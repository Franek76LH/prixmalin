import { describe, it, expect } from 'vitest';
import { titreEcran, ecranParent, entreeActive } from './navigationCore';

describe('navigation — cohérence en-tête / barre du bas', () => {
  const ONGLETS = ['home', 'list', 'catalog', 'micro', 'courses', 'compare', 'prices', 'moi', 'archive', 'economies', 'rejets'];

  it('chaque écran (hors accueil) a un titre', () => {
    for (const t of ONGLETS.filter(o => o !== 'home')) expect(titreEcran(t)).not.toBe('PrixMalin');
    expect(titreEcran('inconnu')).toBe('PrixMalin');
  });

  it('les écrans de premier niveau n\'ont pas de flèche retour', () => {
    for (const t of ['list', 'moi']) expect(ecranParent(t)).toBeNull();
  });

  it('un écran secondaire revient vers un écran de la MÊME entrée de la barre du bas', () => {
    for (const t of ['catalog', 'micro', 'courses', 'compare', 'archive', 'economies', 'rejets']) {
      const parent = ecranParent(t);
      expect(parent).not.toBeNull();
      expect(entreeActive(parent)).toBe(entreeActive(t));
      expect(ecranParent(parent)).toBeNull(); // jamais deux niveaux de retour
    }
  });

  it('chantier 158 — la comparaison est la suite de Ma liste', () => {
    expect(entreeActive('compare')).toBe('list');
    expect(ecranParent('compare')).toBe('list');
  });

  it('onglet inconnu : l\'accueil est allumé, pas de retour', () => {
    expect(entreeActive('nimporte')).toBe('home');
    expect(ecranParent('nimporte')).toBeNull();
  });
});
