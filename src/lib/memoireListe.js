// Chantier 157 — mémoire personnelle de la liste.
// Quand l'utilisateur choisit une fiche pour ce qu'il a dit ou tapé (« coca »
// -> Cola zéro), on le retient : la prochaine fois, plus de question.
// Un carnet par utilisateur (table memoire_liste, visible de lui seul).
// Ici : la clé du carnet et la lecture, testées seules.
import { motsUtiles } from './liaisonAutoListe';

export const LONGUEUR_MAX_CLE = 80;

// « Du Coca ! » et « coca » donnent la même clé. null = rien à retenir.
export function cleMemoire(texte) {
  const cle = motsUtiles(texte).join(' ');
  return cle && cle.length <= LONGUEUR_MAX_CLE ? cle : null;
}

// Lignes de la base -> { [cle]: { produit_id, produit_nom } }.
// Une fiche désactivée depuis (fusion, nettoyage) est ignorée.
export function lireMemoire(lignes) {
  const memoire = {};
  for (const l of Array.isArray(lignes) ? lignes : []) {
    const nom = l?.produits?.nom_reference;
    if (typeof l?.texte_normalise !== 'string' || !l.texte_normalise || !l?.produit_id || !nom || l.produits.actif === false) continue;
    memoire[l.texte_normalise] = { produit_id: l.produit_id, produit_nom: nom };
  }
  return memoire;
}

// Ce qu'il faut écrire dans le carnet pour ce choix, ou null s'il n'y a rien
// à apprendre : texte vide, ou texte qui est déjà le nom de la fiche.
export function choixARetenir(texte, produit) {
  const cle = cleMemoire(texte);
  if (!cle || !produit?.produit_id || !produit?.produit_nom) return null;
  if (cle === cleMemoire(produit.produit_nom)) return null;
  return { texte_normalise: cle, produit_id: produit.produit_id };
}

export function souvenir(memoire, texte) {
  const cle = cleMemoire(texte);
  return (cle && memoire && memoire[cle]) || null;
}
