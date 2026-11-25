import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ouvrirFeuille, fermerFeuille, gererRetourFeuille, nbFeuillesOuvertes, _reinitialiserFeuilles } from './retourFeuilles';

function fauxHistorique() {
  const pages = [{ prixmalin: 'home', n: 0 }];
  let i = 0;
  const h = {
    get state() { return pages[i]; },
    pushState(s) { pages.splice(i + 1); pages.push(s); i++; },
    back: vi.fn(() => { i = Math.max(0, i - 1); }),
  };
  return h;
}

describe('chantier 190 — le retour ferme d\'abord la feuille du dessus', () => {
  beforeEach(() => { _reinitialiserFeuilles(); globalThis.window = { history: fauxHistorique() }; vi.useFakeTimers(); });

  it('le retour du téléphone ferme la feuille du dessus, sans changer d\'écran', () => {
    const fermer = vi.fn();
    ouvrirFeuille({ current: fermer });
    expect(window.history.state.feuille).toBe(1);
    window.history.back();
    expect(gererRetourFeuille(window.history.state)).toBe(true);
    expect(fermer).toHaveBeenCalledTimes(1);
    expect(nbFeuillesOuvertes()).toBe(0);
  });

  it('deux feuilles empilées : le retour ferme celle du dessus seulement', () => {
    const a = vi.fn(); const b = vi.fn();
    ouvrirFeuille({ current: a }); ouvrirFeuille({ current: b });
    window.history.back();
    expect(gererRetourFeuille(window.history.state)).toBe(true);
    expect(b).toHaveBeenCalled(); expect(a).not.toHaveBeenCalled();
    expect(nbFeuillesOuvertes()).toBe(1);
  });

  it('une feuille fermée par son ✕ retire sa page, et ce recul ne ferme rien d\'autre', () => {
    const id = ouvrirFeuille({ current: vi.fn() });
    fermerFeuille(id); vi.runAllTimers();
    expect(window.history.back).toHaveBeenCalledTimes(1);
    expect(gererRetourFeuille(window.history.state)).toBe(true);   // recul de notre fait, ignoré
    expect(gererRetourFeuille({ prixmalin: 'home', n: 0 })).toBe(false); // le suivant est un vrai retour d'écran
  });

  it('si un écran a été ouvert par-dessus entre-temps, on ne recule pas', () => {
    const id = ouvrirFeuille({ current: vi.fn() });
    window.history.pushState({ prixmalin: 'list', n: 1 });
    fermerFeuille(id); vi.runAllTimers();
    expect(window.history.back).not.toHaveBeenCalled();
  });

  it('sans feuille ouverte, le retour est un changement d\'écran normal', () => {
    expect(gererRetourFeuille({ prixmalin: 'home', n: 0 })).toBe(false);
  });
});
