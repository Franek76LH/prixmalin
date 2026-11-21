import { describe, it, expect } from 'vitest';
import { regrouperLignesTicket, construireBilanFin, planClotureListe } from './bilanFinCoursesCore';

const art = (cle, nom, { produit = 'p' + cle, variante = null, varianteListe = null, quantite = 1, etat = 'a_prendre', achat } = {}) => ({
  cle, type: 'caddie', nom_affiche: nom, produit_id: produit, variante_produit_id: variante, variante_liste: varianteListe,
  quantite, etat, ...(achat ? { achat } : {}),
});
const ligne = (produit, variante, quantite, pu, libelle = 'LIGNE') => ({ produit_id: produit, variante_produit_id: variante, quantite, prix_unitaire: pu, libelle });

describe('chantier 163 — regroupement des lignes du ticket', () => {
  it('deux lignes même produit, même format → une entrée, quantités et montants additionnés', () => {
    const { groupes, nonReconnues } = regrouperLignesTicket([ligne('pates', 'v500', 1, 0.89), ligne('pates', 'v500', 1, 0.89), ligne('pates', 'v1k', 1, 1.5), { produit_id: null, libelle: 'PROMO DIV', quantite: 1, prix_unitaire: 2.1 }]);
    expect(groupes).toHaveLength(2);
    expect(groupes[0]).toMatchObject({ produit_id: 'pates', variante_produit_id: 'v500', quantite: 2, montant: 1.78, nbLignes: 2 });
    expect(nonReconnues).toEqual([{ libelle: 'PROMO DIV', quantite: 1, montant: 2.1 }]);
  });
});

