// Chantier 194 — « Même prix, meilleure note » (idée du 25/11, fiche
// claude/chantier-178-nutri-score-25-11.md, point 5 ; feu vert de François
// le 26/11 à 11h02).
//
// Pour un article de Ma liste dont le format choisi a un Nutri-Score, on
// cherche dans LA MÊME FICHE (même produit comparable, même sous-type : c'est
// la règle d'or du modèle produit) un autre format ou une autre marque :
//   - mieux noté (lettre strictement meilleure) ;
//   - pas plus cher au kilo ou au litre (tolérance 5 %) ;
//   - prix des deux relevés DANS LE MÊME MAGASIN (jamais un prix de Leclerc
//     contre un prix de Lidl) ;
//   - quantités fiables des deux côtés.
// Rien n'est inventé : sans lettre pour l'article, sans prix des deux côtés
// dans un même magasin, pas de proposition. Une marque distributeur n'est
// jamais nommée (« Marque distributeur », règle drive). Rien n'est écrit en
// base ici : l'appelant remplace le format de la ligne si on le lui demande.
import { supabase } from './supabase';
import { lettreNutri } from './nutriScoreCore';
import { quantiteBase } from './nutriPanierCore';

export const TOLERANCE_PRIX = 0.05;
export const MAX_PROPOSITIONS = 3;
const CLE_REFUS = 'prixmalin_memePrixRefus_v1';

function familleUnite(u) {
  const x = String(u || '').toLowerCase().trim();
  if (x === 'g' || x === 'kg') return 'kg';
  if (x === 'ml' || x === 'cl' || x === 'l') return 'l';
  return null;
}

// Garde, pour chaque (variante, magasin), le relevé le plus récent, avec son
// prix au kilo / litre. Écarte ce qui ne permet pas une comparaison honnête.
export function preparerReleves(lignes) {
  const parCle = new Map();
  for (const r of lignes || []) {
    if (!r?.variante_produit_id || !r?.magasin_id || !r?.produit_id) continue;
    if (r.quantite_fiable === false) continue;
    const lettre = lettreNutri(r.nutri_score);
    const famille = familleUnite(r.unite_quantite);
    const base = quantiteBase(r);
    const prix = Number(r.prix_total);
    if (!lettre || !famille || !base || !(prix > 0)) continue;
    const cle = `${r.variante_produit_id}|${r.magasin_id}`;
    const date = r.observe_le ? new Date(r.observe_le).getTime() : 0;
    const prec = parCle.get(cle);
    if (prec && prec.date >= date) continue;
    parCle.set(cle, {
      produit_id: r.produit_id, variante_produit_id: r.variante_produit_id, magasin_id: r.magasin_id,
      enseigne: r.nom_enseigne || r.nom_magasin || null, lettre, famille, prix, parUnite: prix / base, date,
      nom_marque: r.nom_marque || null, est_mdd: !!r.est_mdd,
      quantite_nette: r.quantite_nette, unite_quantite: r.unite_quantite, nombre_unites: r.nombre_unites,
    });
  }
  return [...parCle.values()];
}

export function libelleMarque(alt) {
  if (alt?.est_mdd) return 'Marque distributeur';
  return alt?.nom_marque || 'Sans marque';
}

