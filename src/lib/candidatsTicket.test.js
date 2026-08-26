import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RPC_CANDIDATS_TICKET,
  COLONNE_TEXTE_CAISSE,
  COLONNE_LIBELLE_OCR,
  texteDeCaisse,
  argumentsCandidatsTicket,
  enseigneEstResolue,
  normaliserCandidatsTicket,
  fusionnerListesCandidats,
  doitAfficherBlocTicket,
} from './candidatsTicket';

// Chantier 114 — LE TEST QUI MORD.
//
// Le défaut corrigé n'est pas un bug de calcul : c'est un mauvais choix de
// COLONNE. « 4x1KG PENNE RIGATE B » (libelle_ticket) donne Penne rigate ;
// « Pâtes » (libelle_brut, la reformulation OCR) donne Coquillettes. Les deux
// chemins « marchent » — l'un se trompe, en silence.
//
// Ces tests échouent si la recherche repasse sur libelle_brut, à deux niveaux :
// dans la logique pure ici, et dans le BRANCHEMENT réel d'App.jsx plus bas
// (le projet n'a ni jsdom ni testing-library : même parti pris que
// RecapitulatifAssociation.test.js et rattachementArchiveTicket.branchement).

// Le cas réel du ticket Carrefour Bonneveine du 19/08.
const LIGNE_PENNE = {
  [COLONNE_LIBELLE_OCR]: 'Pâtes',                 // ce que l'OCR a compris
  [COLONNE_TEXTE_CAISSE]: '4x1KG PENNE RIGATE B', // ce que la caisse a imprimé
};

describe('texteDeCaisse — on lit le ticket, pas la relecture de l\'OCR', () => {
  it('rend le texte imprimé par la caisse, pas le libellé reformulé', () => {
    expect(texteDeCaisse(LIGNE_PENNE)).toBe('4x1KG PENNE RIGATE B');
    expect(texteDeCaisse(LIGNE_PENNE)).not.toBe('Pâtes');
  });

  it('NE SE REPLIE JAMAIS sur libelle_brut quand le texte de caisse manque', () => {
    // Le repli serait le pire des mondes : la recherche « marcherait » et
    // proposerait Coquillettes, sans que rien ne signale la dégradation.
    expect(texteDeCaisse({ [COLONNE_LIBELLE_OCR]: 'Pâtes' })).toBeNull();
    expect(texteDeCaisse({ [COLONNE_LIBELLE_OCR]: 'Plat cuisiné' })).toBeNull();
  });

  it('un texte de caisse vide ou blanc vaut absent, pas une recherche à vide', () => {
    expect(texteDeCaisse({ [COLONNE_TEXTE_CAISSE]: '' })).toBeNull();
    expect(texteDeCaisse({ [COLONNE_TEXTE_CAISSE]: '   ' })).toBeNull();
  });

  it('ne casse pas sur une ligne absente ou mal formée', () => {
    expect(texteDeCaisse(null)).toBeNull();
    expect(texteDeCaisse(undefined)).toBeNull();
    expect(texteDeCaisse({})).toBeNull();
    expect(texteDeCaisse({ [COLONNE_TEXTE_CAISSE]: 42 })).toBeNull();
  });

  it('les deux colonnes sont bien celles de lignes_ticket, aux noms trompeurs', () => {
    expect(COLONNE_TEXTE_CAISSE).toBe('libelle_ticket');
    expect(COLONNE_LIBELLE_OCR).toBe('libelle_brut');
  });
});

