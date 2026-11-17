// Chantier 139 — « Le défi de la communauté » (pilier communautaire, décidé le
// 17/11). Le vrai frein du comparateur, ce sont les prix récents : on en fait
// un objectif commun, avec les VRAIS chiffres (fonction stats_communaute).
//
// Règles d'honnêteté :
// - on n'affiche jamais un chiffre qu'on n'a pas (réponse absente = pas de carte) ;
// - le palier visé est toujours le prochain au-dessus du compte réel ;
// - le nombre de membres n'est montré qu'à partir de MEMBRES_MIN (à 1 ou 2,
//   ce n'est pas une communauté, c'est une confidence).

export const PALIERS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
export const MEMBRES_MIN = 5;

const entier = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// Prochain palier strictement au-dessus du compte (au-delà du dernier : le
// prochain multiple de 100 000).
export function prochainPalier(compte) {
  const n = entier(compte);
  const palier = PALIERS.find(p => p > n);
  return palier ?? (Math.floor(n / 100000) + 1) * 100000;
}

// « 2419 » -> « 2 419 »
export function nombre(n) {
  return String(entier(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Tout ce que la carte affiche, calculé ici. Rend null si les chiffres manquent.
export function defiCommunaute(stats) {
  if (!stats || typeof stats !== 'object' || stats.prix_30j == null) return null;
  const recents = entier(stats.prix_30j);
  const palier = prochainPalier(recents);
  const miens = Math.min(entier(stats.mes_prix_30j), recents);
  const membres = entier(stats.contributeurs_30j);
  return {
    recents,
    palier,
    reste: palier - recents,
    // Jamais une barre vide ni pleine : 4 % minimum, 100 % jamais atteint.
    pourcentage: Math.max(4, Math.min(99, Math.round((recents / palier) * 100))),
    miens,
    partDesMiens: recents > 0 ? Math.round((miens / recents) * 100) : 0,
    membres: membres >= MEMBRES_MIN ? membres : null,
    total: entier(stats.prix_total),
    produits: entier(stats.produits),
    magasins: entier(stats.magasins),
  };
}

// Phrase d'encouragement, selon ce que la personne a apporté ce mois-ci.
export function motPourToi(defi) {
  if (!defi) return '';
  if (defi.miens === 0) return 'Ton prochain ticket fait avancer tout le monde.';
  if (defi.miens === 1) return 'Tu as apporté 1 prix ce mois-ci. Merci !';
  return `Tu as apporté ${nombre(defi.miens)} prix ce mois-ci. Merci !`;
}

// Message après un scan réussi.
export function merciApresScan(nbPrix) {
  const n = entier(nbPrix);
  if (n === 0) return 'Ticket enregistré.';
  return `${nombre(n)} prix enregistré${n > 1 ? 's' : ''}. Merci, ${n > 1 ? 'ils aident' : 'il aide'} toute la communauté !`;
}
