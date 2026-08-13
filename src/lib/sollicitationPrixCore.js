// ============================================================================
// Chantier 95 Lot 11 — Sollicitation « relève le prix » pendant les courses.
// MVP de la section 3 (sollicitations de contribution), périmètre PRIX
// uniquement : quand un article est coché (au caddie), si le prix de ce
// produit/format au magasin de la session est ABSENT ou trop ANCIEN, on
// PROPOSE (sans jamais bloquer) de le relever en rayon via la saisie de prix
// EXISTANTE. Pas de code-barres, pas de photo, pas de points ici.
// Cœur PUR (diagnostic + état de sollicitation dans le doc de session) ;
// une seule lecture Supabase best effort (échec => on ne sollicite pas,
// silencieusement).
// ============================================================================
import { supabase } from './supabase';

// Seuil d'ancienneté (jours) au-delà duquel un prix est « à rafraîchir ».
export const SEUIL_JOURS_PRIX_ANCIEN = 60;

// États d'une sollicitation, rangés dans le doc de session
// (session.sollicitations_prix[cle]) — additif, jamais de migration :
//   'proposee'  : carte montrée, pas encore de décision (ne pas re-proposer)
//   'plus_tard' : dans la file « À compléter » (rappel avant la caisse)
//   'ignoree'   : ne plus solliciter ce produit pendant CETTE session
//   'relevee'   : prix saisi — terminé
export const ETATS_SOLLICITATION = Object.freeze(['proposee', 'plus_tard', 'ignoree', 'relevee']);

// ── Cœur PUR ────────────────────────────────────────────────────────────────

// Un prix « actif » participe au diagnostic : ni archivé ni refusé (la RLS ne
// laisse de toute façon passer que les prix validés des autres + les siens).
export function estPrixActif(ligne) {
  return !!ligne && ligne.archive !== true
    && ligne.statut_validation !== 'refuse' && ligne.statut_validation !== 'rejete';
}

// Diagnostic du prix d'un article au magasin de la session, à partir des
// lignes `prix` DÉJÀ scopées (produit_id + magasin_id) par l'appelant :
//   'absent' : aucun prix actif pour ce produit/format à ce magasin ;
//   'ancien' : le plus récent observe_le dépasse seuilJours ;
//   'ok'     : un prix actif suffisamment récent existe.
// Si l'article désigne un FORMAT précis (variante_produit_id non nul), seuls
// les prix de CE format comptent — le prix d'un autre format ne dit rien du
// rayon. Dates illisibles ignorées ; aucune date lisible => 'ancien'. Pure.
export function diagnostiquerPrix(article, lignesPrix, { maintenantMs, seuilJours = SEUIL_JOURS_PRIX_ANCIEN } = {}) {
  const actifs = (lignesPrix || []).filter(estPrixActif);
  const pertinents = article?.variante_produit_id != null
    ? actifs.filter(l => l.variante_produit_id === article.variante_produit_id)
    : actifs;
  if (pertinents.length === 0) return 'absent';

  let plusRecentMs = null;
  for (const l of pertinents) {
    const t = l?.observe_le ? new Date(l.observe_le).getTime() : NaN;
    if (Number.isFinite(t) && (plusRecentMs === null || t > plusRecentMs)) plusRecentMs = t;
  }
  if (plusRecentMs === null) return 'ancien';
  const ageJours = (Number(maintenantMs) - plusRecentMs) / 86400000;
  return ageJours > seuilJours ? 'ancien' : 'ok';
}

export function doitSolliciter(diagnostic) {
  return diagnostic === 'absent' || diagnostic === 'ancien';
}

// Anti-répétition : on ne propose que si AUCUN état n'existe encore pour ce
// produit dans cette session (une seule sollicitation par produit/session).
export function doitProposerSollicitation(session, cle) {
  return !(session?.sollicitations_prix && session.sollicitations_prix[cle]);
}

// Pose l'état de sollicitation d'un article dans le doc de session. État
// inconnu ou aucun changement => même référence (aucune écriture inutile). Pure.
export function marquerSollicitationPrix(session, cle, etat, modifieLeISO) {
  if (!session || !cle || !ETATS_SOLLICITATION.includes(etat)) return session;
  const actuel = session.sollicitations_prix || {};
  if (actuel[cle] === etat) return session;
  return {
    ...session,
    sollicitations_prix: { ...actuel, [cle]: etat },
    modifie_le: modifieLeISO,
  };
}

// File « À compléter » : les articles caddie encore au caddie dont la
// sollicitation est en 'plus_tard'. Pure.
export function fileACompleter(session) {
  const etats = session?.sollicitations_prix || {};
  return (session?.articles || []).filter(a =>
    a?.type === 'caddie' && a.etat === 'au_caddie' && etats[a.cle] === 'plus_tard');
}

// ── Lecture Supabase (best effort) ──────────────────────────────────────────

// Lignes `prix` du produit à CE magasin, pour le diagnostic. null si la
// lecture échoue — l'appelant ne sollicite alors pas, silencieusement.
export async function chargerPrixPourDiagnostic(produitId, magasinId) {
  try {
    if (!produitId || !magasinId) return null;
    const { data, error } = await supabase.from('prix')
      .select('variante_produit_id, observe_le, statut_validation, archive')
      .eq('produit_id', produitId)
      .eq('magasin_id', magasinId)
      .order('observe_le', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('Diagnostic prix (sollicitation sautée, best effort) :', e);
    return null;
  }
}
