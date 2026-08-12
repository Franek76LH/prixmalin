// Chantier 93 Lot 7 — tests de l'anti-doublon de ticket.
import { describe, it, expect } from 'vitest';
import { sha256Hex, calculerEmpreinteTicket } from './empreinteTicket';

// Vecteurs de référence produits avec hashlib.sha256 (Python) le 2026-08-12.
describe('sha256Hex — implémentation JS pure (pas de crypto.subtle)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    // 56 octets : cas limite du bourrage (deuxième bloc requis).
    ['a'.repeat(56), 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    // UTF-8 multi-octets (accents + ligature).
    ['héllo wörld œuf', '81ed67499a19c7af637a238a91b1aa76c5f5c6eca1caf0cc315e9c41743c5c7d'],
    // Forme canonique réaliste d'une empreinte.
    ['v1\nm:id:m1\nd:2026-08-12\nt:12.50\nn:2\neau gazeuse 1l\npates 1.5kg', '428feff643b07471f93545a66b2efd432e9b352f6f6ba5d56d8d4c2673cf0f7a'],
  ])('vecteur %#', (entree, attendu) => {
    expect(sha256Hex(entree)).toBe(attendu);
  });
});

describe('calculerEmpreinteTicket', () => {
  const base = () => ({
    magasinId: 'm1',
    magasinNom: 'Leclerc Sormiou',
    dateTicket: '2026-08-12',
    lignes: [
      { libelle: 'EAU GAZEUSE 1L', prix: 1.5, quantite: 2 },
      { libelle: 'PATES 1,5 KG', prix: 2.1, quantite: 1 },
    ],
  });

  it('déterministe : mêmes entrées => même empreinte (hex 64 caractères)', () => {
    const a = calculerEmpreinteTicket(base());
    const b = calculerEmpreinteTicket(base());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("l'ordre des lignes ne change pas l'empreinte", () => {
    const melange = base();
    melange.lignes = [...melange.lignes].reverse();
    expect(calculerEmpreinteTicket(melange)).toBe(calculerEmpreinteTicket(base()));
  });

  it('la normalisation gomme casse/accents/espaces des libellés (même ticket rescanné => même empreinte)', () => {
    const variante = base();
    variante.lignes = [
      { libelle: '  eau Gazeuse 1 L ', prix: 1.5, quantite: 2 },
      { libelle: 'PÂTES 1.5KG', prix: 2.1, quantite: 1 },
    ];
    expect(calculerEmpreinteTicket(variante)).toBe(calculerEmpreinteTicket(base()));
  });

  it('ticket différent => empreinte différente (total, date, magasin, nb de lignes, libellé)', () => {
    const ref = calculerEmpreinteTicket(base());
    const cas = [
      { ...base(), lignes: [{ libelle: 'EAU GAZEUSE 1L', prix: 1.6, quantite: 2 }, base().lignes[1]] }, // total
      { ...base(), dateTicket: '2026-08-13' },                                                          // date
      { ...base(), magasinId: 'm2' },                                                                   // magasin
      { ...base(), lignes: base().lignes.slice(0, 1) },                                                 // nb lignes
      { ...base(), lignes: [{ libelle: 'EAU PLATE 1L', prix: 1.5, quantite: 2 }, base().lignes[1]] },   // libellé
    ];
    for (const c of cas) expect(calculerEmpreinteTicket(c)).not.toBe(ref);
  });

  it("magasin : l'id prime ; sans id, le nom normalisé fait foi (casse indifférente)", () => {
    const sansIdA = { ...base(), magasinId: null, magasinNom: 'LECLERC Sormiou' };
    const sansIdB = { ...base(), magasinId: null, magasinNom: 'leclerc sormiou' };
    expect(calculerEmpreinteTicket(sansIdA)).toBe(calculerEmpreinteTicket(sansIdB));
    expect(calculerEmpreinteTicket(sansIdA)).not.toBe(calculerEmpreinteTicket(base()));
  });

  it('date absente : empreinte stable (jamais « aujourd\'hui »), datetime ISO ramené au jour', () => {
    const sansDate = { ...base(), dateTicket: null };
    expect(calculerEmpreinteTicket(sansDate)).toBe(calculerEmpreinteTicket({ ...base(), dateTicket: undefined }));
    expect(calculerEmpreinteTicket({ ...base(), dateTicket: '2026-08-12T09:15:00.000Z' })).toBe(calculerEmpreinteTicket(base()));
  });

  it('entrées vides ou incomplètes : jamais de plantage', () => {
    expect(calculerEmpreinteTicket()).toMatch(/^[0-9a-f]{64}$/);
    expect(calculerEmpreinteTicket({ lignes: [{ libelle: null, prix: null, quantite: null }] })).toMatch(/^[0-9a-f]{64}$/);
  });
});
