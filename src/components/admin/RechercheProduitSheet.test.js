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
});

describe('AValiderSheet — la carte OFF est le seul appelant du repli', () => {
  const appel = lire('../dev/AValiderSheet.jsx').match(/<RechercheProduitSheet[\s\S]*?\/>/);

  it('active requeteInitiale et repliProgressif', () => {
    expect(appel[0]).toMatch(/requeteInitiale=\{termesRechercheOff\(assistantOff\.off\)\}/);
    expect(appel[0]).toMatch(/repliProgressif/);
  });
});
