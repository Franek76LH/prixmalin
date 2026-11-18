import { describe, it, expect } from 'vitest';
import {
  lireOffre, deduireOffreDesChiffres, comprendreRemiseDeLigne, quantiteRequise, totalAvecOffre, prixUnitaireAvecOffre, offreConfirmeeParLeTicket, titreOffre, phraseOffre,
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

// Étalonnage sur le ticket Carrefour de François du 18/11/2026 (Marseille
// B. Bienvenue) et sur les trois affiches de rayon photographiées ce jour-là.
describe('ticket réel Carrefour du 18/11 — « Remise Immédiate » sans règle imprimée', () => {
  const pots = { libelleRemise: 'Remise Immédiate', prixNormal: 2.27, quantite: 3, montantRemise: 2.27 };

  it('le texte seul ne donne qu\'un montant', () => {
    expect(lireOffre('Remise Immédiate', 2.27)).toEqual({ type: OFFRE_MONTANT, montant: 2.27 });
  });
  it('les chiffres donnent la règle : 3 pots à 2,27 € et 2,27 € de remise = 2 achetés, le 3e offert', () => {
    const offre = comprendreRemiseDeLigne(pots);
    expect(offre).toEqual({ type: OFFRE_LOT_GRATUIT, achetes: 2, offerts: 1, deduite: true });
    expect(titreOffre(offre)).toBe('2 achetés, le 3e offert');
    expect(totalAvecOffre(2.27, offre, 3)).toBe(4.54); // « Les 3 pour 4,54 € » de l'affiche
    expect(prixUnitaireAvecOffre(2.27, offre, 1)).toBe(2.27); // un seul : prix normal
    expect(offreConfirmeeParLeTicket(2.27, offre, 3, 2.27)).toBe(true);
    expect(phraseOffre(offre, 2.27)).toBe("2 achetés, le 3e offert : 1,51 € l'unité si tu en prends 3. Un seul : prix normal, 2,27 €.");
  });
  it('deux articles, remise d\'un prix unitaire = 1 acheté, le 2e offert', () => {
    expect(deduireOffreDesChiffres(1.95, 2, 1.95)).toEqual({ type: OFFRE_LOT_GRATUIT, achetes: 1, offerts: 1, deduite: true });
  });
  it('tolère un centime d\'arrondi, pas davantage', () => {
    expect(deduireOffreDesChiffres(2.27, 3, 2.28)).not.toBeNull();
    expect(deduireOffreDesChiffres(2.27, 3, 2.30)).toBeNull();
  });
  it('ne devine jamais : quantité 1, plus de 3 articles, remise qui n\'est pas un prix entier, valeurs absentes', () => {
    expect(deduireOffreDesChiffres(5.55, 1, 0.5)).toBeNull();     // café Legal : 0,50 € de réduction
    expect(deduireOffreDesChiffres(2.27, 4, 2.27)).toBeNull();    // « 3+1 » ou « 2+1 » + un plein : ambigu
    expect(deduireOffreDesChiffres(2.27, 6, 4.54)).toBeNull();
    expect(deduireOffreDesChiffres(4.65, 2, 2.79)).toBeNull();    // « −60 % sur le 2e » : pas un lot gratuit
    expect(deduireOffreDesChiffres(2.27, 3, 6.81)).toBeNull();    // tout offert : impossible
    expect(deduireOffreDesChiffres(2.27, 3, 0)).toBeNull();
    expect(deduireOffreDesChiffres(0, 3, 2.27)).toBeNull();
    expect(deduireOffreDesChiffres(2.27, 2.5, 2.27)).toBeNull();
    expect(deduireOffreDesChiffres(undefined, undefined, undefined)).toBeNull();
  });
  it('quand les chiffres ne disent rien, on garde le simple montant', () => {
    expect(comprendreRemiseDeLigne({ libelleRemise: 'Remise Immédiate', prixNormal: 5.55, quantite: 1, montantRemise: 0.5 }))
      .toEqual({ type: OFFRE_MONTANT, montant: 0.5 });
    expect(comprendreRemiseDeLigne({ libelleRemise: 'Remise Immédiate', prixNormal: 4.65, quantite: 2, montantRemise: 2.79 }))
      .toEqual({ type: OFFRE_MONTANT, montant: 2.79 });
  });
  it('une règle imprimée n\'est jamais remplacée par une déduction', () => {
    expect(comprendreRemiseDeLigne({ libelleRemise: '2EME A -50%', prixNormal: 2, quantite: 2, montantRemise: 1 }))
      .toEqual({ type: OFFRE_NIEME_REMISE, rang: 2, pourcentage: 50 });
    expect(comprendreRemiseDeLigne({ libelleRemise: '2+1 OFFERT', prixNormal: 2.27, quantite: 3, montantRemise: 2.27 }))
      .toEqual({ type: OFFRE_LOT_GRATUIT, achetes: 2, offerts: 1 });
  });
  it('pas de remise, pas d\'offre', () => {
    expect(comprendreRemiseDeLigne({ prixNormal: 6.15, quantite: 1, montantRemise: 0 })).toBeNull();
    expect(comprendreRemiseDeLigne()).toBeNull();
  });
});

describe('affiches de rayon Carrefour du 18/11 — textes réels', () => {
  it('« 2+1 OFFERT » (La Laitière, vendu seul 2,27 €, les 3 pour 4,54 €)', () => {
    const offre = lireOffre('2+1 OFFERT');
    expect(offre).toEqual({ type: OFFRE_LOT_GRATUIT, achetes: 2, offerts: 1 });
    expect(totalAvecOffre(2.27, offre, 3)).toBe(4.54);
  });
  it('« -60% SUR LE 2ÈME » (Fleury Michon, vendu seul 4,65 €, le 2e à 1,86 €, les 2 pour 6,51 €)', () => {
    const offre = lireOffre('-60% SUR LE 2ÈME');
    expect(offre).toEqual({ type: OFFRE_NIEME_REMISE, rang: 2, pourcentage: 60 });
    expect(totalAvecOffre(4.65, offre, 2)).toBe(6.51);
    expect(totalAvecOffre(4.65, offre, 1)).toBe(4.65);
  });
  it('« 0,50€ de RÉDUCTION IMMÉDIATE » (café Legal) : un montant, si la caisse l\'a déduit', () => {
    expect(lireOffre('0,50€ de RÉDUCTION IMMÉDIATE', 0.5)).toEqual({ type: OFFRE_MONTANT, montant: 0.5 });
    expect(lireOffre('0,50€ de RÉDUCTION IMMÉDIATE')).toBeNull(); // vignette non passée en caisse : rien
  });
});
