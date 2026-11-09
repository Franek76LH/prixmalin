// Chantier 118 — accès base de l'historique des tickets Core. SHADOW.
//
// Lectures seules ici, sauf les trois RPC d'écriture branchées dans
// `depsScanLigne` (rattachement par code connu, création depuis un code
// inconnu) et `confirmerSuggestion`. Aucune fonction ne throw : chacune
// renvoie { data, error } ou une valeur neutre, et l'écran garde son état.
//
// La RLS restreint déjà tickets / lignes_ticket au propriétaire ; on filtre
// QUAND MÊME par utilisateur_id : un compte administrateur peut avoir une
// politique plus large, et l'historique doit rester celui de l'utilisateur.
import { supabase } from './supabase';
import { chercherOffPourCreation, estProduitACompleter, SOUS_CATEGORIE_A_RECLASSER_ID } from './scanDepuisHistorique';

const TAILLE_LOT = 150; // incident du 16/07 : un .in() trop long échoue (URL)

function enLots(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += TAILLE_LOT) out.push(ids.slice(i, i + TAILLE_LOT));
  return out;
}

export async function chargerTicketsUtilisateur(userId) {
  try {
    if (!userId) return { data: [], error: null };
    const { data, error } = await supabase
      .from('tickets')
      .select('id, date_ticket, montant_total, cree_le, magasin_id, magasins(nom, adresse, code_postal, ville)')
      .eq('utilisateur_id', userId)
      .order('date_ticket', { ascending: false, nullsFirst: false })
      .order('cree_le', { ascending: false })
      .limit(200);
    return { data: Array.isArray(data) ? data : [], error };
  } catch (error) {
    return { data: [], error };
  }
}

// Lignes NON validées de tous les tickets de l'utilisateur (pour les compteurs).
export async function chargerLignesAIdentifier(userId) {
  try {
    if (!userId) return { data: [], error: null };
    const { data, error } = await supabase
      .from('lignes_ticket')
      .select('id, ticket_id, statut_validation_produit, produit_suggere_ia_id, tickets!inner(utilisateur_id)')
      .eq('tickets.utilisateur_id', userId)
      .eq('type_ligne', 'produit')
      .neq('statut_validation_produit', 'valide');
    return { data: Array.isArray(data) ? data : [], error };
  } catch (error) {
    return { data: [], error };
  }
}

// Total pour la pastille de l'accueil. null = inconnu (erreur) : on n'affiche
// rien plutôt qu'un faux zéro… ou un faux chiffre.
export async function chargerCompteAIdentifier(userId) {
  const { data, error } = await chargerLignesAIdentifier(userId);
  if (error) return null;
  return data.length;
}

