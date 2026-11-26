// Chantier 214 (143-B) — le scan d'un débutant devient une proposition.
import { describe, it, expect, vi } from 'vitest';
import {
  ecrireScanLigne, proposerScanLigne, traiterScanLigne, issueScan, codeErreurConfiance,
  RECHERCHE_CONNU, RECHERCHE_INCONNU, SCAN_PROPOSE, SCAN_SUSPENDU, SCAN_ERREUR, SCAN_RECONNU,
  MESSAGE_PROPOSE, MESSAGE_SUSPENDU,
} from './scanDepuisHistorique';
import { creerParcoursIdentification, PHASE_SUCCES, PHASE_FIN, PHASE_VERIFICATION } from './parcoursIdentification';

const LIGNE = { id: 'l1', libelle_ticket: 'BIERE 8.6 50CL', statut_validation_produit: 'non_valide', prix_unitaire: 1.5, numero_ligne: 1 };
const LIGNE2 = { id: 'l2', libelle_ticket: 'CHIPS NATURE', statut_validation_produit: 'non_valide', prix_unitaire: 2, numero_ligne: 2 };
const BIERE = { id: 'v-biere', produit_id: 'p-biere', actif: true, quantite_nette: 500, unite_quantite: 'ml', produits: { nom_reference: 'Bière' }, marques: { nom: '8.6' } };
const CONNU = { statut: RECHERCHE_CONNU, code: '8712000900045', variante: BIERE, off: {} };
const INCONNU = { statut: RECHERCHE_INCONNU, code: '3017620422003', off: { product_name: 'Chips', brands: 'Lays', categories_tags: ['en:chips'] }, rayonChoisi: null, rangement: null };
const refusBase = (code) => ({ data: null, error: { message: code, code: 'P0001' } });

function deps(over = {}) {
  return {
    chercherVarianteParCode: vi.fn().mockResolvedValue({ connu: true, variante: BIERE }),
    chercherOff: vi.fn().mockResolvedValue({}),
    relier: vi.fn().mockResolvedValue({ data: null, error: null }),
    creerDepuisCode: vi.fn().mockResolvedValue({ data: { succes: true, produit_id: 'p', variante_produit_id: 'v' }, error: null }),
    proposerLiaison: vi.fn().mockResolvedValue({ data: 'prop-1', error: null }),
    proposerCreation: vi.fn().mockResolvedValue({ data: 'prop-2', error: null }),
    ...over,
  };
}

describe('codeErreurConfiance', () => {
  it('reconnaît les codes de la base', () => {
    expect(codeErreurConfiance({ message: 'VERIFICATION_REQUISE' })).toBe('VERIFICATION_REQUISE');
    expect(codeErreurConfiance({ message: 'x', details: 'COMPTE_SUSPENDU' })).toBe('COMPTE_SUSPENDU');
    expect(codeErreurConfiance('NOT_AUTHORIZED')).toBe('NON_AUTORISE');
    expect(codeErreurConfiance({ message: 'timeout' })).toBeNull();
    expect(codeErreurConfiance(null)).toBeNull();
  });
});

describe('débutant connu d\'avance (confiance = false)', () => {
  it('produit connu → proposer_liaison_scan, rien d\'écrit au catalogue', async () => {
    const d = deps();
    const r = await ecrireScanLigne({ ligne: LIGNE, recherche: CONNU, deps: d, confiance: false });
    expect(d.relier).not.toHaveBeenCalled();
    expect(d.proposerLiaison).toHaveBeenCalledWith({ ligneId: 'l1', produitId: 'p-biere', varianteId: 'v-biere', code: '8712000900045', libelleAlias: 'BIERE 8.6 50CL' });
    expect(r).toMatchObject({ statut: SCAN_PROPOSE, propose: true, ecrit: false, propositionId: 'prop-1', message: MESSAGE_PROPOSE });
  });
  it('produit inconnu → proposer_creation_scan avec les infos Open Food Facts', async () => {
    const d = deps();
    const r = await ecrireScanLigne({ ligne: LIGNE2, recherche: INCONNU, deps: d, confiance: false });
    expect(d.creerDepuisCode).not.toHaveBeenCalled();
    expect(d.proposerCreation).toHaveBeenCalledTimes(1);
    const arg = d.proposerCreation.mock.calls[0][0];
    expect(arg).toMatchObject({ ligneId: 'l2', code: '3017620422003' });
    expect(arg.off).toMatchObject({ product_name: 'Chips', brands: 'Lays' });
    expect(r.statut).toBe(SCAN_PROPOSE);
  });
});

