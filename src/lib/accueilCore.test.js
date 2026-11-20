import { describe, it, expect } from 'vitest';
import {
  economiesConfirmees, economiesEstimees, apercuListe, actionPrincipale, montrerModeDemploi,
  ACTION_REPRENDRE_COURSES, ACTION_COMPARER, ACTION_COMMENCER_LISTE,
} from './accueilCore';

describe('économies de l\'accueil', () => {
  it('confirmées : seulement les courses dont le ticket a été scanné', () => {
    const archives = [
      { ticket_scanned: true, realized_saving: 12.5 },
      { ticket_scanned: true, realized_saving: 20.48 },
      { ticket_scanned: false, realized_saving: 99 },
      { ticket_scanned: true, realized_saving: null },
    ];
    expect(economiesConfirmees(archives)).toBe(32.98);
  });
  it('estimées : les anciennes valeurs négatives ne comptent pas (cas réel « −111,60 € »)', () => {
    expect(economiesEstimees([{ potential_saving: -120 }, { potential_saving: 8.4 }, { potential_saving: null }, {}])).toBe(8.4);
    expect(economiesEstimees([{ potential_saving: -111.6 }])).toBe(0);
  });
  it('entrées vides : 0, jamais d\'exception', () => {
    expect(economiesConfirmees(null)).toBe(0);
    expect(economiesEstimees(undefined)).toBe(0);
  });
});

describe('apercuListe', () => {
  const items = [
    { product: 'Lait', checked: false }, { product: 'Beurre', checked: true }, { product: 'Pâtes', checked: false },
    { product: 'Œufs', checked: false }, { product: 'Café', checked: false }, { product: 'Riz', checked: false }, { product: '  ', checked: false },
  ];
  it('montre les premiers produits à acheter et compte le reste', () => {
    expect(apercuListe(items)).toEqual({ total: 7, aAcheter: 6, apercu: ['Lait', 'Pâtes', 'Œufs', 'Café'], reste: 1 });
  });
  it('liste vide ou absente', () => {
    expect(apercuListe([])).toEqual({ total: 0, aAcheter: 0, apercu: [], reste: 0 });
    expect(apercuListe(null)).toEqual({ total: 0, aAcheter: 0, apercu: [], reste: 0 });
  });
});

describe('actionPrincipale', () => {
  it('des courses sont en cours : on propose d\'abord de les reprendre', () => {
    expect(actionPrincipale({ items: [{ product: 'Lait' }], sessionCourses: { id: 1 } })).toBe(ACTION_REPRENDRE_COURSES);
  });
  it('une liste avec des produits à acheter : comparer', () => {
    expect(actionPrincipale({ items: [{ product: 'Lait', checked: false }], sessionCourses: null })).toBe(ACTION_COMPARER);
  });
  it('liste vide ou entièrement cochée : commencer la liste', () => {
    expect(actionPrincipale({ items: [], sessionCourses: null })).toBe(ACTION_COMMENCER_LISTE);
    expect(actionPrincipale({ items: [{ product: 'Lait', checked: true }], sessionCourses: null })).toBe(ACTION_COMMENCER_LISTE);
  });
});

describe('montrerModeDemploi', () => {
  it('seulement pour un nouveau : ni liste ni historique', () => {
    expect(montrerModeDemploi({ archives: [], items: [] })).toBe(true);
    expect(montrerModeDemploi({ archives: [{}], items: [] })).toBe(false);
    expect(montrerModeDemploi({ archives: [], items: [{}] })).toBe(false);
  });
});

describe('chantier 160 — carte « Économies estimées »', () => {
  it('avec des tickets analysés : montant des tickets, nombre de tickets, phrase sur le prix moyen', async () => {
    const { carteEconomies, PHRASE_ECONOMIES_TICKETS } = await import('./accueilCore');
    const c = carteEconomies([
      { ticket_scanned: true, realized_saving: 3.2 }, { ticket_scanned: true, realized_saving: 1.1 },
      { ticket_scanned: false, potential_saving: 50 },
    ]);
    expect(c).toEqual({ etat: 'tickets', montant: 4.3, nbTickets: 2, phrase: PHRASE_ECONOMIES_TICKETS });
  });
  it('sans ticket analysé mais avec une comparaison validée : l\'écart estimé', async () => {
    const { carteEconomies } = await import('./accueilCore');
    const c = carteEconomies([{ ticket_scanned: false, potential_saving: 4.1 }, { potential_saving: -9 }]);
    expect(c.etat).toBe('comparaison');
    expect(c.montant).toBe(4.1);
  });
  it('rien : aucun chiffre', async () => {
    const { carteEconomies } = await import('./accueilCore');
    for (const a of [[], null, [{ potential_saving: 0 }], [{ ticket_scanned: true, realized_saving: null }]]) {
      const c = carteEconomies(a);
      expect(c.etat).toBe('vide');
      expect(c.montant).toBeNull();
    }
  });
});
