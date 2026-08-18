import { describe, it, expect } from 'vitest';
import {
  verifierCoherenceCodeBarres,
  analyserQuantiteTexte,
  analyserQuantiteFiche,
  comparerQuantites,
  motsCommuns,
  passerOutreAutorise,
  divergenceAvecLigneTicket,
  SEUIL_ECART_QUANTITE,
  NIVEAU_SILENCIEUX,
  NIVEAU_NOTE,
  NIVEAU_AVERTISSEMENT,
  SIGNAL_AUCUN_MOT_COMMUN,
  SIGNAL_QUANTITE_DIVERGENTE,
  OFF_TROUVE,
  OFF_INCONNU,
  OFF_INDISPONIBLE,
} from './coherenceCodeBarres';

// Chantier 105 — les 5 cas exigés par la spec. Le premier est LE cas réel de
// l'incident et doit rester figé : c'est lui qui justifie tout le chantier.
describe('verifierCoherenceCodeBarres — les 5 cas de la spec', () => {
  // ————————————————————————————————————————————————————————————————————————
  // CAS 1 — L'INCIDENT DU 17/08, à ne jamais laisser repasser.
  //
  // Le code 3380380055393 a été appris sur la fiche « Cônes glacés ». OFF le
  // connaît parfaitement, et le renvoie encore aujourd'hui mot pour mot :
  //   product_name_fr « Boulgour Petit Épeautre » / brands « Priméal » /
  //   quantity « 500 g »  (vérifié sur l'API OFF v2 le 17/08).
  //
  // La fiche ci-dessous est la variante RÉELLE lue en base ce jour-là
  // (variante fd58…/3291…, nom_reference « Cônes glacés », marque Trium) :
  // quantite_nette 432 g AVEC nombre_unites 6. Le modèle documenté
  // (REFERENCE-modele-produit.md §6) dit que quantite_nette est la quantité
  // PAR UNITÉ et que nombre_unites la multiplie — le total comparé est donc
  // 2 592 g, d'où un écart énorme avec les 500 g d'OFF.
  // ————————————————————————————————————————————————————————————————————————
  const OFF_BOULGOUR = { nom: 'Boulgour Petit Épeautre', marque: 'Priméal', quantite: '500 g' };
  const FICHE_CONES_REELLE = {
    nomProduit: 'Cônes glacés',
    marque: 'Trium',
    libelleVariante: 'Vanille caramel beurre salé x6',
    quantite_nette: '432.000', // numeric PostgREST : arrive en string
    unite_quantite: 'g',
    nombre_unites: 6,
  };

  it("cas de l'incident : boulgour Priméal appris sur des cônes glacés -> AVERTISSEMENT", () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_TROUVE,
      off: OFF_BOULGOUR,
      fiche: FICHE_CONES_REELLE,
    });

    expect(v.niveau).toBe(NIVEAU_AVERTISSEMENT);
    // Les deux signaux partent sur la donnée réelle.
    expect(v.signaux).toContain(SIGNAL_AUCUN_MOT_COMMUN);
    expect(v.signaux).toContain(SIGNAL_QUANTITE_DIVERGENTE);
    expect(v.motsCommuns).toEqual([]);
    expect(v.quantite.comparable).toBe(true);
    expect(v.quantite.ecart).toBeCloseTo(0.807, 3);
  });

  // Même incident, mais en lisant les 432 g comme le POIDS TOTAL du paquet
  // (nombre_unites absent). C'est la lecture physiquement plausible pour une
  // boîte de 6 cônes, et elle change l'arithmétique du tout au tout :
  //
  //   |500 - 432| / 500 = 13,6 %  ->  SOUS le seuil de 20 %.
  //
  // La spec annonçait « 0 mot commun ET écart > 20 % » : sur cette lecture, le
  // second signal ne part PAS. L'avertissement se déclenche quand même, sur le
  // seul signal des mots — la règle étant « au moins un signal ».
  //
  // Ce test existe pour que le garde-fou reste déclencheur QUELLE QUE SOIT la
  // façon dont ce paquet est modélisé en base. C'est le point important : on ne
  // dépend pas d'une donnée de quantité juste pour attraper l'erreur.
  it("même incident lu comme un paquet de 432 g : AVERTISSEMENT sur les mots seuls", () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_TROUVE,
      off: OFF_BOULGOUR,
      fiche: { ...FICHE_CONES_REELLE, nombre_unites: null },
    });

    expect(v.niveau).toBe(NIVEAU_AVERTISSEMENT);
    expect(v.signaux).toEqual([SIGNAL_AUCUN_MOT_COMMUN]);
    expect(v.quantite.ecart).toBeCloseTo(0.136, 3);
    expect(v.quantite.divergent).toBe(false);
  });

  // CAS 2 — tout concorde : le garde-fou se taît complètement.
  it('tout concorde -> aucun avertissement, écran inchangé', () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_TROUVE,
      off: { nom: 'Boulgour Petit Épeautre', marque: 'Priméal', quantite: '500 g' },
      fiche: {
        nomProduit: 'Épeautre',
        marque: 'Priméal',
        libelleVariante: 'Boulgour 500 g',
        quantite_nette: 500,
        unite_quantite: 'g',
      },
    });

    expect(v.niveau).toBe(NIVEAU_SILENCIEUX);
    expect(v.signaux).toEqual([]);
    expect(v.motsCommuns).toContain('epeautre');
    expect(v.quantite.divergent).toBe(false);
  });

  // CAS 3 — les mots concordent, mais le format ne colle pas du tout : c'est
  // exactement le piège du 1 kg appris sur la fiche 500 g.
  it('seule la quantité diffère de plus de 20 % -> AVERTISSEMENT', () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_TROUVE,
      off: { nom: 'Ketchup', marque: 'Heinz', quantite: '1 kg' },
      fiche: {
        nomProduit: 'Ketchup',
        marque: 'Heinz',
        libelleVariante: 'Flacon souple',
        quantite_nette: 500,
        unite_quantite: 'g',
      },
    });

    expect(v.niveau).toBe(NIVEAU_AVERTISSEMENT);
    expect(v.signaux).toEqual([SIGNAL_QUANTITE_DIVERGENTE]);
    expect(v.motsCommuns).toContain('ketchup'); // les mots, eux, concordent
    expect(v.quantite.ecart).toBeCloseTo(0.5, 5);
  });

  // CAS 4 — OFF a répondu et ne connaît pas ce code. Rien à comparer, donc
  // aucun avertissement d'erreur — mais on ne fait pas semblant d'avoir
  // vérifié : niveau 'note', non bloquant.
  it("OFF ignore le code -> note honnête, pas d'avertissement d'erreur", () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_INCONNU,
      off: null,
      fiche: FICHE_CONES_REELLE,
    });

    expect(v.niveau).toBe(NIVEAU_NOTE);
    expect(v.niveau).not.toBe(NIVEAU_AVERTISSEMENT);
    expect(v.signaux).toEqual([]);
    expect(v.raison).toBe('off_ne_connait_pas_le_code');
  });

  // CAS 5 — OFF en timeout / injoignable : parcours actuel à l'identique.
  // Aucun blocage, aucun message d'erreur technique, pas même une note.
  it('timeout OFF -> parcours normal, rien du tout à l\'écran', () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_INDISPONIBLE,
      off: null,
      fiche: FICHE_CONES_REELLE,
    });

    expect(v.niveau).toBe(NIVEAU_SILENCIEUX);
    expect(v.signaux).toEqual([]);
    expect(v.raison).toBe('off_indisponible');
  });
});

