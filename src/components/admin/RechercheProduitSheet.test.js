import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Chantier 103c — garde-fou de NON-RÉGRESSION sur le parcours « Assigner le
// produit » de ValidationScanSheet.
//
// Le repli progressif (recherche mot par mot, réécriture du champ, bandeau
// d'explication) ne doit exister QUE pour la recherche automatique lancée par
// la carte OpenFoodFacts. ValidationScanSheet, lui, doit se comporter
// exactement comme au chantier 101 : champ vide, recherche de ce que
// l'utilisateur tape, rien d'autre.
//
// Le projet n'a ni jsdom ni testing-library, et en ajouter pour ce seul test
// serait disproportionné : on vérifie donc le contrat au niveau du source —
// c'est justement là qu'une régression se glisserait (une prop ajoutée par
// mégarde au mauvais appelant).

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');

describe('RechercheProduitSheet — contrat des props', () => {
  const source = lire('./RechercheProduitSheet.jsx');

  it('requeteInitiale et repliProgressif sont désactivés par défaut', () => {
    expect(source).toMatch(/requeteInitiale\s*=\s*''/);
    expect(source).toMatch(/repliProgressif\s*=\s*false/);
  });

  it('le repli n\'est armé que si les DEUX conditions sont réunies', () => {
    expect(source).toMatch(/repliArme\s*=\s*useRef\(Boolean\(repliProgressif\s*&&\s*requeteInitiale\.trim\(\)\)\)/);
  });

  it('taper dans le champ désarme le repli (retour au comportement chantier 101)', () => {
    expect(source).toMatch(/onChange=\{e\s*=>\s*\{\s*repliArme\.current\s*=\s*false;/);
  });

  // Chantier 103d — le champ ne doit JAMAIS recevoir la concaténation des mots
  // utilisés : ce texte ramène 0 fiche (la RPC exige tous les mots dans le même
  // nom_reference), donc la première frappe de correction viderait l'écran.
  it('le champ reçoit le mot le plus discriminant, pas la concaténation', () => {
    expect(source).toMatch(/const motPrincipal = motsUtilises\[0\];/);
    expect(source).toMatch(/setQuery\(motPrincipal\)/);
    expect(source).not.toMatch(/setQuery\(motsUtilises\.join/);
  });

  it('le bandeau garde la liste complète des mots, dans l\'ordre de pertinence', () => {
    expect(source).toMatch(/setNoteRepli\(\{\s*requeteEchouee,\s*mots:\s*motsUtilises\s*\}\)/);
    expect(source).toMatch(/noteRepli\.mots\.join\(', '\)/);
  });

  // Chantier 106 Lot A (retouche) — la base classe déjà par pertinence (mot
  // entier d'abord, morceau de mot ensuite). Un tri client par-dessus ferait
  // remonter « Olives vertes réduite en sel » avant « Red Bull » sur « red » :
  // exactement le bug constaté sur le terrain.
  it('interroge la RPC qui cherche aussi dans les marques et les alias', () => {
    expect(source).toMatch(/supabase\.rpc\('rechercher_produits_catalogue'/);
    expect(source).not.toMatch(/supabase\.rpc\('rechercher_produits_pour_correction'/);
  });

  it('ne retrie JAMAIS les résultats de recherche côté client', () => {
    // Le seul tri autorisé dans ce fichier porte sur les VARIANTES d'une fiche
    // déjà choisie (l'écran « Quelle quantité ? »), pas sur `results`.
    const tris = source.match(/\.sort\(/g) || [];
    expect(tris).toHaveLength(1);
    expect(source).toMatch(/setVariantesAChoisir\(\[\.\.\.liste\]\.sort\(/);
    expect(source).not.toMatch(/setResults\([^)]*\.sort\(/);
    expect(source).not.toMatch(/results\.sort\(/);
  });

  it('la ligne grise vient de sousTitreResultat et n\'est rendue que si elle existe', () => {
    expect(source).toMatch(/const sousTitreLigne = sousTitreResultat\(p\);/);
    expect(source).toMatch(/\{sousTitreLigne && \(/);
  });

  // Chantier 106 Lot A (retouche) — le prix indicatif et le signal « déjà vu
  // dans cette enseigne » reviennent : c'est ce dernier qui évite de rattacher
  // un ticket Leclerc à une fiche jamais relevée chez Leclerc.
  it('le prix indicatif passe par formatPrixIndicatif et n\'est rendu que s\'il existe', () => {
    expect(source).toMatch(/const prix = formatPrixIndicatif\(p\.dernier_prix\);/);
    expect(source).toMatch(/\{prix && \(/);
    // Plus de formatage à la main : ni zéro ni tiret ne doivent pouvoir revenir.
    expect(source).not.toMatch(/dernier_prix\s*!=\s*null/);
  });

  it('« déjà vu ici » n\'est rendu que si la base le signale', () => {
    expect(source).toMatch(/\{p\.deja_vu_dans_enseigne && \(/);
    expect(source).toMatch(/déjà vu ici/);
  });

  it('l\'enseigne est facultative et transmise telle quelle à la RPC', () => {
    expect(source).toMatch(/enseigneId = null/);
    expect(source).toMatch(/p_enseigne:\s*enseigneId \?\? null/);
  });

  it('la sélection du texte prérempli au premier focus est conservée', () => {
    expect(source).toMatch(/selectionFaite\.current = true;\s*e\.target\.select\(\)/);
  });
});

describe('non-régression — ValidationScanSheet garde le comportement du 101', () => {
  const appel = lire('./ValidationScanSheet.jsx').match(/<RechercheProduitSheet[\s\S]*?\/>/);

  it('monte bien RechercheProduitSheet', () => {
    expect(appel).not.toBeNull();
  });

  it('n\'active ni requeteInitiale ni repliProgressif', () => {
    expect(appel[0]).not.toMatch(/requeteInitiale/);
    expect(appel[0]).not.toMatch(/repliProgressif/);
  });

  // La RPC qui alimente cet écran ne renvoie ni magasin ni enseigne, et la RLS
  // « lecture propre » de lignes_ticket interdit de remonter au ticket d'un
  // autre utilisateur : il n'y a rien d'honnête à passer ici.
  it('ne passe pas enseigneId (donnée indisponible sur cet écran)', () => {
    expect(appel[0]).not.toMatch(/enseigneId/);
  });
});

describe('AValiderSheet — la carte OFF est le seul appelant du repli', () => {
  const appel = lire('../dev/AValiderSheet.jsx').match(/<RechercheProduitSheet[\s\S]*?\/>/);

  it('active requeteInitiale et repliProgressif', () => {
    expect(appel[0]).toMatch(/requeteInitiale=\{termesRechercheOff\(assistantOff\.off\)\}/);
    expect(appel[0]).toMatch(/repliProgressif/);
  });

  // Chantier 106 Lot A (retouche) — cet écran traite un ticket, donc il connaît
  // son enseigne : c'est le seul appelant qui peut alimenter « déjà vu ici ».
  it('passe l\'enseigne du ticket de la ligne traitée', () => {
    expect(appel[0]).toMatch(/enseigneId=\{enseigneDeLigne\(assistantOff\.ligneId\)\}/);
  });
});

describe('module de contribution — aucune enseigne à passer', () => {
  const appel = lire('../../components/ContributionCodeBarresSheet.jsx').match(/<RechercheProduitSheet[\s\S]*?\/>/);

  it('ne passe pas enseigneId : un scan de placard n\'a pas de magasin', () => {
    expect(appel).not.toBeNull();
    expect(appel[0]).not.toMatch(/enseigneId/);
  });
});
