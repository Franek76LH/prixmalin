import { describe, it, expect } from 'vitest';
import {
  controlerCoherenceTicket,
  MONTANT_SANS_TOTAL,
  MONTANT_REMISES_INCONNUES,
  controlerDateTicket,
  sommeLignes,
  articlesLus,
  montantLigne,
  formatEuros,
  dateDuJourIso,
  NIVEAU_OK,
  NIVEAU_AVERTISSEMENT,
  NIVEAU_BLOCAGE,
  MOTIF_MONTANT,
  MOTIF_ARTICLES,
  DATE_FUTURE,
  DATE_TROP_ANCIENNE,
} from './coherenceTicket';

const ligne = (total, qty = 1) => ({ name: 'x', price: total / qty, qty, total });

describe('montantLigne / sommeLignes / articlesLus', () => {
  it('prend le total de ligne, pas le prix unitaire', () => {
    expect(montantLigne({ price: 1.29, qty: 2, total: 2.58 })).toBe(2.58);
  });

  it('retombe sur prix × quantité quand le total manque', () => {
    expect(montantLigne({ price: 1.5, qty: 2 })).toBe(3);
    expect(montantLigne({ price: 1.5 })).toBe(1.5);
  });

  it('une ligne illisible vaut 0 et ne gonfle pas la somme', () => {
    for (const p of [null, {}, { price: 'abc' }, { price: -2 }, { total: 'zz', price: null }]) {
      expect(montantLigne(p)).toBe(0);
    }
    expect(sommeLignes([ligne(10), null, {}])).toBe(10);
  });

  it('compte les ARTICLES et non les lignes (une ligne ×3 vaut 3)', () => {
    expect(articlesLus([ligne(6, 3), ligne(2)])).toBe(4);
    expect(articlesLus([{ name: 'x' }])).toBe(1); // qty absente = 1
  });
});

describe('controlerCoherenceTicket — montant', () => {
  it('écart nul : rien, on continue comme aujourd\'hui', () => {
    const r = controlerCoherenceTicket({ products: [ligne(20), ligne(25.33)], total_ticket: 45.33, total_remises: 0 });
    expect(r.niveau).toBe(NIVEAU_OK);
    expect(r.ecartMontant).toBeCloseTo(0, 6);
    expect(r.motifs).toEqual([]);
  });

  it('écart de 1 % : encore le silence (arrondis, consignes, remises)', () => {
    const r = controlerCoherenceTicket({ products: [ligne(45.78)], total_ticket: 45.33, total_remises: 0 });
    expect(r.ecartMontant).toBeLessThan(0.02);
    expect(r.niveau).toBe(NIVEAU_OK);
  });

  it('écart de 5 % : avertissement, l\'import reste possible', () => {
    const r = controlerCoherenceTicket({ products: [ligne(47.60)], total_ticket: 45.33, total_remises: 0 });
    expect(r.ecartMontant).toBeGreaterThan(0.02);
    expect(r.ecartMontant).toBeLessThan(0.10);
    expect(r.niveau).toBe(NIVEAU_AVERTISSEMENT);
    expect(r.motifs).toContain(MOTIF_MONTANT);
  });

  // LE cas réel du chantier, figé avec les vrais chiffres du ticket Netto.
  it('le ticket Netto : 115,45 € lus contre 45,33 € imprimés -> BLOCAGE', () => {
    const r = controlerCoherenceTicket({
      products: [ligne(115.45)],
      total_ticket: 45.33,
      total_remises: 0,
      nombre_articles: 20,
    });
    expect(r.niveau).toBe(NIVEAU_BLOCAGE);
    expect(r.ecartMontant).toBeGreaterThan(1.5); // ~155 %
    expect(r.motifs).toContain(MOTIF_MONTANT);
    // Les deux chiffres restent disponibles pour l'affichage côte à côte.
    expect(formatEuros(r.sommeLignes)).toBe('115,45 €');
    expect(formatEuros(r.totalTicket)).toBe('45,33 €');
  });

  it('une lecture qui MANQUE des articles est bloquée aussi (écart en moins)', () => {
    const r = controlerCoherenceTicket({ products: [ligne(20)], total_ticket: 45.33, total_remises: 0 });
    expect(r.niveau).toBe(NIVEAU_BLOCAGE);
  });
});

