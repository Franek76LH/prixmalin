import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Chantier 108 — garde-fou de NON-RÉGRESSION sur le branchement du contrôle.
//
// La logique elle-même est testée dans lib/coherenceTicket.test.js. Ce qui ne
// s'y voit pas, c'est le BRANCHEMENT : un chemin de scan qu'on oublierait de
// faire passer par le portillon rendrait tout le chantier inopérant sans qu'un
// seul test unitaire ne bronche. Or c'est exactement ce qui est arrivé le
// 18/08 — 31 lignes fausses entrées sans un mot.
//
// Le projet n'a ni jsdom ni testing-library (même parti pris que
// RechercheProduitSheet.test.js) : on verrouille au niveau du source.

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');
const app = lire('../App.jsx');
const ecrans = lire('./ControleLectureTicket.jsx');

describe('branchement du portillon (App.jsx)', () => {
  // Chaque lecture OCR arrive par « const parsed = scan.resultat; ».
  const chemins = app.split('const parsed = scan.resultat;').slice(1);

  it('il y a bien plusieurs chemins de scan (caméra, galerie, autres options)', () => {
    expect(chemins.length).toBeGreaterThanOrEqual(3);
  });

  it('AUCUN chemin de scan n\'écrit result avant d\'avoir passé le contrôle', () => {
    for (const suite of chemins) {
      const posControle = suite.indexOf('controlerLecture(parsed)');
      const posResult = suite.indexOf('setResult(parsed)');
      expect(posControle).toBeGreaterThanOrEqual(0);
      expect(posResult).toBeGreaterThanOrEqual(0);
      expect(posControle).toBeLessThan(posResult); // le contrôle d'abord, toujours
    }
  });

  it('un résultat déjà scanné en amont passe par le même portillon', () => {
    const avantInitial = app.slice(0, app.indexOf('setResult(initialResult);'));
    expect(avantInitial).toMatch(/controlerLecture\(initialResult\)/);
  });

  it('le refus passe devant tout le reste et n\'est pas un simple message', () => {
    expect(app).toMatch(/\{lectureRefusee && \(\s*<EcranLectureRefusee/);
  });
});

describe('l\'écran de refus ne laisse aucune porte dérobée', () => {
  it('offre exactement deux sorties : reprendre la photo, ou saisir à la main', () => {
    expect(ecrans).toMatch(/Reprendre la photo/);
    expect(ecrans).toMatch(/Saisie manuelle/);
  });

  // Au-delà de 10 % d'écart il n'y a rien à sauver dans la lecture : proposer
  // « continuer quand même » reviendrait à remettre les trente lignes fausses
  // dans la file, ce que tout le chantier cherche à empêcher.
  it('ne propose JAMAIS d\'importer quand même', () => {
    const refus = ecrans.slice(ecrans.indexOf('export function EcranLectureRefusee'), ecrans.indexOf('export function BandeauLectureIncomplete'));
    expect(refus).not.toMatch(/quand même/i);
    expect(refus).not.toMatch(/continuer/i);
    expect(refus).not.toMatch(/importer malgré/i);
  });

  it('dit explicitement que rien n\'a été enregistré', () => {
    expect(ecrans).toMatch(/Aucune ligne n'a été enregistrée/);
  });
});

describe('l\'avertissement, lui, ne bloque rien', () => {
  it('n\'est qu\'un bandeau : aucun bouton, aucune sortie', () => {
    const bandeau = ecrans.slice(ecrans.indexOf('export function BandeauLectureIncomplete'), ecrans.indexOf('const formatDateFr'));
    expect(bandeau).not.toMatch(/<button/);
    expect(bandeau).toMatch(/La lecture semble incomplète/);
  });

  it('est ambre, pas rouge', () => {
    const bandeau = ecrans.slice(ecrans.indexOf('export function BandeauLectureIncomplete'), ecrans.indexOf('const formatDateFr'));
    expect(bandeau).toMatch(/#FFF8E1/);
  });
});
