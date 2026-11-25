import { describe, it, expect } from 'vitest';
import { classerMagasinsComparables, produitsCommuns, ETAT_GAGNANT, ETAT_INSUFFISANT, ETAT_SANS_COMPARAISON } from './classementHonnete';

// Fabrique ranked + analysis à partir d'un tableau { produit: { magasin: prix } }.
function donnees(prixParProduit, qtes = {}) {
  const analysis = Object.entries(prixParProduit).map(([nom, byMag]) => ({
    item: { id: nom, qty: qtes[nom] ?? 1 },
    byStore: Object.fromEntries(Object.entries(byMag).map(([m, p]) => [m, { price: p }])),
  }));
  const ids = [...new Set(analysis.flatMap(a => Object.keys(a.byStore)))];
  const ranked = ids.map(id => {
    const lignes = analysis.filter(a => a.byStore[id]);
    return { id, name: id, found: lignes.length, total: lignes.reduce((s, a) => s + a.byStore[id].price * a.item.qty, 0) };
  }).sort((a, b) => (b.found !== a.found ? b.found - a.found : a.total - b.total));
  return { ranked, analysis, nbArticles: analysis.length };
}

describe('classement honnête (chantier 177)', () => {
  it('le plus complet n\'est pas annoncé moins cher s\'il est plus cher sur les produits communs', () => {
    // Leclerc a tout (4/4) mais est plus cher sur les 3 produits que Lidl a aussi.
    const d = donnees({
      chips: { leclerc: 1.5, lidl: 1.2 },
      lait: { leclerc: 1.1, lidl: 0.9 },
      pates: { leclerc: 1.0, lidl: 0.8 },
      cafe: { leclerc: 3.0 },
    });
    const r = classerMagasinsComparables(d);
    expect(r.etat).toBe(ETAT_GAGNANT);
    expect(r.moinsCherId).toBe('lidl');
    expect(r.plusCompletId).toBe('leclerc');
    expect(r.nbCommuns).toBe(3);
    expect(r.magasins[0]).toMatchObject({ id: 'lidl', totalCommuns: 2.9, etiquettes: ['moins_cher'] });
    expect(r.magasins[1]).toMatchObject({ id: 'leclerc', totalCommuns: 3.6, ecartCommuns: 0.7, etiquettes: ['plus_complet'] });
    expect(r.idParDefaut).toBe('lidl');
  });

  it('tient compte des quantités', () => {
    const d = donnees({ a: { x: 1, y: 1.5 }, b: { x: 3, y: 1 } }, { b: 3 });
    expect(classerMagasinsComparables(d).moinsCherId).toBe('y'); // x = 10, y = 4,5
  });

  it('un magasin trop peu renseigné n\'est pas comparé mais reste affiché', () => {
    const d = donnees({ a: { x: 1, y: 0.5, z: 0.1 }, b: { x: 1, y: 0.5 }, c: { x: 1 }, e: { x: 1 } });
    const r = classerMagasinsComparables(d);
    expect(r.moinsCherId).toBe('y');
    const z = r.magasins.find(m => m.id === 'z');
    expect(z).toMatchObject({ assezRenseigne: false, totalCommuns: null, etiquettes: [] });
  });

  it('moins de la moitié de la liste partout : personne n\'est désigné, tout reste choisissable', () => {
    const d = donnees({ a: { x: 1 }, b: { y: 1 }, c: {}, e: {} });
    d.nbArticles = 4;
    const r = classerMagasinsComparables(d);
    expect(r.etat).toBe(ETAT_INSUFFISANT);
    expect(r.moinsCherId).toBeNull();
    expect(r.magasins.map(m => m.id).sort()).toEqual(['x', 'y']);
    expect(r.idParDefaut).toBe(r.magasins[0].id);
    expect(r.plusCompletId).toBeNull(); // 1 prix chacun : personne n'est « le plus complet »
  });

  it('pas assez de produits en commun : pas de « moins cher »', () => {
    const d = donnees({ a: { x: 1 }, b: { x: 1 }, c: { y: 1 }, e: { y: 1 }, f: { x: 1, y: 2 } });
    const r = classerMagasinsComparables(d);
    expect(r.etat).toBe(ETAT_SANS_COMPARAISON);
    expect(r.moinsCherId).toBeNull();
  });

  it('à trois, si le panier commun est trop petit, on compare les deux mieux renseignés', () => {
    const d = donnees({
      a: { x: 1, y: 2, z: 1 }, b: { x: 1, y: 2 }, c: { x: 1, y: 2 }, e: { x: 1, y: 2 }, f: { z: 1 }, g: { z: 1 },
    });
    const r = classerMagasinsComparables(d);
    expect(r.nbCommuns).toBe(4);
    expect(r.moinsCherId).toBe('x');
  });

  it('un seul magasin : rien à comparer', () => {
    const d = donnees({ a: { x: 1 }, b: { x: 2 } });
    const r = classerMagasinsComparables(d);
    expect(r.etat).toBe(ETAT_SANS_COMPARAISON);
    expect(r.magasins).toHaveLength(1);
    expect(r.magasins[0].etiquettes).toEqual([]);
  });

  it('produitsCommuns et liste vide', () => {
    expect(produitsCommuns([], ['x'])).toEqual([]);
    expect(classerMagasinsComparables({ ranked: [], analysis: [], nbArticles: 0 }).etat).toBe(ETAT_INSUFFISANT);
  });
});
