import { describe, it, expect, vi } from 'vitest';
import {
  etatLigne, ETAT_RECONNU, ETAT_SUGGERE, ETAT_INCONNU,
  compterAIdentifier, compterAIdentifierParTicket, trierLignesTicket, ligneSuivanteAIdentifier,
  titreLigneInconnue, pisteLigneInconnue, formatVariante, prixArticle,
  estCodePoidsVariable, candidatsCode, codePourCreation,
  extraireOff, chercherOffPourCreation, estFonctionAbsente,
  traiterScanLigne, libelleProduitCree, badgeDepuisMethode,
  SCAN_RECONNU, SCAN_CREE, SCAN_POIDS_VARIABLE, SCAN_ARCHIVE, SCAN_INDISPONIBLE, SCAN_ERREUR,
  SCAN_CODE_VIDE, SCAN_DEJA_RECONNUE, MESSAGE_INDISPONIBLE,
  estProduitACompleter, SOUS_CATEGORIE_A_RECLASSER_ID,
} from './scanDepuisHistorique';

// Les 4 lignes à identifier du ticket Intermarché Aix du 08/11 (f10c8964…),
// plus une ligne reconnue.
const CAFE = { id: 'l-cafe', ticket_id: 't1', libelle_ticket: 'POT CAFE FORTE X44 C', libelle_brut: 'Café capsules', statut_validation_produit: 'non_valide', prix_unitaire: 8.52, quantite: 1, numero_ligne: 1 };
const RUMSTECK = { id: 'l-rum', ticket_id: 't1', libelle_ticket: 'V.BOVINE 1 X RUMSTEC', libelle_brut: 'Rumsteck', statut_validation_produit: 'non_valide', prix_unitaire: 9.9, numero_ligne: 2 };
const BANANE = { id: 'l-ban', ticket_id: 't1', libelle_ticket: 'BANANE VRAC', libelle_brut: 'Banane', statut_validation_produit: 'non_valide', produit_suggere_ia_id: 'p-banane', numero_ligne: 3 };
const CHOU = { id: 'l-chou', ticket_id: 't1', libelle_ticket: 'CHOU FLEUR PIECE', libelle_brut: 'Chou-fleur', statut_validation_produit: 'rejete', numero_ligne: 4 };
const LAIT = { id: 'l-lait', ticket_id: 't1', libelle_ticket: 'LAIT 1/2 ECR', statut_validation_produit: 'valide', produit_id: 'p-lait', produit_suggere_ia_id: 'p-autre', numero_ligne: 0 };

describe('etatLigne — trois états', () => {
  it('validée -> reconnu, même avec une ancienne suggestion IA', () => {
    expect(etatLigne(LAIT)).toBe(ETAT_RECONNU);
  });
  it('suggestion IA sans validation -> suggéré', () => {
    expect(etatLigne(BANANE)).toBe(ETAT_SUGGERE);
  });
  it('ni validée ni suggérée -> inconnu (y compris rejetée)', () => {
    expect(etatLigne(CAFE)).toBe(ETAT_INCONNU);
    expect(etatLigne(CHOU)).toBe(ETAT_INCONNU);
  });
  it('un produit_id posé sans validation NE suffit PAS à être reconnu', () => {
    expect(etatLigne({ produit_id: 'p', statut_validation_produit: 'non_valide' })).toBe(ETAT_INCONNU);
  });
  it('robuste : null / objet vide -> inconnu, jamais d\'exception', () => {
    expect(etatLigne(null)).toBe(ETAT_INCONNU);
    expect(etatLigne({})).toBe(ETAT_INCONNU);
  });
});

describe('compteurs « à identifier »', () => {
  it('ticket Intermarché Aix : 4 à identifier sur 5 lignes', () => {
    expect(compterAIdentifier([CAFE, RUMSTECK, BANANE, CHOU, LAIT])).toBe(4);
  });
  it('par ticket', () => {
    const m = compterAIdentifierParTicket([CAFE, LAIT, { ...BANANE, ticket_id: 't2' }]);
    expect(m.get('t1')).toBe(1);
    expect(m.get('t2')).toBe(1);
  });
});

