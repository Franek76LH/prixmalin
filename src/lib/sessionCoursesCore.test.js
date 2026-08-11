import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from './supabase';
import {
  RAYON_AUTRES,
  emojiRayon,
  chargerRayonsProduits,
  assemblerNomArticle,
  construireArticlesSession,
  construireSessionCourses,
  grouperParRayon,
  calculerProgression,
} from './sessionCoursesCore';

const RAYON_EPICERIE = {
  categorie_nom: 'Épicerie salée',
  categorie_slug: 'epicerie-salee',
  categorie_ordre: 5,
  sous_categorie_nom: 'Chips & tuiles',
};

const RAYON_FRUITS = {
  categorie_nom: 'Fruits & légumes',
  categorie_slug: 'fruits-legumes',
  categorie_ordre: 1,
  sous_categorie_nom: 'Fruits frais',
};

// Item du caddie, forme mapperLigneListeCourses (catalogueCore).
function itemBase(overrides) {
  return {
    id: 'lc1',
    product: 'Chips aromatisées',
    qty: 1,
    format: '120 g',
    formatDisplay: '120 g',
    checked: false,
    produit_id: 'p1',
    variante_produit_id: 'v-caddie',
    produit: { id: 'p1', nom_reference: 'Chips aromatisées' },
    variante: { libelle: '', quantite_nette: 120, unite_quantite: 'g', nombre_unites: 1 },
    ...overrides,
  };
}

// Ligne prix_comparables retenue par le comparateur pour le magasin choisi.
function prixBase(overrides) {
  return {
    produit_id: 'p1',
    variante_produit_id: 'v-prix',
    prix_total: 1.85,
    quantite_nette: 120,
    unite_quantite: 'g',
    nombre_unites: 1,
    nom_produit: 'Chips aromatisées',
    nom_marque: "Lay's",
    est_mdd: false,
    ...overrides,
  };
}

describe('assemblerNomArticle', () => {
  it("assemble nom + marque + format depuis les champs réels", () => {
    expect(assemblerNomArticle({
      nom_reference: 'Chips aromatisées', nom_marque: "Lay's", est_mdd: false, format_libelle: '120 g',
    })).toBe("Chips aromatisées Lay's 120 g");
  });

  it("n'affiche jamais la sous-marque distributeur (règle Chantier 84)", () => {
    expect(assemblerNomArticle({
      nom_reference: 'Riz basmati', nom_marque: 'Marque Repère', est_mdd: true, format_libelle: '1 kg',
    })).toBe('Riz basmati 1 kg');
  });

  it('tient sans marque ni format', () => {
    expect(assemblerNomArticle({ nom_reference: 'Sopalin', nom_marque: null, est_mdd: false, format_libelle: '' }))
      .toBe('Sopalin');
  });
});

describe('construireArticlesSession', () => {
  it('fige le produit concret depuis la ligne de prix retenue (marque, format, prix, variante photo)', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [{ itemId: 'lc1', produit_id: 'p1', prix: prixBase() }],
      rayons: new Map([['p1', RAYON_EPICERIE]]),
    });
    expect(articles).toHaveLength(1);
    const a = articles[0];
    expect(a.nom_affiche).toBe("Chips aromatisées Lay's 120 g");
    expect(a.prix_prevu).toBe(1.85);
    expect(a.variante_produit_id).toBe('v-prix'); // variante du PRIX retenu, pas celle du caddie
    expect(a.rayon).toEqual(RAYON_EPICERIE);
    expect(a.etat).toBe('a_prendre');
    expect(a.type).toBe('caddie');
    expect(a.cle).toBe('lc1');
  });

  it("conserve un article sans prix dans ce magasin (prix_prevu null, jamais écarté)", () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [],
      rayons: new Map([['p1', RAYON_EPICERIE]]),
    });
    const a = articles[0];
    expect(a.prix_prevu).toBeNull();
    expect(a.variante_produit_id).toBe('v-caddie'); // repli : variante du caddie
    expect(a.format_libelle).toBe('120 g');
    expect(a.nom_affiche).toBe('Chips aromatisées 120 g'); // pas de marque connue
  });

  it('badge MDD : marque retirée du nom, est_mdd conservé pour le badge générique', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [{ itemId: 'lc1', produit_id: 'p1', prix: prixBase({ nom_marque: 'Marque Repère', est_mdd: true }) }],
      rayons: new Map([['p1', RAYON_EPICERIE]]),
    });
    expect(articles[0].nom_marque).toBeNull();
    expect(articles[0].est_mdd).toBe(true);
    expect(articles[0].nom_affiche).toBe('Chips aromatisées 120 g');
  });

  it('article en texte libre : rayon « Autres articles », pas de photo, pas de prix', () => {
    const articles = construireArticlesSession({
      items: [itemBase({ id: 'lc2', product: 'Sopalin', produit_id: null, variante_produit_id: null, produit: null, variante: null, format: '', formatDisplay: '' })],
      lignesPrix: [],
      rayons: new Map(),
    });
    const a = articles[0];
    expect(a.rayon).toEqual(RAYON_AUTRES);
    expect(a.nom_affiche).toBe('Sopalin');
    expect(a.prix_prevu).toBeNull();
    expect(a.variante_produit_id).toBeNull();
  });

  it('« Format indifférent » (repli caddie) ne fuit jamais dans le nom assemblé', () => {
    const articles = construireArticlesSession({
      items: [itemBase({ variante: null, variante_produit_id: null, format: '', formatDisplay: 'Format indifférent' })],
      lignesPrix: [],
      rayons: new Map([['p1', RAYON_EPICERIE]]),
    });
    expect(articles[0].format_libelle).toBe('');
    expect(articles[0].nom_affiche).toBe('Chips aromatisées');
  });

  it('rayon inconnu pour un produit -> repli « Autres articles »', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [],
      rayons: new Map(), // rayon non résolu
    });
    expect(articles[0].rayon).toEqual(RAYON_AUTRES);
  });

  it('quantité invalide -> 1 (jamais 0 ni NaN)', () => {
    const articles = construireArticlesSession({
      items: [itemBase({ qty: undefined })],
      lignesPrix: [],
      rayons: new Map(),
    });
    expect(articles[0].quantite).toBe(1);
  });
});

