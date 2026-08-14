import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./supabase', () => {
  const chain = () => {
    const c = {};
    for (const m of ['select', 'eq', 'not', 'order', 'limit']) {
      c[m] = vi.fn(() => c);
    }
    c.then = undefined; // remplacé par mockResolvedValue au cas par cas
    return c;
  };
  return { supabase: { from: vi.fn(() => chain()), rpc: vi.fn() }, __chain: chain };
});

import { supabase } from './supabase';
import {
  distanceKm, formaterDistance, formaterAdresseMagasin,
  classerMagasins, filtrerMagasins, obtenirPositionAppareil,
  trouverStoreLegacyPourMagasin, chargerFrequencesMagasins, chargerMagasinsCoreActifs,
} from './selecteurMagasinCore';

const MAZARGUES = { id: 'maz', nom: 'Auchan Mazargues', code_postal: '13009', ville: 'Marseille', latitude: '43.2449', longitude: '5.4086' };
const STLOUP    = { id: 'stl', nom: 'Auchan St-Loup',   code_postal: '13010', ville: 'Marseille', latitude: '43.2846', longitude: '5.4168' };
const LIDL      = { id: 'lidl', nom: 'Lidl Sanary', code_postal: '83110', ville: 'Sanary', latitude: null, longitude: null, enseignes: { nom: 'Lidl', slug: 'lidl' } };

describe('distanceKm / formaterDistance', () => {
  it('calcule une distance haversine plausible entre les deux Auchan (~4,5 km)', () => {
    const d = distanceKm({ lat: 43.2449, lng: 5.4086 }, { lat: 43.2846, lng: 5.4168 });
    expect(d).toBeGreaterThan(3.5);
    expect(d).toBeLessThan(5.5);
  });

  it('renvoie null si une coordonnée manque ou est invalide', () => {
    expect(distanceKm({ lat: 43, lng: 5 }, { lat: null, lng: 5 })).toBeNull();
    expect(distanceKm({}, { lat: 43, lng: 5 })).toBeNull();
    expect(distanceKm({ lat: 'abc', lng: 5 }, { lat: 43, lng: 5 })).toBeNull();
  });

  it('formate en mètres sous 1 km, en km (virgule) au-dessus', () => {
    expect(formaterDistance(0.35)).toBe('350 m');
    expect(formaterDistance(2.44)).toBe('2,4 km');
    expect(formaterDistance(null)).toBe('');
  });
});

describe('formaterAdresseMagasin', () => {
  it('assemble adresse, CP et ville en sautant les champs absents', () => {
    expect(formaterAdresseMagasin({ adresse: '2 rue X', code_postal: '13009', ville: 'Marseille' }))
      .toBe('2 rue X, 13009 Marseille');
    expect(formaterAdresseMagasin({ code_postal: '13009', ville: 'Marseille' })).toBe('13009 Marseille');
    expect(formaterAdresseMagasin({ adresse: '2 rue X' })).toBe('2 rue X');
    expect(formaterAdresseMagasin({})).toBe('');
  });
});

describe('classerMagasins', () => {
  it('met les habituels en tête par fréquence décroissante', () => {
    const freq = new Map([['stl', 1], ['maz', 5]]);
    const { habituels } = classerMagasins({ magasins: [MAZARGUES, STLOUP, LIDL], frequences: freq });
    expect(habituels.map(m => m.id)).toEqual(['maz', 'stl']);
  });

  it('classe les proches par distance (hors habituels), avec distance_km', () => {
    // Position proche de Mazargues
    const { proches } = classerMagasins({
      magasins: [MAZARGUES, STLOUP, LIDL],
      position: { lat: 43.245, lng: 5.409 },
    });
    expect(proches.map(m => m.id)).toEqual(['maz', 'stl']); // LIDL sans GPS exclu
    expect(proches[0].distance_km).toBeLessThan(0.2);
  });

  it('un habituel ne réapparaît pas dans les proches ni les autres', () => {
    const freq = new Map([['maz', 2]]);
    const { habituels, proches, autres } = classerMagasins({
      magasins: [MAZARGUES, STLOUP, LIDL],
      frequences: freq,
      position: { lat: 43.245, lng: 5.409 },
    });
    expect(habituels.map(m => m.id)).toEqual(['maz']);
    expect(proches.map(m => m.id)).toEqual(['stl']);
    expect(autres.map(m => m.id)).toEqual(['lidl']);
  });

  it('sans position ni historique : tout dans autres, trié par nom, jamais de plantage', () => {
    const { habituels, proches, autres } = classerMagasins({ magasins: [STLOUP, LIDL, MAZARGUES] });
    expect(habituels).toEqual([]);
    expect(proches).toEqual([]);
    expect(autres.map(m => m.id)).toEqual(['maz', 'stl', 'lidl']);
  });
});

