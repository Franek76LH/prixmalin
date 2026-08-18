import { describe, it, expect } from 'vitest';
import {
  decouperQuantiteOff,
  chargeOffProposition,
  messageRetourProposition,
  messageErreurProposition,
  POINTS_PAR_PROPOSITION_VALIDEE,
} from './contributionCodesBarres';
import {
  verifierCoherenceCodeBarres,
  passerOutreAutorise,
  NIVEAU_SILENCIEUX,
  NIVEAU_NOTE,
  NIVEAU_AVERTISSEMENT,
  OFF_TROUVE,
  OFF_INCONNU,
  OFF_INDISPONIBLE,
} from './coherenceCodeBarres';

describe('decouperQuantiteOff', () => {
  it('découpe une quantité simple', () => {
    expect(decouperQuantiteOff('500 g')).toEqual({ quantite: 500, unite: 'g' });
  });

  it('accepte la virgule décimale française', () => {
    expect(decouperQuantiteOff('1,5 L')).toEqual({ quantite: 1.5, unite: 'l' });
  });

  it('rend le TOTAL d\'un lot, avec x ASCII comme avec × Unicode', () => {
    expect(decouperQuantiteOff('6 x 60 g')).toEqual({ quantite: 360, unite: 'g' });
    expect(decouperQuantiteOff('6 × 60 g')).toEqual({ quantite: 360, unite: 'g' });
  });

  it('renonce plutôt que d\'inventer quand le texte est illisible', () => {
    for (const texte of [null, undefined, '', '   ', 'format familial', '6 œufs']) {
      expect(decouperQuantiteOff(texte)).toEqual({ quantite: null, unite: null });
    }
  });

  it('ne renvoie jamais autre chose qu\'un nombre fini ou null', () => {
    const { quantite } = decouperQuantiteOff('250g');
    expect(typeof quantite).toBe('number');
    expect(Number.isFinite(quantite)).toBe(true);
  });
});

describe('chargeOffProposition', () => {
  const off = {
    nom: 'Boulgour Petit Épeautre',
    marque: 'Priméal',
    quantite: '500 g',
    imageSmall: 'https://off/small.jpg',
    imageLarge: 'https://off/large.jpg',
  };

  it('produit exactement les six clés attendues par la RPC', () => {
    const charge = chargeOffProposition({ off, statutOff: 'trouve' });
    expect(Object.keys(charge).sort()).toEqual(['marque', 'nom', 'photo_url', 'quantite', 'statut', 'unite']);
    expect(charge).toEqual({
      nom: 'Boulgour Petit Épeautre',
      marque: 'Priméal',
      quantite: 500,
      unite: 'g',
      photo_url: 'https://off/large.jpg',
      statut: 'trouve',
    });
  });

  it('retombe sur la petite photo quand la grande manque', () => {
    const charge = chargeOffProposition({ off: { ...off, imageLarge: null }, statutOff: 'trouve' });
    expect(charge.photo_url).toBe('https://off/small.jpg');
  });

  it('OFF injoignable ou muet : charge vide, mais le statut dit pourquoi', () => {
    for (const statut of ['inconnu', 'indisponible']) {
      const charge = chargeOffProposition({ off: null, statutOff: statut });
      expect(charge).toEqual({ nom: null, marque: null, quantite: null, unite: null, photo_url: null, statut });
    }
  });

  it('ne plante pas sans argument du tout', () => {
    expect(() => chargeOffProposition()).not.toThrow();
    expect(chargeOffProposition().statut).toBeNull();
  });

  it('quantite illisible part à null plutôt qu\'en texte (la RPC la caste en numeric)', () => {
    const charge = chargeOffProposition({ off: { ...off, quantite: 'format familial' }, statutOff: 'trouve' });
    expect(charge.quantite).toBeNull();
    expect(charge.unite).toBeNull();
  });
});

describe('messageRetourProposition', () => {
  it('en_attente : remercie et annonce les points réellement versés', () => {
    const m = messageRetourProposition({ statut: 'en_attente', id: 'abc' });
    expect(m.ton).toBe('succes');
    expect(m.detail).toContain(String(POINTS_PAR_PROPOSITION_VALIDEE));
    expect(m.detail).toContain('validation');
  });

  it('deja_connu : ton neutre, aucune promesse de points', () => {
    const m = messageRetourProposition({ statut: 'deja_connu', variante_produit_id: 'x' });
    expect(m.ton).toBe('neutre');
    expect(m.detail).not.toContain('points');
    expect(m.titre).toContain('déjà dans la base');
  });

  it('deja_propose : ton neutre, aucune promesse de points', () => {
    const m = messageRetourProposition({ statut: 'deja_propose' });
    expect(m.ton).toBe('neutre');
    expect(m.detail).not.toContain('points');
    expect(m.detail).toContain('attente');
  });

  it('réponse imprévue : ne fait jamais passer un doute pour un succès', () => {
    for (const reponse of [null, undefined, {}, { statut: 'zzz' }]) {
      expect(messageRetourProposition(reponse).ton).toBe('erreur');
    }
  });
});

