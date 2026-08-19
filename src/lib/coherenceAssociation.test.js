import { describe, it, expect } from 'vitest';
import {
  selectionVide,
  ETATS_SELECTION,
  divergenceAssociation,
  construireRecapitulatif,
  formatVariante,
} from './coherenceAssociation';

// ── La remise à zéro ────────────────────────────────────────────────────────
describe('selectionVide', () => {
  it('ne laisse AUCUNE valeur non vide : rien de la ligne précédente ne survit', () => {
    for (const [nom, valeur] of Object.entries(selectionVide())) {
      const vide = valeur === null || valeur === '' || (Array.isArray(valeur) && valeur.length === 0);
      expect(vide, `${nom} devrait repartir vide, reçu ${JSON.stringify(valeur)}`).toBe(true);
    }
  });

  it('couvre bien le produit choisi, la variante, le terme cherché et les résultats', () => {
    // Les quatre états nommément cités comme portant l'erreur du 16-17/08.
    expect(ETATS_SELECTION).toContain('produitEnAttente');
    expect(ETATS_SELECTION).toContain('varianteChoisie');
    expect(ETATS_SELECTION).toContain('query');
    expect(ETATS_SELECTION).toContain('results');
  });

  it('rend un tableau NEUF à chaque appel : deux lignes ne partagent jamais la même référence', () => {
    const a = selectionVide();
    const b = selectionVide();
    expect(a.results).not.toBe(b.results); // référence, pas valeur
    a.results.push('résidu de la ligne A');
    expect(b.results).toEqual([]);
  });
});

// ── Le garde-fou de mots communs ────────────────────────────────────────────
describe('divergenceAssociation — il crie sur un couple absurde', () => {
  // Le cas réel du 16/08 10:48.
  it('« KETCHUP 50%SUCRE/SEL EN- 435GR » contre « Tendres perles à l\'italienne »', () => {
    expect(divergenceAssociation({
      libelleTicket: 'KETCHUP 50%SUCRE/SEL EN- 435GR',
      nomProduit: "Tendres perles à l'italienne",
    })).toBe(true);
  });

  // Le cas réel du 16/08 10:39 : le MÊME produit, pour une glace cette fois.
  it('« CONES CREME BRULEE X6 426G MR » contre « Tendres perles à l\'italienne »', () => {
    expect(divergenceAssociation({
      libelleTicket: 'CONES CREME BRULEE X6 426G MR',
      nomProduit: "Tendres perles à l'italienne",
    })).toBe(true);
  });

  // Le cas réel du 17/08 13:16.
  it('« RED BULL THE WINTER EDITION 25 » contre « Pulpe de tomates »', () => {
    expect(divergenceAssociation({
      libelleTicket: 'RED BULL THE WINTER EDITION 25',
      nomProduit: 'Pulpe de tomates',
    })).toBe(true);
  });
});

describe('divergenceAssociation — il se TAIT sur un couple correct', () => {
  it('« MAILLE MOUTARDE FORT » contre « Moutarde »', () => {
    expect(divergenceAssociation({
      libelleTicket: 'MAILLE MOUTARDE FORT',
      nomProduit: 'Moutarde',
    })).toBe(false);
  });

  it('la marque suffit à faire le lien quand le nom ne le fait pas', () => {
    expect(divergenceAssociation({
      libelleTicket: 'MAILLE FORT 260G',
      nomProduit: 'Moutarde',
      marque: 'Maille',
    })).toBe(false);
  });

  // Cité par François comme un rattachement légitime qu'il doit pouvoir faire.
  it('« DC-ELABORES SAUCISSE » contre « Saucisse à cuire »', () => {
    expect(divergenceAssociation({
      libelleTicket: 'DC-ELABORES SAUCISSE',
      nomProduit: 'Saucisse à cuire',
    })).toBe(false);
  });

  it('les accents et la casse ne créent pas de fausse divergence', () => {
    expect(divergenceAssociation({
      libelleTicket: 'CREME FRAICHE EPAISSE 30CL',
      nomProduit: 'Crème fraîche épaisse',
    })).toBe(false);
  });
});

describe('divergenceAssociation — ce qu\'on ne mesure pas, on ne le signale pas', () => {
  it('libellé de ticket vide, nul ou absent : aucune alerte (point 4)', () => {
    for (const vide of [null, undefined, '', '   ']) {
      expect(divergenceAssociation({ libelleTicket: vide, nomProduit: 'Moutarde' })).toBe(false);
    }
  });

  it('produit sans nom ni marque : aucune alerte', () => {
    expect(divergenceAssociation({ libelleTicket: 'MAILLE MOUTARDE FORT', nomProduit: null })).toBe(false);
  });

  it('un libellé fait uniquement de mots trop courts n\'est pas mesurable', () => {
    // « DC » et « X6 » font moins de 3 caractères : rien à comparer.
    expect(divergenceAssociation({ libelleTicket: 'DC X6', nomProduit: 'Moutarde' })).toBe(false);
  });

  it('appelé sans aucun argument, il ne plante pas et ne crie pas', () => {
    expect(divergenceAssociation()).toBe(false);
    expect(divergenceAssociation({})).toBe(false);
  });
});