describe('controlerCoherenceTicket — nombre d\'articles', () => {
  it('31 lignes lues contre 20 articles imprimés -> blocage (doublons hallucinés)', () => {
    const produits = Array.from({ length: 31 }, () => ligne(1));
    const r = controlerCoherenceTicket({ products: produits, nombre_articles: 20 });
    expect(r.articlesLus).toBe(31);
    expect(r.articlesTicket).toBe(20);
    expect(r.niveau).toBe(NIVEAU_BLOCAGE);
    expect(r.motifs).toContain(MOTIF_ARTICLES);
  });

  // Un pourcentage seul ne suffit pas sur de petits nombres : +1 article sur
  // un ticket de 5 fait 20 % et refuserait l'import. D'où un plancher absolu
  // de 3 articles en trop avant que le contrôle du compte ne dise quoi que ce
  // soit. Alerter sur du banal rendrait le bandeau invisible le jour du vrai
  // problème.
  it('1 ou 2 articles de trop : on se tait, quel que soit le pourcentage', () => {
    for (const [lignes, imprimes] of [[21, 20], [22, 20], [6, 5], [7, 5]]) {
      const produits = Array.from({ length: lignes }, () => ligne(1));
      const r = controlerCoherenceTicket({ products: produits, nombre_articles: imprimes });
      expect(r.niveau).toBe(NIVEAU_OK);
      expect(r.ecartArticles).toBeNull();
    }
  });

  it('3 articles de trop : le contrôle s\'applique de nouveau', () => {
    const produits = Array.from({ length: 23 }, () => ligne(1));
    const r = controlerCoherenceTicket({ products: produits, nombre_articles: 20 });
    expect(r.ecartArticles).toBeCloseTo(0.15, 6);
    expect(r.niveau).toBe(NIVEAU_BLOCAGE);
  });

  // Le SOUS-comptage est volontairement ignoré : lignes au poids, articles
  // regroupés, tickets qui comptent autrement. En faire un blocage refuserait
  // des lectures parfaitement bonnes — et une lecture vraiment incomplète se
  // voit déjà sur le montant.
  it('LIRE MOINS d\'articles que le ticket n\'en annonce ne déclenche rien', () => {
    const r = controlerCoherenceTicket({ products: [ligne(45.33, 12)], nombre_articles: 20 });
    expect(r.articlesLus).toBe(12);
    expect(r.niveau).toBe(NIVEAU_OK);
    expect(r.ecartArticles).toBeNull();
  });

  it('le pire des deux motifs l\'emporte', () => {
    const produits = Array.from({ length: 31 }, () => ligne(1.4626)); // ~45,33 € au total
    const r = controlerCoherenceTicket({ products: produits, total_ticket: 45.33, total_remises: 0, nombre_articles: 20 });
    expect(r.motifs).toEqual([MOTIF_ARTICLES]); // le montant colle, pas le compte
    expect(r.niveau).toBe(NIVEAU_BLOCAGE);
  });
});

describe('controlerCoherenceTicket — on ne refuse que ce qu\'on a mesuré', () => {
  it('total illisible ET nombre d\'articles illisible : aucun contrôle, rien n\'est bloqué', () => {
    const r = controlerCoherenceTicket({ products: [ligne(115.45)] });
    expect(r.niveau).toBe(NIVEAU_OK);
    expect(r.mesurable).toBe(false);
    expect(r.ecartMontant).toBeNull();
    expect(r.ecartArticles).toBeNull();
  });

  it('total illisible mais articles lisibles : le contrôle articles s\'applique seul', () => {
    const produits = Array.from({ length: 31 }, () => ligne(1));
    const r = controlerCoherenceTicket({ products: produits, total_ticket: null, total_remises: 0, nombre_articles: 20 });
    expect(r.mesurable).toBe(true);
    expect(r.ecartMontant).toBeNull();
    expect(r.niveau).toBe(NIVEAU_BLOCAGE);
  });

  it('une valeur absurde (0, négative, texte) est traitée comme illisible', () => {
    for (const total of [0, -5, 'abc', '', null, undefined]) {
      const r = controlerCoherenceTicket({ products: [ligne(115.45)], total_ticket: total, total_remises: 0 });
      expect(r.totalTicket).toBeNull();
      expect(r.niveau).toBe(NIVEAU_OK);
    }
  });

  it('ne plante jamais, même sans argument', () => {
    expect(() => controlerCoherenceTicket()).not.toThrow();
    expect(controlerCoherenceTicket().niveau).toBe(NIVEAU_OK);
  });
});

