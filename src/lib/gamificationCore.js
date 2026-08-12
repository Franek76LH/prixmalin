// ============================================================================
// Chantier 94 Lot 10 — Points Malin, niveaux, badges : AFFICHAGE uniquement.
// Le client ne calcule ni n'attribue RIEN côté base : les points et badges
// sont écrits par le serveur (Lots 8-9 : trigger attribuer_points_prix +
// evaluer_badges_utilisateur). Ici : lectures SELECT best effort et fonctions
// PURES qui MIROITENT la logique serveur pour l'affichage (progression).
// Toute lecture qui échoue rend une valeur neutre — l'app ne plante jamais.
// ============================================================================
import { supabase } from './supabase';
import { doitRattacherTicketSession } from './sessionCoursesCore';

// Niveaux (décision produit) — seuils en Points Malin VALIDÉS uniquement.
export const NIVEAUX = Object.freeze([
  Object.freeze({ nom: 'Observateur',  seuil: 0 }),
  Object.freeze({ nom: 'Éclaireur',    seuil: 100 }),
  Object.freeze({ nom: 'Contributeur', seuil: 300 }),
  Object.freeze({ nom: 'Expert',       seuil: 750 }),
  Object.freeze({ nom: 'Ambassadeur',  seuil: 1500 }),
]);

// ── Cœur PUR ────────────────────────────────────────────────────────────────

// Sommes par statut. Seuls 'valide' et 'en_attente' comptent ; 'refuse' et
// 'annule' sont ignorés (comme côté serveur). Pure.
export function agregerPoints(mouvements) {
  let totalValide = 0, totalEnAttente = 0;
  for (const m of mouvements || []) {
    const pts = Number(m?.points) || 0;
    if (m?.statut === 'valide') totalValide += pts;
    else if (m?.statut === 'en_attente') totalEnAttente += pts;
  }
  return { total_valide: totalValide, total_en_attente: totalEnAttente };
}

// Niveau atteint avec les points VALIDÉS (les points en attente ne comptent
// jamais pour le niveau). Ambassadeur : seuil_suivant null, progression 100 %.
export function calculerNiveau(totalValide) {
  const points = Math.max(0, Number(totalValide) || 0);
  let idx = 0;
  for (let i = 0; i < NIVEAUX.length; i++) { if (points >= NIVEAUX[i].seuil) idx = i; }
  const actuel = NIVEAUX[idx];
  const suivant = NIVEAUX[idx + 1] ?? null;
  const pct = suivant
    ? Math.min(100, Math.round(((points - actuel.seuil) / (suivant.seuil - actuel.seuil)) * 100))
    : 100;
  return {
    niveau_actuel: actuel.nom,
    points,
    seuil_actuel: actuel.seuil,
    seuil_suivant: suivant ? suivant.seuil : null,
    niveau_suivant: suivant ? suivant.nom : null,
    points_restants: suivant ? Math.max(0, suivant.seuil - points) : 0,
    progression_pct: pct,
  };
}

// Progression d'un badge — miroir EXACT d'evaluer_badges_utilisateur (serveur,
// Lot 9) : tout se compte sur les mouvements VALIDÉS uniquement.
//   premiere_contribution : nb de mouvements validés (cap 1) ;
//   prix_valides          : nb validés de type prix_ajout / prix_actualisation ;
//   contrib_meme_magasin  : max de validés pour un même contexte.magasin_id ;
//   magasins_distincts    : nb de contexte.magasin_id distincts (non nuls).
// Type inconnu -> progression non calculable ({ courant: null }). Pure.
export function progressionBadge(conditionType, seuil, mouvementsValides) {
  const valides = (mouvementsValides || []).filter(m => m?.statut === 'valide');
  const s = Number(seuil) || 0;
  let courant = null;
  if (conditionType === 'premiere_contribution') {
    courant = Math.min(valides.length, 1);
  } else if (conditionType === 'prix_valides') {
    courant = valides.filter(m => m.type_contribution === 'prix_ajout' || m.type_contribution === 'prix_actualisation').length;
  } else if (conditionType === 'contrib_meme_magasin') {
    const parMagasin = new Map();
    for (const m of valides) {
      const mid = m?.contexte?.magasin_id;
      if (mid == null) continue;
      parMagasin.set(mid, (parMagasin.get(mid) || 0) + 1);
    }
    courant = parMagasin.size ? Math.max(...parMagasin.values()) : 0;
  } else if (conditionType === 'magasins_distincts') {
    const distincts = new Set(valides.map(m => m?.contexte?.magasin_id).filter(v => v != null));
    courant = distincts.size;
  }
  return { obtenu: courant != null && s > 0 && courant >= s, courant, seuil: s };
}

// Nouveaux badges depuis la dernière fois (codes déjà vus vs badges actuels).
// Pure — l'appelant gère le stockage des « déjà vus ».
export function detecterNouveauxBadges(codesVus, badgesActuels) {
  const vus = new Set(codesVus || []);
  return (badgesActuels || [])
    .filter(b => b?.code_badge && !vus.has(b.code_badge))
    .map(b => b.code_badge);
}

