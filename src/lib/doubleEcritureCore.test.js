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

describe('envoyerTicketCore — magasin_id Core dans le payload (Chantier 97)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transmet magasin_id quand un magasin Core est validé', async () => {
    supabase.rpc.mockResolvedValue({ data: { statut: 'ok', prix_ecrits: 1, rejets: [] }, error: null });

    await envoyerTicketCore(
      [{ id: 1, product: 'Lait', brand: '', format: '', qty: 1, price: 1.15 }],
      { magasinId: '09112b4e-2858-4f15-a1e4-a5072d87e65c', storeLegacyId: 's1', magasinTexte: 'Auchan Mazargues', dateTicket: '2026-08-14' }
    );

    const [, payload] = supabase.rpc.mock.calls[0];
    expect(payload.p_ticket.magasin_id).toBe('09112b4e-2858-4f15-a1e4-a5072d87e65c');
    expect(payload.p_ticket.store_legacy_id).toBe('s1');
    expect(payload.p_ticket.magasin_texte).toBe('Auchan Mazargues');
  });

  it('envoie magasin_id=null quand absent (non-régression des anciens appels)', async () => {
    supabase.rpc.mockResolvedValue({ data: { statut: 'ok', prix_ecrits: 1, rejets: [] }, error: null });

    await envoyerTicketCore(
      [{ id: 1, product: 'Lait', brand: '', format: '', qty: 1, price: 1.15 }],
      { storeLegacyId: 's1', magasinTexte: 'Carrefour', dateTicket: '2026-07-10' }
    );

    const [, payload] = supabase.rpc.mock.calls[0];
    expect(payload.p_ticket.magasin_id).toBeNull();
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

// Chantier 118 (étape 11) — montant_total = total IMPRIMÉ, jamais la somme des
// lignes. Cas réel : Intermarché Aix du 09/11, 59,43 € imprimés, 60,49 € de lignes.
import { montantTotalImprime } from './doubleEcritureCore';
import { controlerCoherenceTicket, NIVEAU_AVERTISSEMENT, MONTANT_SANS_TOTAL } from './coherenceTicket';

describe('envoyerTicketCore — montant_total = total imprimé (chantier 118)', () => {
  beforeEach(() => vi.clearAllMocks());

  // 60,49 € de lignes (dont un article × 2).
  const LIGNES = [
    { id: 1, product: 'Café capsules', libelle_ticket: 'POT CAFE FORTE X44 C', qty: 1, price: 8.52 },
    { id: 2, product: 'Rumsteck', libelle_ticket: 'V.BOVINE 1 X RUMSTEC', qty: 1, price: 12.37 },
    { id: 3, product: 'Lait', libelle_ticket: 'LAIT 1/2 ECR', qty: 2, price: 19.80 },
  ];
  const montantEnvoye = () => supabase.rpc.mock.calls[0][1].p_ticket.montant_total;

  it('les lignes du cas de test font bien 60,49 €', () => {
    const somme = LIGNES.reduce((a, p) => a + p.price * p.qty, 0);
    expect(Math.round(somme * 100) / 100).toBe(60.49);
  });

  it('total_ticket absent -> montant_total null (jamais la somme des lignes)', async () => {
    supabase.rpc.mockResolvedValue({ data: { statut: 'ok' }, error: null });
    await envoyerTicketCore(LIGNES, { magasinId: 'm1', dateTicket: '2026-11-08' });
    expect(montantEnvoye()).toBeNull();
  });

  it('total_ticket null / 0 / illisible -> null', async () => {
    supabase.rpc.mockResolvedValue({ data: { statut: 'ok' }, error: null });
    for (const t of [null, 0, '', 'abc', -3]) {
      vi.clearAllMocks();
      await envoyerTicketCore(LIGNES, { magasinId: 'm1', totalTicket: t });
      expect(montantEnvoye()).toBeNull();
    }
  });

  it('total_ticket 59.43 + lignes 60.49 -> montant_total 59.43', async () => {
    supabase.rpc.mockResolvedValue({ data: { statut: 'ok' }, error: null });
    await envoyerTicketCore(LIGNES, { magasinId: 'm1', totalTicket: 59.43 });
    expect(montantEnvoye()).toBe(59.43);
  });

  it('le contrôle 108 signale l\'écart entre 59,43 € imprimés et 60,49 € de lignes', () => {
    const c = controlerCoherenceTicket({
      products: LIGNES.map(p => ({ name: p.product, price: p.price, qty: p.qty, total: Math.round(p.price * p.qty * 100) / 100 })),
      total_ticket: 59.43,
      total_remises: 0,
    });
    expect(c.totalTicket).toBe(59.43);
    expect(Math.round(c.sommeLignes * 100) / 100).toBe(60.49);
    expect(c.ecartMontant).toBeCloseTo(1.06 / 59.43, 4);
    // Chantier 118 — 1,06 € d'écart : au-delà de 0,10 €, le bandeau s'affiche.
    expect(c.ecartMontantEuros).toBe(1.06);
    expect(c.niveau).toBe(NIVEAU_AVERTISSEMENT);
  });

  it('total non lu -> le contrôle 108 dit qu\'il n\'a rien pu mesurer', () => {
    const c = controlerCoherenceTicket({ products: [{ name: 'X', price: 8.52, total: 8.52 }], total_ticket: null, total_remises: 0 });
    expect(c.montantNonMesure).toBe(MONTANT_SANS_TOTAL);
  });

  it('montantTotalImprime arrondit au centime et accepte une chaîne numérique', () => {
    expect(montantTotalImprime('59.43')).toBe(59.43);
    expect(montantTotalImprime(59.4300001)).toBe(59.43);
  });
});
