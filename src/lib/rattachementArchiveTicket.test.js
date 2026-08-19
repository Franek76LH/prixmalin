import { describe, it, expect } from 'vitest';
import {
  choisirArchiveARattacher,
  archiveRattachable,
  identifiantMagasinArchive,
  FENETRE_RATTACHEMENT_MS,
  REFUS_DEJA_SCANNEE,
  REFUS_AUTRE_MAGASIN,
  REFUS_TROP_ANCIENNE,
} from './rattachementArchiveTicket';

// Repère fixe : le scan du ticket Carrefour, le 19/08 à 11h53.
const MAINTENANT = new Date('2026-08-19T11:53:00.000Z').getTime();
const ilYA = (ms) => new Date(MAINTENANT - ms).toISOString();
const HEURE = 60 * 60 * 1000;
const JOUR = 24 * HEURE;

const archive = (o = {}) => ({
  id: o.id ?? 1,
  date: o.date ?? ilYA(10 * 60 * 1000),
  store: o.store === null ? null : { id: o.magasin ?? 'carrefour', name: 'Carrefour', logo: '🏪' },
  ticket_scanned: o.scannee ?? false,
  items: [],
});

const choisir = (archives, magasinId = 'carrefour') =>
  choisirArchiveARattacher(archives, { magasinId, maintenant: MAINTENANT });

// ── Les quatre cas de la spec ───────────────────────────────────────────────
describe('les quatre situations à trancher', () => {
  // a)
  it('session NON scannée, AUTRE magasin, la veille -> on CRÉE', () => {
    const session = archive({ magasin: 'leclerc', date: ilYA(20 * HEURE) });
    expect(choisir([session], 'carrefour')).toBeNull();
    expect(archiveRattachable(session, { magasinId: 'carrefour', maintenant: MAINTENANT }).refus)
      .toBe(REFUS_AUTRE_MAGASIN);
  });

  // b) LE cas réel : les sept sessions Carrefour du 11/08 qui captaient tout.
  it('session NON scannée, MÊME magasin, il y a 8 jours -> on CRÉE', () => {
    const session = archive({ magasin: 'carrefour', date: ilYA(8 * JOUR) });
    expect(choisir([session])).toBeNull();
    expect(archiveRattachable(session, { magasinId: 'carrefour', maintenant: MAINTENANT }).refus)
      .toBe(REFUS_TROP_ANCIENNE);
  });

  // c)
  it('session NON scannée, MÊME magasin, il y a 10 minutes -> on RATTACHE', () => {
    const session = archive({ magasin: 'carrefour', date: ilYA(10 * 60 * 1000) });
    expect(choisir([session])).toBe(session);
    expect(archiveRattachable(session, { magasinId: 'carrefour', maintenant: MAINTENANT }).rattachable)
      .toBe(true);
  });

  // d)
  it('aucune session en attente -> on CRÉE', () => {
    expect(choisir([])).toBeNull();
    expect(choisir([archive({ scannee: true })])).toBeNull();
  });
});

// ── La situation réelle du 19/08 ────────────────────────────────────────────
describe('le blocage réel : sept sessions abandonnées le 11/08', () => {
  // Sept archives Carrefour non scannées (1,95 € à 7,23 €) laissées le 11/08.
  // Sous l'ancienne règle (« la première non scannée »), elles captaient chaque
  // ticket sans jamais être marquées : plus aucune archive n'a été créée par un
  // scan pendant huit jours.
  const SEPT_DU_11_AOUT = Array.from({ length: 7 }, (_, i) =>
    archive({ id: 100 + i, magasin: 'carrefour', date: ilYA(8 * JOUR + i * HEURE) })
  );

  it('elles ne captent plus le ticket du 19/08 : on crée une archive', () => {
    expect(choisir(SEPT_DU_11_AOUT)).toBeNull();
  });

  it('et une session du jour, elle, est bien rattachée malgré leur présence', () => {
    const duJour = archive({ id: 200, magasin: 'carrefour', date: ilYA(15 * 60 * 1000) });
    expect(choisir([...SEPT_DU_11_AOUT, duJour])).toBe(duJour);
  });

  it('un ticket Netto ne prend pas une session Carrefour du jour', () => {
    const carrefourDuJour = archive({ id: 201, magasin: 'carrefour', date: ilYA(HEURE) });
    expect(choisir([carrefourDuJour], 'netto')).toBeNull();
  });
});

