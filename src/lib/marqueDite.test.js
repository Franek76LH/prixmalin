import { describe, it, expect } from 'vitest';
import { marqueEstDite, varianteDite, choisirVarianteDite, compterAchatsVariantes, memeMarque } from './marqueDite';

const V = (id, marque, libelle, extra = {}) => ({ id, marque, est_mdd: false, libelle, quantite_nette: 500, unite_quantite: 'ml', ...extra });
const BIERES = [
  V('86-original', '8.6', 'Original blonde intense 8,6%'),
  V('86-extreme', '8.6', 'Extreme 50 cl'),
  V('leffe', 'Leffe', 'Blonde 50 cl'),
  V('sans-marque', null, 'Bière 50 cl'),
];

describe('marque dite au micro', () => {
  it('reconnaît une marque dite en mot entier, accents et tirets ignorés', () => {
    expect(marqueEstDite('bière 8.6 Original', '8.6')).toBe(true);
    expect(marqueEstDite('du coca cola zéro', 'Coca-Cola')).toBe(true);
    expect(marqueEstDite('camembert président', 'Président')).toBe(true);
    expect(marqueEstDite('des karaokés', 'Kara')).toBe(false);
    expect(marqueEstDite('bière 18.60', '8.6')).toBe(false);
    expect(marqueEstDite('bière', '')).toBe(false);
  });
  it('le cas de François : « bière 8.6 Original » -> la 8.6 Original', () => {
    expect(varianteDite('bière 8.6 Original', BIERES)).toMatchObject({ marque: '8.6', variante: { id: '86-original' } });
  });
  it('une marque à un seul format : choisie directement', () => {
    expect(varianteDite('une Leffe', BIERES)).toMatchObject({ marque: 'Leffe', variante: { id: 'leffe' } });
  });
  it('aucune marque dite : rien (on reste sur la fiche)', () => {
    expect(varianteDite('de la bière', BIERES)).toBeNull();
    expect(varianteDite('bière', [])).toBeNull();
    expect(varianteDite('bière', null)).toBeNull();
  });
  it('marque dite mais plusieurs formats possibles : pas de pari', () => {
    expect(varianteDite('bière 8.6', BIERES)).toEqual({ marque: '8.6', variante: null, marque_id: null });
  });
  it('…sauf si l\'habitude d\'achat désigne un seul format', () => {
    expect(varianteDite('bière 8.6', BIERES, { achatsVariantes: { '86-extreme': 3 } })).toMatchObject({ variante: { id: '86-extreme' } });
    expect(varianteDite('bière 8.6', BIERES, { achatsVariantes: { '86-extreme': 2, '86-original': 2 } }).variante).toBeNull();
  });
  it('deux marques dites : on ne tranche pas', () => {
    expect(varianteDite('bière 8.6 ou Leffe', BIERES)).toBeNull();
  });
  it('jamais une marque de distributeur, jamais une variante sans format', () => {
    expect(varianteDite('sauce bio village', [V('mdd', 'Bio Village', 'Bolognaise', { est_mdd: true })])).toBeNull();
    expect(varianteDite('une Leffe', [V('x', 'Leffe', 'Blonde', { quantite_nette: null })])).toBeNull();
  });
  it('compte les achats par variante', () => {
    expect(compterAchatsVariantes([{ variante_produit_id: 'a' }, { variante_produit_id: 'a' }, { variante_produit_id: null }, null])).toEqual({ a: 2 });
    expect(compterAchatsVariantes(null)).toEqual({});
  });
});

describe('marque dite rangée dans une fiche voisine', () => {
  const F = (v, produit_id, produit_nom) => ({ ...v, produit_id, produit_nom });
  const RAYON = [
    F(V('86-original', '8.6', 'Original blonde intense 8,6%'), 'biere', 'Bière'),
    F(V('86-extreme', '8.6', 'Extreme 50 cl'), 'biere', 'Bière'),
    F(V('leffe', 'Leffe', 'Rituel 9°'), 'blonde', 'Bière blonde'),
    F(V('1664', '1664', null), 'blonde', 'Bière blonde'),
    F(V('heinz-ketchup', 'Heinz', 'Tomato'), 'ketchup', 'Ketchup'),
  ];
  const BIERE = { produit_id: 'biere', produit_nom: 'Bière' };
  it('marque de la fiche reliée : on reste dessus', () => {
    expect(choisirVarianteDite('bière 8.6 Original', BIERE, RAYON)).toMatchObject({ produit_id: 'biere', autreFiche: false, variante: { id: '86-original' } });
  });
  it('« bière Leffe » reliée à Bière -> la Leffe de « Bière blonde »', () => {
    expect(choisirVarianteDite('bière Leffe', BIERE, RAYON)).toMatchObject({ produit_id: 'blonde', produit_nom: 'Bière blonde', marque: 'Leffe', autreFiche: true, variante: { id: 'leffe' } });
    expect(choisirVarianteDite('bière 1664', BIERE, RAYON)).toMatchObject({ produit_id: 'blonde', marque: '1664' });
  });
  it('marque de la fiche reliée mais format indécis : on ne va pas voir ailleurs', () => {
    expect(choisirVarianteDite('bière 8.6', BIERE, RAYON)).toBeNull(); // marque sans identifiant connu
  });
  it('chantier 204 — format indécis, marque connue : « cette marque, tous formats »', () => {
    const avecId = RAYON.map(v => ({ ...v, marque_id: v.marque ? `m-${v.marque}` : null }));
    expect(choisirVarianteDite('bière 8.6', BIERE, avecId)).toMatchObject({ variante: null, marque: '8.6', marque_id: 'm-8.6', produit_id: 'biere', tousFormats: true });
    expect(choisirVarianteDite('bière 8.6 Original', BIERE, avecId)).toMatchObject({ variante: { id: '86-original' }, marque_id: 'm-8.6' });
  });
  it('aucune marque dite, ou marque inconnue de la base : rien', () => {
    expect(choisirVarianteDite('de la bière', BIERE, RAYON)).toBeNull();
    expect(choisirVarianteDite('bière Heineken', BIERE, RAYON)).toBeNull();
  });
  it('jamais vers un produit sans rapport, même rayon et même marque', () => {
    expect(choisirVarianteDite('sauce barbecue Heinz', { produit_id: 'bbq', produit_nom: 'Sauce barbecue' }, RAYON)).toBeNull();
  });
  it('entrées abîmées : rien, sans plantage', () => {
    expect(choisirVarianteDite('bière Leffe', null, RAYON)).toMatchObject({ produit_id: 'blonde' });
    expect(choisirVarianteDite('bière Leffe', BIERE, null)).toBeNull();
  });
});

describe('chantier 204 — même marque', () => {
  it('ignore accents, casse et ponctuation ; jamais vrai sur du vide', () => {
    expect(memeMarque('Coca-Cola', 'coca cola')).toBe(true);
    expect(memeMarque('8.6', '8.6')).toBe(true);
    expect(memeMarque('Leffe', '8.6')).toBe(false);
    expect(memeMarque(null, '8.6')).toBe(false);
    expect(memeMarque('', '')).toBe(false);
  });
});
