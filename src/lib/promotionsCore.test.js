import { describe, it, expect } from 'vitest';
import {
  lireOffre, quantiteRequise, totalAvecOffre, prixUnitaireAvecOffre, offreConfirmeeParLeTicket, titreOffre, phraseOffre,
  OFFRE_LOT_GRATUIT, OFFRE_NIEME_REMISE, OFFRE_POURCENTAGE, OFFRE_MONTANT, OFFRE_INCONNUE,
} from './promotionsCore';

describe('lireOffre', () => {
  it('reconnaît « 2+1 » sous toutes ses formes', () => {
    for (const t of ['2+1 PRINGLES', '2 + 1 OFFERT', 'LOT 2+1 GRATUIT']) {
      expect(lireOffre(t)).toEqual({ type: OFFRE_LOT_GRATUIT, achetes: 2, offerts: 1 });
    }
  });
  it('reconnaît « 3 pour 2 » et « 3 pour le prix de 2 »', () => {
    expect(lireOffre('3 POUR 2')).toEqual({ type: OFFRE_LOT_GRATUIT, achetes: 2, offerts: 1 });
    expect(lireOffre('3 pour le prix de 2')).toEqual({ type: OFFRE_LOT_GRATUIT, achetes: 2, offerts: 1 });
  });
  it('reconnaît « le 2e à −50 % » sous toutes ses formes', () => {
    for (const t of ['LE 2EME A -50%', '2e à −50 %', '-50% SUR LE 2ÈME', '2EME A 50 %']) {
      expect(lireOffre(t.replace('−', '-'))).toEqual({ type: OFFRE_NIEME_REMISE, rang: 2, pourcentage: 50 });
    }
    expect(lireOffre('2EME A -68%')).toEqual({ type: OFFRE_NIEME_REMISE, rang: 2, pourcentage: 68 });
  });
  it('« le 2e offert » est un lot 1+1', () => {
    expect(lireOffre('LE 2EME OFFERT')).toEqual({ type: OFFRE_LOT_GRATUIT, achetes: 1, offerts: 1 });
  });
  it('un simple pourcentage', () => {
    expect(lireOffre('REMISE 30%')).toEqual({ type: OFFRE_POURCENTAGE, pourcentage: 30 });
  });
  it('un montant sans règle lisible', () => {
    expect(lireOffre('Remise immédiate', 2.15)).toEqual({ type: OFFRE_MONTANT, montant: 2.15 });
    expect(lireOffre('', 0.5)).toEqual({ type: OFFRE_MONTANT, montant: 0.5 });
    expect(lireOffre('XJ-448 CODE', 1)).toEqual({ type: OFFRE_INCONNUE, montant: 1 });
  });
  it('ni texte parlant ni remise : pas d’offre', () => {
    expect(lireOffre('EMMENTAL RAPE')).toBeNull();
    expect(lireOffre(null)).toBeNull();
  });
  it('un format de produit n’est pas une offre (« 6x1L », « 4x100g »)', () => {
    expect(lireOffre('EAU 6X1L')).toBeNull();
    expect(lireOffre('TABLETTE 4X100G')).toBeNull();
  });
});

describe('ce que ça revient à payer', () => {
  const lot = { type: OFFRE_LOT_GRATUIT, achetes: 2, offerts: 1 };
  const deuxieme = { type: OFFRE_NIEME_REMISE, rang: 2, pourcentage: 68 };

  it('jambon « 3 pour 2 » à 2,29 € : 3 pris, 2 payés', () => {
    expect(totalAvecOffre(2.29, lot, 3)).toBe(4.58);
    expect(prixUnitaireAvecOffre(2.29, lot, 3)).toBe(1.53);
  });
  it('quantité insuffisante : prix normal (le garde-fou)', () => {
    expect(totalAvecOffre(2.29, lot, 1)).toBe(2.29);
    expect(totalAvecOffre(2.29, lot, 2)).toBe(4.58);
    expect(prixUnitaireAvecOffre(5.45, { type: OFFRE_NIEME_REMISE, rang: 2, pourcentage: 60 }, 1)).toBe(5.45);
  });
  it('l’offre joue autant de fois qu’il y a de lots complets', () => {
    expect(totalAvecOffre(2, lot, 6)).toBe(8);
    expect(totalAvecOffre(2, lot, 7)).toBe(10);
  });
  it('perles Tipiak du 30/07 : 1,84 € et le 2e à −68 % → 2,43 € les deux', () => {
    expect(totalAvecOffre(1.84, deuxieme, 2)).toBe(2.43);
    expect(prixUnitaireAvecOffre(1.84, deuxieme, 2)).toBe(1.22);
  });
  it('pourcentage et montant', () => {
    expect(totalAvecOffre(4, { type: OFFRE_POURCENTAGE, pourcentage: 25 }, 1)).toBe(3);
    expect(totalAvecOffre(4.29, { type: OFFRE_MONTANT, montant: 2.15 }, 1)).toBe(2.14);
  });
  it('règle inconnue ou prix absent : on ne devine pas', () => {
    expect(totalAvecOffre(4, { type: OFFRE_INCONNUE, montant: 1 }, 1)).toBe(4);
    expect(totalAvecOffre(0, lot, 3)).toBeNull();
    expect(prixUnitaireAvecOffre(null, lot, 3)).toBeNull();
  });
  it('quantité requise', () => {
    expect(quantiteRequise(lot)).toBe(3);
    expect(quantiteRequise(deuxieme)).toBe(2);
    expect(quantiteRequise({ type: OFFRE_POURCENTAGE, pourcentage: 30 })).toBe(1);
    expect(quantiteRequise(null)).toBe(1);
  });
});

describe('offreConfirmeeParLeTicket', () => {
  it('Pringles du 18/08 : « 2+1 », 3 boîtes à 1,89 €, remise imprimée 1,89 €', () => {
    expect(offreConfirmeeParLeTicket(1.89, lireOffre('2+1 PRINGLES'), 3, 1.89)).toBe(true);
  });
  it('la remise imprimée ne correspond pas à l’offre lue : non confirmée', () => {
    expect(offreConfirmeeParLeTicket(1.89, lireOffre('2+1 PRINGLES'), 3, 0.5)).toBe(false);
    expect(offreConfirmeeParLeTicket(1.89, lireOffre('2+1 PRINGLES'), 3, 0)).toBe(false);
  });
});

describe('textes', () => {
  it('intitulés', () => {
    expect(titreOffre({ type: OFFRE_LOT_GRATUIT, achetes: 2, offerts: 1 })).toBe('2 achetés, le 3e offert');
    expect(titreOffre({ type: OFFRE_LOT_GRATUIT, achetes: 1, offerts: 1 })).toBe('1 acheté, le 2e offert');
    expect(titreOffre({ type: OFFRE_NIEME_REMISE, rang: 2, pourcentage: 50 })).toBe('Le 2e à −50 %');
    expect(titreOffre({ type: OFFRE_MONTANT, montant: 2.15 })).toBe('−2,15 €');
  });
  it('la phrase rappelle le prix normal quand il faut en prendre plusieurs', () => {
    expect(phraseOffre({ type: OFFRE_NIEME_REMISE, rang: 2, pourcentage: 60 }, 5.45))
      .toBe('Le 2e à −60 % : 3,82 € l\'unité si tu en prends 2. Un seul : prix normal, 5,45 €.');
  });
  it('remise simple : prix remisé au lieu du prix normal', () => {
    expect(phraseOffre({ type: OFFRE_POURCENTAGE, pourcentage: 25 }, 4)).toBe('−25 % : 3,00 € au lieu de 4,00 €.');
  });
});
