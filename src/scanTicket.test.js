// Chantier 96 — garde-fou « scan sans produit exploitable ».
// Chantier 98 — lecture OCR fiabilisée (réessai + statuts honnêtes).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { supabase } from './lib/supabase';
import { filtrerProduitsExploitables, scanTicketRobuste, MESSAGES_SCAN } from './scanTicket';

describe('filtrerProduitsExploitables', () => {
  it('garde uniquement les produits avec nom et prix > 0', () => {
    const produits = [
      { name: 'Eau 1L', price: 1.5 },
      { name: 'Pain', price: '2.10' },      // prix en chaîne numérique : exploitable
      { name: 'Sans prix', price: 0 },
      { name: 'Prix nul', price: null },
      { name: '', price: 3 },
      { price: 2 },
      null,
      { name: 'Négatif', price: -1 },
      { name: 'NaN', price: 'abc' },
    ];
    expect(filtrerProduitsExploitables(produits).map(p => p.name)).toEqual(['Eau 1L', 'Pain']);
  });

  it('entrées vides ou nulles : liste vide, jamais de plantage', () => {
    expect(filtrerProduitsExploitables([])).toEqual([]);
    expect(filtrerProduitsExploitables(null)).toEqual([]);
    expect(filtrerProduitsExploitables(undefined)).toEqual([]);
  });

  // Chantier 99 — name vide mais libelle_ticket présent = produit lu, exploitable.
  it('un produit sans name mais avec libelle_ticket et prix > 0 est exploitable', () => {
    const produits = [
      { name: '', libelle_ticket: 'COPPA', price: 2.5, confiance: 'faible' },
      { libelle_ticket: '*AUCHAN MOZZARELLA', price: 1.05 },
    ];
    expect(filtrerProduitsExploitables(produits)).toHaveLength(2);
  });

  it('sans name NI libelle_ticket, ou sans prix > 0 : toujours exclu (garde-fou ch. 96 intact)', () => {
    const produits = [
      { name: '', libelle_ticket: '', price: 3 },
      { price: 2 },
      { name: '', libelle_ticket: 'COPPA', price: 0 },
      { libelle_ticket: 'COPPA', price: null },
      { libelle_ticket: 'COPPA', price: -1 },
    ];
    expect(filtrerProduitsExploitables(produits)).toEqual([]);
  });
});

describe('scanTicketRobuste — réessai automatique et statuts honnêtes (Chantier 98)', () => {
  beforeEach(() => vi.clearAllMocks());

  const OK = { store: 'Auchan', products: [{ name: 'Coppa', price: 2.5 }] };
  const VIDE = { store: 'Auchan', products: [] };

  it('1 seul appel quand la première lecture rend des produits', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: OK, error: null });
    const r = await scanTicketRobuste('b64', []);
    expect(r).toEqual({ statut: 'ok', resultat: OK });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
  });

  it('réessaie une fois quand la lecture rend 0 produit, et rend le 2e résultat s\'il est bon', async () => {
    supabase.functions.invoke
      .mockResolvedValueOnce({ data: VIDE, error: null })
      .mockResolvedValueOnce({ data: OK, error: null });
    const r = await scanTicketRobuste('b64', []);
    expect(r).toEqual({ statut: 'ok', resultat: OK });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it('2 lectures vides -> statut lecture_vide (le résultat est quand même renvoyé)', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: VIDE, error: null });
    const r = await scanTicketRobuste('b64', []);
    expect(r.statut).toBe('lecture_vide');
    expect(r.resultat).toEqual(VIDE);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it('réessaie après un échec technique, et réussit au 2e essai', async () => {
    supabase.functions.invoke
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
      .mockResolvedValueOnce({ data: OK, error: null });
    const r = await scanTicketRobuste('b64', []);
    expect(r).toEqual({ statut: 'ok', resultat: OK });
  });

  it('2 échecs techniques -> service_indisponible avec le message, ne throw jamais', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: null, error: { message: 'quota dépassé' } });
    const r = await scanTicketRobuste('b64', []);
    expect(r.statut).toBe('service_indisponible');
    expect(r.message).toBe('quota dépassé');
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it('échec puis lecture vide -> lecture_vide (une réponse valide prime sur l\'erreur)', async () => {
    supabase.functions.invoke
      .mockResolvedValueOnce({ data: null, error: { message: 'réseau' } })
      .mockResolvedValueOnce({ data: VIDE, error: null });
    const r = await scanTicketRobuste('b64', []);
    expect(r.statut).toBe('lecture_vide');
  });

  it('les messages honnêtes existent pour chaque statut d\'échec et ne commencent pas par accuser la photo', () => {
    expect(MESSAGES_SCAN.lecture_vide).toMatch(/service de lecture/);
    expect(MESSAGES_SCAN.service_indisponible).toMatch(/photo n'y est pour rien/);
  });
});
