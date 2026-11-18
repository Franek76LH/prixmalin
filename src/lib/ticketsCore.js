// Chantier 130 — calculs de l'écran « Mes tickets » (liste des tickets, mois
// par mois). Sortis de l'écran pour être testés. Aucune écriture : on ne fait
// que ranger et additionner ce qui est déjà chargé.

const arrondir = (n) => Math.round(n * 100) / 100;

const sansAccents = (texte) =>
  String(texte ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Montant d'un ticket : le total enregistré ; à défaut, la somme des lignes.
export function totalTicket(arc) {
  const total = Number(arc?.total);
  if (total > 0) return arrondir(total);
  const somme = (arc?.items || []).reduce((s, i) => {
    const prix = Number(i?.unit_price ?? i?.price ?? 0) || 0;
    return s + prix * (Number(i?.qty) || 1);
  }, 0);
  return arrondir(somme);
}

// Total d'une ligne (prix × quantité), ou null si le prix n'est pas connu.
export function totalLigne(item) {
  const prix = item?.unit_price ?? item?.price ?? null;
  if (prix == null || Number.isNaN(Number(prix))) return null;
  return arrondir(Number(prix) * (Number(item?.qty) || 1));
}

// Le ticket contient-il ce qui est cherché (produit, marque ou magasin) ?
export function ticketCorrespond(arc, recherche) {
  const q = sansAccents(recherche).trim();
  if (!q) return true;
  if (sansAccents(arc?.store?.name).includes(q)) return true;
  return (arc?.items || []).some(i => sansAccents(i?.product).includes(q) || sansAccents(i?.brand).includes(q));
}

// Tickets rangés par mois, du plus récent au plus ancien.
// Rend [{ mois: '2026-11', tickets: [...], nb, total }].
export function ticketsParMois(archives, recherche = '') {
  const parMois = new Map();
  for (const arc of archives || []) {
    const mois = String(arc?.date || '').substring(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mois)) continue;
    if (!ticketCorrespond(arc, recherche)) continue;
    const m = parMois.get(mois) || { mois, tickets: [], nb: 0, total: 0 };
    m.tickets.push(arc);
    m.nb += 1;
    m.total += totalTicket(arc);
    parMois.set(mois, m);
  }
  return [...parMois.values()]
    .map(m => ({ ...m, total: arrondir(m.total), tickets: m.tickets.sort((a, b) => new Date(b.date) - new Date(a.date)) }))
    .sort((a, b) => b.mois.localeCompare(a.mois));
}

// Nombre de tickets et total dépensé.
export function bilanTickets(archives) {
  const liste = archives || [];
  return { nb: liste.length, total: arrondir(liste.reduce((s, a) => s + totalTicket(a), 0)) };
}

// « 1234.5 » -> « 1 234,50 € »
export function euros(n) {
  const [entier, cents] = Math.abs(Number(n) || 0).toFixed(2).split('.');
  return `${n < 0 ? '−' : ''}${entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${cents} €`;
}

// Chantier 148 — le total d'un ticket scanné, pour l'historique : ce que le
// client a PAYÉ, donc la somme des lignes MOINS les remises rattachées aux
// lignes. Constat du 18/11 (Carrefour, « 2+1 » sur des pots) : l'historique
// affichait 32,60 € (somme des lignes avant remise) au lieu des 30,33 € payés.
// Une remise absente, illisible ou négative vaut 0 ; jamais de total négatif.
export function totalPayeTicket(entrees) {
  const somme = (entrees || []).reduce((s, e) => {
    const ligne = (Number(e?.price) || 0) * (Number(e?.qty) || 1);
    const remise = Number(e?.remise) > 0 ? Number(e.remise) : 0;
    return s + Math.max(0, ligne - remise);
  }, 0);
  return Math.round(somme * 100) / 100;
}

// Chantier 131 — ce ticket est-il déjà dans l'historique ? Même jour, même
// magasin, même total, déjà marqué « ticket scanné ». Sert à ne pas créer une
// deuxième ligne quand on rescanne un ticket (17 doublons retirés le 17/11).
export function archiveDejaPresente(archives, nouvelle) {
  const jour = String(nouvelle?.date || '').substring(0, 10);
  const magasin = sansAccents(nouvelle?.store?.name).trim();
  const total = Number(nouvelle?.total);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour) || !magasin || !(total > 0)) return null;
  return (archives || []).find(a =>
    a?.ticket_scanned
    && String(a.date || '').substring(0, 10) === jour
    && sansAccents(a.store?.name).trim() === magasin
    && Math.abs(Number(a.total) - total) < 0.005) || null;
}
