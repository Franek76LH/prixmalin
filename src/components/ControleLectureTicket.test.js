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

  // Correctif « scan anti-invention » — la suite d'une lecture acceptée
  // (setResult & co) est désormais UNE fonction, poursuivreLecture, appelée
  // par chaque chemin APRÈS le portillon. Le verrou porte donc sur l'ordre
  // contrôle -> poursuivreLecture, et sur le fait que setResult(parsed)
  // n'existe plus que dans poursuivreLecture (hors collage JSON manuel).
  it('AUCUN chemin de scan n\'écrit result avant d\'avoir passé le contrôle', () => {
    for (const suite of chemins) {
      const posControle = suite.indexOf('controlerLecture(parsed');
      const posSuite = suite.indexOf('poursuivreLecture(parsed');
      expect(posControle).toBeGreaterThanOrEqual(0);
      expect(posSuite).toBeGreaterThanOrEqual(0);
      expect(posControle).toBeLessThan(posSuite); // le contrôle d'abord, toujours
      expect(suite.slice(0, posSuite)).not.toMatch(/setResult\(parsed\)/);
    }
  });

  it('setResult(parsed) ne vit que dans poursuivreLecture, elle-même définie après le portillon', () => {
    const corps = app.slice(app.indexOf('const poursuivreLecture = async'), app.indexOf('const continuerLectureDouteuse'));
    expect(corps).toMatch(/setResult\(parsed\)/);
    expect(app.indexOf('const controlerLecture = ')).toBeLessThan(app.indexOf('const poursuivreLecture = async'));
    // « Continuer quand même » ne part que d'une lecture mise en attente PAR le portillon
    expect(app).toMatch(/const continuerLectureDouteuse = async \(\) => \{\s*const attente = lectureDouteuse;/);
  });

  it('un résultat déjà scanné en amont passe par le même portillon', () => {
    const avantInitial = app.slice(0, app.indexOf('poursuivreLecture(initialResult);'));
    expect(avantInitial).toMatch(/controlerLecture\(initialResult/);
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

// Correctif « scan anti-invention » — lecture douteuse (total qui ne colle
// pas, ou deux lectures différentes) : on s'arrête, mais on peut continuer.
describe('l\'écran de lecture douteuse', () => {
  const douteuse = ecrans.slice(ecrans.indexOf('export function EcranLectureDouteuse'));

  it('« Reprendre la photo » est le bouton principal, « Continuer quand même » vient en second', () => {
    const posReprendre = douteuse.indexOf('Reprendre la photo');
    const posContinuer = douteuse.indexOf('Continuer quand même');
    expect(posReprendre).toBeGreaterThanOrEqual(0);
    expect(posContinuer).toBeGreaterThan(posReprendre);
    // le principal est plein (vert), le second en contour
    const boutonReprendre = douteuse.slice(douteuse.lastIndexOf('<button', posReprendre), posReprendre);
    expect(boutonReprendre).toMatch(/background: '#00B341'/);
  });

  it('est affiché par l\'app, après l\'écran de refus', () => {
    expect(app).toMatch(/\{lectureDouteuse && \(\s*<EcranLectureDouteuse/);
    expect(app.indexOf('<EcranLectureRefusee')).toBeLessThan(app.indexOf('<EcranLectureDouteuse'));
  });

  it('le refus au-delà de 10 % passe AVANT le doute : il reste sans « continuer »', () => {
    const portillon = app.slice(app.indexOf('const controlerLecture = '), app.indexOf('const poursuivreLecture = async'));
    expect(portillon.indexOf('NIVEAU_BLOCAGE')).toBeLessThan(portillon.indexOf('setLectureDouteuse('));
  });

  it('les trois chemins de scan photo transmettent la comparaison des deux lectures', () => {
    const appels = app.match(/controlerLecture\(parsed, \{ lecturesDivergentes: scan\.lecturesDivergentes, comptesLectures: scan\.comptesLectures/g) || [];
    expect(appels.length).toBe(3);
  });
});

// Correctif orientation (11/11) — garde-fous ajoutés et message d'attente.
describe('correctif orientation : écran et branchements', () => {
  const douteuse = ecrans.slice(ecrans.indexOf('export function EcranLectureDouteuse'));

  it('l\'écran de doute a une phrase pour chacun des quatre motifs', () => {
    for (const motif of ['montant', 'lectures_divergentes', 'articles_introuvables', 'date_absurde']) {
      expect(douteuse).toContain(`motifs.includes('${motif}')`);
    }
    expect(douteuse).toMatch(/n'est pas vraisemblable pour un ticket qu'on vient de scanner/);
    expect(douteuse).toMatch(/Le nombre d'articles imprimé sur le ticket n'a pas été trouvé/);
  });

  it('le portillon calcule les motifs avec la logique pure (lib/lectureDouteuse)', () => {
    const portillon = app.slice(app.indexOf('const controlerLecture = '), app.indexOf('const poursuivreLecture = async'));
    expect(portillon).toMatch(/motifsDoute\(\{ parsed, controle, controleDate/);
  });

  it('pendant la vérification du sens, le message d\'attente le dit', () => {
    expect(app).toMatch(/etapeScan === 'sens' \? "Je vérifie le sens de la photo…"/);
    const appels = app.match(/scanTicketRobuste\(base64, refProducts, \{ onEtape: setEtapeScan \}\)/g) || [];
    expect(appels.length).toBe(3);
  });

  it('Grand ticket : chaque photo est redressée à l\'ajout, une photo au sens incertain n\'est pas ajoutée', () => {
    const ajout = app.slice(app.indexOf('function MultiPhotoSheet'), app.indexOf('const removePhoto', app.indexOf('function MultiPhotoSheet')));
    expect(ajout).toMatch(/const sens = await redresserPhoto\(brute\)/);
    expect(ajout.indexOf("if (sens.statut === 'ok')")).toBeLessThan(ajout.indexOf('setPhotos('));
    expect(ajout).toMatch(/setScanError\(MESSAGES_SCAN\[sens\.statut\]/);
  });
});