// ── Chantier 108c — les remises ─────────────────────────────────────────────
// Les lignes portent des prix AVANT remise, le total imprimé est APRÈS remise.
// Sans déduction, tout ticket en promotion déclenchait une alerte injustifiée —
// et une alerte qui se trompe souvent est une alerte qu'on apprend à ignorer.
describe('controlerCoherenceTicket — remises', () => {
  // LE cas réel du 108c, chiffres exacts du ticket Netto du 18/08 :
  // 20 lignes à 47,22 € (prix avant remise), remise « 2+1 PRINGLES » de 1,89 €,
  // total imprimé 45,33 €. 47,22 - 1,89 = 45,33, au centime.
  it('le ticket Netto avec sa remise imprimée : AUCUNE alerte, écart nul', () => {
    const r = controlerCoherenceTicket({
      products: [ligne(47.22)],
      total_ticket: 45.33,
      total_remises: 1.89,
      nombre_articles: 20,
    });
    expect(r.niveau).toBe(NIVEAU_OK);
    expect(r.remises).toBe(1.89);
    expect(r.sommeApresRemises).toBeCloseTo(45.33, 6);
    expect(r.ecartMontant).toBeCloseTo(0, 6);
    expect(r.motifs).toEqual([]);
  });

  it('le MÊME ticket sans remise déduite déclencherait la fausse alerte d\'avant', () => {
    const r = controlerCoherenceTicket({ products: [ligne(47.22)], total_ticket: 45.33, total_remises: 0 });
    expect(r.niveau).toBe(NIVEAU_AVERTISSEMENT); // ~4,2 % — exactement ce qui a été constaté
  });

  // Deuxième cas demandé : remises inconnues => on ne compare pas du tout.
  it('le même ticket avec total_remises à null : aucune alerte, faute de pouvoir mesurer', () => {
    const r = controlerCoherenceTicket({
      products: [ligne(47.22)],
      total_ticket: 45.33,
      total_remises: null,
      nombre_articles: 20,
    });
    expect(r.niveau).toBe(NIVEAU_OK);
    expect(r.ecartMontant).toBeNull();
    expect(r.montantNonMesure).toBe(MONTANT_REMISES_INCONNUES);
  });

  it('remises inconnues : même un écart énorme reste muet sur le montant', () => {
    // On ne saurait pas distinguer une lecture ratée d'une promotion non comptée.
    const r = controlerCoherenceTicket({ products: [ligne(115.45)], total_ticket: 45.33 });
    expect(r.ecartMontant).toBeNull();
    expect(r.montantNonMesure).toBe(MONTANT_REMISES_INCONNUES);
    expect(r.niveau).toBe(NIVEAU_OK);
  });

  it('le contrôle des ARTICLES, lui, reste actif même sans remises connues', () => {
    const produits = Array.from({ length: 31 }, () => ligne(1));
    const r = controlerCoherenceTicket({ products: produits, total_ticket: 45.33, nombre_articles: 20 });
    expect(r.montantNonMesure).toBe(MONTANT_REMISES_INCONNUES);
    expect(r.niveau).toBe(NIVEAU_BLOCAGE); // le sur-comptage suffit à refuser
    expect(r.mesurable).toBe(true);
  });

  it('total absent : c\'est le total qui manque, pas les remises', () => {
    const r = controlerCoherenceTicket({ products: [ligne(47.22)], total_remises: 1.89 });
    expect(r.montantNonMesure).toBe(MONTANT_SANS_TOTAL);
    expect(r.niveau).toBe(NIVEAU_OK);
  });

  it('une remise est une magnitude : le signe rendu par le modèle n\'a pas d\'importance', () => {
    const positif = controlerCoherenceTicket({ products: [ligne(47.22)], total_ticket: 45.33, total_remises: 1.89 });
    const negatif = controlerCoherenceTicket({ products: [ligne(47.22)], total_ticket: 45.33, total_remises: -1.89 });
    expect(negatif.remises).toBe(1.89);
    expect(negatif.ecartMontant).toBeCloseTo(positif.ecartMontant, 9);
  });

  it('une remise illisible est traitée comme inconnue, jamais comme zéro', () => {
    for (const valeur of ['abc', '', undefined]) {
      const r = controlerCoherenceTicket({ products: [ligne(47.22)], total_ticket: 45.33, total_remises: valeur });
      expect(r.remises).toBeNull();
      expect(r.montantNonMesure).toBe(MONTANT_REMISES_INCONNUES);
    }
  });

  it('remise nulle explicite (ticket sans promotion) : le contrôle du montant s\'applique', () => {
    const r = controlerCoherenceTicket({ products: [ligne(115.45)], total_ticket: 45.33, total_remises: 0 });
    expect(r.niveau).toBe(NIVEAU_BLOCAGE);
    expect(r.montantNonMesure).toBeNull();
  });
});

