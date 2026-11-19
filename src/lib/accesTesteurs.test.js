import { describe, it, expect } from 'vitest';
import { listeDeComptes, estTesteurDeConfiance } from './accesTesteurs';

describe('comptes de confiance', () => {
  it('découpe la liste, espaces et vides ignorés', () => {
    expect(listeDeComptes(' a , b,, ')).toEqual(['a', 'b']);
    expect(listeDeComptes(null)).toEqual([]);
  });
  it('reconnaît un compte présent dans la liste du scan après ticket', () => {
    expect(estTesteurDeConfiance({ scan_apres_ticket_testeurs: 'nico,bouchman' }, 'nico')).toBe(true);
  });
  it('reconnaît un compte présent dans la liste dédiée', () => {
    expect(estTesteurDeConfiance({ testeurs_confiance: 'lea', scan_apres_ticket_testeurs: 'nico' }, 'lea')).toBe(true);
  });
  it('refuse un inconnu, un identifiant partiel, une liste absente', () => {
    expect(estTesteurDeConfiance({ scan_apres_ticket_testeurs: 'nico,bouchman' }, 'paul')).toBe(false);
    expect(estTesteurDeConfiance({ scan_apres_ticket_testeurs: 'nicolas' }, 'nico')).toBe(false);
    expect(estTesteurDeConfiance({}, 'nico')).toBe(false);
    expect(estTesteurDeConfiance(null, 'nico')).toBe(false);
    expect(estTesteurDeConfiance({ scan_apres_ticket_testeurs: 'nico' }, null)).toBe(false);
  });
});