describe('la base refuse l\'écriture (filet)', () => {
  it('VERIFICATION_REQUISE sur relier → bascule sur la proposition, sans message technique', async () => {
    const d = deps({ relier: vi.fn().mockResolvedValue(refusBase('VERIFICATION_REQUISE')) });
    const r = await ecrireScanLigne({ ligne: LIGNE, recherche: CONNU, deps: d });
    expect(d.proposerLiaison).toHaveBeenCalledTimes(1);
    expect(r.statut).toBe(SCAN_PROPOSE);
    expect(r.message).not.toMatch(/VERIFICATION/);
  });
  it('VERIFICATION_REQUISE sur la création → proposer_creation_scan', async () => {
    const d = deps({ creerDepuisCode: vi.fn().mockResolvedValue(refusBase('VERIFICATION_REQUISE')) });
    const r = await ecrireScanLigne({ ligne: LIGNE2, recherche: INCONNU, deps: d });
    expect(d.proposerCreation).toHaveBeenCalledTimes(1);
    expect(r.statut).toBe(SCAN_PROPOSE);
  });
  it('COMPTE_SUSPENDU → message doux, aucune proposition', async () => {
    const d = deps({ relier: vi.fn().mockResolvedValue(refusBase('COMPTE_SUSPENDU')) });
    const r = await ecrireScanLigne({ ligne: LIGNE, recherche: CONNU, deps: d });
    expect(d.proposerLiaison).not.toHaveBeenCalled();
    expect(r).toMatchObject({ statut: SCAN_SUSPENDU, message: MESSAGE_SUSPENDU, ecrit: false });
  });
  it('NON_AUTORISE → message lisible', async () => {
    const d = deps({ relier: vi.fn().mockResolvedValue(refusBase('NON_AUTORISE')) });
    const r = await ecrireScanLigne({ ligne: LIGNE, recherche: CONNU, deps: d });
    expect(r.statut).toBe(SCAN_ERREUR);
    expect(r.message).not.toMatch(/NON_AUTORISE/);
  });
  it('autre erreur → comportement d\'avant (pas de proposition)', async () => {
    const d = deps({ relier: vi.fn().mockResolvedValue({ data: null, error: { message: 'réseau' } }) });
    const r = await ecrireScanLigne({ ligne: LIGNE, recherche: CONNU, deps: d });
    expect(d.proposerLiaison).not.toHaveBeenCalled();
    expect(r.message).toBe('Le rattachement a échoué, réessaie.');
  });
  it('membre de confiance (ou inconnu) : écrit comme avant', async () => {
    for (const confiance of [true, null]) {
      const d = deps();
      const r = await ecrireScanLigne({ ligne: LIGNE, recherche: CONNU, deps: d, confiance });
      expect(d.relier).toHaveBeenCalledTimes(1);
      expect(d.proposerLiaison).not.toHaveBeenCalled();
      expect(r.statut).toBe(SCAN_RECONNU);
    }
  });
});

describe('envoi de la proposition', () => {
  it('compte suspendu au moment de proposer', async () => {
    const d = deps({ proposerLiaison: vi.fn().mockResolvedValue(refusBase('COMPTE_SUSPENDU')) });
    const r = await proposerScanLigne({ ligne: LIGNE, recherche: CONNU, deps: d });
    expect(r.statut).toBe(SCAN_SUSPENDU);
  });
  it('échec réseau → réessaie, jamais d\'exception', async () => {
    const d = deps({ proposerLiaison: vi.fn().mockRejectedValue(new Error('x')) });
    const r = await proposerScanLigne({ ligne: LIGNE, recherche: CONNU, deps: d });
    expect(r).toMatchObject({ statut: SCAN_ERREUR, ecrit: false });
  });
  it('traiterScanLigne (ancien écran) passe la confiance', async () => {
    const d = deps();
    const r = await traiterScanLigne({ ligne: LIGNE, codeBrut: '8712000900045', deps: d, confiance: false });
    expect(r.statut).toBe(SCAN_PROPOSE);
  });
});

describe('issueScan d\'une proposition', () => {
  it('un merci, pas d\'erreur, pas d\'« Annuler »', () => {
    const issue = issueScan({ statut: SCAN_PROPOSE, ecrit: false, propose: true, variante: BIERE, off: {} }, { ligne: LIGNE });
    expect(issue.annulable).toBeNull();
    expect(issue.retour.ton).toBe('succes');
    expect(issue.retour.titre).toBe('🙏 Merci, ton scan sera vérifié');
    expect(issue.retour.detail).toMatch(/Bière/);
  });
  it('compte suspendu : ton d\'attente', () => {
    expect(issueScan({ statut: SCAN_SUSPENDU, message: MESSAGE_SUSPENDU }, { ligne: LIGNE }).retour.ton).toBe('attente');
  });
});

describe('parcours plein écran d\'un débutant', () => {
  it('✓ → « Merci », ligne suivante, fin sans « Ticket complet »', async () => {
    const d = deps();
    const etats = [];
    const p = creerParcoursIdentification({ lignes: [LIGNE, LIGNE2], ligneDepartId: 'l1', deps: d, confiance: false, attendre: () => Promise.resolve(), journal: { info: vi.fn() }, onChange: (e) => etats.push(e) });
    await p.codeLu('8712000900045');
    expect(p.etat().phase).toBe(PHASE_VERIFICATION);
    await p.confirmer();
    expect(etats.some(e => e.phase === PHASE_SUCCES && e.propose?.libelle && e.annulable === null)).toBe(true);
    expect(d.relier).not.toHaveBeenCalled();
    expect(p.etat().ligne.id).toBe('l2');
    expect(p.position()).toEqual({ rang: 2, total: 2 });
    await p.codeLu('8712000900045');
    await p.confirmer();
    expect(p.etat().phase).toBe(PHASE_FIN);
    expect(p.etat()).toMatchObject({ proposes: 2, confirmes: 0, complet: false });
  });
  it('compte suspendu : on reste sur la fiche avec le message', async () => {
    const d = deps({ proposerLiaison: vi.fn().mockResolvedValue(refusBase('COMPTE_SUSPENDU')) });
    const p = creerParcoursIdentification({ lignes: [LIGNE], ligneDepartId: 'l1', deps: d, confiance: false, attendre: () => Promise.resolve(), journal: { info: vi.fn() } });
    await p.codeLu('8712000900045');
    await p.confirmer();
    expect(p.etat().phase).toBe(PHASE_VERIFICATION);
    expect(p.etat().message).toBe(MESSAGE_SUSPENDU);
  });
});
