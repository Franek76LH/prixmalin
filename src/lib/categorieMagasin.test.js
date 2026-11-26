import { describe, it, expect } from 'vitest';
import { devinerCategorieMagasin as d } from './categorieMagasin';

describe('devinerCategorieMagasin (chantier 223)', () => {
  it('hypermarchés → grande surface', () => {
    expect(d('AUCHAN HYPERMARCHE AIX')).toBe('grande_surface');
    expect(d('Auchan St-Loup')).toBe('grande_surface');
    expect(d('E.LECLERC SORMIOU')).toBe('grande_surface');
    expect(d('Leclerc')).toBe('grande_surface');
    expect(d('CARREFOUR BONNEVEINE')).toBe('grande_surface');
    expect(d('Carrefour', 'Carrefour')).toBe('grande_surface');
    expect(d('GEANT CASINO')).toBe('grande_surface');
    expect(d('Intermarché HYPER Marseille')).toBe('grande_surface');
    expect(d('HYPER U')).toBe('grande_surface');
  });
  it('supermarchés et supérettes → petite et moyenne surface', () => {
    for (const nom of ['CARREFOUR CITY', 'Carrefour Express Montredon', 'CARREFOUR MARKET PRADO', 'Carrefour Contact',
      'Auchan Supermarché', 'MY AUCHAN', 'Intermarché Super Tassigny', 'Intermarché Express Mazargues', 'Intermarché',
      'LIDL', 'Aldi', 'Netto', 'MONOPRIX', 'Franprix', 'Vival', 'UTILE', 'Spar', 'U Express', 'Super U', 'Leclerc Express']) {
      expect(d(nom), nom).toBe('proximite');
    }
  });
  it('nom vide ou inconnu → petite et moyenne (cas le plus fréquent)', () => {
    expect(d('')).toBe('proximite');
    expect(d(null)).toBe('proximite');
    expect(d('Épicerie du coin')).toBe('proximite');
  });
  it('les 23 magasins de la base au 26/11 (vérifiés sur le web)', () => {
    expect(d('Carrefour', null)).toBe('grande_surface'); // Hambourg = hyper ; les 3 autres « Carrefour » de la base sont City/Express : leur nom de ticket le dira
    expect(d('Auchan Hypermarché Aix-en-Provence')).toBe('grande_surface');
    expect(d('Intermarché Super Tassigny')).toBe('proximite');
    expect(d('Lidl')).toBe('proximite');
  });
});