// items : lignes de Ma liste. releves : sortie de preparerReleves.
// refus : Set de clés `${varianteActuelle}>${varianteProposee}` écartées.
// magasinId (chantier 196, Mes courses) : ne compare QUE les prix du magasin
// où l'on fait ses courses.
export function trouverAlternatives(items, releves, { tolerance = TOLERANCE_PRIX, max = MAX_PROPOSITIONS, refus = new Set(), magasinId = null } = {}) {
  const parVariante = new Map();
  for (const r of releves || []) {
    if (!parVariante.has(r.variante_produit_id)) parVariante.set(r.variante_produit_id, []);
    parVariante.get(r.variante_produit_id).push(r);
  }
  const dejaDansLaListe = new Set((items || []).map(i => i?.variante_produit_id).filter(Boolean));
  const propositions = [];
  const vus = new Set();
  for (const item of items || []) {
    if (!item || item.checked || item.type === 'note') continue;
    const vId = item.variante_produit_id;
    if (!vId || !item.produit_id || vus.has(vId)) continue;
    vus.add(vId);
    const miens = parVariante.get(vId) || [];
    let meilleure = null;
    for (const actuel of miens) {
      if (magasinId && actuel.magasin_id !== magasinId) continue;
      for (const cand of releves) {
        if (cand.produit_id !== actuel.produit_id || cand.magasin_id !== actuel.magasin_id) continue;
        if (cand.variante_produit_id === vId || dejaDansLaListe.has(cand.variante_produit_id)) continue;
        if (cand.famille !== actuel.famille || !(cand.lettre < actuel.lettre)) continue;
        if (cand.parUnite > actuel.parUnite * (1 + tolerance)) continue;
        if (refus.has(`${vId}>${cand.variante_produit_id}`)) continue;
        const choix = { item, actuel, alternative: cand };
        if (!meilleure || estMieux(choix, meilleure)) meilleure = choix;
      }
    }
    if (meilleure) propositions.push(meilleure);
  }
  propositions.sort((a, b) => ecart(b) - ecart(a) || (b.actuel.parUnite - b.alternative.parUnite) - (a.actuel.parUnite - a.alternative.parUnite));
  return propositions.slice(0, max);
}

function ecart(p) {
  return p.actuel.lettre.charCodeAt(0) - p.alternative.lettre.charCodeAt(0);
}

// Meilleure lettre d'abord, puis le moins cher au kilo, puis le plus récent.
function estMieux(a, b) {
  if (a.alternative.lettre !== b.alternative.lettre) return a.alternative.lettre < b.alternative.lettre;
  if (a.alternative.parUnite !== b.alternative.parUnite) return a.alternative.parUnite < b.alternative.parUnite;
  return Math.min(a.actuel.date, a.alternative.date) > Math.min(b.actuel.date, b.alternative.date);
}

// « ce mois-ci », « il y a 1 mois », « il y a 4 mois » : l'âge du plus vieux
// des deux prix comparés (on ne cache pas qu'un prix est ancien).
export function ageReleve(date, maintenant = Date.now()) {
  if (!date) return null;
  const mois = Math.floor((maintenant - date) / (30.4 * 24 * 3600 * 1000));
  if (mois < 1) return 'ce mois-ci';
  return `il y a ${mois} mois`;
}

export function formaterParUnite(valeur, famille) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '';
  return `${n.toFixed(2).replace('.', ',')} €/${famille === 'l' ? 'L' : 'kg'}`;
}

export async function chargerRelevesPourListe(items) {
  const ids = [...new Set((items || []).filter(i => i && !i.checked && i.variante_produit_id).map(i => i.produit_id).filter(Boolean))].sort();
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('prix_comparables')
    .select('produit_id, variante_produit_id, magasin_id, nom_enseigne, nom_magasin, prix_total, quantite_nette, unite_quantite, nombre_unites, nutri_score, nom_marque, est_mdd, quantite_fiable, observe_le')
    .in('produit_id', ids)
    .not('nutri_score', 'is', null)
    .limit(3000);
  if (error) throw error;
  return preparerReleves(data || []);
}

export function lireRefus(stockage = globalThis.localStorage) {
  try { return new Set(JSON.parse(stockage?.getItem(CLE_REFUS) || '[]')); } catch { return new Set(); }
}

export function ajouterRefus(cle, stockage = globalThis.localStorage) {
  const s = lireRefus(stockage);
  s.add(cle);
  try { stockage?.setItem(CLE_REFUS, JSON.stringify([...s].slice(-200))); } catch { /* sans effet */ }
  return s;
}

// Chantier 196 — articles de la session de courses (Mes courses) vus comme des
// lignes de liste : seuls les articles du caddie encore « à prendre » comptent.
export function articlesSessionEnItems(articles) {
  return (articles || [])
    .filter(a => a && a.type === 'caddie' && a.etat === 'a_prendre' && a.variante_produit_id && a.produit_id)
    .map(a => ({
      id: a.cle, produit_id: a.produit_id, variante_produit_id: a.variante_produit_id, checked: false,
      product: a.nom_reference, formatDisplay: [a.est_mdd ? null : a.nom_marque, a.format_libelle].filter(Boolean).join(' · '),
    }));
}