// ── Les trois conditions, une par une ───────────────────────────────────────
describe('archiveRattachable — les trois conditions', () => {
  it('déjà scannée : refus, même magasin et même minute', () => {
    const a = archive({ scannee: true, date: ilYA(60 * 1000) });
    const r = archiveRattachable(a, { magasinId: 'carrefour', maintenant: MAINTENANT });
    expect(r.rattachable).toBe(false);
    expect(r.refus).toBe(REFUS_DEJA_SCANNEE);
  });

  it('la fenêtre est de 24 h, bornes comprises', () => {
    const juste = archive({ date: ilYA(FENETRE_RATTACHEMENT_MS) });
    const trop = archive({ date: ilYA(FENETRE_RATTACHEMENT_MS + 1000) });
    expect(archiveRattachable(juste, { magasinId: 'carrefour', maintenant: MAINTENANT }).rattachable).toBe(true);
    expect(archiveRattachable(trop, { magasinId: 'carrefour', maintenant: MAINTENANT }).rattachable).toBe(false);
  });

  it('une archive légèrement dans le futur (horloge décalée) reste rattachable', () => {
    const futur = archive({ date: new Date(MAINTENANT + 2 * HEURE).toISOString() });
    expect(archiveRattachable(futur, { magasinId: 'carrefour', maintenant: MAINTENANT }).rattachable).toBe(true);
  });

  // On compare des IDENTIFIANTS. Deux magasins peuvent porter le même nom, et
  // un même magasin change de libellé au fil des lectures OCR.
  it('la comparaison porte sur l\'identifiant, pas sur le nom affiché', () => {
    const a = { id: 1, date: ilYA(HEURE), ticket_scanned: false, store: { id: 'leclerc', name: 'Carrefour' } };
    expect(archiveRattachable(a, { magasinId: 'carrefour', maintenant: MAINTENANT }).refus).toBe(REFUS_AUTRE_MAGASIN);
  });
});

// ── Dans le doute, on crée ──────────────────────────────────────────────────
describe('ce qu\'on ne sait pas ne devient jamais un rattachement', () => {
  it('archive sans magasin exploitable : on crée', () => {
    for (const store of [null, {}, { id: '' }, { id: 42 }]) {
      const a = { id: 1, date: ilYA(HEURE), ticket_scanned: false, store };
      expect(archiveRattachable(a, { magasinId: 'carrefour', maintenant: MAINTENANT }).rattachable).toBe(false);
    }
  });

  it('ticket sans enseigne connue : on crée', () => {
    const a = archive();
    for (const id of [null, undefined, '', '   ']) {
      expect(archiveRattachable(a, { magasinId: id, maintenant: MAINTENANT }).rattachable).toBe(false);
    }
  });

  it('date d\'archive illisible ou absente : on crée', () => {
    for (const date of [null, '', 'pas une date']) {
      const a = { id: 1, date, ticket_scanned: false, store: { id: 'carrefour' } };
      expect(archiveRattachable(a, { magasinId: 'carrefour', maintenant: MAINTENANT }).refus).toBe(REFUS_TROP_ANCIENNE);
    }
  });

  it('entrées absurdes : aucune exception, on crée', () => {
    expect(choisirArchiveARattacher(null, { magasinId: 'carrefour', maintenant: MAINTENANT })).toBeNull();
    expect(choisirArchiveARattacher(undefined, {})).toBeNull();
    expect(() => choisirArchiveARattacher([null, undefined, {}], { magasinId: 'carrefour', maintenant: MAINTENANT })).not.toThrow();
    expect(archiveRattachable(null, {}).rattachable).toBe(false);
    expect(archiveRattachable(undefined).rattachable).toBe(false);
  });
});

describe('choix parmi plusieurs candidates', () => {
  it('à conditions égales, la session la plus RÉCENTE gagne', () => {
    // Les archives arrivent triées par date croissante (.order('date')).
    const vieille = archive({ id: 1, date: ilYA(20 * HEURE) });
    const recente = archive({ id: 2, date: ilYA(30 * 60 * 1000) });
    expect(choisir([vieille, recente])).toBe(recente);
  });

  it('la plus récente étant hors conditions, on prend la suivante qui convient', () => {
    const bonne = archive({ id: 1, date: ilYA(2 * HEURE) });
    const recenteMaisAutreMagasin = archive({ id: 2, magasin: 'leclerc', date: ilYA(10 * 60 * 1000) });
    expect(choisir([bonne, recenteMaisAutreMagasin])).toBe(bonne);
  });
});

describe('identifiantMagasinArchive', () => {
  it('lit store.id, et rien d\'autre', () => {
    expect(identifiantMagasinArchive({ store: { id: 'carrefour', name: 'X' } })).toBe('carrefour');
    expect(identifiantMagasinArchive({ store: { name: 'Carrefour' } })).toBeNull();
    expect(identifiantMagasinArchive({})).toBeNull();
    expect(identifiantMagasinArchive(null)).toBeNull();
  });
});
