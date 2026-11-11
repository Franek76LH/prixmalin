import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// Chantier 115 — reconnaissance et création du magasin au scan.
//
// Ces tests MORDENT :
//   - ils échouent si l'on remet `estFrancois ? ""` devant setStoreLocation
//     (l'adresse du ticket redeviendrait vide pour François) ;
//   - ils échouent si « UTILE AIX EN PROVENCE » retombe sur "autre" alors que
//     l'enseigne « Utile » existe dans la table `enseignes`.

const reponseSupabase = { data: null, error: null, throws: false };
vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(async () => {
        if (reponseSupabase.throws) throw new Error('réseau indisponible');
        return { data: reponseSupabase.data, error: reponseSupabase.error };
      }),
    })),
  },
}));

import {
  normaliserTexteEnseigne, idEnseigneDepuisSlug, storeIdFromNameSecours,
  trouverEnseigneDansNom, storeIdFromNameAvecEnseignes, storeIdFromName,
  chargerEnseignes, definirEnseignesEnCache, enseignesEnCache,
} from './enseignesMagasin';
import {
  similariteTrigramme, extraireCodePostal, magasinConnuPourTicket, doitProposerNouveauMagasin,
} from './nouveauMagasinTicket';

// Contenu réel de la table `enseignes` (relevé le 06/11/2026).
const ENSEIGNES_BASE = [
  { nom: 'Auchan', slug: 'auchan' },
  { nom: 'Carrefour', slug: 'carrefour' },
  { nom: 'Franprix', slug: 'franprix' },
  { nom: 'Intermarché', slug: 'intermarche' },
  { nom: 'Leader Price', slug: 'leader-price' },
  { nom: 'Leclerc', slug: 'leclerc' },
  { nom: 'Lidl', slug: 'lidl' },
  { nom: 'Netto', slug: 'netto' },
  { nom: 'U Express', slug: 'u-express' },
  { nom: 'Utile', slug: 'utile' },
  { nom: 'Vival', slug: 'vival' },
];

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