describe('ordre d\'affichage', () => {
  it('à identifier en haut, reconnues en bas, ordre du ticket conservé', () => {
    const tri = trierLignesTicket([LAIT, CHOU, CAFE, BANANE, RUMSTECK]);
    expect(tri.map(l => l.id)).toEqual(['l-cafe', 'l-rum', 'l-ban', 'l-chou', 'l-lait']);
  });
  it('ne modifie pas le tableau reçu', () => {
    const entree = [LAIT, CAFE];
    trierLignesTicket(entree);
    expect(entree[0]).toBe(LAIT);
  });
  it('ligne suivante en évidence après traitement', () => {
    const tri = trierLignesTicket([CAFE, RUMSTECK, BANANE, LAIT]);
    // Le café vient d'être reconnu : relu en base, il est passé en bas.
    const apres = trierLignesTicket([{ ...CAFE, statut_validation_produit: 'valide' }, RUMSTECK, BANANE, LAIT]);
    expect(ligneSuivanteAIdentifier(tri, 'l-cafe')).toBe('l-rum');
    expect(ligneSuivanteAIdentifier(apres, 'l-cafe')).toBe('l-rum');
    expect(ligneSuivanteAIdentifier([LAIT], 'l-lait')).toBeNull();
  });
});

describe('affichage d\'une ligne inconnue — le texte de caisse fait foi', () => {
  it('titre = libelle_ticket, jamais libelle_brut', () => {
    const carres = { libelle_ticket: 'CARRES DEMAQ X70', libelle_brut: 'Carottes' };
    expect(titreLigneInconnue(carres)).toBe('CARRES DEMAQ X70');
    expect(pisteLigneInconnue(carres)).toBe('Carottes');
  });
  it('repli sur libelle_brut seulement si le texte de caisse manque', () => {
    expect(titreLigneInconnue({ libelle_brut: 'Pain' })).toBe('Pain');
    expect(pisteLigneInconnue({ libelle_brut: 'Pain' })).toBeNull();
  });
  it('pas de piste quand elle répète le titre', () => {
    expect(pisteLigneInconnue({ libelle_ticket: 'PAIN', libelle_brut: 'pain' })).toBeNull();
  });
  it('format et prix d\'un article', () => {
    expect(formatVariante({ quantite_nette: 44, unite_quantite: 'capsules' })).toBe('44 capsules');
    expect(formatVariante({ quantite_nette: 33, unite_quantite: 'cl', nombre_unites: 6 })).toBe('6 × 33 cl');
    expect(formatVariante({ libelle: '250g' })).toBe('250g');
    expect(prixArticle(CAFE)).toBe(8.52);
    expect(prixArticle({ prix_unitaire: 0 })).toBeNull();
  });
});

describe('codes poids variable (préfixe 2)', () => {
  it('refusés', () => {
    expect(estCodePoidsVariable('2401234012345')).toBe(true);
    expect(estCodePoidsVariable(' 2 401234 012345 ')).toBe(true);
    expect(estCodePoidsVariable('21234567')).toBe(true);
  });
  it('codes produits ordinaires acceptés', () => {
    expect(estCodePoidsVariable('3250392881917')).toBe(false);
    expect(estCodePoidsVariable('0123456789012')).toBe(false);
    expect(estCodePoidsVariable('')).toBe(false);
  });
});

describe('rattrapage UPC-A / EAN-13', () => {
  it('candidats et forme de création', () => {
    expect(candidatsCode('012345678905')).toEqual(['012345678905', '0012345678905']);
    expect(candidatsCode('0012345678905')).toEqual(['0012345678905', '012345678905']);
    expect(candidatsCode('3250392881917')).toEqual(['3250392881917']);
    expect(codePourCreation('012345678905')).toBe('0012345678905');
  });
});

