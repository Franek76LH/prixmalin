import { describe, it, expect } from 'vitest';
import { termesRechercheOff, motsPourRepli, fusionnerResultatsParMot } from './rechercheRepli.js';

// Chantier 103b — les 7 cas du 103 sont conservés, avec l'attendu CORRIGÉ :
// la marque ne doit plus jamais entrer dans la requête catalogue.
describe('termesRechercheOff', () => {
  const cas = [
    ['marque listée par OFF, déjà dans le nom', { nom: 'Nutella', marque: 'Nutella, Ferrero, Yum yum' }, 'Nutella'],
    ['marque absente du nom : exclue quand même', { nom: 'Pâtes serpentini', marque: 'Panzani' }, 'Pâtes serpentini'],
    ['nom vide : pas de repli sur la marque', { nom: '', marque: 'Bonduelle' }, ''],
    ['pas de marque', { nom: 'Yaourt nature', marque: null }, 'Yaourt nature'],
    ['tout vide', { nom: null, marque: null }, ''],
    ['marque déjà présente dans le nom', { nom: 'Café Grand Mère moulu', marque: 'grand mère' }, 'Café Grand Mère moulu'],
    ['fiche absente', null, ''],
  ];
  for (const [libelle, entree, attendu] of cas) {
    it(libelle, () => expect(termesRechercheOff(entree)).toBe(attendu));
  }

  it('le cas réel Priméal : la marque ne part pas dans la requête', () => {
    expect(termesRechercheOff({ nom: 'Boulgour Petit Épeautre', marque: 'Priméal' }))
      .toBe('Boulgour Petit Épeautre');
  });

  it('tronque un nom à rallonge à 70 caractères', () => {
    expect(termesRechercheOff({ nom: 'a'.repeat(120) })).toHaveLength(70);
  });
});

describe('motsPourRepli', () => {
  it('garde l\'ordre du nom OFF (le classement se fait après les recherches)', () => {
    expect(motsPourRepli('Boulgour Petit Épeautre')).toEqual(['Boulgour', 'Petit', 'Épeautre']);
  });

  // Chantier 103c — le bug dormant du 103b : à 4 lettres, les mots les plus
  // utiles d'un catalogue de courses étaient purement ignorés.
  it('prend les mots de 3 lettres (riz, sel, eau, jus, thé)', () => {
    expect(motsPourRepli('Riz long')).toEqual(['Riz', 'long']);
    expect(motsPourRepli('Gros sel de Guérande')).toEqual(['Gros', 'sel', 'Guérande']);
    expect(motsPourRepli('Eau de source')).toEqual(['Eau', 'source']);
    expect(motsPourRepli('Jus de pomme')).toEqual(['Jus', 'pomme']);
    expect(motsPourRepli('Thé vert menthe')).toEqual(['Thé', 'vert', 'menthe']);
  });

  it('écarte encore les mots de moins de 3 lettres', () => {
    expect(motsPourRepli('Filet de thon au naturel')).toEqual(['Filet', 'thon', 'naturel']);
  });

  it('dédoublonne sans tenir compte de la casse ni des accents', () => {
    expect(motsPourRepli('Épeautre epeautre ÉPEAUTRE')).toEqual(['Épeautre']);
  });

  it('découpe sur la ponctuation et les chiffres restent des mots', () => {
    expect(motsPourRepli("Lait d'amande — 1000 ml")).toEqual(['Lait', 'amande', '1000']);
  });

  it('borne à 6 mots pour ne pas lancer 12 requêtes', () => {
    expect(motsPourRepli('alpha bravo charlie delta echo foxtrot golf hotel'))
      .toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']);
  });

  it('supporte le vide sans planter', () => {
    expect(motsPourRepli('')).toEqual([]);
    expect(motsPourRepli(null)).toEqual([]);
    expect(motsPourRepli('a b c')).toEqual([]);
  });
});

