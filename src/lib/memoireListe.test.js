import { describe, it, expect } from 'vitest';
import { cleMemoire, lireMemoire, choixARetenir, souvenir } from './memoireListe';
import { proposerLiaison, LIAISON_RELIE } from './liaisonAutoListe';

describe('mémoire personnelle de la liste', () => {
  it('même clé quelle que soit la façon de le dire', () => {
    expect(cleMemoire('Du Coca !')).toBe(cleMemoire('coca'));
    expect(cleMemoire('des yaourts')).toBe(cleMemoire('Yaourt'));
    expect(cleMemoire('du')).toBeNull();
    expect(cleMemoire('')).toBeNull();
    expect(cleMemoire('x'.repeat(200))).toBeNull();
  });
  it('lit le carnet, ignore les fiches désactivées et les lignes abîmées', () => {
    expect(lireMemoire([
      { texte_normalise: 'coca', produit_id: 'z', produits: { nom_reference: 'Cola zéro', actif: true } },
      { texte_normalise: 'vieux', produit_id: 'v', produits: { nom_reference: 'Fiche fusionnée', actif: false } },
      { texte_normalise: 'sans fiche', produit_id: 'x', produits: null },
      null,
    ])).toEqual({ coca: { produit_id: 'z', produit_nom: 'Cola zéro' } });
    expect(lireMemoire(null)).toEqual({});
  });
  it('retient un choix, sauf s\'il n\'y a rien à apprendre', () => {
    expect(choixARetenir('du coca', { produit_id: 'z', produit_nom: 'Cola zéro' })).toEqual({ texte_normalise: 'coca', produit_id: 'z' });
    expect(choixARetenir('des yaourts nature', { produit_id: 'y', produit_nom: 'Yaourt nature' })).toBeNull();
    expect(choixARetenir('', { produit_id: 'y', produit_nom: 'Yaourt nature' })).toBeNull();
    expect(choixARetenir('coca', null)).toBeNull();
  });
  it('retrouve un souvenir', () => {
    const m = { coca: { produit_id: 'z', produit_nom: 'Cola zéro' } };
    expect(souvenir(m, 'Du coca')).toEqual({ produit_id: 'z', produit_nom: 'Cola zéro' });
    expect(souvenir(m, 'du lait')).toBeNull();
    expect(souvenir(null, 'coca')).toBeNull();
  });
  it('un souvenir relie tout de suite, sans chercher', async () => {
    let appels = 0;
    const chercher = async () => { appels++; return []; };
    const d = await proposerLiaison('du coca', chercher, { memoire: { coca: { produit_id: 'z', produit_nom: 'Cola zéro' } } });
    expect(d.issue).toBe(LIAISON_RELIE);
    expect(d.produit).toMatchObject({ produit_id: 'z', produit_nom: 'Cola zéro', memorise: true });
    expect(appels).toBe(0);
  });
  it('sans souvenir, la recherche habituelle', async () => {
    let appels = 0;
    const chercher = async () => { appels++; return []; };
    await proposerLiaison('du lait', chercher, { memoire: { coca: { produit_id: 'z', produit_nom: 'Cola zéro' } } });
    expect(appels).toBeGreaterThan(0);
  });
});
