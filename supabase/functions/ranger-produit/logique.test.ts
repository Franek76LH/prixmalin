import { describe, it, expect, vi } from 'vitest';
import {
  lireProduit, produitExploitable, consigneRangement, consigneFiche, lireJson, nettoyerNomGenerique, nettoyerMarque,
  interpreterRangement, interpreterFiche, rangerProduit, corpsModele, PROPOSITION_VIDE, MODELE,
} from './logique.ts';

const RAYONS = [
  { id: 'sc-bieres', nom: 'Bières', categorie: 'Boissons alcoolisées' },
  { id: 'sc-cafe', nom: 'Café, thé & chaud', categorie: 'Boissons non alcoolisées' },
  { id: 'sc-plats', nom: 'Plats cuisinés', categorie: 'Plats préparés & traiteur' },
];
const TAJINE = { off: { product_name: 'La Tajine de Boeuf et ses Légumes du Soleil', brands: 'Fleury Michon', quantity: '350 g', generic_name_fr: 'Tajine de boeuf, plat cuisine', categories_tags: ['fr:repas', 'fr:tajine'] }, libelle_ticket: '350G TAJINE BOEUF' };
const BIERE = { off: { product_name: '8.6 Extreme', brands: 'Bavaria', quantity: '50 cl', categories_tags: ['en:beers'] }, libelle_ticket: 'BIERE EXTREME 8.6' };
const reponse = (contenu: unknown) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: typeof contenu === 'string' ? contenu : JSON.stringify(contenu) } }] }) });
const journal = () => ({ log: vi.fn(), error: vi.fn() });

describe('ce qui part au modèle', () => {
  it('seulement des textes courts sur le produit, rien d\'autre de la demande', () => {
    const p = lireProduit({ ...TAJINE, utilisateur: 'x', off: { ...TAJINE.off, code: '330', image_front_url: 'http://x' } });
    expect(p).toEqual({ nom: 'La Tajine de Boeuf et ses Légumes du Soleil', nomGenerique: 'Tajine de boeuf, plat cuisine', marques: 'Fleury Michon', quantite: '350 g', categories: ['fr:repas', 'fr:tajine'], libelleTicket: '350G TAJINE BOEUF' });
    const c = consigneRangement(p, RAYONS);
    expect(c).not.toContain('http://x');
    expect(c).toContain('1. Bières (Boissons alcoolisées)');
    expect(c).toContain('3. Plats cuisinés (Plats préparés & traiteur)');
  });
  it('demande vide, illisible ou sans nom : rien à ranger', () => {
    for (const corps of [null, 'x', {}, { off: {} }, { off: { brands: 'X' } }]) expect(produitExploitable(lireProduit(corps))).toBe(false);
    expect(produitExploitable(lireProduit({ libelle_ticket: 'X36 DOSETTE DOUX N' }))).toBe(true);
  });
  it('modèle rapide, hébergeur imposé, température 0', () => {
    expect(corpsModele('x')).toMatchObject({ model: MODELE, provider: { order: ['anthropic'], allow_fallbacks: false }, temperature: 0 });
  });
  it('la question « fiche » rappelle les règles du modèle produit', () => {
    const c = consigneFiche(lireProduit(BIERE), 'Bière', [{ id: 'p1', nom: 'Bière' }, { id: 'p2', nom: 'Bière sans alcool' }]);
    expect(c).toMatch(/La marque et la contenance ne comptent PAS/);
    expect(c).toMatch(/Un sous-type différent = une autre fiche/);
    expect(c).toMatch(/Dans le doute : null/);
    expect(c).toContain('1. Bière\n2. Bière sans alcool');
  });
});

