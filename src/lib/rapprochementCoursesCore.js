// ============================================================================
// Chantier 91 Lot 5 — Rapprochement liste / cochés / ticket.
// Compare les articles de la session de courses avec les lignes du ticket
// rattaché (chantier 90) et classe chaque cas selon les 6 règles de la spec,
// sans JAMAIS rien décider d'irréversible : le résultat ne modifie que le
// document de session (jsonb donnees / localStorage) — aucune écriture dans
// prix / lignes_ticket / produits / variantes.
// Cœur PUR (rapprocherSessionTicket + appliquer*) ; seuls les helpers de
// normalisation via RPC touchent le réseau, avec repli local intégral.
// ============================================================================
import { supabase } from './supabase';

// Valeurs possibles du champ additif `achat` posé sur les articles de session.
export const ACHATS_ARTICLE = Object.freeze(['confirme', 'non_achete', 'a_verifier']);

// Miroir JS fidèle de la RPC public.normaliser_libelle (chantier 76) — même
// séquence de transformations, dans le même ordre :
//   unaccent(lower(txt)) ; virgule décimale -> point ; tout sauf [a-z0-9. ]
//   -> espace ; « 4 x 125 » -> « 4x125 » ; « 1.5 kg » -> « 1.5kg » ; espaces
//   repliés ; trim ; '' -> null.
// Piège vérifié contre la RPC réelle le 2026-08-12 : unaccent déplie les
// ligatures (Œ -> oe, Æ -> ae), ce que la décomposition NFD ne fait pas —
// d'où le remplacement explicite. Sert de repli hors ligne ET de référence
// des tests ; la RPC reste prioritaire à l'exécution (construireNormaliseur).
export function normaliserLibelleLocal(txt) {
  const base = String(txt ?? '')
    .toLowerCase()
    .replace(/[œ]/g, 'oe')
    .replace(/[æ]/g, 'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const resultat = base
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9. ]+/g, ' ')
    .replace(/(\d(?:g|kg|mg|l|cl|ml|dl)?)\s*x\s*(\d)/g, '$1x$2')
    .replace(/(\d(?:\.\d+)?)\s+(g|kg|mg|l|cl|ml|dl)( |$)/g, '$1$2$3')
    .replace(/\s+/g, ' ')
    .replace(/^ | $/g, '');
  return resultat === '' ? null : resultat;
}

// Normalisation via la RPC normaliser_libelle, en lot (textes uniques, appels
// parallèles) : renvoie une fonction SYNCHRONE (lookup) à injecter dans le
// cœur pur. Tout échec (réseau, RPC absente) retombe silencieusement sur le
// miroir local — le rapprochement n'est jamais bloqué par la normalisation.
export async function construireNormaliseur(textes) {
  const uniques = [...new Set((textes || []).filter(t => typeof t === 'string' && t.trim() !== ''))];
  const table = new Map();
  await Promise.all(uniques.map(async (txt) => {
    try {
      const { data, error } = await supabase.rpc('normaliser_libelle', { txt });
      if (error) throw error;
      table.set(txt, data ?? null);
    } catch {
      table.set(txt, normaliserLibelleLocal(txt));
    }
  }));
  return (txt) => (table.has(txt) ? table.get(txt) : normaliserLibelleLocal(txt));
}

// Textes à pré-normaliser pour une session + un ticket donnés (pour un seul
// construireNormaliseur en amont du cœur pur).
export function textesARapprocher(articles, lignesTicket) {
  const textes = [];
  for (const a of articles || []) { textes.push(a?.nom_affiche, a?.nom_reference); }
  for (const l of lignesTicket || []) { textes.push(l?.libelle_ticket, l?.libelle_brut); }
  return textes.filter(t => typeof t === 'string' && t.trim() !== '');
}

