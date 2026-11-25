import { describe, it, expect } from 'vitest';
import { titreEcran, ecranParent, entreeActive, ecranRetour, noterOrigine, ecranCourses, ouvrirSurCourses } from './navigationCore';

describe('navigation — cohérence en-tête / barre du bas', () => {
  const ONGLETS = ['home', 'list', 'catalog', 'micro', 'courses', 'compare', 'prices', 'moi', 'archive', 'economies', 'rejets'];

  it('chaque écran (hors accueil) a un titre', () => {
    for (const t of ONGLETS.filter(o => o !== 'home')) expect(titreEcran(t)).not.toBe('PrixMalin');
    expect(titreEcran('inconnu')).toBe('PrixMalin');
  });

  it('les écrans de premier niveau n\'ont pas de flèche retour', () => {
    for (const t of ['list', 'courses', 'compare', 'moi']) expect(ecranParent(t)).toBeNull();
  });

  it('un écran secondaire revient par défaut vers un écran de la MÊME entrée de la barre du bas', () => {
    for (const t of ['catalog', 'micro', 'archive', 'economies', 'rejets']) {
      const parent = ecranParent(t);
      expect(parent).not.toBeNull();
      expect(entreeActive(parent)).toBe(entreeActive(t));
      expect(ecranParent(parent)).toBeNull(); // jamais deux niveaux de retour
    }
  });

  it('chantier 160 — barre Accueil · Courses · Scanner · Comparer · Moi', () => {
    expect(entreeActive('list')).toBe('courses');
    expect(entreeActive('courses')).toBe('courses');
    expect(entreeActive('catalog')).toBe('courses');
    expect(entreeActive('micro')).toBe('courses');
    expect(entreeActive('compare')).toBe('compare');
    expect(entreeActive('prices')).toBe('scan');
    expect(titreEcran('list')).toBe('Ma liste');
    expect(titreEcran('courses')).toBe('Mes courses');
    expect(titreEcran('micro')).toBe('Dicter mes courses');
  });

  it('onglet inconnu : l\'accueil est allumé, pas de retour', () => {
    expect(entreeActive('nimporte')).toBe('home');
    expect(ecranParent('nimporte')).toBeNull();
  });
});

describe('chantier 160 — retour vers l\'écran d\'origine', () => {
  it('le micro ouvert depuis l\'accueil revient à l\'accueil', () => {
    const o = noterOrigine({}, 'home', 'micro');
    expect(ecranRetour('micro', o)).toBe('home');
  });
  it('sans origine connue : le parent par défaut', () => {
    expect(ecranRetour('micro', {})).toBe('list');
    expect(ecranRetour('catalog')).toBe('list');
    expect(ecranRetour('archive', { archive: 'home' })).toBe('moi'); // pas un écran à origine
  });
  it('catalogue → micro → retour → catalogue → retour : on retrouve l\'accueil, pas de boucle', () => {
    let o = noterOrigine({}, 'home', 'catalog');
    o = noterOrigine(o, 'catalog', 'micro');
    expect(ecranRetour('micro', o)).toBe('catalog');
    o = noterOrigine(o, 'micro', 'catalog'); // le retour
    expect(ecranRetour('catalog', o)).toBe('home');
  });
  it('le scan du ticket ouvert depuis Mes courses y revient ; sans origine, l\'accueil', () => {
    expect(ecranRetour('prices', noterOrigine({}, 'courses', 'prices'))).toBe('courses');
    expect(ecranRetour('prices', noterOrigine({}, 'list', 'prices'))).toBe('list');
    expect(ecranRetour('prices', {})).toBe('home');
  });
  it('écran de premier niveau : jamais de flèche', () => {
    expect(ecranRetour('list', { list: 'home' })).toBeNull();
  });
  it('origine inconnue ou égale à l\'écran : parent par défaut', () => {
    expect(ecranRetour('catalog', { catalog: 'nimporte' })).toBe('list');
    expect(ecranRetour('catalog', { catalog: 'catalog' })).toBe('list');
  });
  it('l\'entrée Courses ouvre Mes courses seulement quand une liste validée est en cours', () => {
    expect(ecranCourses(true)).toBe('courses');
    expect(ecranCourses(false)).toBe('list');
  });
});

describe('Chantier 176 — ouvrirSurCourses', () => {
  const maintenant = Date.parse('2026-11-25T18:00:00Z');
  const session = (modif, statut = 'active') => ({ statut, cree_le: '2026-11-25T08:00:00Z', modifie_le: modif });
  it('rouvre sur des courses touchées il y a moins de 12 h', () => {
    expect(ouvrirSurCourses(session('2026-11-25T17:40:00Z'), maintenant)).toBe(true);
    expect(ouvrirSurCourses(session('2026-11-25T06:00:00Z'), maintenant)).toBe(true);
  });
  it('pas au-delà de 12 h, ni sans courses actives', () => {
    expect(ouvrirSurCourses(session('2026-11-25T05:59:00Z'), maintenant)).toBe(false);
    expect(ouvrirSurCourses(session('2026-11-25T17:40:00Z', 'terminee'), maintenant)).toBe(false);
    expect(ouvrirSurCourses(null, maintenant)).toBe(false);
    expect(ouvrirSurCourses({ statut: 'active' }, maintenant)).toBe(false);
  });
  it('repli sur la date de création si modifie_le manque', () => {
    expect(ouvrirSurCourses({ statut: 'active', cree_le: '2026-11-25T17:00:00Z' }, maintenant)).toBe(true);
  });
});

import { lireEtatHistorique, etatHistorique, ecranApresRechargement, reculerDansHistorique, ecranValide } from './navigationCore';

describe('chantier 185 — historique de navigation', () => {
  it('relit un écran rangé dans l\'historique', () => {
    expect(lireEtatHistorique(etatHistorique('list', 3))).toEqual({ ecran: 'list', n: 3 });
  });
  it('ignore une page qui ne vient pas de PrixMalin', () => {
    expect(lireEtatHistorique(null)).toBeNull();
    expect(lireEtatHistorique({ autre: 1 })).toBeNull();
    expect(lireEtatHistorique({ prixmalin: 'inconnu', n: 1 })).toBeNull();
  });
  it('un numéro de page abîmé vaut 0', () => {
    expect(lireEtatHistorique({ prixmalin: 'moi', n: -2 })).toEqual({ ecran: 'moi', n: 0 });
  });
  it('après un rechargement, ni le scan ni le micro ne se rouvrent', () => {
    expect(ecranApresRechargement('prices')).toBe('home');
    expect(ecranApresRechargement('micro')).toBe('list');
    expect(ecranApresRechargement('archive')).toBe('archive');
    expect(ecranApresRechargement('nimporte')).toBeNull();
  });
  it('la flèche retour recule dans l\'historique seulement si la page d\'avant est la bonne', () => {
    const pile = ['home', 'list', 'catalog'];
    expect(reculerDansHistorique(pile, 2, 'list')).toBe(true);
    expect(reculerDansHistorique(pile, 2, 'home')).toBe(false);
    expect(reculerDansHistorique(pile, 0, 'home')).toBe(false);
  });
  it('tous les écrans de la barre sont connus', () => {
    ['home', 'list', 'courses', 'compare', 'moi', 'prices'].forEach(e => expect(ecranValide(e)).toBe(true));
  });
});
