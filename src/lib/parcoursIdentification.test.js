import { describe, it, expect, vi } from 'vitest';
import {
  creerParcoursIdentification, fileDepuis, doubleLectureRequise, AVERTISSEMENT_AUCUNE_INFO,
  PHASE_CAMERA, PHASE_VERIFICATION, PHASE_REFUS, PHASE_SUCCES, PHASE_FIN, PHRASE_ENGAGEMENT,
} from './parcoursIdentification';
import { SOURCE_BASE, SOURCE_OFF, SOURCE_AUCUNE, offPourCreation, ficheVerification, RECHERCHE_INCONNU } from './scanDepuisHistorique';

// Ticket Intermarché Aix du 08/11 : 3 lignes à identifier + 1 reconnue.
const RUMSTECK = { id: 'l-rum', libelle_ticket: 'V.BOVINE 1 X RUMSTEC', statut_validation_produit: 'non_valide', prix_unitaire: 9.9, numero_ligne: 2 };
const BANANE = { id: 'l-ban', libelle_ticket: 'BANANE VRAC', statut_validation_produit: 'non_valide', produit_suggere_ia_id: 'p-banane', prix_unitaire: 1.2, numero_ligne: 3 };
const CHOU = { id: 'l-chou', libelle_ticket: 'CHOU FLEUR PIECE', statut_validation_produit: 'non_valide', prix_unitaire: 2.79, numero_ligne: 4 };
const CAFE = { id: 'l-cafe', libelle_ticket: 'POT CAFE FORTE X44 C', statut_validation_produit: 'valide', produit_id: 'p-cafe', numero_ligne: 1 };
const TICKET = [CAFE, RUMSTECK, BANANE, CHOU];

const BIERE = { id: 'v-biere', produit_id: 'p-biere', actif: true, quantite_nette: 500, unite_quantite: 'ml', produits: { nom_reference: 'Bière' }, marques: { nom: '8.6' } };
const OFF_BIERE = { product_name: 'Beer', product_name_fr: 'Bière blonde', brands: '8.6', quantity: '500 ml', image_front_url: 'https://images.openfoodfacts.org/x/front.400.jpg' };

function deps(over = {}) {
  return {
    chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: false, variante: null }),
    chercherOff: vi.fn().mockResolvedValue({}),
    relier: vi.fn().mockResolvedValue({ data: null, error: null }),
    creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: true, produit_id: 'p', variante_produit_id: 'v', a_completer: false }, error: null }),
    annuler: vi.fn().mockResolvedValue({ data: { succes: true, prix_supprimes: 1 }, error: null }),
    ...over,
  };
}
const connu = () => ({ chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: BIERE }) });
const parcours = (d, opts = {}) => creerParcoursIdentification({
  lignes: TICKET, ligneDepartId: 'l-chou', deps: d, attendre: () => Promise.resolve(), journal: { info: vi.fn() }, ...opts,
});
const rienEcrit = (d) => {
  expect(d.relier).not.toHaveBeenCalled();
  expect(d.creerDepuisCode).not.toHaveBeenCalled();
};

describe('file des lignes', () => {
  it('part de la ligne choisie, puis boucle ; les lignes reconnues sont exclues', () => {
    expect(fileDepuis(TICKET, 'l-chou').map(l => l.id)).toEqual(['l-chou', 'l-rum', 'l-ban']);
    expect(fileDepuis(TICKET, 'l-rum').map(l => l.id)).toEqual(['l-rum', 'l-ban', 'l-chou']);
    expect(fileDepuis(TICKET, 'inconnue').map(l => l.id)).toEqual(['l-rum', 'l-ban', 'l-chou']);
  });
  it('phrase d\'engagement', () => {
    expect(PHRASE_ENGAGEMENT).toBe('Vérifie bien : chaque produit confirmé aide tout le monde à comparer juste.');
  });
});

