import { supabase } from "./supabase";
import { CATEGORY_META } from "../constants";

// Normalise un nom pour comparaison : minuscules + sans accents
function normalizeName(s) {
  return (s || "").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function formatNombreFR(n) {
  const num = Number(n);
  if (Number.isInteger(num)) return String(num);
  return num.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

// Construit le libellé d'affichage d'une variante produit (ex: "500 g", "2 × 125 g")
export function formatVariante(variante) {
  if (!variante) return 'Format indifférent';
  if (variante.libelle && variante.libelle.trim()) return variante.libelle.trim();

  const { quantite_nette, unite_quantite, nombre_unites } = variante;
  if (quantite_nette == null || !unite_quantite) return 'Format indifférent';

  const qte = formatNombreFR(quantite_nette);
  const base = `${qte} ${unite_quantite}`.trim();
  const n = Number(nombre_unites) || 1;
  return n > 1 ? `${n} × ${base}` : base;
}

// Transforme une ligne liste_courses (avec jointures produit/variante) en objet d'interface
export function mapperLigneListeCourses(row) {
  const formatMatch = row.variante_produit_id && row.variante
    ? formatVariante(row.variante)
    : (row.format_selectionne || '');

  const formatDisplay = row.variante_produit_id && row.variante
    ? formatVariante(row.variante)
    : (row.format_selectionne || (row.produit_id ? 'Format indifférent' : ''));

  return {
    id:                  row.id,
    product:             row.libelle_saisi ?? row.produit?.nom_reference ?? row.texte_libre ?? 'Produit sans nom',
    qty:                 Number(row.quantite) || 1,
    format:              formatMatch,
    formatDisplay,
    brand:               '',
    checked:             row.statut === 'achete',
    // Chantier 88 Lot 2 — statut brut conservé pour distinguer les lignes
    // « reporte » (À acheter plus tard) des lignes actives. Champ additif.
    statut:              row.statut,
    produit_id:          row.produit_id,
    variante_produit_id: row.variante_produit_id,
    // Chantier 84 — préférence marque PAR ARTICLE ('nationale' | 'mdd').
    // NULL en base => traité comme 'nationale' (défaut) à la lecture.
    marque_pref:         row.marque_pref === 'mdd' ? 'mdd' : 'nationale',
    produit:             row.produit ?? null,
    variante:            row.variante ?? null,
  };
}

// Charge les variantes actives d'un produit, triées par quantité. Inclut
// marque_id + marques(nom) pour le sélecteur Marque/Format du Catalogue
// (chantier 74) — champ additif, n'affecte pas les appelants existants qui
// l'ignorent (AddItemSheet, ListTab).
export async function chargerVariantes(produitId) {
  const { data, error } = await supabase
    .from('variantes_produit')
    // Chantier 104 — quantite_fiable remonté ici pour que les sélecteurs de
    // format puissent signaler une fiche dont le prix est à vérifier AVANT
    // qu'elle soit choisie.
    .select('id, produit_id, libelle, quantite_nette, unite_quantite, nombre_unites, marque_id, quantite_fiable, marques(nom, est_mdd)')
    .eq('produit_id', produitId)
    .eq('actif', true)
    .order('quantite_nette', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

// Chantier 74 — libellé de format construit UNIQUEMENT à partir des champs
// structurés (quantite_nette, unite_quantite, nombre_unites), jamais du
// champ libre `libelle` (legacy, incohérent : "1kg" vs "1 kg", "- 500g",
// "3 Minutes - 500G"...). Distinct de formatVariante ci-dessus, qui reste
// utilisée telle quelle ailleurs (AddItemSheet, ListTab) pour ne rien changer
// hors du sélecteur Marque/Format du Catalogue.
export function formatFormatStructure(variante) {
  const qte = variante?.quantite_nette != null ? Number(variante.quantite_nette) : null;
  const unite = (variante?.unite_quantite || '').toLowerCase().trim();
  if (qte == null || !Number.isFinite(qte) || !unite) return null;

  let base;
  if (unite === 'kg') {
    base = qte < 1 ? `${formatNombreFR(Math.round(qte * 1000))} g` : `${formatNombreFR(qte)} kg`;
  } else if (unite === 'l') {
    base = qte < 1 ? `${formatNombreFR(Math.round(qte * 1000))} ml` : `${formatNombreFR(qte)} L`;
  } else if (unite === 'pièce' || unite === 'piece') {
    base = `${formatNombreFR(qte)} pièce${qte > 1 ? 's' : ''}`;
  } else {
    base = `${formatNombreFR(qte)} ${unite}`;
  }

  const n = Number(variante?.nombre_unites) || 1;
  return n > 1 ? `${n} × ${base}` : base;
}

// Chantier 104 — « prix à vérifier ».
//
// 363 variantes sont des « 1 kg » factices issues d'une migration : quantité
// inventée, donc le €/kg calculé vaut mécaniquement le prix stocké — il est
// faux. Et sur une partie d'entre elles le prix stocké est lui-même un €/kg mal
// rangé (Morilles à 430 €, Chips nature jusqu'à 93 €), indistinguable ligne par
// ligne. La mention porte donc sur le PRIX, pas sur la quantité.
//
// La colonne quantite_fiable (base) vaut false sur ces fiches. Ce prédicat est
// LE point unique de décision côté front, et son repli est volontairement
// permissif : colonne absente (cache navigateur, réponse d'une ancienne
// version, chemin legacy price_db) -> fiable, donc comportement actuel. Aucun
// écran ne doit se vider à cause de cette colonne. Réversibilité : repasser une
// fiche à true en base lui rend son affichage normal, sans toucher au code.
export function prixEstFiable(source) {
  return source?.quantite_fiable !== false;
}

// Libellé unique de la mention, pour qu'elle soit identique partout.
export const MENTION_PRIX_A_VERIFIER = 'Prix à vérifier';

// Chantier 104 — LA règle qui protège le classement des enseignes.
//
// Quand le comparateur choisit l'offre retenue d'un magasin pour un article
// « format indifférent », il prend la moins chère au kilo. Une quantité inventée
// donne un €/kg faux : l'offre gagnerait le duel pour de mauvaises raisons et
// deviendrait le prix du magasin, faussant son total ET le classement.
// On ne met donc jamais une offre douteuse en concurrence avec une offre sûre.
//
// Mais s'il n'y a QUE des offres douteuses, on les garde : les retirer ferait
// disparaître l'article de ce magasin en silence, donc amputerait son total et
// le ferait paraître moins cher qu'il n'est. Ce serait remplacer un mensonge
// par un pire, puisqu'il toucherait le classement. On garde, et on signale.
export function offresPrioritaires(lignes) {
  const toutes = Array.isArray(lignes) ? lignes : [];
  const fiables = toutes.filter(prixEstFiable);
  return fiables.length > 0 ? fiables : toutes;
}

// Chantier 75 — prix ramené à l'unité de mesure (€/kg, €/L, €/pièce), pour
// comparer des formats différents d'un même produit. Lecture seule sur les
// champs structurés de la variante (quantite_nette, unite_quantite,
// nombre_unites) ; jamais une valeur par défaut pour une unité non reconnue
// ou une quantité manquante/nulle — null dans ce cas, à l'appelant de gérer
// l'affichage de repli.
export function calculerPrixUnitaire(prix, variante) {
  if (!prix || !variante) return null;

  const quantiteNette = variante.quantite_nette != null ? Number(variante.quantite_nette) : null;
  if (quantiteNette == null || !Number.isFinite(quantiteNette) || quantiteNette <= 0) return null;

  const unite = (variante.unite_quantite || '').toLowerCase().trim();
  if (!unite) return null;

  const nombreUnites = Number(variante.nombre_unites) || 1;
  const quantiteTotale = quantiteNette * nombreUnites;

  let quantiteEnBase, libelleUnite;
  if (unite === 'g') { quantiteEnBase = quantiteTotale / 1000; libelleUnite = '€/kg'; }
  else if (unite === 'kg') { quantiteEnBase = quantiteTotale; libelleUnite = '€/kg'; }
  else if (unite === 'ml') { quantiteEnBase = quantiteTotale / 1000; libelleUnite = '€/L'; }
  else if (unite === 'cl') { quantiteEnBase = quantiteTotale / 100; libelleUnite = '€/L'; }
  else if (unite === 'l') { quantiteEnBase = quantiteTotale; libelleUnite = '€/L'; }
  else if (unite === 'pièce' || unite === 'piece') { quantiteEnBase = quantiteTotale; libelleUnite = '€/pièce'; }
  else return null;

  if (!Number.isFinite(quantiteEnBase) || quantiteEnBase <= 0) return null;

  const prixNumerique = Number(prix.prix);
  if (!Number.isFinite(prixNumerique)) return null;

  return { valeur: prixNumerique / quantiteEnBase, libelleUnite };
}

// Détermine l'emoji/couleur de présentation d'une catégorie Core, avec repli sur CATEGORY_META
export function getCategoryPresentation(categorieDb) {
  const bySlug = CATEGORY_META.find(c => c.id === categorieDb.slug);
  const byName = bySlug || CATEGORY_META.find(c => normalizeName(c.name) === normalizeName(categorieDb.nom));
  return {
    emoji: categorieDb.icone || byName?.emoji || '📦',
    color: byName?.color || '#95A5A6',
  };
}
