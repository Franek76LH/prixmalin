// #56.5.A — Double écriture Core (scan + saisie manuelle), en plus du legacy.
// Fire-and-forget, invisible pour l'utilisateur : aucune de ces deux fonctions
// ne doit jamais throw ni remonter d'erreur à l'appelant. Les rejets métier
// (magasin non résolu, alias non trouvé...) sont déjà tracés côté RPC dans
// rejets_ecriture_core (#56.3a/#56.3b) ; ici on ne loggue que les échecs
// techniques (RPC en erreur, exception réseau/JS), en console uniquement.
import { supabase } from './supabase';

// Chantier 97 — magasinId : id du magasin CORE validé par l'utilisateur avant
// l'import. Envoyé sous la clé `magasin_id` du payload (contrat coordonné avec
// la base : enregistrer_ticket_core lira p_ticket->>'magasin_id' et le passera
// en 1er argument de resoudre_magasin_core). Tant que la base ne le lit pas,
// la clé est simplement ignorée — magasin_texte (nom exact de la fiche Core)
// et store_legacy_id restent les filets de résolution.
export async function envoyerTicketCore(toImport, { magasinId, storeLegacyId, magasinTexte, dateTicket } = {}) {
  try {
    if (!Array.isArray(toImport) || toImport.length === 0) return null;

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
      magasin_id:      magasinId || null,
      store_legacy_id: storeLegacyId || null,
      magasin_texte:   magasinTexte || null,
      date_ticket:     dateTicket || new Date().toISOString().slice(0, 10),
      montant_total:   montantTotal,
      lignes,
    };

    const { data, error } = await supabase.rpc('enregistrer_ticket_core', { p_ticket: payload });
    if (error) {
      console.error('[Core#56.5.A] Erreur RPC enregistrer_ticket_core', error);
      return null;
    }
    // Chantier 109 — on TRACE la réponse complète, toujours, y compris quand
    // tout va bien. Le 18/08 la RPC a répondu 200 avec {"statut":"rejet"} et
    // il a fallu aller lire rejets_ecriture_core en base pour le découvrir :
    // un diagnostic ne doit pas dépendre d'un accès à la base.
    console.log('[C109] enregistrer_ticket_core →', JSON.stringify({
      statut: data?.statut ?? null,
      prix_ecrits: data?.prix_ecrits ?? null,
      lignes_envoyees: lignes.length,
      rejets: data?.rejets ?? null,
    }));
    // #56.6 — le résultat ({statut, prix_ecrits, rejets}) est maintenant
    // renvoyé pour permettre à l'appelant de calculer un realized_saving Core
    // scopé à ce ticket quand core_actif=true. N'importe rien pour un appelant
    // qui continue à ignorer la valeur de retour (comportement fire-and-forget
    // inchangé par défaut).
    return data ?? null;
  } catch (error) {
    console.error('[Core#56.5.A] Exception enregistrer_ticket_core', error);
    return null;
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
