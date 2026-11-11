import { describe, it, expect } from 'vitest';
import { controlerCoherenceTicket, controlerDateTicket } from './coherenceTicket';
import {
  motifsDoute, lectureFragile, dateAbsurde, JOURS_DATE_ABSURDE,
  MOTIF_DOUTE_MONTANT, MOTIF_DOUTE_DIVERGENCE, MOTIF_DOUTE_ARTICLES, MOTIF_DOUTE_DATE,
  FRAGILE_MONTANT_NON_MESURABLE, FRAGILE_DATE_ILLISIBLE, FRAGILE_CONFIANCE_FAIBLE, FRAGILE_LIGNE_SANS_LIBELLE,
} from './lectureDouteuse';

const AUJOURDHUI = new Date('2026-11-11T10:00:00');
const ligne = (prix, extra = {}) => ({ libelle_ticket: 'ARTICLE', name: 'Article', price: prix, total: prix, qty: 1, confiance: 'haute', ...extra });
const analyser = (parsed, lecturesDivergentes = false) => motifsDoute({
  parsed, controle: controlerCoherenceTicket(parsed), controleDate: controlerDateTicket(parsed.date, AUJOURDHUI), lecturesDivergentes,
});

describe('motifsDoute — cas réels du 11/11', () => {
  it('scan raté de 9h33 : 3 lignes inventées qui tombent pile sur un total mal lu, date au 27/04/2013 -> date absurde', () => {
    const parsed = { date: '2013-04-27', total_ticket: 14.63, total_remises: 0, nombre_articles: null,
      products: [ligne(7.05, { name: 'Eau minérale gazeuse' }), ligne(3.77), ligne(3.81)] };
    const { motifs } = analyser(parsed);
    expect(motifs).toContain(MOTIF_DOUTE_DATE);
    expect(motifs).not.toContain(MOTIF_DOUTE_MONTANT); // le total « colle » : c'est bien pour ça qu'il fallait un autre garde-fou
  });

  it('Carrefour lu parfaitement (pas de nombre d\'articles imprimé, 3 lignes faibles sur 9) -> AUCUN doute', () => {
    const produits = [...Array(6)].map(() => ligne(2)).concat([...Array(3)].map(() => ligne(2.79, { confiance: 'faible' })));
    const total = produits.reduce((s, p) => s + p.total, 0);
    const parsed = { date: '2026-11-09', total_ticket: Math.round((total - 2.15) * 100) / 100, total_remises: 2.15, nombre_articles: null, products: produits };
    expect(analyser(parsed).motifs).toEqual([]);
  });

  it('scan réussi de 9h20 (Utile, 6 articles imprimés lus) -> aucun doute', () => {
    const parsed = { date: '2026-11-10', total_ticket: 14.68, total_remises: 0, nombre_articles: 6,
      products: [ligne(1.15), ligne(3.53, { qty: 2, total: 7.06 }), ligne(1.2), ligne(1.89), ligne(3.38)] };
    expect(analyser(parsed).motifs).toEqual([]);
  });
});

describe('nombre d\'articles introuvable sur une lecture fragile', () => {
  const base = { date: '2026-11-10', total_remises: 0, nombre_articles: null, products: [ligne(5), ligne(5)] };

  it('total non lu + nombre d\'articles non lu -> doute', () => {
    const r = analyser({ ...base, total_ticket: null });
    expect(r.motifs).toEqual([MOTIF_DOUTE_ARTICLES]);
    expect(r.raisonsFragilite).toEqual([FRAGILE_MONTANT_NON_MESURABLE]);
  });

  it('remises inconnues + date illisible -> doute, avec les deux raisons', () => {
    const r = analyser({ ...base, total_ticket: 10, total_remises: null, date: null });
    expect(r.motifs).toEqual([MOTIF_DOUTE_ARTICLES]);
    expect(r.raisonsFragilite).toEqual([FRAGILE_MONTANT_NON_MESURABLE, FRAGILE_DATE_ILLISIBLE]);
  });

  it('majorité de lignes faibles, ou une ligne sans texte -> fragile', () => {
    expect(analyser({ ...base, total_ticket: 10, products: [ligne(5, { confiance: 'faible' }), ligne(5, { confiance: 'faible' })] }).raisonsFragilite).toEqual([FRAGILE_CONFIANCE_FAIBLE]);
    expect(analyser({ ...base, total_ticket: 10, products: [ligne(5), ligne(5, { libelle_ticket: '' })] }).raisonsFragilite).toEqual([FRAGILE_LIGNE_SANS_LIBELLE]);
  });

  it('lecture fragile MAIS nombre d\'articles lu -> pas ce motif', () => {
    expect(analyser({ ...base, total_ticket: null, nombre_articles: 2 }).motifs).not.toContain(MOTIF_DOUTE_ARTICLES);
  });

  it('nombre d\'articles absent mais lecture solide -> rien', () => {
    expect(analyser({ ...base, total_ticket: 10 }).motifs).toEqual([]);
  });

  it('robuste : entrées vides, jamais d\'exception', () => {
    expect(lectureFragile(null, null, null)).toEqual({ fragile: true, raisons: [FRAGILE_DATE_ILLISIBLE] });
    expect(motifsDoute()).toEqual({ motifs: [], raisonsFragilite: [FRAGILE_DATE_ILLISIBLE], lignesIncoherentes: [] });
  });
});

