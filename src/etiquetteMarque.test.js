import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Chantier 104b — garde-fou de la séparation clé / étiquette.
//
// « Sans marque » servait À LA FOIS de clé de regroupement (Map des marques,
// clé d'ouverture `sorte||marque`) et d'étiquette affichée. Renommer la chaîne
// directement aurait cassé silencieusement les regroupements — sans erreur,
// sans test rouge, juste des marques éclatées à l'écran. Ces tests figent le
// fait que la clé technique n'a PAS bougé et que le renommage vit uniquement
// dans la fonction d'affichage.
//
// Vérification au niveau du source : le projet n'a ni jsdom ni
// testing-library, et c'est précisément là qu'une régression se glisserait —
// quelqu'un qui « nettoie » en renommant la constante technique.

const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');

describe('104b — clé technique du groupe sans marque', () => {
  it('la clé reste « Sans marque », jamais renommée', () => {
    expect(source).toMatch(/const CLE_MARQUE_ABSENTE = 'Sans marque';/);
  });

  it('c\'est bien la CLÉ qui est posée dans marqueNom, pas le libellé', () => {
    expect(source).toMatch(/row\.nom_marque\.trim\(\) : CLE_MARQUE_ABSENTE\)/);
    // Le libellé ne doit jamais servir de valeur de regroupement.
    expect(source).not.toMatch(/marqueNom:[^\n]*LIBELLE_MARQUE_ABSENTE/);
  });
});

describe('104b — étiquette affichée', () => {
  it('l\'étiquette est « Marque à compléter »', () => {
    expect(source).toMatch(/const LIBELLE_MARQUE_ABSENTE = 'Marque à compléter';/);
  });

  // Refusé après vérification en base : ce groupe (marque_id NULL) contient des
  // marques NATIONALES bien réelles (Bénénuts, Curly, Lay's, Vico...), et les
  // MDD existent déjà comme vraies marques avec est_mdd=true. L'appeler
  // « distributeurs » affirmerait que le Curly est une marque de magasin.
  it('n\'est PAS « Marques distributeurs » — ce serait factuellement faux', () => {
    expect(source).not.toMatch(/const LIBELLE_MARQUE_ABSENTE = 'Marques distributeurs'/);
  });

  it('le rendu de la ligne de marque passe par libelleMarque()', () => {
    expect(source).toMatch(/\{libelleMarque\(mq\.nom\)\}/);
  });

  it('la traduction ne s\'applique qu\'à la clé du groupe sans marque', () => {
    expect(source).toMatch(
      /const libelleMarque = \(cle\) => \(cle === CLE_MARQUE_ABSENTE \? LIBELLE_MARQUE_ABSENTE : cle\);/
    );
  });
});

// Chantier 104c — les points qui font que la croix sert vraiment sur iPhone.
describe('104c — croix d\'effacement', () => {
  it('empêche le champ de perdre le focus (le clavier doit rester ouvert)', () => {
    expect(source).toMatch(/const garderLeClavier = \(e\) => e\.preventDefault\(\);/);
    expect(source).toMatch(/onMouseDown=\{garderLeClavier\}/);
    expect(source).toMatch(/onTouchStart=\{garderLeClavier\}/);
  });

  it('redonne explicitement le focus au champ après effacement', () => {
    expect(source).toMatch(/onClick=\{\(\) => \{ onEffacer\(\); champRef\?\.current\?\.focus\(\); \}\}/);
  });

  it('porte un libellé d\'accessibilité explicite', () => {
    expect(source).toMatch(/aria-label="Effacer la recherche"/);
  });

  it('respecte la zone tactile de 44 points recommandée par Apple', () => {
    expect(source).toMatch(/const TAILLE_TACTILE = 44;/);
  });

  it('n\'affiche rien quand le champ est vide (pas de bouton mort)', () => {
    expect(source).toMatch(/function BoutonEffacerRecherche\(\{ visible, onEffacer, champRef \}\) \{\s*if \(!visible\) return null;/);
  });

  it('ne compte jamais sur la croix native de type="search"', () => {
    // Safari iOS l'affiche de façon inconstante. On ignore les lignes de
    // commentaire, qui mentionnent justement pourquoi on ne l'utilise pas.
    const enCode = source
      .split('\n')
      .filter(l => !l.trim().startsWith('//'))
      .join('\n');
    expect(enCode).not.toMatch(/type="search"/);
  });
});
