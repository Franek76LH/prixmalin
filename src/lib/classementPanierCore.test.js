import { describe, it, expect } from 'vitest';
import { classerMagasinsPourPanier } from './classementPanierCore';

const panierBase = [
  { articleId: 'p1', libelle: 'Lait' },
  { articleId: 'p2', libelle: 'Pain' },
  { articleId: 'p3', libelle: 'Beurre' },
];

describe('classerMagasinsPourPanier', () => {
  it('principal couvre tout le panier : appoint null, nonTrouves vide', () => {
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 1 }, { articleId: 'p2', prix: 2 }, { articleId: 'p3', prix: 3 }] },
      { magasinId: 'b', magasinNom: 'B', prix: [{ articleId: 'p1', prix: 5 }] },
    ];

    const resultat = classerMagasinsPourPanier(panierBase, magasins);

    expect(resultat.principal).toEqual({
      magasinId: 'a', magasinNom: 'A', nbTrouves: 3, nbManquants: 0, total: 6, articlesTrouves: ['p1', 'p2', 'p3'],
    });
    expect(resultat.appoint).toBeNull();
    expect(resultat.nonTrouves).toEqual([]);
  });

  it('principal partiel + appoint complète le reste : nonTrouves vide', () => {
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 1 }, { articleId: 'p2', prix: 2 }] },
      { magasinId: 'b', magasinNom: 'B', prix: [{ articleId: 'p3', prix: 3 }] },
    ];

    const resultat = classerMagasinsPourPanier(panierBase, magasins);

    expect(resultat.principal).toEqual({
      magasinId: 'a', magasinNom: 'A', nbTrouves: 2, nbManquants: 1, total: 3, articlesTrouves: ['p1', 'p2'],
    });
    expect(resultat.appoint).toEqual({
      magasinId: 'b', magasinNom: 'B', nbTrouves: 1, total: 3, articlesTrouves: ['p3'],
    });
    expect(resultat.nonTrouves).toEqual([]);
  });

  it('principal partiel + appoint partiel : les articles restants vont dans nonTrouves', () => {
    const panier = [
      { articleId: 'p1', libelle: 'Lait' },
      { articleId: 'p2', libelle: 'Pain' },
      { articleId: 'p3', libelle: 'Beurre' },
      { articleId: 'p4', libelle: 'Œufs' },
    ];
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 1 }, { articleId: 'p2', prix: 2 }] },
      { magasinId: 'b', magasinNom: 'B', prix: [{ articleId: 'p3', prix: 3 }] },
    ];

    const resultat = classerMagasinsPourPanier(panier, magasins);

    expect(resultat.principal.magasinId).toBe('a');
    expect(resultat.principal.nbManquants).toBe(2);
    expect(resultat.appoint).toEqual({
      magasinId: 'b', magasinNom: 'B', nbTrouves: 1, total: 3, articlesTrouves: ['p3'],
    });
    expect(resultat.nonTrouves).toEqual([{ articleId: 'p4', libelle: 'Œufs' }]);
  });

  it('égalité de couverture entre deux magasins : le moins cher devient principal', () => {
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 5 }, { articleId: 'p2', prix: 5 }] },
      { magasinId: 'b', magasinNom: 'B', prix: [{ articleId: 'p1', prix: 4 }, { articleId: 'p2', prix: 4 }] },
    ];

    const resultat = classerMagasinsPourPanier(panierBase, magasins);

    expect(resultat.principal.magasinId).toBe('b');
    expect(resultat.principal.total).toBe(8);
  });

  it('panier vide', () => {
    const magasins = [{ magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 1 }] }];
    expect(classerMagasinsPourPanier([], magasins)).toEqual({ principal: null, appoint: null, nonTrouves: [] });
  });

  it('aucun prix nulle part : tout dans nonTrouves', () => {
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [] },
      { magasinId: 'b', magasinNom: 'B', prix: [{ articleId: 'autre', prix: 1 }] },
    ];

    const resultat = classerMagasinsPourPanier(panierBase, magasins);

    expect(resultat.principal).toBeNull();
    expect(resultat.appoint).toBeNull();
    expect(resultat.nonTrouves).toEqual([
      { articleId: 'p1', libelle: 'Lait' },
      { articleId: 'p2', libelle: 'Pain' },
      { articleId: 'p3', libelle: 'Beurre' },
    ]);
  });

  it('ne mute jamais le panier ni les magasins d’origine', () => {
    const panier = [
      { articleId: 'p1', libelle: 'Lait' },
      { articleId: 'p2', libelle: 'Pain' },
    ];
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 1 }] },
      { magasinId: 'b', magasinNom: 'B', prix: [{ articleId: 'p2', prix: 2 }] },
    ];
    const panierAvant = JSON.parse(JSON.stringify(panier));
    const magasinsAvant = JSON.parse(JSON.stringify(magasins));

    classerMagasinsPourPanier(panier, magasins);

    expect(panier).toEqual(panierAvant);
    expect(magasins).toEqual(magasinsAvant);
  });
});