// Statistiques réelles depuis les mouvements (valide + en_attente — jamais
// refusés/annulés) : uniquement des comptes traçables, rien d'inventé. Pure.
export function statistiquesContributions(mouvements) {
  const actifs = (mouvements || []).filter(m => m?.statut === 'valide' || m?.statut === 'en_attente');
  return {
    prix_ajoutes: actifs.filter(m => m.type_contribution === 'prix_ajout').length,
    prix_actualises: actifs.filter(m => m.type_contribution === 'prix_actualisation').length,
    magasins_contribues: new Set(actifs.map(m => m?.contexte?.magasin_id).filter(v => v != null)).size,
  };
}

// ── Lectures Supabase (best effort — profil dégradé, jamais d'erreur) ───────

// Tout ce qu'il faut pour l'écran profil. Chaque morceau a son propre filet :
// un échec rend null (le composant affiche « bientôt disponible » / 0).
export async function chargerProfilGamification(utilisateurId) {
  const uid = utilisateurId ?? null;
  if (!uid) return { mouvements: null, badges: null, catalogue: null, nbTickets: null };
  const [mouvements, badges, catalogue, nbTickets] = await Promise.all([
    supabase.from('mouvements_points')
      .select('type_contribution, points, statut, contexte, cree_le')
      .eq('utilisateur_id', uid)
      .then(({ data, error }) => (error ? null : (data || [])), () => null),
    supabase.from('badges_utilisateur')
      .select('code_badge, obtenu_le, retire')
      .eq('utilisateur_id', uid)
      .then(({ data, error }) => (error ? null : (data || []).filter(b => b.retire !== true)), () => null),
    supabase.from('badges_catalogue')
      .select('code, nom, description, icone, condition_type, seuil, actif, ordre')
      .eq('actif', true)
      .order('ordre')
      .then(({ data, error }) => (error ? null : (data || [])), () => null),
    supabase.from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('utilisateur_id', uid)
      .then(({ count, error }) => (error ? null : (count ?? 0)), () => null),
  ]);
  return { mouvements, badges, catalogue, nbTickets };
}

// Badges actuels seuls (détection de déblocage). null sur erreur.
export async function chargerBadgesUtilisateur(utilisateurId) {
  try {
    if (!utilisateurId) return null;
    const { data, error } = await supabase.from('badges_utilisateur')
      .select('code_badge, obtenu_le, retire')
      .eq('utilisateur_id', utilisateurId);
    if (error) throw error;
    return (data || []).filter(b => b.retire !== true);
  } catch { return null; }
}

// Somme des points des mouvements créés pour le ticket qui vient d'être
// importé (toast « +X Points Malin (en attente) »). Chaîne : dernier ticket
// (#56.5.B) -> lignes -> prix -> mouvements (reference_type='prix'). Ne
// s'exécute que si un ticket a réellement été créé (contrat statut≠'rejet').
// Renvoie { credite: false } (pas de ticket : rien à annoncer),
// { credite: true, total: n>0 } (toast « +n points »), { credite: true,
// total: 0 } (aucun mouvement : silence), { credite: true, total: null }
// (ticket créé mais somme non calculable : message générique).
// Jamais bloquant, jamais de throw.
export async function sommerPointsDernierTicket(ecritureCorePromise, utilisateurId = null) {
  let ticketCree = false;
  try {
    const resultat = await ecritureCorePromise;
    if (!doitRattacherTicketSession(resultat)) return { credite: false };
    ticketCree = true;
    let uid = utilisateurId;
    if (!uid) {
      const { data } = await supabase.auth.getSession();
      uid = data?.session?.user?.id ?? null;
    }
    if (!uid) return { credite: true, total: null };
    const { data: dernier } = await supabase.from('tickets')
      .select('id').eq('utilisateur_id', uid)
      .order('cree_le', { ascending: false }).limit(1).maybeSingle();
    if (!dernier?.id) return { credite: true, total: null };
    const { data: lignes } = await supabase.from('lignes_ticket')
      .select('id').eq('ticket_id', dernier.id);
    const ligneIds = (lignes || []).map(l => l.id);
    if (ligneIds.length === 0) return { credite: true, total: 0 };
    const { data: prix } = await supabase.from('prix')
      .select('id').in('ligne_ticket_id', ligneIds);
    const prixIds = (prix || []).map(p => p.id);
    if (prixIds.length === 0) return { credite: true, total: 0 };
    const { data: mouvements, error } = await supabase.from('mouvements_points')
      .select('points, statut')
      .eq('reference_type', 'prix')
      .in('reference_id', prixIds);
    if (error) throw error;
    const total = (mouvements || [])
      .filter(m => m.statut === 'valide' || m.statut === 'en_attente')
      .reduce((somme, m) => somme + (Number(m.points) || 0), 0);
    return { credite: true, total };
  } catch (e) {
    console.error('Somme des points du ticket (best effort) :', e);
    return ticketCree ? { credite: true, total: null } : { credite: false };
  }
}
