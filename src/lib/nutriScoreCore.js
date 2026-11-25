// Chantier 178 — Nutri-Score (lettre A à E, venue d'Open Food Facts au scan
// du code-barres, colonne variantes_produit.nutri_score). Module pur.
//
// Le Nutri-Score est porté par une VARIANTE (une marque, un format) : deux
// chips de marques différentes n'ont pas la même note. Une fiche générique
// (« Chips nature ») n'a donc pas UNE lettre : on montre la lettre de la
// variante choisie, sinon l'éventail des lettres connues (« de B à D »).

export const LETTRES_NUTRI = ['A', 'B', 'C', 'D', 'E'];

// Couleurs habituelles du Nutri-Score, du vert foncé au rouge orangé.
export const COULEURS_NUTRI = {
  A: { fond: '#038141', texte: '#fff' },
  B: { fond: '#85BB2F', texte: '#fff' },
  C: { fond: '#FECB02', texte: '#1a1a1a' },
  D: { fond: '#EE8100', texte: '#fff' },
  E: { fond: '#E63E11', texte: '#fff' },
};

export function lettreNutri(valeur) {
  const l = String(valeur ?? '').trim().toUpperCase();
  return LETTRES_NUTRI.includes(l) ? l : null;
}

// Résumé pour une liste de variantes : une seule lettre si toutes celles qui
// sont notées ont la même, sinon la plus favorable et la moins favorable.
// Renvoie aussi combien de variantes sont notées, pour ne rien inventer.
export function resumeNutri(variantes) {
  const lettres = (Array.isArray(variantes) ? variantes : []).map(v => lettreNutri(v?.nutri_score)).filter(Boolean);
  if (lettres.length === 0) return null;
  const tri = [...lettres].sort();
  return { min: tri[0], max: tri[tri.length - 1], nbNotees: lettres.length, nbTotal: Array.isArray(variantes) ? variantes.length : 0 };
}
