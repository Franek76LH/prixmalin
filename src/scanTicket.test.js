// Chantier 96 — garde-fou « scan sans produit exploitable ».
// Chantier 98 — lecture OCR fiabilisée (réessai + statuts honnêtes).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { supabase } from './lib/supabase';
import { redresserPhoto, dimensionsTournees, filtrerProduitsExploitables, scanTicketRobuste, MESSAGES_SCAN, badgeProduit } from './scanTicket';

describe('filtrerProduitsExploitables', () => {
  it('garde uniquement les produits avec nom et prix > 0', () => {
    const produits = [
      { name: 'Eau 1L', price: 1.5 },
      { name: 'Pain', price: '2.10' },      // prix en chaîne numérique : exploitable
      { name: 'Sans prix', price: 0 },
      { name: 'Prix nul', price: null },
      { name: '', price: 3 },
      { price: 2 },
      null,
      { name: 'Négatif', price: -1 },
      { name: 'NaN', price: 'abc' },
    ];
    expect(filtrerProduitsExploitables(produits).map(p => p.name)).toEqual(['Eau 1L', 'Pain']);
  });

  it('entrées vides ou nulles : liste vide, jamais de plantage', () => {
    expect(filtrerProduitsExploitables([])).toEqual([]);
    expect(filtrerProduitsExploitables(null)).toEqual([]);
    expect(filtrerProduitsExploitables(undefined)).toEqual([]);
  });

  // Chantier 99 — name vide mais libelle_ticket présent = produit lu, exploitable.
  it('un produit sans name mais avec libelle_ticket et prix > 0 est exploitable', () => {
    const produits = [
      { name: '', libelle_ticket: 'COPPA', price: 2.5, confiance: 'faible' },
      { libelle_ticket: '*AUCHAN MOZZARELLA', price: 1.05 },
    ];
    expect(filtrerProduitsExploitables(produits)).toHaveLength(2);
  });

  it('sans name NI libelle_ticket, ou sans prix > 0 : toujours exclu (garde-fou ch. 96 intact)', () => {
    const produits = [
      { name: '', libelle_ticket: '', price: 3 },
      { price: 2 },
      { name: '', libelle_ticket: 'COPPA', price: 0 },
      { libelle_ticket: 'COPPA', price: null },
      { libelle_ticket: 'COPPA', price: -1 },
    ];
    expect(filtrerProduitsExploitables(produits)).toEqual([]);
  });
});

// Chantier 100 / 118 — badge de l'écran de partage. Depuis le 118, la map
// porte { methode } (réponse de previsualiser_reconnaissance_ticket) et SEULE
// l'égalité exacte donne « reconnu ».
describe('badgeProduit', () => {
  it('memoire_exacte -> "reconnu", même avec confiance IA "faible"', () => {
    expect(badgeProduit({ id: 3, confiance: 'faible' }, { 3: { methode: 'memoire_exacte' } })).toBe('reconnu');
  });

  it('suggestion -> "suggere", JAMAIS "reconnu", même avec confiance IA haute', () => {
    expect(badgeProduit({ id: 3, confiance: 'haute' }, { 3: { methode: 'suggestion' } })).toBe('suggere');
    expect(badgeProduit({ id: 3 }, { 3: { methode: 'suggestion', reconnu: true } })).toBe('suggere');
  });

  it('base a répondu sans méthode -> "a_verifier", même avec confiance haute', () => {
    expect(badgeProduit({ id: 4, confiance: 'haute' }, { 4: { methode: null } })).toBe('a_verifier');
  });

  it('un ancien booléen true sans méthode n\'est plus une preuve de reconnaissance', () => {
    expect(badgeProduit({ id: 3, confiance: 'faible' }, { 3: true })).toBe('a_verifier');
    expect(badgeProduit({ id: 3, confiance: 'haute' }, { 3: true })).toBeNull();
  });

  it('absent de la map + confiance "faible" -> "a_verifier"', () => {
    expect(badgeProduit({ id: 4, confiance: 'faible' }, { 3: { methode: 'memoire_exacte' } })).toBe('a_verifier');
  });

  it('absent de la map, confiance non faible -> null (aucun badge, comportement d\'avant)', () => {
    expect(badgeProduit({ id: 6, confiance: 'haute' }, {})).toBeNull();
    expect(badgeProduit({ id: 7 }, {})).toBeNull();
  });

  it('robuste : map absente/nulle ou produit nul -> jamais d\'exception', () => {
    expect(badgeProduit({ id: 8, confiance: 'faible' })).toBe('a_verifier');
    expect(badgeProduit({ id: 8, confiance: 'faible' }, null)).toBe('a_verifier');
    expect(badgeProduit(null, { 1: { methode: 'memoire_exacte' } })).toBeNull();
  });
});

