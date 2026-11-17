import { describe, it, expect } from 'vitest';
import { titreEcran, ecranParent, entreeActive } from './navigationCore';

describe('navigation — cohérence en-tête / barre du bas', () => {
  const ONGLETS = ['home', 'list', 'catalog', 'micro', 'courses', 'compare', 'prices', 'moi', 'archive', 'economies', 'rejets'];

  it('chaque écran (hors accueil) a un titre', () => {
    for (const t of ONGLETS.filter(o => o !== 'home')) expect(titreEcran(t)).not.toBe('PrixMalin');
    expect(titreEcran('inconnu')).toBe('PrixMalin');
  });

  it('les écrans de premier niveau n\'ont pas de flèche retour', () => {
    for (const t of ['list', 'compare', 'moi']) expect(ecranParent(t)).toBeNull();
  });

  it('un écran secondaire revient vers un écran de la MÊME entrée de la barre du bas', () => {
    for (const t of ['catalog', 'micro', 'courses', 'archive', 'economies', 'rejets']) {
      const parent = ecranParent(t);
      expect(parent).not.toBeNull();
      expect(entreeActive(parent)).toBe(entreeActive(t));
      expect(ecranParent(parent)).toBeNull(); // jamais deux niveaux de retour
    }
  });

  it('onglet inconnu : l\'accueil est allumé, pas de retour', () => {
    expect(entreeActive('nimporte')).toBe('home');
    expect(ecranParent('nimporte')).toBeNull();
  });
});
