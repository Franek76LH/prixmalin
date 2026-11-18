// Chantier 148 — promotions, étape 1 : COMPRENDRE une offre.
//
// Principe décidé avec François (28/07 puis 18/11) : deux informations, jamais
// confondues.
//   - le PRIX NORMAL d'un article : c'est lui que le comparateur et les courbes
//     utilisent ;
//   - l'OFFRE : la mécanique (« 2+1 offert », « le 2e à −50 % », « −1 € »).
// Un prix « mélangé » (2,43 € les deux paquets à 1,84 €) ne devient JAMAIS le
// prix du produit.
//
// Ce fichier ne fait que du calcul, sans rien lire ni écrire : il transforme le
// texte imprimé sous un article en une mécanique, et dit ce que l'article
// revient à payer selon la quantité achetée.
//
// ⚠️ Les formats de texte reconnus ci-dessous viennent des intitulés courants
// des tickets français. Ils n'ont PAS encore été vérifiés sur de vrais tickets
// avec promotion (aucun n'est en base au 18/11) : à étalonner avant de s'y fier.

export const OFFRE_LOT_GRATUIT = 'lot_gratuit';     // 2 achetés + 1 offert
export const OFFRE_NIEME_REMISE = 'nieme_remise';   // le 2e à −50 %
export const OFFRE_POURCENTAGE = 'pourcentage';     // −30 % sur l'article
export const OFFRE_MONTANT = 'montant';             // −1,00 € sur la ligne
export const OFFRE_INCONNUE = 'inconnue';           // une remise, mais règle illisible

