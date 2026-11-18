import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { construireOffresDuTicket, libelleRemisePourLigne, parametresOffre, ORIGINE_CHIFFRES, ORIGINE_TEXTE } from './offresTicketCore';
import { OFFRE_LOT_GRATUIT, OFFRE_NIEME_REMISE, OFFRE_POURCENTAGE, OFFRE_MONTANT, OFFRE_INCONNUE } from './promotionsCore';

// Ticket Carrefour de François du 18/11/2026 : la ligne remisée telle qu'elle
// est en base, et la lecture telle qu'elle est conservée.
const lignePots = { id: 'ligne-pots', libelle_ticket: '4X100G PPC VAN LIG', quantite: 3, prix_unitaire: 2.27, montant_remise: 2.27 };
const lecture = { store: 'Carrefour', total_remises: 2.27, products: [
  { libelle_ticket: 'X36 DOSETTE DOUX N', qty: 1, price: 5.55, remise: 0 },
  { libelle_ticket: '4X100G PPC VAN LIG', qty: 3, price: 2.27, remise: 2.27, libelle_remise: 'Remise Immédiate' },
  { libelle_ticket: 'HACHE 15% X2 BIO', qty: 1, price: 6.15, remise: 0 },
] };

describe('construireOffresDuTicket — ticket Carrefour du 18/11', () => {
  it('les pots : « 2 achetés, le 3e offert », déduit des chiffres, texte imprimé gardé', () => {
    expect(construireOffresDuTicket([lignePots], lecture)).toEqual([{
      ligne_ticket_id: 'ligne-pots',
      mecanique: OFFRE_LOT_GRATUIT,
      parametres: { achetes: 2, offerts: 1 },
      origine: ORIGINE_CHIFFRES,
      texte_imprime: 'Remise Immédiate',
    }]);
  });
  it('les lignes sans remise ou sans identifiant ne donnent aucune offre', () => {
    const lignes = [
      { id: 'cafe', libelle_ticket: 'X36 DOSETTE DOUX N', quantite: 1, prix_unitaire: 5.55, montant_remise: 0 },
      { libelle_ticket: '4X100G PPC VAN LIG', quantite: 3, prix_unitaire: 2.27, montant_remise: 2.27 },
      null,
    ];
    expect(construireOffresDuTicket(lignes, lecture)).toEqual([]);
    expect(construireOffresDuTicket(null, lecture)).toEqual([]);
  });
  it('remise sans règle déductible : simple montant, origine « texte »', () => {
    const ligne = { id: 'x', libelle_ticket: 'CAFE', quantite: 1, prix_unitaire: 5.55, montant_remise: 0.5 };
    expect(construireOffresDuTicket([ligne], { products: [{ libelle_ticket: 'CAFE', remise: 0.5, libelle_remise: 'Remise Immédiate' }] }))
      .toEqual([{ ligne_ticket_id: 'x', mecanique: OFFRE_MONTANT, parametres: { montant: 0.5 }, origine: ORIGINE_TEXTE, texte_imprime: 'Remise Immédiate' }]);
  });
  it('règle imprimée sur le ticket : lue dans le texte, pas déduite', () => {
    const ligne = { id: 'y', libelle_ticket: 'TIPIAK', quantite: 2, prix_unitaire: 2, montant_remise: 1 };
    expect(construireOffresDuTicket([ligne], { products: [{ libelle_ticket: 'TIPIAK', remise: 1, libelle_remise: '2EME A -50%' }] }))
      .toEqual([{ ligne_ticket_id: 'y', mecanique: OFFRE_NIEME_REMISE, parametres: { rang: 2, pourcentage: 50 }, origine: ORIGINE_TEXTE, texte_imprime: '2EME A -50%' }]);
  });
  it('lecture absente (ticket ancien) : la règle se déduit quand même des chiffres, sans texte', () => {
    expect(construireOffresDuTicket([lignePots], null))
      .toEqual([{ ligne_ticket_id: 'ligne-pots', mecanique: OFFRE_LOT_GRATUIT, parametres: { achetes: 2, offerts: 1 }, origine: ORIGINE_CHIFFRES }]);
  });
});

describe('libelleRemisePourLigne', () => {
  it('même libellé (casse et espaces ignorés) et même remise', () => {
    expect(libelleRemisePourLigne({ libelle_ticket: ' 4x100g ppc van lig ', montant_remise: '2.27' }, lecture)).toBe('Remise Immédiate');
  });
  it('libellé différent, remise différente, libellé vide : rien', () => {
    expect(libelleRemisePourLigne({ libelle_ticket: '4X100G PPC VAN LL', montant_remise: 2.27 }, lecture)).toBe('');
    expect(libelleRemisePourLigne({ libelle_ticket: '4X100G PPC VAN LIG', montant_remise: 1 }, lecture)).toBe('');
    expect(libelleRemisePourLigne({ libelle_ticket: '', montant_remise: 0 }, { products: [{ libelle_ticket: '', remise: 0, libelle_remise: 'X' }] })).toBe('');
  });
  it('deux lignes identiques avec deux textes différents : on ne choisit pas', () => {
    const l = { products: [{ libelle_ticket: 'A', remise: 1, libelle_remise: '2+1' }, { libelle_ticket: 'A', remise: 1, libelle_remise: 'Remise' }] };
    expect(libelleRemisePourLigne({ libelle_ticket: 'A', montant_remise: 1 }, l)).toBe('');
  });
});

describe('parametresOffre', () => {
  it('seulement les paramètres de la règle', () => {
    expect(parametresOffre({ type: OFFRE_LOT_GRATUIT, achetes: 2, offerts: 1, deduite: true })).toEqual({ achetes: 2, offerts: 1 });
    expect(parametresOffre({ type: OFFRE_NIEME_REMISE, rang: 2, pourcentage: 60 })).toEqual({ rang: 2, pourcentage: 60 });
    expect(parametresOffre({ type: OFFRE_POURCENTAGE, pourcentage: 30 })).toEqual({ pourcentage: 30 });
    expect(parametresOffre({ type: OFFRE_MONTANT, montant: 0.5 })).toEqual({ montant: 0.5 });
    expect(parametresOffre({ type: OFFRE_INCONNUE, montant: 1 })).toEqual({ montant: 1 });
    expect(parametresOffre(null)).toEqual({});
  });
});
