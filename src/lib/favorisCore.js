// ============================================================================
// Chantier 92 Lot 6 — Favoris Core (par format) & produits récurrents.
// Deux notions DISTINCTES, jamais confondues :
//   FAVORI    = choix volontaire de l'utilisateur (table Core `favoris`).
//   RÉCURRENT = détecté depuis l'historique d'achat (lignes_ticket) ; il n'est
//               JAMAIS ajouté automatiquement aux favoris, seulement proposé.
// Sans rapport avec les « courses habituelles » (table legacy `favorites`),
// qui restent intactes. Identité d'un favori : IDs réels uniquement
// (produit_id + variante_produit_id, null = favori au niveau produit) —
// jamais un nom en texte. Cœur PUR testable ; helpers Supabase best effort
// (une lecture qui échoue rend [] et n'empêche jamais d'utiliser l'app).
// ============================================================================
import { supabase } from './supabase';

// Seuil de récurrence : acheté dans AU MOINS ce nombre de tickets DISTINCTS.
export const SEUIL_TICKETS_RECURRENT = 3;

// Identité (produit, format) — même convention p:/v: que cleArticle (liste).
export function cleFavori(produitId, varianteProduitId) {
  return `p:${produitId}|v:${varianteProduitId ?? ''}`;
}

// ── Cœur PUR ────────────────────────────────────────────────────────────────

// Détection des récurrents depuis des lignes de ticket { ticket_id,
// produit_id, variante_produit_id } : regroupées par (produit, format), un
// couple est récurrent s'il apparaît dans >= seuil tickets DISTINCTS (une
// ligne dupliquée dans le même ticket ne compte qu'une fois). Les lignes sans
// produit_id sont ignorées. Pure.
export function detecterRecurrents(lignes, { seuil = SEUIL_TICKETS_RECURRENT } = {}) {
  const parCle = new Map();
  for (const l of lignes || []) {
    if (!l || l.produit_id == null || l.ticket_id == null) continue;
    const cle = cleFavori(l.produit_id, l.variante_produit_id);
    if (!parCle.has(cle)) {
      parCle.set(cle, { produit_id: l.produit_id, variante_produit_id: l.variante_produit_id ?? null, tickets: new Set() });
    }
    parCle.get(cle).tickets.add(l.ticket_id);
  }
  return [...parCle.values()]
    .filter(e => e.tickets.size >= seuil)
    .map(e => ({ produit_id: e.produit_id, variante_produit_id: e.variante_produit_id, nb_tickets: e.tickets.size }));
}

// Proposition post-rapprochement (chantier 91) : parmi les ACHATS CONFIRMÉS
// de la session (articles achat==='confirme' + achats hors liste), garde ceux
// qui sont RÉCURRENTS et PAS déjà favoris. Comparaison par IDs réels ; deux
// formats du même produit sont deux propositions distinctes ; un même couple
// (produit, format) n'est proposé qu'une fois. Pure.
export function proposerFavorisApresTicket({ achatsConfirmes = [], recurrents = [], favorisExistants = [] } = {}) {
  const clesRecurrents = new Map(recurrents.map(r => [cleFavori(r.produit_id, r.variante_produit_id), r]));
  const clesFavoris = new Set(favorisExistants.map(f => cleFavori(f.produit_id, f.variante_produit_id)));
  const vues = new Set();
  const propositions = [];
  for (const a of achatsConfirmes) {
    if (!a || a.produit_id == null) continue;
    const cle = cleFavori(a.produit_id, a.variante_produit_id);
    if (vues.has(cle) || clesFavoris.has(cle) || !clesRecurrents.has(cle)) continue;
    vues.add(cle);
    propositions.push({
      cle,
      produit_id: a.produit_id,
      variante_produit_id: a.variante_produit_id ?? null,
      nom_affiche: a.nom_affiche ?? a.nom_reference ?? 'Produit',
      nb_tickets: clesRecurrents.get(cle).nb_tickets,
    });
  }
  return propositions;
}

// ── Helpers Supabase (best effort) ──────────────────────────────────────────

async function resoudreUtilisateurId(utilisateurId) {
  if (utilisateurId) return utilisateurId;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch { return null; }
}