describe('chantier 163 — bilan de fin de courses', () => {
  it('le scénario du steak : poulet en plus, steak à garder, aucun lien entre les deux', () => {
    const articles = [art('1', 'Steak haché', { quantite: 1 })];
    const b = construireBilanFin({ articles, lignesTicket: [ligne('poulet', null, 1, 6.9, 'POULET FERMIER')], quantitesListe: { 1: 1 } });
    expect(b.reste).toEqual([{ cle: '1', nom: 'Steak haché', quantite: 1, quantiteActuelle: 1, ajouteDepuis: 0, raison: 'pas_pris' }]);
    expect(b.enPlus).toEqual([{ produit_id: 'poulet', variante_produit_id: null, nom: 'POULET FERMIER', quantite: 1, montant: 6.9 }]);
    expect(b.retrouves).toEqual([]);
    expect(b.totalEnPlus).toBe(6.9);
  });

  it('2 prévus, 1 acheté → 1 restant', () => {
    const b = construireBilanFin({ articles: [art('1', 'Pâtes', { produit: 'pates', quantite: 2, etat: 'au_caddie' })], lignesTicket: [ligne('pates', 'v500', 1, 0.89)], quantitesListe: { 1: 2 } });
    expect(b.retrouves[0]).toMatchObject({ achete: 1, prevu: 2 });
    expect(b.reste[0]).toMatchObject({ quantite: 1, ajouteDepuis: 0, raison: 'partiel' });
  });

  it('idem + 1 paquet ajouté à Ma liste entre-temps (ligne passée à 3) → 2 restants, dont 1 ajouté depuis', () => {
    const b = construireBilanFin({ articles: [art('1', 'Pâtes', { produit: 'pates', quantite: 2 })], lignesTicket: [ligne('pates', 'v500', 1, 0.89)], quantitesListe: { 1: 3 } });
    expect(b.reste[0]).toMatchObject({ quantite: 2, ajouteDepuis: 1, raison: 'partiel' });
  });

  it('tout acheté mais 1 ajouté depuis → 1 restant « ajouté depuis »', () => {
    const b = construireBilanFin({ articles: [art('1', 'Pâtes', { produit: 'pates', quantite: 2 })], lignesTicket: [ligne('pates', 'v500', 2, 0.89)], quantitesListe: { 1: 3 } });
    expect(b.reste[0]).toMatchObject({ quantite: 1, ajouteDepuis: 1, raison: 'ajoute_depuis' });
  });

  it('deux lignes du même produit-format sont regroupées avant de calculer les achats en plus', () => {
    const b = construireBilanFin({ articles: [art('1', 'Pâtes', { produit: 'pates', quantite: 2 })], lignesTicket: [ligne('pates', 'v500', 1, 0.89), ligne('pates', 'v500', 1, 0.89)], quantitesListe: { 1: 2 } });
    expect(b.retrouves[0]).toMatchObject({ achete: 2, montant: 1.78 });
    expect(b.enPlus).toEqual([]);
    expect(b.reste).toEqual([]);
  });

  it('3 achetés pour 2 prévus → 2 retrouvés, 1 en plus', () => {
    const b = construireBilanFin({ articles: [art('1', 'Pâtes', { produit: 'pates', quantite: 2 })], lignesTicket: [ligne('pates', 'v500', 3, 1)], quantitesListe: { 1: 2 } });
    expect(b.retrouves[0].achete).toBe(2);
    expect(b.enPlus).toEqual([{ produit_id: 'pates', variante_produit_id: 'v500', nom: 'LIGNE', quantite: 1, montant: 1 }]);
  });

  it('format différent : signalé seulement si un format précis était demandé', () => {
    const precis = construireBilanFin({ articles: [art('1', 'Lait', { produit: 'lait', varianteListe: 'v1L' })], lignesTicket: [ligne('lait', 'v6x1L', 1, 5)], quantitesListe: { 1: 1 } });
    expect(precis.retrouves[0]).toMatchObject({ achete: 1, autreFormat: true });
    const indifferent = construireBilanFin({ articles: [art('1', 'Lait', { produit: 'lait', variante: 'v1L', varianteListe: null })], lignesTicket: [ligne('lait', 'v6x1L', 1, 5)], quantitesListe: { 1: 1 } });
    expect(indifferent.retrouves[0].autreFormat).toBe(false);
  });

  it('le format demandé est servi en premier', () => {
    const b = construireBilanFin({
      articles: [art('1', 'Lait 1 L', { produit: 'lait', varianteListe: 'v1L' }), art('2', 'Lait', { produit: 'lait' })],
      lignesTicket: [ligne('lait', 'v6x', 1, 5), ligne('lait', 'v1L', 1, 1)], quantitesListe: { 1: 1, 2: 1 },
    });
    expect(b.retrouves.find(r => r.cle === '1').autreFormat).toBe(false);
    expect(b.retrouves).toHaveLength(2);
    expect(b.enPlus).toEqual([]);
  });

  it('coché mais absent du ticket : acheté par défaut, « à vérifier » ; « Pas pris » le remet dans le reste', () => {
    const articles = [art('1', 'Beurre', { etat: 'au_caddie', achat: 'a_verifier' })];
    const lignes = [ligne('autre', null, 1, 1)];
    const defaut = construireBilanFin({ articles, lignesTicket: lignes, quantitesListe: { 1: 1 } });
    expect(defaut.aVerifier).toEqual([{ cle: '1', nom: 'Beurre', quantite: 1, pasPris: false }]);
    expect(defaut.retrouves[0]).toMatchObject({ incertain: true, achete: 1 });
    expect(defaut.reste).toEqual([]);
    const pasPris = construireBilanFin({ articles, lignesTicket: lignes, quantitesListe: { 1: 1 }, decisions: { 1: 'pas_pris' } });
    expect(pasPris.retrouves).toEqual([]);
    expect(pasPris.reste[0]).toMatchObject({ quantite: 1, raison: 'pas_pris' });
  });

  it('l\'absence sur le ticket ne dit jamais « introuvable » ; seul le 🚫 en rayon le dit', () => {
    const b = construireBilanFin({ articles: [art('1', 'Steak', {}), art('2', 'Crème', { etat: 'introuvable' })], lignesTicket: [ligne('x', null, 1, 1)], quantitesListe: { 1: 1, 2: 1 } });
    expect(b.reste.find(r => r.cle === '1').raison).toBe('pas_pris');
    expect(b.reste.find(r => r.cle === '2').raison).toBe('introuvable');
  });

  it('ligne du ticket non reconnue : listée, jamais comptée « en plus »', () => {
    const b = construireBilanFin({ articles: [], lignesTicket: [{ produit_id: null, libelle: 'PROMO DIV', quantite: 1, prix_unitaire: 2.1 }], quantitesListe: {} });
    expect(b.nonReconnues).toEqual([{ libelle: 'PROMO DIV', quantite: 1, montant: 2.1 }]);
    expect(b.enPlus).toEqual([]);
  });

  it('sans ticket : coché = acheté, non coché = reste', () => {
    const b = construireBilanFin({ articles: [art('1', 'Lait', { etat: 'au_caddie', quantite: 2 }), art('2', 'Café', {})], quantitesListe: { 1: 2, 2: 1 } });
    expect(b.avecTicket).toBe(false);
    expect(b.retrouves[0]).toMatchObject({ cle: '1', sansTicket: true });
    expect(b.reste).toEqual([expect.objectContaining({ cle: '2', quantite: 1 })]);
  });

  it('une ligne retirée de Ma liste pendant les courses n\'apparaît pas dans le reste', () => {
    const b = construireBilanFin({ articles: [art('1', 'Café', {})], quantitesListe: {} });
    expect(b.reste).toEqual([]);
  });
});

