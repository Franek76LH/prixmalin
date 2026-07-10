// #56.5.A — Double écriture Core (scan + saisie manuelle), en plus du legacy.
// Fire-and-forget, invisible pour l'utilisateur : aucune de ces deux fonctions
// ne doit jamais throw ni remonter d'erreur à l'appelant. Les rejets métier
// (magasin non résolu, alias non trouvé...) sont déjà tracés côté RPC dans
// rejets_ecriture_core (#56.3a/#56.3b) ; ici on ne loggue que les échecs
// techniques (RPC en erreur, exception réseau/JS), en console uniquement.
import { supabase } from './supabase';

export async function envoyerTicketCore(toImport, { storeLegacyId, magasinTexte, dateTicket } = {}) {
  try {
    if (!Array.isArray(toImport) || toImport.length === 0) return;

    const lignes = toImport.map(p => ({
      libelle_brut:   p.product,
      libelle_ticket: p.libelle_ticket || null,
      brand:         p.brand || null,
      name:          p.product || null,
      format:        p.format || null,
      quantite:      Number(p.qty || 1),
      prix_unitaire: Number(p.price),
    }));

    const montantTotal = toImport.reduce(
      (somme, p) => somme + Number(p.price) * Number(p.qty || 1),
      0
    );

    const payload = {
      store_legacy_id: storeLegacyId || null,
      magasin_texte:   magasinTexte || null,
      date_ticket:     dateTicket || new Date().toISOString().slice(0, 10),
      montant_total:   montantTotal,
      lignes,
    };

    const { error } = await supabase.rpc('enregistrer_ticket_core', { p_ticket: payload });
    if (error) {
      console.error('[Core#56.5.A] Erreur RPC enregistrer_ticket_core', error);
      return;
    }
  } catch (error) {
    console.error('[Core#56.5.A] Exception enregistrer_ticket_core', error);
  }
}

export async function envoyerPrixManuelCore(entry, { storeLegacyId, magasinTexte } = {}) {
  try {
    if (!entry?.product || isNaN(parseFloat(entry?.price))) return;

    const payload = {
      store_legacy_id:  storeLegacyId || null,
      magasin_texte:    magasinTexte || null,
      magasin_adresse:  entry.store_address || null,
      libelle_produit:  entry.product,
      brand:            entry.brand || null,
      format:           entry.format || null,
      prix_total:       parseFloat(entry.price),
      date_observation: entry.date || new Date().toISOString(),
    };

    const { error } = await supabase.rpc('enregistrer_prix_manuel_core', { p_prix: payload });
    if (error) {
      console.error('[Core#56.5.A] Erreur RPC enregistrer_prix_manuel_core', error);
      return;
    }
  } catch (error) {
    console.error('[Core#56.5.A] Exception enregistrer_prix_manuel_core', error);
  }
}
