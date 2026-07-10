import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from './supabase';
import { envoyerTicketCore, envoyerPrixManuelCore } from './doubleEcritureCore';

describe('envoyerTicketCore — propagation libelle_ticket (#68)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transmet libelle_ticket dans lignes[] quand présent sur l\'item importé', async () => {
    supabase.rpc.mockResolvedValue({ data: { statut: 'ok', prix_ecrits: 1, rejets: [] }, error: null });

    await envoyerTicketCore(
      [{ id: 1, product: 'Bière blonde', libelle_ticket: '6X1L BP LT MONT UH', brand: '', format: '', qty: 1, price: 1.15 }],
      { storeLegacyId: 's1', magasinTexte: 'Carrefour', dateTicket: '2026-07-10' }
    );

    expect(supabase.rpc).toHaveBeenCalledWith('enregistrer_ticket_core', expect.objectContaining({
      p_ticket: expect.objectContaining({
        lignes: [expect.objectContaining({
          libelle_brut: 'Bière blonde',
          libelle_ticket: '6X1L BP LT MONT UH',
        })],
      }),
    }));
  });

  it('envoie libelle_ticket=null quand absent de l\'item importé, sans planter', async () => {
    supabase.rpc.mockResolvedValue({ data: { statut: 'ok', prix_ecrits: 1, rejets: [] }, error: null });

    await envoyerTicketCore(
      [{ id: 1, product: 'Lait demi-écrémé', brand: '', format: '', qty: 1, price: 1.15 }],
      { storeLegacyId: 's1', magasinTexte: 'Carrefour', dateTicket: '2026-07-10' }
    );

    expect(supabase.rpc).toHaveBeenCalledWith('enregistrer_ticket_core', expect.objectContaining({
      p_ticket: expect.objectContaining({
        lignes: [expect.objectContaining({ libelle_brut: 'Lait demi-écrémé', libelle_ticket: null })],
      }),
    }));
  });

  it('continue à envoyer libelle_brut/name/brand/format/quantite/prix_unitaire comme avant (non-régression)', async () => {
    supabase.rpc.mockResolvedValue({ data: { statut: 'ok', prix_ecrits: 1, rejets: [] }, error: null });

    await envoyerTicketCore(
      [{ id: 1, product: 'Café', libelle_ticket: 'CAFE MOULU 250G', brand: 'Alter Eco', format: '250g', qty: 2, price: 5.78 }],
      {}
    );

    const [, payload] = supabase.rpc.mock.calls[0];
    expect(payload.p_ticket.lignes[0]).toEqual({
      libelle_brut: 'Café',
      libelle_ticket: 'CAFE MOULU 250G',
      brand: 'Alter Eco',
      name: 'Café',
      format: '250g',
      quantite: 2,
      prix_unitaire: 5.78,
    });
  });
});

describe('envoyerPrixManuelCore — non modifié par #68', () => {
  beforeEach(() => vi.clearAllMocks());

  it('n\'envoie pas de champ libelle_ticket (hors périmètre saisie manuelle)', async () => {
    supabase.rpc.mockResolvedValue({ data: { statut: 'ok' }, error: null });

    await envoyerPrixManuelCore(
      { product: 'Lait demi-écrémé', price: '1.15', date: '2026-07-10' },
      { storeLegacyId: 's1', magasinTexte: 'Carrefour' }
    );

    const [, payload] = supabase.rpc.mock.calls[0];
    expect(payload.p_prix).not.toHaveProperty('libelle_ticket');
    expect(payload.p_prix.libelle_produit).toBe('Lait demi-écrémé');
  });
});
