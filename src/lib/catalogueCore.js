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
    produit_id:          row.produit_id,
    variante_produit_id: row.variante_produit_id,
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
    .select('id, produit_id, libelle, quantite_nette, unite_quantite, nombre_unites, marque_id, marques(nom)')
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

// Détermine l'emoji/couleur de présentation d'une catégorie Core, avec repli sur CATEGORY_META
export function getCategoryPresentation(categorieDb) {
  const bySlug = CATEGORY_META.find(c => c.id === categorieDb.slug);
  const byName = bySlug || CATEGORY_META.find(c => normalizeName(c.name) === normalizeName(categorieDb.nom));
  return {
    emoji: categorieDb.icone || byName?.emoji || '📦',
    color: byName?.color || '#95A5A6',
  };
}