describe('robustesse — le garde-fou ne doit jamais planter ni crier à tort', () => {
  it('appel sans aucun argument ne jette pas', () => {
    expect(() => verifierCoherenceCodeBarres()).not.toThrow();
    expect(verifierCoherenceCodeBarres().niveau).toBe(NIVEAU_NOTE);
  });

  it('fiche sans quantité exploitable : pas de signal de quantité inventé', () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_TROUVE,
      off: { nom: 'Épeautre', marque: 'Priméal', quantite: '500 g' },
      fiche: { nomProduit: 'Épeautre', marque: 'Priméal', quantite_nette: null, unite_quantite: null },
    });
    expect(v.quantite.comparable).toBe(false);
    expect(v.signaux).not.toContain(SIGNAL_QUANTITE_DIVERGENTE);
    expect(v.niveau).toBe(NIVEAU_SILENCIEUX); // « epeautre » commun
  });

  it("OFF sans quantité (champ vide) : on ne compare pas, on n'alerte pas", () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_TROUVE,
      off: { nom: 'Riz basmati', marque: 'Taureau Ailé', quantite: null },
      fiche: { nomProduit: 'Riz basmati', marque: 'Taureau Ailé', quantite_nette: 1, unite_quantite: 'kg' },
    });
    expect(v.quantite.comparable).toBe(false);
    expect(v.signaux).toEqual([]);
  });

  it('texte de fiche vide : absence de donnée, pas un désaccord', () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_TROUVE,
      off: { nom: 'Boulgour', marque: 'Priméal', quantite: '500 g' },
      fiche: { nomProduit: null, marque: null, libelleVariante: null, quantite_nette: 500, unite_quantite: 'g' },
    });
    expect(v.signaux).not.toContain(SIGNAL_AUCUN_MOT_COMMUN);
    expect(v.niveau).toBe(NIVEAU_SILENCIEUX);
  });

  it('poids contre volume : non comparable, jamais un faux signal', () => {
    const c = comparerQuantites('50 cl', { quantite_nette: 500, unite_quantite: 'g' });
    expect(c.comparable).toBe(false);
    expect(c.raison).toBe('familles_differentes');
  });
});