describe('chantier 163 — ce que la clôture écrit dans Ma liste', () => {
  const articles = [
    art('1', 'Pâtes', { produit: 'pates', quantite: 2 }),
    art('2', 'Lait', { produit: 'lait', etat: 'au_caddie' }),
    art('3', 'Steak', { produit: 'steak' }),
    art('4', 'Café', { produit: 'cafe' }),
  ];
  const quantitesListe = { 1: 3, 2: 1, 3: 1, 4: 1, 99: 1 };
  const bilan = construireBilanFin({ articles, lignesTicket: [ligne('pates', 'v', 1, 1), ligne('lait', 'v', 1, 1)], quantitesListe });

  it('reste gardé sur la même ligne (nouvelle quantité), le soldé supprimé, la ligne hors courses jamais touchée', () => {
    const plan = planClotureListe({ articles, bilan, quantitesListe });
    expect(plan.majQuantite).toEqual([{ id: '1', quantite: 2 }]);
    expect(plan.supprimer).toEqual(['2']);
    expect(JSON.stringify(plan)).not.toContain('99');
  });

  it('décocher « Garder dans Ma liste » = retirer', () => {
    const plan = planClotureListe({ articles, bilan, quantitesListe, garder: { 3: false } });
    expect(plan.supprimer.sort()).toEqual(['2', '3']);
  });

  it('les achats en plus ne touchent jamais Ma liste', () => {
    const b = construireBilanFin({ articles: [art('1', 'Steak', { produit: 'steak' })], lignesTicket: [ligne('poulet', null, 1, 6.9)], quantitesListe: { 1: 1 } });
    expect(planClotureListe({ articles: [art('1', 'Steak', { produit: 'steak' })], bilan: b, quantitesListe: { 1: 1 } })).toEqual({ majQuantite: [], supprimer: [] });
  });
});

describe('chantier 163 — démo « ?demo=bilan »', () => {
  it('ouverte seulement par ?demo=bilan', async () => {
    const { demoDemandee } = await import('./demoBilanCourses');
    expect(demoDemandee('?demo=bilan')).toBe(true);
    expect(demoDemandee('?compte=x&demo=bilan')).toBe(true);
    expect(demoDemandee('')).toBe(false);
    expect(demoDemandee('?demo=autre')).toBe(false);
  });
  it('le scénario de démo donne les rubriques attendues', async () => {
    const { SESSION_DEMO_BILAN, LISTE_DEMO_BILAN } = await import('./demoBilanCourses');
    const b = construireBilanFin({ articles: SESSION_DEMO_BILAN.articles, lignesTicket: SESSION_DEMO_BILAN.ticket_lignes,
      quantitesListe: Object.fromEntries(LISTE_DEMO_BILAN.map(i => [i.id, i.qty])) });
    expect(b.reste.map(r => [r.cle, r.quantite, r.raison])).toEqual([['steak', 1, 'introuvable'], ['pates', 2, 'partiel'], ['cafe', 1, 'pas_pris']]);
    expect(b.enPlus.map(e => e.nom)).toEqual(['POULET FERMIER', 'CHOCOLAT NOIR 70%']);
    expect(b.retrouves.find(r => r.cle === 'lait').autreFormat).toBe(true);
    expect(b.retrouves.find(r => r.cle === 'yaourt')).toMatchObject({ achete: 2, montant: 2.9 });
    expect(b.aVerifier.map(v => v.cle)).toEqual(['beurre']);
    expect(b.nonReconnues).toHaveLength(1);
  });
});