// Correctif orientation — la vérification du sens (canvas + réseau) est
// remplacée ici par une photo déjà droite : ces tests portent sur la lecture.
const SANS_SENS = { redresser: async (b) => ({ statut: 'ok', base64: b, rotation: 0 }) };

describe('scanTicketRobuste — réessai automatique et statuts honnêtes (Chantier 98)', () => {
  beforeEach(() => vi.clearAllMocks());

  const OK = { store: 'Auchan', products: [{ name: 'Coppa', price: 2.5 }] };
  const VIDE = { store: 'Auchan', products: [] };

  // Correctif anti-invention — les 2 lectures partent toujours ensemble.
  it('2 lectures en parallèle ; identiques -> ok, non divergentes', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: OK, error: null });
    const r = await scanTicketRobuste('b64', [], SANS_SENS);
    expect(r).toEqual({ statut: 'ok', resultat: OK, lecturesDivergentes: false, comptesLectures: [1, 1], lignesDivergentes: [], rotation: 0, recadrage: null });
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it('réessaie une fois quand la lecture rend 0 produit, et rend le 2e résultat s\'il est bon', async () => {
    supabase.functions.invoke
      .mockResolvedValueOnce({ data: VIDE, error: null })
      .mockResolvedValueOnce({ data: OK, error: null });
    const r = await scanTicketRobuste('b64', [], SANS_SENS);
    expect(r).toMatchObject({ statut: 'ok', resultat: OK });
    // une lecture vide et une à 1 produit : le lecteur hésite -> divergence
    expect(r.lecturesDivergentes).toBe(true);
    expect(r.comptesLectures).toEqual([0, 1]);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it('2 lectures vides -> statut lecture_vide (le résultat est quand même renvoyé)', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: VIDE, error: null });
    const r = await scanTicketRobuste('b64', [], SANS_SENS);
    expect(r.statut).toBe('lecture_vide');
    expect(r.resultat).toEqual(VIDE);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it('réessaie après un échec technique, et réussit au 2e essai', async () => {
    supabase.functions.invoke
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
      .mockResolvedValueOnce({ data: OK, error: null });
    const r = await scanTicketRobuste('b64', [], SANS_SENS);
    expect(r).toMatchObject({ statut: 'ok', resultat: OK });
    // un échec technique n'est pas une lecture : rien à comparer
    expect(r.lecturesDivergentes).toBe(false);
    expect(r.comptesLectures).toEqual([1]);
  });

  it('2 échecs techniques -> service_indisponible avec le message, ne throw jamais', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: null, error: { message: 'quota dépassé' } });
    const r = await scanTicketRobuste('b64', [], SANS_SENS);
    expect(r.statut).toBe('service_indisponible');
    expect(r.message).toBe('quota dépassé');
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it('échec puis lecture vide -> lecture_vide (une réponse valide prime sur l\'erreur)', async () => {
    supabase.functions.invoke
      .mockResolvedValueOnce({ data: null, error: { message: 'réseau' } })
      .mockResolvedValueOnce({ data: VIDE, error: null });
    const r = await scanTicketRobuste('b64', [], SANS_SENS);
    expect(r.statut).toBe('lecture_vide');
  });

  // Cas réel du 11/11 : même ticket Utile (14,68 €), 7 puis 21 produits.
  it('deux lectures au nombre de produits différent -> divergentes, on garde la plus cohérente', async () => {
    const ligne = (prix) => ({ name: 'X', price: prix, total: prix, qty: 1 });
    const LECTURE_21 = { total_ticket: 14.68, total_remises: 0, products: Array.from({ length: 21 }, () => ligne(1.5)) };
    const LECTURE_5 = { total_ticket: 14.68, total_remises: 0, products: [ligne(3), ligne(3), ligne(3), ligne(3), ligne(2.68)] };
    supabase.functions.invoke
      .mockResolvedValueOnce({ data: LECTURE_21, error: null })
      .mockResolvedValueOnce({ data: LECTURE_5, error: null });
    const r = await scanTicketRobuste('b64', [], SANS_SENS);
    expect(r.statut).toBe('ok');
    expect(r.lecturesDivergentes).toBe(true);
    expect(r.comptesLectures).toEqual([21, 5]);
    expect(r.resultat).toBe(LECTURE_5);
  });

  it('à cohérence égale, la 1re lecture est retenue', async () => {
    const A = { store: 'A', products: [{ name: 'Coppa', price: 2.5 }] };
    const B = { store: 'B', products: [{ name: 'Coppa', price: 2.5 }, { name: 'Pain', price: 1 }] };
    supabase.functions.invoke
      .mockResolvedValueOnce({ data: A, error: null })
      .mockResolvedValueOnce({ data: B, error: null });
    const r = await scanTicketRobuste('b64', [], SANS_SENS);
    expect(r.resultat).toBe(A);
    expect(r.lecturesDivergentes).toBe(true);
  });

  it('les messages honnêtes existent pour chaque statut d\'échec et ne commencent pas par accuser la photo', () => {
    expect(MESSAGES_SCAN.lecture_vide).toMatch(/service de lecture/);
    expect(MESSAGES_SCAN.service_indisponible).toMatch(/photo n'y est pour rien/);
  });
});

