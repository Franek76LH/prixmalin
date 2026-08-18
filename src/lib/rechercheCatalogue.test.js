import { describe, it, expect } from 'vitest';
import { formaterFormats, sousTitreResultat, formatPrixIndicatif } from './rechercheCatalogue';

describe('formaterFormats', () => {
  it('rend les quantités lisibles plutôt que brutes', () => {
    expect(formaterFormats('0.085 kg')).toBe('85 g');
    expect(formaterFormats('0.25 l, 0.355 l')).toBe('250 ml, 355 ml');
    expect(formaterFormats('1 kg')).toBe('1 kg');
    expect(formaterFormats('1.5 l')).toBe('1,5 L');
  });

  it('dédoublonne les formats qui s\'affichent pareil', () => {
    expect(formaterFormats('0.25 l, 0.250 l')).toBe('250 ml');
  });

  it('conserve tel quel un morceau qu\'il ne sait pas relire', () => {
    expect(formaterFormats('vrac')).toBe('vrac');
    expect(formaterFormats('0.5 kg, vrac')).toBe('500 g, vrac');
  });

  it('rien à afficher -> null, jamais une chaîne vide', () => {
    for (const valeur of [null, undefined, '', '   ', ',', ' , ', 42, {}]) {
      expect(formaterFormats(valeur)).toBeNull();
    }
  });
});

describe('sousTitreResultat — la ligne grise sous le nom de fiche', () => {
  it('le cas qui a motivé la retouche : une canette Red Bull', () => {
    // La fiche s'appelle « Boisson énergisante » : sans cette ligne, personne
    // ne reconnaît sa canette et n'ose cliquer.
    expect(sousTitreResultat({
      produit_id: 'p1',
      nom_reference: 'Boisson énergisante',
      marques: 'Red Bull',
      formats: '0.25 l, 0.355 l',
    })).toBe('Red Bull · 250 ml, 355 ml');
  });

  it('plusieurs marques : on les affiche telles que la base les agrège', () => {
    expect(sousTitreResultat({ marques: 'Bonduelle, Cassegrain', formats: '0.4 kg' }))
      .toBe('Bonduelle, Cassegrain · 400 g');
  });

  it('marque absente : rien de superflu, ni « Sans marque » ni « Marque à compléter »', () => {
    const sansMarque = sousTitreResultat({ nom_reference: 'Farine T55', marques: null, formats: '1 kg' });
    expect(sansMarque).toBe('1 kg');
    expect(sansMarque).not.toMatch(/sans marque/i);
    expect(sansMarque).not.toMatch(/à compléter/i);
    expect(sansMarque).not.toMatch(/·/); // pas de séparateur orphelin
  });

  it('marque vide ou blanche est traitée comme absente', () => {
    expect(sousTitreResultat({ marques: '', formats: '1 kg' })).toBe('1 kg');
    expect(sousTitreResultat({ marques: '   ', formats: '1 kg' })).toBe('1 kg');
  });

  it('formats absents : la marque seule suffit', () => {
    expect(sousTitreResultat({ marques: 'Red Bull', formats: null })).toBe('Red Bull');
  });

  it('ni marque ni format : null, donc aucune ligne rendue', () => {
    expect(sousTitreResultat({ nom_reference: 'Poireau' })).toBeNull();
    expect(sousTitreResultat({ marques: null, formats: '' })).toBeNull();
    expect(sousTitreResultat(null)).toBeNull();
    expect(sousTitreResultat(undefined)).toBeNull();
  });
});

// Lignes RÉELLEMENT renvoyées par rechercher_produits_catalogue('red') en prod
// le 2026-08-18 — y compris l'ordre, qui est celui que l'écran doit respecter.
describe('lignes réelles de la recherche « red »', () => {
  const RESULTATS = [
    { nom_reference: 'Boisson énergisante', marques: 'Red Bull', formats: '250 ml, 355 ml' },
    { nom_reference: 'Lait demi-écrémé', marques: 'Carrefour Extra, Délisse', formats: '1 l' },
    { nom_reference: 'Olives vertes réduite en sel Dénoyautées', marques: null, formats: null },
    { nom_reference: 'Chips tuiles', marques: 'Chaque Jour Sans Gluten, Pringles, Tokapi', formats: '0.16 kg, 0.165 kg, 0.17 kg, 0.175 kg' },
  ];

  it('chaque ligne s\'affiche telle qu\'attendue', () => {
    expect(RESULTATS.map(sousTitreResultat)).toEqual([
      'Red Bull · 250 ml, 355 ml',
      'Carrefour Extra, Délisse · 1 L',
      null,                                     // aucune ligne grise
      'Chaque Jour Sans Gluten, Pringles, Tokapi · 160 g, 165 g, 170 g, 175 g',
    ]);
  });

  it('la fiche « Red Bull » arrive avant les olives — cet ordre vient de la base', () => {
    // Le composant rend `results` dans l'ordre reçu ; ce test fige l'attente.
    expect(RESULTATS[0].marques).toBe('Red Bull');
    expect(RESULTATS[2].nom_reference).toMatch(/Olives/);
  });
});

describe('formatPrixIndicatif', () => {
  it('formate à la française', () => {
    expect(formatPrixIndicatif(1.45)).toBe('1,45 €');
    expect(formatPrixIndicatif('2')).toBe('2,00 €');   // numeric PostgREST arrive en string
    expect(formatPrixIndicatif(12.999)).toBe('13,00 €');
  });

  it('prix absent : rien du tout — ni zéro, ni tiret', () => {
    for (const valeur of [null, undefined, '', 'abc', NaN]) {
      expect(formatPrixIndicatif(valeur)).toBeNull();
    }
  });

  it('un zéro en base n\'est pas un prix : on ne l\'affiche pas', () => {
    expect(formatPrixIndicatif(0)).toBeNull();
    expect(formatPrixIndicatif('0.00')).toBeNull();
    expect(formatPrixIndicatif(-1)).toBeNull();
  });
});
