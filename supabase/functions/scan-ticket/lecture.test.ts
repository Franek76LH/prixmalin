import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  construirePromptTicket, construireCorpsOpenRouter, CONSIGNES_ANTI_INVENTION, FOURNISSEUR, MODELE,
  dimensionsJpeg, infosImages, lireImagesRequete, lireTicket,
  CONSIGNE_REMISE_DE_LIGNE, CONSIGNE_LIBELLE_REMISE_IMPORT, normaliserRemisesDeLigne, VERSION_LECTURE, CONSIGNE_ARTICLES_AVEC_REMISE,
} from './lecture.ts';

// En-tête JPEG minimal : SOI, segment APP0 (16 octets), SOF0 1234 × 567.
function jpegMinimal(largeur: number, hauteur: number): string {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, hauteur >> 8, hauteur & 255, largeur >> 8, largeur & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const octets = [0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9];
  return btoa(String.fromCharCode(...octets));
}

const reponseOpenRouter = (contenu: unknown, extra = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ provider: 'Anthropic', model: 'anthropic/claude-sonnet-4.5', choices: [{ message: { content: JSON.stringify(contenu) }, finish_reason: 'stop' }], ...extra }),
});

describe('hébergeur imposé', () => {
  it('Anthropic seul, sans repli, même modèle et même temperature 0 que la v13', () => {
    const corps = construireCorpsOpenRouter({ images: ['AAAA'], isMulti: false });
    expect(corps.provider).toEqual({ order: ['anthropic'], allow_fallbacks: false });
    expect(corps.provider).toBe(FOURNISSEUR);
    expect(corps.model).toBe('anthropic/claude-sonnet-4-5');
    expect(MODELE).toBe('anthropic/claude-sonnet-4-5');
    expect(corps.temperature).toBe(0);
    expect(corps.max_tokens).toBe(16000);
  });
});

describe('consignes anti-invention', () => {
  const prompt = construirePromptTicket({ nbImages: 1, isMulti: false, refProducts: [{ nom: 'Baguette', categorie: 'Pain' }] });

  it('ajoutées une seule fois, juste avant le catalogue, après la RÈGLE ABSOLUE v13 (gardée)', () => {
    expect(prompt.split(CONSIGNES_ANTI_INVENTION).length).toBe(2);
    expect(prompt.indexOf('Un article manquant est une erreur grave.')).toBeLessThan(prompt.indexOf('NE JAMAIS INVENTER DE LIGNE'));
    expect(prompt.indexOf('NE JAMAIS INVENTER DE LIGNE')).toBeLessThan(prompt.indexOf('Catalogue de référence'));
  });

  it('couvrent les quatre demandes : ne rien inventer, avant le TOTAL, pas de paiement/TVA/sous-total, adresse et date recopiées', () => {
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/N'ajoute JAMAIS un article que tu ne vois pas écrit/);
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/AVANT le TOTAL final/);
    for (const mot of ['CARTE', 'ESPECES', 'TVA', 'SOUS-TOTAL']) expect(CONSIGNES_ANTI_INVENTION).toContain(`"${mot}"`);
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/"CARTE 7,28" est un paiement/);
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/"address" : uniquement l'adresse IMPRIMÉE/);
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/chaîne vide ""/);
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/"date" : uniquement la date IMPRIMÉE[\s\S]*null/);
  });

  it('les sous-totaux de section ne coupent pas la liste (cohérent avec la RÈGLE ABSOLUE v13)', () => {
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/sous-totaux de section[\s\S]*ne marquent PAS la fin de la liste/);
    expect(prompt).toMatch(/Ne t'arrête pas à la première section/);
  });

  it('le code TVA Carrefour en début de ligne n\'est pas confondu avec une ligne TVA', () => {
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/à ne pas confondre avec le code TVA à un chiffre/);
  });

  // Test iPhone du 11/11 : « 2X 3.53€ 7.06€ » imprimé SOUS le libellé Leffe
  // lu qty 1 à 7,06 € au lieu de 2 × 3,53 €.
  it('quantité imprimée sur la ligne suivante : règle explicite, reportée sur l\'article du dessus', () => {
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/QUANTITÉ IMPRIMÉE SUR LA LIGNE SUIVANTE/);
    expect(CONSIGNES_ANTI_INVENTION).toContain('"      2X   3.53€                7.06€"');
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/qty 2, unit_price 3\.53, price 3\.53, total 7\.06\. SURTOUT PAS qty 1 avec un prix de 7\.06/);
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/multiplicateur EXPLICITE au sens de la règle des codes TVA/);
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/ne la jette pas, reporte ses chiffres sur l'article du dessus/);
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/un article imprimé sur deux lignes reste UN seul objet/);
  });

  // Constaté en essai : un vrai libellé dans l'exemple était RECOPIÉ par le
  // modèle au lieu d'être lu sur l'image (et fausserait la mémoire ticket).
  it('l\'exemple n\'embarque aucun vrai nom de produit : gabarit neutre', () => {
    expect(CONSIGNES_ANTI_INVENTION).not.toMatch(/LEFFE|BLDE|RITUEL/i);
    expect(CONSIGNES_ANTI_INVENTION).toContain('<libellé de l\'article>');
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/recopie TOUJOURS celui réellement imprimé/);
  });

  it('le nombre d\'articles imprimé sert de vérification, jamais de prétexte à gonfler une quantité', () => {
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/n'augmente JAMAIS une quantité sans multiplicateur réellement imprimé/);
    expect(CONSIGNES_ANTI_INVENTION).toMatch(/ne modifie jamais "nombre_articles"/);
  });

  it('antiInvention:false redonne un texte sans l\'ajout', () => {
    expect(construirePromptTicket({ nbImages: 1, isMulti: false, antiInvention: false })).not.toContain('NE JAMAIS INVENTER DE LIGNE');
  });
});

