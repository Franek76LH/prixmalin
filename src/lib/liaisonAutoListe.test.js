import { describe, it, expect, vi } from 'vitest';
import {
  motsUtiles, termeDeRecherche, ressemblance, deciderLiaison, proposerLiaison,
  LIAISON_RELIE, LIAISON_SUGGESTIONS, LIAISON_A_RELIER, MAX_SUGGESTIONS, SEUIL_MEME_NOM,
} from './liaisonAutoListe';

const fiche = (produit_id, nom_reference, dernier_prix = 1) => ({ produit_id, nom_reference, dernier_prix });

describe('nettoyage du nom entendu', () => {
  it('retire les mots vides, les accents, les tirets et le pluriel', () => {
    expect(motsUtiles('Du Coca-Cola')).toEqual(['coca', 'cola']);
    expect(motsUtiles('des pâtes')).toEqual(['pate']);
    expect(motsUtiles("de l'huile d'olive")).toEqual(['huile', 'olive']);
    expect(motsUtiles('Œufs')).toEqual(['oeuf']);
    expect(motsUtiles('du riz')).toEqual(['riz']);
    expect(termeDeRecherche('des yaourts nature')).toBe('yaourt nature');
  });
  it('vide ou absent -> aucun mot', () => {
    expect(motsUtiles('')).toEqual([]);
    expect(motsUtiles(null)).toEqual([]);
    expect(motsUtiles('du de la')).toEqual([]);
  });
});

describe('ressemblance', () => {
  it('mêmes mots -> même produit, au pluriel ou à l\'accent près', () => {
    expect(ressemblance('beurre', 'Beurre')).toBe(1);
    expect(ressemblance('du papier toilette', 'Papier toilette')).toBe(1);
    expect(ressemblance('toilette papier', 'Papier toilette')).toBe(1);
    expect(ressemblance('des yaourts', 'Yaourt')).toBe(0.95);
    expect(ressemblance('oeufs', 'Œufs')).toBe(1);
    expect(ressemblance('pate a tartiner', 'Pâte à tartiner')).toBe(0.9);
  });
  it('« pâtes » et « pâté » : proches, mais PAS le même nom', () => {
    expect(ressemblance('des pâtes', 'Pâté')).toBe(0.75);
  });
  it('la fiche précise ce qui a été dit : forte, mais jamais « même nom »', () => {
    const r = ressemblance('yaourt', 'Yaourt nature');
    expect(r).toBeGreaterThanOrEqual(0.7);
    expect(r).toBeLessThan(0.9);
    // commencer par le mot dit vaut mieux que le contenir plus loin
    expect(ressemblance('lait', 'Lait demi-écrémé')).toBeGreaterThan(ressemblance('lait', 'Chocolat au lait noisette'));
  });
  it('la fiche est plus générale que ce qui a été dit (« Coca-Cola » / « Cola »)', () => {
    expect(ressemblance('Coca-Cola', 'Cola')).toBe(0.6);
    expect(ressemblance('Coca-Cola', 'Cola')).toBeGreaterThan(ressemblance('Coca-Cola', 'Cola zéro'));
  });
  it('aucun mot commun -> 0', () => {
    expect(ressemblance('pâtes', 'Cannelloni')).toBe(0);
    expect(ressemblance('', 'Beurre')).toBe(0);
  });
});

describe('deciderLiaison', () => {
  it('une seule fiche du même nom -> reliée sans rien demander', () => {
    const d = deciderLiaison('du beurre', [fiche('a', 'Croissants pur beurre'), fiche('b', 'Beurre')]);
    expect(d.issue).toBe(LIAISON_RELIE);
    expect(d.produit).toMatchObject({ produit_id: 'b', produit_nom: 'Beurre' });
  });
  it('deux fiches du même nom -> on ne choisit pas à la place de l\'utilisateur', () => {
    const d = deciderLiaison('beurre', [fiche('a', 'Beurre'), fiche('b', 'Beurres')]);
    expect(d.issue).toBe(LIAISON_SUGGESTIONS);
    expect(d.suggestions.map(s => s.produit_id)).toEqual(['a', 'b']);
  });
  it('ressemblance seulement -> suggestions (3 au plus), jamais de liaison automatique', () => {
    const d = deciderLiaison('yaourts', [
      fiche('a', 'Yaourt nature'), fiche('b', 'Yaourt citron'), fiche('c', 'Yaourt vanille'), fiche('d', 'Yaourt fraise'),
    ]);
    expect(d.issue).toBe(LIAISON_SUGGESTIONS);
    expect(d.produit).toBeNull();
    expect(d.suggestions).toHaveLength(MAX_SUGGESTIONS);
  });
  it('à ressemblance égale, la fiche qui a des prix passe devant', () => {
    const d = deciderLiaison('yaourt', [fiche('a', 'Yaourt citron', null), fiche('b', 'Yaourt nature', 1.82)]);
    expect(d.suggestions[0].produit_id).toBe('b');
  });
  it('cas réel « des pâtes » : « Pâté » n\'est jamais relié tout seul', () => {
    const d = deciderLiaison('des pâtes', [fiche('a', 'Pâté')]);
    expect(d.issue).toBe(LIAISON_SUGGESTIONS);
  });
  it('rien de sérieux, doublons de fiches, entrées invalides -> à relier', () => {
    expect(deciderLiaison('pâtes', [fiche('a', 'Cannelloni'), fiche('a', 'Cannelloni'), null, {}]).issue).toBe(LIAISON_A_RELIER);
    expect(deciderLiaison('pâtes', null).issue).toBe(LIAISON_A_RELIER);
  });
});