describe('analyserQuantiteTexte — le texte libre d\'OpenFoodFacts', () => {
  it('formes courantes', () => {
    expect(analyserQuantiteTexte('500 g').canonique).toBeCloseTo(0.5, 6);
    expect(analyserQuantiteTexte('500g').canonique).toBeCloseTo(0.5, 6);
    expect(analyserQuantiteTexte('1 kg').canonique).toBeCloseTo(1, 6);
    expect(analyserQuantiteTexte('1,5 L').canonique).toBeCloseTo(1.5, 6);
    expect(analyserQuantiteTexte('50 cl').canonique).toBeCloseTo(0.5, 6);
  });

  it('lot « 6 x 60 g » compte le total', () => {
    expect(analyserQuantiteTexte('6 x 60 g').valeur).toBe(360);
  });

  // OFF écrit indifféremment « x » ASCII et « × » Unicode. Ne reconnaître que
  // l'ASCII faisait lire « 6 × 60 g » comme 60 g, donc un faux écart de 83 %
  // et un avertissement injustifié sur un produit parfaitement concordant.
  it('lot avec « × » Unicode compte aussi le total', () => {
    expect(analyserQuantiteTexte('6 × 60 g').valeur).toBe(360);
    expect(analyserQuantiteTexte('6×60g').valeur).toBe(360);
  });

  it('un lot Unicode concordant ne déclenche AUCUN avertissement', () => {
    const v = verifierCoherenceCodeBarres({
      statutOff: OFF_TROUVE,
      off: { nom: 'Yaourt nature', marque: 'Danone', quantite: '6 × 125 g' },
      fiche: {
        nomProduit: 'Yaourt nature',
        marque: 'Danone',
        quantite_nette: 125,
        unite_quantite: 'g',
        nombre_unites: 6,
      },
    });
    expect(v.niveau).toBe(NIVEAU_SILENCIEUX);
    expect(v.signaux).toEqual([]);
  });

  it('renonce plutôt que de deviner', () => {
    expect(analyserQuantiteTexte('')).toBeNull();
    expect(analyserQuantiteTexte(null)).toBeNull();
    expect(analyserQuantiteTexte('une boîte')).toBeNull();
    expect(analyserQuantiteTexte('6 pièces')).toBeNull(); // famille pièce exclue
    expect(analyserQuantiteTexte('12 trucs')).toBeNull(); // unité inconnue
  });
});

