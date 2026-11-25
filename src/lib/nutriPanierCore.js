// Chantier 180 — « Nutri-Score de ton caddie » (méthode décidée le 25/11,
// fiche claude/chantier-178-nutri-score-25-11.md).
//
// Le Nutri-Score compare des produits d'un même rayon : on ne fait JAMAIS la
// moyenne des lettres. On montre une RÉPARTITION (A-B / C / D-E), pondérée par
// les quantités quand le poids ou le volume de chaque produit noté est connu
// (sinon, article par article, et on le dit). On ne compte que ce qui se
// mange et peut être noté : entretien, hygiène, animalerie, bébé et alcool
// sont écartés ; les fruits et légumes frais (sans Nutri-Score) sont comptés
// à part. Rien n'est affiché si moins de la moitié des produits alimentaires
// sont notés (ou moins de 3) : jamais de chiffre trompeur.
import { supabase } from './supabase';
import { lettreNutri } from './nutriScoreCore';

export const CATEGORIES_HORS_NUTRI = ['Entretien & nettoyage', 'Hygiène & beauté', 'Animalerie', 'Bébé', 'Boissons alcoolisées'];
export const CATEGORIE_FRAIS = 'Fruits & légumes';
export const MIN_NOTES = 3;

// Poids (kg) ou volume (l) d'un format, pour pondérer. null si inconnu.
export function quantiteBase(variante) {
  const q = Number(variante?.quantite_nette);
  const u = String(variante?.unite_quantite || '').toLowerCase().trim();
  if (!Number.isFinite(q) || q <= 0) return null;
  const facteur = { kg: 1, g: 0.001, l: 1, cl: 0.01, ml: 0.001 }[u];
  if (!facteur) return null;
  const n = Number(variante?.nombre_unites);
  return q * facteur * (Number.isFinite(n) && n > 0 ? n : 1);
}

export async function chargerInfosNutri(varianteIds) {
  const ids = [...new Set((varianteIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('variantes_produit')
    .select('id, nutri_score, quantite_nette, unite_quantite, nombre_unites')
    .in('id', ids);
  if (error) throw error;
  return new Map((data || []).map(v => [v.id, { lettre: lettreNutri(v.nutri_score), base: quantiteBase(v) }]));
}

const GROUPE = { A: 'ab', B: 'ab', C: 'c', D: 'de', E: 'de' };

// articles : ceux de la session (type 'caddie'), déjà filtrés par l'appelant
// (prévus ou achetés). infos : Map varianteId -> { lettre, base }.
export function calculerNutriPanier(articles, infos) {
  const carte = infos instanceof Map ? infos : new Map();
  let nbAlimentaires = 0;
  let nbFrais = 0;
  const notes = [];
  for (const a of articles || []) {
    if (!a || a.type === 'note') continue;
    const categorie = a.rayon?.categorie_nom ?? null;
    if (CATEGORIES_HORS_NUTRI.includes(categorie)) continue;
    const info = a.variante_produit_id ? carte.get(a.variante_produit_id) : null;
    const qte = Number(a.quantite) > 0 ? Number(a.quantite) : 1;
    if (info?.lettre) {
      nbAlimentaires += 1;
      notes.push({ lettre: info.lettre, poids: info.base != null ? info.base * qte : null, qte });
    } else if (categorie === CATEGORIE_FRAIS) {
      nbFrais += 1; // frais sans Nutri-Score : compté à part, pas dans la couverture
    } else {
      nbAlimentaires += 1;
    }
  }
  const nbNotes = notes.length;
  const base = { nbNotes, nbAlimentaires, nbFrais };
  if (nbAlimentaires === 0) return { etat: 'vide', ...base };
  if (nbNotes < MIN_NOTES || nbNotes * 2 < nbAlimentaires) return { etat: 'insuffisant', ...base };

  const pondere = notes.every(n => n.poids != null);
  const totaux = { ab: 0, c: 0, de: 0 };
  for (const n of notes) totaux[GROUPE[n.lettre]] += pondere ? n.poids : n.qte;
  const somme = totaux.ab + totaux.c + totaux.de;
  // Pourcentages arrondis qui font toujours 100.
  const brut = { ab: (totaux.ab / somme) * 100, c: (totaux.c / somme) * 100, de: (totaux.de / somme) * 100 };
  const parts = { ab: Math.round(brut.ab), c: Math.round(brut.c), de: 0 };
  parts.de = 100 - parts.ab - parts.c;
  return { etat: 'ok', ...base, pondere, parts };
}
