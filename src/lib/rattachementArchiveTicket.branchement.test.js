import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Chantier 112 — garde-fou de NON-RÉGRESSION sur le BRANCHEMENT.
//
// La logique est testée dans rattachementArchiveTicket.test.js. Ce qui ne s'y
// voit pas, c'est que les DEUX gestionnaires d'import l'utilisent, et que le
// résultat des écritures est réellement lu.
//
// Le projet n'a ni jsdom ni testing-library : on verrouille au niveau du
// source (même parti pris que RecapitulatifAssociation.test.js).

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

// Les deux gestionnaires : importPrices (PricesTab) et handleImportPrices
// (racine). Un scan depuis l'onglet Archives passe par le second, un scan
// depuis l'onglet Prix par le premier — les deux doivent être corrigés.
const gestionnaires = [
  { nom: 'importPrices (PricesTab)', debut: 'const importPrices = async (' },
  { nom: 'handleImportPrices (racine)', debut: 'const handleImportPrices = async (' },
];

// Corps de la fonction : de sa déclaration jusqu'à sa fin réelle, repérée par
// le début de la déclaration suivante au même niveau d'indentation. Une
// fenêtre en nombre de caractères coupait importPrices en plein milieu.
const corpsDe = (debut) => {
  const i = app.indexOf(debut);
  if (i < 0) return null;
  const suite = app.slice(i + debut.length);
  const fin = suite.search(/\n {2}const [a-zA-Z]+ = /);
  return debut + (fin < 0 ? suite : suite.slice(0, fin));
};

describe('la sélection de l\'archive à rattacher', () => {
  it('l\'ancienne règle (« la première non scannée ») a disparu du code', () => {
    // C'est elle qui laissait sept sessions du 11/08 capter tous les tickets.
    expect(app).not.toContain("find(a => !a.ticket_scanned)");
  });

  it.each(gestionnaires)('$nom passe par choisirArchiveARattacher', ({ debut }) => {
    const corps = corpsDe(debut);
    expect(corps, `${debut} introuvable`).not.toBeNull();
    expect(corps).toContain('choisirArchiveARattacher(archives, {');
  });

  it.each(gestionnaires)('$nom lui donne l\'enseigne du ticket et l\'heure', ({ debut }) => {
    const corps = corpsDe(debut);
    expect(corps).toContain('magasinId: entries[0]?.storeId ?? null');
    expect(corps).toContain('maintenant: Date.now()');
  });
});

describe('l\'écriture est vérifiée, jamais lancée dans le vide', () => {
  it.each(gestionnaires)('$nom ATTEND le marquage et lit son erreur', ({ debut }) => {
    const corps = corpsDe(debut);
    // Avant : `updateArchive(...)` sans await, résultat jeté. Une écriture qui
    // échouait laissait l'archive non scannée sans que rien ne le signale.
    expect(corps).toMatch(/const \{ error: erreurMarquage \} = await updateArchive\(/);
    expect(corps).toContain('if (erreurMarquage) archiveOk = false;');
  });

  it.each(gestionnaires)('$nom retient l\'échec quand Core n\'a pas abouti', ({ debut }) => {
    const corps = corpsDe(debut);
    // realizedSaving === null : pas de ticket Core, donc pas de marquage, donc
    // le ticket n'est rattaché nulle part — ce n'est pas un succès.
    expect(corps).toMatch(/\} else \{\s*(\/\/[^\n]*\n\s*)*archiveOk = false;/);
  });

  it.each(gestionnaires)('$nom ATTEND la création et lit son échec', ({ debut }) => {
    const corps = corpsDe(debut);
    expect(corps).toMatch(/await (onCreateArchive\?\.\(newArc\)|supabase\.from\('archives'\)\.insert)/);
    expect(corps).toContain('archiveOk = false;');
  });

  it('onCreateArchive RENVOIE son résultat à l\'appelant', () => {
    // Sans valeur de retour, PricesTab ne peut pas savoir que la création a
    // échoué, et annoncerait un succès plein.
    const prop = app.slice(app.indexOf('onCreateArchive={async newArc=>{'));
    const corps = prop.slice(0, 1200);
    expect(corps).toContain('return { ok:false };');
    expect(corps).toContain('return { ok:true };');
  });
});

describe('le message final dit la vérité', () => {
  it('le message existe et ne renie pas l\'enregistrement Core', () => {
    expect(app).toContain("Ton ticket est enregistré, mais il n'apparaîtra pas dans tes archives.");
  });

  it.each(gestionnaires)('$nom n\'annonce pas de succès plein sans archive', ({ debut }) => {
    const corps = corpsDe(debut);
    const posGarde = corps.indexOf('if (!archiveOk) {');
    const posSucces = corps.indexOf('prix importé${entries.length > 1');
    expect(posGarde).toBeGreaterThanOrEqual(0);
    expect(posSucces).toBeGreaterThanOrEqual(0);
    // Le garde-fou passe AVANT le message de succès, et sort de la fonction.
    expect(posGarde).toBeLessThan(posSucces);
    expect(corps.slice(posGarde, posSucces)).toContain('return;');
  });

  it.each(gestionnaires)('$nom déclare le drapeau à vrai par défaut', ({ debut }) => {
    // Faux par défaut ferait crier sur chaque import réussi.
    expect(corpsDe(debut)).toContain('let archiveOk = true;');
  });
});
