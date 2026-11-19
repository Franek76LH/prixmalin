// Chantier 157 — « tes achats en premier ».
// Les tickets disent ce que l'utilisateur achète pour de bon : quand plusieurs
// fiches ressemblent à ce qu'il a dit ou tapé (« yaourts »), celle qu'il a déjà
// achetée passe devant. Ici : le simple comptage, testé seul.
//
// lignes : lignes de ticket de l'utilisateur ({ produit_id }), telles que la
// base les rend (elle ne montre à chacun que ses propres tickets).
// Rend { [produit_id]: nombre de lignes }.
export function compterAchats(lignes) {
  const achats = {};
  for (const l of Array.isArray(lignes) ? lignes : []) {
    const id = l?.produit_id;
    if (typeof id === 'string' && id) achats[id] = (achats[id] || 0) + 1;
  }
  return achats;
}

export function nbAchats(achats, produitId) {
  const n = achats && produitId ? Number(achats[produitId]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
