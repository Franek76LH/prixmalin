import { describe, it, expect } from 'vitest';
import { candidatsCodeBarres, chercherProduitParCodeBarres } from './rechercheCodeBarres';

// Petit client factice : tables en dur, filtres eq / in.
function client(tables, { erreur = null } = {}) {
  return {
    from(t) {
      let rows = tables[t] || [];
      const b = {
        select() { return b; }, limit() { return b; },
        in(c, v) { rows = rows.filter(r => v.includes(r[c])); return b; },
        eq(c, v) { rows = rows.filter(r => r[c] === v); return b; },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: erreur }); },
        then(res) { return Promise.resolve({ data: rows, error: erreur }).then(res); },
      };
      return b;
    },
  };
}

describe('chantier 164 — codes à essayer', () => {
  it('espaces retirés, zéros gardés, UPC-A <-> EAN-13', () => {
    expect(candidatsCodeBarres(' 3017 620422003 ')).toEqual(['3017620422003']);
    expect(candidatsCodeBarres('012345678905')).toEqual(['012345678905', '0012345678905']);
    expect(candidatsCodeBarres('0012345678905')).toEqual(['0012345678905', '012345678905']);
    expect(candidatsCodeBarres('')).toEqual([]);
  });
});

describe('chantier 164 — recherche par code-barres (lecture seule)', () => {
  const tables = {
    codes_barres_variante: [{ variante_produit_id: 'v1', code_barres: '3017620422003' }, { variante_produit_id: 'v2', code_barres: '111' }],
    variantes_produit: [
      { id: 'v1', produit_id: 'p1', libelle: 'Nutella 400 g', actif: true, produits: { nom_reference: 'Pâte à tartiner' } },
      { id: 'v2', produit_id: 'p2', libelle: 'Ancien', actif: false, produits: { nom_reference: 'X' } },
    ],
  };
  it('code connu → la bonne variante et sa fiche', async () => {
    const r = await chercherProduitParCodeBarres(client(tables), '3017620422003');
    expect(r.statut).toBe('trouve');
    expect(r.variante).toMatchObject({ id: 'v1', produit_id: 'p1' });
  });
  it('code inconnu, ou variante désactivée → inconnu', async () => {
    expect((await chercherProduitParCodeBarres(client(tables), '999')).statut).toBe('inconnu');
    expect((await chercherProduitParCodeBarres(client(tables), '111')).statut).toBe('inconnu');
  });
  it('erreur de lecture → erreur (jamais « inconnu » à tort)', async () => {
    expect((await chercherProduitParCodeBarres(client(tables, { erreur: { message: 'x' } }), '3017620422003')).statut).toBe('erreur');
  });
});