// Correctif orientation (11/11) — photo couchée ou tête en bas remise debout
// AVANT la lecture ; sens incertain -> rien ne part au lecteur.
describe('redresserPhoto', () => {
  const tourner = vi.fn(async (b, r) => `${b}@${r}`);
  // pas de canvas sous Node : recadrage neutralisé (photo entière)
  const recadrer = async (b) => ({ base64: b, cadre: null });
  beforeEach(() => tourner.mockClear());

  it('photo déjà droite : renvoyée telle quelle, sans recompression', async () => {
    const r = await redresserPhoto('IMG', { verifier: async () => ({ rotation: 0, certain: true }), tourner, recadrer });
    expect(r).toEqual({ statut: 'ok', base64: 'IMG', rotation: 0, recadrage: null });
    expect(tourner).not.toHaveBeenCalled();
  });

  it.each([90, 180, 270])('photo à remettre de %i° : tournée d\'autant', async (rot) => {
    const r = await redresserPhoto('IMG', { verifier: async () => ({ rotation: rot, certain: true }), tourner, recadrer });
    expect(r).toEqual({ statut: 'ok', base64: `IMG@${rot}`, rotation: rot, recadrage: null });
  });

  it('sens incertain (ou rotation inconnue) -> sens_incertain, rien n\'est tourné', async () => {
    for (const avis of [{ rotation: 90, certain: false }, { rotation: null, certain: false }, { rotation: 45, certain: true }, null]) {
      expect(await redresserPhoto('IMG', { verifier: async () => avis, tourner, recadrer })).toEqual({ statut: 'sens_incertain' });
    }
    expect(tourner).not.toHaveBeenCalled();
  });

  it('vérification impossible (réseau) -> service_indisponible, jamais d\'exception', async () => {
    const r = await redresserPhoto('IMG', { verifier: async () => { throw new Error('quota'); }, tourner, recadrer });
    expect(r).toEqual({ statut: 'service_indisponible', message: 'quota' });
  });

  it('rotation impossible à appliquer -> sens_incertain (on n\'envoie pas une photo qu\'on sait de travers)', async () => {
    const r = await redresserPhoto('IMG', { verifier: async () => ({ rotation: 90, certain: true }), tourner: async () => { throw new Error('canvas'); }, recadrer });
    expect(r).toEqual({ statut: 'sens_incertain' });
  });

  // Correctif 9h58 — recadrage sur le ticket avant la vérification du sens.
  it('ticket localisé : la photo RECADRÉE sert au sens puis à la lecture, cadre rapporté', async () => {
    const cadre = { gauche: 0.15, haut: 0, droite: 0.87, bas: 1 };
    const verifier = vi.fn(async () => ({ rotation: 90, certain: true }));
    const r = await redresserPhoto('IMG', { verifier, tourner, recadrer: async () => ({ base64: 'CROP', cadre }) });
    expect(verifier).toHaveBeenCalledWith('CROP', { recadrage: cadre });
    expect(r).toEqual({ statut: 'ok', base64: 'CROP@90', rotation: 90, recadrage: cadre });
  });

  it('ticket non localisé, ou recadrage en échec : photo ENTIÈRE, le scan continue', async () => {
    const verifier = vi.fn(async () => ({ rotation: 0, certain: true }));
    expect(await redresserPhoto('IMG', { verifier, tourner, recadrer: async (b) => ({ base64: b, cadre: null }) })).toEqual({ statut: 'ok', base64: 'IMG', rotation: 0, recadrage: null });
    expect(await redresserPhoto('IMG', { verifier, tourner, recadrer: async () => { throw new Error('canvas'); } })).toEqual({ statut: 'ok', base64: 'IMG', rotation: 0, recadrage: null });
    expect(verifier).toHaveBeenNthCalledWith(2, 'IMG', { recadrage: null });
  });

  it('dimensions : un quart de tour échange largeur et hauteur, un demi-tour non', () => {
    expect(dimensionsTournees(2000, 1500, 90)).toEqual({ largeur: 1500, hauteur: 2000 });
    expect(dimensionsTournees(2000, 1500, 270)).toEqual({ largeur: 1500, hauteur: 2000 });
    expect(dimensionsTournees(1500, 2000, 180)).toEqual({ largeur: 1500, hauteur: 2000 });
    expect(dimensionsTournees(1500, 2000, 0)).toEqual({ largeur: 1500, hauteur: 2000 });
  });
});