describe('filtrerMagasins', () => {
  const TOUS = [MAZARGUES, STLOUP, LIDL];

  it('filtre par nom, insensible aux accents et à la casse', () => {
    expect(filtrerMagasins(TOUS, 'auchan').map(m => m.id)).toEqual(['maz', 'stl']);
    expect(filtrerMagasins(TOUS, 'MAZARGUES').map(m => m.id)).toEqual(['maz']);
  });

  it('filtre par code postal et par ville', () => {
    expect(filtrerMagasins(TOUS, '13010').map(m => m.id)).toEqual(['stl']);
    expect(filtrerMagasins(TOUS, 'sanary').map(m => m.id)).toEqual(['lidl']);
  });

  it('filtre par nom d\'enseigne (jointure enseignes)', () => {
    expect(filtrerMagasins(TOUS, 'lidl').map(m => m.id)).toEqual(['lidl']);
  });

  it('requête vide -> liste inchangée', () => {
    expect(filtrerMagasins(TOUS, '  ')).toEqual(TOUS);
  });
});

describe('obtenirPositionAppareil — jamais de popup surprise, jamais de throw', () => {
  const navigatorInitial = globalThis.navigator;
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: navigatorInitial, configurable: true, writable: true });
  });

  const definirNavigator = (v) =>
    Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true });

  it('renvoie null sans API géoloc', async () => {
    definirNavigator({});
    expect(await obtenirPositionAppareil()).toBeNull();
  });

  it('renvoie null si la permission n\'est pas déjà accordée (aucun getCurrentPosition appelé)', async () => {
    const getCurrentPosition = vi.fn();
    definirNavigator({
      geolocation: { getCurrentPosition },
      permissions: { query: vi.fn(async () => ({ state: 'prompt' })) },
    });
    expect(await obtenirPositionAppareil()).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('renvoie la position quand la permission est accordée', async () => {
    definirNavigator({
      geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 43.2, longitude: 5.4 } }) },
      permissions: { query: vi.fn(async () => ({ state: 'granted' })) },
    });
    expect(await obtenirPositionAppareil()).toEqual({ lat: 43.2, lng: 5.4 });
  });

  it('refus/erreur GPS -> null sans exception', async () => {
    definirNavigator({
      geolocation: { getCurrentPosition: (_ok, ko) => ko(new Error('denied')) },
      permissions: { query: vi.fn(async () => ({ state: 'granted' })) },
    });
    expect(await obtenirPositionAppareil()).toBeNull();
  });
});

describe('accès Supabase — indisponibilité = valeur neutre, jamais de throw', () => {
  beforeEach(() => vi.clearAllMocks());

  it('trouverStoreLegacyPourMagasin renvoie null sans id ou sur exception', async () => {
    expect(await trouverStoreLegacyPourMagasin(null)).toBeNull();
    supabase.from.mockImplementation(() => { throw new Error('réseau'); });
    expect(await trouverStoreLegacyPourMagasin('maz')).toBeNull();
  });

  it('chargerMagasinsCoreActifs renvoie [] sur exception', async () => {
    supabase.from.mockImplementation(() => { throw new Error('réseau'); });
    expect(await chargerMagasinsCoreActifs()).toEqual([]);
  });

  it('chargerFrequencesMagasins renvoie une Map vide sur exception', async () => {
    supabase.from.mockImplementation(() => { throw new Error('réseau'); });
    const freq = await chargerFrequencesMagasins();
    expect(freq instanceof Map).toBe(true);
    expect(freq.size).toBe(0);
  });
});