describe('images reçues', () => {
  it('lit les dimensions dans l\'en-tête JPEG', () => {
    expect(dimensionsJpeg(jpegMinimal(1234, 567))).toEqual({ largeur: 1234, hauteur: 567 });
  });

  it('pas un JPEG / vide / illisible -> null, jamais d\'exception', () => {
    expect(dimensionsJpeg('')).toBeNull();
    expect(dimensionsJpeg(btoa('pas une image'))).toBeNull();
    expect(dimensionsJpeg('%%%%')).toBeNull();
  });

  it('poids en Ko et dimensions par image', () => {
    const [info] = infosImages([jpegMinimal(2000, 900)]);
    expect(info).toEqual({ ko: 0, largeur: 2000, hauteur: 900 });
    expect(infosImages(['A'.repeat(4096)])[0].ko).toBe(3);
  });

  it('mêmes champs que la v13 : imageBase64 seule, imagesBase64 = morceaux', () => {
    expect(lireImagesRequete({ imageBase64: 'x' })).toEqual({ images: ['x'], isMulti: false });
    expect(lireImagesRequete({ imagesBase64: ['a', 'b'] })).toEqual({ images: ['a', 'b'], isMulti: true });
    expect(lireImagesRequete({ imagesBase64: ['a'] })).toEqual({ images: ['a'], isMulti: true });
    expect(lireImagesRequete({})).toEqual({ images: [], isMulti: false });
  });
});