describe('(1) AUCUNE écriture avant « ✓ C\'est bien ça »', () => {
  it('scan d\'un code connu (bière sur CHOU FLEUR) puis ✗ : aucune RPC d\'écriture, caméra rouverte sur la même ligne', async () => {
    const d = deps(connu());
    const p = parcours(d);
    expect(p.etat().phase).toBe(PHASE_CAMERA);
    expect(p.etat().ligne.id).toBe('l-chou');

    await p.codeLu('8712000900045');
    expect(p.etat().phase).toBe(PHASE_VERIFICATION);
    expect(p.etat().recherche.fiche).toMatchObject({ nom: 'Bière', marque: '8.6', format: '500 ml', source: SOURCE_BASE });
    rienEcrit(d); // la fiche s'affiche : toujours rien d'écrit

    p.refuser();
    expect(p.etat().phase).toBe(PHASE_CAMERA);
    expect(p.etat().ligne.id).toBe('l-chou');
    expect(p.etat().refus).toBe(1);
    rienEcrit(d);
  });

  it('le refus est tracé dans la console : [C119] refus — <ean> — <ligne>', async () => {
    const journal = { info: vi.fn() };
    const p = parcours(deps(connu()), { journal });
    await p.codeLu('8712000900045');
    p.refuser();
    expect(journal.info).toHaveBeenCalledWith('[C119] refus — 8712000900045 — CHOU FLEUR PIECE');
  });

  it('code inconnu (OFF) puis ✗ : rien d\'écrit non plus', async () => {
    const d = deps({ chercherOff: vi.fn().mockResolvedValue(OFF_BIERE) });
    const p = parcours(d);
    await p.codeLu('3017620422003');
    expect(p.etat().phase).toBe(PHASE_VERIFICATION);
    p.refuser();
    rienEcrit(d);
  });

  it('« Passer cette ligne » n\'écrit rien et passe à la suivante', async () => {
    const d = deps(connu());
    const p = parcours(d);
    await p.codeLu('8712000900045');
    p.passer();
    expect(p.etat().ligne.id).toBe('l-rum');
    expect(p.etat().passees).toBe(1);
    rienEcrit(d);
  });

  it('confirmer hors de l\'écran de vérification ne fait rien', async () => {
    const d = deps(connu());
    const p = parcours(d);
    await p.confirmer();
    rienEcrit(d);
  });
});

describe('(2) après ✓, la bonne RPC selon le cas', () => {
  it('code connu -> relier_variante_scan_code_barres(ligne, produit, variante, libelle_ticket)', async () => {
    const d = deps(connu());
    const p = parcours(d);
    await p.codeLu('8712000900045');
    await p.confirmer();
    expect(d.relier).toHaveBeenCalledWith({ ligneId: 'l-chou', produitId: 'p-biere', varianteId: 'v-biere', libelleAlias: 'CHOU FLEUR PIECE' });
    expect(d.creerDepuisCode).not.toHaveBeenCalled();
  });

  it('code inconnu, OFF répond -> creer_produit_depuis_code_barres avec le JSON OFF (nom français confirmé)', async () => {
    const d = deps({ chercherOff: vi.fn().mockResolvedValue(OFF_BIERE) });
    const p = parcours(d);
    await p.codeLu('3017620422003');
    expect(p.etat().recherche.fiche).toMatchObject({ nom: 'Bière blonde', marque: '8.6', format: '500 ml', source: SOURCE_OFF });
    await p.confirmer();
    expect(d.creerDepuisCode).toHaveBeenCalledWith({ ligneId: 'l-chou', code: '3017620422003', off: { ...OFF_BIERE, product_name: 'Bière blonde' } });
    expect(d.relier).not.toHaveBeenCalled();
  });

  it('code inconnu, OFF muet -> (après double lecture) creer_produit_depuis_code_barres avec {} ; fiche = texte de caisse, sans photo', async () => {
    const d = deps({ chercherOff: vi.fn().mockRejectedValue(new Error('offline')) });
    const p = parcours(d);
    await p.codeLu('3017620422003');
    expect(p.etat().recherche.fiche).toEqual({ nom: 'CHOU FLEUR PIECE', marque: null, format: null, photoOff: null, source: SOURCE_AUCUNE });
    p.rescannerPourConfirmer();
    await p.codeLu('3017620422003');
    await p.confirmer();
    expect(d.creerDepuisCode).toHaveBeenCalledWith({ ligneId: 'l-chou', code: '3017620422003', off: {} });
  });

  it('RPC absente -> « Indisponible pour le moment », retour sur la fiche, ligne non comptée', async () => {
    const d = deps({ ...connu(), relier: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) });
    const p = parcours(d);
    await p.codeLu('8712000900045');
    await p.confirmer();
    expect(p.etat().phase).toBe(PHASE_VERIFICATION);
    expect(p.etat().message).toMatch(/Indisponible pour le moment/);
    expect(p.etat().confirmes).toBe(0);
    expect(p.etat().ligne.id).toBe('l-chou');
  });
});

