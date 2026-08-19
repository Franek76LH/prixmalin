import { describe, it, expect } from 'vitest';
import {
  origineSuggestion,
  texteOrigine,
  aUneSuggestion,
  construireCarteSuggestion,
  formatVarianteSuggeree,
  compterAConfirmerParJour,
  jourArchive,
  ORIGINE_MEMOIRE,
  ORIGINE_LIBELLE,
} from './suggestionsRattachement';
import { divergenceAssociation, vocabulaireProduit } from './coherenceAssociation';

// Les 6 suggestions réelles du ticket Carrefour
// a9ad412b-56ea-43ed-91d8-3dcbb200984d (41 lignes, 0 rattachée, 6 suggestions,
// 35 sans rien, 0 prix), relevées en base le 19/08. Deux sont FAUSSES et
// doivent rester refusables.
const TICKET_CARREFOUR = [
  { libelle: '4*250G CAMEMBERT RUS', suggere: 'Camembert',           confiance: null,  juste: true },
  { libelle: '4*BANANES',            suggere: 'Banane',              confiance: null,  juste: true },
  { libelle: '4*BPARTS JAMBON A L',  suggere: 'Jambon cuit',         confiance: null,  juste: true },
  { libelle: '4*35,5 CL RED BULL R', suggere: 'Boisson énergisante', confiance: 0.895, juste: true },
  { libelle: '4*PEPSI ZERO SUCRES',  suggere: 'Cola',                confiance: null,  juste: false },
  { libelle: '4*TOMATE NOIRE',       suggere: 'Tomate grappe',       confiance: null,  juste: false },
];

// ── Provenance de la devinette ──────────────────────────────────────────────
describe('origine de la suggestion', () => {
  it('un score renseigné vient de la mémoire d\'enseigne floue', () => {
    expect(origineSuggestion(0.895)).toBe(ORIGINE_MEMOIRE);
    expect(texteOrigine(0.895)).toBe('déjà vu dans cette enseigne');
  });

  it('pas de score : la suggestion vient d\'un alias sur le libellé', () => {
    expect(origineSuggestion(null)).toBe(ORIGINE_LIBELLE);
    expect(texteOrigine(null)).toBe("d'après le libellé");
  });

  it('numeric Postgres arrive en chaîne via PostgREST : « 0.895 » compte comme un score', () => {
    expect(origineSuggestion('0.895')).toBe(ORIGINE_MEMOIRE);
  });

  it('une valeur illisible n\'invente pas une mémoire d\'enseigne', () => {
    expect(origineSuggestion('bof')).toBe(ORIGINE_LIBELLE);
    expect(origineSuggestion(undefined)).toBe(ORIGINE_LIBELLE);
  });

  it('sur le ticket Carrefour, seul Red Bull vient de la mémoire d\'enseigne', () => {
    const memoire = TICKET_CARREFOUR.filter(l => origineSuggestion(l.confiance) === ORIGINE_MEMOIRE);
    expect(memoire.map(l => l.libelle)).toEqual(['4*35,5 CL RED BULL R']);
  });
});

// ── Exploitabilité ──────────────────────────────────────────────────────────
describe('aUneSuggestion', () => {
  it('un produit résolu avec un nom : exploitable', () => {
    expect(aUneSuggestion({ produit: { id: 'p1', nom_reference: 'Camembert' } })).toBe(true);
  });

  it('rien, ou un produit sans nom (fiche supprimée) : on retombe sur la recherche', () => {
    expect(aUneSuggestion(null)).toBe(false);
    expect(aUneSuggestion({})).toBe(false);
    expect(aUneSuggestion({ produit: { id: 'p1' } })).toBe(false);
    expect(aUneSuggestion({ produit: { nom_reference: 'Camembert' } })).toBe(false);
  });
});

// ── La carte ────────────────────────────────────────────────────────────────
describe('construireCarteSuggestion', () => {
  it('porte le libellé brut, le produit deviné et la provenance', () => {
    const c = construireCarteSuggestion({
      libelleTicket: '4*35,5 CL RED BULL R',
      suggestion: {
        produit: { id: 'p1', nom_reference: 'Boisson énergisante' },
        variante: { id: 'v1', quantite_nette: 35.5, unite_quantite: 'cl', nombre_unites: 4, marques: { nom: 'Red Bull' } },
        confiance: 0.895,
      },
    });
    expect(c.libelleTicket).toBe('4*35,5 CL RED BULL R');
    expect(c.libelleTicketDisponible).toBe(true);
    expect(c.nomProduit).toBe('Boisson énergisante');
    expect(c.marque).toBe('Red Bull');
    expect(c.format).toBe('4 × 35.5 cl');
    expect(c.origine).toBe('déjà vu dans cette enseigne');
    expect(c.confiance).toBe(0.895);
  });

  it('sans variante suggérée, ni marque ni format ne sont inventés', () => {
    const c = construireCarteSuggestion({
      libelleTicket: '4*250G CAMEMBERT RUS',
      suggestion: { produit: { id: 'p2', nom_reference: 'Camembert' }, variante: null, confiance: null },
    });
    expect(c.marque).toBeNull();
    expect(c.format).toBeNull();
    expect(c.origine).toBe("d'après le libellé");
  });

  it('libellé brut vide : la carte existe quand même (point 6)', () => {
    const c = construireCarteSuggestion({
      libelleTicket: '',
      suggestion: { produit: { id: 'p2', nom_reference: 'Camembert' } },
    });
    expect(c).not.toBeNull();
    expect(c.libelleTicketDisponible).toBe(false);
    expect(c.nomProduit).toBe('Camembert');
  });

  it('pas de suggestion exploitable : pas de carte, jamais une carte vide', () => {
    expect(construireCarteSuggestion({ libelleTicket: 'X', suggestion: null })).toBeNull();
    expect(construireCarteSuggestion()).toBeNull();
  });
});