describe('argumentsCandidatsTicket — ce qu\'on envoie réellement à la base', () => {
  it('envoie le texte de caisse, jamais le libellé OCR', () => {
    const args = argumentsCandidatsTicket({
      libelleTicket: '4x1KG PENNE RIGATE B',
      enseigne: '1dc405a5-fb30-447c-a766-f26802ed487a',
      enseigneResolue: true,
    });
    expect(args.p_libelle_ticket).toBe('4x1KG PENNE RIGATE B');
    expect(args.p_enseigne).toBe('1dc405a5-fb30-447c-a766-f26802ed487a');
    expect(args.p_limite).toBe(8);
  });

  it('sans texte de caisse : null — on n\'appelle pas la base pour rien', () => {
    // enseigneResolue: true partout, pour que l'ABSENCE DE TEXTE reste la
    // seule cause possible du null (chantier 114b ajoute une seconde cause).
    expect(argumentsCandidatsTicket({ libelleTicket: null, enseigneResolue: true })).toBeNull();
    expect(argumentsCandidatsTicket({ libelleTicket: '  ', enseigneResolue: true })).toBeNull();
    expect(argumentsCandidatsTicket({ enseigneResolue: true })).toBeNull();
    expect(argumentsCandidatsTicket()).toBeNull();
  });

  it('enseigne résolue à AUCUNE : on cherche, une fois, avec p_enseigne null', () => {
    // Chantier 114b — un ticket sans magasin est un cas RÉSOLU, pas une
    // attente : refuser de chercher priverait ces lignes du bloc pour rien.
    // (Avant le 114b, ce test disait « sans enseigne connue, on cherche quand
    // même » — c'est précisément la formulation qui autorisait l'appel à
    // blanc pendant le chargement.)
    const args = argumentsCandidatsTicket({ libelleTicket: 'sac cabas om', enseigneResolue: true });
    expect(args).not.toBeNull();
    expect(args.p_enseigne).toBeNull();
  });

  it('la RPC visée est bien celle déjà créée en base', () => {
    expect(RPC_CANDIDATS_TICKET).toBe('rechercher_candidats_ticket');
  });
});

describe('normaliserCandidatsTicket — une panne ne casse jamais l\'écran', () => {
  it('null, undefined, erreur, forme inattendue -> liste vide', () => {
    expect(normaliserCandidatsTicket(null)).toEqual([]);
    expect(normaliserCandidatsTicket(undefined)).toEqual([]);
    expect(normaliserCandidatsTicket({ message: 'boom' })).toEqual([]);
    expect(normaliserCandidatsTicket('erreur')).toEqual([]);
  });

  it('écarte les lignes sans produit_id, garde les autres DANS L\'ORDRE REÇU', () => {
    const recu = [
      { produit_id: 'b', nom_reference: 'Penne rigate', score: 2 },
      null,
      { nom_reference: 'sans id' },
      { produit_id: 'a', nom_reference: 'Conchiglie rigate', score: 1 },
    ];
    expect(normaliserCandidatsTicket(recu).map(c => c.nom_reference))
      .toEqual(['Penne rigate', 'Conchiglie rigate']);
  });

  it('NE RETRIE PAS : la base a déjà classé, le meilleur reste en tête', () => {
    // Le cas réel : un tri alphabétique ferait passer « Conchiglie rigate »
    // devant « Penne rigate » sur « 4x1KG PENNE RIGATE B ».
    const recu = [
      { produit_id: '1', nom_reference: 'Penne rigate', score: 2 },
      { produit_id: '2', nom_reference: 'Conchiglie rigate', score: 1 },
    ];
    expect(normaliserCandidatsTicket(recu)[0].nom_reference).toBe('Penne rigate');
  });
});