describe('défaut 1 — l\'adresse du ticket n\'est plus effacée pour François', () => {
  it('aucun setStoreLocation ne dépend plus de estFrancois', () => {
    expect(app).not.toMatch(/setStoreLocation\(\s*estFrancois\b/);
    expect(app).not.toMatch(/estFrancois\s*\?\s*""\s*:\s*\(\s*(parsed|initialResult)\.address/);
  });

  // Correctif « scan anti-invention » — les quatre arrivées d'une lecture
  // OCR (caméra ×2, galerie, résultat déjà scanné) passent désormais par
  // poursuivreLecture, qui pose l'adresse du ticket ; le collage JSON garde
  // la sienne. Même garantie qu'avant : 5 points d'arrivée, tous avec l'adresse.
  it('les cinq points d\'arrivée d\'un scan posent l\'adresse lue sur le ticket', () => {
    const occurrences = app.match(/setStoreLocation\((parsed|initialResult)\.address \|\| ""\)/g) || [];
    expect(occurrences.length).toBe(2);
    const corps = app.slice(app.indexOf('const poursuivreLecture = async'), app.indexOf('const continuerLectureDouteuse'));
    expect(corps).toMatch(/setStoreLocation\(parsed\.address \|\| ""\)/);
    const arrivees = app.match(/poursuivreLecture\((parsed|initialResult)[,)]/g) || [];
    expect(arrivees.length).toBe(4);
  });
});

describe('défaut 2 — enseignes lues dans la table, la plus longue l\'emporte', () => {
  beforeEach(() => definirEnseignesEnCache(null));

  it('normalise minuscules / accents / ponctuation', () => {
    expect(normaliserTexteEnseigne('  INTERMARCHÉ-Super ')).toBe('intermarche super');
    expect(normaliserTexteEnseigne('U-EXPRESS')).toBe('u express');
    expect(idEnseigneDepuisSlug('u-express')).toBe('uexpress');
  });

  it('le ticket réel « UTILE AIX EN PROVENCE » donne l\'enseigne Utile (pas "autre")', () => {
    expect(storeIdFromNameAvecEnseignes('UTILE AIX EN PROVENCE', ENSEIGNES_BASE)).toBe('utile');
    expect(trouverEnseigneDansNom('UTILE AIX EN PROVENCE', ENSEIGNES_BASE)?.nom).toBe('Utile');
  });

  it('via le point d\'entrée de l\'app, une fois la table en cache', () => {
    definirEnseignesEnCache(ENSEIGNES_BASE);
    expect(storeIdFromName('UTILE AIX EN PROVENCE')).toBe('utile');
    expect(storeIdFromName('U EXPRESS SANARY')).toBe('uexpress');
    expect(storeIdFromName('LEADER PRICE TOULON')).toBe('leaderprice');
  });

  it('« u express » retrouve le slug « u-express », quelle que soit la ponctuation', () => {
    expect(storeIdFromNameAvecEnseignes('U-Express', ENSEIGNES_BASE)).toBe('uexpress');
    expect(storeIdFromNameAvecEnseignes('u.express', ENSEIGNES_BASE)).toBe('uexpress');
  });

  it('CARREFOUR CITY donne Carrefour City si elle existe, sinon Carrefour', () => {
    const avecCity = [...ENSEIGNES_BASE, { nom: 'Carrefour City', slug: 'carrefour-city' }];
    expect(storeIdFromNameAvecEnseignes('CARREFOUR CITY TOULON', avecCity)).toBe('carrefourcity');
    // L'ordre de la table ne change rien : c'est la longueur qui tranche.
    expect(storeIdFromNameAvecEnseignes('CARREFOUR CITY TOULON', [...avecCity].reverse())).toBe('carrefourcity');
    expect(storeIdFromNameAvecEnseignes('CARREFOUR CITY TOULON', ENSEIGNES_BASE)).toBe('carrefour');
  });

  it('mots entiers uniquement : « inutile » n\'est pas l\'enseigne Utile', () => {
    expect(trouverEnseigneDansNom('MAGASIN INUTILE', ENSEIGNES_BASE)).toBeNull();
  });

  it('enseigne absente de la table -> liste en dur ; rien nulle part -> "autre"', () => {
    expect(storeIdFromNameAvecEnseignes('SUPER U BANDOL', ENSEIGNES_BASE)).toBe('superu');
    expect(storeIdFromNameAvecEnseignes('MONOPRIX', ENSEIGNES_BASE)).toBe('monoprix');
    expect(storeIdFromNameAvecEnseignes('EPICERIE DU PORT', ENSEIGNES_BASE)).toBe('autre');
    expect(storeIdFromNameAvecEnseignes('', ENSEIGNES_BASE)).toBe('autre');
    expect(storeIdFromNameAvecEnseignes(null, ENSEIGNES_BASE)).toBe('autre');
  });

  it('table non chargée -> comportement historique strictement identique', () => {
    for (const nom of ['E.LECLERC', 'Carrefour Market', 'LIDL', 'Intermarché', 'SUPER U', 'UTILE AIX', 'Bio c\' Bon', null]) {
      expect(storeIdFromName(nom)).toBe(storeIdFromNameSecours(nom));
      expect(storeIdFromNameAvecEnseignes(nom, null)).toBe(storeIdFromNameSecours(nom));
      expect(storeIdFromNameAvecEnseignes(nom, [])).toBe(storeIdFromNameSecours(nom));
    }
  });

  it('la liste en dur de secours est conservée', () => {
    expect(storeIdFromNameSecours('carrefour city')).toBe('carrefour');
    expect(storeIdFromNameSecours('vival')).toBe('vival');
    expect(storeIdFromNameSecours('bio c\'bon')).toBe('biocbon');
  });
});

describe('défaut 2 — chargement de la table : jamais de plantage', () => {
  beforeEach(() => {
    definirEnseignesEnCache(null);
    reponseSupabase.data = null; reponseSupabase.error = null; reponseSupabase.throws = false;
  });

  it('charge et met en cache', async () => {
    reponseSupabase.data = ENSEIGNES_BASE;
    await chargerEnseignes();
    expect(enseignesEnCache()).toHaveLength(ENSEIGNES_BASE.length);
    expect(storeIdFromName('UTILE AIX EN PROVENCE')).toBe('utile');
  });

  it('erreur Supabase -> secours, sans throw', async () => {
    reponseSupabase.error = { message: 'RLS' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(chargerEnseignes()).resolves.toBeNull();
    expect(storeIdFromName('CARREFOUR CITY')).toBe('carrefour');
  });

  it('exception réseau -> secours, sans throw', async () => {
    reponseSupabase.throws = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(chargerEnseignes()).resolves.toBeNull();
    expect(storeIdFromName('LIDL')).toBe('lidl');
  });

  it('table vide -> secours', async () => {
    reponseSupabase.data = [];
    await expect(chargerEnseignes()).resolves.toBeNull();
    expect(storeIdFromName('NETTO')).toBe('netto');
  });
});

describe('défaut 3 — carte « Nouveau magasin détecté »', () => {
  // Le seul magasin Utile en base (relevé le 06/11/2026).
  const MAGASINS = [
    { id: 'u1', nom: 'Utile', adresse: '5 rue Giboin', code_postal: '83110', ville: 'Sanary-sur-Mer', enseignes: { nom: 'Utile', slug: 'utile' } },
    { id: 'c1', nom: 'Carrefour Market', adresse: '10 avenue de la Gare', code_postal: '13100', ville: 'Aix-en-Provence', enseignes: { nom: 'Carrefour', slug: 'carrefour' } },
  ];
  const TICKET = { nom: 'UTILE AIX EN PROVENCE', adresse: '68 BD DU ROY RENE, 13100 AIX-EN-PROVENCE' };

  it('outils : code postal et similarité façon pg_trgm', () => {
    expect(extraireCodePostal(TICKET.adresse)).toBe('13100');
    expect(similariteTrigramme('5 rue Giboin', '5 RUE GIBOIN')).toBe(1);
    expect(similariteTrigramme('abc', '')).toBe(0);
  });

  it('ticket réel Utile Aix : codes postaux différents -> carte proposée', () => {
    expect(magasinConnuPourTicket({ ...TICKET, enseigneId: 'utile', magasins: MAGASINS })).toBeNull();
    expect(doitProposerNouveauMagasin({ ...TICKET, enseigneId: 'utile', magasins: MAGASINS })).toBe(true);
  });

  it('magasin déjà connu (même CP, adresse proche) -> pas de carte', () => {
    const ticket = { nom: 'UTILE SANARY', adresse: '5 RUE GIBOIN, 83110 SANARY-SUR-MER' };
    expect(doitProposerNouveauMagasin({ ...ticket, enseigneId: 'utile', magasins: MAGASINS })).toBe(false);
  });

  it('même adresse mais autre enseigne connue -> comparé à sa seule enseigne', () => {
    const ticket = { nom: 'UTILE AIX', adresse: '10 avenue de la Gare, 13100 Aix-en-Provence' };
    expect(doitProposerNouveauMagasin({ ...ticket, enseigneId: 'utile', magasins: MAGASINS })).toBe(true);
    // Enseigne inconnue : comme la RPC, on compare à tous les magasins.
    expect(doitProposerNouveauMagasin({ ...ticket, enseigneId: 'autre', magasins: MAGASINS })).toBe(false);
  });

  it('FALLBACK : pas de nom, pas d\'adresse ou liste pas chargée -> pas de carte', () => {
    expect(doitProposerNouveauMagasin({ nom: '', adresse: TICKET.adresse, enseigneId: 'utile', magasins: MAGASINS })).toBe(false);
    expect(doitProposerNouveauMagasin({ nom: TICKET.nom, adresse: '  ', enseigneId: 'utile', magasins: MAGASINS })).toBe(false);
    expect(doitProposerNouveauMagasin({ nom: TICKET.nom, adresse: null, enseigneId: 'utile', magasins: MAGASINS })).toBe(false);
    expect(doitProposerNouveauMagasin({ ...TICKET, enseigneId: 'utile', magasins: null })).toBe(false);
  });

  it('la carte est câblée dans l\'écran magasin, au-dessus du sélecteur inchangé', () => {
    const iCarte = app.indexOf('🏪 Nouveau magasin détecté');
    const iSelecteur = app.indexOf('🏪 Dans quel magasin as-tu fait ce ticket ?');
    expect(iCarte).toBeGreaterThan(0);
    expect(iSelecteur).toBeGreaterThan(iCarte);
    expect(app).toContain("Oui, c'est là");
    expect(app).toContain('Choisir un autre magasin');
    expect(app).toContain('onClick={validerNouveauMagasinTicket}');
    // La zone grise anti-doublon est toujours là.
    expect(app).toContain("Ce magasin existe peut-être déjà");
  });
});