describe('Open Food Facts', () => {
  it('extraireOff ne garde que les champs demandés, non vides', () => {
    const off = extraireOff({ status: 1, product: { product_name: ' Café ', brands: '', quantity: '44 capsules', autre: 'x', product_quantity: 220 } });
    expect(off).toEqual({ product_name: 'Café', quantity: '44 capsules', product_quantity: 220 });
    expect(extraireOff({ status: 0 })).toEqual({});
    expect(extraireOff(null)).toEqual({});
  });
  it('hors ligne -> {} sans exception', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(chercherOffPourCreation('3250392881917', { fetchImpl })).resolves.toEqual({});
  });
  it('réponse HTTP en erreur -> {}', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    await expect(chercherOffPourCreation('3250392881917', { fetchImpl })).resolves.toEqual({});
  });
  it('trop lent -> abandon au délai, {}', async () => {
    const fetchImpl = vi.fn((url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abort')))));
    await expect(chercherOffPourCreation('3250392881917', { fetchImpl, delaiMax: 20 })).resolves.toEqual({});
  });
  it('demande exactement les champs du contrat', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 1, product: { product_name: 'X' } }) });
    await chercherOffPourCreation('3250392881917', { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://world.openfoodfacts.org/api/v2/product/3250392881917.json?fields=product_name,brands,quantity,product_quantity,product_quantity_unit,image_front_small_url');
  });
});

describe('estFonctionAbsente', () => {
  it('reconnaît une RPC pas encore créée', () => {
    expect(estFonctionAbsente({ code: 'PGRST202', message: '' })).toBe(true);
    expect(estFonctionAbsente({ message: 'Could not find the function public.x in the schema cache' })).toBe(true);
    expect(estFonctionAbsente({ message: 'permission denied' })).toBe(false);
    expect(estFonctionAbsente(null)).toBe(false);
  });
});

// ── Orchestration ──────────────────────────────────────────────────────────
const VARIANTE_CAFE = { id: 'v-cafe', produit_id: 'p-cafe', actif: true, quantite_nette: 44, unite_quantite: 'capsules', produits: { nom_reference: 'Café en capsules' }, marques: { nom: 'Planteur des Tropiques' } };

function deps(overrides = {}) {
  return {
    chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: false, variante: null }),
    relier: vi.fn().mockResolvedValue({ data: null, error: null }),
    chercherOff: vi.fn().mockResolvedValue({}),
    creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: true, produit_id: 'p', variante_produit_id: 'v', a_completer: false }, error: null }),
    ...overrides,
  };
}

const rienEcrit = (d) => {
  expect(d.relier).not.toHaveBeenCalled();
  expect(d.creerDepuisCode).not.toHaveBeenCalled();
};

