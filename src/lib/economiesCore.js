// Chantier 128 — calculs de l'écran « Mes économies », sortis de l'écran pour
// être testés. Une « course analysée » = des courses dont le ticket a été
// scanné et comparé au prix moyen des autres magasins (realized_saving).
// Aucune règle de calcul ne change : mêmes sommes que l'ancien EconomiesTab.

const arrondir = (n) => Math.round(n * 100) / 100;

export function coursesAnalysees(archives) {
  return (archives || []).filter(a => a?.ticket_scanned && a?.realized_saving != null);
}

// Total, nombre de courses, mois par mois (du plus récent au plus ancien),
// années présentes et meilleur mois (seulement s'il est positif).
export function bilanEconomies(archives) {
  const courses = coursesAnalysees(archives);
  const parMois = new Map();
  for (const c of courses) {
    const mois = String(c.date || '').substring(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mois)) continue;
    const m = parMois.get(mois) || { mois, total: 0, nb: 0 };
    m.total += Number(c.realized_saving) || 0;
    m.nb += 1;
    parMois.set(mois, m);
  }
  const mois = [...parMois.values()]
    .map(m => ({ ...m, total: arrondir(m.total) }))
    .sort((a, b) => b.mois.localeCompare(a.mois));
  const meilleur = [...mois].sort((a, b) => b.total - a.total)[0];
  return {
    total: arrondir(courses.reduce((s, c) => s + (Number(c.realized_saving) || 0), 0)),
    nbCourses: courses.length,
    mois,
    annees: [...new Set(mois.map(m => Number(m.mois.substring(0, 4))))].sort((a, b) => b - a),
    meilleurMois: meilleur && meilleur.total > 0 ? meilleur.mois : null,
  };
}

export function coursesDuMois(archives, mois) {
  return coursesAnalysees(archives)
    .filter(c => String(c.date || '').substring(0, 7) === mois)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// « 2026-08 » -> « Août 2026 »
export function nomDuMois(mois) {
  const [a, m] = String(mois).split('-');
  const s = new Date(Number(a), Number(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