describe('proposerLiaison', () => {
  it('nom exact trouvé du premier coup : une seule recherche', async () => {
    const chercher = vi.fn(async () => [fiche('k', 'Knacki'), fiche('k2', 'Knacki origin')]);
    const d = await proposerLiaison('des Knackis', chercher);
    expect(chercher).toHaveBeenCalledTimes(1);
    expect(chercher).toHaveBeenCalledWith('knacki');
    expect(d.issue).toBe(LIAISON_RELIE);
    expect(d.produit.produit_id).toBe('k');
  });
  it('cas réel « Coca-Cola » : rien sur le terme complet, on élargit mot par mot et « Cola » ressort', async () => {
    const chercher = vi.fn(async (terme) => {
      if (terme === 'coca cola') return [fiche('z', 'Cola zéro'), fiche('l', 'Cola light')];
      if (terme === 'cola') return [fiche('c', 'Cola'), fiche('z', 'Cola zéro')];
      return [];
    });
    const d = await proposerLiaison('Du Coca-Cola', chercher);
    expect(d.issue).toBe(LIAISON_SUGGESTIONS);
    expect(d.suggestions[0]).toMatchObject({ produit_id: 'c', produit_nom: 'Cola' });
    expect(chercher.mock.calls.length).toBeLessThanOrEqual(3);
  });
  it('cas réel « knacky » : rien sur le mot exact, on réessaie sans la dernière lettre et « Knacki » est proposé (jamais relié seul)', async () => {
    const chercher = vi.fn(async (terme) => (terme === 'knack' ? [fiche('k', 'Knacki'), fiche('k2', 'Knacki origin')] : []));
    const d = await proposerLiaison('knacky', chercher);
    expect(chercher.mock.calls.map(c => c[0])).toEqual(['knacky', 'knack']);
    expect(d.issue).toBe(LIAISON_SUGGESTIONS);
    expect(d.suggestions[0]).toMatchObject({ produit_id: 'k', produit_nom: 'Knacki' });
  });
  it('un seul mot court sans résultat : pas de recherche supplémentaire', async () => {
    const chercher = vi.fn(async () => []);
    const d = await proposerLiaison('kiwi', chercher);
    expect(chercher).toHaveBeenCalledTimes(1);
    expect(d.issue).toBe(LIAISON_A_RELIER);
  });
  it('une lettre d\'écart : proposé, mais deux lettres ou un mot court ne comptent pas', () => {
    expect(ressemblance('knacky', 'Knacki')).toBe(0.7);
    expect(ressemblance('yaourt', 'Yaourts')).toBe(0.95); // pluriel : règle plus forte
    expect(ressemblance('brioche', 'Broche')).toBe(0.7);
    expect(ressemblance('pain', 'Bain')).toBe(0);          // mot trop court
    expect(ressemblance('tomate', 'Patate')).toBe(0);      // deux lettres
  });
  it('panne de recherche : jamais d\'exception, le produit reste à relier', async () => {
    const d = await proposerLiaison('beurre', async () => { throw new Error('réseau'); });
    expect(d.issue).toBe(LIAISON_A_RELIER);
  });
  it('nom vide ou recherche absente -> à relier', async () => {
    expect((await proposerLiaison('du', async () => [])).issue).toBe(LIAISON_A_RELIER);
    expect((await proposerLiaison('beurre', null)).issue).toBe(LIAISON_A_RELIER);
  });
});

// Chantier 130 — une fiche trouvée par la base avec TOUS les mots dits est
// proposée même si son nom ne ressemble pas (« fromage râpé » -> « Emmental râpé »).
describe('chantier 130 — fiche trouvée par tous les mots', () => {
  const base = async (terme) => {
    if (terme === 'fromage rape') return [{ produit_id: 'e', nom_reference: 'Emmental râpé', dernier_prix: 1.76 }];
    if (terme === 'fromage') return [{ produit_id: 'f', nom_reference: 'Fromage', dernier_prix: null }];
    return [];
  };
  it('« fromage râpé » propose « Emmental râpé », sans jamais le relier seul', async () => {
    const d = await proposerLiaison('fromage râpé', base);
    expect(d.issue).toBe(LIAISON_SUGGESTIONS);
    expect(d.produit).toBeNull();
    expect(d.suggestions.map(s => s.produit_nom)).toContain('Emmental râpé');
  });
  it('un mot seul ne profite pas de ce coup de pouce (« riz » est dans « chorizo »)', async () => {
    const d = await proposerLiaison('riz', async () => [{ produit_id: 'c', nom_reference: 'Chorizo', dernier_prix: 3 }]);
    expect(d.suggestions.map(s => s.produit_nom)).not.toContain('Chorizo');
  });
});

