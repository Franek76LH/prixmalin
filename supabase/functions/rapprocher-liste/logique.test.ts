import { describe, it, expect, vi } from 'vitest';
import { lireElements, consigneCatalogue, consigneProduits, lireJson, interpreter, rapprocherListe, corpsModele, MODELE, MAX_ELEMENTS } from './logique.ts';

const FICHES = [
  { id: 'f-essuie', nom: 'Essuie-tout', rayon: 'Entretien' },
  { id: 'f-cola', nom: 'Cola', rayon: 'Sodas' },
  { id: 'f-cola-zero', nom: 'Cola zéro', rayon: 'Sodas' },
  { id: 'f-yaourt', nom: 'Yaourt nature', rayon: 'Yaourts' },
  { id: 'f-yaourt-fruits', nom: 'Yaourt aux fruits', rayon: 'Yaourts' },
];
const ELEMENTS = [{ id: 'a', nom: 'sopalin' }, { id: 'b', nom: 'coca' }, { id: 'c', nom: 'croquettes pour chat' }];
const reponse = (contenu: string, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => (ok ? { choices: [{ message: { content: contenu } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } : { error: { message: 'panne' } }) })) as unknown as typeof fetch;
const muet = { log: () => {}, error: () => {} };

describe('rapprocher-liste — lecture de la demande', () => {
  it('garde les éléments exploitables, écarte les vides et les doublons', () => {
    expect(lireElements({ elements: [{ id: 'a', nom: ' sopalin ' }, { id: 'a', nom: 'autre' }, { id: 'b', nom: 'x' }, { nom: 'sans id' }, null] })).toEqual([{ id: 'a', nom: 'sopalin' }]);
  });
  it('demande illisible : rien', () => {
    expect(lireElements(null)).toEqual([]);
    expect(lireElements({ elements: 'x' })).toEqual([]);
  });
  it('plafonne le nombre d\'éléments et la longueur des noms', () => {
    const beaucoup = Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, nom: 'x'.repeat(300) }));
    const lus = lireElements({ elements: beaucoup });
    expect(lus).toHaveLength(MAX_ELEMENTS);
    expect(lus[0].nom).toHaveLength(80);
  });
});

