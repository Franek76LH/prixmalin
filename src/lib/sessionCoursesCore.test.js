import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from './supabase';
import {
  RAYON_AUTRES,
  emojiRayon,
  chargerRayonsProduits,
  assemblerNomArticle,
  construireArticlesSession,
  construireSessionCourses,
  grouperParRayon,
  calculerProgression,
  appliquerEtatArticle,
  RAYON_NOTE,
  ajouterNoteSession,
  supprimerNoteSession,
  cloreSession,
  idsCaddieASupprimer,
  articlesNonAchetesASupprimer,
  construireBilanCourses,
  doitRattacherTicketSession,
  chargerMarquesVariantes,
  calculerTotalPanier,
  genererIdSession,
  ligneSupabaseDepuisSession,
  sauvegarderSessionSupabase,
  abandonnerSessionsActivesSupabase,
  chargerSessionActiveSupabase,
  choisirSessionLaPlusRecente,
} from './sessionCoursesCore';

const RAYON_EPICERIE = {
  categorie_nom: 'Épicerie salée',
  categorie_slug: 'epicerie-salee',
  categorie_ordre: 5,
  sous_categorie_nom: 'Chips & tuiles',
};

const RAYON_FRUITS = {
  categorie_nom: 'Fruits & légumes',
  categorie_slug: 'fruits-legumes',
  categorie_ordre: 1,
  sous_categorie_nom: 'Fruits frais',
};

// Item du caddie, forme mapperLigneListeCourses (catalogueCore).
function itemBase(overrides) {
  return {
    id: 'lc1',
    product: 'Chips aromatisées',
    qty: 1,
    format: '120 g',
    formatDisplay: '120 g',
    checked: false,
    produit_id: 'p1',
    variante_produit_id: 'v-caddie',
    produit: { id: 'p1', nom_reference: 'Chips aromatisées' },
    variante: { libelle: '', quantite_nette: 120, unite_quantite: 'g', nombre_unites: 1 },
    ...overrides,
  };
}

// Ligne prix_comparables retenue par le comparateur pour le magasin choisi.
function prixBase(overrides) {
  return {
    produit_id: 'p1',
    variante_produit_id: 'v-prix',
    prix_total: 1.85,
    quantite_nette: 120,
    unite_quantite: 'g',
    nombre_unites: 1,
    nom_produit: 'Chips aromatisées',
    nom_marque: "Lay's",
    est_mdd: false,
    ...overrides,
  };
}

describe('assemblerNomArticle', () => {
  it("assemble nom + marque + format depuis les champs réels", () => {
    expect(assemblerNomArticle({
      nom_reference: 'Chips aromatisées', nom_marque: "Lay's", est_mdd: false, format_libelle: '120 g',
    })).toBe("Chips aromatisées Lay's 120 g");
  });

  it("n'affiche jamais la sous-marque distributeur (règle Chantier 84)", () => {
    expect(assemblerNomArticle({
      nom_reference: 'Riz basmati', nom_marque: 'Marque Repère', est_mdd: true, format_libelle: '1 kg',
    })).toBe('Riz basmati 1 kg');
  });

  it('tient sans marque ni format', () => {
    expect(assemblerNomArticle({ nom_reference: 'Sopalin', nom_marque: null, est_mdd: false, format_libelle: '' }))
      .toBe('Sopalin');
  });
});

