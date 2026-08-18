import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Chantier 107 — garde-fou de NON-RÉGRESSION sur la carte « Ce produit ? ».
//
// Le risque de ce chantier n'est pas de rater l'alerte : c'est qu'elle grossisse
// avec le temps jusqu'à gêner le parcours. Or on compare ici à un libellé de
// caisse, donc les fausses alertes sont attendues — un bandeau qui deviendrait
// un mur, ou un bouton principal qui changerait de ton, rendrait un geste
// LÉGITIME plus difficile qu'avant le chantier.
//
// Le projet n'a ni jsdom ni testing-library (voir RechercheProduitSheet.test.js,
// même parti pris) : on verrouille donc le contrat au niveau du source.

const source = readFileSync(new URL('./CartesScanCodeBarres.jsx', import.meta.url), 'utf8');

describe('AssistantOffCard — le bandeau du 107', () => {
  it('est calculé par la règle partagée, jamais réimplémenté dans la vue', () => {
    expect(source).toMatch(/const divergenceLigne = divergenceAvecLigneTicket\(assistant\);/);
    expect(source).toMatch(/\{divergenceLigne && \(/);
  });

  it('dit ce qu\'il a constaté, sans accuser', () => {
    expect(source).toMatch(/Ce produit ne ressemble pas à la ligne du ticket/);
  });

  it('est ambre, pas rouge : ce n\'est pas le mur du 105', () => {
    // #FFF8E1 = l'ambre déjà utilisé ailleurs pour les notes non bloquantes.
    expect(source).toMatch(/background: '#FFF8E1'[\s\S]{0,200}Ce produit ne ressemble pas/);
    // Le rouge du 105 (#FFF3F3 / #CC0000) ne doit pas s'inviter sur ce bandeau.
    expect(source).not.toMatch(/background: '#FFF3F3'[\s\S]{0,200}Ce produit ne ressemble pas/);
  });
});

describe('AssistantOffCard — rien d\'autre ne bouge (chantier 107, point 4)', () => {
  const carte = source.slice(source.indexOf('export function AssistantOffCard'), source.indexOf('export function ColonneIdentite'));

  it('le bouton principal garde son libellé et son vert', () => {
    expect(carte).toMatch(/libelleOui = '✓ Oui — choisir la fiche du catalogue'/);
    expect(carte).toMatch(/background: enCours \? '#ccc' : '#00B341'/);
  });

  it('aucun bouton n\'est désactivé par le bandeau', () => {
    // Le seul motif de désactivation reste `enCours` (une écriture en cours).
    const desactivations = carte.match(/disabled=\{[^}]*\}/g) || [];
    expect(desactivations.length).toBeGreaterThan(0);
    for (const d of desactivations) expect(d).toBe('disabled={enCours}');
    expect(carte).not.toMatch(/disabled=\{[^}]*divergenceLigne/);
  });

  it('le bandeau n\'ajoute aucune étape : pas de confirmation, pas de blocage', () => {
    expect(carte).not.toMatch(/divergenceLigne \?/);       // pas de rendu alternatif
    expect(carte).not.toMatch(/!divergenceLigne &&/);      // rien n'est masqué par lui
  });
});