describe('fusionnerListesCandidats — une fiche, une seule ligne', () => {
  const candidatsTicket = [
    { produit_id: 'p1', nom_reference: 'Penne rigate' },
    { produit_id: 'p2', nom_reference: 'Penne protéinées' },
  ];
  const resultatsRecherche = [
    { produit_id: 'p2', nom_reference: 'Penne protéinées' }, // en double
    { produit_id: 'p9', nom_reference: 'Coquillettes' },
  ];

  it('une fiche présente des deux côtés n\'apparaît qu\'en haut', () => {
    const { hautDeListe, resteRecherche } = fusionnerListesCandidats({ candidatsTicket, resultatsRecherche });
    expect(hautDeListe.map(c => c.produit_id)).toEqual(['p1', 'p2']);
    expect(resteRecherche.map(c => c.produit_id)).toEqual(['p9']);
  });

  it('l\'ordre reçu est conservé des deux côtés', () => {
    const { hautDeListe, resteRecherche } = fusionnerListesCandidats({
      candidatsTicket,
      resultatsRecherche: [
        { produit_id: 'z', nom_reference: 'Zèbre' },
        { produit_id: 'a', nom_reference: 'Ananas' },
      ],
    });
    expect(hautDeListe.map(c => c.nom_reference)).toEqual(['Penne rigate', 'Penne protéinées']);
    expect(resteRecherche.map(c => c.nom_reference)).toEqual(['Zèbre', 'Ananas']);
  });

  it('sans bloc du haut, la recherche habituelle est rendue INTACTE', () => {
    // Le cas « 4x4X100G TAB CHO LT » : la RPC ne trouve rien, et l'écran doit
    // se comporter exactement comme avant le chantier 114.
    const { hautDeListe, resteRecherche } = fusionnerListesCandidats({
      candidatsTicket: [],
      resultatsRecherche,
    });
    expect(hautDeListe).toEqual([]);
    expect(resteRecherche).toEqual(resultatsRecherche);
  });

  it('ne casse sur aucune entrée manquante', () => {
    expect(fusionnerListesCandidats()).toEqual({ hautDeListe: [], resteRecherche: [] });
    expect(fusionnerListesCandidats({ candidatsTicket: null, resultatsRecherche: null }))
      .toEqual({ hautDeListe: [], resteRecherche: [] });
  });
});

describe('doitAfficherBlocTicket — zéro résultat, zéro encart', () => {
  it('rien à proposer -> pas de bloc, et pas un mot', () => {
    // « OKAY ESS TT XXL X2 », « sac cabas om » : la base répond correctement
    // « je ne sais pas ». Un encart vide ferait croire à une panne.
    expect(doitAfficherBlocTicket([])).toBe(false);
    expect(doitAfficherBlocTicket(null)).toBe(false);
    expect(doitAfficherBlocTicket(undefined)).toBe(false);
    expect(doitAfficherBlocTicket([{ nom_reference: 'sans id' }])).toBe(false);
  });

  it('au moins une fiche -> bloc affiché', () => {
    expect(doitAfficherBlocTicket([{ produit_id: 'p1', nom_reference: 'Penne rigate' }])).toBe(true);
  });
});

// ── LE BRANCHEMENT RÉEL ─────────────────────────────────────────────────────
//
// La logique ci-dessus peut être parfaite pendant qu'App.jsx envoie tout de
// même libelle_brut à la RPC. Ces tests-là verrouillent le câblage.

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const sheet = app.slice(app.indexOf('function CorrigerProduitSheet('));