describe('construireArticlesSession', () => {
  it('fige le produit concret depuis la ligne de prix retenue (marque, format, prix, variante photo)', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [{ itemId: 'lc1', produit_id: 'p1', prix: prixBase() }],
      rayons: new Map([['p1', RAYON_EPICERIE]]),
    });
    expect(articles).toHaveLength(1);
    const a = articles[0];
    expect(a.nom_affiche).toBe("Chips aromatisées Lay's 120 g");
    expect(a.prix_prevu).toBe(1.85);
    expect(a.variante_produit_id).toBe('v-prix'); // variante du PRIX retenu, pas celle du caddie
    expect(a.rayon).toEqual(RAYON_EPICERIE);
    expect(a.etat).toBe('a_prendre');
    expect(a.type).toBe('caddie');
    expect(a.cle).toBe('lc1');
  });

  it("conserve un article sans prix dans ce magasin (prix_prevu null, jamais écarté)", () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [],
      rayons: new Map([['p1', RAYON_EPICERIE]]),
    });
    const a = articles[0];
    expect(a.prix_prevu).toBeNull();
    expect(a.variante_produit_id).toBe('v-caddie'); // repli : variante du caddie
    expect(a.format_libelle).toBe('120 g');
    expect(a.nom_affiche).toBe('Chips aromatisées 120 g'); // pas de marque connue
  });

  it('badge MDD : marque retirée du nom, est_mdd conservé pour le badge générique', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [{ itemId: 'lc1', produit_id: 'p1', prix: prixBase({ nom_marque: 'Marque Repère', est_mdd: true }) }],
      rayons: new Map([['p1', RAYON_EPICERIE]]),
    });
    expect(articles[0].nom_marque).toBeNull();
    expect(articles[0].est_mdd).toBe(true);
    expect(articles[0].nom_affiche).toBe('Chips aromatisées 120 g');
  });

  it('article en texte libre : rayon « Autres articles », pas de photo, pas de prix', () => {
    const articles = construireArticlesSession({
      items: [itemBase({ id: 'lc2', product: 'Sopalin', produit_id: null, variante_produit_id: null, produit: null, variante: null, format: '', formatDisplay: '' })],
      lignesPrix: [],
      rayons: new Map(),
    });
    const a = articles[0];
    expect(a.rayon).toEqual(RAYON_AUTRES);
    expect(a.nom_affiche).toBe('Sopalin');
    expect(a.prix_prevu).toBeNull();
    expect(a.variante_produit_id).toBeNull();
  });

  it('« Format indifférent » (repli caddie) ne fuit jamais dans le nom assemblé', () => {
    const articles = construireArticlesSession({
      items: [itemBase({ variante: null, variante_produit_id: null, format: '', formatDisplay: 'Format indifférent' })],
      lignesPrix: [],
      rayons: new Map([['p1', RAYON_EPICERIE]]),
    });
    expect(articles[0].format_libelle).toBe('');
    expect(articles[0].nom_affiche).toBe('Chips aromatisées');
  });

  it('rayon inconnu pour un produit -> repli « Autres articles »', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [],
      rayons: new Map(), // rayon non résolu
    });
    expect(articles[0].rayon).toEqual(RAYON_AUTRES);
  });

  it('quantité invalide -> 1 (jamais 0 ni NaN)', () => {
    const articles = construireArticlesSession({
      items: [itemBase({ qty: undefined })],
      lignesPrix: [],
      rayons: new Map(),
    });
    expect(articles[0].quantite).toBe(1);
  });
});

describe('construireSessionCourses', () => {
  it('produit un document figé version 1, statut active, dates fournies par l’appelant', () => {
    const session = construireSessionCourses({
      utilisateurId: 'u1',
      magasin: { magasin_id: 'm1', nom: 'E.Leclerc Blotzheim', enseigne: 'E.Leclerc', adresse: '2 rue du Rhin', code_postal: '68730', ville: 'Blotzheim' },
      articles: [{ cle: 'lc1' }],
      totalPrevu: 47.2,
      creeLeISO: '2026-08-11T10:00:00.000Z',
    });
    expect(session.version).toBe(1);
    expect(session.statut).toBe('active');
    expect(session.utilisateur_id).toBe('u1');
    expect(session.cree_le).toBe('2026-08-11T10:00:00.000Z');
    expect(session.modifie_le).toBe('2026-08-11T10:00:00.000Z');
    expect(session.magasin.nom).toBe('E.Leclerc Blotzheim');
    expect(session.total_prevu).toBe(47.2);
    expect(session.articles).toHaveLength(1);
  });

  it('total prévu non numérique -> null (jamais NaN)', () => {
    const session = construireSessionCourses({ utilisateurId: 'u1', magasin: null, articles: [], totalPrevu: undefined, creeLeISO: 'x' });
    expect(session.total_prevu).toBeNull();
    expect(session.magasin.nom).toBe('Magasin');
  });
});

describe('grouperParRayon', () => {
  it("trie par ordre_affichage de catégorie, « Autres articles » toujours en dernier", () => {
    const articles = [
      { cle: '1', rayon: RAYON_EPICERIE },
      { cle: '2', rayon: RAYON_AUTRES },
      { cle: '3', rayon: RAYON_FRUITS },
      { cle: '4', rayon: RAYON_EPICERIE },
    ];
    const groupes = grouperParRayon(articles);
    expect(groupes.map(g => g.rayon.categorie_nom)).toEqual(['Fruits & légumes', 'Épicerie salée', 'Autres articles']);
    expect(groupes[1].articles.map(a => a.cle)).toEqual(['1', '4']); // ordre d'entrée conservé
  });

  it('article sans rayon -> groupe « Autres articles »', () => {
    const groupes = grouperParRayon([{ cle: '1', rayon: null }]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0].rayon).toEqual(RAYON_AUTRES);
  });
});

