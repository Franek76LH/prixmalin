import { describe, it, expect, vi } from 'vitest';
import {
  parserCsv, estDisponible, parserPrixEuros, parserDateReleve,
  genererSlug, distanceLevenshtein, similariteTexte, prixDejaImporte,
  ecrireNouveauProduit,
} from './import-drive-csv.js';

// Faux client Supabase minimal : chaque .eq()/.is() renvoie this (chaînable),
// seul .maybeSingle() est observé pour décider du résultat.
function creerSupabaseSimule(ligneTrouvee) {
  const requete = {
    eq: vi.fn(() => requete),
    is: vi.fn(() => requete),
    select: vi.fn(() => requete),
    maybeSingle: vi.fn(async () => ({ data: ligneTrouvee, error: null })),
  };
  return { from: vi.fn(() => requete), _requete: requete };
}

const ENTETE = 'date_releve;enseigne;magasin_source;identifiant_magasin;identifiant_produit_leclerc;rayon_id;famille_id;sous_famille_id;categorie_source;famille_source;sous_famille_source;nom_produit;format;marque_principale_estimee;marques_source;mdd_source;prix_euros;prix_affiche;prix_unitaire_reference_euros;prix_unitaire_reference_affiche;promotion_active;promotion_texte;disponible;quantite_disponible_source;unite_mesure;contenance_unitaire;contenance_totale;unite_mesure_totale;bio_source;labels_qualite_source;nutri_score_source;note_clients;nombre_avis;url_produit;url_image;id_photo;code_lot_promotion;type_prix;url_rayon';
const LIGNE_EXEMPLE = '2026-06-30;E.Leclerc;E.Leclerc Drive Marseille Sormiou;031301;221;284319;284421;284429;Épicerie salée;Pâtes, Riz, Purées, Féculents;Couscous, Blés et Céréales;Couscous Ferrero grain;fin - 1kg;;;False;2.71;2,71 €;2.71;2,71 € / kg;False;;True;7;KG;1.0;1.0;kg;False;;A;5.0;1;https://exemple.test/produit;https://exemple.test/image.jpg;3050553;;Drive assimilé magasin (hypothèse pilote);https://exemple.test/rayon';

describe('parserCsv', () => {
  it('gère le BOM UTF-8 en tête de fichier', () => {
    const avecBom = '﻿' + ENTETE + '\n' + LIGNE_EXEMPLE;
    const lignes = parserCsv(avecBom);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].date_releve).toBe('2026-06-30');
  });

  it('associe chaque valeur à son nom de colonne réel (pas de comptage manuel)', () => {
    const lignes = parserCsv(ENTETE + '\n' + LIGNE_EXEMPLE);
    expect(lignes[0].nom_produit).toBe('Couscous Ferrero grain');
    expect(lignes[0].mdd_source).toBe('False');
    expect(lignes[0].disponible).toBe('True');
    expect(lignes[0].identifiant_magasin).toBe('031301');
  });
});

describe('estDisponible', () => {
  it('reconnaît True comme disponible', () => expect(estDisponible('True')).toBe(true));
  it('rejette False', () => expect(estDisponible('False')).toBe(false));
  it('rejette toute valeur inattendue par défaut (jamais de supposition)', () => {
    expect(estDisponible('')).toBe(false);
    expect(estDisponible('true')).toBe(false);
  });
});

describe('parserPrixEuros', () => {
  it('parse un prix à séparateur point', () => expect(parserPrixEuros('2.71')).toBe(2.71));
  it('rejette une valeur non numérique', () => expect(parserPrixEuros('abc')).toBeNull());
  it('rejette une valeur vide', () => expect(parserPrixEuros('')).toBeNull());
  it('rejette un prix négatif', () => expect(parserPrixEuros('-1')).toBeNull());
});

describe('parserDateReleve', () => {
  it('parse une date AAAA-MM-JJ valide', () => {
    expect(parserDateReleve('2026-06-30')).toBe(new Date('2026-06-30T00:00:00Z').toISOString());
  });
  it('rejette un format de date différent', () => expect(parserDateReleve('30/06/2026')).toBeNull());
});