describe('traiterScanLigne', () => {
  it('EAN connu (café 3250392881917) -> relier avec libelle_ticket comme alias, jamais libelle_brut', async () => {
    const d = deps({ chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: VARIANTE_CAFE }) });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3250392881917', deps: d });
    expect(r.statut).toBe(SCAN_RECONNU);
    expect(r.ecrit).toBe(true);
    expect(d.chercherVarianteParCode).toHaveBeenCalledWith(['3250392881917']);
    expect(d.relier).toHaveBeenCalledWith({ ligneId: 'l-cafe', produitId: 'p-cafe', varianteId: 'v-cafe', libelleAlias: 'POT CAFE FORTE X44 C' });
    expect(d.creerDepuisCode).not.toHaveBeenCalled();
    expect(d.chercherOff).not.toHaveBeenCalled();
    expect(libelleProduitCree({ variante: r.variante, ligne: CAFE })).toBe('Café en capsules · Planteur des Tropiques · 44 capsules');
  });

  it('code du rumsteck (préfixe 2) -> refus « poids variable », AUCUNE lecture ni écriture', async () => {
    const d = deps();
    const r = await traiterScanLigne({ ligne: RUMSTECK, codeBrut: '2401234009905', deps: d });
    expect(r.statut).toBe(SCAN_POIDS_VARIABLE);
    expect(r.message).toMatch(/poids variable, non réutilisable/i);
    expect(r.ecrit).toBe(false);
    expect(d.chercherVarianteParCode).not.toHaveBeenCalled();
    expect(d.chercherOff).not.toHaveBeenCalled();
    rienEcrit(d);
  });

  it('poids variable même si la base connaît ce code (appris par erreur ailleurs)', async () => {
    const d = deps({ chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: VARIANTE_CAFE }) });
    const r = await traiterScanLigne({ ligne: RUMSTECK, codeBrut: '2000000000008', deps: d });
    expect(r.statut).toBe(SCAN_POIDS_VARIABLE);
    rienEcrit(d);
  });

  it('EAN connu mais variante désactivée -> « produit archivé », rien écrit', async () => {
    const d = deps({ chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: { ...VARIANTE_CAFE, actif: false } }) });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3250392881917', deps: d });
    expect(r.statut).toBe(SCAN_ARCHIVE);
    expect(r.message).toMatch(/archivé/i);
    rienEcrit(d);
  });

  it('EAN connu mais variante illisible -> archivé, et surtout PAS de création en double', async () => {
    const d = deps({ chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: null }) });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3250392881917', deps: d });
    expect(r.statut).toBe(SCAN_ARCHIVE);
    rienEcrit(d);
  });

  it('EAN inconnu -> OFF puis création avec le JSON OFF', async () => {
    const off = { product_name: 'Lessive', brands: 'X', quantity: '2 L' };
    const d = deps({ chercherOff: vi.fn().mockResolvedValue(off) });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3017620422003', deps: d });
    expect(r.statut).toBe(SCAN_CREE);
    expect(d.creerDepuisCode).toHaveBeenCalledWith({ ligneId: 'l-cafe', code: '3017620422003', off });
    expect(r.aCompleter).toBe(false);
  });

  it('OFF hors ligne -> création quand même avec {} et a_completer', async () => {
    const d = deps({
      chercherOff: vi.fn().mockRejectedValue(new Error('offline')),
      creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: true, produit_id: 'p', variante_produit_id: 'v', a_completer: true }, error: null }),
    });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3017620422003', deps: d });
    expect(d.creerDepuisCode).toHaveBeenCalledWith({ ligneId: 'l-cafe', code: '3017620422003', off: {} });
    expect(r.statut).toBe(SCAN_CREE);
    expect(r.aCompleter).toBe(true);
  });

  it('UPC-A lu -> création envoyée en EAN-13', async () => {
    const d = deps();
    await traiterScanLigne({ ligne: CAFE, codeBrut: '012345678905', deps: d });
    expect(d.chercherOff).toHaveBeenCalledWith('0012345678905');
    expect(d.creerDepuisCode.mock.calls[0][0].code).toBe('0012345678905');
  });

  it('la base refuse en poids variable -> refus, pas de succès affiché', async () => {
    const d = deps({ creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: false, poids_variable: true }, error: null }) });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3017620422003', deps: d });
    expect(r.statut).toBe(SCAN_POIDS_VARIABLE);
    expect(r.ecrit).toBe(false);
  });

  it('deja_connu côté base -> présenté comme reconnu', async () => {
    const d = deps({ creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: true, deja_connu: true, produit_id: 'p', variante_produit_id: 'v' }, error: null }) });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3017620422003', deps: d });
    expect(r.statut).toBe(SCAN_RECONNU);
  });

  it('succes:false sans motif -> erreur, message de la base relayé quand il existe', async () => {
    const d = deps({ creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: false, message: 'Ligne déjà rattachée' }, error: null }) });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3017620422003', deps: d });
    expect(r.statut).toBe(SCAN_ERREUR);
    expect(r.message).toBe('Ligne déjà rattachée');
  });

  it('RPC de création absente -> « indisponible pour le moment », sans exception', async () => {
    const d = deps({ creerDepuisCode: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3017620422003', deps: d });
    expect(r.statut).toBe(SCAN_INDISPONIBLE);
    expect(r.message).toBe(MESSAGE_INDISPONIBLE);
  });

  it('relier en échec ou refusé -> erreur, pas de succès', async () => {
    const connu = vi.fn().mockResolvedValue({ connu: true, variante: VARIANTE_CAFE });
    const r1 = await traiterScanLigne({ ligne: CAFE, codeBrut: '3250392881917', deps: deps({ chercherVarianteParCode: connu, relier: vi.fn().mockResolvedValue({ error: { message: 'boom' } }) }) });
    expect(r1.statut).toBe(SCAN_ERREUR);
    const r2 = await traiterScanLigne({ ligne: CAFE, codeBrut: '3250392881917', deps: deps({ chercherVarianteParCode: connu, relier: vi.fn().mockResolvedValue({ data: { succes: false }, error: null }) }) });
    expect(r2.statut).toBe(SCAN_ERREUR);
    const r3 = await traiterScanLigne({ ligne: CAFE, codeBrut: '3250392881917', deps: deps({ chercherVarianteParCode: connu, relier: vi.fn().mockRejectedValue(new Error('réseau')) }) });
    expect(r3.statut).toBe(SCAN_ERREUR);
  });

  it('lecture du code impossible (réseau) -> erreur, rien écrit, pas de création', async () => {
    const d = deps({ chercherVarianteParCode: vi.fn().mockResolvedValue({ error: { message: 'offline' } }) });
    const r = await traiterScanLigne({ ligne: CAFE, codeBrut: '3250392881917', deps: d });
    expect(r.statut).toBe(SCAN_ERREUR);
    rienEcrit(d);
  });

  it('code vide ou ligne déjà reconnue -> rien du tout', async () => {
    const d = deps();
    expect((await traiterScanLigne({ ligne: CAFE, codeBrut: '  ', deps: d })).statut).toBe(SCAN_CODE_VIDE);
    expect((await traiterScanLigne({ ligne: LAIT, codeBrut: '3250392881917', deps: d })).statut).toBe(SCAN_DEJA_RECONNUE);
    expect(d.chercherVarianteParCode).not.toHaveBeenCalled();
    rienEcrit(d);
  });

  it('libelle_ticket absent -> alias null, jamais libelle_brut', async () => {
    const d = deps({ chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: VARIANTE_CAFE }) });
    await traiterScanLigne({ ligne: { id: 'x', libelle_brut: 'Carottes', statut_validation_produit: 'non_valide' }, codeBrut: '3250392881917', deps: d });
    expect(d.relier.mock.calls[0][0].libelleAlias).toBeNull();
  });
});