describe('calculerProgression', () => {
  it('compte pris / restants / introuvables', () => {
    const prog = calculerProgression([
      { etat: 'au_caddie' }, { etat: 'au_caddie' }, { etat: 'a_prendre' }, { etat: 'introuvable' },
    ]);
    expect(prog).toEqual({ total: 4, pris: 2, introuvables: 1, restants: 1 });
  });

  it('liste vide ou absente -> zéros', () => {
    expect(calculerProgression([])).toEqual({ total: 0, pris: 0, introuvables: 0, restants: 0 });
    expect(calculerProgression(undefined)).toEqual({ total: 0, pris: 0, introuvables: 0, restants: 0 });
  });
});

describe('appliquerEtatArticle', () => {
  const sessionBase = () => construireSessionCourses({
    utilisateurId: 'u1',
    magasin: { magasin_id: 'm1', nom: 'Magasin Test' },
    articles: [
      { cle: 'a', etat: 'a_prendre', coche_le: null, rayon: RAYON_FRUITS },
      { cle: 'b', etat: 'a_prendre', coche_le: null, rayon: RAYON_FRUITS },
      { cle: 'c', etat: 'a_prendre', coche_le: null, rayon: RAYON_EPICERIE },
    ],
    totalPrevu: 10,
    creeLeISO: '2026-08-11T10:00:00.000Z',
  });

  it('coche un article (au_caddie) : etat + coche_le + modifie_le, sans réordonner', () => {
    const next = appliquerEtatArticle(sessionBase(), 'b', 'au_caddie', '2026-08-11T10:05:00.000Z');
    expect(next.articles.map(a => a.cle)).toEqual(['a', 'b', 'c']); // ordre intact
    expect(next.articles[1].etat).toBe('au_caddie');
    expect(next.articles[1].coche_le).toBe('2026-08-11T10:05:00.000Z');
    expect(next.articles[0].etat).toBe('a_prendre'); // voisins intacts
    expect(next.modifie_le).toBe('2026-08-11T10:05:00.000Z');
  });

  it('décoche : retour a_prendre, coche_le remis à null, place d’origine dans le rayon', () => {
    const coche = appliquerEtatArticle(sessionBase(), 'a', 'au_caddie', 'T1');
    const decoche = appliquerEtatArticle(coche, 'a', 'a_prendre', 'T2');
    expect(decoche.articles[0].etat).toBe('a_prendre');
    expect(decoche.articles[0].coche_le).toBeNull();
    // Remonte à sa place logique : premier de son rayon dans « À prendre »
    const groupes = grouperParRayon(decoche.articles.filter(a => a.etat === 'a_prendre'));
    expect(groupes[0].articles.map(a => a.cle)).toEqual(['a', 'b']);
  });

  it('marque introuvable puis restaure', () => {
    const intro = appliquerEtatArticle(sessionBase(), 'c', 'introuvable', 'T1');
    expect(intro.articles[2].etat).toBe('introuvable');
    expect(calculerProgression(intro.articles)).toEqual({ total: 3, pris: 0, introuvables: 1, restants: 2 });
    const retour = appliquerEtatArticle(intro, 'c', 'a_prendre', 'T2');
    expect(retour.articles[2].etat).toBe('a_prendre');
  });

  it('clé inconnue, état invalide ou identique -> MÊME référence (aucune écriture inutile)', () => {
    const session = sessionBase();
    expect(appliquerEtatArticle(session, 'zzz', 'au_caddie', 'T1')).toBe(session);
    expect(appliquerEtatArticle(session, 'a', 'etat_bidon', 'T1')).toBe(session);
    expect(appliquerEtatArticle(session, 'a', 'a_prendre', 'T1')).toBe(session);
    expect(appliquerEtatArticle(null, 'a', 'au_caddie', 'T1')).toBeNull();
  });

  it('ne mute jamais la session d’origine (immutabilité)', () => {
    const session = sessionBase();
    appliquerEtatArticle(session, 'a', 'au_caddie', 'T1');
    expect(session.articles[0].etat).toBe('a_prendre');
    expect(session.modifie_le).toBe('2026-08-11T10:00:00.000Z');
  });
});