describe('formatVarianteSuggeree', () => {
  it('quantité simple et lot', () => {
    expect(formatVarianteSuggeree({ quantite_nette: 250, unite_quantite: 'g' })).toBe('250 g');
    expect(formatVarianteSuggeree({ quantite_nette: 35.5, unite_quantite: 'cl', nombre_unites: 4 })).toBe('4 × 35.5 cl');
  });
  it('donnée manquante : null, jamais une chaîne bancale', () => {
    expect(formatVarianteSuggeree(null)).toBeNull();
    expect(formatVarianteSuggeree({ quantite_nette: 0, unite_quantite: 'g' })).toBeNull();
    expect(formatVarianteSuggeree({ quantite_nette: 250 })).toBeNull();
  });
});

// ── Le garde-fou du 110, élargi au 111b ────────────────────────────────────
//
// Chantier 111 : le bandeau se déclenchait sur 3 des 6 suggestions, dont 2 à
// tort. Un signal juste une fois sur trois cesse d'être lu.
//
// Chantier 111b : le côté PRODUIT de la comparaison ne se limite plus à
// nom_reference. Il réunit le nom, les alias ACTIFS et les marques des
// variantes ACTIVES — des informations que l'app avait déjà en base et
// n'utilisait pas. Le côté ticket, lui, n'a pas bougé : toujours le texte de
// caisse brut.
//
// Les vocabulaires ci-dessous sont ceux RELEVÉS EN BASE le 19/08 pour les 6
// fiches suggérées. Les figer ici documente ce sur quoi le verdict repose : si
// un alias disparaît, le test dira lequel.
const VOCABULAIRE = {
  'Camembert':           { alias: ['Camembert', 'Camembert de Pays'], marquesVariantes: ['Cœur de Lion', 'Eco+', 'Les Croisés'] },
  'Banane':              { alias: ['Banane vrac', 'Bananes'], marquesVariantes: [] },
  'Jambon cuit':         { alias: ['Bon Paris 41 140', 'Jambon cuit', 'Jambon de Paris', 'Jambon fine JB Torchon', 'Jambon supérieur sans nitrite', 'Jambon torchon', 'Lot jambon torchon'], marquesVariantes: [] },
  'Boisson énergisante': { alias: [], marquesVariantes: ['Red Bull'] },
  'Cola':                { alias: ['Soda cola', "Soda Jean's Cola Bouteille", "Soda Jean's Cola Canette"], marquesVariantes: ["Jean's"] },
  'Tomate grappe':       { alias: ['Tomate ronde en grappe', 'Tomate ronde grappe', 'Tomates grappe'], marquesVariantes: [] },
};

const juger = (l) => divergenceAssociation({
  libelleTicket: l.libelle,
  nomProduit: l.suggere,
  ...VOCABULAIRE[l.suggere],
});

const ligne = (libelle) => TICKET_CARREFOUR.find(l => l.libelle === libelle);

