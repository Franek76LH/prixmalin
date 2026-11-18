import { describe, it, expect } from 'vitest';
import { rappelTicketVisible, ageTicketEnJours, lireTicketsEcartes, ecarterTicket, JOURS_RAPPEL_TICKET } from './rappelTicketCore';

const maintenant = Date.parse('2026-11-18T12:00:00Z');
const ticket = (jours, id = 't1') => ({ id, cree_le: new Date(maintenant - jours * 86400000).toISOString() });
const fauxStockage = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };

describe('rappel du ticket à scanner', () => {
  it('se montre pour un ticket récent', () => {
    expect(rappelTicketVisible(ticket(0.5), { maintenant })).toBe(true);
    expect(rappelTicketVisible(ticket(JOURS_RAPPEL_TICKET - 0.1), { maintenant })).toBe(true);
  });
  it("s'éteint tout seul passé le délai (ticket Monoprix du 11/11 vu le 18/11)", () => {
    expect(rappelTicketVisible(ticket(JOURS_RAPPEL_TICKET), { maintenant })).toBe(false);
    expect(rappelTicketVisible(ticket(7), { maintenant })).toBe(false);
  });
  it("disparaît dès qu'on l'écarte, même récent", () => {
    expect(rappelTicketVisible(ticket(0), { maintenant, ecartes: ['t1'] })).toBe(false);
    expect(rappelTicketVisible(ticket(0, 't2'), { maintenant, ecartes: ['t1'] })).toBe(true);
  });
  it('date inconnue : on montre ; ticket absent : rien', () => {
    expect(rappelTicketVisible({ id: 'x' }, { maintenant })).toBe(true);
    expect(rappelTicketVisible(null, { maintenant })).toBe(false);
    expect(ageTicketEnJours({ cree_le: 'n/a' }, maintenant)).toBe(null);
  });
  it('mémorise les tickets écartés, sans doublon', () => {
    const s = fauxStockage();
    ecarterTicket('a', s); ecarterTicket('b', s); ecarterTicket('a', s);
    expect(lireTicketsEcartes(s)).toEqual(['b', 'a']);
  });
  it('un stockage cassé ne fait rien planter', () => {
    const casse = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    expect(lireTicketsEcartes(casse)).toEqual([]);
    expect(() => ecarterTicket('a', casse)).not.toThrow();
    expect(() => ecarterTicket('a', undefined)).not.toThrow();
  });
});
