import { describe, it, expect } from 'vitest';
import { nettoyerAdresseMagasin } from './adresseMagasin';
import { magasinConnuPourTicket, similariteTrigramme } from './nouveauMagasinTicket';

describe('nettoyerAdresseMagasin — cas réels du ticket Utile (9h58)', () => {
  it('retire la désignation du magasin', () => {
    expect(nettoyerAdresseMagasin('MAGASIN CAPSUD N°1617, 68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE')).toBe('68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE');
    expect(nettoyerAdresseMagasin('MAGASIN CAPSUD Nø1817, 68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE')).toBe('68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE');
  });

  it('retire le nom de l\'enseigne et l\'adresse de la société exploitante (on garde le 1er bloc)', () => {
    expect(nettoyerAdresseMagasin('UTILE AIX EN PROVENCE, MAGASIN CAPSUD N°1817, 68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE, CAP SUD EXPLOITATION, ZAC Les Ferrieres, 50 RUE DU LIEGE, 83490 LE MUY, FRANCE'))
      .toBe('68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE');
  });

  it('une adresse déjà propre ressort identique (idempotent)', () => {
    for (const a of ['68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE', '12 rue de la République, 13001 Marseille', '13100 AIX-EN-PROVENCE']) {
      expect(nettoyerAdresseMagasin(a)).toBe(a);
      expect(nettoyerAdresseMagasin(nettoyerAdresseMagasin(a))).toBe(a);
    }
  });

  it('rue et code postal dans le même morceau', () => {
    expect(nettoyerAdresseMagasin('SUPER U N°45 - 68 BD DU ROY RENE 13100 AIX-EN-PROVENCE')).toBe('68 BD DU ROY RENE, 13100 AIX-EN-PROVENCE');
  });

  it('autres formes courantes de voie', () => {
    expect(nettoyerAdresseMagasin('Carrefour Market, Centre Commercial Les Milles, 13290 Aix-en-Provence')).toBe('Centre Commercial Les Milles, 13290 Aix-en-Provence');
    expect(nettoyerAdresseMagasin('LECLERC SORMIOU, 145 Avenue de la Jarre, 13009 Marseille')).toBe('145 Avenue de la Jarre, 13009 Marseille');
    expect(nettoyerAdresseMagasin('Netto, Route de Gardanne, 13100 Aix')).toBe('Route de Gardanne, 13100 Aix');
  });

  it('sans code postal : rendue telle quelle (pas de nettoyage risqué) ; vide -> vide', () => {
    expect(nettoyerAdresseMagasin('GRUCHET LE VALASSE')).toBe('GRUCHET LE VALASSE');
    expect(nettoyerAdresseMagasin('')).toBe('');
    expect(nettoyerAdresseMagasin(null)).toBe('');
    expect(nettoyerAdresseMagasin(undefined)).toBe('');
  });
});

// Le magasin existant doit être retrouvé, quelle que soit la façon dont sa
// fiche range l'adresse (rue seule, ou rue + CP + ville).
describe('le ticket Utile retrouve le magasin existant', () => {
  const lue = 'MAGASIN CAPSUD N°1617, 68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE';
  const fiches = [
    { id: 'utile-aix', nom: 'UTILE Aix-en-Provence', adresse: '68, BD DU ROY RENE, 13100 AIX-EN-PROVENCE', code_postal: '13100', ville: 'AIX-EN-PROVENCE', enseignes: { slug: 'utile' } },
    { id: 'utile-aix', nom: 'UTILE Aix-en-Provence', adresse: '68, BD DU ROY RENE', code_postal: '13100', ville: 'AIX-EN-PROVENCE', enseignes: { slug: 'utile' } },
  ];

  it('AVANT nettoyage : non retrouvé (cause de la carte « Nouveau magasin détecté »)', () => {
    expect(magasinConnuPourTicket({ adresse: lue, enseigneId: 'utile', magasins: [fiches[0]] })).toBeNull();
  });

  it('APRÈS nettoyage : retrouvé dans les deux formes de fiche', () => {
    for (const f of fiches) {
      expect(magasinConnuPourTicket({ adresse: nettoyerAdresseMagasin(lue), enseigneId: 'utile', magasins: [f] })?.id).toBe('utile-aix');
    }
  });

  it('côté base : la ressemblance brute (règle de la fonction de création) atteint le rattachement automatique (≥ 0,85) avec la fiche complète', () => {
    expect(similariteTrigramme(nettoyerAdresseMagasin(lue), fiches[0].adresse)).toBeGreaterThanOrEqual(0.85);
    expect(similariteTrigramme(lue, fiches[0].adresse)).toBeLessThan(0.70);
  });
});