describe('date absurde', () => {
  const d = (iso) => controlerDateTicket(iso, AUJOURDHUI);
  it('futur -> absurde ; plus d\'un an -> absurde', () => {
    expect(dateAbsurde(d('2026-11-12'))).toBe(true);
    expect(dateAbsurde(d('2013-04-27'))).toBe(true);
    expect(dateAbsurde(d('2025-11-10'))).toBe(true);
  });
  it('entre 90 jours et un an : seulement « à confirmer » (108), pas absurde', () => {
    expect(d('2026-06-01').suspecte).toBe(true);
    expect(dateAbsurde(d('2026-06-01'))).toBe(false);
    expect(dateAbsurde(d('2025-11-12'))).toBe(false);
  });
  it('date récente ou illisible -> pas absurde', () => {
    expect(dateAbsurde(d('2026-11-10'))).toBe(false);
    expect(dateAbsurde(d(null))).toBe(false);
    expect(JOURS_DATE_ABSURDE).toBe(365);
  });
});

describe('motifs combinés, dans l\'ordre d\'affichage', () => {
  it('montant + divergence + date', () => {
    const parsed = { date: '2030-01-01', total_ticket: 10, total_remises: 0, nombre_articles: 2, products: [ligne(5), ligne(5.5)] };
    expect(analyser(parsed, true).motifs).toEqual([MOTIF_DOUTE_MONTANT, MOTIF_DOUTE_DIVERGENCE, MOTIF_DOUTE_DATE]);
  });
});

// Correctif 9h58 — contrôles ligne par ligne.
import { ligneIncoherente, lignesIncoherentes, comparerLectures, MOTIF_DOUTE_LIGNE } from './lectureDouteuse';

describe('ligne incohérente : quantité × prix ≠ total', () => {
  it('cas réel 9h58 : Leffe 3 × 1,69 avec un total de 7,06 -> incohérente', () => {
    expect(ligneIncoherente({ qty: 3, unit_price: 1.69, price: 1.69, total: 7.06 })).toBe(true);
    expect(ligneIncoherente({ qty: 1, unit_price: 1.18, total: 7.06 })).toBe(true);
    expect(ligneIncoherente({ qty: 3, unit_price: 2.35, total: 7.06 })).toBe(true); // 7,05 ≠ 7,06
  });
  it('lignes justes, y compris au poids (arrondi au centime) -> cohérentes', () => {
    expect(ligneIncoherente({ qty: 2, unit_price: 3.53, total: 7.06 })).toBe(false);
    expect(ligneIncoherente({ qty: 1, price: 1.65, total: 1.65 })).toBe(false);
    expect(ligneIncoherente({ qty: 0.456, unit_price: 3.99, total: 1.82 })).toBe(false);
    expect(ligneIncoherente({ qty: 3, price: 0.1, total: 0.3 })).toBe(false); // 0,1 × 3 en virgule flottante
  });
  it('chiffre absent -> rien à signaler (une absence n\'est pas une anomalie)', () => {
    expect(ligneIncoherente({ qty: 2, price: 3.53 })).toBe(false);
    expect(ligneIncoherente({ total: 7.06 })).toBe(false);
    expect(ligneIncoherente(null)).toBe(false);
  });
  it('motif ajouté avec le détail des lignes', () => {
    const parsed = { date: '2026-11-10', total_ticket: 8.71, total_remises: 0, nombre_articles: 6,
      products: [ligne(1.65), { libelle_ticket: 'B B/BLDE LEFFE', name: 'Bière', qty: 3, unit_price: 1.69, price: 1.69, total: 7.06, confiance: 'haute' }] };
    const r = analyser(parsed);
    expect(r.motifs).toContain(MOTIF_DOUTE_LIGNE);
    expect(r.lignesIncoherentes).toEqual([{ i: 1, libelle: 'B B/BLDE LEFFE', qty: 3, prix: 1.69, total: 7.06 }]);
    expect(lignesIncoherentes({ products: [ligne(1)] })).toEqual([]);
  });
});