describe('analyserQuantiteFiche — la variante du catalogue', () => {
  it('multiplie par nombre_unites', () => {
    expect(analyserQuantiteFiche({ quantite_nette: 60, unite_quantite: 'g', nombre_unites: 6 }).valeur).toBe(360);
  });

  it('nombre_unites absent ou nul vaut 1', () => {
    expect(analyserQuantiteFiche({ quantite_nette: 500, unite_quantite: 'g' }).valeur).toBe(500);
    expect(analyserQuantiteFiche({ quantite_nette: 500, unite_quantite: 'g', nombre_unites: 0 }).valeur).toBe(500);
  });

  it('numeric PostgREST en string reste exploitable', () => {
    expect(analyserQuantiteFiche({ quantite_nette: '500.000', unite_quantite: 'g' }).canonique).toBeCloseTo(0.5, 6);
  });

  it('données invalides -> null, jamais un nombre faux', () => {
    expect(analyserQuantiteFiche({ quantite_nette: 0, unite_quantite: 'g' })).toBeNull();
    expect(analyserQuantiteFiche({ quantite_nette: 500, unite_quantite: 'pièce' })).toBeNull();
    expect(analyserQuantiteFiche({})).toBeNull();
  });
});

describe('le seuil de 20 %, à la frontière', () => {
  it('juste sous le seuil ne signale pas, juste au-dessus signale', () => {
    // 500 g de référence : 400 g = 20 % pile (non), 399 g = 20,2 % (oui).
    expect(comparerQuantites('500 g', { quantite_nette: 400, unite_quantite: 'g' }).divergent).toBe(false);
    expect(comparerQuantites('500 g', { quantite_nette: 399, unite_quantite: 'g' }).divergent).toBe(true);
    expect(SEUIL_ECART_QUANTITE).toBe(0.20);
  });
});

describe('motsCommuns', () => {
  it('ignore accents et casse', () => {
    expect(motsCommuns('Épeautre BIO', 'epeautre bio')).toEqual(expect.arrayContaining(['epeautre', 'bio']));
  });

  it('ignore les mots de moins de 3 lettres', () => {
    expect(motsCommuns('du riz', 'du sel')).toEqual([]); // « du » trop court
  });
});

// La décision « apprendre quand même » est isolée ici pour pouvoir être
// retirée aux non-administrateurs sans toucher à l'UI.
describe('passerOutreAutorise', () => {
  it('administrateur : le bouton existe', () => {
    expect(passerOutreAutorise({ estAdmin: true })).toBe(true);
  });

  it('non-administrateur : refus par défaut, y compris sans argument', () => {
    expect(passerOutreAutorise({ estAdmin: false })).toBe(false);
    expect(passerOutreAutorise({})).toBe(false);
    expect(passerOutreAutorise()).toBe(false);
  });
});

