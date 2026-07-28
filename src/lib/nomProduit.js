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

function formatNombreFR(n) {
  const num = Number(n);
  if (Number.isInteger(num)) return String(num);
  return num.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

// Quantité affichée proprement à partir des champs structurés uniquement
// (quantite_nette, unite_quantite, nombre_unites) — jamais `libelle`.
// kg < 1 -> grammes ("500 g") ; l < 1 -> centilitres ("33 cl", plus lisible
// que "330 ml" pour ces quantités) ; sinon l'unité telle quelle.
function formatQuantiteEtiquette(v) {
  const qte = v?.quantite_nette != null ? Number(v.quantite_nette) : null;
  const unite = (v?.unite_quantite || '').toLowerCase().trim();
  if (qte == null || !Number.isFinite(qte) || !unite) return null;

  let base;
  if (unite === 'kg') {
    base = qte < 1 ? `${formatNombreFR(Math.round(qte * 1000))} g` : `${formatNombreFR(qte)} kg`;
  } else if (unite === 'l') {
    base = qte < 1 ? `${formatNombreFR(Math.round(qte * 100))} cl` : `${formatNombreFR(qte)} L`;
  } else if (unite === 'pièce' || unite === 'piece') {
    base = `${formatNombreFR(qte)} pièce${qte > 1 ? 's' : ''}`;
  } else {
    base = `${formatNombreFR(qte)} ${unite}`;
  }

  const n = Number(v?.nombre_unites) || 1;
  return n > 1 ? `${n} × ${base}` : base;
}

// Chantier 74.1 — étiquette d'un bouton de format : UNIQUEMENT la marque
// (marque_id -> marques.nom) et la quantité structurée, jamais `libelle`
// (texte hérité incohérent : "- 500g", "N°133 - 500g", "Bio - 500g", et des
// doublons "1 kg" entre marques différentes). Distincte de nomComposeVariante
// ci-dessus (qui reste inchangée, utilisée par le chantier "Scan
// code-barres") : à utiliser partout où une variante est proposée à la
// sélection (Ajouter/Modifier un article, correction d'une ligne de ticket).
export function formatEtiquetteVariante(v) {
  const marque = v?.marques?.nom || null;
  const quantite = formatQuantiteEtiquette(v);
  if (marque && quantite) return `${marque} · ${quantite}`;
  if (marque) return marque;
  if (quantite) return quantite;
  return v?.produits?.nom_reference || 'Variante';
}
