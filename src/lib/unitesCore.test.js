import { describe, it, expect } from 'vitest';
import { resoudreFamilleEtCoefficient, familleDepuisTypeUnite, calculerPrixReference } from './unitesCore';

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
