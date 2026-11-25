import { describe, it, expect, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }));
import { calculerNutriPanier, quantiteBase } from './nutriPanierCore';

const art = (id, cat, quantite = 1, extra = {}) => ({ cle: id, type: 'caddie', variante_produit_id: id, quantite, rayon: { categorie_nom: cat }, ...extra });

describe('Nutri-Score du caddie (chantier 180)', () => {
  it('convertit les formats en kg ou litres', () => {
    expect(quantiteBase({ quantite_nette: 500, unite_quantite: 'g' })).toBe(0.5);
    expect(quantiteBase({ quantite_nette: 33, unite_quantite: 'cl', nombre_unites: 6 })).toBeCloseTo(1.98);
    expect(quantiteBase({ quantite_nette: 1, unite_quantite: 'pièce' })).toBeNull();
  });

  it('répartition pondérée par les quantités, pas une moyenne de lettres', () => {
    const infos = new Map([
      ['p', { lettre: 'A', base: 1 }],     // 2 kg de pâtes
      ['b', { lettre: 'E', base: 0.2 }],   // 200 g de bonbons
      ['y', { lettre: 'C', base: 0.5 }],   // 500 g de yaourts
    ]);
    const r = calculerNutriPanier([art('p', 'Épicerie salée', 2), art('b', 'Épicerie sucrée & petit déjeuner'), art('y', 'Produits laitiers & œufs')], infos);
    expect(r).toMatchObject({ etat: 'ok', pondere: true, nbNotes: 3 });
    expect(r.parts).toEqual({ ab: 74, c: 19, de: 7 });
  });

  it('article par article si un poids manque', () => {
    const infos = new Map([['a', { lettre: 'A', base: 1 }], ['b', { lettre: 'D', base: null }], ['c', { lettre: 'D', base: 1 }]]);
    const r = calculerNutriPanier([art('a', 'X'), art('b', 'X'), art('c', 'X')], infos);
    expect(r.pondere).toBe(false);
    expect(r.parts).toEqual({ ab: 33, c: 0, de: 67 });
  });

  it('écarte le non-alimentaire et l\'alcool, compte le frais à part', () => {
    const infos = new Map([['a', { lettre: 'A', base: 1 }], ['b', { lettre: 'B', base: 1 }], ['c', { lettre: 'C', base: 1 }]]);
    const r = calculerNutriPanier([
      art('a', 'X'), art('b', 'X'), art('c', 'X'),
      art('lessive', 'Entretien & nettoyage'), art('vin', 'Boissons alcoolisées'),
      art('pomme', 'Fruits & légumes'), { cle: 'n', type: 'note', quantite: 1 },
    ], infos);
    expect(r).toMatchObject({ etat: 'ok', nbNotes: 3, nbAlimentaires: 3, nbFrais: 1 });
  });

  it('rien sous la moitié de produits notés, ni sous 3', () => {
    const infos = new Map([['a', { lettre: 'A', base: 1 }], ['b', { lettre: 'B', base: 1 }], ['c', { lettre: 'C', base: 1 }]]);
    expect(calculerNutriPanier([art('a', 'X'), art('b', 'X'), art('c', 'X'), art('x', 'X'), art('y', 'X'), art('z', 'X'), art('w', 'X')], infos).etat).toBe('insuffisant');
    expect(calculerNutriPanier([art('a', 'X'), art('b', 'X')], infos).etat).toBe('insuffisant');
    expect(calculerNutriPanier([art('lessive', 'Entretien & nettoyage')], infos).etat).toBe('vide');
  });
});
