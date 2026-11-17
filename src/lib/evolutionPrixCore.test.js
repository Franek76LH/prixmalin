import { describe, it, expect } from 'vitest';
import { produitsSuivis, produitsEnBaisse, libelleProduit, phraseBaisse, titreAlerteBaisse, resumeCourbe, traceCourbe } from './evolutionPrixCore';

const pt = (d, p, m = 'Netto') => ({ d, p, m });
const produit = (plus = {}) => ({
  variante_id: 'v1', produit: 'Emmental râpé', marque: 'Président', format: '200 g', nb: 3,
  baisse: null, points: [pt('2026-09-01', 1.95), pt('2026-10-01', 1.95), pt('2026-11-09', 1.64)], ...plus,
});

describe('produitsSuivis', () => {
  it('garde les produits qui ont au moins deux relevés lisibles', () => {
    expect(produitsSuivis([produit(), produit({ variante_id: 'v2', points: [pt('2026-11-09', 1.64)] })])).toHaveLength(1);
  });
  it('écarte les points illisibles (prix nul, date absente ou absurde)', () => {
    const r = produitsSuivis([produit({ points: [pt('2026-09-01', 1.95), pt(null, 2), pt('pas une date', 2), pt('2026-10-01', 0), pt('2026-11-09', 1.64)] })]);
    expect(r[0].points).toHaveLength(2);
  });
  it('réponse absente ou inattendue : liste vide', () => {
    expect(produitsSuivis(null)).toEqual([]);
    expect(produitsSuivis({})).toEqual([]);
  });
});

describe('produitsEnBaisse', () => {
  it('ne garde que les baisses, la plus forte d’abord', () => {
    const liste = [
      produit({ variante_id: 'a', produit: 'Café', baisse: { avant: 4, apres: 3.6, pct: 10, magasin: 'Lidl' } }),
      produit({ variante_id: 'b', produit: 'Riz' }),
      produit({ variante_id: 'c', produit: 'Beurre', baisse: { avant: 3, apres: 2.4, pct: 20, magasin: 'Netto' } }),
    ];
    expect(produitsEnBaisse(liste).map(p => p.produit)).toEqual(['Beurre', 'Café']);
  });
});

describe('textes', () => {
  it('libellé complet, sans les morceaux absents', () => {
    expect(libelleProduit(produit())).toBe('Emmental râpé · Président · 200 g');
    expect(libelleProduit(produit({ marque: null }))).toBe('Emmental râpé · 200 g');
  });
  it('phrase de la baisse : avant, après, où, combien', () => {
    expect(phraseBaisse(produit({ baisse: { avant: 1.95, apres: 1.64, pct: 16, magasin: 'Netto' } }))).toBe('1,95 € → 1,64 € chez Netto (−16 %)');
    expect(phraseBaisse(produit())).toBe('');
  });
  it('titre de l’alerte : un produit nommé, ou un compte', () => {
    expect(titreAlerteBaisse([])).toBe('');
    expect(titreAlerteBaisse([produit()])).toBe('Emmental râpé a baissé');
    expect(titreAlerteBaisse([produit(), produit()])).toBe('2 de tes produits ont baissé');
  });
});

describe('resumeCourbe', () => {
  it('premier, dernier, mini, maxi, écart', () => {
    expect(resumeCourbe(produit().points)).toEqual({ premier: 1.95, dernier: 1.64, mini: 1.64, maxi: 1.95, ecart: -0.31 });
  });
  it('rien à résumer', () => expect(resumeCourbe([])).toBeNull());
});

describe('traceCourbe', () => {
  it('le prix le plus haut est en haut, le plus bas en bas, dans le cadre', () => {
    const t = traceCourbe(produit().points, 280, 70, 8);
    expect(t[0].y).toBe(8);
    expect(t[2].y).toBe(62);
    expect(t[0].x).toBe(8);
    expect(t[2].x).toBe(272);
    expect(t.every(c => c.x >= 8 && c.x <= 272 && c.y >= 8 && c.y <= 62)).toBe(true);
  });
  it('prix tous égaux : une ligne à mi-hauteur', () => {
    const t = traceCourbe([pt('2026-09-01', 2), pt('2026-10-01', 2)], 280, 70, 8);
    expect(t.map(c => c.y)).toEqual([35, 35]);
  });
  it('relevés le même jour : étalés au lieu d’être empilés', () => {
    const t = traceCourbe([pt('2026-09-01', 2), pt('2026-09-01', 3)], 280, 70, 8);
    expect(t.map(c => c.x)).toEqual([8, 272]);
  });
});
