// Chantier 214 (143-A, côté app) — copie de la règle de confiance de la base
// (`public.peut_valider_soi_meme`, chantier 208). La BASE fait foi : cette
// copie ne sert qu'à afficher (ex. « tes scans sont vérifiés par la
// communauté ») et à choisir d'avance le bon chemin du scan. Elle n'accorde
// jamais un droit : si elle se trompe, la base refuse (VERIFICATION_REQUISE).
//
// Règle (décisions de François, 18/11 et 26/11) : un compte peut valider
// lui-même ses scans s'il est admin, ou testeur de confiance (sauf compte
// suspendu), ou s'il a À LA FOIS au moins 300 points validés, un compte créé
// depuis au moins 7 jours, et des tickets scannés sur au moins 3 jours
// différents. Les trois seuils sont des réglages de `parametres_globaux`.

export const SEUILS_CONFIANCE_DEFAUT = Object.freeze({ points: 300, anciennete: 7, joursTickets: 3 });

export const CLES_REGLAGES_CONFIANCE = Object.freeze({
  points: 'confiance_points_min',
  anciennete: 'confiance_anciennete_jours',
  joursTickets: 'confiance_jours_tickets_min',
});

const JOUR_MS = 24 * 60 * 60 * 1000;

function entierPositif(v, defaut) {
  if (v === null || v === undefined || v === '') return defaut;
  const n = Number(String(v).trim());
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : defaut;
}

// Réglages lus dans parametres_globaux ({ cle: valeur } ou lignes { cle, valeur })
// → seuils. Réglage absent ou illisible → valeur par défaut, comme en base.
export function seuilsConfiance(reglages) {
  let r = reglages;
  if (Array.isArray(reglages)) r = Object.fromEntries(reglages.filter(x => x && x.cle).map(x => [x.cle, x.valeur]));
  r = r && typeof r === 'object' ? r : {};
  return {
    points: entierPositif(r[CLES_REGLAGES_CONFIANCE.points], SEUILS_CONFIANCE_DEFAUT.points),
    anciennete: entierPositif(r[CLES_REGLAGES_CONFIANCE.anciennete], SEUILS_CONFIANCE_DEFAUT.anciennete),
    joursTickets: entierPositif(r[CLES_REGLAGES_CONFIANCE.joursTickets], SEUILS_CONFIANCE_DEFAUT.joursTickets),
  };
}

// Jours écoulés depuis la création du compte (entier, arrondi vers le bas).
// Date absente ou illisible → null.
export function joursDepuis(dateIso, maintenant = new Date()) {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  const m = maintenant instanceof Date ? maintenant : new Date(maintenant);
  if (Number.isNaN(d.getTime()) || Number.isNaN(m.getTime())) return null;
  return Math.floor((m.getTime() - d.getTime()) / JOUR_MS);
}

// Pure. Rend { ok, raison, manque } :
//   raison : 'admin' | 'testeur' | 'regle' | 'suspendu' | 'pas_encore'
//   manque : ce qui reste à atteindre (points, jours, joursTickets), pour un
//            éventuel message d'encouragement ; vide quand ok.
export function peutValiderSoiMeme({
  estAdmin = false,
  estTesteur = false,
  estSuspendu = false,
  pointsValides = 0,
  compteCreeLe = null,
  joursTickets = 0,
  seuils = SEUILS_CONFIANCE_DEFAUT,
  maintenant = new Date(),
} = {}) {
  if (estAdmin === true) return { ok: true, raison: 'admin', manque: {} };
  if (estSuspendu === true) return { ok: false, raison: 'suspendu', manque: {} };
  if (estTesteur === true) return { ok: true, raison: 'testeur', manque: {} };

  const s = seuils && typeof seuils === 'object' ? { ...SEUILS_CONFIANCE_DEFAUT, ...seuils } : SEUILS_CONFIANCE_DEFAUT;
  const points = Number.isFinite(Number(pointsValides)) ? Number(pointsValides) : 0;
  const jours = joursDepuis(compteCreeLe, maintenant);
  const nbJoursTickets = Number.isFinite(Number(joursTickets)) ? Number(joursTickets) : 0;

  const manque = {};
  if (points < s.points) manque.points = s.points - points;
  if (jours === null || jours < s.anciennete) manque.jours = s.anciennete - (jours ?? 0);
  if (nbJoursTickets < s.joursTickets) manque.joursTickets = s.joursTickets - nbJoursTickets;

  const ok = Object.keys(manque).length === 0;
  return { ok, raison: ok ? 'regle' : 'pas_encore', manque };
}