// ── Cœur PUR ────────────────────────────────────────────────────────────────
// rapprocherSessionTicket(articles, lignesTicket, { normaliser }) — applique
// les 6 règles de la spec §5 :
//   1/2) article caddie avec ligne correspondante (coché ou non) -> 'confirme'
//   3)   article caddie coché sans ligne -> 'a_verifier' (jamais tranché seul)
//   4)   article caddie non coché sans ligne -> 'non_achete'
//   5)   ligne reconnue (produit_id) sans article -> achat hors liste
//   6)   ligne non reconnue (produit_id null, aucun texte proche) -> compteur
// Correspondance ligne <-> article (priorité stricte, une ligne ne sert
// qu'une fois, un article aussi) : variante_produit_id égal > produit_id égal
// > égalité des libellés normalisés (libelle_ticket/libelle_brut vs
// nom_affiche/nom_reference). Les notes libres (type 'note') ne sont jamais
// « prévues » : ni classées, ni proposées au matching.
// Garde-fou : aucune ligne exploitable -> { aucuneLigne: true }, RIEN n'est
// classé (jamais « tout non acheté » sur un ticket illisible).
export function rapprocherSessionTicket(articles, lignesTicket, { normaliser = normaliserLibelleLocal } = {}) {
  const arts = articles || [];
  const lignes = (lignesTicket || []).filter(l => l && typeof l === 'object');

  const compteursVides = { confirmes: 0, non_achetes: 0, a_verifier: 0, hors_liste: 0, non_reconnues: 0 };
  if (lignes.length === 0) {
    return { aucuneLigne: true, articles: arts, achats_hors_liste: [], lignes_non_reconnues: 0, compteurs: compteursVides };
  }

  const caddie = arts.map((a, i) => ({ a, i })).filter(({ a }) => a?.type === 'caddie');
  const articleMatche = new Set();   // index dans arts
  const ligneMatchee = new Set();    // index dans lignes

  const normalisesArticle = ({ a }) => [a.nom_affiche, a.nom_reference]
    .map(t => (t ? normaliser(t) : null)).filter(Boolean);
  const normalisesLigne = (l) => [l.libelle_ticket, l.libelle_brut]
    .map(t => (t ? normaliser(t) : null)).filter(Boolean);

  // Trois passes par priorité décroissante — une correspondance par variante
  // ne peut jamais être « volée » par un simple match texte d'une autre ligne.
  const passes = [
    (l, art) => l.variante_produit_id != null && art.a.variante_produit_id != null
      && l.variante_produit_id === art.a.variante_produit_id,
    (l, art) => l.produit_id != null && art.a.produit_id != null
      && l.produit_id === art.a.produit_id,
    (l, art) => {
      const nl = normalisesLigne(l);
      if (nl.length === 0) return false;
      const na = normalisesArticle(art);
      return na.some(n => nl.includes(n));
    },
  ];
  for (const correspond of passes) {
    lignes.forEach((l, li) => {
      if (ligneMatchee.has(li)) return;
      const cible = caddie.find(art => !articleMatche.has(art.i) && correspond(l, art));
      if (cible) { ligneMatchee.add(li); articleMatche.add(cible.i); }
    });
  }

  const compteurs = { ...compteursVides };
  const nouveauxArticles = arts.map((a, i) => {
    if (a?.type !== 'caddie') return a; // notes : jamais classées
    let achat;
    if (articleMatche.has(i)) achat = 'confirme';                         // règles 1 & 2
    else if (a.etat === 'au_caddie') achat = 'a_verifier';                // règle 3
    else achat = 'non_achete';                                            // règle 4
    if (achat === 'confirme') compteurs.confirmes += 1;
    else if (achat === 'a_verifier') compteurs.a_verifier += 1;
    else compteurs.non_achetes += 1;
    return a.achat === achat ? a : { ...a, achat };
  });

  const achatsHorsListe = [];
  let lignesNonReconnues = 0;
  lignes.forEach((l, li) => {
    if (ligneMatchee.has(li)) return;
    if (l.produit_id != null) {
      // Règle 5 — achat hors liste : article-fantôme au format des articles de
      // session (affichage), état au_caddie / achat confirmé, marqué hors_liste.
      // prix_prevu porte ici le prix RÉEL de la ligne (seul prix connu).
      achatsHorsListe.push({
        cle: `hors_liste:${li}`,
        type: 'caddie',
        hors_liste: true,
        etat: 'au_caddie',
        achat: 'confirme',
        produit_id: l.produit_id,
        variante_produit_id: l.variante_produit_id ?? null,
        nom_affiche: l.libelle_ticket || l.libelle_brut || 'Article du ticket',
        quantite: Number(l.quantite) || 1,
        prix_prevu: l.prix_unitaire != null && Number.isFinite(Number(l.prix_unitaire)) ? Number(l.prix_unitaire) : null,
      });
      compteurs.hors_liste += 1;
    } else {
      lignesNonReconnues += 1; // règle 6 — file de rapprochement (compteur)
      compteurs.non_reconnues += 1;
    }
  });

  return { aucuneLigne: false, articles: nouveauxArticles, achats_hors_liste: achatsHorsListe, lignes_non_reconnues: lignesNonReconnues, compteurs };
}

// Applique un résultat de rapprochement SUR le document de session courant,
// par cle (concurrence-sûr : si un article a bougé entre-temps, seul son
// champ achat est posé, rien d'autre n'est écrasé). totalReel = montant_total
// du ticket (nullable). Pure — l'appelant persiste (localStorage + upsert).
export function appliquerRapprochementSession(session, resultat, totalReel, modifieLeISO) {
  if (!session || !resultat || resultat.aucuneLigne) return session;
  const achatsParCle = new Map(
    (resultat.articles || []).filter(a => a?.type === 'caddie' && a.achat).map(a => [a.cle, a.achat])
  );
  return {
    ...session,
    articles: (session.articles || []).map(a =>
      achatsParCle.has(a.cle) && a.achat !== achatsParCle.get(a.cle)
        ? { ...a, achat: achatsParCle.get(a.cle) }
        : a),
    achats_hors_liste: resultat.achats_hors_liste || [],
    lignes_non_reconnues: resultat.lignes_non_reconnues || 0,
    ticket_total_reel: totalReel ?? null,
    rapprochement_le: modifieLeISO,
    modifie_le: modifieLeISO,
  };
}

// Décision utilisateur sur un article 'a_verifier' (mini-dialogue) : pose le
// nouvel achat, réversible. Valeur inconnue ou article absent -> même
// référence (aucune écriture inutile). Pure.
export function deciderAchatArticle(session, cle, achat, modifieLeISO) {
  if (!session || !ACHATS_ARTICLE.includes(achat)) return session;
  let modifie = false;
  const articles = (session.articles || []).map(a => {
    if (a.cle !== cle || a.achat === achat) return a;
    modifie = true;
    return { ...a, achat };
  });
  if (!modifie) return session;
  return { ...session, articles, modifie_le: modifieLeISO };
}