// Chantier 157 — « tes achats en premier ».
describe('habitudes d\'achat', () => {
  const YAOURTS = [
    { produit_id: 'y-boire', nom_reference: 'Yaourt à boire', dernier_prix: 1 },
    { produit_id: 'y-fruits', nom_reference: 'Yaourt aux fruits', dernier_prix: 1 },
    { produit_id: 'y-nature', nom_reference: 'Yaourt nature', dernier_prix: null },
  ];
  it('sans habitudes, rien ne change', () => {
    const avant = deciderLiaison('yaourts', YAOURTS);
    expect(deciderLiaison('yaourts', YAOURTS, {})).toEqual(avant);
    expect(deciderLiaison('yaourts', YAOURTS, { achats: {} })).toEqual(avant);
  });
  it('la fiche déjà achetée passe devant et le dit', () => {
    const d = deciderLiaison('yaourts', YAOURTS, { achats: { 'y-nature': 4 } });
    expect(d.issue).toBe(LIAISON_SUGGESTIONS);
    expect(d.suggestions[0]).toMatchObject({ produit_id: 'y-nature', dejaAchete: true });
    expect(d.suggestions[1].dejaAchete).toBe(false);
  });
  it('un achat ne suffit jamais à relier seul', () => {
    const d = deciderLiaison('yaourts', [YAOURTS[2]], { achats: { 'y-nature': 50 } });
    expect(d.issue).toBe(LIAISON_SUGGESTIONS);
    expect(d.suggestions[0].score).toBeLessThan(SEUIL_MEME_NOM);
  });
  it('le nom exact relie toujours, acheté ou non', () => {
    const fiches = [{ produit_id: 'lait', nom_reference: 'Lait', dernier_prix: 1 }, { produit_id: 'choco', nom_reference: 'Chocolat au lait', dernier_prix: 1 }];
    const d = deciderLiaison('du lait', fiches, { achats: { choco: 9 } });
    expect(d.issue).toBe(LIAISON_RELIE);
    expect(d.produit.produit_id).toBe('lait');
  });
  it('fiche achetée trouvée par le terme complet : proposée même sans ressemblance de nom', () => {
    // « coca » : la base trouve « Cola zéro » par la marque ; le nom ne ressemble pas.
    const candidats = [
      { produit_id: 'cola-zero', nom_reference: 'Cola zéro', dernier_prix: 1, termeComplet: true },
      { produit_id: 'cola-light', nom_reference: 'Cola light', dernier_prix: 1, termeComplet: true },
    ];
    expect(deciderLiaison('coca', candidats).issue).toBe(LIAISON_A_RELIER);
    const d = deciderLiaison('coca', candidats, { achats: { 'cola-zero': 5 } });
    expect(d.issue).toBe(LIAISON_SUGGESTIONS);
    expect(d.suggestions.map(s => s.produit_id)).toEqual(['cola-zero']);
  });
  it('dès qu\'un nom ressemble, les voisins lointains achetés ne sont pas ajoutés', () => {
    // « jambon » : la recherche ramène aussi des chips goût jambon, déjà achetées.
    const candidats = [
      { produit_id: 'jambon-cuit', nom_reference: 'Jambon cuit', dernier_prix: 1, termeComplet: true },
      { produit_id: 'chips', nom_reference: 'Chips aromatisées', dernier_prix: 1, termeComplet: true },
    ];
    const d = deciderLiaison('jambon', candidats, { achats: { 'jambon-cuit': 3, chips: 1 } });
    expect(d.suggestions.map(s => s.produit_id)).toEqual(['jambon-cuit']);
  });
  it('une fiche achetée sans aucun rapport n\'est pas proposée', () => {
    const d = deciderLiaison('riz', [{ produit_id: 'chorizo', nom_reference: 'Chorizo', dernier_prix: 1 }], { achats: { chorizo: 3 } });
    expect(d.issue).toBe(LIAISON_A_RELIER);
  });
  it('proposerLiaison transmet les habitudes et marque le terme complet', async () => {
    const chercher = async (terme) => (terme === 'coca' ? [{ produit_id: 'cola-zero', nom_reference: 'Cola zéro', dernier_prix: 1 }] : []);
    expect((await proposerLiaison('du coca', chercher)).issue).toBe(LIAISON_A_RELIER);
    const d = await proposerLiaison('du coca', chercher, { achats: { 'cola-zero': 2 } });
    expect(d.suggestions[0]).toMatchObject({ produit_id: 'cola-zero', dejaAchete: true });
  });
});
