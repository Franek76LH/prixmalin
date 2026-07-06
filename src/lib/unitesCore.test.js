import { describe, it, expect } from 'vitest';
import { resoudreFamilleEtCoefficient, familleDepuisTypeUnite, calculerPrixReference, classerParPrixUnitaire } from './unitesCore';

describe('resoudreFamilleEtCoefficient', () => {
  it('résout les unités de poids vers kg', () => {
    expect(resoudreFamilleEtCoefficient('mg')).toEqual({ famille: 'poids', coefficient: 0.000001 });
    expect(resoudreFamilleEtCoefficient('g')).toEqual({ famille: 'poids', coefficient: 0.001 });
    expect(resoudreFamilleEtCoefficient('kg')).toEqual({ famille: 'poids', coefficient: 1 });
  });

  it('résout les unités de volume vers L', () => {
    expect(resoudreFamilleEtCoefficient('ml')).toEqual({ famille: 'volume', coefficient: 0.001 });
    expect(resoudreFamilleEtCoefficient('cl')).toEqual({ famille: 'volume', coefficient: 0.01 });
    expect(resoudreFamilleEtCoefficient('dl')).toEqual({ famille: 'volume', coefficient: 0.1 });
    expect(resoudreFamilleEtCoefficient('l')).toEqual({ famille: 'volume', coefficient: 1 });
  });

  it('normalise la casse et les espaces (L = l)', () => {
    expect(resoudreFamilleEtCoefficient('L')).toEqual(resoudreFamilleEtCoefficient('l'));
    expect(resoudreFamilleEtCoefficient('  Kg  ')).toEqual(resoudreFamilleEtCoefficient('kg'));
    expect(resoudreFamilleEtCoefficient('ML')).toEqual(resoudreFamilleEtCoefficient('ml'));
  });

  it('résout la famille pièce/comptage avec un coefficient de 1', () => {
    expect(resoudreFamilleEtCoefficient('piece')).toEqual({ famille: 'piece', coefficient: 1 });
    expect(resoudreFamilleEtCoefficient('pièce')).toEqual({ famille: 'piece', coefficient: 1 });
    expect(resoudreFamilleEtCoefficient('unité')).toEqual({ famille: 'piece', coefficient: 1 });
  });

  it('exclut explicitement une unité inconnue, jamais un coefficient par défaut', () => {
    expect(resoudreFamilleEtCoefficient('xyz')).toEqual({ exclusion: 'unite_inconnue' });
    expect(resoudreFamilleEtCoefficient('')).toEqual({ exclusion: 'unite_inconnue' });
    expect(resoudreFamilleEtCoefficient(null)).toEqual({ exclusion: 'unite_inconnue' });
    expect(resoudreFamilleEtCoefficient(undefined)).toEqual({ exclusion: 'unite_inconnue' });
  });
});

describe('familleDepuisTypeUnite', () => {
  it('résout poids/volume/piece', () => {
    expect(familleDepuisTypeUnite('poids')).toBe('poids');
    expect(familleDepuisTypeUnite('volume')).toBe('volume');
    expect(familleDepuisTypeUnite('piece')).toBe('piece');
  });

  it('normalise la casse', () => {
    expect(familleDepuisTypeUnite('POIDS')).toBe('poids');
  });

  it("retourne null pour 'lot' (contenu hétérogène, jamais une seule famille)", () => {
    expect(familleDepuisTypeUnite('lot')).toBeNull();
  });

  it('retourne null pour une valeur inconnue ou absente', () => {
    expect(familleDepuisTypeUnite('autre')).toBeNull();
    expect(familleDepuisTypeUnite(null)).toBeNull();
    expect(familleDepuisTypeUnite(undefined)).toBeNull();
  });
});