describe('controlerDateTicket', () => {
  const AUJOURDHUI = new Date(2026, 7, 18); // 18 août 2026

  it('une date du jour ou récente passe sans rien demander', () => {
    expect(controlerDateTicket('2026-08-18', AUJOURDHUI).suspecte).toBe(false);
    expect(controlerDateTicket('2026-07-20', AUJOURDHUI).suspecte).toBe(false);
  });

  // LE cas réel : date lue sur le numéro de téléphone du magasin
  // (04.96.20.32.10 -> 20 avril 2009).
  it('le ticket Netto daté de 2009 -> confirmation demandée, date du jour proposée', () => {
    const r = controlerDateTicket('2009-04-20', AUJOURDHUI);
    expect(r.suspecte).toBe(true);
    expect(r.raison).toBe(DATE_TROP_ANCIENNE);
    expect(r.dateProposee).toBe('2026-08-18');
    expect(r.dateLue).toBe('2009-04-20');
  });

  it('une date dans le futur -> confirmation demandée', () => {
    const r = controlerDateTicket('2026-08-19', AUJOURDHUI);
    expect(r.suspecte).toBe(true);
    expect(r.raison).toBe(DATE_FUTURE);
    expect(r.dateProposee).toBe('2026-08-18');
  });

  it('la frontière des 90 jours', () => {
    expect(controlerDateTicket('2026-05-20', AUJOURDHUI).suspecte).toBe(false); // 90 j pile
    expect(controlerDateTicket('2026-05-19', AUJOURDHUI).suspecte).toBe(true);  // 91 j
  });

  it('date absente ou illisible : rien à signaler, on n\'invente pas', () => {
    for (const valeur of [null, undefined, '', '  ', 'hier', '20/04/2009', '2009-13-45', '2009-02-31']) {
      const r = controlerDateTicket(valeur, AUJOURDHUI);
      expect(r.suspecte).toBe(false);
      expect(r.dateProposee).toBe('2026-08-18');
    }
  });

  it('pas de faux « demain » à cause du fuseau horaire', () => {
    // dateDuJourIso lit l'heure LOCALE ; la comparaison se fait à midi UTC.
    const minuitJuste = new Date(2026, 7, 18, 0, 0, 0);
    const tardLeSoir = new Date(2026, 7, 18, 23, 59, 59);
    expect(dateDuJourIso(minuitJuste)).toBe('2026-08-18');
    expect(dateDuJourIso(tardLeSoir)).toBe('2026-08-18');
    expect(controlerDateTicket('2026-08-18', minuitJuste).suspecte).toBe(false);
    expect(controlerDateTicket('2026-08-18', tardLeSoir).suspecte).toBe(false);
  });
});
