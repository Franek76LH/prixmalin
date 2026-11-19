import { describe, it, expect } from 'vitest';
import { lireReponseIA, fusionnerPropositions, ficheARelierSeule, RELIER_SEUL_SI_IA_SURE } from './rapprochementIA';

const P = (id, nom = id, extra = {}) => ({ produit_id: id, produit_nom: nom, ...extra });

describe('rapprochement par le sens', () => {
  it('relie seule uniquement une fiche unique et sûre', () => {
    expect(RELIER_SEUL_SI_IA_SURE).toBe(true);
    expect(ficheARelierSeule({ propositions: [P('biere', 'Bière')], sur: true })).toEqual(P('biere', 'Bière'));
    expect(ficheARelierSeule({ propositions: [P('biere', 'Bière')], sur: false })).toBeNull();
    expect(ficheARelierSeule({ propositions: [P('a'), P('b')], sur: true })).toBeNull();
    expect(ficheARelierSeule({ propositions: [], sur: true })).toBeNull();
    expect(ficheARelierSeule({ propositions: [P('a')], sur: 'oui' })).toBeNull();
    expect(ficheARelierSeule(null)).toBeNull();
  });
  it('lit la réponse de la fonction', () => {
    const r = lireReponseIA({ resultats: [
      { id: 'a', propositions: [P('essuie', 'Essuie-tout')], sur: true },
      { id: 'b', propositions: [P('cola'), P('cola'), P('zero')], sur: true },
      { id: 'c', propositions: [], sur: false },
    ] });
    expect(r.a).toEqual({ propositions: [P('essuie', 'Essuie-tout')], sur: true });
    expect(r.b.propositions.map(p => p.produit_id)).toEqual(['cola', 'zero']);
    expect(r.b.sur).toBe(false);
    expect(r.c).toBeUndefined();
  });
  it('réponse vide, en panne ou mal formée : rien, sans plantage', () => {
    expect(lireReponseIA(null)).toEqual({});
    expect(lireReponseIA({ resultats: 'x' })).toEqual({});
    expect(lireReponseIA({ resultats: [{ id: 'a', propositions: [{ produit_id: 5 }, null, { produit_id: 'x' }] }, { propositions: [P('y')] }] })).toEqual({});
  });
  it('fusion : l\'accord des deux méthodes d\'abord, puis l\'IA, puis les mots', () => {
    const f = fusionnerPropositions([P('ia-seule'), P('commune')], [P('mots-seule'), P('commune')]);
    expect(f.map(p => p.produit_id)).toEqual(['commune', 'ia-seule', 'mots-seule']);
  });
  it('fusion : 3 au plus, sans doublon', () => {
    const f = fusionnerPropositions([P('a'), P('b'), P('a')], [P('c'), P('d'), P('b')]);
    expect(f.map(p => p.produit_id)).toEqual(['b', 'a', 'c']);
  });
  it('fusion : la mention « déjà acheté » est gardée ou retrouvée', () => {
    const f = fusionnerPropositions([P('a'), P('b')], [P('a', 'a', { dejaAchete: true })], { b: 2 });
    expect(f).toEqual([{ produit_id: 'a', produit_nom: 'a', dejaAchete: true }, { produit_id: 'b', produit_nom: 'b', dejaAchete: true }]);
  });
  it('fusion : sans IA, les propositions habituelles restent telles quelles', () => {
    const mots = [P('a', 'a', { dejaAchete: false }), P('b', 'b', { dejaAchete: true })];
    expect(fusionnerPropositions(null, mots)).toEqual(mots);
    expect(fusionnerPropositions([], [])).toEqual([]);
  });
});
