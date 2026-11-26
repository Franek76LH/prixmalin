import { describe, it, expect } from 'vitest';
import {
  carteProposition, trierPropositions, nbAvisAttendus, messageApresAvis, messageErreurAvis,
  resumeApercuSuspension, messageErreurSuspension,
} from './verificationCommunaute';

const P_CONNU = { proposition_id: 'a', cree_le: '2026-11-26T10:00:00Z', code_barres: '8712000900045', libelle_ticket: 'BIERE 8.6 50CL', produit_id: 'p', nom_produit: 'Bière', quantite_nette: 500, unite_quantite: 'ml', marque: '8.6', mon_avis: null, nb_confirmations: 1 };
const P_INCONNU = { proposition_id: 'b', cree_le: '2026-11-25T10:00:00Z', code_barres: '3017620422003', libelle_ticket: 'CHIPS NAT', produit_id: null, nom_off: 'Chips nature', mon_avis: 'confirme', nb_confirmations: 0 };

describe('carteProposition', () => {
  it('produit connu : nom · marque · format', () => {
    expect(carteProposition(P_CONNU)).toEqual({ id: 'a', titre: 'BIERE 8.6 50CL', produit: 'Bière · 8.6 · 50 cl', inconnu: false, code: '8712000900045', monAvis: null, oui: 1 });
  });
  it('produit inconnu : nom Open Food Facts', () => {
    expect(carteProposition(P_INCONNU)).toMatchObject({ produit: 'Chips nature', inconnu: true, monAvis: 'confirme' });
  });
  it('vide : sans planter', () => {
    expect(carteProposition(null)).toMatchObject({ titre: 'Article sans libellé', produit: null, inconnu: true, oui: 0 });
  });
  it('kilos et litres', () => {
    expect(carteProposition({ ...P_CONNU, quantite_nette: 1500, unite_quantite: 'g' }).produit).toBe('Bière · 8.6 · 1,5 kg');
    expect(carteProposition({ ...P_CONNU, quantite_nette: 1000, unite_quantite: 'ml' }).produit).toBe('Bière · 8.6 · 1 L');
  });
});

describe('tri et compte', () => {
  it('sans mon avis d\'abord, puis la plus ancienne', () => {
    const c = { ...P_CONNU, proposition_id: 'c', cree_le: '2026-11-20T00:00:00Z' };
    expect(trierPropositions([P_INCONNU, P_CONNU, c]).map(p => p.proposition_id)).toEqual(['c', 'a', 'b']);
  });
  it('nbAvisAttendus', () => {
    expect(nbAvisAttendus([P_CONNU, P_INCONNU])).toBe(1);
    expect(nbAvisAttendus(null)).toBe(0);
  });
});

describe('messages d\'avis', () => {
  it('validée', () => expect(messageApresAvis({ validee: true }, 'confirme')).toBe('✓ Validé grâce à toi, merci !'));
  it('il en manque 1', () => expect(messageApresAvis({ confirmations: 1, seuil: 2, validee: false }, 'confirme')).toBe('Merci ! Encore 1 avis et c\'est validé.'));
  it('non', () => expect(messageApresAvis({ refus: 1 }, 'refuse')).toBe('Merci, François va regarder ce produit.'));
  it('erreurs lisibles', () => {
    expect(messageErreurAvis({ message: 'PROPRE_PROPOSITION' })).toMatch(/ta propre proposition/);
    expect(messageErreurAvis({ message: 'proposition déjà traitée' })).toMatch(/Déjà traitée/);
    expect(messageErreurAvis({ message: 'boom' })).toBe('Avis non enregistré, réessaie.');
  });
});

describe('aperçu de suspension', () => {
  it('liste ce qui sera défait, zéros tus', () => {
    const r = resumeApercuSuspension({ prix: 12, prix_dans_le_comparateur: 9, mouvements_points: 3, points: 45, propositions_en_attente: 1, avis_en_cours: 0, alias: 2, fiches_creees_a_revoir: 1, codes_barres_appris_a_revoir: 0, deja_suspendu: false });
    expect(r.lignes).toEqual([
      '12 prix retirés du comparateur (dont 9 affichés aujourd\'hui)',
      '45 points annulés',
      '1 proposition en attente refusée',
      '2 libellés appris écartés',
      '1 fiche créée à revoir (jamais supprimée)',
    ]);
    expect(r.vide).toBe(false);
  });
  it('rien à annuler', () => {
    const r = resumeApercuSuspension({ prix: 0, points: 0 });
    expect(r.vide).toBe(true);
    expect(r.phrase).toMatch(/mis en pause/);
  });
  it('déjà suspendu', () => expect(resumeApercuSuspension({ deja_suspendu: true }).dejaSuspendu).toBe(true));
  it('erreurs', () => {
    expect(messageErreurSuspension({ message: 'réservé admin' })).toBe('Réservé à l\'administrateur.');
    expect(messageErreurSuspension({ message: 'impossible sur soi-même' })).toMatch(/propre compte/);
    expect(messageErreurSuspension({ message: 'x' })).toBe('Action impossible, réessaie.');
  });
});
