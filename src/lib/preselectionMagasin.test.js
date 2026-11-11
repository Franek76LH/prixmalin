import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { magasinReconnuPourTicket, SEUIL_RATTACHEMENT_AUTO } from './nouveauMagasinTicket';
import { nettoyerAdresseMagasin } from './adresseMagasin';
import { filtrerMagasins } from './selecteurMagasinCore';

const UTILE = { id: 'utile-aix', nom: 'UTILE Aix-en-Provence', adresse: '68, BD DU ROY RENE', code_postal: '13100', ville: 'AIX-EN-PROVENCE', enseignes: { slug: 'utile', nom: 'Utile' } };
const lue = '68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE';

describe('présélection : uniquement quand la correspondance est SÛRE et UNIQUE', () => {
  it('ticket Utile du 10/11 -> le magasin existant est présélectionné (fiche rue seule ou complète)', () => {
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: 'utile', magasins: [UTILE] })?.id).toBe('utile-aix');
    const complete = { ...UTILE, adresse: '68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE' };
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: 'utile', magasins: [complete] })?.id).toBe('utile-aix');
  });

  it('même avec l\'adresse brute du 9h58, une fois nettoyée', () => {
    const brute = 'MAGASIN CAPSUD N°1617, 68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE';
    expect(magasinReconnuPourTicket({ adresse: nettoyerAdresseMagasin(brute), enseigneId: 'utile', magasins: [UTILE] })?.id).toBe('utile-aix');
  });

  it('DEUX magasins correspondent -> rien de présélectionné', () => {
    const doublon = { ...UTILE, id: 'utile-aix-bis', nom: 'Utile Aix (doublon)' };
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: 'utile', magasins: [UTILE, doublon] })).toBeNull();
  });

  it('autre enseigne à la même adresse -> rien (même enseigne exigée)', () => {
    const autre = { ...UTILE, id: 'x', enseignes: { slug: 'carrefour' } };
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: 'utile', magasins: [autre] })).toBeNull();
  });

  it('enseigne du ticket inconnue (« autre ») -> rien', () => {
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: 'autre', magasins: [UTILE] })).toBeNull();
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: null, magasins: [UTILE] })).toBeNull();
  });

  it('code postal différent -> rien', () => {
    expect(magasinReconnuPourTicket({ adresse: '68, BD DU ROY RENE, 13090 AIX-EN-PROVENCE', enseigneId: 'utile', magasins: [UTILE] })).toBeNull();
  });

  it('adresse seulement « ressemblante » (zone grise sous 0,85) -> rien', () => {
    expect(SEUIL_RATTACHEMENT_AUTO).toBe(0.85);
    expect(magasinReconnuPourTicket({ adresse: '70, BD DU ROI RENE, 13100 AIX-EN-PROVENCE', enseigneId: 'utile', magasins: [UTILE] })).toBeNull();
    expect(magasinReconnuPourTicket({ adresse: 'MAGASIN CAPSUD N°1617, 68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE', enseigneId: 'utile', magasins: [{ ...UTILE, adresse: '68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE' }] })).toBeNull();
  });

  it('pas d\'adresse, pas de code postal, liste absente -> rien, jamais d\'exception', () => {
    expect(magasinReconnuPourTicket({ adresse: '', enseigneId: 'utile', magasins: [UTILE] })).toBeNull();
    expect(magasinReconnuPourTicket({ adresse: 'AIX-EN-PROVENCE', enseigneId: 'utile', magasins: [UTILE] })).toBeNull();
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: 'utile', magasins: null })).toBeNull();
  });
});

describe('recherche de magasin tolérante', () => {
  const TOUS = [UTILE, { id: 'lidl', nom: 'Lidl', adresse: '595 Avenue du Prado', code_postal: '13008', ville: 'Marseille', enseignes: { nom: 'Lidl' } }];
  it('le nom lu sur le ticket trouve le magasin (espaces contre tirets)', () => {
    expect(filtrerMagasins(TOUS, 'UTILE AIX EN PROVENCE').map(m => m.id)).toEqual(['utile-aix']);
  });
  it('accents, majuscules, mots dans le désordre, mots répartis sur plusieurs champs', () => {
    expect(filtrerMagasins(TOUS, 'provence utile').map(m => m.id)).toEqual(['utile-aix']);
    expect(filtrerMagasins(TOUS, 'Aix-en-Provénce').map(m => m.id)).toEqual(['utile-aix']);
    expect(filtrerMagasins(TOUS, 'lidl 13008').map(m => m.id)).toEqual(['lidl']);
  });
  it('un mot absent -> pas de résultat (chaque mot doit être trouvé)', () => {
    expect(filtrerMagasins(TOUS, 'utile marseille')).toEqual([]);
  });
});

