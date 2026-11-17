import { describe, it, expect, vi } from 'vitest';
import {
  motsUtiles, termeDeRecherche, ressemblance, deciderLiaison, proposerLiaison,
  LIAISON_RELIE, LIAISON_SUGGESTIONS, LIAISON_A_RELIER, MAX_SUGGESTIONS,
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
  it('un seul mot sans résultat : pas de recherche supplémentaire', async () => {
    const chercher = vi.fn(async () => []);
    const d = await proposerLiaison('knacky', chercher);
    expect(chercher).toHaveBeenCalledTimes(1);
    expect(d.issue).toBe(LIAISON_A_RELIER);
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