describe('messageErreurProposition', () => {
  it('traduit les exceptions connues de la RPC', () => {
    expect(messageErreurProposition({ message: 'module de contribution fermé' })).toMatch(/fermé/);
    expect(messageErreurProposition({ message: 'connexion requise' })).toMatch(/connecté/);
    expect(messageErreurProposition({ message: 'code-barres invalide' })).toMatch(/rescanne/);
    expect(messageErreurProposition({ message: 'Could not find the function public.proposer_code_barres' })).toMatch(/SQL/);
  });

  it('garde le message brut plutôt qu\'un « une erreur est survenue »', () => {
    expect(messageErreurProposition({ message: 'boom réseau' })).toBe('boom réseau');
    expect(messageErreurProposition(null)).toBe('Envoi impossible, réessaie.');
  });
});

// ── Parcours complet, tel que ContributionCodeBarresSheet l'enchaîne ─────────
// Ces cas rejouent la chaîne de décision réelle (garde-fou 105 + charge OFF +
// message de retour) sans React ni réseau : c'est là que se décide ce que
// l'utilisateur voit et ce qui part en base.
describe('parcours de contribution', () => {
  const ficheBoulgour = {
    nomProduit: 'Boulgour',
    marque: 'Priméal',
    libelleVariante: null,
    quantite_nette: 500,
    unite_quantite: 'g',
    nombre_unites: null,
  };
  const ficheCones = {
    nomProduit: 'Cônes glacés',
    marque: 'Trium',
    libelleVariante: null,
    quantite_nette: 432,
    unite_quantite: 'g',
    nombre_unites: null,
  };
  const offBoulgour = {
    nom: 'Boulgour Petit Épeautre',
    marque: 'Priméal',
    quantite: '500 g',
    imageSmall: 'https://off/s.jpg',
    imageLarge: 'https://off/l.jpg',
  };

  it('cas nominal : OFF concorde avec la fiche -> aucun avertissement, charge complète', () => {
    const verdict = verifierCoherenceCodeBarres({ statutOff: OFF_TROUVE, off: offBoulgour, fiche: ficheBoulgour });
    expect(verdict.niveau).toBe(NIVEAU_SILENCIEUX);
    expect(chargeOffProposition({ off: offBoulgour, statutOff: OFF_TROUVE })).toEqual({
      nom: 'Boulgour Petit Épeautre', marque: 'Priméal', quantite: 500, unite: 'g',
      photo_url: 'https://off/l.jpg', statut: 'trouve',
    });
    expect(messageRetourProposition({ statut: 'en_attente', id: 'x' }).ton).toBe('succes');
  });

  it('incident du 17/08 rejoué : boulgour scanné sur une fiche de cônes -> avertissement', () => {
    const verdict = verifierCoherenceCodeBarres({ statutOff: OFF_TROUVE, off: offBoulgour, fiche: ficheCones });
    expect(verdict.niveau).toBe(NIVEAU_AVERTISSEMENT);
    expect(verdict.signaux).toContain('aucun_mot_commun');
  });

  it('code déjà connu : message neutre, aucune promesse de points', () => {
    const m = messageRetourProposition({ statut: 'deja_connu', variante_produit_id: 'v1' });
    expect(m.ton).toBe('neutre');
    expect(m.detail).not.toMatch(/points/i);
  });

  it('code déjà proposé : message neutre, aucune promesse de points', () => {
    const m = messageRetourProposition({ statut: 'deja_propose' });
    expect(m.ton).toBe('neutre');
    expect(m.detail).not.toMatch(/points/i);
  });

  it('OFF injoignable : ni avertissement ni note, charge vide mais statut conservé', () => {
    const verdict = verifierCoherenceCodeBarres({ statutOff: OFF_INDISPONIBLE, off: null, fiche: ficheCones });
    expect(verdict.niveau).toBe(NIVEAU_SILENCIEUX);
    const charge = chargeOffProposition({ off: null, statutOff: OFF_INDISPONIBLE });
    expect(charge.statut).toBe('indisponible');
    expect(charge.nom).toBeNull();
    expect(charge.quantite).toBeNull();
    // La proposition reste possible : rien dans la chaîne ne bloque.
    expect(messageRetourProposition({ statut: 'en_attente' }).ton).toBe('succes');
  });

  it('OFF ne connaît pas le code : note honnête, jamais un faux avertissement', () => {
    const verdict = verifierCoherenceCodeBarres({ statutOff: OFF_INCONNU, off: null, fiche: ficheCones });
    expect(verdict.niveau).toBe(NIVEAU_NOTE);
    expect(verdict.signaux).toEqual([]);
  });

  // passerOutreAutorise ne gouverne PAS l'écran de contribution (où les deux
  // sorties existent pour tout le monde, aucune n'écrivant en base) : il décide
  // qui peut écrire DIRECTEMENT malgré un désaccord, dans AValiderSheet.
  it('l\'écriture directe malgré un désaccord reste réservée à un administrateur', () => {
    expect(passerOutreAutorise({ estAdmin: true })).toBe(true);
    for (const cas of [{ estAdmin: false }, {}, undefined, { estAdmin: 'true' }, { estAdmin: 1 }]) {
      expect(passerOutreAutorise(cas)).toBe(false);
    }
  });
});