describe('comparerLectures : deux lectures, ligne à ligne', () => {
  const L = (...lignes) => ({ products: lignes });
  it('identiques -> aucun écart', () => {
    expect(comparerLectures(L(ligne(1.65), ligne(0.75)), L(ligne(1.65), ligne(0.75)))).toEqual([]);
  });
  it('cas réel 9h58 : même nombre de lignes, Leffe 3 × 1,69 contre 1 × 7,06 -> 1 écart', () => {
    const a = L(ligne(1.65), { libelle_ticket: 'LEFFE', qty: 3, unit_price: 1.69, total: 7.06 });
    const b = L(ligne(1.65), { libelle_ticket: 'LEFFE', qty: 1, unit_price: 7.06, total: 7.06 });
    expect(comparerLectures(a, b)).toEqual([{ i: 1, libelle: 'LEFFE', a: { qty: 3, prix: 1.69, total: 7.06 }, b: { qty: 1, prix: 7.06, total: 7.06 } }]);
  });
  it('une ligne en plus d\'un côté -> écart sur cette ligne', () => {
    const e = comparerLectures(L(ligne(1)), L(ligne(1), ligne(2)));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ i: 1, a: null });
  });
  // Correctif 10h36 — le texte de caisse est comparé aussi, mais les petites
  // variations d'une lecture à l'autre ne doivent JAMAIS alerter.
  it('petites variations du texte de caisse (lettre TVA, ø/a/p, BLDE/BLONDE) -> pas un écart', () => {
    const ligneTxt = (t) => ({ libelle_ticket: t, qty: 2, unit_price: 3.53, total: 7.06 });
    const variantes = [
      ['A 1X COLA ZERO U PET', '1X COLA ZERO U PET'],
      ['B B/BLDE LEFFE RITUEL 9ø BT 50CL', 'B/BLDE LEFFE RITUEL 9a BT 50CL'],
      ['B B/BLDE LEFFE RITUEL 9p BT 50CL', 'B/BLONDE LEFF RITUEL 9ø BI 50CL'],
      ['A 1X CHOC.MENAGE LT/N', '1X CHOC MENAGE'],
      ['A 1X EMMENTAL RAPE 29', '1X EMMENTAL RAPE 2G'],
    ];
    for (const [x, y] of variantes) expect(comparerLectures(L(ligneTxt(x)), L(ligneTxt(y)))).toEqual([]);
  });

  it('cas réel 10h36 : Leffe lue « VITTEL » avec les mêmes chiffres -> écart, textes fournis', () => {
    const ligneTxt = (t) => ({ libelle_ticket: t, qty: 2, unit_price: 3.53, total: 7.06 });
    const e = comparerLectures(L(ligne(1.65), ligneTxt('B/BLONDE LEFF RITUEL 9ø BI 50CL')), L(ligne(1.65), ligneTxt('B/BLUE VITTEL RITUEL 9a BI 50CL')));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ i: 1, texteA: 'B/BLONDE LEFF RITUEL 9ø BI 50CL', texteB: 'B/BLUE VITTEL RITUEL 9a BI 50CL' });
  });

  it('texte absent d\'un côté -> pas un écart de texte (une absence n\'est pas une anomalie)', () => {
    expect(comparerLectures(L({ libelle_ticket: '', qty: 1, price: 2, total: 2 }), L({ libelle_ticket: 'PAIN', qty: 1, price: 2, total: 2 }))).toEqual([]);
  });
});

import { normaliserTexteCaisse, textesCaisseDifferents, SEUIL_TEXTE_DIFFERENT } from './lectureDouteuse';
describe('texte de caisse', () => {
  it('normalisation : lettre TVA en tête, accents, ponctuation et signes retirés', () => {
    expect(normaliserTexteCaisse('A 1X COLA ZERO U PET')).toBe('1x cola zero u pet');
    expect(normaliserTexteCaisse('B B/BLDE LEFFE RITUEL 9ø BT 50CL')).toBe('b blde leffe rituel 9 bt 50cl');
    expect(normaliserTexteCaisse('B/BLDE LEFFE RITUEL 9ø BT 50CL')).toBe('b blde leffe rituel 9 bt 50cl');
    expect(normaliserTexteCaisse('Crème fraîche')).toBe('creme fraiche');
    expect(normaliserTexteCaisse(null)).toBe('');
  });
  it('seuil 0,5 : Leffe/Vittel différents, Leffe/Leff semblables', () => {
    expect(SEUIL_TEXTE_DIFFERENT).toBe(0.5);
    expect(textesCaisseDifferents('B B/BLDE LEFFE RITUEL 9ø BT 50CL', 'B/BLUE VITTEL RITUEL 9a BI 50CL')).toBe(true);
    expect(textesCaisseDifferents('B B/BLDE LEFFE RITUEL 9ø BT 50CL', 'B/BLONDE LEFF RITUEL 9ø BI 50CL')).toBe(false);
    expect(textesCaisseDifferents('1X BISCUITS CIGARET', '1X COLA ZERO U PET')).toBe(true);
  });
});
