import { describe, it, expect } from 'vitest';
import { motsQuiClochent, phraseMotsQuiClochent } from './motsQuiClochent';

describe('motsQuiClochent (chantier 170)', () => {
  it('Pepsi Zéro proposé « Cola » : ZÉRO signalé', () => {
    expect(motsQuiClochent('*PEPSI ZERO PET 1,5L', 'Cola')).toEqual(['ZÉRO']);
  });
  it('rien à signaler quand la fiche porte le mot', () => {
    expect(motsQuiClochent('*PEPSI ZERO PET 1,5L', 'Cola zéro')).toEqual([]);
    expect(motsQuiClochent('LAIT DEMI ECR 1L', 'Lait demi-écrémé')).toEqual([]);
    expect(motsQuiClochent('*PROVENCE OEUFS SOL..', 'Œufs de sol')).toEqual([]);
  });
  it('taux de matière grasse différent', () => {
    expect(motsQuiClochent('*AUCHAN SH FB 5% 4X..', 'Steak haché pur bœuf 15% MG')).toEqual(['5 %']);
    expect(motsQuiClochent('STEAK HACHE 15%', 'Steak haché pur bœuf 15% MG')).toEqual([]);
  });
  it('œufs de sol proposés « Œufs plein air »', () => {
    expect(motsQuiClochent('*PROVENCE OEUFS SOL..', 'Œufs plein air')).toEqual(['DE SOL']);
  });
  it('bio, light, gazeuse', () => {
    expect(motsQuiClochent('YAOURT NAT BIO X4', 'Yaourt nature')).toEqual(['BIO']);
    expect(motsQuiClochent('COCA LIGHT 33CL', 'Cola')).toEqual(['LIGHT']);
    expect(motsQuiClochent('EAU MIN GAZEUSE 1L', 'Eau minérale naturelle')).toEqual(['GAZEUSE']);
  });
  it('pas de faux « sol » hors œufs, pas de « demi » hors lait', () => {
    expect(motsQuiClochent('PARASOL SOL', 'Parasol')).toEqual([]);
    expect(motsQuiClochent('DEMI BAGUETTE', 'Baguette')).toEqual([]);
  });
  it('libellés banals : rien', () => {
    expect(motsQuiClochent('*BARILLA SPAGHETTION..', 'Spaghettoni')).toEqual([]);
    expect(motsQuiClochent('', 'Cola')).toEqual([]);
  });
  it('phrase', () => {
    expect(phraseMotsQuiClochent(['ZÉRO'], 'Cola')).toBe('Le ticket dit « ZÉRO », la fiche proposée « Cola » ne le dit pas.');
    expect(phraseMotsQuiClochent([], 'Cola')).toBe('');
  });
});
