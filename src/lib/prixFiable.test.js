import { describe, it, expect } from 'vitest';
import { prixEstFiable, offresPrioritaires, MENTION_PRIX_A_VERIFIER, calculerPrixUnitaire } from './catalogueCore.js';

// Chantier 104 — le prédicat est LE point unique de décision côté front, et son
// repli permissif est la garantie qu'aucun écran ne se vide à cause de la
// nouvelle colonne. Ces tests figent exactement ce contrat.
describe('prixEstFiable', () => {
  it('false explicite -> non fiable', () => {
    expect(prixEstFiable({ quantite_fiable: false })).toBe(false);
  });

  it('true explicite -> fiable', () => {
    expect(prixEstFiable({ quantite_fiable: true })).toBe(true);
  });

  // Repli obligatoire : cache navigateur, réponse d'une version antérieure à la
  // colonne, ligne du moteur legacy price_db. Tous ces cas gardent le
  // comportement d'avant le chantier.
  it('colonne absente -> fiable (comportement actuel préservé)', () => {
    expect(prixEstFiable({ prix_total: 3.2 })).toBe(true);
    expect(prixEstFiable({ quantite_fiable: undefined })).toBe(true);
  });

  it('null -> fiable (jamais de trou à l\'écran)', () => {
    expect(prixEstFiable({ quantite_fiable: null })).toBe(true);
  });

  it('objet absent -> fiable, et ne plante pas', () => {
    expect(prixEstFiable(null)).toBe(true);
    expect(prixEstFiable(undefined)).toBe(true);
  });

  // Réversibilité : repasser la fiche à true en base suffit, sans toucher au code.
  it('la bascule true/false est le seul levier', () => {
    const fiche = { quantite_fiable: false };
    expect(prixEstFiable(fiche)).toBe(false);
    expect(prixEstFiable({ ...fiche, quantite_fiable: true })).toBe(true);
  });
});

// C'est la règle qui protège le classement des enseignes : une offre douteuse ne
// doit jamais gagner le duel du « moins cher au kilo » face à une offre sûre.
describe('offresPrioritaires', () => {
  const sure = (id, prix) => ({ id, prix_total: prix, quantite_fiable: true });
  const douteuse = (id, prix) => ({ id, prix_total: prix, quantite_fiable: false });

  it('écarte les offres douteuses dès qu\'il existe une offre sûre', () => {
    const retenues = offresPrioritaires([douteuse('a', 0.5), sure('b', 3.2), douteuse('c', 0.9)]);
    expect(retenues.map(o => o.id)).toEqual(['b']);
  });

  it('même une offre douteuse très basse ne passe pas devant une offre sûre', () => {
    // Le cœur du défaut : « 1 kg » factice à 0,10 € aurait gagné le duel du €/kg
    // et serait devenu le prix retenu du magasin.
    const retenues = offresPrioritaires([douteuse('piege', 0.1), sure('vraie', 4)]);
    expect(retenues).toHaveLength(1);
    expect(retenues[0].id).toBe('vraie');
  });

  it('garde TOUT si aucune offre n\'est sûre — l\'article ne disparaît jamais', () => {
    const toutes = [douteuse('a', 12), douteuse('b', 30)];
    expect(offresPrioritaires(toutes)).toHaveLength(2);
  });

  it('sans la colonne, rien ne change (toutes considérées sûres)', () => {
    const legacy = [{ id: 'x', prix_total: 2 }, { id: 'y', prix_total: 3 }];
    expect(offresPrioritaires(legacy)).toHaveLength(2);
  });

  it('supporte une entrée vide ou absente sans planter', () => {
    expect(offresPrioritaires([])).toEqual([]);
    expect(offresPrioritaires(null)).toEqual([]);
    expect(offresPrioritaires(undefined)).toEqual([]);
  });
});

describe('MENTION_PRIX_A_VERIFIER', () => {
  // La mention porte sur le PRIX, pas sur la quantité : sur ces fiches le prix
  // du paquet lui-même est parfois un €/kg mal rangé (Morilles à 430 €).
  it('parle du prix, jamais d\'erreur ni de donnée manquante', () => {
    expect(MENTION_PRIX_A_VERIFIER).toBe('Prix à vérifier');
    expect(MENTION_PRIX_A_VERIFIER.toLowerCase()).not.toContain('quantité');
    expect(MENTION_PRIX_A_VERIFIER.toLowerCase()).not.toContain('erreur');
  });
});

// Démonstration du défaut d'origine : sur une variante « 1 kg » factice, le
// €/kg calculé vaut mécaniquement le prix stocké. Le calcul n'est pas en cause
// — c'est la quantité qui est inventée — donc on ne le corrige pas, on cesse de
// l'afficher.
describe('pourquoi le €/kg est faux sur ces fiches', () => {
  it('quantite_nette=1 kg -> le €/kg est exactement le prix du paquet', () => {
    const generique = { quantite_nette: 1, unite_quantite: 'kg', nombre_unites: 1, quantite_fiable: false };
    const calcul = calculerPrixUnitaire({ prix: 93 }, generique);
    expect(calcul.valeur).toBe(93);          // « Chips nature » à 93 €/kg
    expect(prixEstFiable(generique)).toBe(false);
  });

  it('une vraie fiche de 1 kg avec marque reste fiable et son €/kg est juste', () => {
    const vraie = { quantite_nette: 1, unite_quantite: 'kg', nombre_unites: 1, quantite_fiable: true };
    expect(calculerPrixUnitaire({ prix: 2.5 }, vraie).valeur).toBe(2.5);
    expect(prixEstFiable(vraie)).toBe(true);
  });
});
