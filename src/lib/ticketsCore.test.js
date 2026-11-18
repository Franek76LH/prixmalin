import { describe, it, expect } from 'vitest';
import { archiveDejaPresente, totalPayeTicket, totalTicket, totalLigne, ticketCorrespond, ticketsParMois, bilanTickets, euros } from './ticketsCore';

const t = (id, date, total, items = [], nom = 'Netto') => ({ id, date, total, items, store: { name: nom } });

describe('totalTicket', () => {
  it('prend le total enregistré', () => {
    expect(totalTicket(t(1, '2026-11-11', 23.4, [{ price: 1, qty: 2 }]))).toBe(23.4);
  });
  it('à défaut, additionne les lignes (prix × quantité)', () => {
    expect(totalTicket(t(1, '2026-11-11', 0, [{ unit_price: 1.5, qty: 2 }, { price: 2 }]))).toBe(5);
  });
  it('ticket vide : zéro, jamais NaN', () => {
    expect(totalTicket({})).toBe(0);
    expect(totalTicket(null)).toBe(0);
  });
});

describe('totalLigne', () => {
  it('prix × quantité', () => expect(totalLigne({ unit_price: 1.36, qty: 3 })).toBe(4.08));
  it('prix inconnu : null', () => expect(totalLigne({ qty: 2 })).toBeNull());
});

describe('ticketCorrespond', () => {
  const arc = t(1, '2026-11-11', 10, [{ product: 'Emmental râpé', brand: 'Président' }], 'Intermarché');
  it('sans recherche : tout passe', () => expect(ticketCorrespond(arc, '  ')).toBe(true));
  it('trouve un produit sans se soucier des accents', () => expect(ticketCorrespond(arc, 'rape')).toBe(true));
  it('trouve une marque ou un magasin', () => {
    expect(ticketCorrespond(arc, 'president')).toBe(true);
    expect(ticketCorrespond(arc, 'intermarche')).toBe(true);
  });
  it('ne trouve pas ce qui n’y est pas', () => expect(ticketCorrespond(arc, 'lait')).toBe(false));
});

describe('ticketsParMois', () => {
  const archives = [
    t(1, '2026-10-03T10:00:00Z', 10),
    t(2, '2026-11-02T10:00:00Z', 20),
    t(3, '2026-11-15T10:00:00Z', 30.5),
    t(4, 'pas une date', 99),
  ];
  it('range par mois, du plus récent au plus ancien, avec totaux', () => {
    const mois = ticketsParMois(archives);
    expect(mois.map(m => m.mois)).toEqual(['2026-11', '2026-10']);
    expect(mois[0]).toMatchObject({ nb: 2, total: 50.5 });
    expect(mois[0].tickets.map(a => a.id)).toEqual([3, 2]);
  });
  it('ignore un ticket sans date lisible', () => {
    expect(ticketsParMois(archives).flatMap(m => m.tickets).some(a => a.id === 4)).toBe(false);
  });
  it('la recherche ne garde que les tickets concernés', () => {
    const avecLait = [...archives, t(5, '2026-09-01', 5, [{ product: 'Lait demi-écrémé' }])];
    expect(ticketsParMois(avecLait, 'lait').map(m => m.mois)).toEqual(['2026-09']);
  });
  it('liste vide ou absente : tableau vide', () => {
    expect(ticketsParMois(null)).toEqual([]);
  });
});

describe('bilanTickets', () => {
  it('compte et additionne', () => {
    expect(bilanTickets([t(1, '2026-11-01', 10.1), t(2, '2026-11-02', 20.2)])).toEqual({ nb: 2, total: 30.3 });
  });
});

describe('euros', () => {
  it('virgule et espace des milliers', () => {
    expect(euros(2745)).toBe('2 745,00 €');
    expect(euros(3.5)).toBe('3,50 €');
  });
});

