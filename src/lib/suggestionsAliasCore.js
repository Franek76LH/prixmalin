// #67 v1 — Suggestions d'alias Core par IA. Wrapper client pour
// AdminRejetsCorePanel.jsx : ne contient aucune logique métier (tout est côté
// SQL/edge function), uniquement les appels Supabase et la normalisation des
// erreurs pour l'affichage admin.
import { supabase } from './supabase';

// Enrichit chaque suggestion avec le nom du produit/variante proposé, pour
// affichage direct dans le panneau admin (produits/variantes_produit sont
// lisibles par tout authenticated, cf. PHASE_1 — pas besoin de RPC dédiée).
async function enrichirAvecNomsProduits(suggestions) {
  const produitIds = [...new Set(suggestions.map(s => s.produit_id).filter(Boolean))];
  const varianteIds = [...new Set(suggestions.map(s => s.variante_produit_id).filter(Boolean))];

  const [produits, variantes] = await Promise.all([
    produitIds.length
      ? supabase.from('produits').select('id, nom_reference').in('id', produitIds).then(r => r.data || [])
      : Promise.resolve([]),
    varianteIds.length
      ? supabase.from('variantes_produit').select('id, libelle').in('id', varianteIds).then(r => r.data || [])
      : Promise.resolve([]),
  ]);

  const nomParProduit = new Map(produits.map(p => [p.id, p.nom_reference]));
  const libelleParVariante = new Map(variantes.map(v => [v.id, v.libelle]));

  return suggestions.map(s => ({
    ...s,
    produit_nom: s.produit_id ? nomParProduit.get(s.produit_id) || null : null,
    variante_libelle: s.variante_produit_id ? libelleParVariante.get(s.variante_produit_id) || null : null,
  }));
}

export async function chargerSuggestionsPourRejets(rejetIds) {
  if (!Array.isArray(rejetIds) || rejetIds.length === 0) return [];
  const { data, error } = await supabase
    .from('suggestions_alias_core_ia')
    .select('*')
    .in('rejet_ecriture_core_id', rejetIds);
  if (error) {
    console.error('[#67] Erreur chargement suggestions_alias_core_ia', error);
    return [];
  }
  return enrichirAvecNomsProduits(data || []);
}

export async function proposerAliasCore({ limite } = {}) {
  const { data, error } = await supabase.functions.invoke('proposer-alias-core', {
    body: limite ? { limite } : {},
  });
  if (error) {
    console.error('[#67] Erreur edge function proposer-alias-core', error);
    return null;
  }
  return data ?? null;
}

export async function validerSuggestionAliasCore(suggestionId) {
  const { data, error } = await supabase.rpc('valider_suggestion_alias_core', { p_suggestion_id: suggestionId });
  if (error) return { succes: false, erreur: error.message };
  return data;
}

export async function refuserSuggestionAliasCore(suggestionId, commentaire = null) {
  const { data, error } = await supabase.rpc('refuser_suggestion_alias_core', {
    p_suggestion_id: suggestionId,
    p_commentaire: commentaire,
  });
  if (error) return { succes: false, erreur: error.message };
  return data;
}
