// Chantier 157 — la marque dite au micro.
// Décision de François (19/11) : « quand je dis une marque, je veux que l'app
// compare cette marque précise ». « bière 8.6 Original » ne doit pas devenir
// « une bière » : la ligne de liste porte alors la variante de la marque dite,
// et le comparateur compare ce produit-là.
//
// Une ligne de liste ne sait retenir une marque qu'à travers UNE variante
// (marque + format). On ne choisit donc que si une seule variante s'impose ;
// au moindre doute on reste sur la fiche, toutes marques (jamais de pari).
// Les marques de distributeur ne sont jamais choisies par leur nom (règle du
// comparateur : une MDD n'existe que dans son enseigne).

const aplati = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// La marque est-elle dite en toutes lettres, mot entier ? (« 8.6 », « Coca-Cola »)
export function marqueEstDite(texte, marque) {
  const m = aplati(marque);
  return m.length >= 2 && ` ${aplati(texte)} `.includes(` ${m} `);
}

// variantes : [{ id, marque, est_mdd, libelle, quantite_nette, unite_quantite }]
// options.achatsVariantes : { [variante_id]: nombre d'achats } pour départager.
// Rend { variante, marque } ; variante = null si la marque est dite mais que
// plusieurs formats restent possibles ; null si aucune marque n'est dite.
export function varianteDite(texte, variantes, options = {}) {
  const dites = (Array.isArray(variantes) ? variantes : []).filter(v =>
    v?.id && v.marque && v.est_mdd !== true && v.quantite_nette != null && v.unite_quantite && marqueEstDite(texte, v.marque));
  if (dites.length === 0) return null;
  const marques = [...new Set(dites.map(v => aplati(v.marque)))];
  if (marques.length > 1) return null; // deux marques dites : on ne tranche pas
  const marque = dites[0].marque;
  if (dites.length === 1) return { variante: dites[0], marque };

  // Plusieurs formats de la marque : les mots du libellé dits en plus
  // (« Original », « Zéro ») départagent, sinon l'habitude d'achat.
  const mots = new Set(aplati(texte).split(' '));
  const motsMarque = new Set(aplati(marque).split(' '));
  const seulEnTete = (notes) => {
    const max = Math.max(...notes.map(n => n.note));
    const premiers = notes.filter(n => n.note === max);
    return max > 0 && premiers.length === 1 ? premiers[0].v : null;
  };
  const parLibelle = seulEnTete(dites.map(v => ({ v,
    note: [...new Set(aplati(v.libelle).split(' '))].filter(m => m.length >= 3 && !motsMarque.has(m) && mots.has(m)).length })));
  if (parLibelle) return { variante: parLibelle, marque };
  const achats = options?.achatsVariantes || {};
  const parHabitude = seulEnTete(dites.map(v => ({ v, note: Number(achats[v.id]) > 0 ? Number(achats[v.id]) : 0 })));
  return { variante: parHabitude, marque };
}

// Lignes de ticket -> { [variante_id]: nombre de lignes }.
export function compterAchatsVariantes(lignes) {
  const achats = {};
  for (const l of Array.isArray(lignes) ? lignes : []) {
    const id = l?.variante_produit_id;
    if (typeof id === 'string' && id) achats[id] = (achats[id] || 0) + 1;
  }
  return achats;
}