describe('lireTicket — appel, analyse et journaux', () => {
  const journal = () => ({ log: vi.fn(), error: vi.fn() });

  it('envoie l\'hébergeur imposé et journalise taille des images + hébergeur qui a répondu', async () => {
    const j = journal();
    const fetchFn = vi.fn().mockResolvedValue(reponseOpenRouter({ store: 'UTILE', products: [{ name: 'Pain', price: 1 }] }));
    const lu = await lireTicket({ corps: { imageBase64: jpegMinimal(1500, 2000) }, apiKey: 'k', fetchFn, journal: j });
    expect(lu).toEqual({ store: 'UTILE', products: [{ name: 'Pain', price: 1, remise: 0 }] });
    const envoye = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(envoye.provider).toEqual({ order: ['anthropic'], allow_fallbacks: false });
    const [etiquette, details] = j.log.mock.calls[0];
    expect(etiquette).toBe('[scan-ticket] ok');
    const d = JSON.parse(details);
    expect(d.fournisseur).toBe('Anthropic');
    expect(d.modele).toBe('anthropic/claude-sonnet-4.5');
    expect(d.tailles_images).toEqual([{ ko: 0, largeur: 1500, hauteur: 2000 }]);
    expect(d.produits).toBe(1);
  });

  it('réponse non-2xx : message d\'erreur v13 et journal avec la taille des images', async () => {
    const j = journal();
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: 'No endpoints available' } }) });
    await expect(lireTicket({ corps: { imageBase64: jpegMinimal(10, 10) }, apiKey: 'k', fetchFn, journal: j })).rejects.toThrow('No endpoints available');
    expect(j.error.mock.calls[0][0]).toBe('[scan-ticket] OpenRouter non-2xx');
    expect(JSON.parse(j.error.mock.calls[0][2]).images).toEqual([{ ko: 0, largeur: 10, hauteur: 10 }]);
  });

  it('mêmes erreurs que la v13 : image manquante, clé absente, réponse vide, JSON coupé', async () => {
    const fetchFn = vi.fn();
    await expect(lireTicket({ corps: {}, apiKey: 'k', fetchFn })).rejects.toThrow('imageBase64 ou imagesBase64 manquant');
    await expect(lireTicket({ corps: { imageBase64: 'x' }, apiKey: undefined, fetchFn })).rejects.toThrow('OPENROUTER_API_KEY');
    expect(fetchFn).not.toHaveBeenCalled();
    const vide = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) });
    await expect(lireTicket({ corps: { imageBase64: 'x' }, apiKey: 'k', fetchFn: vide, journal: journal() })).rejects.toThrow('Réponse vide du modèle');
    const coupe = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"products": [' } }] }) });
    await expect(lireTicket({ corps: { imageBase64: 'x' }, apiKey: 'k', fetchFn: coupe, journal: journal() })).rejects.toThrow('Réponse du modèle incomplète');
  });

  it('texte autour du JSON : isolé entre le premier { et le dernier } (v13)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Voici :\n```json\n{"store":"A","products":[]}\n```' } }] }) });
    expect(await lireTicket({ corps: { imageBase64: 'x' }, apiKey: 'k', fetchFn, journal: journal() })).toEqual({ store: 'A', products: [] });
  });

  it('préfixe des journaux paramétrable (fonction de test du serveur de dev)', async () => {
    const j = journal();
    const fetchFn = vi.fn().mockResolvedValue(reponseOpenRouter({ products: [] }));
    await lireTicket({ corps: { imageBase64: 'x' }, apiKey: 'k', fetchFn, journal: j, prefixe: '[scan-ticket-test]' });
    expect(j.log.mock.calls[0][0]).toBe('[scan-ticket-test] ok');
  });
});

// ── Correctif orientation (11/11) ──────────────────────────────────────────
import {
  lireCandidatsOrientation, construireCorpsOrientation, interpreterReponseOrientation,
  conclureOrientation, verifierOrientation, traiterRequeteScan, MODELE_ORIENTATION,
} from './lecture.ts';

const CANDIDATS = [0, 90, 180, 270].map((rotation) => ({ rotation, image: `img${rotation}` }));
const reponseSens = (contenu: string) => ({ ok: true, status: 200, json: async () => ({ provider: 'Anthropic', model: 'anthropic/claude-haiku-4.5', choices: [{ message: { content: contenu } }] }) });
// Fausse API : répond le numéro (dans l'ordre reçu) de l'image `droite`.
const apiQuiVoit = (rotationDroite: number, certain = true) => vi.fn(async (_url: string, opts: { body: string }) => {
  const corps = JSON.parse(opts.body);
  const images = corps.messages[0].content.filter((c: { type: string }) => c.type === 'image_url').map((c: { image_url: { url: string } }) => c.image_url.url);
  const n = images.findIndex((u: string) => u.endsWith(`img${rotationDroite}`)) + 1;
  return reponseSens(JSON.stringify({ droite: n, certain }));
});

