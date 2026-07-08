import { describe, it, expect } from 'vitest';
import { calculerEconomiesConfirmeesCore } from './economiesCoreConfirmees';

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
