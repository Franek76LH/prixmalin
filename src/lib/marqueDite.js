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

import { motsUtiles } from './liaisonAutoListe';

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
  // Chantier 204 — l'identifiant de la marque (si fourni) : sert à retenir
  // « cette marque, tous formats » quand aucun format ne s'impose.
  const marque_id = dites.find(v => v.marque_id)?.marque_id ?? null;
  if (dites.length === 1) return { variante: dites[0], marque, marque_id };

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
  if (parLibelle) return { variante: parLibelle, marque, marque_id };
  const achats = options?.achatsVariantes || {};
  const parHabitude = seulEnTete(dites.map(v => ({ v, note: Number(achats[v.id]) > 0 ? Number(achats[v.id]) : 0 })));
  return { variante: parHabitude, marque, marque_id };
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

// La marque dite peut vivre dans une fiche VOISINE de celle qui a été reliée :
// « bière Leffe » est relié à « Bière », mais la Leffe est rangée sous « Bière
// blonde » (essai de François, 19/11 : deux bières dictées ont fini en deux
// lignes « Bière » identiques). On regarde alors les autres fiches du même
// rayon — seulement celles dont le nom partage un mot avec la fiche reliée ou
// avec ce qui a été dit, pour ne jamais sauter vers un produit sans rapport
// (« sauce barbecue Heinz » ne devient pas « Ketchup »).
//
// variantes : celles de tout le rayon, chacune avec produit_id et produit_nom.
// Rend { variante, marque, produit_id, produit_nom, autreFiche } ou null.
export function choisirVarianteDite(texte, fiche, variantes, options = {}) {
  const toutes = (Array.isArray(variantes) ? variantes : []).filter(v => v?.produit_id);
  const ici = varianteDite(texte, toutes.filter(v => v.produit_id === fiche?.produit_id), options);
  if (ici) {
    if (ici.variante) return { variante: ici.variante, marque: ici.marque, marque_id: ici.marque_id ?? null, produit_id: fiche.produit_id, produit_nom: fiche.produit_nom, autreFiche: false };
    // Chantier 204 (décision de François, 26/11) : marque de cette fiche,
    // format indécis -> « cette marque, tous formats » (si on connaît la marque).
    return ici.marque_id
      ? { variante: null, marque: ici.marque, marque_id: ici.marque_id, produit_id: fiche.produit_id, produit_nom: fiche.produit_nom, autreFiche: false, tousFormats: true }
      : null;
  }
  const reperes = new Set([...motsUtiles(fiche?.produit_nom), ...motsUtiles(texte)]);
  const voisines = toutes.filter(v => v.produit_id !== fiche?.produit_id && v.produit_nom && motsUtiles(v.produit_nom).some(m => reperes.has(m)));
  const ailleurs = varianteDite(texte, voisines, options);
  if (!ailleurs?.variante) return null;
  return { variante: ailleurs.variante, marque: ailleurs.marque, produit_id: ailleurs.variante.produit_id, produit_nom: ailleurs.variante.produit_nom, autreFiche: true };
}

// Chantier 204 — même marque, accents, casse et ponctuation ignorés
// (« Coca-Cola » = « coca cola »). Sert au comparateur pour une ligne
// « cette marque, tous formats ».
export function memeMarque(a, b) {
  const x = aplati(a);
  return x.length > 0 && x === aplati(b);
}