describe('sens de la photo — demande et réponses', () => {
  it('exige exactement 4 miniatures, une par rotation', () => {
    expect(lireCandidatsOrientation({ orientation: { candidats: CANDIDATS } })).toEqual(CANDIDATS);
    expect(lireCandidatsOrientation({ orientation: { candidats: CANDIDATS.slice(0, 3) } })).toBeNull();
    expect(lireCandidatsOrientation({ orientation: { candidats: [...CANDIDATS.slice(0, 3), { rotation: 0, image: 'x' }] } })).toBeNull();
    expect(lireCandidatsOrientation({ orientation: { candidats: [...CANDIDATS.slice(0, 3), { rotation: 45, image: 'x' }] } })).toBeNull();
    expect(lireCandidatsOrientation({})).toBeNull();
  });

  it('modèle rapide, Anthropic seul, temperature 0, images numérotées', () => {
    const corps = construireCorpsOrientation(CANDIDATS);
    expect(corps.model).toBe(MODELE_ORIENTATION);
    expect(corps.model).toBe('anthropic/claude-haiku-4.5');
    expect(corps.provider).toEqual({ order: ['anthropic'], allow_fallbacks: false });
    expect(corps.temperature).toBe(0);
    expect(corps.messages[0].content.filter((c: { type: string }) => c.type === 'image_url')).toHaveLength(4);
    expect(JSON.stringify(corps)).toContain('Image 4 :');
  });

  it('réponse -> rotation de l\'image désignée ; tout le reste -> incertain', () => {
    const ordre = [...CANDIDATS].reverse();
    expect(interpreterReponseOrientation('{"droite": 1, "certain": true}', ordre)).toEqual({ rotation: 270, certain: true });
    expect(interpreterReponseOrientation('```json\n{"droite": 3, "certain": true}\n```', CANDIDATS)).toEqual({ rotation: 180, certain: true });
    for (const t of ['{"droite": 2, "certain": false}', '{"droite": null, "certain": false}', '{"droite": 5, "certain": true}', 'je ne sais pas', '']) {
      expect(interpreterReponseOrientation(t, CANDIDATS)).toEqual({ rotation: null, certain: false });
    }
  });

  it('deux avis certains et identiques -> conclu ; désaccord ou un doute -> incertain', () => {
    expect(conclureOrientation([{ rotation: 90, certain: true }, { rotation: 90, certain: true }])).toEqual({ rotation: 90, certain: true });
    expect(conclureOrientation([{ rotation: 90, certain: true }, { rotation: 270, certain: true }])).toEqual({ rotation: null, certain: false });
    expect(conclureOrientation([{ rotation: 0, certain: true }, { rotation: null, certain: false }])).toEqual({ rotation: null, certain: false });
    expect(conclureOrientation([{ rotation: 0, certain: true }])).toEqual({ rotation: null, certain: false });
  });
});

