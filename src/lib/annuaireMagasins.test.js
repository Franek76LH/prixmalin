import { describe, it, expect } from 'vitest';
import { enseigneAnnuaire, lieuDuTicket, distanceMetres, libelleAnnuaire, adressePourCreation, classerCandidats, motifVille } from './annuaireMagasins';

describe('171 — enseigne du ticket → annuaire', () => {
  it('reconnaît le nom lu', () => {
    expect(enseigneAnnuaire('AUCHAN AIX EN PROVENCE', 'auchan')).toBe('auchan');
    expect(enseigneAnnuaire('CARREFOUR CITY', 'carrefour')).toBe('carrefour');
    expect(enseigneAnnuaire('UTILE AIX EN PROVENCE', 'utile')).toBe('utile');
    expect(enseigneAnnuaire('E.LECLERC', 'leclerc')).toBe('leclerc');
    expect(enseigneAnnuaire('ALDI MARCHE', 'autre')).toBe('aldi');
    expect(enseigneAnnuaire('Intermarché SUPER', 'intermarche')).toBe('intermarche');
  });
  it("retombe sur l'identifiant de l'app", () => {
    expect(enseigneAnnuaire('', 'superu')).toBe('systeme-u');
    expect(enseigneAnnuaire(null, 'uexpress')).toBe('u-express');
    expect(enseigneAnnuaire('MAGASIN', 'lidl')).toBe('lidl');
  });
  it('rien de reconnu → null', () => {
    expect(enseigneAnnuaire('Épicerie du coin', 'autre')).toBeNull();
    expect(enseigneAnnuaire('', '')).toBeNull();
  });
});

describe('171 — lieu du ticket', () => {
  it('adresse complète', () => {
    expect(lieuDuTicket('210 avenue de Brédasque, 13090 Aix-en-Provence')).toEqual({ cp: '13090', ville: 'aix en provence' });
  });
  it('ville seule', () => {
    expect(lieuDuTicket('AIX-EN-PROVENCE')).toEqual({ cp: null, ville: 'aix en provence' });
  });
  it('vide', () => {
    expect(lieuDuTicket('')).toEqual({ cp: null, ville: null });
  });
});

describe('171 — affichage et tri', () => {
  const a = { adresse: '210 Avenue de Brédasque', code_postal: '13090', ville: 'Aix-en-Provence', adresse_source: 'osm', latitude: 43.5346, longitude: 5.4179 };
  const b = { adresse: '3 Avenue Pierre Mendès France', code_postal: '13090', ville: 'Aix-en-Provence', adresse_source: 'ban', latitude: 43.52, longitude: 5.45 };
  it('libellé : « près du » pour une adresse déduite', () => {
    expect(libelleAnnuaire(a)).toBe('210 Avenue de Brédasque, 13090 Aix-en-Provence');
    expect(libelleAnnuaire(b)).toBe('près du 3 Avenue Pierre Mendès France, 13090 Aix-en-Provence');
    expect(adressePourCreation(b)).toBe('3 Avenue Pierre Mendès France, 13090 Aix-en-Provence');
    expect(libelleAnnuaire({ code_postal: '13090', ville: 'Aix' })).toBe('13090 Aix');
  });
  it('distance', () => {
    expect(distanceMetres({ lat: 43.5346, lon: 5.4179 }, { lat: 43.5346, lon: 5.4179 })).toBe(0);
    const d = distanceMetres({ lat: 43.5, lon: 5.4 }, { lat: 43.51, lon: 5.4 });
    expect(d).toBeGreaterThan(1100); expect(d).toBeLessThan(1120);
  });
  it('tri par rue du ticket, puis par position', () => {
    expect(classerCandidats([b, a], { adresseTicket: '210 av de Bredasque 13090 AIX' })[0]).toMatchObject({ adresse: a.adresse });
    expect(classerCandidats([a, b], { position: { lat: 43.52, lon: 5.45 } })[0]).toMatchObject({ adresse: b.adresse });
    expect(classerCandidats(null)).toEqual([]);
    expect(classerCandidats([a, b, a, b, a, b], { max: 5 })).toHaveLength(5);
  });
  it('motif de ville tolérant', () => {
    const re = new RegExp('^' + motifVille('aix en provence').replace(/_/g, '.') + '$', 'i');
    expect(re.test('Aix-en-Provence')).toBe(true);
    expect(re.test('Salon-de-Provence')).toBe(false);
  });
});

describe('Chantier 187 — magasins les plus proches', () => {
  it('trie par distance et garde les plus proches', async () => {
    const { plusProches, texteDistance } = await import('./annuaireMagasins');
    const pos = { lat: 43.256, lon: 5.39 };
    const r = plusProches([
      { osm_id: 1, latitude: 43.27, longitude: 5.39 },
      { osm_id: 2, latitude: 43.257, longitude: 5.39 },
      { osm_id: 3, latitude: null, longitude: null },
    ], pos, 5);
    expect(r.map(l => l.osm_id)).toEqual([2, 1]);
    expect(texteDistance(r[0].distance)).toBe('110 m');
    expect(texteDistance(1560)).toBe('1,6 km');
  });
});

describe('Chantier 188 — magasin de l\'annuaire déjà connu', () => {
  it('même enseigne à moins de 200 m en priorité, sinon même emplacement à moins de 60 m', async () => {
    const { magasinConnuPour } = await import('./annuaireMagasins');
    const magasins = [
      { id: 'lidl', slug: 'lidl', latitude: 43.2610, longitude: 5.3900 },   // ~110 m
      { id: 'autre', slug: 'carrefour', latitude: 43.2602, longitude: 5.3900 }, // ~22 m
    ];
    expect(magasinConnuPour({ enseigne_slug: 'lidl', latitude: 43.2600, longitude: 5.3900 }, magasins).id).toBe('lidl');
    expect(magasinConnuPour({ enseigne_slug: 'netto', latitude: 43.2600, longitude: 5.3900 }, magasins).id).toBe('autre');
    expect(magasinConnuPour({ enseigne_slug: 'lidl', latitude: 43.2615, longitude: 5.3900 }, magasins).id).toBe('lidl');
    expect(magasinConnuPour({ enseigne_slug: 'auchan', latitude: 43.2700, longitude: 5.3900 }, magasins)).toBeNull();
  });
});