const arrondi = (n) => Math.round(n * 100) / 100;
const prixFr = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;
const propre = (texte) => String(texte ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const nombre = (texte) => Number(String(texte).replace(',', '.'));

// Lit la mécanique dans le texte imprimé (et, à défaut, dans le montant de la
// remise). Rend null s'il n'y a ni texte parlant ni remise.
export function lireOffre(libelle, montantRemise = 0) {
  const t = propre(libelle);
  const remise = Number(montantRemise) > 0 ? arrondi(Number(montantRemise)) : 0;
  let m;

  // « 2+1 offert », « 2 + 1 gratuit », « 3+1 »
  if ((m = t.match(/\b(\d)\s*\+\s*(\d)\b/)) && Number(m[1]) >= 1 && Number(m[2]) >= 1) {
    return { type: OFFRE_LOT_GRATUIT, achetes: Number(m[1]), offerts: Number(m[2]) };
  }
  // « 3 pour 2 », « 3 pour le prix de 2 »
  if ((m = t.match(/\b(\d)\s*pour\s*(?:le prix de\s*)?(\d)\b/)) && Number(m[1]) > Number(m[2]) && Number(m[2]) >= 1) {
    return { type: OFFRE_LOT_GRATUIT, achetes: Number(m[2]), offerts: Number(m[1]) - Number(m[2]) };
  }
  // « le 2e à −50 % », « 2eme a -50% », « −60 % sur le 2ème », « 3e a 100% »
  const rang = t.match(/\b([23])\s*(?:e|eme|em|nd|d)\b/);
  const pct = t.match(/-?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/);
  if (rang && pct && nombre(pct[1]) > 0 && nombre(pct[1]) <= 100) {
    return { type: OFFRE_NIEME_REMISE, rang: Number(rang[1]), pourcentage: nombre(pct[1]) };
  }
  // « le 2e offert », « 2eme gratuit »
  if (rang && /offert|gratuit/.test(t)) {
    return { type: OFFRE_LOT_GRATUIT, achetes: Number(rang[1]) - 1, offerts: 1 };
  }
  // « remise 30 % », « −30 % »
  if (pct && nombre(pct[1]) > 0 && nombre(pct[1]) < 100) {
    return { type: OFFRE_POURCENTAGE, pourcentage: nombre(pct[1]) };
  }
  // Un montant, sans règle lisible.
  if (remise > 0) {
    return /remise|reduction|promo|offre|avantage/.test(t) || t === ''
      ? { type: OFFRE_MONTANT, montant: remise }
      : { type: OFFRE_INCONNUE, montant: remise };
  }
  return null;
}

// Combien d'articles faut-il prendre pour que l'offre joue ?
export function quantiteRequise(offre) {
  if (!offre) return 1;
  if (offre.type === OFFRE_LOT_GRATUIT) return offre.achetes + offre.offerts;
  if (offre.type === OFFRE_NIEME_REMISE) return offre.rang;
  return 1;
}

// Total réellement payé pour `quantite` articles au prix normal `prixNormal`.
// Quantité insuffisante : prix normal, sans remise (c'est le garde-fou).
export function totalAvecOffre(prixNormal, offre, quantite = 1) {
  const prix = Number(prixNormal);
  const q = Math.max(1, Math.floor(Number(quantite) || 1));
  if (!(prix > 0)) return null;
  const plein = prix * q;
  if (!offre) return arrondi(plein);
  switch (offre.type) {
    case OFFRE_LOT_GRATUIT: {
      const lots = Math.floor(q / (offre.achetes + offre.offerts));
      return arrondi(plein - lots * offre.offerts * prix);
    }
    case OFFRE_NIEME_REMISE: {
      const fois = Math.floor(q / offre.rang);
      return arrondi(plein - fois * prix * (offre.pourcentage / 100));
    }
    case OFFRE_POURCENTAGE:
      return arrondi(plein * (1 - offre.pourcentage / 100));
    case OFFRE_MONTANT:
      return arrondi(Math.max(0, plein - offre.montant));
    default:
      return arrondi(plein); // règle inconnue : on ne devine pas
  }
}

// Ce que revient à payer UN article, selon la quantité achetée.
export function prixUnitaireAvecOffre(prixNormal, offre, quantite = 1) {
  const total = totalAvecOffre(prixNormal, offre, quantite);
  const q = Math.max(1, Math.floor(Number(quantite) || 1));
  return total == null ? null : arrondi(total / q);
}

// L'offre lue correspond-elle à la remise réellement imprimée sur le ticket ?
// (à 2 centimes près). Sert à ne garder que les offres bien comprises.
export function offreConfirmeeParLeTicket(prixNormal, offre, quantite, montantRemise) {
  const total = totalAvecOffre(prixNormal, offre, quantite);
  const remise = Number(montantRemise);
  if (total == null || !(remise > 0)) return false;
  return Math.abs((Number(prixNormal) * Math.max(1, Math.floor(Number(quantite) || 1)) - total) - remise) <= 0.02;
}

// Intitulé court de l'offre.
export function titreOffre(offre) {
  if (!offre) return '';
  switch (offre.type) {
    case OFFRE_LOT_GRATUIT:
      return offre.offerts === 1
        ? `${offre.achetes} acheté${offre.achetes > 1 ? 's' : ''}, le ${offre.achetes + 1}e offert`
        : `${offre.achetes} achetés, ${offre.offerts} offerts`;
    case OFFRE_NIEME_REMISE:
      return offre.pourcentage >= 100 ? `Le ${offre.rang}e offert` : `Le ${offre.rang}e à −${offre.pourcentage} %`;
    case OFFRE_POURCENTAGE: return `−${offre.pourcentage} %`;
    case OFFRE_MONTANT: return `−${prixFr(offre.montant)}`;
    default: return 'Remise';
  }
}

// La phrase complète, avec le garde-fou : ce que ça revient à payer si on en
// prend assez, et le rappel du prix normal si on n'en prend qu'un.
export function phraseOffre(offre, prixNormal) {
  if (!offre) return '';
  const titre = titreOffre(offre);
  const requis = quantiteRequise(offre);
  const reel = prixUnitaireAvecOffre(prixNormal, offre, requis);
  if (reel == null || offre.type === OFFRE_INCONNUE) return `${titre}.`;
  if (requis <= 1) return `${titre} : ${prixFr(reel)} au lieu de ${prixFr(prixNormal)}.`;
  return `${titre} : ${prixFr(reel)} l'unité si tu en prends ${requis}. Un seul : prix normal, ${prixFr(prixNormal)}.`;
}
