// Chantier 183 — suggestions du catalogue pendant les courses (« Ajouter un
// article », « Remplacé par… ») : même recherche que le catalogue
// (rechercher_produits_catalogue_v2), réduite aux premiers noms de fiches.
import { supabase } from './supabase';

export async function chercherProduitsCatalogue(terme, limite = 4) {
  const q = String(terme || '').trim();
  if (q.length < 2) return [];
  const { data: matches, error } = await supabase.rpc('rechercher_produits_catalogue_v2', { p_terme: q });
  if (error) throw error;
  const ids = (matches || []).map(m => m.produit_id).filter(Boolean).slice(0, limite);
  if (ids.length === 0) return [];
  const { data, error: err2 } = await supabase.from('produits').select('id, nom_reference').in('id', ids);
  if (err2) throw err2;
  const parId = new Map((data || []).map(p => [p.id, p]));
  return ids.map(id => parId.get(id)).filter(Boolean).map(p => ({ id: p.id, nom: p.nom_reference }));
}
