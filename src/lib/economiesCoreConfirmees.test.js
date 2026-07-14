import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('./comparateurCore', () => ({ chargerPrixComparables: vi.fn() }));

import { supabase } from './supabase';
import { chargerPrixComparables } from './comparateurCore';
import { calculerEconomiesConfirmeesCore, calculerRealizedSavingTicket } from './economiesCoreConfirmees';

function creerBuilder(resultat) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => resultat),
    then: (resolve, reject) => Promise.resolve(resultat).then(resolve, reject),
  };
  return builder;
}

describe('calculerEconomiesConfirmeesCore', () => {
  it('calcule une économie positive quand le prix payé est inférieur au marché', () => {
    const { total, lignes } = calculerEconomiesConfirmeesCore([
      { ligneTicketId: 1, produitId: 'p1', magasinId: 'm1', prixPaye: 0.95, prixReferenceMarche: 1.15 },
    ]);
    expect(lignes[0].economie).toBeCloseTo(0.20);
    expect(total).toBeCloseTo(0.20);
  });

  it('calcule un surcoût (économie négative) quand le prix payé dépasse le marché', () => {
    const { total, lignes } = calculerEconomiesConfirmeesCore([
      { ligneTicketId: 1, produitId: 'p1', magasinId: 'm1', prixPaye: 4.80, prixReferenceMarche: 4.20 },
    ]);
    expect(lignes[0].economie).toBeCloseTo(-0.60);
    expect(total).toBeCloseTo(-0.60);
  });

  it('exclut du total une ligne sans prix de référence marché, sans planter', () => {
    const { total, lignes } = calculerEconomiesConfirmeesCore([
      { ligneTicketId: 1, produitId: 'p1', magasinId: 'm1', prixPaye: 2.00, prixReferenceMarche: null },
    ]);
    expect(lignes[0].economie).toBeNull();
    expect(total).toBe(0);
  });

  it('additionne correctement plusieurs lignes mixtes (économie, surcoût, neutre)', () => {
    const { total } = calculerEconomiesConfirmeesCore([
      { ligneTicketId: 1, produitId: 'lait', magasinId: 'm1', prixPaye: 0.95, prixReferenceMarche: 1.15 },
      { ligneTicketId: 2, produitId: 'cafe', magasinId: 'm1', prixPaye: 4.80, prixReferenceMarche: 4.20 },
      { ligneTicketId: 3, produitId: 'pates', magasinId: 'm1', prixPaye: 1.10, prixReferenceMarche: 1.12 },
    ]);
    expect(total).toBeCloseTo(-0.38);
  });

  it('renvoie un total à 0 et une liste vide sans lignes', () => {
    expect(calculerEconomiesConfirmeesCore([])).toEqual({ total: 0, lignes: [] });
    expect(calculerEconomiesConfirmeesCore(undefined)).toEqual({ total: 0, lignes: [] });
  });
});

describe('calculerRealizedSavingTicket (#56.6 — scopé à un seul ticket)', () => {
  beforeEach(() => vi.clearAllMocks());

  it("renvoie un total nul si l'utilisateur n'a aucun ticket", async () => {
    supabase.from.mockImplementation(() => creerBuilder({ data: null, error: null }));
    const resultat = await calculerRealizedSavingTicket({ utilisateurId: 'u1' });
    expect(resultat).toEqual({ total: 0, lignes: [], simule: false });
    expect(chargerPrixComparables).not.toHaveBeenCalled();
  });

  it('renvoie un total nul si le ticket trouvé n\'a aucune ligne', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'tickets') return creerBuilder({ data: { id: 't1' }, error: null });
      if (table === 'lignes_ticket') return creerBuilder({ data: [], error: null });
      throw new Error(`table inattendue : ${table}`);
    });
    const resultat = await calculerRealizedSavingTicket({ utilisateurId: 'u1' });
    expect(resultat).toEqual({ total: 0, lignes: [], simule: false });
  });

  it('calcule le total uniquement sur les lignes du dernier ticket, via chargerPrixComparables', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'tickets') return creerBuilder({ data: { id: 't1' }, error: null });
      if (table === 'lignes_ticket') return creerBuilder({ data: [{ id: 'l1' }, { id: 'l2' }], error: null });
      if (table === 'prix') return creerBuilder({
        data: [
          { produit_id: 'p1', magasin_id: 'm1', prix_total: 0.95, ligne_ticket_id: 'l1' },
          { produit_id: 'p2', magasin_id: 'm1', prix_total: 4.80, ligne_ticket_id: 'l2' },
        ],
        error: null,
      });
      throw new Error(`table inattendue : ${table}`);
    });
    chargerPrixComparables.mockResolvedValue([
      { produit_id: 'p1', magasin_id: 'm2', prix_total: 1.15 },
      { produit_id: 'p2', magasin_id: 'm2', prix_total: 4.20 },
    ]);

    const resultat = await calculerRealizedSavingTicket({ utilisateurId: 'u1' });
    expect(resultat.simule).toBe(false);
    expect(resultat.total).toBeCloseTo(-0.40); // +0.20 (lait) - 0.60 (café)
    expect(resultat.lignes).toHaveLength(2);
    expect(supabase.from).toHaveBeenCalledWith('prix');
  });
});