// ── Chantier 107 — « ce produit ne ressemble pas à la ligne du ticket » ──────
describe('divergenceAvecLigneTicket', () => {
  it('LE cas réel : un Caprice des Dieux scanné sur une ligne Red Bull', () => {
    expect(divergenceAvecLigneTicket({
      statutOff: OFF_TROUVE,
      off: { nom: 'Caprice des Dieux', marque: 'Caprice des Dieux', quantite: '200 g' },
      libelle: 'Boisson énergisante Red Bull summer edition',
      libelleTicket: 'RED BULL THE SUMMER EDITION 25',
    })).toBe(true);
  });

  it('au moins un mot commun -> rien du tout, le silence est le message', () => {
    expect(divergenceAvecLigneTicket({
      statutOff: OFF_TROUVE,
      off: { nom: 'Boisson énergisante', marque: 'Red Bull' },
      libelle: 'Boisson énergisante Red Bull summer edition',
      libelleTicket: 'RED BULL THE SUMMER EDITION 25',
    })).toBe(false);
  });

  it('un seul mot commun suffit à faire taire le bandeau', () => {
    expect(divergenceAvecLigneTicket({
      statutOff: OFF_TROUVE,
      off: { nom: 'Comté râpé', marque: 'Entremont' },
      libelle: 'COMTE RAPE 200G',
      libelleTicket: null,
    })).toBe(false);
  });

  // FAUSSE ALERTE ASSUMÉE — à ne PAS « corriger ».
  //
  // Le ticket de François imprime « GROS BRIDE IGP ARDECHE » pour un fromage de
  // brebis : ce libellé de caisse ne partage aucun mot avec le nom réel du
  // produit. Le bandeau s'affiche donc alors que le scan est juste.
  //
  // C'est le comportement VOULU. On compare ici à un libellé de caisse, pas à
  // une fiche du catalogue : les abréviations et les noms de gamme rendent ces
  // faux positifs inévitables. Le prix à payer est un bandeau ambre discret ;
  // le prix de l'inverse serait un Caprice des Dieux appris sur une ligne Red
  // Bull sans un mot. Rien n'est bloqué : le bouton vert reste le bouton
  // principal et le parcours est identique à celui d'avant le chantier.
  it('fausse alerte assumée : « GROS BRIDE IGP ARDECHE » contre un vrai fromage de brebis', () => {
    expect(divergenceAvecLigneTicket({
      statutOff: OFF_TROUVE,
      off: { nom: 'Ossau-Iraty', marque: 'Istara' },
      libelle: 'Fromage de brebis',
      libelleTicket: 'GROS BRIDE IGP ARDECHE',
    })).toBe(true);
  });

  it('OFF injoignable ou muet : aucun bandeau, on ne signale que ce qu\'on a comparé', () => {
    for (const statutOff of [OFF_INDISPONIBLE, OFF_INCONNU]) {
      expect(divergenceAvecLigneTicket({
        statutOff,
        off: null,
        libelle: 'Boisson énergisante Red Bull summer edition',
        libelleTicket: 'RED BULL THE SUMMER EDITION 25',
      })).toBe(false);
    }
    // Même sans statut, une fiche OFF absente ne permet aucune comparaison.
    expect(divergenceAvecLigneTicket({
      off: null,
      libelle: 'Boisson énergisante Red Bull',
    })).toBe(false);
  });

  it('module de contribution : aucune ligne de ticket -> aucun bandeau', () => {
    // Ce que le 106 met dans `assistant` depuis l'accueil : ni libelle ni
    // libelleTicket. Rien à comparer, donc rien à signaler.
    expect(divergenceAvecLigneTicket({
      statutOff: OFF_TROUVE,
      off: { nom: 'Caprice des Dieux', marque: 'Caprice des Dieux' },
    })).toBe(false);
  });

  it('ligne de ticket sans libellé exploitable -> aucun bandeau', () => {
    for (const paire of [{ libelle: '', libelleTicket: '' }, { libelle: '  ', libelleTicket: null }, { libelle: '25', libelleTicket: 'XX' }]) {
      expect(divergenceAvecLigneTicket({
        statutOff: OFF_TROUVE,
        off: { nom: 'Caprice des Dieux', marque: 'Caprice des Dieux' },
        ...paire,
      })).toBe(false);
    }
  });

  it('fiche OFF sans texte exploitable -> aucun bandeau', () => {
    expect(divergenceAvecLigneTicket({
      statutOff: OFF_TROUVE,
      off: { nom: null, marque: null, quantite: '200 g' },
      libelle: 'Boisson énergisante Red Bull',
    })).toBe(false);
  });

  it('ne plante jamais, même sans argument', () => {
    expect(() => divergenceAvecLigneTicket()).not.toThrow();
    expect(divergenceAvecLigneTicket()).toBe(false);
  });
});
