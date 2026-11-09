// Chantier 119 — la pastille de l'accueil et les compteurs viennent de
// requêtes EN BASE : on vérifie ici qu'elles excluent les lignes « sans
// code-barres », et qu'elles retombent sur la requête d'avant si la colonne
// n'existait pas (jamais de pastille cassée).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const appels = [];
let reponses = [];
function requete(table) {
  const trace = { table, filtres: [] };
  appels.push(trace);
  const chaine = {
    select: (...a) => { trace.select = a; return chaine; },
    eq: (...a) => { trace.filtres.push(['eq', ...a]); return chaine; },
    neq: (...a) => { trace.filtres.push(['neq', ...a]); return chaine; },
    not: (...a) => { trace.filtres.push(['not', ...a]); return chaine; },
    order: () => chaine,
    limit: () => chaine,
    maybeSingle: () => Promise.resolve(reponses.shift()),
    then: (ok, ko) => Promise.resolve(reponses.shift()).then(ok, ko),
  };
  return chaine;
}
vi.mock('./supabase', () => ({ supabase: { from: (t) => requete(t), rpc: vi.fn() } }));

import { chargerDernierTicketAIdentifier, chargerLignesAIdentifier, marquerLigneSansCodeBarresRpc } from './historiqueTicketsCore';
import { supabase } from './supabase';

const FILTRE_SANS_CODE = ['not', 'sans_code_barres', 'is', true];

describe('pastille de l\'accueil — dernier ticket', () => {
  beforeEach(() => { appels.length = 0; reponses = []; });

  it('le compte exclut les lignes « sans code-barres »', async () => {
    reponses = [{ data: { id: 't1', date_ticket: '2026-11-08' }, error: null }, { count: 0, error: null }];
    const r = await chargerDernierTicketAIdentifier('u1');
    expect(r).toEqual({ ticket: { id: 't1', date_ticket: '2026-11-08' }, n: 0 });
    const compte = appels[1];
    expect(compte.table).toBe('lignes_ticket');
    expect(compte.filtres).toContainEqual(['neq', 'statut_validation_produit', 'valide']);
    expect(compte.filtres).toContainEqual(FILTRE_SANS_CODE);
  });

  it('colonne absente -> repli sur le compte d\'avant, pas de pastille cassée', async () => {
    reponses = [
      { data: { id: 't1' }, error: null },
      { count: null, error: { message: 'column lignes_ticket.sans_code_barres does not exist' } },
      { count: 3, error: null },
    ];
    const r = await chargerDernierTicketAIdentifier('u1');
    expect(r.n).toBe(3);
    expect(appels[2].filtres).not.toContainEqual(FILTRE_SANS_CODE);
  });
});

describe('compteurs « Mes tickets »', () => {
  beforeEach(() => { appels.length = 0; reponses = []; });

  it('excluent les lignes « sans code-barres »', async () => {
    reponses = [{ data: [{ id: 'l1', ticket_id: 't1' }], error: null }];
    const r = await chargerLignesAIdentifier('u1');
    expect(r.data).toHaveLength(1);
    expect(appels[0].filtres).toContainEqual(FILTRE_SANS_CODE);
  });
});

describe('RPC marquer_ligne_sans_code_barres', () => {
  it('appelée avec la ligne et la valeur (true par défaut, false pour « Finalement j\'ai un code »)', () => {
    marquerLigneSansCodeBarresRpc('l-chou');
    expect(supabase.rpc).toHaveBeenLastCalledWith('marquer_ligne_sans_code_barres', { p_ligne_ticket_id: 'l-chou', p_valeur: true });
    marquerLigneSansCodeBarresRpc('l-chou', false);
    expect(supabase.rpc).toHaveBeenLastCalledWith('marquer_ligne_sans_code_barres', { p_ligne_ticket_id: 'l-chou', p_valeur: false });
  });
});
