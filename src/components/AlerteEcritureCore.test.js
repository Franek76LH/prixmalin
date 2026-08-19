import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Chantier 109 — garde-fou de NON-RÉGRESSION sur le BRANCHEMENT.
//
// Le défaut du 18/08 n'était pas dans la logique : c'était que personne ne
// lisait la réponse de la RPC. Un test unitaire sur l'interprétation n'aurait
// rien vu. On verrouille donc l'endroit exact où ça a cassé — au niveau du
// source, faute de jsdom (même parti pris que RechercheProduitSheet.test.js).

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const ecran = readFileSync(new URL('./AlerteEcritureCore.jsx', import.meta.url), 'utf8');

// Les deux fonctions qui reçoivent la promesse d'écriture Core.
const corpsDe = (nom) => {
  const debut = app.indexOf(`const ${nom} = async (entries, ecritureCorePromise) => {`);
  expect(debut).toBeGreaterThanOrEqual(0);
  return app.slice(debut, app.indexOf('\n  };', debut));
};

describe.each(['importPrices', 'handleImportPrices'])('%s lit la réponse de la RPC', (nom) => {
  const corps = corpsDe(nom);

  it('interprète le résultat Core, avec le nombre de lignes envoyées', () => {
    expect(corps).toMatch(/interpreterResultatCore\(await ecritureCorePromise, \{ lignesEnvoyees: entries\.length \}\)/);
  });

  it('la lecture ne dépend d\'AUCUNE branche : elle précède le test sur openArchive', () => {
    const posLecture = corps.indexOf('interpreterResultatCore');
    const posArchive = corps.indexOf('openArchive');
    expect(posLecture).toBeGreaterThanOrEqual(0);
    expect(posArchive).toBeGreaterThanOrEqual(0);
    expect(posLecture).toBeLessThan(posArchive);
  });

  it('sur ÉCHEC, sort AVANT d\'annoncer le moindre succès', () => {
    const posEchec = corps.indexOf('NIVEAU_ECHEC');
    const posSucces = corps.search(/show(App)?Toast\(`✓/);
    expect(posEchec).toBeGreaterThanOrEqual(0);
    expect(posSucces).toBeGreaterThanOrEqual(0);
    expect(posEchec).toBeLessThan(posSucces);
    // et la sortie est bien un return, pas un simple message de plus
    expect(corps).toMatch(/NIVEAU_ECHEC[\s\S]{0,160}?return;/);
  });

  it('une exception de l\'interprétation ne casse pas l\'import', () => {
    expect(corps).toMatch(/catch \(e\) \{[\s\S]{0,140}bilanCore = null;/);
  });
});

describe('l\'écran d\'échec', () => {
  it('est monté à la racine, hors de la feuille d\'import (qui est déjà fermée)', () => {
    expect(app).toMatch(/\{echecEcritureCore && \(\s*<AlerteEcritureCore/);
  });

  it('dit ce qui a marché ET ce qui n\'a pas marché', () => {
    expect(ecran).toMatch(/historique personnel/);
    expect(ecran).toMatch(/comparateur/);
  });

  it('n\'est pas un toast : il attend une action explicite', () => {
    expect(ecran).toMatch(/J'ai compris/);
    expect(ecran).not.toMatch(/setTimeout/);
  });
});

describe('la réponse de la RPC est tracée en console', () => {
  const source = readFileSync(new URL('../lib/doubleEcritureCore.js', import.meta.url), 'utf8');

  it('trace statut, prix écrits, lignes envoyées et rejets — même quand tout va bien', () => {
    expect(source).toMatch(/console\.log\('\[C109\] enregistrer_ticket_core/);
    for (const champ of ['statut', 'prix_ecrits', 'lignes_envoyees', 'rejets']) {
      expect(source).toMatch(new RegExp(`${champ}:`));
    }
  });
});