// Favoris de l'utilisateur, avec fiches jointes pour l'affichage. [] sur
// erreur — ne bloque jamais l'app.
export async function chargerFavoris(utilisateurId) {
  try {
    const uid = await resoudreUtilisateurId(utilisateurId);
    if (!uid) return [];
    const { data, error } = await supabase.from('favoris')
      .select(`id, produit_id, variante_produit_id, magasin_prefere_id, cree_le,
        produit:produits(id, nom_reference),
        variante:variantes_produit(id, libelle, quantite_nette, unite_quantite, nombre_unites, marques(nom)),
        magasin:magasins(id, nom)`)
      .eq('utilisateur_id', uid)
      .order('cree_le', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('Chargement des favoris (best effort) :', e);
    return [];
  }
}

// Ajout anti-doublon par IDs réels : vérifie l'existence du couple
// (produit_id, variante_produit_id) AVANT d'insérer ; l'index unique
// (NULLS NOT DISTINCT) reste le filet — un 23505 (course entre deux appareils)
// est traité comme « déjà en favori », jamais comme un plantage.
// Renvoie { statut: 'ajoute' | 'deja' | 'erreur' }.
export async function ajouterFavori({ utilisateurId, produitId, varianteProduitId = null } = {}) {
  try {
    const uid = await resoudreUtilisateurId(utilisateurId);
    if (!uid || !produitId) return { statut: 'erreur' };
    let verif = supabase.from('favoris').select('id')
      .eq('utilisateur_id', uid)
      .eq('produit_id', produitId);
    verif = varianteProduitId == null
      ? verif.is('variante_produit_id', null)
      : verif.eq('variante_produit_id', varianteProduitId);
    const { data: existant, error: erreurVerif } = await verif.maybeSingle();
    if (!erreurVerif && existant) return { statut: 'deja', id: existant.id };

    const { data, error } = await supabase.from('favoris')
      .insert({ utilisateur_id: uid, produit_id: produitId, variante_produit_id: varianteProduitId })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return { statut: 'deja' };
      throw error;
    }
    return { statut: 'ajoute', id: data?.id };
  } catch (e) {
    console.error('Ajout favori (best effort) :', e);
    return { statut: 'erreur' };
  }
}

// Retrait par id de ligne. true si la suppression est partie sans erreur.
export async function retirerFavori(favoriId) {
  try {
    if (!favoriId) return false;
    const { error } = await supabase.from('favoris').delete().eq('id', favoriId);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('Retrait favori (best effort) :', e);
    return false;
  }
}

// Favori existant pour un couple (produit, format) — { id } ou null.
// null aussi sur erreur : l'appelant retente à l'écriture (anti-doublon y
// est de toute façon rejoué).
export async function chercherFavori({ utilisateurId, produitId, varianteProduitId = null } = {}) {
  try {
    const uid = await resoudreUtilisateurId(utilisateurId);
    if (!uid || !produitId) return null;
    let q = supabase.from('favoris').select('id')
      .eq('utilisateur_id', uid)
      .eq('produit_id', produitId);
    q = varianteProduitId == null ? q.is('variante_produit_id', null) : q.eq('variante_produit_id', varianteProduitId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data ?? null;
  } catch {
    return null;
  }
}

// Récurrents de l'utilisateur : deux étapes compatibles RLS (ses tickets,
// puis leurs lignes), détection par le cœur pur. [] sur erreur.
export async function chargerRecurrents(utilisateurId, { seuil = SEUIL_TICKETS_RECURRENT } = {}) {
  try {
    const uid = await resoudreUtilisateurId(utilisateurId);
    if (!uid) return [];
    const { data: tickets, error: e1 } = await supabase.from('tickets')
      .select('id')
      .eq('utilisateur_id', uid);
    if (e1) throw e1;
    const ids = (tickets || []).map(t => t.id);
    if (ids.length === 0) return [];
    const { data: lignes, error: e2 } = await supabase.from('lignes_ticket')
      .select('ticket_id, produit_id, variante_produit_id')
      .in('ticket_id', ids)
      .not('produit_id', 'is', null);
    if (e2) throw e2;
    return detecterRecurrents(lignes || [], { seuil });
  } catch (e) {
    console.error('Chargement des récurrents (best effort) :', e);
    return [];
  }
}