describe('ce qu\'on accepte du modèle', () => {
  it('JSON isolé dans du texte ; illisible -> null', () => {
    expect(lireJson('Voici : {"rayon": 3} merci')).toEqual({ rayon: 3 });
    for (const t of ['', 'rien', '{coupé', null]) expect(lireJson(t)).toBeNull();
  });
  it('nom générique : nettoyé, majuscule ; refusé s\'il est vide, trop long ou porte une quantité', () => {
    expect(nettoyerNomGenerique(' tajine de bœuf aux légumes. ')).toBe('Tajine de bœuf aux légumes');
    expect(nettoyerNomGenerique('Crème dessert vanille')).toBe('Crème dessert vanille');
    for (const n of ['', 'ab', 'Tajine de bœuf 350 g', 'Café x36', 'Café X 36 dosettes', 'Pots 4 x 100g', 'un nom beaucoup trop long pour être celui d\'un rayon de magasin', 42, null]) {
      expect(nettoyerNomGenerique(n)).toBeNull();
    }
  });
  it('marque : gardée seulement si elle se lit dans ce qu\'on a reçu', () => {
    const laitiere = lireProduit({ off: { product_name: 'Le Petit Pot de Crème', brands: 'Nestlé, La Laitière' } });
    expect(nettoyerMarque('La Laitière', laitiere)).toBe('La Laitière');
    expect(nettoyerMarque('la laitiere', laitiere)).toBe('la laitiere');
    expect(nettoyerMarque('Danone', laitiere)).toBeNull();
    expect(nettoyerMarque('8.6', lireProduit(BIERE))).toBe('8.6'); // lue dans le nom « 8.6 Extreme »
    expect(nettoyerMarque('', laitiere)).toBeNull();
  });
  it('numéro de rayon ou de fiche hors liste, texte, zéro : null', () => {
    const p = lireProduit(TAJINE);
    expect(interpreterRangement({ rayon: 3, nom_generique: 'Tajine de bœuf aux légumes', marque: 'Fleury Michon', certain: true }, p, RAYONS))
      .toEqual({ rayon: { id: 'sc-plats', nom: 'Plats cuisinés' }, nom_generique: 'Tajine de bœuf aux légumes', produit: null, marque: 'Fleury Michon', certain: true });
    for (const rayon of [0, 4, -1, 'Plats', null, 1.5]) {
      const r = interpreterRangement({ rayon, nom_generique: 'Tajine', certain: true }, p, RAYONS);
      expect(r.rayon).toBeNull();
      expect(r.certain).toBe(false); // jamais « certain » sans rayon
    }
    expect(interpreterRangement(null, p, RAYONS)).toEqual(PROPOSITION_VIDE);
    expect(interpreterFiche({ fiche: 2 }, [{ id: 'a', nom: 'A' }, { id: 'b', nom: 'B' }])).toEqual({ id: 'b', nom: 'B' });
    for (const fiche of [0, 3, null, 'B']) expect(interpreterFiche({ fiche }, [{ id: 'a', nom: 'A' }, { id: 'b', nom: 'B' }])).toBeNull();
  });
});

