// Chantier 145 — évolution du prix de MES produits et baisses notables.
// Les chiffres viennent de la fonction evolution_de_mes_prix() (lecture seule,
// par variante : jamais deux formats mélangés). Ici : rien que de la mise en
// forme, testée seule.

const prixFr = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

// Liste propre : on ne garde que les produits qui ont au moins deux relevés
// lisibles (un seul point ne fait pas une courbe).
export function produitsSuivis(reponse) {
  if (!Array.isArray(reponse)) return [];
  return reponse
    .map(p => ({
      ...p,
      points: (Array.isArray(p?.points) ? p.points : [])
        .map(pt => ({ d: pt?.d, p: Number(pt?.p), m: pt?.m || null }))
        .filter(pt => pt.d && Number.isFinite(pt.p) && pt.p > 0 && !Number.isNaN(new Date(pt.d).getTime())),
    }))
    .filter(p => p?.variante_id && p?.produit && p.points.length >= 2);
}

// Les produits en baisse, la plus forte d'abord.
export function produitsEnBaisse(reponse) {
  return produitsSuivis(reponse)
    .filter(p => p.baisse && Number(p.baisse.pct) > 0)
    .sort((a, b) => Number(b.baisse.pct) - Number(a.baisse.pct));
}

// « Emmental râpé · Président · 200 g »
export function libelleProduit(p) {
  return [p?.produit, p?.marque, p?.format].filter(Boolean).join(' · ');
}

// Phrase de la baisse : ce qui a baissé, de combien, où.
export function phraseBaisse(p) {
  const b = p?.baisse;
  if (!b) return '';
  const ou = b.magasin ? ` chez ${b.magasin}` : '';
  return `${prixFr(b.avant)} → ${prixFr(b.apres)}${ou} (−${Math.round(Number(b.pct))} %)`;
}

// Titre de l'alerte de l'accueil.
export function titreAlerteBaisse(enBaisse) {
  const n = enBaisse.length;
  if (n === 0) return '';
  if (n === 1) return `${enBaisse[0].produit} a baissé`;
  return `${n} de tes produits ont baissé`;
}

// Premier et dernier prix relevés, et écart entre les deux.
export function resumeCourbe(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const premier = points[0], dernier = points[points.length - 1];
  const prix = points.map(pt => pt.p);
  return {
    premier: premier.p, dernier: dernier.p,
    mini: Math.min(...prix), maxi: Math.max(...prix),
    ecart: Math.round((dernier.p - premier.p) * 100) / 100,
  };
}

// Coordonnées de la courbe dans un cadre largeur × hauteur (marge comprise).
// Les points sont espacés selon leur DATE (deux relevés le même jour se
// superposent au lieu de s'étaler). Prix tous égaux : une ligne à mi-hauteur.
export function traceCourbe(points, largeur = 280, hauteur = 70, marge = 8) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const temps = points.map(pt => new Date(pt.d).getTime());
  const prix = points.map(pt => pt.p);
  const t0 = Math.min(...temps), t1 = Math.max(...temps);
  const p0 = Math.min(...prix), p1 = Math.max(...prix);
  return points.map((pt, i) => ({
    x: Math.round((marge + (t1 === t0 ? (points.length === 1 ? 0.5 : i / (points.length - 1)) : (temps[i] - t0) / (t1 - t0)) * (largeur - 2 * marge)) * 10) / 10,
    y: Math.round((p1 === p0 ? hauteur / 2 : hauteur - marge - ((pt.p - p0) / (p1 - p0)) * (hauteur - 2 * marge)) * 10) / 10,
    ...pt,
  }));
}

// ── Chantier 146 — une courbe par MAGASIN ───────────────────────────────────
// Les prix varient d'un magasin à l'autre : relier sur une même ligne des
// relevés de magasins différents dessinait des écarts entre magasins, pas une
// évolution. Une courbe ne montre donc qu'un magasin à la fois.

const nomMagasin = (pt) => pt?.m || 'Magasin inconnu';

