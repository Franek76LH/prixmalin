// Chantier 94 Lot 10 — tests Points Malin / niveaux / badges (affichage).
import { describe, it, expect } from 'vitest';
import {
  NIVEAUX,
  agregerPoints,
  calculerNiveau,
  progressionBadge,
  detecterNouveauxBadges,
  statistiquesContributions,
} from './gamificationCore';

const mv = (sur) => ({ type_contribution: 'prix_ajout', points: 10, statut: 'valide', contexte: { magasin_id: 'm1' }, ...sur });

describe('agregerPoints', () => {
  it('somme par statut ; refuse/annule ignorés ; entrées vides ok', () => {
    const r = agregerPoints([
      mv({ points: 10, statut: 'valide' }),
      mv({ points: 5, statut: 'valide' }),
      mv({ points: 10, statut: 'en_attente' }),
      mv({ points: 10, statut: 'refuse' }),
      mv({ points: 10, statut: 'annule' }),
      mv({ points: 'abc', statut: 'valide' }),
    ]);
    expect(r).toEqual({ total_valide: 15, total_en_attente: 10 });
    expect(agregerPoints(null)).toEqual({ total_valide: 0, total_en_attente: 0 });
  });
});

describe('calculerNiveau — chaque seuil', () => {
  it('grille des niveaux conforme à la décision produit', () => {
    expect(NIVEAUX.map(n => [n.nom, n.seuil])).toEqual([
      ['Observateur', 0], ['Éclaireur', 100], ['Contributeur', 300], ['Expert', 750], ['Ambassadeur', 1500],
    ]);
  });

  it.each([
    [0,    'Observateur',  100,  100],
    [99,   'Observateur',  100,  1],
    [100,  'Éclaireur',    300,  200],
    [299,  'Éclaireur',    300,  1],
    [300,  'Contributeur', 750,  450],
    [749,  'Contributeur', 750,  1],
    [750,  'Expert',       1500, 750],
    [1499, 'Expert',       1500, 1],
    [1500, 'Ambassadeur',  null, 0],
    [9999, 'Ambassadeur',  null, 0],
  ])('%i points -> %s (suivant %o, restants %i)', (points, nom, seuilSuivant, restants) => {
    const n = calculerNiveau(points);
    expect(n.niveau_actuel).toBe(nom);
    expect(n.seuil_suivant).toBe(seuilSuivant);
    expect(n.points_restants).toBe(restants);
  });

  it('progression : bornes et pourcentage', () => {
    expect(calculerNiveau(0).progression_pct).toBe(0);
    expect(calculerNiveau(50).progression_pct).toBe(50);   // 50/100 vers Éclaireur
    expect(calculerNiveau(200).progression_pct).toBe(50);  // (200-100)/(300-100)
    expect(calculerNiveau(1500).progression_pct).toBe(100);
    expect(calculerNiveau(-5).points).toBe(0);
    expect(calculerNiveau('abc').points).toBe(0);
  });
});

describe('progressionBadge — miroir de la logique serveur (validés uniquement)', () => {
  it('premiere_contribution : cap à 1, en_attente ne compte pas', () => {
    expect(progressionBadge('premiere_contribution', 1, [])).toEqual({ obtenu: false, courant: 0, seuil: 1 });
    expect(progressionBadge('premiere_contribution', 1, [mv({ statut: 'en_attente' })]).obtenu).toBe(false);
    expect(progressionBadge('premiere_contribution', 1, [mv(), mv(), mv()])).toEqual({ obtenu: true, courant: 1, seuil: 1 });
  });

  it('prix_valides : uniquement prix_ajout / prix_actualisation validés', () => {
    const mouvements = [
      mv({ type_contribution: 'prix_ajout' }),
      mv({ type_contribution: 'prix_actualisation' }),
      mv({ type_contribution: 'autre_chose' }),
      mv({ type_contribution: 'prix_ajout', statut: 'en_attente' }),
    ];
    expect(progressionBadge('prix_valides', 10, mouvements)).toEqual({ obtenu: false, courant: 2, seuil: 10 });
    expect(progressionBadge('prix_valides', 2, mouvements).obtenu).toBe(true);
  });

  it('contrib_meme_magasin : max par magasin, magasin_id manquant ignoré', () => {
    const mouvements = [
      mv(), mv(), mv({ contexte: { magasin_id: 'm2' } }), mv({ contexte: {} }), mv({ contexte: null }),
    ];
    expect(progressionBadge('contrib_meme_magasin', 50, mouvements)).toEqual({ obtenu: false, courant: 2, seuil: 50 });
    expect(progressionBadge('contrib_meme_magasin', 2, mouvements).obtenu).toBe(true);
  });

  it('magasins_distincts : comptés une fois chacun, validés seulement', () => {
    const mouvements = [
      mv(), mv(), mv({ contexte: { magasin_id: 'm2' } }),
      mv({ contexte: { magasin_id: 'm3' }, statut: 'en_attente' }),
    ];
    expect(progressionBadge('magasins_distincts', 5, mouvements)).toEqual({ obtenu: false, courant: 2, seuil: 5 });
  });

  it('condition inconnue : progression non calculable, jamais obtenu', () => {
    expect(progressionBadge('mystere', 3, [mv()])).toEqual({ obtenu: false, courant: null, seuil: 3 });
  });
});

describe('detecterNouveauxBadges', () => {
  it('ne signale que les codes jamais vus ; entrées nulles ok', () => {
    const badges = [{ code_badge: 'a' }, { code_badge: 'b' }, { code_badge: null }];
    expect(detecterNouveauxBadges(['a'], badges)).toEqual(['b']);
    expect(detecterNouveauxBadges(null, badges)).toEqual(['a', 'b']);
    expect(detecterNouveauxBadges(['a', 'b'], badges)).toEqual([]);
    expect(detecterNouveauxBadges(['a'], null)).toEqual([]);
  });
});

describe('statistiquesContributions', () => {
  it('comptes réels par type + magasins distincts, refusés/annulés exclus', () => {
    const r = statistiquesContributions([
      mv(), mv({ statut: 'en_attente' }),
      mv({ type_contribution: 'prix_actualisation' }),
      mv({ statut: 'refuse' }), mv({ statut: 'annule' }),
      mv({ contexte: { magasin_id: 'm2' } }),
    ]);
    expect(r).toEqual({ prix_ajoutes: 3, prix_actualises: 1, magasins_contribues: 2 });
    expect(statistiquesContributions(null)).toEqual({ prix_ajoutes: 0, prix_actualises: 0, magasins_contribues: 0 });
  });
});