describe('calculerPrixReference', () => {
  it('convertit g vers kg exactement (500 g à 2 € => 4 €/kg)', () => {
    const r = calculerPrixReference({ prix_total: 2, quantite_nette: 500, unite_quantite: 'g', nombre_unites: 1, type_unite: 'poids' });
    expect(r).toEqual({ prix_reference: 4, famille: 'poids', unite: 'kg' });
  });

  it('convertit mg vers kg exactement', () => {
    const r = calculerPrixReference({ prix_total: 1, quantite_nette: 1000000, unite_quantite: 'mg', nombre_unites: 1, type_unite: 'poids' });
    expect(r).toEqual({ prix_reference: 1, famille: 'poids', unite: 'kg' });
  });

  it('kg vers kg (coefficient 1)', () => {
    const r = calculerPrixReference({ prix_total: 3, quantite_nette: 1, unite_quantite: 'kg', nombre_unites: 1, type_unite: 'poids' });
    expect(r).toEqual({ prix_reference: 3, famille: 'poids', unite: 'kg' });
  });

  it('convertit ml/cl/l vers L exactement', () => {
    expect(calculerPrixReference({ prix_total: 1, quantite_nette: 1000, unite_quantite: 'ml', nombre_unites: 1, type_unite: 'volume' }))
      .toEqual({ prix_reference: 1, famille: 'volume', unite: 'L' });
    expect(calculerPrixReference({ prix_total: 1, quantite_nette: 100, unite_quantite: 'cl', nombre_unites: 1, type_unite: 'volume' }))
      .toEqual({ prix_reference: 1, famille: 'volume', unite: 'L' });
    expect(calculerPrixReference({ prix_total: 2, quantite_nette: 1, unite_quantite: 'l', nombre_unites: 1, type_unite: 'volume' }))
      .toEqual({ prix_reference: 2, famille: 'volume', unite: 'L' });
  });

  it('un lot de 4 × 125 g vaut 500 g au total (prix_reference calculé sur le total)', () => {
    const r = calculerPrixReference({ prix_total: 5, quantite_nette: 125, unite_quantite: 'g', nombre_unites: 4, type_unite: 'poids' });
    expect(r).toEqual({ prix_reference: 10, famille: 'poids', unite: 'kg' }); // 5 € / 0.5 kg
  });

  it('calcule le prix à la pièce sans passer par quantite_nette', () => {
    const r = calculerPrixReference({ prix_total: 6, quantite_nette: 1, unite_quantite: 'piece', nombre_unites: 6, type_unite: 'piece' });
    expect(r).toEqual({ prix_reference: 1, famille: 'piece', unite: 'piece' });
  });

  it('exclut une unité inconnue, jamais un coefficient par défaut', () => {
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: 500, unite_quantite: 'xyz', nombre_unites: 1, type_unite: 'poids' }))
      .toEqual({ exclusion: 'unite_inconnue' });
  });

  it('ne convertit jamais poids <-> volume (type_unite volume mais unité en g)', () => {
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: 500, unite_quantite: 'g', nombre_unites: 1, type_unite: 'volume' }))
      .toEqual({ exclusion: 'type_unite_incoherent' });
  });

  it('ne compare jamais la famille pièce à poids ou volume', () => {
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: 500, unite_quantite: 'g', nombre_unites: 1, type_unite: 'piece' }))
      .toEqual({ exclusion: 'type_unite_incoherent' });
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: 1, unite_quantite: 'piece', nombre_unites: 6, type_unite: 'poids' }))
      .toEqual({ exclusion: 'type_unite_incoherent' });
  });

  it("exclut type_unite='lot' (jamais une famille unique)", () => {
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: 500, unite_quantite: 'g', nombre_unites: 1, type_unite: 'lot' }))
      .toEqual({ exclusion: 'type_unite_non_supporte' });
  });

  it('exclut une quantite_nette nulle, négative ou non numérique', () => {
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: null, unite_quantite: 'g', nombre_unites: 1, type_unite: 'poids' })).toEqual({ exclusion: 'quantite_nette_invalide' });
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: -500, unite_quantite: 'g', nombre_unites: 1, type_unite: 'poids' })).toEqual({ exclusion: 'quantite_nette_invalide' });
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: 'abc', unite_quantite: 'g', nombre_unites: 1, type_unite: 'poids' })).toEqual({ exclusion: 'quantite_nette_invalide' });
  });

  it('exclut un nombre_unites nul, négatif ou non numérique', () => {
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: 500, unite_quantite: 'g', nombre_unites: 0, type_unite: 'poids' })).toEqual({ exclusion: 'nombre_unites_invalide' });
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: 500, unite_quantite: 'g', nombre_unites: -1, type_unite: 'poids' })).toEqual({ exclusion: 'nombre_unites_invalide' });
    expect(calculerPrixReference({ prix_total: 5, quantite_nette: 500, unite_quantite: 'g', nombre_unites: 'abc', type_unite: 'poids' })).toEqual({ exclusion: 'nombre_unites_invalide' });
  });

  it('exclut un prix_total nul, négatif ou non numérique', () => {
    expect(calculerPrixReference({ prix_total: 0, quantite_nette: 500, unite_quantite: 'g', nombre_unites: 1, type_unite: 'poids' })).toEqual({ exclusion: 'prix_total_invalide' });
    expect(calculerPrixReference({ prix_total: -1, quantite_nette: 500, unite_quantite: 'g', nombre_unites: 1, type_unite: 'poids' })).toEqual({ exclusion: 'prix_total_invalide' });
  });
});