describe('branchement dans l\'app', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const arrivee = app.slice(app.indexOf('const arriverEtapeMagasin = async'), app.indexOf('const validerNouveauMagasinTicket'));

  it('la présélection ne s\'applique que si rien n\'est choisi et que c\'est toujours le même ticket', () => {
    expect(arrivee).toMatch(/if \(jeton !== etapeMagasinJetonRef\.current \|\| magasinCoreRef\.current \|\| !Array\.isArray\(tous\)\) return;/);
    expect(arrivee).toMatch(/magasinReconnuPourTicket\(\{ adresse, enseigneId: enseigneRetenue, magasins: tous \}\)/);
    expect(arrivee).toMatch(/await choisirMagasinCore\(reconnu\)/);
  });

  it('carte « Magasin reconnu : <nom> » avec l\'adresse, et un vrai bouton « Changer de magasin »', () => {
    expect(app).toMatch(/magasinPreselectionne \? `Magasin reconnu : \$\{magasinCore\.nom\}` : magasinCore\.nom/);
    const carte = app.slice(app.indexOf('Magasin reconnu : '), app.indexOf('Continuer →', app.indexOf('Magasin reconnu : ')));
    expect(carte).toMatch(/formaterAdresseMagasin\(magasinCore\)/);
    expect(carte).toMatch(/setMagasinPreselectionne\(false\); definirMagasinCore\(null\)/);
  });
});

// Correctif 10h38 — « 68, BD » lu « ZAC RD » : on compare aussi le nom de rue seul.
import { coeurDeRue } from './adresseMagasin';
describe('présélection : nom de la rue sans numéro ni type de voie', () => {
  it('cas réel 10h38 : « ZAC RD DU ROY RENE » -> le magasin Utile est présélectionné', () => {
    const lue10h38 = nettoyerAdresseMagasin('MAGASIN CAPSUD N°1817, ZAC RD DU ROY RENE, 13100 AIX-EN-PROVENCE');
    expect(coeurDeRue(lue10h38)).toBe('du roy rene');
    expect(magasinReconnuPourTicket({ adresse: lue10h38, enseigneId: 'utile', magasins: [UTILE] })?.id).toBe('utile-aix');
    expect(magasinReconnuPourTicket({ adresse: lue10h38, enseigneId: 'utile', magasins: [{ ...UTILE, adresse: '68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE' }] })?.id).toBe('utile-aix');
  });

  it('les autres conditions tiennent toujours : autre enseigne, autre code postal, deux magasins -> rien', () => {
    const lue = 'ZAC RD DU ROY RENE, 13100 AIX-EN-PROVENCE';
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: 'utile', magasins: [{ ...UTILE, enseignes: { slug: 'lidl' } }] })).toBeNull();
    expect(magasinReconnuPourTicket({ adresse: 'ZAC RD DU ROY RENE, 13090 AIX-EN-PROVENCE', enseigneId: 'utile', magasins: [UTILE] })).toBeNull();
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: 'utile', magasins: [UTILE, { ...UTILE, id: 'bis', adresse: '12 BD DU ROY RENE' }] })).toBeNull();
    expect(magasinReconnuPourTicket({ adresse: lue, enseigneId: 'autre', magasins: [UTILE] })).toBeNull();
  });

  it('une autre rue du même code postal -> rien', () => {
    expect(magasinReconnuPourTicket({ adresse: '68, BD DU ROI RENE, 13100 AIX', enseigneId: 'utile', magasins: [{ ...UTILE, adresse: '10 rue Paradis' }] })).toBeNull();
    expect(magasinReconnuPourTicket({ adresse: '5 avenue des Belges, 13100 AIX', enseigneId: 'utile', magasins: [UTILE] })).toBeNull();
  });

  it('nom de rue trop court ou absent : ne compte pas (seul le code postal ne prouve rien)', () => {
    expect(magasinReconnuPourTicket({ adresse: '13100 AIX-EN-PROVENCE', enseigneId: 'utile', magasins: [UTILE] })).toBeNull();
    expect(magasinReconnuPourTicket({ adresse: '68 BD, 13100 AIX', enseigneId: 'utile', magasins: [{ ...UTILE, adresse: '12 BD' }] })).toBeNull();
  });
});