describe('emojiRayon', () => {
  it('emoji par slug, repli panier pour slug inconnu ou rayon Autres', () => {
    expect(emojiRayon(RAYON_FRUITS)).toBe('🥦');
    expect(emojiRayon(RAYON_AUTRES)).toBe('🧺');
    expect(emojiRayon({ categorie_slug: 'inconnu' })).toBe('🧺');
  });
});

describe('Lot 5 — notes libres (« Ajoutés en route »)', () => {
  const sessionNotes = () => construireSessionCourses({
    id: 'sess-1',
    utilisateurId: 'u1',
    magasin: { magasin_id: 'm1', nom: 'Magasin Test' },
    articles: [{ cle: 'a', type: 'caddie', etat: 'a_prendre', rayon: RAYON_EPICERIE }],
    totalPrevu: 5,
    creeLeISO: 'T0',
  });

  it('ajoute une note : texte seul, sans prix ni photo ni variante, état a_prendre', () => {
    const next = ajouterNoteSession(sessionNotes(), '  Sopalin  ', 'T1', 'id-note-1');
    expect(next.articles).toHaveLength(2);
    const note = next.articles[1];
    expect(note).toMatchObject({
      cle: 'note:id-note-1', type: 'note', nom_affiche: 'Sopalin', etat: 'a_prendre',
      prix_prevu: null, variante_produit_id: null, produit_id: null, quantite: 1,
      rayon: RAYON_NOTE,
    });
    expect(next.modifie_le).toBe('T1');
  });

  it('texte vide/blanc ou id manquant -> même référence (aucune écriture)', () => {
    const session = sessionNotes();
    expect(ajouterNoteSession(session, '   ', 'T1', 'id')).toBe(session);
    expect(ajouterNoteSession(session, null, 'T1', 'id')).toBe(session);
    expect(ajouterNoteSession(session, 'Sopalin', 'T1', null)).toBe(session);
  });

  it('la note se coche/décoche comme un article et compte dans la progression', () => {
    const avecNote = ajouterNoteSession(sessionNotes(), 'Sopalin', 'T1', 'n1');
    expect(calculerProgression(avecNote.articles).total).toBe(2);
    const cochee = appliquerEtatArticle(avecNote, 'note:n1', 'au_caddie', 'T2');
    expect(cochee.articles[1].etat).toBe('au_caddie');
    expect(calculerProgression(cochee.articles)).toEqual({ total: 2, pris: 1, introuvables: 0, restants: 1 });
  });

  it('supprime une note ; refuse de supprimer un article du caddie ou une clé inconnue', () => {
    const avecNote = ajouterNoteSession(sessionNotes(), 'Sopalin', 'T1', 'n1');
    const sansNote = supprimerNoteSession(avecNote, 'note:n1', 'T2');
    expect(sansNote.articles).toHaveLength(1);
    expect(sansNote.modifie_le).toBe('T2');
    expect(supprimerNoteSession(avecNote, 'a', 'T2')).toBe(avecNote);      // article caddie : refus
    expect(supprimerNoteSession(avecNote, 'inconnue', 'T2')).toBe(avecNote); // clé inconnue
  });

  it('RAYON_NOTE se classe toujours après « Autres articles » dans grouperParRayon', () => {
    const groupes = grouperParRayon([
      { cle: 'n', rayon: RAYON_NOTE },
      { cle: 'x', rayon: RAYON_AUTRES },
      { cle: 'a', rayon: RAYON_FRUITS },
    ]);
    expect(groupes.map(g => g.rayon.categorie_nom)).toEqual(['Fruits & légumes', 'Autres articles', 'Ajoutés en route']);
  });
});