describe('classerParPrixUnitaire', () => {
  it('cas nominal : classe 3 magasins par prixUnitaire croissant, avec rang et badge sur le rang 1', () => {
    const entrees = [
      { magasinId: 'carrefour', magasinNom: 'Carrefour', prixBrut: 3, prixUnitaire: 2, unite: '€/kg' },
      { magasinId: 'leclerc', magasinNom: 'Leclerc', prixBrut: 2.5, prixUnitaire: 1.5, unite: '€/kg' },
      { magasinId: 'auchan', magasinNom: 'Auchan', prixBrut: 4, prixUnitaire: 3, unite: '€/kg' },
    ];

    const { classes, nonComparables } = classerParPrixUnitaire(entrees);

    expect(nonComparables).toEqual([]);
    expect(classes.map((e) => e.magasinId)).toEqual(['leclerc', 'carrefour', 'auchan']);
    expect(classes.map((e) => e.rang)).toEqual([1, 2, 3]);
    expect(classes.map((e) => e.estMoinsCher)).toEqual([true, false, false]);
  });

  it('place les entrées sans prixUnitaire dans nonComparables, jamais dans classes', () => {
    const entrees = [
      { magasinId: 'carrefour', magasinNom: 'Carrefour', prixBrut: 3, prixUnitaire: 2, unite: '€/kg' },
      { magasinId: 'leclerc', magasinNom: 'Leclerc', prixBrut: 2.5, prixUnitaire: null, unite: null },
      { magasinId: 'auchan', magasinNom: 'Auchan', prixBrut: 1, prixUnitaire: null, unite: null },
    ];

    const { classes, nonComparables } = classerParPrixUnitaire(entrees);

    expect(classes.map((e) => e.magasinId)).toEqual(['carrefour']);
    expect(classes[0].rang).toBe(1);
    expect(classes[0].estMoinsCher).toBe(true);
    // triées par prixBrut croissant, sans rang ni badge
    expect(nonComparables.map((e) => e.magasinId)).toEqual(['auchan', 'leclerc']);
    nonComparables.forEach((e) => {
      expect(e).not.toHaveProperty('rang');
      expect(e).not.toHaveProperty('estMoinsCher');
    });
  });

  it('égalité de prixUnitaire : même rang pour les ex æquo, badge sur tous, saut de rang ensuite', () => {
    const entrees = [
      { magasinId: 'a', magasinNom: 'A', prixBrut: 2, prixUnitaire: 2, unite: '€/kg' },
      { magasinId: 'b', magasinNom: 'B', prixBrut: 2, prixUnitaire: 2, unite: '€/kg' },
      { magasinId: 'c', magasinNom: 'C', prixBrut: 3, prixUnitaire: 3, unite: '€/kg' },
    ];

    const { classes } = classerParPrixUnitaire(entrees);

    expect(classes.map((e) => e.magasinId)).toEqual(['a', 'b', 'c']); // ordre d'entrée conservé entre ex æquo
    expect(classes.map((e) => e.rang)).toEqual([1, 1, 3]);
    expect(classes.map((e) => e.estMoinsCher)).toEqual([true, true, false]);
  });

  it('toutes les entrées non comparables : classes vide, nonComparables rempli', () => {
    const entrees = [
      { magasinId: 'a', magasinNom: 'A', prixBrut: 5, prixUnitaire: null, unite: null },
      { magasinId: 'b', magasinNom: 'B', prixBrut: 1, prixUnitaire: null, unite: null },
    ];

    const { classes, nonComparables } = classerParPrixUnitaire(entrees);

    expect(classes).toEqual([]);
    expect(nonComparables.map((e) => e.magasinId)).toEqual(['b', 'a']);
  });

  it('tableau vide en entrée', () => {
    expect(classerParPrixUnitaire([])).toEqual({ classes: [], nonComparables: [] });
  });

  it('ne mute jamais le tableau ni les objets d’entrée', () => {
    const entree = { magasinId: 'a', magasinNom: 'A', prixBrut: 3, prixUnitaire: 2, unite: '€/kg' };
    const entrees = [entree];
    const copieAvant = { ...entree };

    classerParPrixUnitaire(entrees);

    expect(entree).toEqual(copieAvant);
    expect(entree).not.toHaveProperty('rang');
    expect(entree).not.toHaveProperty('estMoinsCher');
    expect(entrees).toHaveLength(1);
  });
});