describe('libelleProduitCree', () => {
  it('replis OFF puis texte de caisse', () => {
    expect(libelleProduitCree({ off: { product_name: 'Lessive', brands: 'X', quantity: '2 L' } })).toBe('Lessive · X · 2 L');
    expect(libelleProduitCree({ off: {}, ligne: CAFE })).toBe('POT CAFE FORTE X44 C');
  });
});

describe('badgeDepuisMethode — une suggestion n\'est JAMAIS « reconnu »', () => {
  it('trois états', () => {
    expect(badgeDepuisMethode('memoire_exacte')).toBe('reconnu');
    expect(badgeDepuisMethode('suggestion')).toBe('suggere');
    expect(badgeDepuisMethode(null)).toBe('a_verifier');
    expect(badgeDepuisMethode(undefined)).toBe('a_verifier');
    expect(badgeDepuisMethode('alias')).toBe('a_verifier');
  });
});

describe('estProduitACompleter — code scan ET (quantité non fiable OU « À reclasser »)', () => {
  const AUTRE_SC = '11111111-1111-1111-1111-111111111111';
  it('l\'id de « À reclasser (import Drive) » est bien celui donné', () => {
    expect(SOUS_CATEGORIE_A_RECLASSER_ID).toBe('cba4251f-28b5-4f0d-bfb6-70af5c802205');
  });
  it('code scan + quantité non fiable -> à compléter', () => {
    expect(estProduitACompleter({ quantite_fiable: false, produits: { sous_categorie_id: AUTRE_SC } }, 'scan')).toBe(true);
  });
  it('code scan + fiche « À reclasser », même avec une quantité fiable -> à compléter', () => {
    expect(estProduitACompleter({ quantite_fiable: true, produits: { sous_categorie_id: SOUS_CATEGORIE_A_RECLASSER_ID } }, 'scan')).toBe(true);
  });
  it('code scan, fiche complète et bien rangée -> non', () => {
    expect(estProduitACompleter({ quantite_fiable: true, produits: { sous_categorie_id: AUTRE_SC } }, 'scan')).toBe(false);
    expect(estProduitACompleter({ quantite_fiable: null, produits: { sous_categorie_id: AUTRE_SC } }, 'scan')).toBe(false);
  });
  it('code d\'une autre source -> jamais, même incomplet', () => {
    expect(estProduitACompleter({ quantite_fiable: false, produits: { sous_categorie_id: SOUS_CATEGORIE_A_RECLASSER_ID } }, 'import')).toBe(false);
    expect(estProduitACompleter({ quantite_fiable: false }, null)).toBe(false);
  });
  it('variante absente -> non, sans exception', () => {
    expect(estProduitACompleter(null, 'scan')).toBe(false);
  });
});

