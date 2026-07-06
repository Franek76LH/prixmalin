import { describe, it, expect } from 'vitest';
import { construirePanierEtMagasins } from './adaptateurPanierPrix';

// Prédicats injectés minimalistes pour les tests : ils reproduisent la forme
// des vrais itemMatchesPrice/estRecent/estDansRayon de CompareTab, sans
// dupliquer leur logique — l'adaptateur ne fait qu'orchestrer ce qu'on lui injecte.
const matchSimple = (item, prix) => item.product === prix.product;
const toujoursRecent = () => true;
const toujoursDansLeRayon = () => true;

describe('construirePanierEtMagasins', () => {
  it('un panier sur 2 magasins physiques distincts d’une même enseigne : bien 2 magasins séparés, prix différents', () => {
    const items = [{ id: 'i1', product: 'Lait', brand: 'Lactel', format: '1L', qty: 1 }];
    const priceDB = [
      { product: 'Lait', brand: 'Lactel', format: '1L', price: 1.2, storeId: 'carrefour', store_id: 's1', store_name: 'Carrefour Rennes', store_address: '1 rue A', date: '2024-01-01' },
      { product: 'Lait', brand: 'Lactel', format: '1L', price: 1.5, storeId: 'carrefour', store_id: 's2', store_name: 'Carrefour Nantes', store_address: '2 rue B', date: '2024-01-01' },
    ];
    const magasinsGeo = [
      { id: 's1', name: 'Carrefour Rennes Centre', enseigne: 'carrefour', latitude: 1, longitude: 1 },
      { id: 's2', name: 'Carrefour Nantes Centre', enseigne: 'carrefour', latitude: 2, longitude: 2 },
    ];

    const resultat = construirePanierEtMagasins({
      items, priceDB, magasinsGeo,
      itemMatchesPrice: matchSimple, estRecent: toujoursRecent, estDansRayon: toujoursDansLeRayon,
    });

    expect(resultat.panier).toEqual([{ articleId: 'i1', libelle: 'Lactel · Lait 1L' }]);
    expect(resultat.magasins).toHaveLength(2);

    const s1 = resultat.magasins.find(m => m.magasinId === 'store_id:s1');
    const s2 = resultat.magasins.find(m => m.magasinId === 'store_id:s2');
    expect(s1).toEqual({ magasinId: 'store_id:s1', magasinNom: 'Carrefour Rennes Centre', prix: [{ articleId: 'i1', prix: 1.2 }] });
    expect(s2).toEqual({ magasinId: 'store_id:s2', magasinNom: 'Carrefour Nantes Centre', prix: [{ articleId: 'i1', prix: 1.5 }] });
    expect(resultat.diagnostics.lignesPrixIgnoreesSansIdentite).toBe(0);
  });

  it('intègre item.qty : le prix retenu est le prix unitaire le plus bas multiplié par qty', () => {
    const items = [{ id: 'i1', product: 'Pommes', qty: 3 }];
    const priceDB = [
      { product: 'Pommes', price: 2, store_id: 's1', store_name: 'Auchan', store_address: '3 rue C', date: '2024-01-01' },
      { product: 'Pommes', price: 3, store_id: 's1', store_name: 'Auchan', store_address: '3 rue C', date: '2024-01-01' }, // même magasin, prix moins bon : ignoré au profit du plus bas
    ];
    const magasinsGeo = [{ id: 's1', name: 'Auchan Centre', enseigne: 'auchan', latitude: 1, longitude: 1 }];

    const resultat = construirePanierEtMagasins({
      items, priceDB, magasinsGeo,
      itemMatchesPrice: matchSimple, estRecent: toujoursRecent, estDansRayon: toujoursDansLeRayon,
    });

    expect(resultat.magasins).toEqual([
      { magasinId: 'store_id:s1', magasinNom: 'Auchan Centre', prix: [{ articleId: 'i1', prix: 6 }] }, // 2 € × 3
    ]);
  });

  it('un prix sans identité magasin exploitable est ignoré et compté dans diagnostics', () => {
    const items = [{ id: 'i1', product: 'Yaourts', qty: 1 }];
    const priceDB = [
      { product: 'Yaourts', price: 2, store_id: null, store_name: '', store_address: '', date: '2024-01-01' }, // aucune identité
      { product: 'Yaourts', price: 2.5, store_id: null, store_name: 'Petit magasin', store_address: '', date: '2024-01-01' }, // nom seul, sans adresse : pas assez fiable
      { product: 'Yaourts', price: 1.8, store_id: 's1', store_name: 'Lidl', store_address: '9 rue D', date: '2024-01-01' },
    ];
    const magasinsGeo = [{ id: 's1', name: 'Lidl Centre', enseigne: 'lidl', latitude: 1, longitude: 1 }];

    const resultat = construirePanierEtMagasins({
      items, priceDB, magasinsGeo,
      itemMatchesPrice: matchSimple, estRecent: toujoursRecent, estDansRayon: toujoursDansLeRayon,
    });

    expect(resultat.magasins).toEqual([
      { magasinId: 'store_id:s1', magasinNom: 'Lidl Centre', prix: [{ articleId: 'i1', prix: 1.8 }] },
    ]);
    expect(resultat.diagnostics.lignesPrixIgnoreesSansIdentite).toBe(2);
  });

  it('ne mute jamais items, priceDB ni magasinsGeo', () => {
    const items = [{ id: 'i1', product: 'Lait', qty: 1 }];
    const priceDB = [{ product: 'Lait', price: 1, store_id: 's1', store_name: 'Carrefour', store_address: '1 rue A', date: '2024-01-01' }];
    const magasinsGeo = [{ id: 's1', name: 'Carrefour Centre', enseigne: 'carrefour', latitude: 1, longitude: 1 }];

    const itemsAvant = JSON.parse(JSON.stringify(items));
    const priceDBAvant = JSON.parse(JSON.stringify(priceDB));
    const magasinsGeoAvant = JSON.parse(JSON.stringify(magasinsGeo));

    construirePanierEtMagasins({
      items, priceDB, magasinsGeo,
      itemMatchesPrice: matchSimple, estRecent: toujoursRecent, estDansRayon: toujoursDansLeRayon,
    });

    expect(items).toEqual(itemsAvant);
    expect(priceDB).toEqual(priceDBAvant);
    expect(magasinsGeo).toEqual(magasinsGeoAvant);
  });
});
