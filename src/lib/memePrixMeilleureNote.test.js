import { describe, it, expect } from 'vitest';
import { preparerReleves, trouverAlternatives, libelleMarque, ageReleve, formaterParUnite, lireRefus, ajouterRefus } from './memePrixMeilleureNote';

const r = (o) => ({ produit_id: 'chips', magasin_id: 'm1', nom_enseigne: 'Leclerc', unite_quantite: 'g', quantite_fiable: true, observe_le: '2026-07-01T10:00:00Z', ...o });

const RELEVES = [
  r({ variante_produit_id: 'lays150', nutri_score: 'D', prix_total: 2.07, quantite_nette: 150, nom_marque: "Lay's" }),
  r({ variante_produit_id: 'mdd350', nutri_score: 'C', prix_total: 1.74, quantite_nette: 350, nom_marque: "Pom'Lisse", est_mdd: true }),
  r({ variante_produit_id: 'bio', nutri_score: 'B', prix_total: 4.5, quantite_nette: 150, nom_marque: 'Bio Village', est_mdd: true }),
];
const item = (o) => ({ id: 1, product: 'Chips nature', produit_id: 'chips', variante_produit_id: 'lays150', checked: false, ...o });

describe('memePrixMeilleureNote', () => {
  it('propose le format mieux noté et pas plus cher au kilo, dans le même magasin', () => {
    const p = trouverAlternatives([item()], preparerReleves(RELEVES));
    expect(p).toHaveLength(1);
    expect(p[0].alternative.variante_produit_id).toBe('mdd350'); // le B est trop cher (30 €/kg)
    expect(p[0].alternative.lettre).toBe('C');
    expect(p[0].enseigne ?? p[0].alternative.enseigne).toBe('Leclerc');
  });

  it("n'utilise jamais un prix d'un autre magasin", () => {
    const releves = preparerReleves([RELEVES[0], { ...RELEVES[1], magasin_id: 'm2' }]);
    expect(trouverAlternatives([item()], releves)).toEqual([]);
  });

  it('accepte 5 % plus cher au kilo, pas davantage', () => {
    const base = r({ variante_produit_id: 'a', nutri_score: 'D', prix_total: 1, quantite_nette: 100 });
    const ok = r({ variante_produit_id: 'b', nutri_score: 'B', prix_total: 1.05, quantite_nette: 100 });
    const trop = r({ variante_produit_id: 'b', nutri_score: 'B', prix_total: 1.06, quantite_nette: 100 });
    expect(trouverAlternatives([item({ variante_produit_id: 'a' })], preparerReleves([base, ok]))).toHaveLength(1);
    expect(trouverAlternatives([item({ variante_produit_id: 'a' })], preparerReleves([base, trop]))).toHaveLength(0);
  });

  it('rien sans lettre pour le format choisi, ni pour une autre fiche', () => {
    const sansNote = preparerReleves([{ ...RELEVES[0], nutri_score: null }, RELEVES[1]]);
    expect(trouverAlternatives([item()], sansNote)).toEqual([]);
    const autreFiche = preparerReleves([RELEVES[0], { ...RELEVES[1], produit_id: 'chips-aromatisees' }]);
    expect(trouverAlternatives([item()], autreFiche)).toEqual([]);
  });

  it('écarte les quantités douteuses, les poids comparés à des litres, les lignes cochées ou sans format', () => {
    expect(trouverAlternatives([item()], preparerReleves([RELEVES[0], { ...RELEVES[1], quantite_fiable: false }]))).toEqual([]);
    expect(trouverAlternatives([item()], preparerReleves([RELEVES[0], { ...RELEVES[1], unite_quantite: 'ml' }]))).toEqual([]);
    expect(trouverAlternatives([item({ checked: true })], preparerReleves(RELEVES))).toEqual([]);
    expect(trouverAlternatives([item({ variante_produit_id: null })], preparerReleves(RELEVES))).toEqual([]);
  });

  it('ne propose pas un format déjà dans la liste, ni un format refusé', () => {
    const releves = preparerReleves(RELEVES);
    expect(trouverAlternatives([item(), item({ id: 2, variante_produit_id: 'mdd350' })], releves).map(p => p.item.id)).not.toContain(1);
    expect(trouverAlternatives([item()], releves, { refus: new Set(['lays150>mdd350']) })).toEqual([]);
  });

  it('garde le relevé le plus récent par format et par magasin', () => {
    const vieux = { ...RELEVES[1], prix_total: 1.0, observe_le: '2026-01-01T00:00:00Z' };
    const releves = preparerReleves([RELEVES[0], vieux, RELEVES[1]]);
    expect(releves.find(x => x.variante_produit_id === 'mdd350').prix).toBe(1.74);
  });

  it('classe par écart de lettre et limite à 3', () => {
    const lignes = [];
    const items = [];
    for (let k = 0; k < 5; k++) {
      lignes.push(r({ produit_id: `p${k}`, variante_produit_id: `x${k}`, nutri_score: k < 2 ? 'E' : 'C', prix_total: 2, quantite_nette: 100 }));
      lignes.push(r({ produit_id: `p${k}`, variante_produit_id: `y${k}`, nutri_score: 'A', prix_total: 1, quantite_nette: 100 }));
      items.push(item({ id: k, produit_id: `p${k}`, variante_produit_id: `x${k}` }));
    }
    const p = trouverAlternatives(items, preparerReleves(lignes));
    expect(p).toHaveLength(3);
    expect(p[0].actuel.lettre).toBe('E');
    expect(p[1].actuel.lettre).toBe('E');
  });

  it('ne nomme jamais une marque distributeur', () => {
    expect(libelleMarque({ est_mdd: true, nom_marque: 'Eco+' })).toBe('Marque distributeur');
    expect(libelleMarque({ est_mdd: false, nom_marque: 'Panzani' })).toBe('Panzani');
  });

  it("dit l'âge des prix et formate le prix au kilo", () => {
    const now = new Date('2026-11-26T12:00:00Z').getTime();
    expect(ageReleve(new Date('2026-11-20T00:00:00Z').getTime(), now)).toBe('ce mois-ci');
    expect(ageReleve(new Date('2026-07-01T00:00:00Z').getTime(), now)).toBe('il y a 4 mois');
    expect(formaterParUnite(4.971, 'kg')).toBe('4,97 €/kg');
    expect(formaterParUnite(1.2, 'l')).toBe('1,20 €/L');
  });

  it('retient les refus, même si le stockage est indisponible', () => {
    const memoire = {};
    const st = { getItem: k => memoire[k] ?? null, setItem: (k, v) => { memoire[k] = v; } };
    ajouterRefus('a>b', st);
    expect(lireRefus(st).has('a>b')).toBe(true);
    const casse = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(lireRefus(casse).size).toBe(0);
    expect(() => ajouterRefus('a>b', casse)).not.toThrow();
  });
});