describe('construireSessionCourses', () => {
  it('produit un document figé version 1, statut active, dates fournies par l’appelant', () => {
    const session = construireSessionCourses({
      utilisateurId: 'u1',
      magasin: { magasin_id: 'm1', nom: 'E.Leclerc Blotzheim', enseigne: 'E.Leclerc', adresse: '2 rue du Rhin', code_postal: '68730', ville: 'Blotzheim' },
      articles: [{ cle: 'lc1' }],
      totalPrevu: 47.2,
      creeLeISO: '2026-08-11T10:00:00.000Z',
    });
    expect(session.version).toBe(1);
    expect(session.statut).toBe('active');
    expect(session.utilisateur_id).toBe('u1');
    expect(session.cree_le).toBe('2026-08-11T10:00:00.000Z');
    expect(session.modifie_le).toBe('2026-08-11T10:00:00.000Z');
    expect(session.magasin.nom).toBe('E.Leclerc Blotzheim');
    expect(session.total_prevu).toBe(47.2);
    expect(session.articles).toHaveLength(1);
  });

  it('total prévu non numérique -> null (jamais NaN)', () => {
    const session = construireSessionCourses({ utilisateurId: 'u1', magasin: null, articles: [], totalPrevu: undefined, creeLeISO: 'x' });
    expect(session.total_prevu).toBeNull();
    expect(session.magasin.nom).toBe('Magasin');
  });
});

describe('grouperParRayon', () => {
  it("trie par ordre_affichage de catégorie, « Autres articles » toujours en dernier", () => {
    const articles = [
      { cle: '1', rayon: RAYON_EPICERIE },
      { cle: '2', rayon: RAYON_AUTRES },
      { cle: '3', rayon: RAYON_FRUITS },
      { cle: '4', rayon: RAYON_EPICERIE },
    ];
    const groupes = grouperParRayon(articles);
    expect(groupes.map(g => g.rayon.categorie_nom)).toEqual(['Fruits & légumes', 'Épicerie salée', 'Autres articles']);
    expect(groupes[1].articles.map(a => a.cle)).toEqual(['1', '4']); // ordre d'entrée conservé
  });

  it('article sans rayon -> groupe « Autres articles »', () => {
    const groupes = grouperParRayon([{ cle: '1', rayon: null }]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].rayon).toEqual(RAYON_AUTRES);
  });
});

describe('calculerProgression', () => {
  it('compte pris / restants / introuvables', () => {
    const prog = calculerProgression([
      { etat: 'au_caddie' }, { etat: 'au_caddie' }, { etat: 'a_prendre' }, { etat: 'introuvable' },
    ]);
    expect(prog).toEqual({ total: 4, pris: 2, introuvables: 1, restants: 1 });
  });

  it('liste vide ou absente -> zéros', () => {
    expect(calculerProgression([])).toEqual({ total: 0, pris: 0, introuvables: 0, restants: 0 });
    expect(calculerProgression(undefined)).toEqual({ total: 0, pris: 0, introuvables: 0, restants: 0 });
  });
});

describe('emojiRayon', () => {
  it('emoji par slug, repli panier pour slug inconnu ou rayon Autres', () => {
    expect(emojiRayon(RAYON_FRUITS)).toBe('🥦');
    expect(emojiRayon(RAYON_AUTRES)).toBe('🧺');
    expect(emojiRayon({ categorie_slug: 'inconnu' })).toBe('🧺');
  });
});

describe('chargerRayonsProduits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aucune requête si la liste est vide', async () => {
    const rayons = await chargerRayonsProduits([]);
    expect(rayons.size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('résout la chaîne produit -> sous-catégorie -> catégorie, ignore une chaîne incomplète', async () => {
    const inMock = vi.fn().mockResolvedValue({
      data: [
        { id: 'p1', sous_categories: { nom: 'Chips & tuiles', categories: { nom: 'Épicerie salée', slug: 'epicerie-salee', ordre_affichage: 5 } } },
        { id: 'p2', sous_categories: null },
      ],
      error: null,
    });
    supabase.from.mockReturnValue({ select: vi.fn().mockReturnValue({ in: inMock }) });

    const rayons = await chargerRayonsProduits(['p1', 'p2', 'p1', null]);
    expect(supabase.from).toHaveBeenCalledWith('produits');
    expect(inMock).toHaveBeenCalledWith('id', ['p1', 'p2']); // dédoublonné, sans null
    expect(rayons.get('p1')).toEqual(RAYON_EPICERIE);
    expect(rayons.has('p2')).toBe(false); // repli RAYON_AUTRES à la charge de l'appelant
  });

  it('erreur Supabase -> throw (l’appelant décide du repli)', async () => {
    const inMock = vi.fn().mockResolvedValue({ data: null, error: new Error('boom') });
    supabase.from.mockReturnValue({ select: vi.fn().mockReturnValue({ in: inMock }) });
    await expect(chargerRayonsProduits(['p1'])).rejects.toThrow('boom');
  });
});
