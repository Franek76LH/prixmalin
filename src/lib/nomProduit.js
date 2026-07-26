// Nom composé d'une variante produit : marque + libellé + quantité, avec
// repli sur produits.nom_reference si la variante n'a aucun de ces champs
// (ex : proposition sans variante). Partagé entre App.jsx (fiche de
// correction, bout 1 du chantier "Scan code-barres") et les écrans admin qui
// affichent la même information à partir d'une source de données différente.
export function nomComposeVariante(v) {
  const marque = v.marques?.nom ? `${v.marques.nom} ` : '';
  const libelle = v.libelle || '';
  const quantite = (v.quantite_nette != null && v.unite_quantite) ? ` ${v.quantite_nette}${v.unite_quantite}` : '';
  const compose = `${marque}${libelle}${quantite}`.trim();
  return compose || (v.produits?.nom_reference ?? 'Produit sans nom');
}