describe('Lot 7 — finitions (formats naturels, marque des articles sans prix)', () => {
  it('format en unité naturelle : 0,295 kg -> « 295 g » (prix retenu comme variante caddie)', () => {
    const articlesPrix = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [{ itemId: 'lc1', produit_id: 'p1', prix: prixBase({ quantite_nette: 0.295, unite_quantite: 'kg' }) }],
      rayons: new Map(),
    });
    expect(articlesPrix[0].format_libelle).toBe('295 g');

    const articlesSansPrix = construireArticlesSession({
      items: [itemBase({ variante: { libelle: '0,295 kg', quantite_nette: 0.295, unite_quantite: 'kg', nombre_unites: 1 } })],
      lignesPrix: [],
      rayons: new Map(),
    });
    expect(articlesSansPrix[0].format_libelle).toBe('295 g'); // structuré prioritaire sur le libellé legacy
  });

  it('petit volume : 0,5 L -> « 500 ml »', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [{ itemId: 'lc1', produit_id: 'p1', prix: prixBase({ quantite_nette: 0.5, unite_quantite: 'l' }) }],
      rayons: new Map(),
    });
    expect(articles[0].format_libelle).toBe('500 ml');
  });

  it('article sans prix : la marque de la variante du caddie complète le nom (cohérence photo)', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [],
      rayons: new Map(),
      marquesVariantes: new Map([['v-caddie', { nom: "Lay's", est_mdd: false }]]),
    });
    expect(articles[0].nom_marque).toBe("Lay's");
    expect(articles[0].nom_affiche).toBe("Chips aromatisées Lay's 120 g");
  });

  it('article sans prix, variante MDD : marque masquée mais badge est_mdd', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [],
      rayons: new Map(),
      marquesVariantes: new Map([['v-caddie', { nom: 'Marque Repère', est_mdd: true }]]),
    });
    expect(articles[0].nom_marque).toBeNull();
    expect(articles[0].est_mdd).toBe(true);
  });

  it('avec prix retenu, la marque du caddie est ignorée (le produit concret prime)', () => {
    const articles = construireArticlesSession({
      items: [itemBase()],
      lignesPrix: [{ itemId: 'lc1', produit_id: 'p1', prix: prixBase({ nom_marque: 'Bret’s' }) }],
      rayons: new Map(),
      marquesVariantes: new Map([['v-caddie', { nom: "Lay's", est_mdd: false }]]),
    });
    expect(articles[0].nom_marque).toBe('Bret’s');
  });

  it('chargerMarquesVariantes : aucune requête si vide ; variante sans marque ignorée', async () => {
    vi.clearAllMocks();
    expect((await chargerMarquesVariantes([])).size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();

    const inMock = vi.fn().mockResolvedValue({
      data: [
        { id: 'v1', marques: { nom: "Lay's", est_mdd: false } },
        { id: 'v2', marques: null },
      ],
      error: null,
    });
    supabase.from.mockReturnValue({ select: vi.fn().mockReturnValue({ in: inMock }) });
    const marques = await chargerMarquesVariantes(['v1', 'v2', 'v1', null]);
    expect(inMock).toHaveBeenCalledWith('id', ['v1', 'v2']);
    expect(marques.get('v1')).toEqual({ nom: "Lay's", est_mdd: false });
    expect(marques.has('v2')).toBe(false);
  });
});

describe('Lot 8 — total dynamique du panier', () => {
  it('somme uniquement les articles cochés, pondérés par la quantité', () => {
    const { total, incomplet } = calculerTotalPanier([
      { etat: 'au_caddie', prix_prevu: 1.95, quantite: 2 },
      { etat: 'au_caddie', prix_prevu: 0.5, quantite: 1 },
      { etat: 'a_prendre', prix_prevu: 9.99, quantite: 1 },   // pas coché : ignoré
      { etat: 'introuvable', prix_prevu: 3, quantite: 1 },    // introuvable : ignoré
    ]);
    expect(total).toBeCloseTo(4.4);
    expect(incomplet).toBe(false);
  });

  it('article coché sans prix (prix inconnu ou note) : n’ajoute rien, marque le total incomplet', () => {
    const { total, incomplet } = calculerTotalPanier([
      { etat: 'au_caddie', prix_prevu: 2, quantite: 1 },
      { etat: 'au_caddie', prix_prevu: null, quantite: 1 },          // prix inconnu
      { etat: 'au_caddie', prix_prevu: null, quantite: 1, type: 'note' }, // note libre
    ]);
    expect(total).toBe(2);
    expect(incomplet).toBe(true);
  });

  it('rien de coché (ou liste vide/absente) : 0,00 € et complet', () => {
    expect(calculerTotalPanier([{ etat: 'a_prendre', prix_prevu: null }])).toEqual({ total: 0, incomplet: false });
    expect(calculerTotalPanier([])).toEqual({ total: 0, incomplet: false });
    expect(calculerTotalPanier(undefined)).toEqual({ total: 0, incomplet: false });
  });

  it('quantité invalide -> 1 ; prix non numérique -> traité comme inconnu', () => {
    const { total, incomplet } = calculerTotalPanier([
      { etat: 'au_caddie', prix_prevu: 1.5, quantite: undefined },
      { etat: 'au_caddie', prix_prevu: 'abc', quantite: 1 },
    ]);
    expect(total).toBe(1.5);
    expect(incomplet).toBe(true);
  });
});

