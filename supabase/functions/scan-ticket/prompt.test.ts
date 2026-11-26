// Edge Function scan-ticket v14 — tests du prompt et de la normalisation.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  construirePromptTicket, lireImagesRequete, normaliserSortieV14,
  CONSIGNE_V14_RECOLLAGE, CONSIGNE_V14_CHAMPS, CONSIGNE_V14_LIGNES, CONSIGNE_V14_REMISES,
} from './prompt';

const CATALOGUE = [{ nom: 'Lait demi-écrémé', categorie: 'Crèmerie' }, { nom: 'Poulet rôti', categorie: 'Traiteur' }];

// Reconstitue le prompt EXACT de la v13 déployée à partir de son source
// commité (1d4388e), en évaluant son gabarit. Null si git est indisponible.
function promptV13Commite(refProducts, nbImages, isMulti) {
  let src;
  try {
    src = execFileSync('git', ['show', '1d4388e:supabase/functions/scan-ticket/index.ts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const ref = src.slice(src.indexOf('const refSection'), src.indexOf('const response = await fetch'))
    .replace('(p: { nom: string; categorie: string })', '(p)');
  const debut = src.indexOf('{ type: "text", text: ') + '{ type: "text", text: '.length;
  const gabarit = src.slice(debut, src.indexOf('` },\n          ],') + 1);
  return new Function('refProducts', 'images', 'isMulti', `${ref}\nreturn ${gabarit};`)(refProducts, Array(nbImages).fill('x'), isMulti);
}

describe('prompt v14 = prompt v13 + ajouts (rien retiré, rien modifié)', () => {
  const cas = [[1, [], false], [1, CATALOGUE, false], [3, [], true], [3, CATALOGUE, true], [1, [], true]];

  it.each(cas)('mode v13 identique au caractère près au fichier v13 déployé (images=%s)', (n, rp, multi) => {
    const v13 = promptV13Commite(rp, n, multi);
    if (v13 == null) return; // git indisponible : vérification impossible ici
    expect(construirePromptTicket({ nbImages: n, refProducts: rp, multi, consignesV14: false })).toBe(v13);
  });

  it.each(cas)('v14 contient toutes les lignes v13, dans l\'ordre (images=%s)', (n, rp, multi) => {
    const v13 = construirePromptTicket({ nbImages: n, refProducts: rp, multi, consignesV14: false }).split('\n');
    const v14 = construirePromptTicket({ nbImages: n, refProducts: rp, multi }).split('\n');
    let i = 0;
    for (const ligne of v13) {
      const j = v14.indexOf(ligne, i);
      expect(j, `ligne v13 absente de v14 : ${ligne.slice(0, 60)}`).toBeGreaterThanOrEqual(0);
      i = j + 1;
    }
  });

  it('recollage seulement avec plusieurs images ; lignes/remises/sections pour toutes', () => {
    const une = construirePromptTicket({ nbImages: 1 });
    const trois = construirePromptTicket({ nbImages: 3 });
    expect(une).not.toContain(CONSIGNE_V14_RECOLLAGE.trim());
    expect(trois).toContain(CONSIGNE_V14_RECOLLAGE.trim());
    for (const p of [une, trois]) {
      expect(p).toContain(CONSIGNE_V14_CHAMPS.trim());
      expect(p).toContain(CONSIGNE_V14_LIGNES.trim());
    }
  });

  it('consignes demandées : doublons de jonction, 2 x 8.09, remise sous la ligne, sections ignorées, captures', () => {
    const p = construirePromptTicket({ nbImages: 2 });
    expect(p).toMatch(/1 à 3 lignes peuvent se RÉPÉTER \(même libellé ET même prix\)/);
    expect(p).toMatch(/"captures_peut_etre_incompletes": true/);
    expect(p).toMatch(/"2 x 8\.09 … 16\.18".*qty = 2, unit_price = price = 8\.09, total = 16\.18/s);
    expect(p).toMatch(/Ne crée JAMAIS deux lignes/);
    expect(p).toMatch(/Remise immédiate -2,15.*"remise".*AVANT remise.*JAMAIS une ligne de "products"/s);
    expect(p).toMatch(/Détails de vos avantages fidélité/);
    expect(p).toMatch(/carte bancaire/);
    // la règle des trois cas de total_remises reste intacte
    expect(p).toContain('- Si le ticket ne comporte AUCUNE remise ni promotion : mets 0.');
    expect(p).toContain('- Si un total de remises est imprimé : recopie-le.');
    expect(p).toMatch(/QU'AUCUN total de remises n'est imprimé : mets null\. NE LES ADDITIONNE PAS/);
  });

  // Banc d'essai du 09/11 : Netto (avantages produits crédités) et Leclerc
  // (« Bon immédiat » réglé après le total) sortaient un total_remises faux.
  it('précisions v14 : avantages fidélité ≠ remise, bon utilisé après le total = paiement, remise de ligne AVANT le total', () => {
    const p = construirePromptTicket({ nbImages: 2 });
    expect(p).toContain(CONSIGNE_V14_REMISES.trim());
    expect(p).toMatch(/"AVANTAGES PRODUITS".*ne sont PAS des remises/s);
    expect(p).toMatch(/si le total payé est égal à la somme des lignes article, aucune remise n'a été déduite/);
    expect(p).toMatch(/"Bon immédiat".*APRÈS le total parmi les moyens de paiement.*pas une remise/s);
    expect(p).toMatch(/DANS la liste des articles et AVANT le total/);
    // Décision de François (09/11) : sur le Leclerc Drive, total = 76,15 (articles), pas 74,35 (CB après bon).
    expect(p).toMatch(/JAMAIS le montant restant débité par carte après ce bon/);
    expect(p).toMatch(/"Total 30 articles 76\.15 \/ Bon immediat 1\.80 \/ CB Web Drive 74\.35" -> total_ticket = 76\.15, total_remises = 0/);
    expect(p).toMatch(/"Total avant remises 20\.37 \/ Total Remises immédiates -2\.15 \/ Total à payer 18\.22" -> total_ticket = 18\.22, total_remises = 2\.15/);
    // placées juste après la règle des trois cas, qui précède toujours DATE
    expect(p.indexOf(CONSIGNE_V14_REMISES.trim())).toBeGreaterThan(p.indexOf('NE LES ADDITIONNE PAS'));
    expect(p.indexOf(CONSIGNE_V14_REMISES.trim())).toBeLessThan(p.indexOf('DATE — même exigence'));
  });
});

describe('entrée : quatre noms de champ', () => {
  it('imageBase64 (v13, app actuelle) -> une image, pas de mode morceaux', () => {
    expect(lireImagesRequete({ imageBase64: 'a' })).toEqual({ images: ['a'], multi: false });
  });
  it('image (contrat 120) -> idem', () => {
    expect(lireImagesRequete({ image: 'a' })).toEqual({ images: ['a'], multi: false });
  });
  it('imagesBase64 / images -> liste dans l\'ordre, mode morceaux (même avec une seule, comme en v13)', () => {
    expect(lireImagesRequete({ imagesBase64: ['a', 'b'] })).toEqual({ images: ['a', 'b'], multi: true });
    expect(lireImagesRequete({ images: ['a', 'b', 'c'] })).toEqual({ images: ['a', 'b', 'c'], multi: true });
    expect(lireImagesRequete({ imagesBase64: ['a'] })).toEqual({ images: ['a'], multi: true });
  });
  it('rien d\'exploitable -> liste vide', () => {
    expect(lireImagesRequete({})).toEqual({ images: [], multi: false });
    expect(lireImagesRequete({ images: [] , image: '' })).toEqual({ images: [], multi: false });
  });
});

describe('sortie : champs v14 garantis, le reste intact', () => {
  it('remise par défaut 0, négative -> positive ; captures par défaut false', () => {
    const r = normaliserSortieV14({ total_ticket: 2.14, total_remises: 2.15, date: '2026-03-14', products: [{ name: 'X', total: 4.29, remise: -2.15 }, { name: 'Y', total: 1 }] });
    expect(r.products.map((p) => p.remise)).toEqual([2.15, 0]);
    expect(r.captures_peut_etre_incompletes).toBe(false);
    expect(r).toMatchObject({ total_ticket: 2.14, total_remises: 2.15, date: '2026-03-14' });
  });
  it('captures true conservé', () => {
    expect(normaliserSortieV14({ products: [], captures_peut_etre_incompletes: true }).captures_peut_etre_incompletes).toBe(true);
  });
});

describe('v18 — un mot entier n\'est pas une abréviation (JUST FOUR CLASSI)', () => {
  it('la consigne est dans le prompt en service, avant la règle des attributs', () => {
    const p = construirePromptTicket({ nbImages: 1, refProducts: CATALOGUE, multi: false });
    expect(p).toContain('"JUST" n\'est PAS "jus"');
    expect(p.indexOf('JUST FOUR CLASSI')).toBeLessThan(p.indexOf("NE JAMAIS INVENTER D'ATTRIBUT"));
  });
  it('le mode ancien (v13) reste inchangé', () => {
    expect(construirePromptTicket({ nbImages: 1, refProducts: CATALOGUE, multi: false, consignesV14: false })).not.toContain('JUST FOUR');
  });
});