describe('(3) préfixe 2 -> refus sans écriture', () => {
  it('code boucherie sur le rumsteck : écran de refus, aucune lecture ni écriture', async () => {
    const d = deps();
    const p = creerParcoursIdentification({ lignes: TICKET, ligneDepartId: 'l-rum', deps: d, attendre: () => Promise.resolve() });
    await p.codeLu('2401234009905');
    expect(p.etat().phase).toBe(PHASE_REFUS);
    expect(p.etat().message).toMatch(/poids variable, non réutilisable/i);
    expect(d.chercherVarianteParCode).not.toHaveBeenCalled();
    rienEcrit(d);
    // « Scanner un autre code » : caméra rouverte sur la même ligne
    p.scannerAutre();
    expect(p.etat().phase).toBe(PHASE_CAMERA);
    expect(p.etat().ligne.id).toBe('l-rum');
  });

  it('produit archivé -> écran de refus, rien d\'écrit', async () => {
    const d = deps({ chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: { ...BIERE, actif: false } }) });
    const p = parcours(d);
    await p.codeLu('8712000900045');
    expect(p.etat().phase).toBe(PHASE_REFUS);
    expect(p.etat().message).toMatch(/archivé/i);
    rienEcrit(d);
  });
});

describe('(4) enchaînement automatique puis « Ticket complet »', () => {
  it('✓ -> ✓ animé -> ligne suivante, caméra rouverte ; après la dernière -> fin, complet', async () => {
    const d = deps(connu());
    const vus = [];
    const p = creerParcoursIdentification({
      lignes: TICKET, ligneDepartId: 'l-chou', deps: d, journal: { info: vi.fn() },
      attendre: () => { vus.push(p.etat().phase); return Promise.resolve(); },
    });
    for (const attendue of ['l-chou', 'l-rum', 'l-ban']) {
      expect(p.etat().phase).toBe(PHASE_CAMERA);
      expect(p.etat().ligne.id).toBe(attendue);
      await p.codeLu('8712000900045');
      await p.confirmer();
    }
    expect(vus).toEqual([PHASE_SUCCES, PHASE_SUCCES, PHASE_SUCCES]); // le ✓ animé passe à chaque fois
    expect(p.etat().phase).toBe(PHASE_FIN);
    expect(p.etat().complet).toBe(true);
    expect(p.etat().confirmes).toBe(3);
    expect(d.relier).toHaveBeenCalledTimes(3);
  });

  it('position « ligne N / total » suit l\'avancement', async () => {
    const p = parcours(deps(connu()));
    expect(p.position()).toEqual({ rang: 1, total: 3 });
    await p.codeLu('8712000900045');
    await p.confirmer();
    expect(p.position()).toEqual({ rang: 2, total: 3 });
  });

  it('une ligne passée reste en attente : fin, mais PAS « complet »', async () => {
    const p = parcours(deps(connu()));
    p.passer(); p.passer(); p.passer();
    expect(p.etat().phase).toBe(PHASE_FIN);
    expect(p.etat().complet).toBe(false);
    expect(p.etat().passees).toBe(3);
  });

  it('ticket sans ligne à identifier -> fin complet d\'emblée', () => {
    const p = creerParcoursIdentification({ lignes: [CAFE], deps: deps() });
    expect(p.etat().phase).toBe(PHASE_FIN);
    expect(p.etat().complet).toBe(true);
  });
});