describe('fusionnerResultatsParMot', () => {
  const f = (id, nom) => ({ produit_id: id, nom_reference: nom });
  const lotDe = (prefixe, n) => Array.from({ length: n }, (_, i) => f(`${prefixe}${i}`, `${prefixe} ${i}`));

  // Chantier 103c — LE cas de référence, mesuré en base sur le catalogue réel
  // (EAN 3380380055393 -> nom OFF « Boulgour Petit Épeautre »).
  it('cas de référence Priméal : Épeautre en 1re position', () => {
    const { fiches, motsUtilises } = fusionnerResultatsParMot(
      ['Boulgour', 'Petit', 'Épeautre'], // ordre du nom OFF
      [
        [f('bo1', 'Boulgour'), f('bo2', 'Salade boulgour & lentilles')], // 2 fiches
        lotDe('pe', 17),                                                 // 17 fiches, bruyant
        [f('ep1', 'Épeautre')],                                          // 1 fiche, discriminant
      ],
    );
    // Classement par nombre de fiches croissant : Épeautre (1) -> Boulgour (2) -> Petit (17).
    expect(motsUtilises).toEqual(['Épeautre', 'Boulgour', 'Petit']);
    expect(fiches[0].nom_reference).toBe('Épeautre');
    // 1 + 2 + 4 (Petit plafonné) = 7 fiches, contre 20 au chantier 103b.
    expect(fiches).toHaveLength(7);
    expect(fiches.filter(x => x.produit_id.startsWith('pe'))).toHaveLength(4);
  });

  it('classe au nombre de fiches croissant, pas à la longueur du mot', () => {
    // « riz » (3 lettres, 1 fiche) doit passer devant « chocolat » (8, 20 fiches).
    const { motsUtilises, fiches } = fusionnerResultatsParMot(
      ['chocolat', 'riz'],
      [lotDe('ch', 20), [f('riz1', 'Riz basmati')]],
    );
    expect(motsUtilises).toEqual(['riz', 'chocolat']);
    expect(fiches[0].nom_reference).toBe('Riz basmati');
  });

  it('à égalité, garde l\'ordre d\'apparition dans le nom OFF', () => {
    const { motsUtilises } = fusionnerResultatsParMot(
      ['premier', 'second'],
      [[f('a', 'A'), f('b', 'B')], [f('c', 'C'), f('d', 'D')]],
    );
    expect(motsUtilises).toEqual(['premier', 'second']);
  });

  it('aucun mot ne contribue plus de 4 fiches', () => {
    const { fiches } = fusionnerResultatsParMot(
      ['un', 'deux', 'trois'],
      [lotDe('a', 10), lotDe('b', 10), lotDe('c', 10)],
    );
    expect(fiches).toHaveLength(12);
    for (const prefixe of ['a', 'b', 'c']) {
      expect(fiches.filter(x => x.produit_id.startsWith(prefixe))).toHaveLength(4);
    }
  });

  it('fail-safe : tous les mots bruyants -> la liste n\'est jamais vide', () => {
    // « Chocolat au lait bio » : chocolat 20, lait 20, bio 20. On garde tout de
    // même des propositions, plafonnées, plutôt qu'un écran vide.
    const { fiches, motsUtilises } = fusionnerResultatsParMot(
      ['Chocolat', 'lait', 'bio'],
      [lotDe('ch', 20), lotDe('la', 20), lotDe('bi', 20)],
    );
    expect(fiches.length).toBeGreaterThan(0);
    expect(fiches).toHaveLength(12);
    expect(motsUtilises).toEqual(['Chocolat', 'lait', 'bio']); // égalité -> ordre du nom
  });

  it('dédoublonne par produit_id en gardant l\'occurrence du mot le plus discriminant', () => {
    const { fiches } = fusionnerResultatsParMot(
      ['bruyant', 'precis'],
      [[f('partage', 'vu par les deux'), f('b1', 'B1')], [f('partage', 'vu par les deux')]],
    );
    // « precis » (1 fiche) passe en premier : c'est lui qui pose « partage ».
    expect(fiches.map(x => x.produit_id)).toEqual(['partage', 'b1']);
  });

  it('n\'annonce pas un mot qui n\'a rien apporté', () => {
    const { motsUtilises } = fusionnerResultatsParMot(
      ['Boulgour', 'Épeautre'],
      [[f('a', 'Boulgour')], [f('a', 'Boulgour')]], // le 2e ne ramène qu'un doublon
    );
    expect(motsUtilises).toEqual(['Boulgour']); // à égalité (1 et 1), Boulgour d'abord
  });

  it('plafonne à 20 fiches au total', () => {
    const mots = Array.from({ length: 6 }, (_, i) => `mot${i}`);
    const lots = mots.map((_, i) => lotDe(`p${i}_`, 10));
    // 6 mots x 4 = 24, ramenés à 20 par le plafond global.
    expect(fusionnerResultatsParMot(mots, lots).fiches).toHaveLength(20);
  });

  it('supporte un lot manquant ou une erreur (tableau vide)', () => {
    const { fiches, motsUtilises } = fusionnerResultatsParMot(['a', 'b'], [undefined, [f('x', 'X')]]);
    expect(fiches.map(x => x.produit_id)).toEqual(['x']);
    expect(motsUtilises).toEqual(['b']);
  });

  it('ignore les fiches sans produit_id', () => {
    expect(fusionnerResultatsParMot(['mot'], [[{ nom_reference: 'sans id' }]]).fiches).toEqual([]);
  });
});
