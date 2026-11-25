import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { suivreRecherche, annulerSuiviRecherche, termeANoter, normaliserTermeRecherche, _reinitialiserSuivi } from './recherchesSansResultat';

describe('175 — recherches sans résultat', () => {
  beforeEach(() => { vi.useFakeTimers(); _reinitialiserSuivi(); });
  afterEach(() => { vi.useRealTimers(); });

  it('note un mot introuvable après 2 secondes, une seule fois', () => {
    const envoyer = vi.fn();
    suivreRecherche('  Nutella   bio ', true, { envoyer });
    vi.advanceTimersByTime(1999);
    expect(envoyer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(envoyer).toHaveBeenCalledWith('nutella bio');
    suivreRecherche('nutella bio', true, { envoyer });
    vi.advanceTimersByTime(3000);
    expect(envoyer).toHaveBeenCalledTimes(1);
  });

  it('ne note pas les mots à moitié tapés', () => {
    const envoyer = vi.fn();
    suivreRecherche('nut', true, { envoyer });
    vi.advanceTimersByTime(500);
    suivreRecherche('nute', true, { envoyer });
    vi.advanceTimersByTime(500);
    suivreRecherche('nutella', false, { envoyer }); // trouvé : rien à noter
    vi.advanceTimersByTime(5000);
    expect(envoyer).not.toHaveBeenCalled();
  });

  it('annulation, mots trop courts ou trop longs', () => {
    const envoyer = vi.fn();
    suivreRecherche('zzzz', true, { envoyer });
    annulerSuiviRecherche();
    vi.advanceTimersByTime(5000);
    expect(envoyer).not.toHaveBeenCalled();
    expect(termeANoter('ab')).toBe(false);
    expect(termeANoter('x'.repeat(61))).toBe(false);
    expect(normaliserTermeRecherche(' A  B ')).toBe('a b');
  });
});