describe('« ↩ Annuler » dans l\'en-tête', () => {
  it('après ✓ : annulable ; annuler -> annuler_scan_ligne_ticket, la ligne revient en tête, caméra rouverte dessus', async () => {
    const d = deps(connu());
    const p = parcours(d);
    await p.codeLu('8712000900045');
    await p.confirmer();
    expect(p.etat().annulable).toMatchObject({ ligneId: 'l-chou', libelle: 'Bière · 8.6 · 500 ml' });
    expect(p.etat().ligne.id).toBe('l-rum');
    const r = await p.annuler();
    expect(r.ok).toBe(true);
    expect(d.annuler).toHaveBeenCalledWith('l-chou');
    expect(p.etat().phase).toBe(PHASE_CAMERA);
    expect(p.etat().ligne.id).toBe('l-chou');
    expect(p.etat().ligne.statut_validation_produit).toBe('non_valide');
    expect(p.etat().confirmes).toBe(0);
    expect(p.etat().annulable).toBeNull();
  });

  it('annuler PENDANT le ✓ animé : l\'enchaînement ne saute pas la ligne annulée', async () => {
    const d = deps(connu());
    let relacher;
    const p = creerParcoursIdentification({ lignes: TICKET, ligneDepartId: 'l-chou', deps: d, attendre: () => new Promise(r => { relacher = r; }) });
    await p.codeLu('8712000900045');
    const confirmation = p.confirmer();
    await Promise.resolve(); await Promise.resolve();
    expect(p.etat().phase).toBe(PHASE_SUCCES);
    await p.annuler();
    relacher();
    await confirmation;
    expect(p.etat().ligne.id).toBe('l-chou');
    expect(p.etat().phase).toBe(PHASE_CAMERA);
  });

  it('refus de la base -> message, rien ne bouge', async () => {
    const d = deps({ ...connu(), annuler: vi.fn().mockResolvedValue({ data: { succes: false, message: 'Déjà annulé.' }, error: null }) });
    const p = parcours(d);
    await p.codeLu('8712000900045');
    await p.confirmer();
    await p.annuler();
    expect(p.etat().message).toBe('Déjà annulé.');
    expect(p.etat().ligne.id).toBe('l-rum');
    expect(p.etat().confirmes).toBe(1);
  });

  it('expiration des 8 s : le bouton disparaît, rien d\'autre', async () => {
    const p = parcours(deps(connu()));
    await p.codeLu('8712000900045');
    await p.confirmer();
    p.expirerAnnulation();
    expect(p.etat().annulable).toBeNull();
    expect(p.etat().confirmes).toBe(1);
  });
});

describe('fiche et JSON de création', () => {
  it('offPourCreation : {} reste {}, le nom français devient product_name', () => {
    expect(offPourCreation({})).toEqual({});
    expect(offPourCreation(null)).toEqual({});
    expect(offPourCreation({ product_name: 'Beer', product_name_fr: 'Bière' }).product_name).toBe('Bière');
    expect(offPourCreation({ brands: 'X' })).toEqual({ brands: 'X' });
  });
  it('format OFF depuis product_quantity + unité quand quantity manque', () => {
    expect(ficheVerification({ statut: RECHERCHE_INCONNU, off: { product_name: 'X', product_quantity: 330, product_quantity_unit: 'ml' } }).format).toBe('330 ml');
  });
});