describe('archiveDejaPresente (chantier 131)', () => {
  const dansHistorique = [{ id: 122, date: '2026-11-09T00:00:00+00:00', total: 24.84, ticket_scanned: true, store: { name: 'Netto' } }];
  const nouveau = (plus = {}) => ({ date: '2026-11-09T15:14:17.507Z', total: 24.84, store: { name: 'netto' }, ...plus });
  it('reconnaît le même ticket rescanné (même jour, même magasin, même total)', () => {
    expect(archiveDejaPresente(dansHistorique, nouveau())?.id).toBe(122);
  });
  it('un autre total, un autre jour ou un autre magasin : ce n’est pas le même ticket', () => {
    expect(archiveDejaPresente(dansHistorique, nouveau({ total: 24.85 }))).toBeNull();
    expect(archiveDejaPresente(dansHistorique, nouveau({ date: '2026-11-10T08:00:00Z' }))).toBeNull();
    expect(archiveDejaPresente(dansHistorique, nouveau({ store: { name: 'Utile' } }))).toBeNull();
  });
  it('une liste validée sans ticket scanné ne compte pas', () => {
    expect(archiveDejaPresente([{ ...dansHistorique[0], ticket_scanned: false }], nouveau())).toBeNull();
  });
  it('ticket sans total ou sans date : on ne conclut rien', () => {
    expect(archiveDejaPresente(dansHistorique, nouveau({ total: 0 }))).toBeNull();
    expect(archiveDejaPresente(dansHistorique, { store: { name: 'Netto' }, total: 24.84 })).toBeNull();
  });
});

describe('totalPayeTicket (chantier 148) — ce qui a été payé, remises de ligne déduites', () => {
  // Ticket Carrefour de François du 18/11 : 32,60 € avant remises, 30,33 € payés.
  const carrefour = [
    { product: 'X36 DOSETTE DOUX N', price: 5.55, qty: 1, remise: 0 },
    { product: '4X100G PPC VAN LL', price: 2.27, qty: 3, remise: 2.27 },
    { product: '350G TAJINE BOEUF', price: 4.09, qty: 1, remise: 0 },
    { product: '300G PARMENTIER CA', price: 4.49, qty: 1, remise: 0 },
    { product: 'HACHE 15% X2 BIO', price: 6.15, qty: 1, remise: 0 },
    { product: 'BIERE EXTREME 8.6', price: 2.09, qty: 1, remise: 0 },
    { product: 'PEPSI ZERO SUCRES', price: 1.29, qty: 1, remise: 0 },
    { product: 'PET 1,5L COLA REGU', price: 0.54, qty: 1, remise: 0 },
    { product: 'BTE 50CL 8,6 ORIG', price: 1.59, qty: 1, remise: 0 },
  ];
  it('le ticket du 18/11 : 30,33 € et non 32,60 €', () => {
    expect(totalPayeTicket(carrefour)).toBe(30.33);
  });
  it('sans remise : la somme des lignes, comme avant', () => {
    expect(totalPayeTicket(carrefour.map(e => ({ product: e.product, price: e.price, qty: e.qty })))).toBe(32.6);
    expect(totalPayeTicket([{ price: 1.29, qty: 2 }, { price: 0.54 }])).toBe(3.12);
  });
  it('remise illisible ou négative : ignorée ; jamais de ligne négative', () => {
    expect(totalPayeTicket([{ price: 2, qty: 1, remise: 'abc' }, { price: 3, qty: 1, remise: -1 }])).toBe(5);
    expect(totalPayeTicket([{ price: 2, qty: 1, remise: 5 }])).toBe(0);
  });
  it('liste vide ou absente : 0', () => {
    expect(totalPayeTicket([])).toBe(0);
    expect(totalPayeTicket(null)).toBe(0);
  });
  it('un rescan du même ticket retrouve son entrée d\'historique (même total payé)', () => {
    const archive = { id: 127, ticket_scanned: true, date: '2026-11-18T15:53:19Z', store: { name: 'Carrefour' }, total: 30.33 };
    const nouvelle = { date: '2026-11-18T16:19:00Z', store: { name: 'Carrefour' }, total: totalPayeTicket(carrefour) };
    expect(archiveDejaPresente([archive], nouvelle)?.id).toBe(127);
  });
});