// Pastille de l'accueil — le DERNIER ticket enregistré (le plus récemment
// scanné, donc celui des courses qu'on range) et son nombre de lignes à
// identifier. null = inconnu (erreur) : la pastille ne s'affiche pas plutôt
// que d'annoncer un faux chiffre.
export async function chargerDernierTicketAIdentifier(userId) {
  try {
    if (!userId) return null;
    const { data: ticket, error } = await supabase
      .from('tickets')
      .select('id, date_ticket, montant_total, cree_le, magasin_id, magasins(nom, adresse, code_postal, ville)')
      .eq('utilisateur_id', userId)
      .order('cree_le', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    if (!ticket) return { ticket: null, n: 0 };
    const { count, error: e2 } = await supabase
      .from('lignes_ticket')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_id', ticket.id)
      .eq('type_ligne', 'produit')
      .neq('statut_validation_produit', 'valide');
    if (e2 || count == null) return null;
    return { ticket, n: count };
  } catch {
    return null;
  }
}

const COLONNES_LIGNE = 'id, ticket_id, libelle_brut, libelle_ticket, quantite, prix_unitaire, statut_validation_produit, produit_id, variante_produit_id, produit_suggere_ia_id, variante_suggeree_ia_id, cree_le';

// Lignes d'un ticket + noms des produits/variantes (rattachés ET suggérés).
export async function chargerDetailTicket(ticketId) {
  try {
    const requete = (colonnes) => supabase
      .from('lignes_ticket')
      .select(colonnes)
      .eq('ticket_id', ticketId)
      .eq('type_ligne', 'produit')
      .order('cree_le', { ascending: true });
    // numero_ligne donne l'ordre du ticket ; s'il est refusé, on fait sans.
    let { data, error } = await requete(`${COLONNES_LIGNE}, numero_ligne`);
    if (error) ({ data, error } = await requete(COLONNES_LIGNE));
    if (error) return { lignes: [], produits: {}, variantes: {}, error };
    const lignes = Array.isArray(data) ? data : [];

    const idsProduits = [...new Set(lignes.flatMap(l => [l.produit_id, l.produit_suggere_ia_id]).filter(Boolean))];
    const idsVariantes = [...new Set(lignes.flatMap(l => [l.variante_produit_id, l.variante_suggeree_ia_id]).filter(Boolean))];

    const produits = {};
    const variantes = {};
    // Noms : best effort. Une erreur ici laisse le texte de caisse à l'écran.
    for (const lot of enLots(idsProduits)) {
      const { data: p } = await supabase.from('produits').select('id, nom_reference').in('id', lot);
      for (const x of p || []) produits[x.id] = x;
    }
    for (const lot of enLots(idsVariantes)) {
      const { data: v } = await supabase
        .from('variantes_produit')
        .select('id, actif, libelle, quantite_nette, unite_quantite, nombre_unites, marques(nom)')
        .in('id', lot);
      for (const x of v || []) variantes[x.id] = x;
    }
    return { lignes, produits, variantes, error: null };
  } catch (error) {
    return { lignes: [], produits: {}, variantes: {}, error };
  }
}

// ✓ sur une suggestion : la RPC existante, avec le produit/variante suggérés.
export async function confirmerSuggestion(ligne) {
  try {
    return await supabase.rpc('corriger_association_ligne_ticket', {
      p_ligne_ticket_id: ligne.id,
      p_produit_id: ligne.produit_suggere_ia_id,
      p_variante_produit_id: ligne.variante_suggeree_ia_id ?? null,
    });
  } catch (error) {
    return { data: null, error };
  }
}

export async function chargerVarianteAffichage(varianteId) {
  try {
    if (!varianteId) return null;
    const { data } = await supabase
      .from('variantes_produit')
      .select('id, libelle, quantite_nette, unite_quantite, nombre_unites, produits(nom_reference), marques(nom)')
      .eq('id', varianteId)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
}

// Filet « ↩ Annuler » — RPC dédiée (base), injectée dans annulerScanLigne.
export function annulerScanLigneRpc(ligneId) {
  return supabase.rpc('annuler_scan_ligne_ticket', { p_ligne_ticket_id: ligneId });
}

// Accès injectés dans traiterScanLigne (src/lib/scanDepuisHistorique.js).
export const depsScanLigne = {
  async chercherVarianteParCode(candidats) {
    try {
      const { data: cbv, error } = await supabase
        .from('codes_barres_variante')
        .select('variante_produit_id')
        .in('code_barres', candidats)
        .limit(1);
      if (error) return { error };
      if (!cbv || !cbv[0]) return { connu: false, variante: null };
      // Pas de filtre actif ici : une variante désactivée doit être VUE pour
      // être refusée (« produit archivé »), pas confondue avec un code inconnu
      // — ce qui déclencherait une création en double.
      const { data: v, error: e2 } = await supabase
        .from('variantes_produit')
        .select('id, produit_id, actif, libelle, quantite_nette, unite_quantite, nombre_unites, produits(nom_reference), marques(nom)')
        .eq('id', cbv[0].variante_produit_id)
        .maybeSingle();
      if (e2) return { error: e2 };
      return { connu: true, variante: v ?? null };
    } catch (error) {
      return { error };
    }
  },
  relier({ ligneId, produitId, varianteId, libelleAlias }) {
    return supabase.rpc('relier_variante_scan_code_barres', {
      p_ligne_ticket_id: ligneId,
      p_produit_id: produitId,
      p_variante_produit_id: varianteId,
      p_libelle_alias: libelleAlias,
    });
  },
  chercherOff(ean) {
    return chercherOffPourCreation(ean);
  },
  creerDepuisCode({ ligneId, code, off }) {
    return supabase.rpc('creer_produit_depuis_code_barres', {
      p_ligne_ticket_id: ligneId,
      p_code_barres: code,
      p_off: off || {},
    });
  },
};

// Étape 4 (lecture seule) — produits créés au scan restés incomplets : voir
// estProduitACompleter (code source 'scan' ET (quantité non fiable OU fiche
// « À reclasser »)), rattachés à au moins une ligne d'un ticket de
// l'utilisateur. Une entrée par variante, avec le premier ticket qui l'a fait
// naître.
export async function chargerProduitsACompleter(userId) {
  try {
    if (!userId) return { data: [], error: null };
    const { data: lignes, error } = await supabase
      .from('lignes_ticket')
      .select('id, libelle_ticket, libelle_brut, variante_produit_id, cree_le, tickets!inner(utilisateur_id, date_ticket, magasins(nom))')
      .eq('tickets.utilisateur_id', userId)
      .eq('type_ligne', 'produit')
      .not('variante_produit_id', 'is', null)
      .order('cree_le', { ascending: true });
    if (error) return { data: [], error };

    const premiereLigne = new Map();
    for (const l of lignes || []) if (!premiereLigne.has(l.variante_produit_id)) premiereLigne.set(l.variante_produit_id, l);
    const ids = [...premiereLigne.keys()];

    // D'abord les codes appris au scan (filtre le plus sélectif)…
    const codes = new Map();
    for (const lot of enLots(ids)) {
      const { data: c, error: e } = await supabase
        .from('codes_barres_variante')
        .select('variante_produit_id, code_barres, source')
        .in('variante_produit_id', lot)
        .eq('source', 'scan');
      if (e) return { data: [], error: e };
      for (const x of c || []) if (!codes.has(x.variante_produit_id)) codes.set(x.variante_produit_id, x);
    }

    // … puis l'état de leurs fiches.
    const variantes = new Map();
    for (const lot of enLots([...codes.keys()])) {
      const { data: v, error: e } = await supabase
        .from('variantes_produit')
        .select('id, quantite_fiable, produits(nom_reference, sous_categorie_id)')
        .in('id', lot);
      if (e) return { data: [], error: e };
      for (const x of v || []) variantes.set(x.id, x);
    }

    const data = [];
    for (const [varianteId, code] of codes) {
      const v = variantes.get(varianteId);
      if (!estProduitACompleter(v, code.source)) continue;
      const l = premiereLigne.get(varianteId);
      data.push({
        varianteId,
        ean: code.code_barres,
        nom: v?.produits?.nom_reference || l?.libelle_ticket || l?.libelle_brut || '—',
        libelleTicket: l?.libelle_ticket || null,
        aReclasser: v?.produits?.sous_categorie_id === SOUS_CATEGORIE_A_RECLASSER_ID,
        quantiteNonFiable: v?.quantite_fiable === false,
        dateTicket: l?.tickets?.date_ticket || null,
        magasin: l?.tickets?.magasins?.nom || null,
      });
    }
    return { data, error: null };
  } catch (error) {
    return { data: [], error };
  }
}