describe('branchement dans l\'écran de correction', () => {
  it('la RPC est appelée avec les arguments construits par argumentsCandidatsTicket', () => {
    expect(sheet).toMatch(/const args = argumentsCandidatsTicket\(\{\s*libelleTicket,\s*enseigne,\s*enseigneResolue\s*\}\)/);
    expect(sheet).toMatch(/supabase\.rpc\(RPC_CANDIDATS_TICKET, args\)/);
  });

  it('C\'EST LE TEST QUI MORD : le texte cherché vient de libelle_ticket', () => {
    // Le corps de l'effet, de sa construction d'arguments à sa fin.
    const debut = sheet.indexOf('const args = argumentsCandidatsTicket(');
    const effet = sheet.slice(debut, sheet.indexOf('}, [libelleTicket, enseigne, enseigneResolue]);', debut));
    expect(debut, 'l\'appel à la RPC du chantier 114 a disparu').toBeGreaterThan(-1);
    // Repasser sur la reformulation OCR — par le champ, par la prop, ou par
    // l'article d'archive (item.product, qui EST libelle_brut, cf. la
    // correspondance normName(item.product) === normName(l.libelle_brut)) —
    // fait rougir cette assertion.
    expect(effet).not.toContain('libelle_brut');
    expect(effet).not.toContain('item.product');
    expect(effet).not.toContain('item?.product');
    expect(effet).toContain('libelleTicket');
  });

  it('la prop libelleTicket est bien alimentée par la colonne libelle_ticket', () => {
    // En amont, dans ArchiveTab : la lecture passe par texteDeCaisse, qui ne
    // connaît que libelle_ticket. Remettre `candidats[0]?.libelle_brut` ici
    // ferait rougir ce test ET ceux de texteDeCaisse.
    expect(app).toContain('setLibelleTicketCible(texteDeCaisse(candidats[0]))');
    expect(app).toMatch(/<CorrigerProduitSheet[\s\S]{0,400}libelleTicket=\{libelleTicketCible\}/);
  });

  it('AUCUNE PRÉSÉLECTION : un tap sur le bloc passe par le même choisir', () => {
    // Leçon du chantier 110. Le bloc ne court-circuite ni la résolution de
    // variante ni le récapitulatif : il appelle `choisir`, comme la liste du bas.
    expect(sheet).toMatch(/<BlocCandidatsTicket[\s\S]{0,300}onChoisir=\{choisir\}/);
    // Et il ne touche à aucun état de sélection.
    const bloc = sheet.slice(sheet.indexOf('<BlocCandidatsTicket'));
    const balise = bloc.slice(0, bloc.indexOf('/>'));
    expect(balise).not.toMatch(/setVarianteChoisie|setProduitEnAttente|setRecapitulatif|setQuery/);
  });

  it('la liste du bas est dédoublonnée, la recherche existante est intacte', () => {
    expect(sheet).toMatch(/const \{ hautDeListe, resteRecherche \} = fusionnerListesCandidats\(/);
    expect(sheet).toContain('{resteRecherche.map(p => (');
    // ADDITIF : la recherche du catalogue n'a pas bougé.
    expect(sheet).toContain("supabase.rpc('rechercher_produits_pour_correction'");
  });

  it('une panne de la RPC laisse une liste vide, sans message d\'erreur', () => {
    const debut = sheet.indexOf('const args = argumentsCandidatsTicket(');
    const effet = sheet.slice(debut, sheet.indexOf('}, [libelleTicket, enseigne, enseigneResolue]);', debut));
    expect(effet).toContain('setCandidatsTicket([])');
    // setError afficherait « Recherche impossible » pour un bloc qui n'est
    // qu'un bonus : l'écran de correction resterait utilisable, mais l'utilisateur
    // croirait à une panne de SA recherche.
    expect(effet).not.toContain('setError(');
  });
});


// ── CHANTIER 114b — LE COMPTE D'APPELS ──────────────────────────────────────
//
// LE CAS RÉEL, mesuré en base sur « 4x1KG PENNE RIGATE B » :
//   appel SANS enseigne             -> « Penne protéinées » en tête
//   appel AVEC enseigne (Carrefour) -> « Penne rigate » en tête
//
// Le défaut n'était donc pas un réordonnancement cosmétique : pendant tout
// l'aller-retour du premier appel, la MAUVAISE fiche occupait la première
// position, à portée de pouce. Un tap à cet instant grave une correspondance
// fausse dans la mémoire de l'enseigne (chantier 113), qui se réappliquera
// toute seule aux tickets suivants.
//
// Ces tests comptent les APPELS, pas le résultat final : un code qui appelle
// deux fois puis affiche le bon classement les fait rougir quand même. C'est
// le double appel qui est interdit, pas son résultat.

const CARREFOUR = '1dc405a5-fb30-447c-a766-f26802ed487a';

// Rejoue la vie d'une ligne : chaque entrée est une passe de l'effet React,
// dans l'ordre où les données arrivent réellement. On garde les args non nuls
// — c'est-à-dire, exactement, les appels à la RPC.
const appelsPour = (passes) => passes.map(argumentsCandidatsTicket).filter(Boolean);

describe('enseigneEstResolue — « pas encore » n\'est pas « aucune »', () => {
  it('seul true vaut résolu', () => {
    expect(enseigneEstResolue(true)).toBe(true);
    expect(enseigneEstResolue(false)).toBe(false);
    expect(enseigneEstResolue(undefined)).toBe(false);
    expect(enseigneEstResolue(null)).toBe(false);
  });

  it('aucune valeur « presque vraie » ne passe : le drapeau doit être explicite', () => {
    // Un uuid, une chaîne, un 1... tout cela veut dire « quelqu'un a passé
    // autre chose qu'une décision » — donc on ne cherche pas.
    for (const bidon of [1, 'true', CARREFOUR, {}, []]) {
      expect(enseigneEstResolue(bidon), `${JSON.stringify(bidon)} ne doit pas valoir résolu`).toBe(false);
    }
  });
});

describe('un seul appel par ligne, et jamais avant de savoir où on est', () => {
  it('LE TEST QUI MORD : UN appel pour une ligne normale, pas deux', () => {
    // La séquence réelle : la feuille est montée à vide, puis le texte de
    // caisse arrive, puis l'enseigne. Trois passes de l'effet, UN appel.
    const appels = appelsPour([
      { libelleTicket: null, enseigne: null, enseigneResolue: false },                 // montage
      { libelleTicket: '4x1KG PENNE RIGATE B', enseigne: null, enseigneResolue: false }, // texte arrivé
      { libelleTicket: '4x1KG PENNE RIGATE B', enseigne: CARREFOUR, enseigneResolue: true }, // enseigne résolue
    ]);
    expect(appels).toHaveLength(1);
    // Et c'est bien l'appel TRIÉ : celui qui met « Penne rigate » en tête.
    expect(appels[0].p_enseigne).toBe(CARREFOUR);
    expect(appels[0].p_libelle_ticket).toBe('4x1KG PENNE RIGATE B');
  });

  it('AUCUN appel tant que l\'enseigne n\'est pas résolue, même si on la connaît déjà', () => {
    // Le piège qu'on interdit : `enseigne` renseignée mais résolution non
    // annoncée. Passer l'uuid ne suffit pas — c'est la DÉCISION qui autorise.
    expect(appelsPour([
      { libelleTicket: '4x1KG PENNE RIGATE B', enseigne: null, enseigneResolue: false },
      { libelleTicket: '4x1KG PENNE RIGATE B', enseigne: CARREFOUR, enseigneResolue: false },
      { libelleTicket: '4x1KG PENNE RIGATE B', enseigne: CARREFOUR },
    ])).toHaveLength(0);
  });

  it('la lecture de l\'enseigne échoue : ZÉRO appel, plutôt qu\'un classement faux', () => {
    // enseigneCourante retombe à null, mais la résolution n'est pas annoncée :
    // on ne sait toujours pas. Le bloc se tait.
    expect(appelsPour([
      { libelleTicket: '4x200G CAPRICE DIEU', enseigne: null, enseigneResolue: false },
      { libelleTicket: '4x200G CAPRICE DIEU', enseigne: null, enseigneResolue: false },
    ])).toHaveLength(0);
  });

  it('ticket sans magasin : UN appel, avec p_enseigne null — le bloc s\'affiche', () => {
    const appels = appelsPour([
      { libelleTicket: '4x200G CAPRICE DIEU', enseigne: null, enseigneResolue: false },
      { libelleTicket: '4x200G CAPRICE DIEU', enseigne: null, enseigneResolue: true },
    ]);
    expect(appels).toHaveLength(1);
    expect(appels[0].p_enseigne).toBeNull();
  });

  it('changer de ligne ne fait pas repartir un appel à blanc', () => {
    // Ligne A résolue, puis ligne B : la remise à zéro (enseigneResolue false,
    // libellé null) ne doit produire AUCUN appel intermédiaire.
    const appels = appelsPour([
      { libelleTicket: '4xPEPSI ZERO SUCRES', enseigne: CARREFOUR, enseigneResolue: true },  // ligne A
      { libelleTicket: null, enseigne: null, enseigneResolue: false },                        // remise à zéro
      { libelleTicket: '4x1KG GNOCCH POELER', enseigne: null, enseigneResolue: false },       // texte de B
      { libelleTicket: '4x1KG GNOCCH POELER', enseigne: CARREFOUR, enseigneResolue: true },   // B résolue
    ]);
    expect(appels).toHaveLength(2);
    expect(appels.map(a => a.p_libelle_ticket)).toEqual(['4xPEPSI ZERO SUCRES', '4x1KG GNOCCH POELER']);
    expect(appels.every(a => a.p_enseigne === CARREFOUR)).toBe(true);
  });
});

describe('branchement du garde-fou 114b dans l\'écran de correction', () => {
  it('l\'effet dépend de enseigneResolue : il se rejoue quand la réponse tombe', () => {
    // Sans cette dépendance, la résolution n'aurait jamais relancé l'appel et
    // le bloc ne s'afficherait JAMAIS.
    expect(sheet).toContain('}, [libelleTicket, enseigne, enseigneResolue]);');
  });

  it('la feuille reçoit la résolution, pas seulement l\'enseigne', () => {
    expect(app).toMatch(/<CorrigerProduitSheet[\s\S]{0,500}enseigneResolue=\{enseigneResolue\}/);
    // Défaut sûr dans la signature : un appelant qui l'oublie ne cherche pas,
    // plutôt que de chercher trop tôt.
    expect(sheet).toMatch(/function CorrigerProduitSheet\(\{[^}]*enseigneResolue = false/);
  });

  it('la résolution repart de « on ne sait pas » à CHAQUE changement de ligne', () => {
    // Au même endroit que le vidage de l'enseigne du chantier 110 : garder la
    // résolution de la ligne A autoriserait un appel trié sur SON enseigne.
    const reset = app.slice(app.indexOf('setEnseigneCourante(null);'), app.indexOf('if (!correctionCible) return;'));
    expect(reset).toContain('setEnseigneResolue(false);');
  });

  it('la résolution n\'est annoncée QUE sur une réponse, jamais par défaut', () => {
    // TOUT le corps de l'effet, du vidage jusqu'à son nettoyage — pas
    // seulement la fin. Une annonce glissée PLUS HAUT (juste après le
    // chargement du libellé, « pour que le bloc s'affiche plus vite ») est
    // exactement le retour du défaut : elle doit être vue par ce test.
    const debutEffet = app.indexOf('setEnseigneCourante(null);');
    const corps = app.slice(debutEffet, app.indexOf('}, [correctionCible]);', debutEffet));
    // Deux issues légitimes, et deux seulement : pas de magasin sur le ticket,
    // ou lecture réussie de l'enseigne du magasin.
    expect(corps).toContain('if (!magasinId) { if (!annule) { setEnseigneCourante(null); setEnseigneResolue(true); } return; }');
    expect(corps).toContain('if (!errEnseigne) setEnseigneResolue(true);');
    // ET PAS UNE TROISIÈME : deux annonces exactement, toutes deux gardées.
    // Une ligne `setEnseigneResolue(true)` ajoutée ailleurs — par exemple juste
    // après le chargement du libellé, « pour que le bloc s'affiche plus vite » —
    // fait rougir ce compte, et c'est précisément le retour du défaut 114b.
    expect(corps.match(/setEnseigneResolue\(true\)/g)).toHaveLength(2);
    // Une erreur de lecture NE résout rien : la seule annonce du chemin nominal
    // est celle qui est gardée par !errEnseigne.
    expect(corps).not.toMatch(/\n\s*setEnseigneResolue\(true\);/);
  });
});