describe('scanTicketRobuste — le sens est vérifié AVANT la lecture', () => {
  beforeEach(() => vi.clearAllMocks());
  const OK = { store: 'Utile', products: [{ name: 'Pain', price: 1.2 }] };

  it('sens incertain : aucune lecture envoyée, statut sens_incertain', async () => {
    const r = await scanTicketRobuste('b64', [], { redresser: async () => ({ statut: 'sens_incertain' }) });
    expect(r).toEqual({ statut: 'sens_incertain' });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('vérification en panne : service_indisponible, aucune lecture envoyée', async () => {
    const r = await scanTicketRobuste('b64', [], { redresser: async () => ({ statut: 'service_indisponible', message: 'panne' }) });
    expect(r).toEqual({ statut: 'service_indisponible', message: 'panne' });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('photo couchée : les deux lectures reçoivent la photo REDRESSÉE', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: OK, error: null });
    const r = await scanTicketRobuste('couchee', [], { redresser: async () => ({ statut: 'ok', base64: 'debout', rotation: 90 }) });
    expect(r.statut).toBe('ok');
    expect(r.rotation).toBe(90);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    for (const [, { body }] of supabase.functions.invoke.mock.calls) expect(body.imageBase64).toBe('debout');
  });

  // Cas réel de 9h58 : Leffe lue 3 × 1,69 (total 7,06) puis 1 × 7,06, même
  // nombre de produits : la divergence doit se voir ligne par ligne.
  it('mêmes nombres de produits mais une ligne différente -> divergentes, détail fourni, lecture cohérente gardée', async () => {
    const base = [{ libelle_ticket: 'A 1X BISCUITS CIGARET', price: 1.65, total: 1.65, qty: 1 }];
    const L1 = { total_ticket: 8.71, total_remises: 0, products: [...base, { libelle_ticket: 'B B/BLDE LEFFE', qty: 3, unit_price: 1.69, price: 1.69, total: 7.06 }] };
    const L2 = { total_ticket: 8.71, total_remises: 0, products: [...base, { libelle_ticket: 'B B/BLDE LEFFE', qty: 2, unit_price: 3.53, price: 3.53, total: 7.06 }] };
    supabase.functions.invoke
      .mockResolvedValueOnce({ data: L1, error: null })
      .mockResolvedValueOnce({ data: L2, error: null });
    const r = await scanTicketRobuste('b64', [], SANS_SENS);
    expect(r.lecturesDivergentes).toBe(true);
    expect(r.comptesLectures).toEqual([2, 2]);
    expect(r.lignesDivergentes).toHaveLength(1);
    expect(r.lignesDivergentes[0]).toMatchObject({ i: 1, libelle: 'B B/BLDE LEFFE', a: { qty: 3, prix: 1.69, total: 7.06 }, b: { qty: 2, prix: 3.53, total: 7.06 } });
    expect(r.resultat).toBe(L2); // 2 × 3,53 = 7,06 : la lecture cohérente
  });

  it('étapes annoncées dans l\'ordre : sens, puis lecture', async () => {
    supabase.functions.invoke.mockResolvedValue({ data: OK, error: null });
    const etapes = [];
    await scanTicketRobuste('b64', [], { ...SANS_SENS, onEtape: (e) => etapes.push(e) });
    expect(etapes).toEqual(['sens', 'lecture']);
  });

  it('le message de reprise existe et commence par la consigne demandée', () => {
    expect(MESSAGES_SCAN.sens_incertain).toMatch(/^Reprends la photo, téléphone bien droit/);
  });
});
