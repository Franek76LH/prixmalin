import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from './supabase';
import {
  chargerPrixComparables,
  construireCiblesComparaison,
  faireCorrespondrePrix,
  regrouperParMagasin,
  calculerTotauxMagasins,
  classerMagasins,
  comparerResultatsLegacyEtCore,
} from './comparateurCore';
import { faireCorrespondrePrixFormatIndifferent } from './comparateurCore';

function cibleBase(overrides) {
  return {
    itemId: 1,
    produit_id: 'p1',
    variante_produit_id: 'v1',
    quantite_nette: 500,
    unite_quantite: 'g',
    nombre_unites: 1,
    item: {},
    ...overrides,
  };
}

function prixBase(overrides) {
  return {
    prix_id: 'px1',
    produit_id: 'p1',
    variante_produit_id: 'vp1',
    magasin_id: 'm1',
    prix_total: 2.5,
    quantite_nette: 500,
    unite_quantite: 'g',
    nombre_unites: 1,
    observe_le: '2026-06-20T00:00:00.000Z',
    latitude: 48.8566,
    longitude: 2.3522,
    nom_enseigne: 'Carrefour',
    nom_magasin: 'Carrefour Rueil',
    ...overrides,
  };
}

function createQueryBuilder(result) {
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

describe('chargerPrixComparables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne [] sans requête si produitIds est vide", async () => {
    const result = await chargerPrixComparables([], { staleCutoffISO: '2026-06-01T00:00:00.000Z' });
    expect(result).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('retourne [] sans requête si produitIds est null/undefined', async () => {
    expect(await chargerPrixComparables(null, {})).toEqual([]);
    expect(await chargerPrixComparables(undefined, {})).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('filtre par produit_id et observe_le et retourne les données', async () => {
    const rows = [{ produit_id: 1, prix_total: 2.5 }];
    const builder = createQueryBuilder({ data: rows, error: null });
    supabase.from.mockReturnValue(builder);

    const result = await chargerPrixComparables([1, 2], { staleCutoffISO: '2026-06-01T00:00:00.000Z' });

    expect(supabase.from).toHaveBeenCalledWith('prix_comparables');
    expect(builder.select).toHaveBeenCalledWith('*');
    expect(builder.in).toHaveBeenCalledWith('produit_id', [1, 2]);
    expect(builder.gte).toHaveBeenCalledWith('observe_le', '2026-06-01T00:00:00.000Z');
    expect(result).toEqual(rows);
  });

  it("n'applique pas gte si staleCutoffISO n'est pas fourni", async () => {
    const builder = createQueryBuilder({ data: [], error: null });
    supabase.from.mockReturnValue(builder);
    await chargerPrixComparables([1], {});
    expect(builder.gte).not.toHaveBeenCalled();
  });

  it('propage une erreur Supabase', async () => {
    const builder = createQueryBuilder({ data: null, error: new Error('boom') });
    supabase.from.mockReturnValue(builder);
    await expect(chargerPrixComparables([1], { staleCutoffISO: '2026-06-01' })).rejects.toThrow('boom');
  });
});

describe('construireCiblesComparaison', () => {
  it('classe un article sans produit_id en legacyOnly', () => {
    const items = [{ id: 1, product: 'Texte libre', produit_id: null }];
    const { cibles, exclusions } = construireCiblesComparaison(items);
    expect(cibles).toEqual([]);
    expect(exclusions.legacyOnly).toEqual(items);
    expect(exclusions.produitIdSansFormat).toEqual([]);
  });

  it('classe un produit_id sans variante résolue en produitIdSansFormat', () => {
    const items = [{ id: 2, produit_id: 'p1', variante_produit_id: null, variante: null }];
    const { cibles, exclusions } = construireCiblesComparaison(items);
    expect(cibles).toEqual([]);
    expect(exclusions.produitIdSansFormat).toEqual(items);
  });

  it('classe un produit_id avec variante mais sans quantite_nette en produitIdSansFormat', () => {
    const items = [{ id: 3, produit_id: 'p1', variante_produit_id: 'v1', variante: { quantite_nette: null, unite_quantite: 'g' } }];
    const { exclusions } = construireCiblesComparaison(items);
    expect(exclusions.produitIdSansFormat).toEqual(items);
  });

  it('classe un produit_id avec variante mais sans unite_quantite en produitIdSansFormat', () => {
    const items = [{ id: 3, produit_id: 'p1', variante_produit_id: 'v1', variante: { quantite_nette: 500, unite_quantite: null } }];
    const { exclusions } = construireCiblesComparaison(items);
    expect(exclusions.produitIdSansFormat).toEqual(items);
  });

  it('classe un article avec format démontrable en cible valide', () => {
    const item = { id: 4, produit_id: 'p1', variante_produit_id: 'v1', variante: { quantite_nette: 500, unite_quantite: 'g', nombre_unites: 1 } };
    const { cibles, exclusions } = construireCiblesComparaison([item]);
    expect(exclusions.legacyOnly).toEqual([]);
    expect(exclusions.produitIdSansFormat).toEqual([]);
    expect(cibles).toEqual([{
      itemId: 4,
      produit_id: 'p1',
      variante_produit_id: 'v1',
      quantite_nette: 500,
      unite_quantite: 'g',
      nombre_unites: 1,
      item,
    }]);
  });

  it('ne mélange jamais deux formats différents pour un même produit_id', () => {
    const items = [
      { id: 5, produit_id: 'p1', variante_produit_id: 'v1', variante: { quantite_nette: 500, unite_quantite: 'g' } },
      { id: 6, produit_id: 'p1', variante_produit_id: 'v2', variante: { quantite_nette: 1000, unite_quantite: 'g' } },
    ];
    const { cibles } = construireCiblesComparaison(items);
    expect(cibles).toHaveLength(2);
    expect(cibles[0].quantite_nette).not.toBe(cibles[1].quantite_nette);
  });

  it('gère une liste vide ou undefined', () => {
    const vide = { cibles: [], exclusions: { legacyOnly: [], produitIdSansFormat: [] } };
    expect(construireCiblesComparaison([])).toEqual(vide);
    expect(construireCiblesComparaison(undefined)).toEqual(vide);
  });
});

describe('faireCorrespondrePrix', () => {
  it('ne retient aucune correspondance si les formats diffèrent (500 g vs 1 kg)', () => {
    const cible = cibleBase();
    const prix = prixBase({ quantite_nette: 1, unite_quantite: 'kg' });
    const [resultat] = faireCorrespondrePrix([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it('retient une correspondance quand les formats normalisés sont identiques (2×250 g == 500 g)', () => {
    const cible = cibleBase();
    const prix = prixBase({ quantite_nette: 250, nombre_unites: 2 });
    const [resultat] = faireCorrespondrePrix([cible], [prix]);
    expect(resultat.correspondances).toEqual([prix]);
  });

  it("ne retient jamais un prix Core sans variante_produit_id, même si produit_id correspond", () => {
    const cible = cibleBase();
    const prix = prixBase({ variante_produit_id: null });
    const [resultat] = faireCorrespondrePrix([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it('exclut un prix hors du rayon de recherche', () => {
    const cible = cibleBase();
    const prixLoin = prixBase({ latitude: 43.2965, longitude: 5.3698 }); // Marseille
    const userPos = { lat: 48.8566, lng: 2.3522 }; // Paris
    const [resultat] = faireCorrespondrePrix([cible], [prixLoin], { userPos, searchRadius: 50 });
    expect(resultat.correspondances).toEqual([]);
  });

  it('inclut un prix situé dans le rayon de recherche', () => {
    const cible = cibleBase();
    const prixProche = prixBase({ latitude: 48.8570, longitude: 2.3530 });
    const userPos = { lat: 48.8566, lng: 2.3522 };
    const [resultat] = faireCorrespondrePrix([cible], [prixProche], { userPos, searchRadius: 5 });
    expect(resultat.correspondances).toEqual([prixProche]);
  });

  it('exclut un prix au-delà de la fraîcheur demandée', () => {
    const cible = cibleBase();
    const prixPerime = prixBase({ observe_le: '2026-04-01T00:00:00.000Z' });
    const [resultat] = faireCorrespondrePrix([cible], [prixPerime], { staleCutoffISO: '2026-06-01T00:00:00.000Z' });
    expect(resultat.correspondances).toEqual([]);
  });

  it('ne compare jamais sur le seul produit_id : un produit différent est toujours exclu', () => {
    const cible = cibleBase({ produit_id: 'p1' });
    const autreProduit = prixBase({ produit_id: 'p2' });
    const [resultat] = faireCorrespondrePrix([cible], [autreProduit]);
    expect(resultat.correspondances).toEqual([]);
  });
});

describe('regrouperParMagasin', () => {
  it('ne garde que l’observation la plus récente pour un même (produit_id + format + magasin_id)', () => {
    const cible = {
      itemId: 1, produit_id: 'p1', unite_quantite: 'g', quantite_nette: 500, nombre_unites: 1,
      correspondances: [
        prixBase({ prix_id: 'ancien', magasin_id: 'm1', observe_le: '2026-06-01T00:00:00.000Z' }),
        prixBase({ prix_id: 'recent', magasin_id: 'm1', observe_le: '2026-06-25T00:00:00.000Z' }),
      ],
    };
    const resultat = regrouperParMagasin([cible]);
    expect(resultat.m1).toHaveLength(1);
    expect(resultat.m1[0].prix.prix_id).toBe('recent');
  });

  it('garde deux magasins distincts même s’ils partagent la même enseigne', () => {
    const cible = {
      itemId: 1, produit_id: 'p1', unite_quantite: 'g', quantite_nette: 500, nombre_unites: 1,
      correspondances: [
        prixBase({ prix_id: 'px-m1', magasin_id: 'm1', nom_enseigne: 'Carrefour' }),
        prixBase({ prix_id: 'px-m2', magasin_id: 'm2', nom_enseigne: 'Carrefour' }),
      ],
    };
    const resultat = regrouperParMagasin([cible]);
    expect(Object.keys(resultat).sort()).toEqual(['m1', 'm2']);
  });
});

describe('calculerTotauxMagasins', () => {
  it('compte 2 articles trouvés + 1 manquant, avec le bon total et le bon article manquant', () => {
    const cibles = [
      { itemId: 1, produit_id: 'p1', item: { qty: 1 } },
      { itemId: 2, produit_id: 'p2', item: { qty: 1 } },
      { itemId: 3, produit_id: 'p3', item: { qty: 1 } },
    ];
    const regroupement = {
      m1: [
        { itemId: 1, produit_id: 'p1', prix: prixBase({ prix_total: 2 }) },
        { itemId: 2, produit_id: 'p2', prix: prixBase({ prix_total: 3 }) },
      ],
    };

    const resultat = calculerTotauxMagasins(regroupement, cibles);

    expect(resultat.m1.found).toBe(2);
    expect(resultat.m1.total).toBe(5);
    expect(resultat.m1.articlesManquants).toEqual([cibles[2]]);
    expect(resultat.m1.articlesTrouves.map(a => a.itemId)).toEqual([1, 2]);
  });

  it('pondère le total par la quantité demandée (item.qty), comme le legacy', () => {
    const cibles = [{ itemId: 1, produit_id: 'p1', item: { qty: 3 } }];
    const regroupement = { m1: [{ itemId: 1, produit_id: 'p1', prix: prixBase({ prix_total: 2 }) }] };

    const resultat = calculerTotauxMagasins(regroupement, cibles);

    expect(resultat.m1.total).toBe(6);
  });
});

describe('classerMagasins', () => {
  it('classe en premier le magasin avec le plus d’articles trouvés, même si son total est plus élevé', () => {
    const totaux = {
      m1: { total: 30, found: 3, articlesTrouves: [], articlesManquants: [] },
      m2: { total: 20, found: 2, articlesTrouves: [], articlesManquants: [] },
    };
    const classement = classerMagasins(totaux);
    expect(classement.map(m => m.magasinId)).toEqual(['m1', 'm2']);
  });

  it('à found égal, classe le moins cher en premier', () => {
    const totaux = {
      m1: { total: 25, found: 2, articlesTrouves: [], articlesManquants: [] },
      m2: { total: 20, found: 2, articlesTrouves: [], articlesManquants: [] },
    };
    const classement = classerMagasins(totaux);
    expect(classement.map(m => m.magasinId)).toEqual(['m2', 'm1']);
  });

  it('à égalité parfaite (found, total), conserve l’ordre d’entrée dans les deux sens', () => {
    const totauxAB = {
      m1: { total: 20, found: 2, articlesTrouves: [], articlesManquants: [] },
      m2: { total: 20, found: 2, articlesTrouves: [], articlesManquants: [] },
    };
    expect(classerMagasins(totauxAB).map(m => m.magasinId)).toEqual(['m1', 'm2']);

    const totauxBA = {
      m2: { total: 20, found: 2, articlesTrouves: [], articlesManquants: [] },
      m1: { total: 20, found: 2, articlesTrouves: [], articlesManquants: [] },
    };
    expect(classerMagasins(totauxBA).map(m => m.magasinId)).toEqual(['m2', 'm1']);
  });

  it('exclut un magasin sans aucun article trouvé (found=0)', () => {
    const totaux = {
      m1: { total: 0, found: 0, articlesTrouves: [], articlesManquants: [] },
      m2: { total: 20, found: 2, articlesTrouves: [], articlesManquants: [] },
    };
    expect(classerMagasins(totaux).map(m => m.magasinId)).toEqual(['m2']);
  });
});

describe('comparerResultatsLegacyEtCore', () => {
  const legacyCarrefour = { best: { id: 'carrefour', name: 'Carrefour', total: 20, found: 2 } };
  const metaBase = { totalItems: 5 };
  const sansExclusions = { legacyOnly: [], produitIdSansFormat: [] };
  const coreVide = { correspondancesBrutes: [], correspondancesFraiches: [], classement: [] };

  it('rapport vide quand ni legacy ni Core ne trouvent rien', () => {
    const rapport = comparerResultatsLegacyEtCore({ best: null }, coreVide, sansExclusions, { totalItems: 0 });
    expect(rapport).toEqual({
      nbArticlesTotal: 0,
      nbArticlesEligiblesCore: 0,
      nbArticlesTrouves: 0,
      nbArticlesManquants: 0,
      nbExclusSansProduitId: 0,
      nbExclusSansFormat: 0,
      nbMagasinsCandidatsCore: 0,
      meilleurLegacy: null,
      meilleurCore: null,
      totalLegacy: null,
      totalCore: null,
      differenceTotale: null,
      raisons: {
        articleNonEligible: 0,
        formatImpossibleAVerifier: 0,
        donneeCoreAbsente: 0,
        prixTropAncien: 0,
        differenceRegroupementEnseigneMagasin: false,
        ecartPrixReel: null,
      },
    });
  });

  it('compte un article legacy_only (sans produit_id) dans articleNonEligible', () => {
    const rapport = comparerResultatsLegacyEtCore(
      legacyCarrefour,
      coreVide,
      { legacyOnly: [{ id: 1, product: 'Pain (texte libre)' }], produitIdSansFormat: [] },
      metaBase,
    );
    expect(rapport.nbExclusSansProduitId).toBe(1);
    expect(rapport.raisons.articleNonEligible).toBe(1);
  });

  it('compte un article sans format démontrable dans formatImpossibleAVerifier', () => {
    const rapport = comparerResultatsLegacyEtCore(
      legacyCarrefour,
      coreVide,
      { legacyOnly: [], produitIdSansFormat: [{ id: 2, produit_id: 'p2' }] },
      metaBase,
    );
    expect(rapport.nbExclusSansFormat).toBe(1);
    expect(rapport.raisons.formatImpossibleAVerifier).toBe(1);
  });

  it('détecte une donnée Core totalement absente (0 correspondance brute) pour un article éligible', () => {
    const core = {
      correspondancesBrutes: [{ itemId: 3, produit_id: 'p3', correspondances: [] }],
      correspondancesFraiches: [{ itemId: 3, produit_id: 'p3', correspondances: [] }],
      classement: [],
    };
    const rapport = comparerResultatsLegacyEtCore(legacyCarrefour, core, sansExclusions, metaBase);
    expect(rapport.nbArticlesEligiblesCore).toBe(1);
    expect(rapport.nbArticlesTrouves).toBe(0);
    expect(rapport.nbArticlesManquants).toBe(1);
    expect(rapport.raisons.donneeCoreAbsente).toBe(1);
    expect(rapport.raisons.prixTropAncien).toBe(0);
  });

  it('détecte un prix Core trop ancien (correspondance brute existante mais filtrée par la fraîcheur)', () => {
    const core = {
      correspondancesBrutes: [{ itemId: 4, produit_id: 'p4', correspondances: [prixBase({ prix_id: 'ancien' }), prixBase({ prix_id: 'ancien2' })] }],
      correspondancesFraiches: [{ itemId: 4, produit_id: 'p4', correspondances: [] }],
      classement: [],
    };
    const rapport = comparerResultatsLegacyEtCore(legacyCarrefour, core, sansExclusions, metaBase);
    expect(rapport.raisons.prixTropAncien).toBe(1);
    expect(rapport.raisons.donneeCoreAbsente).toBe(0);
  });

  it('reconnaît un article Core trouvé (correspondance brute et fraîche présentes)', () => {
    const core = {
      correspondancesBrutes: [{ itemId: 5, produit_id: 'p5', correspondances: [prixBase({ prix_id: 'a' }), prixBase({ prix_id: 'b' })] }],
      correspondancesFraiches: [{ itemId: 5, produit_id: 'p5', correspondances: [prixBase({ prix_id: 'b' })] }],
      classement: [],
    };
    const rapport = comparerResultatsLegacyEtCore(legacyCarrefour, core, sansExclusions, metaBase);
    expect(rapport.nbArticlesTrouves).toBe(1);
    expect(rapport.nbArticlesManquants).toBe(0);
  });

  it('résout le nom du magasin/enseigne depuis le prix imbriqué et attribue un écart de total (enseignes différentes) à un écart de prix réel', () => {
    const core = {
      correspondancesBrutes: [],
      correspondancesFraiches: [],
      classement: [{
        magasinId: 'm1', total: 18, found: 2,
        articlesTrouves: [{ itemId: 5, produit_id: 'p5', prix: prixBase({ nom_enseigne: 'Auchan', nom_magasin: 'Auchan Rueil', prix_total: 9 }) }],
        articlesManquants: [],
      }],
    };
    const rapport = comparerResultatsLegacyEtCore(legacyCarrefour, core, sansExclusions, metaBase);
    expect(rapport.meilleurCore).toEqual({ id: 'm1', nom: 'Auchan Rueil', total: 18 });
    expect(rapport.differenceTotale).toBe(-2);
    expect(rapport.raisons.ecartPrixReel).toBe(-2);
    expect(rapport.raisons.differenceRegroupementEnseigneMagasin).toBe(false);
  });

  it('attribue un écart de total (même enseigne) au regroupement enseigne vs magasin réel', () => {
    const core = {
      correspondancesBrutes: [],
      correspondancesFraiches: [],
      classement: [{
        magasinId: 'm2', total: 22, found: 2,
        articlesTrouves: [{ itemId: 5, produit_id: 'p5', prix: prixBase({ nom_enseigne: 'Carrefour', nom_magasin: 'Carrefour Nanterre' }) }],
        articlesManquants: [],
      }],
    };
    const rapport = comparerResultatsLegacyEtCore(legacyCarrefour, core, sansExclusions, metaBase);
    expect(rapport.differenceTotale).toBe(2);
    expect(rapport.raisons.differenceRegroupementEnseigneMagasin).toBe(true);
    expect(rapport.raisons.ecartPrixReel).toBeNull();
  });

  it('résout le nom du magasin/enseigne via le dictionnaire de référence meta.magasinsRef quand rien n’est imbriqué', () => {
    const core = {
      correspondancesBrutes: [],
      correspondancesFraiches: [],
      classement: [{ magasinId: 'm3', total: 15, found: 1, articlesTrouves: [], articlesManquants: [] }],
    };
    const magasinsRef = { m3: { nom: 'Lidl Colombes', enseigne: 'Lidl' } };
    const rapport = comparerResultatsLegacyEtCore(legacyCarrefour, core, sansExclusions, { ...metaBase, magasinsRef });
    expect(rapport.meilleurCore).toEqual({ id: 'm3', nom: 'Lidl Colombes', total: 15 });
    expect(rapport.raisons.differenceRegroupementEnseigneMagasin).toBe(false);
    expect(rapport.raisons.ecartPrixReel).toBe(-5);
  });

  it('expose toutes les métriques imposées dans un scénario complet', () => {
    const core = {
      correspondancesBrutes: [
        { itemId: 5, produit_id: 'p5', correspondances: [prixBase({ prix_id: 'a' }), prixBase({ prix_id: 'b' })] },
        { itemId: 3, produit_id: 'p3', correspondances: [] },
        { itemId: 4, produit_id: 'p4', correspondances: [prixBase({ prix_id: 'ancien' })] },
      ],
      correspondancesFraiches: [
        { itemId: 5, produit_id: 'p5', correspondances: [prixBase({ prix_id: 'b' })] },
        { itemId: 3, produit_id: 'p3', correspondances: [] },
        { itemId: 4, produit_id: 'p4', correspondances: [] },
      ],
      classement: [
        {
          magasinId: 'm1', total: 22, found: 2,
          articlesTrouves: [{ itemId: 5, produit_id: 'p5', prix: prixBase({ nom_enseigne: 'Carrefour', nom_magasin: 'Carrefour Rueil' }) }],
          articlesManquants: [],
        },
        {
          magasinId: 'm2', total: 25, found: 1,
          articlesTrouves: [{ itemId: 5, produit_id: 'p5', prix: prixBase({ nom_enseigne: 'Lidl', nom_magasin: 'Lidl Nanterre' }) }],
          articlesManquants: [],
        },
      ],
    };
    const exclusions = { legacyOnly: [{ id: 1 }], produitIdSansFormat: [{ id: 2, produit_id: 'p2' }] };
    const rapport = comparerResultatsLegacyEtCore(legacyCarrefour, core, exclusions, { totalItems: 6 });

    expect(Object.keys(rapport).sort()).toEqual([
      'differenceTotale', 'meilleurCore', 'meilleurLegacy', 'nbArticlesEligiblesCore',
      'nbArticlesManquants', 'nbArticlesTotal', 'nbArticlesTrouves', 'nbExclusSansFormat',
      'nbExclusSansProduitId', 'nbMagasinsCandidatsCore', 'raisons', 'totalCore', 'totalLegacy',
    ].sort());
    expect(Object.keys(rapport.raisons).sort()).toEqual([
      'articleNonEligible', 'differenceRegroupementEnseigneMagasin', 'donneeCoreAbsente',
      'ecartPrixReel', 'formatImpossibleAVerifier', 'prixTropAncien',
    ].sort());

    expect(rapport.nbArticlesTotal).toBe(6);
    expect(rapport.nbArticlesEligiblesCore).toBe(3);
    expect(rapport.nbArticlesTrouves).toBe(1);
    expect(rapport.nbArticlesManquants).toBe(2);
    expect(rapport.nbExclusSansProduitId).toBe(1);
    expect(rapport.nbExclusSansFormat).toBe(1);
    expect(rapport.nbMagasinsCandidatsCore).toBe(2);
    expect(rapport.meilleurLegacy).toEqual({ enseigne: 'Carrefour', total: 20 });
    expect(rapport.meilleurCore).toEqual({ id: 'm1', nom: 'Carrefour Rueil', total: 22 });
    expect(rapport.totalLegacy).toBe(20);
    expect(rapport.totalCore).toBe(22);
    expect(rapport.differenceTotale).toBe(2);
    expect(rapport.raisons.differenceRegroupementEnseigneMagasin).toBe(true);
    expect(rapport.raisons.donneeCoreAbsente).toBe(1);
    expect(rapport.raisons.prixTropAncien).toBe(1);
  });
});

describe('faireCorrespondrePrixFormatIndifferent', () => {
  function itemDemontrable(overrides) {
    return {
      id: 1,
      produit_id: 'p1',
      variante_produit_id: 'v1',
      variante: { quantite_nette: 500, unite_quantite: 'g', nombre_unites: 1 },
      ...overrides,
    };
  }

  it('retient une correspondance entre formats différents de même famille (500 g vs 1 kg)', () => {
    const cible = cibleBase({ item: itemDemontrable() });
    const prix = prixBase({ quantite_nette: 1, unite_quantite: 'kg', type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([prix]);
  });

  it("TEST DE NON-RÉGRESSION : faireCorrespondrePrix (mode même format, non modifiée) retourne toujours [] sur le même jeu 500 g vs 1 kg", () => {
    const cible = cibleBase({ item: itemDemontrable() });
    const prix = prixBase({ quantite_nette: 1, unite_quantite: 'kg', type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrix([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it('exclut un produit_id différent, même avec un format compatible', () => {
    const cible = cibleBase({ produit_id: 'p1', item: itemDemontrable() });
    const prix = prixBase({ produit_id: 'p2', quantite_nette: 1, unite_quantite: 'kg', type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it('ne convertit jamais entre poids et volume (g vs L)', () => {
    const cible = cibleBase({ unite_quantite: 'g', quantite_nette: 500, item: itemDemontrable() });
    const prix = prixBase({ unite_quantite: 'l', quantite_nette: 1, type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it('ne compare jamais la famille pièce à poids ou volume', () => {
    const cible = cibleBase({
      unite_quantite: 'piece', quantite_nette: 1, nombre_unites: 6,
      item: itemDemontrable({ variante: { quantite_nette: 1, unite_quantite: 'piece', nombre_unites: 6 } }),
    });
    const prix = prixBase({ unite_quantite: 'g', quantite_nette: 500, type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it('exclut une unité inconnue côté cible, jamais un coefficient par défaut', () => {
    const cible = cibleBase({
      unite_quantite: 'xyz',
      item: itemDemontrable({ variante: { quantite_nette: 500, unite_quantite: 'xyz', nombre_unites: 1 } }),
    });
    const prix = prixBase({ quantite_nette: 1, unite_quantite: 'kg', type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it('exclut une unité inconnue côté prix', () => {
    const cible = cibleBase({ item: itemDemontrable() });
    const prix = prixBase({ unite_quantite: 'xyz', type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it("exclut une incohérence type_unite/unité (produit 'volume' avec un prix en g)", () => {
    const cible = cibleBase({
      unite_quantite: 'l', quantite_nette: 1,
      item: itemDemontrable({ variante: { quantite_nette: 1, unite_quantite: 'l', nombre_unites: 1 } }),
    });
    const prix = prixBase({ unite_quantite: 'g', quantite_nette: 500, type_unite: 'volume' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it("exclut un prix sans variante_produit_id (format non démontrable), même produit_id identique", () => {
    const cible = cibleBase({ item: itemDemontrable() });
    const prix = prixBase({ variante_produit_id: null, quantite_nette: 1, unite_quantite: 'kg', type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it('exclut une cible sans variante démontrable (item sans variante_produit_id)', () => {
    const cible = cibleBase({ item: { produit_id: 'p1', variante_produit_id: null, variante: null } });
    const prix = prixBase({ quantite_nette: 1, unite_quantite: 'kg', type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([]);
  });

  it('retient un lot 4 × 125 g face à un prix affiché en 500 g (même famille, quantités différentes)', () => {
    const cible = cibleBase({
      quantite_nette: 125, nombre_unites: 4, unite_quantite: 'g',
      item: itemDemontrable({ variante: { quantite_nette: 125, unite_quantite: 'g', nombre_unites: 4 } }),
    });
    const prix = prixBase({ quantite_nette: 500, nombre_unites: 1, unite_quantite: 'g', type_unite: 'poids' });
    const [resultat] = faireCorrespondrePrixFormatIndifferent([cible], [prix]);
    expect(resultat.correspondances).toEqual([prix]);
  });

  it('gère une liste de cibles ou de prix vide/undefined', () => {
    expect(faireCorrespondrePrixFormatIndifferent([], [])).toEqual([]);
    expect(faireCorrespondrePrixFormatIndifferent(undefined, undefined)).toEqual([]);
  });
});