// LE point le plus important du chantier : la comparaison porte sur le texte
// BRUT, jamais sur le libellé normalisé par l'OCR.
describe('divergenceAssociation — brut contre normalisé', () => {
  it('sur le NORMALISÉ, le garde-fou se tairait — c\'est le piège du ticket Netto', () => {
    // L'OCR a normalisé « CONES CREME BRULEE X6 426G MR » en « Glace vanille ».
    // Comparer la fiche au normalisé revient à lui demander de valider sa
    // propre erreur de lecture.
    const surLeNormalise = divergenceAssociation({
      libelleTicket: 'Glace vanille',
      nomProduit: 'Glace vanille',
    });
    expect(surLeNormalise).toBe(false); // muet : aucune protection

    // Sur le texte réellement imprimé, la même association est bien signalée
    // dès que la fiche n'a rien à voir.
    const surLeBrut = divergenceAssociation({
      libelleTicket: 'CONES CREME BRULEE X6 426G MR',
      nomProduit: 'Glace vanille',
    });
    expect(surLeBrut).toBe(true);
  });
});

// ── Le récapitulatif ────────────────────────────────────────────────────────
describe('construireRecapitulatif', () => {
  const produit = { produit_id: 'p1', nom_reference: 'Moutarde' };
  const variante = { id: 'v1', quantite_nette: 260, unite_quantite: 'g', marques: { nom: 'Maille' } };

  it('met face à face le texte brut du ticket et le produit choisi', () => {
    const r = construireRecapitulatif({
      libelleTicket: 'MAILLE MOUTARDE FORT 260G',
      libelleAffiche: 'Moutarde forte',
      produit,
      varianteId: 'v1',
      variante,
    });
    expect(r.libelleTicket).toBe('MAILLE MOUTARDE FORT 260G');
    expect(r.libelleTicketDisponible).toBe(true);
    expect(r.nomProduit).toBe('Moutarde');
    expect(r.marque).toBe('Maille');
    expect(r.format).toBe('260 g');
    expect(r.divergent).toBe(false);
    expect(r.varianteId).toBe('v1');
  });

  it('porte le drapeau de divergence sur un couple absurde', () => {
    const r = construireRecapitulatif({
      libelleTicket: 'KETCHUP 50%SUCRE/SEL EN- 435GR',
      produit: { produit_id: 'p2', nom_reference: "Tendres perles à l'italienne" },
    });
    expect(r.divergent).toBe(true);
  });

  it('libelle_ticket absent : le récapitulatif existe quand même, sans garde-fou', () => {
    const r = construireRecapitulatif({
      libelleTicket: null,
      libelleAffiche: 'Glace vanille',
      produit: { produit_id: 'p3', nom_reference: 'Pulpe de tomates' },
    });
    expect(r.libelleTicketDisponible).toBe(false);
    expect(r.libelleAffiche).toBe('Glace vanille');
    // Le couple est absurde, mais faute de texte brut on ne crie pas.
    expect(r.divergent).toBe(false);
  });

  it('appelé sans rien, il ne plante pas', () => {
    const r = construireRecapitulatif();
    expect(r.libelleTicketDisponible).toBe(false);
    expect(r.divergent).toBe(false);
    expect(r.nomProduit).toBeNull();
    expect(r.varianteId).toBeNull();
  });

  it('sans variante, il n\'invente ni marque ni format', () => {
    const r = construireRecapitulatif({ libelleTicket: 'MOUTARDE', produit, varianteId: null });
    expect(r.marque).toBeNull();
    expect(r.format).toBeNull();
  });
});

describe('formatVariante', () => {
  it('quantité simple', () => {
    expect(formatVariante({ quantite_nette: 260, unite_quantite: 'g' })).toBe('260 g');
  });
  it('lot : le nombre d\'unités est explicite', () => {
    expect(formatVariante({ quantite_nette: 426, unite_quantite: 'g', nombre_unites: 6 })).toBe('6 × 426 g');
  });
  it('donnée manquante ou absurde : null, jamais une chaîne bancale', () => {
    expect(formatVariante({})).toBeNull();
    expect(formatVariante({ quantite_nette: 0, unite_quantite: 'g' })).toBeNull();
    expect(formatVariante({ quantite_nette: 260 })).toBeNull();
    expect(formatVariante(null)).toBeNull();
  });
});
