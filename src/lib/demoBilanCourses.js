// Chantier 163 — démo du Bilan de courses, pour l'essayer sans courses réelles.
// Ouverte par l'adresse « …/?demo=bilan ». Données fictives, en mémoire
// seulement : RIEN n'est lu ni écrit dans la base, rien à effacer ensuite.
// Reprend le scénario de François (steak non trouvé, poulet à la place) et
// les cas du diagnostic : achat partiel + paquet ajouté depuis, autre format,
// coché absent du ticket, ligne du ticket non reconnue, article pas pris.

export function demoDemandee(search) {
  try { return new URLSearchParams(String(search || '')).get('demo') === 'bilan'; } catch { return false; }
}

const art = (cle, nom, { quantite = 1, etat = 'a_prendre', varianteListe = null, achat } = {}) => ({
  cle, type: 'caddie', produit_id: `demo-${cle}`, variante_produit_id: varianteListe, variante_liste: varianteListe,
  nom_affiche: nom, nom_reference: nom, quantite, prix_prevu: null, etat, coche_le: null,
  rayon: { categorie_ordre: 1, categorie_nom: 'Démo', sous_categorie_nom: null },
  ...(achat ? { achat } : {}),
});
const ligne = (produit, variante, quantite, prix, libelle) => ({ produit_id: produit, variante_produit_id: variante, quantite, prix_unitaire: prix, libelle });

export const SESSION_DEMO_BILAN = {
  version: 1, id: 'demo-bilan', statut: 'active', utilisateur_id: 'demo',
  magasin: { magasin_id: 'demo', nom: 'Leclerc (démo)' },
  ticket_total_reel: 21.53,
  articles: [
    art('steak', 'Steak haché', { etat: 'introuvable' }),
    art('pates', 'Pâtes', { quantite: 2, etat: 'au_caddie' }),
    art('lait', 'Lait demi-écrémé 1 L', { etat: 'au_caddie', varianteListe: 'demo-lait-1L' }),
    art('beurre', 'Beurre doux', { etat: 'au_caddie', achat: 'a_verifier' }),
    art('cafe', 'Café en dosettes'),
    art('yaourt', 'Yaourts nature', { quantite: 2, etat: 'au_caddie' }),
  ],
  ticket_lignes: [
    ligne('demo-pates', null, 1, 0.89, 'PATES TORSADES 500G'),
    ligne('demo-lait', 'demo-lait-6x1L', 1, 5.70, 'LAIT DEMI ECR 6X1L'),
    ligne('demo-yaourt', null, 1, 1.45, 'YAOURT NAT X4'),
    ligne('demo-yaourt', null, 1, 1.45, 'YAOURT NAT X4'),
    ligne('demo-poulet', null, 1, 6.90, 'POULET FERMIER'),
    ligne('demo-chocolat', null, 1, 2.99, 'CHOCOLAT NOIR 70%'),
    { produit_id: null, variante_produit_id: null, quantite: 1, prix_unitaire: 2.15, libelle: 'PROMO DIV' },
  ],
};

// Ma liste au moment de terminer : les pâtes sont passées de 2 à 3 (un
// paquet ajouté pour un autre repas) ; le riz n'est pas dans ces courses.
export const LISTE_DEMO_BILAN = [
  { id: 'steak', qty: 1 }, { id: 'pates', qty: 3 }, { id: 'lait', qty: 1 }, { id: 'beurre', qty: 1 },
  { id: 'cafe', qty: 1 }, { id: 'yaourt', qty: 2 }, { id: 'riz', qty: 1, nom: 'Riz (pour la semaine prochaine)' },
];
