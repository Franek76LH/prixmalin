// #56.5.B — Économies Core confirmées (comparaison ligne par ligne entre le
// prix réellement payé sur un ticket scanné, source='ticket' dans `prix`, et
// le prix de référence marché = moyenne des observations Core comparables
// dans d'autres magasins). Réutilise chargerPrixComparables (#56.1) sans
// dupliquer aucune logique de matching produit/format.
//
// Séparation stricte lecture/calcul pour permettre l'injection dev (#56.5.B
// complément) : calculerEconomiesConfirmeesCore est pure, ne fait aucune
// requête ; chargerEtCalculerEconomiesConfirmeesCore fait la lecture réelle
// SAUF si lignesInjectees est fourni, auquel cas aucune requête Supabase
// n'est faite et le même calcul pur s'applique aux lignes injectées.
import { supabase } from './supabase';
import { chargerPrixComparables } from './comparateurCore';
import { JOURS_MOYENNE } from '../constants';

// Format d'une ligne (réelle ou injectée) :
//   { ligneTicketId, produitId, magasinId, prixPaye, prixReferenceMarche }
// prixReferenceMarche est null si aucune donnée comparable n'existe pour ce
// produit — la ligne reste visible mais n'entre jamais dans le total
// (jamais de prix de référence inventé).
export function calculerEconomiesConfirmeesCore(lignes) {
  const details = (Array.isArray(lignes) ? lignes : []).map(ligne => {
    const economie = ligne.prixReferenceMarche != null
      ? Math.round((ligne.prixReferenceMarche - ligne.prixPaye) * 100) / 100
      : null;
    return { ...ligne, economie };
  });

  const total = details.reduce((somme, l) => somme + (l.economie ?? 0), 0);

  return { total: Math.round(total * 100) / 100, lignes: details };
}

// Enrichit des lignes brutes de `prix` (produit_id/magasin_id/prix_total/
// ligne_ticket_id) avec leur prix de référence marché, via
// chargerPrixComparables (#56.1) — logique de matching partagée par
// chargerEtCalculerEconomiesConfirmeesCore (tout l'historique) et
// calculerRealizedSavingTicket (#56.6, un seul ticket), jamais dupliquée.
async function enrichirAvecReferenceMarche(prixRows) {
  const produitIds = [...new Set(prixRows.map(p => p.produit_id))];
  const cutoffISO = new Date(Date.now() - JOURS_MOYENNE * 86400000).toISOString();
  const comparables = await chargerPrixComparables(produitIds, { staleCutoffISO: cutoffISO });

  return prixRows.map(p => {
    const alternatives = comparables.filter(c => c.produit_id === p.produit_id && c.magasin_id !== p.magasin_id);
    const prixReferenceMarche = alternatives.length
      ? alternatives.reduce((somme, c) => somme + Number(c.prix_total), 0) / alternatives.length
      : null;

    return {
      ligneTicketId: p.ligne_ticket_id,
      produitId: p.produit_id,
      magasinId: p.magasin_id,
      prixPaye: Number(p.prix_total),
      prixReferenceMarche,
    };
  });
}

export async function chargerEtCalculerEconomiesConfirmeesCore({ lignesInjectees } = {}) {
  if (lignesInjectees) {
    return { ...calculerEconomiesConfirmeesCore(lignesInjectees), simule: true };
  }

  const { data: prixTicket, error } = await supabase
    .from('prix')
    .select('produit_id, magasin_id, prix_total, ligne_ticket_id')
    .eq('source', 'ticket');

  if (error || !prixTicket?.length) {
    return { total: 0, lignes: [], simule: false };
  }

  const lignes = await enrichirAvecReferenceMarche(prixTicket);
  return { ...calculerEconomiesConfirmeesCore(lignes), simule: false };
}

// #56.6 — realized_saving Core, scopé à UN SEUL ticket (celui qui vient
// d'être écrit par enregistrer_ticket_core), pas tout l'historique. Réutilise
// calculerEconomiesConfirmeesCore (#56.5.B) sans dupliquer le calcul.
// Le ticket "le plus récent pour cet utilisateur" est supposé être celui
// qui vient d'être créé — cohérent avec l'absence de déduplication déjà
// acceptée en #56.3a (shadow, cercle restreint).
export async function calculerRealizedSavingTicket({ utilisateurId }) {
  const { data: dernierTicket } = await supabase
    .from('tickets')
    .select('id')
    .eq('utilisateur_id', utilisateurId)
    .order('cree_le', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!dernierTicket) return { total: 0, lignes: [], simule: false };

  const { data: lignesTicket } = await supabase
    .from('lignes_ticket')
    .select('id')
    .eq('ticket_id', dernierTicket.id);
  const ligneIds = (lignesTicket || []).map(l => l.id);
  if (ligneIds.length === 0) return { total: 0, lignes: [], simule: false };

  const { data: prixTicket, error } = await supabase
    .from('prix')
    .select('produit_id, magasin_id, prix_total, ligne_ticket_id')
    .in('ligne_ticket_id', ligneIds);
  if (error || !prixTicket?.length) return { total: 0, lignes: [], simule: false };

  const lignes = await enrichirAvecReferenceMarche(prixTicket);
  return { ...calculerEconomiesConfirmeesCore(lignes), simule: false };
}
