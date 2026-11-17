import { describe, it, expect } from 'vitest';
import {
  produitsSuivis, produitsEnBaisse, libelleProduit, phraseBaisse, titreAlerteBaisse, resumeCourbe, traceCourbe,
  magasinsDuProduit, pointsDuMagasin, magasinParDefaut, moinsCherAujourdhui, alertesBaisse,
  exempleDemande, avecExemple, EXEMPLE_BAISSE,
} from './evolutionPrixCore';

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

describe('une courbe par magasin (chantier 146)', () => {
  const points = [pt('2026-06-10', 1.89, 'Netto'), pt('2026-08-05', 2.05, 'Carrefour'), pt('2026-10-11', 1.95, 'Netto'), pt('2026-11-09', 1.64, 'Netto')];
  it('liste les magasins, le plus relevé d’abord, avec son dernier prix', () => {
    expect(magasinsDuProduit(points)).toMatchObject([{ nom: 'Netto', nb: 3, dernier: 1.64 }, { nom: 'Carrefour', nb: 1, dernier: 2.05 }]);
  });
  it('ne garde que les relevés du magasin demandé', () => {
    expect(pointsDuMagasin(points, 'Netto').map(p => p.p)).toEqual([1.89, 1.95, 1.64]);
    expect(pointsDuMagasin(points, 'Lidl')).toEqual([]);
  });
  it('magasin montré d’abord : celui de la baisse, sinon le plus relevé', () => {
    expect(magasinParDefaut({ points })).toBe('Netto');
    expect(magasinParDefaut({ points, baisse: { magasin: 'Carrefour' } })).toBe('Carrefour');
    expect(magasinParDefaut({ points, baisse: { magasin: 'Inconnu au bataillon' } })).toBe('Netto');
    expect(magasinParDefaut({ points: [] })).toBeNull();
  });
  it('dit où c’est le moins cher d’après le dernier relevé de chaque magasin', () => {
    expect(moinsCherAujourdhui(points)).toEqual({ magasin: 'Netto', prix: 1.64 });
  });
  it('un seul magasin : rien à comparer', () => {
    expect(moinsCherAujourdhui([pt('2026-06-10', 1.89, 'Netto'), pt('2026-07-10', 1.95, 'Netto')])).toBeNull();
  });
});

describe('alerte de l’accueil : seulement les habitudes', () => {
  const baisse = { avant: 2, apres: 1.6, pct: 20, magasin: 'Netto' };
  it('un produit acheté une seule fois n’alerte pas', () => {
    const liste = [produit({ variante_id: 'a', nb_achats: 1, baisse }), produit({ variante_id: 'b', produit: 'Café', nb_achats: 2, baisse })];
    expect(alertesBaisse(liste).map(p => p.produit)).toEqual(['Café']);
  });
  it('nombre d’achats inconnu : pas d’alerte', () => {
    expect(alertesBaisse([produit({ baisse })])).toEqual([]);
  });
});

describe('exemple de démonstration', () => {
  it('seulement sur un serveur de test, et seulement si l’adresse le demande', () => {
    expect(exempleDemande('prixmalin-git-test-refonte-v2-x.vercel.app', '?demo=baisse')).toBe(true);
    expect(exempleDemande('localhost', '?demo=baisse')).toBe(true);
    expect(exempleDemande('prixmalin-git-test-refonte-v2-x.vercel.app', '')).toBe(false);
  });
  it('jamais sur la prod, même si l’adresse le demande', () => {
    expect(exempleDemande('prixmalin-three.vercel.app', '?demo=baisse')).toBe(false);
  });
  it('s’ajoute en tête sans toucher aux vraies données', () => {
    const vraies = [produit()];
    expect(avecExemple(vraies, false)).toBe(vraies);
    expect(avecExemple(vraies, true)).toEqual([EXEMPLE_BAISSE, vraies[0]]);
    expect(avecExemple(null, true)).toEqual([EXEMPLE_BAISSE]);
    expect(alertesBaisse(avecExemple(null, true))).toHaveLength(1);
  });
});