describe('rangerProduit — de bout en bout, modèle simulé', () => {
  const acces = (fiches: Array<{ id: string; nom: string }> = []) => ({ chargerRayons: vi.fn(async () => RAYONS), chargerFiches: vi.fn(async () => fiches) });

  it('tajine : rayon Plats cuisinés, nom générique, fiche nouvelle (aucune fiche du rayon ne convient)', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(reponse({ rayon: 3, nom_generique: 'Tajine de bœuf aux légumes', marque: 'Fleury Michon', certain: true }))
      .mockResolvedValueOnce(reponse({ fiche: null }));
    const a = acces([{ id: 'p-parm', nom: 'Parmentier de canard confit' }]);
    const r = await rangerProduit({ corps: TAJINE, apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, acces: a, journal: journal() });
    expect(r).toEqual({ rayon: { id: 'sc-plats', nom: 'Plats cuisinés' }, nom_generique: 'Tajine de bœuf aux légumes', produit: null, marque: 'Fleury Michon', certain: true });
    expect(a.chargerFiches).toHaveBeenCalledWith('sc-plats');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('8.6 Extreme : rejoint la fiche « Bière » sans deuxième question (même nom), marque 8.6', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(reponse({ rayon: 1, nom_generique: 'Bière', marque: '8.6', certain: true }));
    const r = await rangerProduit({ corps: BIERE, apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, acces: acces([{ id: 'p-biere', nom: 'Bière' }, { id: 'p-sa', nom: 'Bière sans alcool' }]), journal: journal() });
    expect(r.produit).toEqual({ id: 'p-biere', nom: 'Bière' });
    expect(r.marque).toBe('8.6');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('la deuxième question désigne une fiche existante', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(reponse({ rayon: 2, nom_generique: 'Café en dosettes', marque: '', certain: true }))
      .mockResolvedValueOnce(reponse('{"fiche": 2}'));
    const r = await rangerProduit({ corps: { off: { product_name: 'Café n 5 doux' }, libelle_ticket: 'X36 DOSETTE DOUX N' }, apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, acces: acces([{ id: 'p-caps', nom: 'Café en capsules' }, { id: 'p-dos', nom: 'Café dosettes doux' }]), journal: journal() });
    expect(r.produit).toEqual({ id: 'p-dos', nom: 'Café dosettes doux' });
    expect(r.marque).toBeNull();
  });

  it('le modèle ne sait pas : pas de rayon, pas de question « fiche », rien de certain', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(reponse({ rayon: null, nom_generique: '', marque: '', certain: true }));
    const a = acces();
    const r = await rangerProduit({ corps: { off: { product_name: 'XZ-42' } }, apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, acces: a, journal: journal() });
    expect(r).toEqual(PROPOSITION_VIDE);
    expect(a.chargerFiches).not.toHaveBeenCalled();
  });

  it('jamais d\'exception : clé absente, rien à ranger, modèle en panne, réponse illisible, base en panne', async () => {
    const j = journal();
    expect(await rangerProduit({ corps: TAJINE, apiKey: undefined, fetchFn: vi.fn() as unknown as typeof fetch, acces: acces(), journal: j })).toEqual(PROPOSITION_VIDE);
    expect(await rangerProduit({ corps: {}, apiKey: 'k', fetchFn: vi.fn() as unknown as typeof fetch, acces: acces(), journal: j })).toEqual(PROPOSITION_VIDE);
    const panne = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: 'indisponible' } }) });
    expect(await rangerProduit({ corps: TAJINE, apiKey: 'k', fetchFn: panne as unknown as typeof fetch, acces: acces(), journal: j })).toEqual(PROPOSITION_VIDE);
    expect(await rangerProduit({ corps: TAJINE, apiKey: 'k', fetchFn: vi.fn().mockResolvedValue(reponse('pas du json')) as unknown as typeof fetch, acces: acces(), journal: j })).toEqual(PROPOSITION_VIDE);
    const baseEnPanne = { chargerRayons: vi.fn(async () => { throw new Error('base'); }), chargerFiches: vi.fn() };
    expect(await rangerProduit({ corps: TAJINE, apiKey: 'k', fetchFn: vi.fn() as unknown as typeof fetch, acces: baseEnPanne, journal: j })).toEqual(PROPOSITION_VIDE);
  });

  it('la question « fiche » échoue : on garde le rayon et le nom', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(reponse({ rayon: 3, nom_generique: 'Tajine de bœuf aux légumes', marque: '', certain: true }))
      .mockRejectedValueOnce(new Error('réseau'));
    const r = await rangerProduit({ corps: TAJINE, apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, acces: acces([{ id: 'x', nom: 'Autre plat' }]), journal: journal() });
    expect(r.rayon?.nom).toBe('Plats cuisinés');
    expect(r.nom_generique).toBe('Tajine de bœuf aux légumes');
    expect(r.produit).toBeNull();
  });
});

// Chantier 169 — « SH FB 5% 4X » rangé dans « Steak haché pur bœuf 15% MG » (21/11).
import { pourcentageIncompatible as pctInc, consigneRangement as cR, consigneFiche as cF } from './logique.ts';
describe('matière grasse (chantier 169)', () => {
  const p = (libelleTicket: string, nom = '') => ({ nom, nomGenerique: '', marques: 'Auchan', quantite: '500 g', categories: [], libelleTicket });
  it('refuse une fiche dont le pourcentage diffère de celui lu', () => {
    expect(pctInc(p('*AUCHAN SH FB 5% 4X..'), 'Steak haché pur bœuf 15% MG')).toBe(true);
    expect(pctInc(p('STEAK HACHE 15%'), 'Steak haché pur bœuf 15% MG')).toBe(false);
    expect(pctInc(p('STEAK HACHE'), 'Steak haché pur bœuf 15% MG')).toBe(false);
    expect(pctInc(p('LAIT 1,5%'), 'Lait 1.5% MG')).toBe(false);
    expect(pctInc(p('SH FB 5%'), 'Steak haché')).toBe(false);
  });
  it('les consignes nomment la matière grasse comme sous-type', () => {
    expect(cR(p('SH FB 5%'), [{ id: 'r', nom: 'Bœuf', categorie: 'Boucherie' }])).toMatch(/MATIÈRE GRASSE/);
    expect(cF(p('SH FB 5%'), 'Steak haché pur bœuf 5% MG', [{ id: 'f', nom: 'Steak haché pur bœuf 15% MG' }])).toMatch(/ne rejoint PAS "Steak haché pur bœuf 15% MG"/);
  });
});
