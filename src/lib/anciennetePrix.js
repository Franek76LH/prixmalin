// Chantier 198 — honnêteté sur l'âge des prix. Depuis le chantier 197, le
// comparateur garde un prix 12 mois après son relevé ; au-delà de 6 mois, on
// le dit sur la ligne (« relevé il y a 8 mois ») et en tête du résultat.
export const JOURS_PRIX_ANCIEN = 183;
const JOUR = 86400000;

// Nombre de mois (arrondi vers le bas, au moins 6) si le prix a plus de
// JOURS_PRIX_ANCIEN jours, sinon null. Date absente ou illisible : null.
export function moisSiPrixAncien(date, maintenantMs = Date.now()) {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return null;
  const jours = (maintenantMs - t) / JOUR;
  if (jours <= JOURS_PRIX_ANCIEN) return null;
  return Math.max(6, Math.floor(jours / 30.44));
}

export function mentionPrixAncien(mois) {
  return mois ? `relevé il y a ${mois} mois` : null;
}

export function phrasePrixAnciens(nb) {
  if (!nb) return null;
  return nb === 1
    ? '1 prix a plus de 6 mois : il a pu changer depuis.'
    : `${nb} prix ont plus de 6 mois : ils ont pu changer depuis.`;
}