describe('Lot 6 — clôture', () => {
  const sessionCloture = () => construireSessionCourses({
    id: 'sess-1', utilisateurId: 'u1', magasin: { magasin_id: 'm1', nom: 'Magasin' },
    articles: [
      { cle: 'lc-1', type: 'caddie', etat: 'au_caddie' },
      { cle: 'lc-2', type: 'caddie', etat: 'introuvable' },
      { cle: 'lc-3', type: 'caddie', etat: 'a_prendre' },
      { cle: 'note:n1', type: 'note', etat: 'au_caddie' },
    ],
    totalPrevu: 9, creeLeISO: 'T0',
  });

  it('cloreSession : active -> terminee avec terminee_le ; jamais deux fois', () => {
    const close = cloreSession(sessionCloture(), 'T9');
    expect(close.statut).toBe('terminee');
    expect(close.terminee_le).toBe('T9');
    expect(close.modifie_le).toBe('T9');
    expect(cloreSession(close, 'T10')).toBe(close); // déjà terminée : même référence
    expect(cloreSession(null, 'T9')).toBeNull();
  });

  it('idsCaddieASupprimer : uniquement les lignes caddie de la session, jamais les notes', () => {
    expect(idsCaddieASupprimer(sessionCloture())).toEqual(['lc-1', 'lc-2', 'lc-3']);
  });

  it('garderIntrouvables : épargne les articles introuvables', () => {
    expect(idsCaddieASupprimer(sessionCloture(), { garderIntrouvables: true })).toEqual(['lc-1', 'lc-3']);
    expect(idsCaddieASupprimer(null)).toEqual([]);
  });

  // Chantier 88 Lot 2 — « À acheter plus tard ».
  it('articlesNonAchetesASupprimer : lignes caddie hors du caddie (a_prendre, introuvable), jamais les achetés ni les notes', () => {
    expect(articlesNonAchetesASupprimer(sessionCloture()).map(a => a.cle)).toEqual(['lc-2', 'lc-3']);
  });

  it('articlesNonAchetesASupprimer + garderIntrouvables : les introuvables épargnés du vidage ne sont plus concernés', () => {
    expect(articlesNonAchetesASupprimer(sessionCloture(), { garderIntrouvables: true }).map(a => a.cle)).toEqual(['lc-3']);
    expect(articlesNonAchetesASupprimer(null)).toEqual([]);
  });

  // Chantier 89 Lot 3 — bilan figé à la clôture.
  it('construireBilanCourses : comptes et total estimé depuis calculerTotalPanier', () => {
    const articles = [
      { cle: 'lc-1', type: 'caddie', etat: 'au_caddie', prix_prevu: 2.5, quantite: 2 },
      { cle: 'lc-2', type: 'caddie', etat: 'introuvable' },
      { cle: 'lc-3', type: 'caddie', etat: 'a_prendre' },
      { cle: 'note:n1', type: 'note', etat: 'au_caddie' },
    ];
    const bilan = construireBilanCourses(articles, { nbReportes: 1, figeLeISO: 'T9' });
    expect(bilan.nb_achetes).toBe(2);           // lc-1 + la note cochée
    expect(bilan.total_estime).toBe(5);         // 2,50 × 2 ; la note sans prix ne compte pas
    expect(bilan.total_incomplet).toBe(true);   // note cochée sans prix => estimation incomplète
    expect(bilan.nb_reporte).toBe(1);
    expect(bilan.nb_non_achetes).toBe(1);       // 2 hors caddie - 1 reporté
    expect(bilan.total_reel).toBeNull();
    expect(bilan.fige_le).toBe('T9');
  });

  it('construireBilanCourses : articles vides ou absents, jamais de plantage', () => {
    const bilan = construireBilanCourses(null);
    expect(bilan).toEqual({ total_estime: 0, total_incomplet: false, nb_achetes: 0, nb_reporte: 0, nb_non_achetes: 0, total_reel: null, fige_le: null });
  });

  // Chantier 90 Lot 4 — rattachement ticket <-> session.
  it('doitRattacherTicketSession : ticket créé (ok / rejet_partiel) oui, rejet total ou échec technique non', () => {
    expect(doitRattacherTicketSession({ statut: 'ok', prix_ecrits: 3, rejets: [] })).toBe(true);
    expect(doitRattacherTicketSession({ statut: 'rejet_partiel', prix_ecrits: 1, rejets: [{}] })).toBe(true);
    expect(doitRattacherTicketSession({ statut: 'rejet', prix_ecrits: 0, rejets: [{}] })).toBe(false);
    expect(doitRattacherTicketSession(null)).toBe(false);
    expect(doitRattacherTicketSession(undefined)).toBe(false);
  });
});

