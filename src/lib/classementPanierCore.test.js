import { describe, it, expect } from 'vitest';
import { classerMagasinsPourPanier, calculerEconomiePotentielle } from './classementPanierCore';

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

describe('calculerEconomiePotentielle', () => {
  it('cas nominal : moyenne sur 3 magasins pour un article', () => {
    const panier = [{ articleId: 'p1', libelle: 'Lait' }];
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 3 }] },
      { magasinId: 'b', magasinNom: 'B', prix: [{ articleId: 'p1', prix: 5 }] },
      { magasinId: 'c', magasinNom: 'C', prix: [{ articleId: 'p1', prix: 4 }] },
    ];
    const classement = { principal: { total: 3 }, appoint: null };

    const resultat = calculerEconomiePotentielle(panier, magasins, classement);

    expect(resultat).toEqual({ economie: 1, coutMoyenPanier: 4, coutReel: 3, nbArticlesChiffres: 1 });
  });

  it('article présent dans un seul magasin : la moyenne vaut ce prix', () => {
    const panier = [{ articleId: 'p1', libelle: 'Lait' }, { articleId: 'p2', libelle: 'Pain' }];
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 10 }, { articleId: 'p2', prix: 2 }] },
    ];
    const classement = { principal: { total: 12 }, appoint: null };

    const resultat = calculerEconomiePotentielle(panier, magasins, classement);

    expect(resultat.coutMoyenPanier).toBe(12); // 10 (moyenne à 1 magasin) + 2
    expect(resultat.nbArticlesChiffres).toBe(2);
  });

  it('panier avec appoint : coutReel = total(principal) + total(appoint)', () => {
    const panier = [{ articleId: 'p1', libelle: 'Lait' }, { articleId: 'p2', libelle: 'Pain' }];
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 6 }, { articleId: 'p2', prix: 6 }] },
      { magasinId: 'b', magasinNom: 'B', prix: [{ articleId: 'p1', prix: 4 }] },
    ];
    const classement = { principal: { total: 5 }, appoint: { total: 2 } };

    const resultat = calculerEconomiePotentielle(panier, magasins, classement);

    // moyenne p1 = (6+4)/2 = 5, moyenne p2 = 6 (un seul magasin) => coutMoyenPanier = 11
    expect(resultat.coutMoyenPanier).toBe(11);
    expect(resultat.coutReel).toBe(7);
    expect(resultat.economie).toBe(4);
    expect(resultat.nbArticlesChiffres).toBe(2);
  });

  it('aucun article chiffrable : économie nulle', () => {
    const panier = [{ articleId: 'p1', libelle: 'Lait' }];
    const magasins = [{ magasinId: 'a', magasinNom: 'A', prix: [] }];
    const classement = { principal: null, appoint: null };

    const resultat = calculerEconomiePotentielle(panier, magasins, classement);

    expect(resultat).toEqual({ economie: 0, coutMoyenPanier: 0, coutReel: 0, nbArticlesChiffres: 0 });
  });

  it('ne mute jamais panier, magasins ni classement', () => {
    const panier = [{ articleId: 'p1', libelle: 'Lait' }];
    const magasins = [
      { magasinId: 'a', magasinNom: 'A', prix: [{ articleId: 'p1', prix: 3 }] },
      { magasinId: 'b', magasinNom: 'B', prix: [{ articleId: 'p1', prix: 5 }] },
    ];
    const classement = { principal: { total: 3 }, appoint: null };

    const panierAvant = JSON.parse(JSON.stringify(panier));
    const magasinsAvant = JSON.parse(JSON.stringify(magasins));
    const classementAvant = JSON.parse(JSON.stringify(classement));

    calculerEconomiePotentielle(panier, magasins, classement);

    expect(panier).toEqual(panierAvant);
    expect(magasins).toEqual(magasinsAvant);
    expect(classement).toEqual(classementAvant);
  });
});