describe('verifierOrientation — deux questions en ordres opposés', () => {
  const journal = () => ({ log: vi.fn(), error: vi.fn() });

  it.each([0, 90, 180, 270])('image droite = rotation %i -> conclu, deux appels', async (rot) => {
    const fetchFn = apiQuiVoit(rot);
    const j = journal();
    const r = await verifierOrientation({ corps: { orientation: { candidats: CANDIDATS } }, apiKey: 'k', fetchFn, journal: j });
    expect(r).toEqual({ orientation: { rotation: rot, certain: true } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const ordres = fetchFn.mock.calls.map(([, o]) => JSON.parse(o.body).messages[0].content.filter((c: { type: string }) => c.type === 'image_url').map((c: { image_url: { url: string } }) => c.image_url.url.slice(-6)));
    expect(ordres[1]).toEqual([...ordres[0]].reverse());
    const [etiquette, details] = j.log.mock.calls[0];
    expect(etiquette).toBe('[scan-ticket] orientation');
    expect(JSON.parse(details)).toMatchObject({ rotation: rot, certain: true, avis: [rot, rot], fournisseur: 'Anthropic' });
  });

  it('le modèle répond toujours « image 1 » (tic) : les deux ordres le démasquent -> incertain', async () => {
    const fetchFn = vi.fn(async () => reponseSens('{"droite": 1, "certain": true}'));
    const r = await verifierOrientation({ corps: { orientation: { candidats: CANDIDATS } }, apiKey: 'k', fetchFn, journal: journal() });
    expect(r).toEqual({ orientation: { rotation: null, certain: false } });
  });

  it('le modèle hésite -> incertain', async () => {
    const r = await verifierOrientation({ corps: { orientation: { candidats: CANDIDATS } }, apiKey: 'k', fetchFn: apiQuiVoit(90, false), journal: journal() });
    expect(r.orientation.certain).toBe(false);
  });

  it('erreur de l\'API -> exception (l\'app affiche « service indisponible »)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'No endpoints' } }) }));
    await expect(verifierOrientation({ corps: { orientation: { candidats: CANDIDATS } }, apiKey: 'k', fetchFn, journal: journal() })).rejects.toThrow('No endpoints');
  });

  it('point d\'entrée unique : { orientation } vérifie le sens, sinon lecture du ticket', async () => {
    const sens = await traiterRequeteScan({ corps: { orientation: { candidats: CANDIDATS } }, apiKey: 'k', fetchFn: apiQuiVoit(180), journal: journal() });
    expect(sens).toEqual({ orientation: { rotation: 180, certain: true } });
    const fetchLecture = vi.fn().mockResolvedValue(reponseOpenRouter({ store: 'A', products: [] }));
    expect(await traiterRequeteScan({ corps: { imageBase64: 'x' }, apiKey: 'k', fetchFn: fetchLecture, journal: journal() })).toEqual({ store: 'A', products: [] });
    expect(JSON.parse(fetchLecture.mock.calls[0][1].body).model).toBe('anthropic/claude-sonnet-4-5');
  });
});

// Intégration du chantier 120 — les consignes d'import ne touchent PAS le scan
// photo ordinaire. Les empreintes ci-dessous ont été calculées sur le code du
// chantier 121 (commit 11857fc), AVANT l'ajout : si l'une d'elles change, le
// texte envoyé pour un scan photo a changé, et ce n'était pas voulu.
describe('import de ticket (chantier 120) — sans effet sur le scan photo', () => {
  const empreinte = (t: string) => createHash('sha256').update(t).digest('hex');
  const refs = [{ nom: 'Lait demi-écrémé', categorie: 'Crèmerie' }, { nom: 'Pâtes', categorie: 'Épicerie' }];

  it('scan photo, consigne de remise retirée : texte identique au caractère près à celui du chantier 121', () => {
    expect(empreinte(construirePromptTicket({ nbImages: 1, isMulti: false, remiseDeLigne: false, articlesAvecRemise: false }))).toBe('78afc88d3f3119441b9fc462c1d7f17450051a9c22d9798716d9a1da2eaee4bd');
    expect(empreinte(construirePromptTicket({ nbImages: 1, isMulti: false, refProducts: refs, remiseDeLigne: false, articlesAvecRemise: false }))).toBe('bfcb924e98a980882edba220a429e68385f7cbaab34493dd5b7bc4dd20bb088f');
    expect(empreinte(construirePromptTicket({ nbImages: 3, isMulti: true, refProducts: refs, remiseDeLigne: false, articlesAvecRemise: false }))).toBe('64957fc9283c6d9d54e42e1896c3ee4cf42cb2c527e7267ab088191f240e7d30');
    // le corps envoyé = le texte du 121 + la seule consigne de remise, insérée juste avant le catalogue
    const corps = construireCorpsOpenRouter({ images: ['AAAA'], isMulti: false, refProducts: refs });
    const texte = corps.messages[0].content.at(-1).text as string;
    expect(texte.split(CONSIGNE_REMISE_DE_LIGNE)).toHaveLength(2);
    corps.messages[0].content.at(-1).text = texte.replace(CONSIGNE_REMISE_DE_LIGNE, '').replace(CONSIGNE_ARTICLES_AVEC_REMISE, '');
    expect(empreinte(JSON.stringify(corps))).toBe('5fb3c662d1a4ff1cafdf737384f835db6742eff9fb61fa1135bad72af0cf1bf6');
  });

  it('import : les quatre ajouts v14 sont présents, et rien du texte d\'origine n\'est retiré', () => {
    const sans = construirePromptTicket({ nbImages: 3, isMulti: true, refProducts: refs });
    const avec = construirePromptTicket({ nbImages: 3, isMulti: true, refProducts: refs, consignesImport: true });
    for (const marque of ['RECOLLAGE DES MORCEAUX', 'CHAMPS SUPPLÉMENTAIRES', 'Bon immédiat', 'REMISE SOUS UNE LIGNE', 'À IGNORER COMPLÈTEMENT']) {
      expect(avec).toContain(marque);
      expect(sans).not.toContain(marque);
    }
    expect(avec).toContain(CONSIGNES_ANTI_INVENTION);
    expect(avec.length).toBeGreaterThan(sans.length);
    // une seule image importée : pas de consigne de recollage
    expect(construirePromptTicket({ nbImages: 1, isMulti: false, consignesImport: true })).not.toContain('RECOLLAGE DES MORCEAUX');
  });

  it('lireTicket : seul importFichier === true active l\'import (réponse normalisée, journal)', async () => {
    const lu = { store: 'Carrefour', products: [{ libelle_ticket: 'LAIT', price: 4.29, remise: '-2,15' }, { libelle_ticket: 'PAIN', price: 1 }] };
    const journal = { log: vi.fn(), error: vi.fn() };
    const fetchFn = vi.fn(async () => reponseOpenRouter(lu));
    // deno-lint-ignore no-explicit-any
    const r: any = await lireTicket({ corps: { imageBase64: 'AAAA', importFichier: true }, apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, journal });
    expect(r.products.map((p: { remise: number }) => p.remise)).toEqual([2.15, 0]);
    expect(r.captures_peut_etre_incompletes).toBe(false);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).messages[0].content.at(-1).text).toContain('REMISE SOUS UNE LIGNE');
    expect(JSON.parse(journal.log.mock.calls[0][1]).import_fichier).toBe(true);

    for (const valeur of [undefined, false, 'true', 1]) {
      fetchFn.mockClear(); journal.log.mockClear();
      // deno-lint-ignore no-explicit-any
      const r2: any = await lireTicket({ corps: { imageBase64: 'AAAA', importFichier: valeur }, apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, journal });
      // hors import : seules les remises de ligne sont normalisées (chantier 148)
      expect(r2).toEqual({ store: 'Carrefour', products: [{ libelle_ticket: 'LAIT', price: 4.29, remise: 2.15 }, { libelle_ticket: 'PAIN', price: 1, remise: 0 }] });
      expect(r2.captures_peut_etre_incompletes).toBeUndefined();
      expect(JSON.parse(fetchFn.mock.calls[0][1].body).messages[0].content.at(-1).text).not.toContain('REMISE SOUS UNE LIGNE');
      expect(JSON.parse(journal.log.mock.calls[0][1]).import_fichier).toBe(false);
    }
  });
});