describe('genererIdSession (incident 2026-08-11 : contexte non sécurisé)', () => {
  const FORMAT_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('utilise crypto.randomUUID quand il existe (contexte sécurisé)', () => {
    const cryptoApi = { randomUUID: vi.fn().mockReturnValue('uuid-natif') };
    expect(genererIdSession(cryptoApi)).toBe('uuid-natif');
    expect(cryptoApi.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('sans randomUUID (http:// sur IP locale) : UUID v4 valide via getRandomValues', () => {
    const cryptoApi = {
      // randomUUID absent, comme sur Safari en contexte non sécurisé
      getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 11) % 256; return arr; },
    };
    const id = genererIdSession(cryptoApi);
    expect(id).toMatch(FORMAT_UUID_V4); // version 4 + variante RFC 4122 posées à la main
  });

  it('deux appels réels produisent deux ids distincts au bon format', () => {
    const sansNatif = { getRandomValues: (arr) => globalThis.crypto.getRandomValues(arr) };
    const a = genererIdSession(sansNatif);
    const b = genererIdSession(sansNatif);
    expect(a).toMatch(FORMAT_UUID_V4);
    expect(b).toMatch(FORMAT_UUID_V4);
    expect(a).not.toBe(b);
  });
});

describe('Lot 4 — filet Supabase', () => {
  const sessionSync = () => construireSessionCourses({
    id: 'sess-1',
    utilisateurId: 'u1',
    magasin: { magasin_id: 'm1', nom: 'E.Leclerc Blotzheim' },
    articles: [{ cle: 'a', etat: 'a_prendre' }],
    totalPrevu: 12.5,
    creeLeISO: '2026-08-11T10:00:00.000Z',
  });

  beforeEach(() => { vi.clearAllMocks(); });

  it('construireSessionCourses porte l’id fourni (null par défaut, sessions pré-Lot 4)', () => {
    expect(sessionSync().id).toBe('sess-1');
    expect(construireSessionCourses({ utilisateurId: 'u1', magasin: null, articles: [], totalPrevu: 0, creeLeISO: 'x' }).id).toBeNull();
  });

  it('ligneSupabaseDepuisSession : colonnes dénormalisées + document complet dans donnees', () => {
    const ligne = ligneSupabaseDepuisSession(sessionSync());
    expect(ligne).toMatchObject({
      id: 'sess-1', utilisateur_id: 'u1', magasin_id: 'm1', statut: 'active',
      cree_le: '2026-08-11T10:00:00.000Z', modifie_le: '2026-08-11T10:00:00.000Z', terminee_le: null,
    });
    expect(ligne.donnees.articles).toHaveLength(1); // le document entier, tel quel
    expect(ligneSupabaseDepuisSession({ ...sessionSync(), id: null })).toBeNull();
  });

  it('sauvegarderSessionSupabase : upsert idempotent sur id ; false sans id/compte ; throw sur erreur', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    supabase.from.mockReturnValue({ upsert });
    await expect(sauvegarderSessionSupabase(sessionSync())).resolves.toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('sessions_courses');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'sess-1' }), { onConflict: 'id' });

    await expect(sauvegarderSessionSupabase({ ...sessionSync(), id: null })).resolves.toBe(false);
    await expect(sauvegarderSessionSupabase(null)).resolves.toBe(false);

    upsert.mockResolvedValue({ error: new Error('reseau') });
    await expect(sauvegarderSessionSupabase(sessionSync())).rejects.toThrow('reseau');
  });

  it('abandonnerSessionsActivesSupabase : cible mes sessions actives, épargne saufId', async () => {
    const chaine = { eq: vi.fn(), neq: vi.fn(), error: null };
    chaine.eq.mockReturnValue(chaine);
    chaine.neq.mockReturnValue(chaine);
    const update = vi.fn().mockReturnValue(chaine);
    supabase.from.mockReturnValue({ update });

    await abandonnerSessionsActivesSupabase('u1', 'T1', { saufId: 'sess-2' });
    expect(update).toHaveBeenCalledWith({ statut: 'abandonnee', modifie_le: 'T1' });
    expect(chaine.eq).toHaveBeenCalledWith('utilisateur_id', 'u1');
    expect(chaine.eq).toHaveBeenCalledWith('statut', 'active');
    expect(chaine.neq).toHaveBeenCalledWith('id', 'sess-2');

    chaine.neq.mockClear();
    await abandonnerSessionsActivesSupabase('u1', 'T2');
    expect(chaine.neq).not.toHaveBeenCalled();

    await abandonnerSessionsActivesSupabase(null, 'T3'); // sans compte : aucun appel
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('chargerSessionActiveSupabase : renvoie le document donnees, null si aucune', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { donnees: { id: 'sess-9' } }, error: null });
    const chaine = { eq: vi.fn(), maybeSingle };
    chaine.eq.mockReturnValue(chaine);
    supabase.from.mockReturnValue({ select: vi.fn().mockReturnValue(chaine) });

    await expect(chargerSessionActiveSupabase('u1')).resolves.toEqual({ id: 'sess-9' });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(chargerSessionActiveSupabase('u1')).resolves.toBeNull();
    await expect(chargerSessionActiveSupabase(null)).resolves.toBeNull();
  });

  it('choisirSessionLaPlusRecente : modifie_le le plus récent gagne, la locale à égalité/date illisible', () => {
    const locale = { id: 'L', modifie_le: '2026-08-11T10:00:00.000Z' };
    const distante = { id: 'D', modifie_le: '2026-08-11T11:00:00.000Z' };
    expect(choisirSessionLaPlusRecente(locale, distante).id).toBe('D');
    expect(choisirSessionLaPlusRecente(distante, locale).id).toBe('D');
    expect(choisirSessionLaPlusRecente(locale, { ...distante, modifie_le: locale.modifie_le }).id).toBe('L');
    expect(choisirSessionLaPlusRecente(locale, { id: 'D', modifie_le: 'invalide' }).id).toBe('L');
    expect(choisirSessionLaPlusRecente(null, distante).id).toBe('D');
    expect(choisirSessionLaPlusRecente(locale, null).id).toBe('L');
    expect(choisirSessionLaPlusRecente(null, null)).toBeNull();
  });
});