// ── Correctif du 09/11 : double lecture quand personne ne connaît le code ──
// Cas réel : 11128663 lu sur V.BOVINE 1 X RUMSTEC (étiquette 2250328887977).
describe('cas « aucune info » : seconde lecture identique obligatoire avant de créer', () => {
  const OFF_MUET = { chercherOff: vi.fn().mockResolvedValue({}) };
  const rumsteck = (d, opts = {}) => creerParcoursIdentification({
    lignes: TICKET, ligneDepartId: 'l-rum', deps: d, attendre: () => Promise.resolve(), journal: { info: vi.fn() }, ...opts,
  });

  it('avertissement exact', () => {
    expect(AVERTISSEMENT_AUCUNE_INFO).toBe('Produit inconnu partout. Vérifie que le code affiché est bien celui imprimé sous les barres du produit.');
  });

  it('code partiel 11128663 (EAN-8) : fiche « aucune info », double lecture exigée', async () => {
    const p = rumsteck(deps(OFF_MUET));
    await p.codeLu('11128663');
    expect(p.etat().phase).toBe(PHASE_VERIFICATION);
    expect(p.etat().recherche.fiche.source).toBe(SOURCE_AUCUNE);
    expect(p.etat().doubleLecture).toEqual({ code: '11128663', relu: false });
    expect(doubleLectureRequise(p.etat().recherche)).toBe(true);
  });

  it('sans double lecture : « Créer quand même » n\'écrit RIEN, même appelé plusieurs fois', async () => {
    const d = deps(OFF_MUET);
    const p = rumsteck(d);
    await p.codeLu('11128663');
    await p.confirmer();
    await p.confirmer();
    expect(p.etat().phase).toBe(PHASE_VERIFICATION);
    rienEcrit(d);
  });

  it('deux lectures identiques -> creer_produit_depuis_code_barres avec p_off = {}', async () => {
    const d = deps(OFF_MUET);
    const journal = { info: vi.fn() };
    const p = rumsteck(d, { journal });
    await p.codeLu('11128663');
    p.rescannerPourConfirmer();
    expect(p.etat().phase).toBe(PHASE_CAMERA);
    expect(p.etat().ligne.id).toBe('l-rum');
    expect(p.etat().message).toBe('Relis le même code pour confirmer : 11128663');
    rienEcrit(d);
    await p.codeLu('11128663');
    expect(p.etat().phase).toBe(PHASE_VERIFICATION);
    expect(p.etat().doubleLecture).toEqual({ code: '11128663', relu: true });
    expect(d.chercherVarianteParCode).toHaveBeenCalledTimes(1); // pas de nouvelle recherche
    rienEcrit(d); // relu, mais toujours rien d'écrit tant qu'on ne confirme pas
    await p.confirmer();
    expect(d.creerDepuisCode).toHaveBeenCalledTimes(1);
    expect(d.creerDepuisCode).toHaveBeenCalledWith({ ligneId: 'l-rum', code: '11128663', off: {} });
    expect(journal.info).toHaveBeenCalledWith('[C119] double lecture — identique — 11128663 / 11128663');
  });

  it('lectures différentes -> aucune écriture, on repart sur la fiche du nouveau code', async () => {
    const d = deps(OFF_MUET);
    const p = rumsteck(d);
    await p.codeLu('11128663');
    p.rescannerPourConfirmer();
    await p.codeLu('3017620422003');
    expect(p.etat().phase).toBe(PHASE_VERIFICATION);
    expect(p.etat().recherche.code).toBe('3017620422003');
    expect(p.etat().doubleLecture).toEqual({ code: '3017620422003', relu: false }); // nouveau code, nouvelle double lecture
    await p.confirmer();
    rienEcrit(d);
  });

  it('la vraie étiquette relue (préfixe 2) -> refus poids variable, rien d\'écrit', async () => {
    const d = deps(OFF_MUET);
    const p = rumsteck(d);
    await p.codeLu('11128663');
    p.rescannerPourConfirmer();
    await p.codeLu('2250328887977');
    expect(p.etat().phase).toBe(PHASE_REFUS);
    rienEcrit(d);
  });

  it('« ✗ Ce n\'est pas ça » efface la relecture en cours', async () => {
    const d = deps(OFF_MUET);
    const p = rumsteck(d);
    await p.codeLu('11128663');
    p.refuser();
    expect(p.etat().doubleLecture).toBeNull();
    expect(p.etat().attenteRelecture).toBe(false);
    // re-scan du même code : nouvelle fiche, de nouveau non relue
    await p.codeLu('11128663');
    expect(p.etat().doubleLecture).toEqual({ code: '11128663', relu: false });
    await p.confirmer();
    rienEcrit(d);
  });

  it('cas « notre base » et « Open Food Facts » : pas de double lecture, ✓ écrit directement', async () => {
    const d1 = deps(connu());
    const p1 = parcours(d1);
    await p1.codeLu('8712000900045');
    expect(p1.etat().doubleLecture).toBeNull();
    await p1.confirmer();
    expect(d1.relier).toHaveBeenCalledTimes(1);

    const d2 = deps({ chercherOff: vi.fn().mockResolvedValue(OFF_BIERE) });
    const p2 = parcours(d2);
    await p2.codeLu('3017620422003');
    expect(p2.etat().doubleLecture).toBeNull();
    await p2.confirmer();
    expect(d2.creerDepuisCode).toHaveBeenCalledTimes(1);
  });
});