// Chantier 148 — ticket Carrefour de François du 18/11 : « 4X100G PPC VAN LL
// 2,27x3 6,81 » puis « Remise Immédiate 2,27- ». Le scan photo ne rattachait
// pas la remise à sa ligne (consigne réservée à l'import).
describe('remise imprimée sous un article — scan photo (chantier 148)', () => {
  it('la consigne part avec TOUT scan photo, une seule fois, avant le catalogue, sans rien retirer', () => {
    const refs = [{ nom: 'Lait demi-écrémé', categorie: 'Crèmerie' }];
    for (const args of [{ nbImages: 1, isMulti: false }, { nbImages: 1, isMulti: false, refProducts: refs }, { nbImages: 3, isMulti: true, refProducts: refs }]) {
      const avec = construirePromptTicket(args);
      const sans = construirePromptTicket({ ...args, remiseDeLigne: false });
      expect(avec.split(CONSIGNE_REMISE_DE_LIGNE)).toHaveLength(2);
      expect(avec.replace(CONSIGNE_REMISE_DE_LIGNE, '')).toBe(sans);
      expect(avec).toContain(CONSIGNES_ANTI_INVENTION);
      expect(avec.indexOf(CONSIGNE_REMISE_DE_LIGNE)).toBeGreaterThan(avec.indexOf(CONSIGNES_ANTI_INVENTION));
    }
    const avecCatalogue = construirePromptTicket({ nbImages: 1, isMulti: false, refProducts: refs });
    expect(avecCatalogue.indexOf(CONSIGNE_REMISE_DE_LIGNE)).toBeLessThan(avecCatalogue.indexOf('Catalogue de référence'));
  });

  it('dit : rattacher à l\'article du dessus, montant positif, texte recopié, prix avant remise, jamais inventer, fidélité exclue', () => {
    const c = CONSIGNE_REMISE_DE_LIGNE;
    expect(c).toMatch(/se RATTACHE à l'article du dessus/);
    expect(c).toMatch(/"remise" \(nombre POSITIF\)/);
    expect(c).toMatch(/"libelle_remise" \(texte\).*recopié tel quel/s);
    expect(c).toMatch(/restent les montants AVANT remise/);
    expect(c).toMatch(/ne change JAMAIS "qty"/);
    expect(c).toMatch(/N'invente JAMAIS une remise/);
    expect(c).toMatch(/ne répartis JAMAIS toi-même le total des remises/);
    expect(c).toMatch(/APRÈS le total.*n'est PAS une remise de ligne/s);
    expect(c).toMatch(/"total_remises" ci-dessus reste inchangée/);
  });

  it('import : les consignes v14 restent, seul le champ libelle_remise est ajouté', () => {
    const t = construirePromptTicket({ nbImages: 1, isMulti: false, consignesImport: true });
    expect(t).toContain('REMISE SOUS UNE LIGNE');
    expect(t).toContain(CONSIGNE_LIBELLE_REMISE_IMPORT);
    expect(t).not.toContain(CONSIGNE_REMISE_DE_LIGNE);
  });

  it('normalise la remise : signe avant ou après, virgule, texte ; absente ou illisible -> 0', () => {
    const r = normaliserRemisesDeLigne({ products: [
      { name: 'a', remise: '2,27-' }, { name: 'b', remise: '-2,27' }, { name: 'c', remise: -0.5 }, { name: 'd', remise: 1.899 },
      { name: 'e' }, { name: 'f', remise: 'abc' }, { name: 'g', remise: null }, null,
    ] });
    expect(r.products.slice(0, 7).map((p: { remise: number }) => p.remise)).toEqual([2.27, 2.27, 0.5, 1.9, 0, 0, 0]);
    expect(r.products[7]).toBeNull();
  });

  it('libelle_remise : gardé seulement avec une remise, nettoyé, borné ; jamais d\'exception', () => {
    const r = normaliserRemisesDeLigne({ products: [
      { name: 'a', remise: 2.27, libelle_remise: '  Remise Immédiate ' },
      { name: 'b', remise: 0, libelle_remise: 'Remise Immédiate' },
      { name: 'c', remise: 1, libelle_remise: 42 },
      { name: 'd', remise: 1, libelle_remise: 'x'.repeat(200) },
    ] });
    expect(r.products[0]).toEqual({ name: 'a', remise: 2.27, libelle_remise: 'Remise Immédiate' });
    expect(r.products[1]).toEqual({ name: 'b', remise: 0 });
    expect(r.products[2]).toEqual({ name: 'c', remise: 1 });
    expect(r.products[3].libelle_remise).toHaveLength(80);
    for (const v of [null, undefined, 'x', 3, {}, { products: 'x' }]) expect(normaliserRemisesDeLigne(v)).toBe(v);
  });

  it('le ticket Carrefour du 18/11, lu comme attendu, ressort avec 2,27 € sur la ligne des pots et rien ailleurs', async () => {
    const lu = { store: 'Carrefour', total_ticket: 30.33, nombre_articles: 11, total_remises: 2.27, products: [
      { libelle_ticket: 'X36 DOSETTE DOUX N', qty: 1, unit_price: 5.55, price: 5.55, total: 5.55 },
      { libelle_ticket: '4X100G PPC VAN LL', qty: 3, unit_price: 2.27, price: 2.27, total: 6.81, remise: '2,27-', libelle_remise: 'Remise Immédiate' },
      { libelle_ticket: 'HACHE 15% X2 BIO', qty: 1, unit_price: 6.15, price: 6.15, total: 6.15, remise: 0 },
    ] };
    const journal = { log: vi.fn(), error: vi.fn() };
    const fetchFn = vi.fn(async () => reponseOpenRouter(lu));
    // deno-lint-ignore no-explicit-any
    const r: any = await lireTicket({ corps: { imageBase64: 'AAAA' }, apiKey: 'k', fetchFn: fetchFn as unknown as typeof fetch, journal });
    expect(r.products.map((p: { remise: number }) => p.remise)).toEqual([0, 2.27, 0]);
    expect(r.products[1]).toMatchObject({ qty: 3, unit_price: 2.27, total: 6.81, libelle_remise: 'Remise Immédiate' });
    expect(r.total_remises).toBe(2.27);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).messages[0].content.at(-1).text).toContain(CONSIGNE_REMISE_DE_LIGNE);
    expect(JSON.parse(journal.log.mock.calls[0][1]).version).toBe('articles-avec-remise');
    expect(VERSION_LECTURE).toBe('articles-avec-remise');
    // le journal porte l'empreinte des consignes en ligne (photo et import)
    const sha = (t: string) => createHash('sha256').update(t).digest('hex');
    expect(JSON.parse(journal.log.mock.calls[0][1]).consignes).toEqual({
      photo: sha(construirePromptTicket({ nbImages: 1, isMulti: false })),
      import: sha(construirePromptTicket({ nbImages: 2, isMulti: true, consignesImport: true })),
    });
  });
});

// Chantier 167 — ticket Auchan Aix du 21/11 : 2e paquet de lentilles imprimé
// dans la section « Articles avec Remise », avant le total.
describe('section « Articles avec Remise » (chantier 167)', () => {
  const refs = [{ nom: 'Lentilles vertes', categorie: 'Épicerie' }];
  it('part avec tout scan (photo, plusieurs photos, import), une seule fois, avant le catalogue, sans rien retirer', () => {
    for (const args of [{ nbImages: 1, isMulti: false }, { nbImages: 2, isMulti: true, refProducts: refs }, { nbImages: 2, isMulti: true, consignesImport: true, refProducts: refs }]) {
      const avec = construirePromptTicket(args);
      const sans = construirePromptTicket({ ...args, articlesAvecRemise: false });
      expect(avec.split(CONSIGNE_ARTICLES_AVEC_REMISE)).toHaveLength(2);
      expect(avec.replace(CONSIGNE_ARTICLES_AVEC_REMISE, '')).toBe(sans);
      if (args.refProducts) expect(avec.indexOf(CONSIGNE_ARTICLES_AVEC_REMISE)).toBeLessThan(avec.indexOf('Catalogue de référence'));
    }
  });
  it('dit : article EN PLUS même libellé, prix avant remise, jamais fusionné, « * » multiplicateur', () => {
    const c = CONSIGNE_ARTICLES_AVEC_REMISE;
    expect(c).toMatch(/ACHETÉ EN PLUS/);
    expect(c).toMatch(/EXACTEMENT le même libellé/);
    expect(c).toMatch(/ne le mets JAMAIS dans price ni dans total/);
    expect(c).toMatch(/Ne fusionne JAMAIS/);
    expect(c).toMatch(/"\*" entre deux nombres/);
  });
});
