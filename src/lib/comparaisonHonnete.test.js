import { describe, it, expect } from 'vitest';
import {
  evaluerComparaison, comparerSurProduitsCommuns,
  ETAT_AUCUN_PRIX, ETAT_INSUFFISANT, ETAT_GAGNANT,
} from './comparaisonHonnete';

const ligne = (id, prixParMagasin, qty = 1) => ({
  item: { id, qty },
  byStore: Object.fromEntries(Object.entries(prixParMagasin).map(([m, price]) => [m, { price }])),
});
const mag = (id, found, total) => ({ id, name: id, found, total, missing: [] });

describe('evaluerComparaison — règle de la moitié', () => {
  it('cas réel du 09/11 : 2 prix sur 6 -> aucun gagnant désigné', () => {
    const analysis = [
      ligne('coca', { carrefour: 5.5 }), ligne('pates', { carrefour: 5.72 }),
      ligne('yaourts', {}), ligne('rape', {}), ligne('knacki', {}), ligne('beurre', {}),
    ];
    const r = evaluerComparaison({ ranked: [mag('carrefour', 2, 11.22)], analysis, nbArticles: 6 });
    expect(r.etat).toBe(ETAT_INSUFFISANT);
    expect(r.gagnant).toBeNull();
    expect(r.economie).toBe(0);
    expect(r.couvertureMax).toBe(2);
  });

  it('exactement la moitié (3 sur 6) : un gagnant, mais pas « complet »', () => {
    const analysis = [ligne('a', { n: 1 }), ligne('b', { n: 1 }), ligne('c', { n: 1 }), ligne('d', {}), ligne('e', {}), ligne('f', {})];
    const r = evaluerComparaison({ ranked: [mag('n', 3, 3)], analysis, nbArticles: 6 });
    expect(r.etat).toBe(ETAT_GAGNANT);
    expect(r.complet).toBe(false);
  });

  it('aucun magasin, ou liste vide -> aucun prix', () => {
    expect(evaluerComparaison({ ranked: [], analysis: [], nbArticles: 4 }).etat).toBe(ETAT_AUCUN_PRIX);
    expect(evaluerComparaison({ ranked: [mag('n', 1, 2)], analysis: [], nbArticles: 0 }).etat).toBe(ETAT_AUCUN_PRIX);
    expect(evaluerComparaison({}).etat).toBe(ETAT_AUCUN_PRIX);
  });
});

describe('evaluerComparaison — économie sur produits communs seulement', () => {
  it('panier complet des deux côtés : économie = écart réel', () => {
    const analysis = [ligne('a', { netto: 1, carrefour: 1.5 }), ligne('b', { netto: 2, carrefour: 2.4 }, 2)];
    const r = evaluerComparaison({ ranked: [mag('netto', 2, 5), mag('carrefour', 2, 6.3)], analysis, nbArticles: 2 });
    expect(r.etat).toBe(ETAT_GAGNANT);
    expect(r.complet).toBe(true);
    expect(r.reference.id).toBe('carrefour');
    expect(r.nbCommuns).toBe(2);
    expect(r.economie).toBe(1.3);
  });

  it('le second a moins de produits : son total plus bas ne crée PAS une fausse économie', () => {
    // Netto 4/4 à 10 € ; Carrefour 2/4 à 7 €. L'ancien calcul (7 − 10) cachait
    // l'économie ; l'inverse (second plus cher sur d'autres produits) en
    // inventait une. Ici, sur les 2 produits communs, Netto fait 4 € et
    // Carrefour 7 € : économie 3 €, annoncée sur 2 produits.
    const analysis = [
      ligne('a', { netto: 2, carrefour: 3 }), ligne('b', { netto: 2, carrefour: 4 }),
      ligne('c', { netto: 3 }), ligne('d', { netto: 3 }),
    ];
    const r = evaluerComparaison({ ranked: [mag('netto', 4, 10), mag('carrefour', 2, 7)], analysis, nbArticles: 4 });
    expect(r.economie).toBe(3);
    expect(r.nbCommuns).toBe(2);
  });

  it('trop peu de produits communs (moins de la moitié du gagnant) : aucune économie annoncée', () => {
    const analysis = [
      ligne('a', { netto: 2, lidl: 9 }), ligne('b', { netto: 2 }), ligne('c', { netto: 2 }), ligne('d', { netto: 2 }),
    ];
    const r = evaluerComparaison({ ranked: [mag('netto', 4, 8), mag('lidl', 1, 9)], analysis, nbArticles: 4 });
    expect(r.etat).toBe(ETAT_GAGNANT);
    expect(r.economie).toBe(0);
    expect(r.reference).toBeNull();
    expect(r.nbCommuns).toBe(0);
  });

  it('aucun produit commun : pas de référence, pas d\'économie', () => {
    const analysis = [ligne('a', { netto: 2 }), ligne('b', { netto: 2 }), ligne('c', { lidl: 1 })];
    const r = evaluerComparaison({ ranked: [mag('netto', 2, 4), mag('lidl', 1, 1)], analysis, nbArticles: 3 });
    expect(r.economie).toBe(0);
    expect(r.reference).toBeNull();
  });

  it('le gagnant est plus CHER sur le panier commun : économie 0, jamais négative', () => {
    const analysis = [ligne('a', { netto: 3, lidl: 2 }), ligne('b', { netto: 3, lidl: 2 }), ligne('c', { netto: 1 })];
    const r = evaluerComparaison({ ranked: [mag('netto', 3, 7), mag('lidl', 2, 4)], analysis, nbArticles: 3 });
    expect(r.economie).toBe(0);
    expect(r.reference.id).toBe('lidl');
  });

  it('référence = le magasin qui partage le PLUS de produits, pas forcément le 2e du classement', () => {
    const analysis = [
      ligne('a', { netto: 1, b: 2, c: 2 }), ligne('b', { netto: 1, c: 2 }), ligne('c', { netto: 1, c: 2 }), ligne('d', { netto: 1, b: 2 }),
    ];
    const r = evaluerComparaison({ ranked: [mag('netto', 4, 4), mag('b', 2, 4), mag('c', 3, 6)], analysis, nbArticles: 4 });
    expect(r.reference.id).toBe('c');
    expect(r.nbCommuns).toBe(3);
    expect(r.economie).toBe(3);
  });
});

describe('comparerSurProduitsCommuns', () => {
  it('tient compte des quantités et ignore les prix illisibles', () => {
    const analysis = [
      ligne('a', { x: 1.1, y: 1.3 }, 3),
      { item: { id: 'b', qty: 1 }, byStore: { x: { price: 'abc' }, y: { price: 2 } } },
      { item: { id: 'c' }, byStore: { x: { price: 2 }, y: { price: 2.5 } } },
    ];
    expect(comparerSurProduitsCommuns(analysis, 'x', 'y')).toEqual({ nbCommuns: 2, totalGagnant: 5.3, totalAutre: 6.4, ecart: 1.1 });
  });
  it('entrées vides : zéro partout, jamais d\'exception', () => {
    expect(comparerSurProduitsCommuns(null, 'x', 'y')).toEqual({ nbCommuns: 0, totalGagnant: 0, totalAutre: 0, ecart: 0 });
  });
});
