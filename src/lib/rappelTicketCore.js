// Chantier 150 — le rappel « produits à scanner » de l'accueil.
//
// Scanner le code-barres d'un produit n'a de sens que tant qu'on l'a sous la
// main. Passé quelques jours, le rappel ne sert plus qu'à encombrer l'accueil :
// il s'éteint tout seul. L'utilisateur peut aussi l'écarter tout de suite.
// Rien n'est perdu : les lignes restent dans « Mes tickets ».

export const JOURS_RAPPEL_TICKET = 3;
const CLE = 'pm_tickets_ecartes';
const MAX_MEMOIRE = 30;
const JOUR = 24 * 60 * 60 * 1000;

// Âge du ticket en jours, d'après le moment où il a été scanné. null = inconnu.
export function ageTicketEnJours(ticket, maintenant = Date.now()) {
  const t = Date.parse(ticket?.cree_le || '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (maintenant - t) / JOUR);
}

// Le rappel est-il encore utile ? Date inconnue = on le montre (jamais de
// disparition silencieuse sur une donnée manquante).
export function rappelTicketVisible(ticket, { maintenant = Date.now(), ecartes = [] } = {}) {
  if (!ticket?.id) return false;
  if (Array.isArray(ecartes) && ecartes.includes(String(ticket.id))) return false;
  const age = ageTicketEnJours(ticket, maintenant);
  if (age == null) return true;
  return age < JOURS_RAPPEL_TICKET;
}

// Mémoire locale des rappels écartés. Le stockage peut manquer ou refuser
// (navigation privée) : dans ce cas le rappel reviendra, sans rien casser.
export function lireTicketsEcartes(stockage = globalThis.localStorage) {
  try {
    const brut = JSON.parse(stockage.getItem(CLE) || '[]');
    return Array.isArray(brut) ? brut.map(String) : [];
  } catch {
    return [];
  }
}

export function ecarterTicket(ticketId, stockage = globalThis.localStorage) {
  if (ticketId == null) return;
  try {
    const liste = lireTicketsEcartes(stockage).filter(id => id !== String(ticketId));
    liste.push(String(ticketId));
    stockage.setItem(CLE, JSON.stringify(liste.slice(-MAX_MEMOIRE)));
  } catch {
    // stockage indisponible : tant pis, le rappel reviendra.
  }
}