// ── Filet « ↩ Annuler » ────────────────────────────────────────────────────
import { annulerScanLigne, ligneApresAnnulation, appliquerAnnulation, resumeAnnulation, DUREE_ANNULATION_MS } from './scanDepuisHistorique';

describe('annulation d\'un scan', () => {
  // Le café vient d'être rattaché par scan.
  const CAFE_SCANNE = { ...CAFE, statut_validation_produit: 'valide', methode_validation_produit: 'scan_code_barres', produit_id: 'p-cafe', variante_produit_id: 'v-cafe' };
  const TICKET = trierLignesTicket([CAFE_SCANNE, RUMSTECK, BANANE, CHOU, LAIT]);
  const BILAN = { succes: true, prix_supprimes: 1, alias_supprimes: 1, memoires_supprimees: 1, codes_supprimes: 0, variante_supprimee: false, fiche_supprimee: false };

  it('durée de la fenêtre : 8 s', () => {
    expect(DUREE_ANNULATION_MS).toBe(8000);
  });

  it('succès : la ligne revient en « inconnu » (non_valide) et le compteur remonte de 3 à 4', async () => {
    const annuler = vi.fn().mockResolvedValue({ data: BILAN, error: null });
    const r = await annulerScanLigne({ ligneId: 'l-cafe', deps: { annuler } });
    expect(annuler).toHaveBeenCalledWith('l-cafe');
    expect(r.ok).toBe(true);
    expect(compterAIdentifier(TICKET)).toBe(3);
    const apres = appliquerAnnulation(TICKET, 'l-cafe');
    const cafe = apres.find(l => l.id === 'l-cafe');
    expect(cafe.statut_validation_produit).toBe('non_valide');
    expect(cafe.produit_id).toBeNull();
    expect(cafe.variante_produit_id).toBeNull();
    expect(etatLigne(cafe)).toBe(ETAT_INCONNU);
    expect(compterAIdentifier(apres)).toBe(4);
    // remontée parmi les « à identifier », à sa place dans le ticket
    expect(apres[0].id).toBe('l-cafe');
    expect(resumeAnnulation(r.bilan)).toBe('Défait : 1 prix, 1 alias, 1 mémoire de caisse.');
  });

  it('ne touche qu\'à la ligne annulée et ne modifie pas la liste reçue', () => {
    const apres = appliquerAnnulation(TICKET, 'l-cafe');
    expect(apres.find(l => l.id === 'l-lait').statut_validation_produit).toBe('valide');
    expect(TICKET.find(l => l.id === 'l-cafe').statut_validation_produit).toBe('valide');
  });

  it('une suggestion IA d\'avant le scan est conservée', () => {
    const l = ligneApresAnnulation({ id: 'x', statut_validation_produit: 'valide', produit_suggere_ia_id: 'p-s', produit_id: 'p' });
    expect(l.produit_suggere_ia_id).toBe('p-s');
    expect(etatLigne(l)).toBe(ETAT_SUGGERE);
  });

  it('seconde annulation : succes=false -> message de la base, rien n\'est appliqué', async () => {
    const annuler = vi.fn().mockResolvedValue({ data: { succes: false, message: 'Ce scan a déjà été annulé.' }, error: null });
    const r = await annulerScanLigne({ ligneId: 'l-cafe', deps: { annuler } });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Ce scan a déjà été annulé.');
  });

  it('succes absent ou réponse vide -> pas un succès', async () => {
    for (const data of [null, {}, { succes: 'oui' }]) {
      const r = await annulerScanLigne({ ligneId: 'l-cafe', deps: { annuler: vi.fn().mockResolvedValue({ data, error: null }) } });
      expect(r.ok).toBe(false);
    }
  });

  it('RPC absente -> « indisponible pour le moment » ; réseau KO -> message court ; jamais d\'exception', async () => {
    const absente = await annulerScanLigne({ ligneId: 'l-cafe', deps: { annuler: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
    expect(absente).toEqual({ ok: false, message: MESSAGE_INDISPONIBLE });
    const reseau = await annulerScanLigne({ ligneId: 'l-cafe', deps: { annuler: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) } });
    expect(reseau.ok).toBe(false);
    expect(reseau.message).toMatch(/réessaie/);
  });

  it('résumé quand la fiche créée a été désactivée', () => {
    expect(resumeAnnulation({ prix_supprimes: 1, codes_supprimes: 1, fiche_supprimee: true })).toBe('Défait : 1 prix, 1 code-barres, fiche créée désactivée.');
    expect(resumeAnnulation({})).toBeNull();
  });
});

// ── Pastille de l'accueil : dernier ticket seulement ───────────────────────
import { resumeDernierTicket } from './scanDepuisHistorique';

describe('resumeDernierTicket — l\'accueil ne parle que du dernier ticket', () => {
  const T = { id: 'f10c8964', date_ticket: '2026-11-08', magasins: { nom: 'Intermarché' } };
  it('3 lignes à identifier -> « 3 produits à scanner », magasin et date du ticket', () => {
    const r = resumeDernierTicket(T, 3);
    expect(r.ticketId).toBe('f10c8964');
    expect(r.titre).toBe('3 produits à scanner');
    expect(r.sousTitre).toMatch(/^Dernier ticket : Intermarché · /);
    expect(r.sousTitre).toMatch(/8 nov/);
  });
  it('singulier', () => {
    expect(resumeDernierTicket(T, 1).titre).toBe('1 produit à scanner');
  });
  it('rien à scanner, ticket absent ou compte inconnu -> null (pastille masquée)', () => {
    expect(resumeDernierTicket(T, 0)).toBeNull();
    expect(resumeDernierTicket(null, 4)).toBeNull();
    expect(resumeDernierTicket(T, null)).toBeNull();
    expect(resumeDernierTicket(T, NaN)).toBeNull();
  });
  it('magasin ou date manquants -> libellé quand même, sans « undefined »', () => {
    const r = resumeDernierTicket({ id: 'x' }, 2);
    expect(r.sousTitre).toBe('Dernier ticket : ton magasin');
  });
});

// ── Correctif du 09/11 : « ↩ Annuler » après TOUT scan réussi ──────────────
// Cas réel : bière 8.6 500 ml (code DÉJÀ connu) scannée sur CHOU FLEUR PIECE —
// bandeau vert, prix 2,79 € écrit, aucun bouton Annuler.
import { issueScan, CHEMIN_CODE_CONNU, CHEMIN_DEJA_CONNU, CHEMIN_CREE_OFF, CHEMIN_CREE_A_COMPLETER } from './scanDepuisHistorique';

describe('issueScan — la fenêtre d\'annulation s\'ouvre sur chaque chemin de scan', () => {
  const CHOU_FLEUR = { id: 'l-chou', libelle_ticket: 'CHOU FLEUR PIECE', statut_validation_produit: 'non_valide', prix_unitaire: 2.79 };
  const BIERE = { id: 'v-biere', produit_id: 'p-biere', actif: true, quantite_nette: 500, unite_quantite: 'ml', produits: { nom_reference: 'Bière' }, marques: { nom: '8.6' } };

  const scannerPuisIssue = async (d) => {
    const r = await traiterScanLigne({ ligne: CHOU_FLEUR, codeBrut: '8712000900045', deps: d });
    return { r, issue: issueScan(r, { ligne: CHOU_FLEUR, prix: prixArticle(CHOU_FLEUR) }) };
  };
  const attendreAnnulable = (issue, chemin) => {
    expect(issue.annulable).toEqual({ ligneId: 'l-chou', libelle: expect.any(String), chemin });
    expect(issue.retour.ton).toBe('succes');
  };

  it('chemin 1 — code DÉJÀ connu (relier direct) : le cas du 09/11', async () => {
    const { r, issue } = await scannerPuisIssue(deps({ chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: BIERE }) }));
    expect(r.chemin).toBe(CHEMIN_CODE_CONNU);
    attendreAnnulable(issue, CHEMIN_CODE_CONNU);
    expect(issue.retour.titre).toBe('✓ Reconnu : Bière · 8.6 · 500 ml');
    expect(issue.retour.detail).toBe('Prix enregistré : 2,79 €');
    expect(issue.annulable.libelle).toBe('Bière · 8.6 · 500 ml');
  });

  it('chemin 2 — code inconnu, créé avec Open Food Facts', async () => {
    const { r, issue } = await scannerPuisIssue(deps({
      chercherOff: vi.fn().mockResolvedValue({ product_name: 'Bière', brands: '8.6', quantity: '500 ml' }),
      creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: true, produit_id: 'p', variante_produit_id: 'v', a_completer: false }, error: null }),
    }));
    expect(r.chemin).toBe(CHEMIN_CREE_OFF);
    attendreAnnulable(issue, CHEMIN_CREE_OFF);
    expect(issue.retour.titre).toBe('Créé : Bière · 8.6 · 500 ml');
  });

  it('chemin 3 — code inconnu, créé « à compléter » (OFF muet)', async () => {
    const { r, issue } = await scannerPuisIssue(deps({
      chercherOff: vi.fn().mockResolvedValue({}),
      creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: true, produit_id: 'p', variante_produit_id: 'v', a_completer: true }, error: null }),
    }));
    expect(r.chemin).toBe(CHEMIN_CREE_A_COMPLETER);
    attendreAnnulable(issue, CHEMIN_CREE_A_COMPLETER);
    expect(issue.retour.aCompleter).toBe(true);
  });

  it('chemin 4 — création demandée mais la base connaissait le code (deja_connu)', async () => {
    const { r, issue } = await scannerPuisIssue(deps({
      creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: true, deja_connu: true, produit_id: 'p', variante_produit_id: 'v' }, error: null }),
    }));
    expect(r.chemin).toBe(CHEMIN_DEJA_CONNU);
    attendreAnnulable(issue, CHEMIN_DEJA_CONNU);
  });

  it('aucun refus n\'ouvre la fenêtre (rien n\'a été écrit)', async () => {
    const refus = [
      await traiterScanLigne({ ligne: CHOU_FLEUR, codeBrut: '2401234009905', deps: deps() }),
      await traiterScanLigne({ ligne: CHOU_FLEUR, codeBrut: '8712000900045', deps: deps({ chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: { ...BIERE, actif: false } }) }) }),
      await traiterScanLigne({ ligne: CHOU_FLEUR, codeBrut: '8712000900045', deps: deps({ creerDepuisCode: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } }) }) }),
      { statut: SCAN_RECONNU, ecrit: false },
      null,
    ];
    for (const r of refus) expect(issueScan(r, { ligne: CHOU_FLEUR }).annulable).toBeNull();
  });
});