describe('chargerRayonsProduits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aucune requête si la liste est vide', async () => {
    const rayons = await chargerRayonsProduits([]);
    expect(rayons.size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('résout la chaîne produit -> sous-catégorie -> catégorie, ignore une chaîne incomplète', async () => {
    const inMock = vi.fn().mockResolvedValue({
      data: [
        { id: 'p1', sous_categories: { nom: 'Chips & tuiles', categories: { nom: 'Épicerie salée', slug: 'epicerie-salee', ordre_affichage: 5 } } },
        { id: 'p2', sous_categories: null },
      ],
      error: null,
    });
    supabase.from.mockReturnValue({ select: vi.fn().mockReturnValue({ in: inMock }) });

    const rayons = await chargerRayonsProduits(['p1', 'p2', 'p1', null]);
    expect(supabase.from).toHaveBeenCalledWith('produits');
    expect(inMock).toHaveBeenCalledWith('id', ['p1', 'p2']); // dédoublonné, sans null
    expect(rayons.get('p1')).toEqual(RAYON_EPICERIE);
    expect(rayons.has('p2')).toBe(false); // repli RAYON_AUTRES à la charge de l'appelant
  });

  it('erreur Supabase -> throw (l’appelant décide du repli)', async () => {
    const inMock = vi.fn().mockResolvedValue({ data: null, error: new Error('boom') });
    supabase.from.mockReturnValue({ select: vi.fn().mockReturnValue({ in: inMock }) });
    await expect(chargerRayonsProduits(['p1'])).rejects.toThrow('boom');
  });
});