// Les magasins où ce produit a été relevé : celui qui a le plus de relevés
// d'abord (à égalité, le relevé le plus récent), avec son dernier prix.
export function magasinsDuProduit(points) {
  const parNom = new Map();
  for (const pt of Array.isArray(points) ? points : []) {
    const nom = nomMagasin(pt);
    const m = parNom.get(nom) || { nom, nb: 0, dernier: null, dernierLe: 0 };
    const t = new Date(pt.d).getTime();
    m.nb += 1;
    if (t >= m.dernierLe) { m.dernierLe = t; m.dernier = pt.p; }
    parNom.set(nom, m);
  }
  return [...parNom.values()].sort((a, b) => (b.nb - a.nb) || (b.dernierLe - a.dernierLe) || a.nom.localeCompare(b.nom, 'fr'));
}

export function pointsDuMagasin(points, nom) {
  return (Array.isArray(points) ? points : []).filter(pt => nomMagasin(pt) === nom);
}

// Le magasin montré d'abord : celui de la baisse s'il y en a une, sinon celui
// qui a le plus de relevés.
export function magasinParDefaut(p) {
  const magasins = magasinsDuProduit(p?.points);
  if (magasins.length === 0) return null;
  const deLaBaisse = p?.baisse?.magasin;
  return (deLaBaisse && magasins.some(m => m.nom === deLaBaisse)) ? deLaBaisse : magasins[0].nom;
}

// Où ce produit est le moins cher d'après le DERNIER relevé de chaque magasin.
export function moinsCherAujourdhui(points) {
  const magasins = magasinsDuProduit(points).filter(m => m.dernier != null);
  if (magasins.length < 2) return null;
  const meilleur = [...magasins].sort((a, b) => a.dernier - b.dernier)[0];
  return { magasin: meilleur.nom, prix: meilleur.dernier };
}

// ── L'alerte de l'accueil : seulement mes HABITUDES ─────────────────────────
// Un produit acheté une seule fois n'est pas une habitude (demande de François :
// « un produit que tu as l'habitude d'acheter »).
export const ACHATS_POUR_UNE_HABITUDE = 2;

export function alertesBaisse(reponse) {
  return produitsEnBaisse(reponse).filter(p => Number(p.nb_achats) >= ACHATS_POUR_UNE_HABITUDE);
}

// ── Exemple de démonstration (serveur de test uniquement) ───────────────────
// Sert à VOIR l'alerte verte sans rien écrire dans la base, qui est la même que
// celle de la prod. Marqué « exemple » partout où il s'affiche.
export const EXEMPLE_BAISSE = Object.freeze({
  variante_id: 'exemple-baisse', exemple: true,
  produit: 'Emmental râpé', marque: 'Exemple', format: '200 g', nb: 6, nb_achats: 3,
  baisse: { avant: 1.95, apres: 1.64, pct: 16, magasin: 'Netto', date: '2026-11-09T10:00:00Z' },
  points: [
    { d: '2026-06-10T10:00:00Z', p: 1.89, m: 'Netto' }, { d: '2026-07-20T10:00:00Z', p: 1.95, m: 'Netto' },
    { d: '2026-08-05T10:00:00Z', p: 2.05, m: 'Carrefour' }, { d: '2026-09-02T10:00:00Z', p: 1.99, m: 'Carrefour' },
    { d: '2026-10-11T10:00:00Z', p: 1.95, m: 'Netto' }, { d: '2026-11-09T10:00:00Z', p: 1.64, m: 'Netto' },
  ],
});

// Vrai seulement sur un serveur de test (préversion Vercel ou poste local) ET
// si l'adresse demande l'exemple (?demo=baisse). Jamais sur la prod.
export function exempleDemande(hote, recherche) {
  const h = String(hote || '');
  const serveurDeTest = h.includes('-git-') || h === 'localhost' || h === '127.0.0.1';
  return serveurDeTest && new URLSearchParams(String(recherche || '')).get('demo') === 'baisse';
}

export function avecExemple(reponse, actif) {
  if (!actif) return reponse;
  return [EXEMPLE_BAISSE, ...(Array.isArray(reponse) ? reponse : [])];
}

export { prixFr };