describe('genererSlug', () => {
  it('normalise accents, casse et espaces', () => expect(genererSlug('Couscous Ferrero grain')).toBe('couscous-ferrero-grain'));
  it("ne produit jamais de slug vide", () => expect(genererSlug('')).toBe('produit'));
});

describe('distanceLevenshtein / similariteTexte', () => {
  it('distance nulle pour deux textes identiques', () => expect(distanceLevenshtein('pates', 'pates')).toBe(0));
  it('similarité de 1 pour deux textes identiques', () => expect(similariteTexte('Pâtes', 'pates')).toBeCloseTo(1, 1));
  it('similarité basse pour deux textes très différents', () => expect(similariteTexte('Couscous Ferrero', 'Riz basmati Uncle Bens')).toBeLessThan(0.5));
});

describe('prixDejaImporte (protection anti-doublon)', () => {
  const params = { produitId: 'p1', varianteProduitId: 'v1', prixEuros: 2.71, dateObservation: '2026-06-30T00:00:00.000Z' };

  it('renvoie true si une ligne identique existe déjà', async () => {
    const supabase = creerSupabaseSimule({ id: 'prix-existant' });
    expect(await prixDejaImporte(supabase, params)).toBe(true);
  });

  it('renvoie false si aucune ligne ne correspond', async () => {
    const supabase = creerSupabaseSimule(null);
    expect(await prixDejaImporte(supabase, params)).toBe(false);
  });

  it('utilise .is() plutôt que .eq() quand varianteProduitId est null', async () => {
    const supabase = creerSupabaseSimule(null);
    await prixDejaImporte(supabase, { ...params, varianteProduitId: null });
    expect(supabase._requete.is).toHaveBeenCalledWith('variante_produit_id', null);
    expect(supabase._requete.eq).not.toHaveBeenCalledWith('variante_produit_id', expect.anything());
  });
});

describe('ecrireNouveauProduit (collision de slug)', () => {
  // Reproduit le cas réel #66 : deux nom_produit distincts ("...Bio" et
  // "...Bio'") produisent le même slug. Le premier insert doit échouer avec
  // une violation 23505 sur produits_slug_key, puis réussir au second essai
  // avec un slug suffixé, sans jamais planter tout l'import.
  function creerSupabaseInsertion({ echecsSlug = 1 } = {}) {
    let tentativesProduit = 0;
    const slugsTentes = [];
    const table = (nom) => ({
      insert: vi.fn((valeurs) => {
        if (nom === 'produits') {
          tentativesProduit += 1;
          slugsTentes.push(valeurs.slug);
          if (tentativesProduit <= echecsSlug) {
            return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "produits_slug_key"' } }) }) };
          }
          return { select: () => ({ single: async () => ({ data: { id: 'produit-1' }, error: null }) }) };
        }
        if (nom === 'variantes_produit') {
          return { select: () => ({ single: async () => ({ data: { id: 'variante-1' }, error: null }) }) };
        }
        if (nom === 'alias_produits') {
          return Promise.resolve({ error: null });
        }
        throw new Error(`table non simulée : ${nom}`);
      }),
    });
    return { from: vi.fn((nom) => table(nom)), _slugsTentes: slugsTentes };
  }

  const resolution = { nomProduit: "Sauce tomate bio Jardin Bio'", format: 'Bocal', typeUnite: 'poids', uniteBase: 'kg', quantiteNette: 0.5, uniteQuantite: 'kg' };

  it('retente avec un slug suffixé après une collision, sans planter', async () => {
    const supabase = creerSupabaseInsertion({ echecsSlug: 1 });
    const resultat = await ecrireNouveauProduit(supabase, resolution, 'sous-cat-1');
    expect(resultat.produitId).toBe('produit-1');
    expect(supabase._slugsTentes).toEqual(['sauce-tomate-bio-jardin-bio', 'sauce-tomate-bio-jardin-bio-2']);
  });

  it('réussit directement quand il n\'y a pas de collision', async () => {
    const supabase = creerSupabaseInsertion({ echecsSlug: 0 });
    await ecrireNouveauProduit(supabase, resolution, 'sous-cat-1');
    expect(supabase._slugsTentes).toEqual(['sauce-tomate-bio-jardin-bio']);
  });
});
