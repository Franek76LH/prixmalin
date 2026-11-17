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

export { prixFr };