describe('garde-fou élargi — les 6 verdicts du ticket Carrefour, figés', () => {
  // ── LA seule vraie prise ───────────────────────────────────────────────────
  it('CRIE sur 4*PEPSI ZERO SUCRES -> Cola', () => {
    // Vocabulaire complet de la fiche Cola : « Cola », ses alias « Soda cola »,
    // « Soda Jean's Cola Bouteille/Canette », et la marque « Jean's ». Aucun de
    // ces mots n'apparaît dans « PEPSI ZERO SUCRES ». L'élargissement ne l'a
    // donc PAS fait taire — c'était le risque, il est écarté.
    expect(juger(ligne('4*PEPSI ZERO SUCRES'))).toBe(true);
  });

  // ── Les deux fausses alertes que le 111b supprime ─────────────────────────
  it('SE TAIT sur 4*BANANES -> Banane, grâce à l\'alias actif « Bananes »', () => {
    expect(juger(ligne('4*BANANES'))).toBe(false);
  });

  it('SE TAIT sur 4*35,5 CL RED BULL R -> Boisson énergisante, grâce à la marque « Red Bull »', () => {
    // Le ticket nomme la marque, la fiche nomme la catégorie. Sans les marques
    // des variantes, ces deux textes n'ont rien en commun alors que le
    // rapprochement est juste.
    expect(juger(ligne('4*35,5 CL RED BULL R'))).toBe(false);
  });

  // ── Inchangés par le 111b ─────────────────────────────────────────────────
  it('SE TAIT sur 4*250G CAMEMBERT RUS -> Camembert (déjà silencieux avant)', () => {
    expect(juger(ligne('4*250G CAMEMBERT RUS'))).toBe(false);
  });

  it('SE TAIT sur 4*BPARTS JAMBON A L -> Jambon cuit (déjà silencieux avant)', () => {
    expect(juger(ligne('4*BPARTS JAMBON A L'))).toBe(false);
  });

  // ── LE RATÉ, ASSUMÉ ───────────────────────────────────────────────────────
  it('NE RATTRAPE PAS 4*TOMATE NOIRE -> Tomate grappe : CHOIX ASSUMÉ', () => {
    // « tomate » est commun aux deux, et le serait même sans l'élargissement.
    // Ce garde-fou attrape l'ABSURDE, pas le SOUS-TYPE — une tomate noire et
    // une tomate grappe sont deux variétés, pas deux mondes.
    //
    // Le filet sur ce cas n'est pas le bandeau : c'est le récapitulatif du 110,
    // qui affiche « 4*TOMATE NOIRE » face à « Tomate grappe » en toutes
    // lettres. C'est précisément pourquoi aucune suggestion ne saute cette
    // étape. Élargir le garde-fou jusqu'à trancher les sous-types le ferait
    // crier sur des rapprochements justes, et on retomberait dans le défaut
    // que le 111b vient de réparer.
    expect(juger(ligne('4*TOMATE NOIRE'))).toBe(false);
  });

  it('au total, le bandeau ne se manifeste plus que sur 1 des 6 suggestions', () => {
    // Chantier 111 : 3 sur 6, dont 2 à tort. Chantier 111b : 1 sur 6, juste.
    const crient = TICKET_CARREFOUR.filter(juger);
    expect(crient.map(l => l.libelle)).toEqual(['4*PEPSI ZERO SUCRES']);
  });

  it('et cette seule alerte porte bien sur une suggestion FAUSSE', () => {
    expect(TICKET_CARREFOUR.filter(juger).every(l => l.juste === false)).toBe(true);
  });
});

describe('garde-fou élargi — le repli', () => {
  // Le fallback obligatoire : lecture en base en échec ou vide.
  it('sans alias ni marques, on retrouve exactement le comportement du 111', () => {
    expect(divergenceAssociation({ libelleTicket: '4*BANANES', nomProduit: 'Banane' })).toBe(true);
    expect(divergenceAssociation({ libelleTicket: '4*250G CAMEMBERT RUS', nomProduit: 'Camembert' })).toBe(false);
  });

  it('des listes absentes, nulles ou mal formées ne font jamais planter', () => {
    for (const mauvais of [null, undefined, 'pas un tableau', 42, {}]) {
      expect(() => divergenceAssociation({
        libelleTicket: '4*BANANES', nomProduit: 'Banane',
        alias: mauvais, marquesVariantes: mauvais,
      })).not.toThrow();
    }
  });

  it('des entrées vides ou non textuelles sont ignorées, pas concaténées', () => {
    expect(vocabulaireProduit({
      nomProduit: 'Banane', marque: null,
      alias: ['Bananes', '', null, 42, '   '], marquesVariantes: [undefined],
    })).toBe('Banane Bananes');
  });

  it('le vocabulaire de base reste le nom et la marque', () => {
    expect(vocabulaireProduit({ nomProduit: 'Moutarde', marque: 'Maille' })).toBe('Moutarde Maille');
    expect(vocabulaireProduit()).toBe('');
  });
});

// ── Le compte par jour ──────────────────────────────────────────────────────
describe('compterAConfirmerParJour', () => {
  it('regroupe les lignes par date de ticket', () => {
    const compte = compterAConfirmerParJour([
      { id: '1', tickets: { date_ticket: '2026-08-19' } },
      { id: '2', tickets: { date_ticket: '2026-08-19' } },
      { id: '3', tickets: { date_ticket: '2026-08-18' } },
    ]);
    expect(compte.get('2026-08-19')).toBe(2);
    expect(compte.get('2026-08-18')).toBe(1);
  });

  it('une ligne sans date n\'est pas comptée n\'importe où', () => {
    const compte = compterAConfirmerParJour([{ id: '1' }, { id: '2', tickets: {} }]);
    expect(compte.size).toBe(0);
  });

  it('rien à compter : une carte vide, pas une erreur', () => {
    expect(compterAConfirmerParJour(null).size).toBe(0);
    expect(compterAConfirmerParJour([]).size).toBe(0);
  });
});

describe('jourArchive', () => {
  it('ramène une date d\'archive au format de tickets.date_ticket', () => {
    expect(jourArchive('2026-08-19T14:32:00.000Z')).toBe('2026-08-19');
  });
  it('date illisible : null, jamais « Invalid Date »', () => {
    expect(jourArchive('pas une date')).toBeNull();
    expect(jourArchive(null)).toBeNull();
  });
});