describe('rapprocher-liste — consigne', () => {
  it('numérote le catalogue avec les rayons, et les produits dits', () => {
    const c = consigneCatalogue(FICHES);
    expect(c).toContain('1. Essuie-tout (Entretien)');
    expect(c).toContain('5. Yaourt aux fruits (Yaourts)');
    const p = consigneProduits(ELEMENTS);
    expect(p).toContain('1. sopalin');
    expect(p).toContain('3. croquettes pour chat');
  });
  it('le morceau « catalogue » ne dépend pas de ce qui est dit (il est gardé en mémoire)', () => {
    const a = corpsModele(ELEMENTS, FICHES, 100), b = corpsModele([{ id: 'z', nom: 'autre chose' }], FICHES, 100);
    expect(a.messages[0].content[0]).toEqual(b.messages[0].content[0]);
    expect(a.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(a.messages[0].content[1].text).not.toEqual(b.messages[0].content[1].text);
  });
  it('interroge le modèle prévu, sans fantaisie', () => {
    expect(corpsModele(ELEMENTS, FICHES, 100)).toMatchObject({ model: MODELE, temperature: 0, max_tokens: 100 });
  });
});

describe('rapprocher-liste — interprétation', () => {
  it('traduit les numéros en fiches, dans l\'ordre des éléments', () => {
    const r = interpreter(lireJson('{"r":[{"e":2,"f":[3,2],"sur":false},{"e":1,"f":[1],"sur":true},{"e":3,"f":[],"sur":false}]}'), ELEMENTS, FICHES);
    expect(r).toEqual([
      { id: 'a', propositions: [{ produit_id: 'f-essuie', produit_nom: 'Essuie-tout' }], sur: true },
      { id: 'b', propositions: [{ produit_id: 'f-cola-zero', produit_nom: 'Cola zéro' }, { produit_id: 'f-cola', produit_nom: 'Cola' }], sur: false },
      { id: 'c', propositions: [], sur: false },
    ]);
  });
  it('ignore les numéros hors catalogue, les doublons, et plafonne à 3', () => {
    const r = interpreter({ r: [{ e: 1, f: [99, 0, 'x', 1, 1, 2, 3, 4, 5], sur: true }] }, ELEMENTS, FICHES);
    expect(r[0].propositions.map(p => p.produit_id)).toEqual(['f-essuie', 'f-cola', 'f-cola-zero']);
    expect(r[0].sur).toBe(false); // « sûr » exige une seule fiche
  });
  it('« sûr » doit être dit explicitement', () => {
    expect(interpreter({ r: [{ e: 1, f: [1] }] }, ELEMENTS, FICHES)[0].sur).toBe(false);
    expect(interpreter({ r: [{ e: 1, f: [1], sur: 'oui' }] }, ELEMENTS, FICHES)[0].sur).toBe(false);
  });
  it('élément oublié, inconnu ou répété : jamais de plantage, jamais d\'invention', () => {
    const r = interpreter({ r: [{ e: 7, f: [1] }, { e: 1, f: [2] }, { e: 1, f: [1] }] }, ELEMENTS, FICHES);
    expect(r.map(x => x.propositions.length)).toEqual([1, 0, 0]);
    expect(r[0].propositions[0].produit_id).toBe('f-cola');
    expect(interpreter(null, ELEMENTS, FICHES).every(x => x.propositions.length === 0)).toBe(true);
  });
  it('lit un JSON entouré de texte, refuse le reste', () => {
    expect(lireJson('Voici : {"r":[]} fin')).toEqual({ r: [] });
    expect(lireJson('pas du json')).toBeNull();
  });
});

describe('rapprocher-liste — bout en bout', () => {
  const acces = { chargerFiches: async () => FICHES };
  it('rend les propositions du modèle', async () => {
    const fetchFn = reponse('{"r":[{"e":1,"f":[1],"sur":true},{"e":2,"f":[2,3],"sur":false},{"e":3,"f":[],"sur":false}]}');
    const { resultats } = await rapprocherListe({ corps: { elements: ELEMENTS }, apiKey: 'cle', fetchFn, acces, journal: muet });
    expect(resultats[0]).toMatchObject({ id: 'a', sur: true });
    expect(resultats[1].propositions).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('sans clé, sans élément ou sans catalogue : aucun appel au modèle', async () => {
    const fetchFn = reponse('{}');
    expect(await rapprocherListe({ corps: { elements: ELEMENTS }, apiKey: undefined, fetchFn, acces, journal: muet })).toEqual({ resultats: [] });
    expect(await rapprocherListe({ corps: {}, apiKey: 'cle', fetchFn, acces, journal: muet })).toEqual({ resultats: [] });
    expect(await rapprocherListe({ corps: { elements: ELEMENTS }, apiKey: 'cle', fetchFn, acces: { chargerFiches: async () => [] }, journal: muet })).toEqual({ resultats: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('modèle en panne ou base en panne : réponse vide, jamais d\'exception', async () => {
    expect(await rapprocherListe({ corps: { elements: ELEMENTS }, apiKey: 'cle', fetchFn: reponse('', false), acces, journal: muet })).toEqual({ resultats: [] });
    expect(await rapprocherListe({ corps: { elements: ELEMENTS }, apiKey: 'cle', fetchFn: reponse('{}'), acces: { chargerFiches: async () => { throw new Error('base'); } }, journal: muet })).toEqual({ resultats: [] });
  });
  it('réponse illisible : une entrée vide par élément', async () => {
    const { resultats } = await rapprocherListe({ corps: { elements: ELEMENTS }, apiKey: 'cle', fetchFn: reponse('désolé'), acces, journal: muet });
    expect(resultats).toHaveLength(3);
    expect(resultats.every(x => x.propositions.length === 0 && !x.sur)).toBe(true);
  });
});
