// Chantier 92 Lot 6 — tests des favoris (par format) & récurrents.
import { describe, it, expect } from 'vitest';
import {
  cleFavori,
  detecterRecurrents,
  proposerFavorisApresTicket,
  SEUIL_TICKETS_RECURRENT,
} from './favorisCore';

describe('cleFavori', () => {
  it('distingue les formats et traite null/undefined pareil (favori niveau produit)', () => {
    expect(cleFavori('p1', 'v1')).toBe('p:p1|v:v1');
    expect(cleFavori('p1', 'v2')).not.toBe(cleFavori('p1', 'v1'));
    expect(cleFavori('p1', null)).toBe('p:p1|v:');
    expect(cleFavori('p1', undefined)).toBe(cleFavori('p1', null));
  });
});

describe('detecterRecurrents', () => {
  const ligne = (ticket, produit, variante = 'v1') => ({ ticket_id: ticket, produit_id: produit, variante_produit_id: variante });

  it('récurrent à partir de 3 tickets DISTINCTS (seuil par défaut)', () => {
    expect(SEUIL_TICKETS_RECURRENT).toBe(3);
    const lignes = [ligne('t1', 'p1'), ligne('t2', 'p1'), ligne('t3', 'p1'), ligne('t1', 'p2'), ligne('t2', 'p2')];
    const r = detecterRecurrents(lignes);
    expect(r).toEqual([{ produit_id: 'p1', variante_produit_id: 'v1', nb_tickets: 3 }]);
  });

  it('des lignes dupliquées dans le MÊME ticket ne comptent qu\'une fois', () => {
    const lignes = [ligne('t1', 'p1'), ligne('t1', 'p1'), ligne('t1', 'p1'), ligne('t2', 'p1')];
    expect(detecterRecurrents(lignes)).toEqual([]);
  });

  it('regroupe par (produit, FORMAT) : deux formats du même produit comptent séparément', () => {
    const lignes = [
      ligne('t1', 'p1', 'v1'), ligne('t2', 'p1', 'v1'), ligne('t3', 'p1', 'v1'),
      ligne('t1', 'p1', 'v2'), ligne('t2', 'p1', 'v2'),
    ];
    const r = detecterRecurrents(lignes);
    expect(r).toHaveLength(1);
    expect(r[0].variante_produit_id).toBe('v1');
  });

  it('variante null = niveau produit, distincte d\'un format précis', () => {
    const lignes = [
      ligne('t1', 'p1', null), ligne('t2', 'p1', null), ligne('t3', 'p1', null),
      ligne('t4', 'p1', 'v1'),
    ];
    const r = detecterRecurrents(lignes);
    expect(r).toEqual([{ produit_id: 'p1', variante_produit_id: null, nb_tickets: 3 }]);
  });

  it('seuil ajustable ; lignes sans produit_id ou sans ticket_id ignorées ; entrée nulle OK', () => {
    const lignes = [ligne('t1', 'p1'), ligne('t2', 'p1'), { ticket_id: 't3', produit_id: null }, { produit_id: 'p1' }];
    expect(detecterRecurrents(lignes, { seuil: 2 })).toEqual([{ produit_id: 'p1', variante_produit_id: 'v1', nb_tickets: 2 }]);
    expect(detecterRecurrents(lignes)).toEqual([]);
    expect(detecterRecurrents(null)).toEqual([]);
  });
});

describe('proposerFavorisApresTicket', () => {
  const achat = (sur) => ({ produit_id: 'p1', variante_produit_id: 'v1', nom_affiche: 'Perrier 1L', achat: 'confirme', ...sur });
  const recurrent = (sur) => ({ produit_id: 'p1', variante_produit_id: 'v1', nb_tickets: 4, ...sur });

  it('propose un achat confirmé récurrent non déjà favori, avec nom et nb_tickets', () => {
    const p = proposerFavorisApresTicket({ achatsConfirmes: [achat()], recurrents: [recurrent()], favorisExistants: [] });
    expect(p).toEqual([{ cle: 'p:p1|v:v1', produit_id: 'p1', variante_produit_id: 'v1', nom_affiche: 'Perrier 1L', nb_tickets: 4 }]);
  });

  it('masque ce qui est déjà favori (même format), par IDs réels', () => {
    const p = proposerFavorisApresTicket({
      achatsConfirmes: [achat()],
      recurrents: [recurrent()],
      favorisExistants: [{ produit_id: 'p1', variante_produit_id: 'v1' }],
    });
    expect(p).toEqual([]);
  });

  it('même produit, AUTRE format déjà favori : la proposition reste (formats indépendants)', () => {
    const p = proposerFavorisApresTicket({
      achatsConfirmes: [achat()],
      recurrents: [recurrent()],
      favorisExistants: [{ produit_id: 'p1', variante_produit_id: 'v2' }],
    });
    expect(p).toHaveLength(1);
  });

  it('non récurrent, produit_id absent, ou doublon dans les achats : écartés', () => {
    const p = proposerFavorisApresTicket({
      achatsConfirmes: [achat(), achat(), achat({ produit_id: null }), achat({ produit_id: 'p9', variante_produit_id: 'v9' })],
      recurrents: [recurrent()],
      favorisExistants: [],
    });
    expect(p).toHaveLength(1);
  });

  it('les achats hors liste (article-fantôme du chantier 91) sont proposables aussi', () => {
    const horsListe = { produit_id: 'p2', variante_produit_id: null, nom_affiche: 'Kinder Bueno', hors_liste: true, achat: 'confirme' };
    const p = proposerFavorisApresTicket({
      achatsConfirmes: [horsListe],
      recurrents: [recurrent({ produit_id: 'p2', variante_produit_id: null })],
      favorisExistants: [],
    });
    expect(p).toHaveLength(1);
    expect(p[0].variante_produit_id).toBeNull();
  });

  it('entrées vides : jamais de plantage', () => {
    expect(proposerFavorisApresTicket()).toEqual([]);
    expect(proposerFavorisApresTicket({})).toEqual([]);
  });
});