// ── « Pas de code-barres (vrac, boucherie…) » ──────────────────────────────
// Constat iPhone : après avoir passé le rumsteck, la pastille affichait encore
// « 3 produits à scanner » — banane, chou-fleur, rumsteck n'auront jamais de code.
import { estAIdentifier, compterAIdentifier, compterAIdentifierParTicket, ticketComplet, marquerSansCodeBarres, resumeDernierTicket } from './scanDepuisHistorique';

describe('lignes « sans code-barres » : hors de tous les compteurs', () => {
  const marquer = () => vi.fn().mockResolvedValue({ data: { succes: true, sans_code_barres: true }, error: null });

  it('une ligne marquée ne compte plus « à identifier » (pastille, compteur par ticket)', () => {
    const chou = { ...CHOU, ticket_id: 't1', sans_code_barres: true };
    expect(estAIdentifier(chou)).toBe(false);
    expect(compterAIdentifier([RUMSTECK, BANANE, chou])).toBe(2);
    expect(compterAIdentifierParTicket([{ ...RUMSTECK, ticket_id: 't1' }, chou]).get('t1')).toBe(1);
    // pastille de l'accueil : 0 restant -> éteinte
    expect(resumeDernierTicket({ id: 't1' }, compterAIdentifier([{ ...RUMSTECK, sans_code_barres: true }, chou]))).toBeNull();
  });

  it('ticket de 17 lignes reconnues + 3 sans code-barres = COMPLET', () => {
    const reconnues = Array.from({ length: 17 }, (_, i) => ({ id: `r${i}`, statut_validation_produit: 'valide' }));
    const vrac = [RUMSTECK, BANANE, CHOU].map(l => ({ ...l, sans_code_barres: true }));
    expect(compterAIdentifier([...reconnues, ...vrac])).toBe(0);
    expect(ticketComplet([...reconnues, ...vrac])).toBe(true);
    expect(ticketComplet([...reconnues, ...vrac.slice(1), RUMSTECK])).toBe(false);
    // et l'écran plein s'ouvre directement sur « Ticket complet »
    const p = creerParcoursIdentification({ lignes: [...reconnues, ...vrac], deps: deps() });
    expect(p.etat().phase).toBe(PHASE_FIN);
    expect(p.etat().complet).toBe(true);
  });

  it('marquer dans l\'écran plein : RPC appelée, la ligne sort de « LIGNE n / N », enchaînement', async () => {
    const d = deps({ marquer: marquer() });
    const p = parcours(d);
    expect(p.position()).toEqual({ rang: 1, total: 3 });
    await p.sansCodeBarres();
    expect(d.marquer).toHaveBeenCalledWith('l-chou', true);
    expect(p.etat().ligne.id).toBe('l-rum');
    expect(p.position()).toEqual({ rang: 1, total: 2 });
    expect(p.etat().sansCode).toBe(1);
    rienEcrit(d);
  });

  it('les trois lignes vrac marquées -> « Ticket complet »', async () => {
    const d = deps({ marquer: marquer() });
    const p = parcours(d);
    await p.sansCodeBarres(); await p.sansCodeBarres(); await p.sansCodeBarres();
    expect(p.etat().phase).toBe(PHASE_FIN);
    expect(p.etat().complet).toBe(true);
    expect(p.etat().sansCode).toBe(3);
  });

  it('mélange : 1 confirmée + 2 sans code -> complet ; « LIGNE n / N » suit', async () => {
    const d = deps({ ...connu(), marquer: marquer() });
    const p = parcours(d);
    await p.codeLu('8712000900045');
    await p.confirmer();
    expect(p.position()).toEqual({ rang: 2, total: 3 });
    await p.sansCodeBarres();
    expect(p.position()).toEqual({ rang: 2, total: 2 });
    await p.sansCodeBarres();
    expect(p.etat().phase).toBe(PHASE_FIN);
    expect(p.etat().complet).toBe(true);
  });

  it('marquage depuis l\'écran de refus (poids variable du rumsteck)', async () => {
    const d = deps({ marquer: marquer() });
    const p = creerParcoursIdentification({ lignes: TICKET, ligneDepartId: 'l-rum', deps: d, attendre: () => Promise.resolve() });
    await p.codeLu('2250328887977');
    expect(p.etat().phase).toBe(PHASE_REFUS);
    await p.sansCodeBarres();
    expect(d.marquer).toHaveBeenCalledWith('l-rum', true);
    expect(p.etat().ligne.id).toBe('l-ban');
  });

  it('RPC en échec -> on enchaîne quand même, SANS marquer : message, ticket pas complet', async () => {
    const d = deps({ marquer: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) });
    const p = parcours(d);
    await p.sansCodeBarres();
    expect(p.etat().ligne.id).toBe('l-rum');
    expect(p.etat().sansCode).toBe(0);
    expect(p.etat().passees).toBe(1);
    expect(p.etat().message).toMatch(/non marquée/);
    expect(p.position()).toEqual({ rang: 2, total: 3 }); // elle compte toujours
    await p.sansCodeBarres(); await p.sansCodeBarres();
    expect(p.etat().phase).toBe(PHASE_FIN);
    expect(p.etat().complet).toBe(false);
  });

  it('refus de la base (ligne déjà rattachée) -> traité comme un échec', async () => {
    const r = await marquerSansCodeBarres({ ligneId: 'x', deps: { marquer: vi.fn().mockResolvedValue({ data: { succes: false, message: 'Ligne déjà rattachée à un produit.' }, error: null }) } });
    expect(r).toEqual({ ok: false, message: 'Ligne déjà rattachée à un produit.' });
  });

  it('LA CROIX ne modifie aucun état et n\'appelle rien', async () => {
    const d = deps({ ...connu(), marquer: marquer() });
    const p = parcours(d);
    await p.codeLu('8712000900045');
    const avant = p.etat();
    const bilan = p.fermer();
    expect(bilan).toEqual({ confirmes: 0, sansCode: 0, passees: 0 });
    expect(p.etat()).toBe(avant); // même objet : rien n'a bougé
    expect(d.marquer).not.toHaveBeenCalled();
    expect(d.annuler).not.toHaveBeenCalled();
    rienEcrit(d);
  });

  it('« Finalement j\'ai un code » : marquer(false), la ligne revient dans les compteurs et dans la file', async () => {
    const d = { marquer: vi.fn().mockResolvedValue({ data: { succes: true, sans_code_barres: false }, error: null }) };
    const chou = { ...CHOU, sans_code_barres: true };
    expect(compterAIdentifier([chou])).toBe(0);
    const r = await marquerSansCodeBarres({ ligneId: 'l-chou', valeur: false, deps: d });
    expect(d.marquer).toHaveBeenCalledWith('l-chou', false);
    expect(r.ok).toBe(true);
    const relue = { ...chou, sans_code_barres: r.sansCodeBarres }; // relecture de la base
    expect(compterAIdentifier([relue])).toBe(1);
    expect(fileDepuis([relue], 'l-chou').map(l => l.id)).toEqual(['l-chou']);
  });

  it('une ligne déjà marquée n\'entre pas dans la file de l\'écran plein', () => {
    expect(fileDepuis([RUMSTECK, { ...BANANE, sans_code_barres: true }, CHOU], 'l-rum').map(l => l.id)).toEqual(['l-rum', 'l-chou']);
  });
});
