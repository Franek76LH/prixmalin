// Chantier 96 — garde-fou « scan sans produit exploitable ».
import { describe, it, expect } from 'vitest';
import { filtrerProduitsExploitables } from './scanTicket';

describe('filtrerProduitsExploitables', () => {
  it('garde uniquement les produits avec nom et prix > 0', () => {
    const produits = [
      { name: 'Eau 1L', price: 1.5 },
      { name: 'Pain', price: '2.10' },      // prix en chaîne numérique : exploitable
      { name: 'Sans prix', price: 0 },
      { name: 'Prix nul', price: null },
      { name: '', price: 3 },
      { price: 2 },
      null,
      { name: 'Négatif', price: -1 },
      { name: 'NaN', price: 'abc' },
    ];
    expect(filtrerProduitsExploitables(produits).map(p => p.name)).toEqual(['Eau 1L', 'Pain']);
  });

  it('entrées vides ou nulles : liste vide, jamais de plantage', () => {
    expect(filtrerProduitsExploitables([])).toEqual([]);
    expect(filtrerProduitsExploitables(null)).toEqual([]);
    expect(filtrerProduitsExploitables(undefined)).toEqual([]);
  });
});
