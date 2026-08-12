import { supabase } from './supabase';
import { formatFormatStructure, formatVariante } from './catalogueCore';

// Chantier « Courses » Lot 1 — module isolé, shadow estFrancois.
// Construit l'instantané FIGÉ d'une session de courses à partir du résultat
// déjà calculé par le comparateur Core (lignes de prix retenues du magasin
// gagnant). Aucune écriture en base ici : lecture seule (rayons) + fonctions
// pures. La persistance (localStorage au Lot 1, filet Supabase au Lot 4) est
// à la charge de l'appelant.

// Rayon de repli : articles en texte libre (sans produit_id) ou produit dont
// le rayon n'a pas pu être résolu. Toujours affiché en dernier.
export const RAYON_AUTRES = Object.freeze({
  categorie_nom: 'Autres articles',
  categorie_slug: null,
  categorie_ordre: 9999,
  sous_categorie_nom: null,
});

// Emoji d'affichage par slug de catégorie (slugs réels de la table categories).
// Affichage uniquement — un slug inconnu retombe sur le panier générique,
// jamais de trou.
const EMOJI_CATEGORIE = {
  'fruits-legumes':           '🥦',
  'viandes-charcuterie':      '🥩',
  'poissons-fruits-de-mer':   '🐟',
  'produits-laitiers-oeufs':  '🥛',
  'epicerie-salee':           '🧂',
  'epicerie-sucree-petit-dej':'🍫',
  'plats-prepares-traiteur':  '🥘',
  'boissons-non-alcoolisees': '🥤',
  'boissons-alcoolisees':     '🍷',
  'surgeles':                 '❄️',
  'entretien-nettoyage':      '🧽',
  'hygiene-beaute':           '🧴',
  'bebe':                     '🍼',
  'animalerie':               '🐾',
  'ajout-note':               '📝', // Lot 5 — notes libres « Ajoutés en route »
};

export function emojiRayon(rayon) {
  return EMOJI_CATEGORIE[rayon?.categorie_slug] || '🧺';
}

// Charge le rayon (= CATÉGORIE, via produits.sous_categorie_id → sous_categories
// → categories, arbitrage François du 2026-08-11) de chaque produit du caddie.
// Renvoie une Map produit_id -> rayon. Jamais de requête si la liste est vide.
export async function chargerRayonsProduits(produitIds) {
  const ids = [...new Set((produitIds || []).filter(id => id != null))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('produits')
    .select('id, sous_categories(nom, categories(nom, slug, ordre_affichage))')
    .in('id', ids);
  if (error) throw error;

  const rayons = new Map();
  for (const row of data || []) {
    const sc = row.sous_categories;
    const cat = sc?.categories;
    if (!cat) continue; // produit sans chaîne complète -> repli RAYON_AUTRES chez l'appelant
    rayons.set(row.id, {
      categorie_nom: cat.nom,
      categorie_slug: cat.slug ?? null,
      categorie_ordre: Number.isFinite(Number(cat.ordre_affichage)) ? Number(cat.ordre_affichage) : 9998,
      sous_categorie_nom: sc?.nom ?? null,
    });
  }
  return rayons;
}

// Nom complet assemblé depuis les champs réels : nom_reference + marque +
// format (ex. « Chips aromatisées Lay's 120 g »). Règle Chantier 84 : jamais
// le nom de la sous-marque distributeur — un article MDD garde le badge
// générique côté affichage, pas la marque dans le nom.
export function assemblerNomArticle({ nom_reference, nom_marque, est_mdd, format_libelle }) {
  const morceaux = [nom_reference];
  if (nom_marque && est_mdd !== true) morceaux.push(nom_marque);
  if (format_libelle) morceaux.push(format_libelle);
  return morceaux.filter(Boolean).join(' ').trim();
}

// « Format indifférent » (repli d'affichage du caddie) n'est pas un format
// concret : il ne doit jamais apparaître dans le nom assemblé d'une session.
function formatConcret(libelle) {
  const l = (libelle || '').trim();
  return l && l !== 'Format indifférent' ? l : '';
}

// Lot 7 — marques des variantes du caddie, pour les articles SANS prix retenu
// dans le magasin : la photo affichée est celle de la variante choisie au
// caddie, le nom doit donc porter la même marque (cohérence nom/photo).
// Map variante_produit_id -> { nom, est_mdd }. Jamais de requête si vide.
export async function chargerMarquesVariantes(varianteIds) {
  const ids = [...new Set((varianteIds || []).filter(id => id != null))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('variantes_produit')
    .select('id, marques(nom, est_mdd)')
    .in('id', ids);
  if (error) throw error;

  const marques = new Map();
  for (const row of data || []) {
    if (row.marques?.nom) marques.set(row.id, { nom: row.marques.nom, est_mdd: row.marques.est_mdd === true });
  }
  return marques;
}

// Construit les articles FIGÉS de la session à partir :
//   - des items du caddie (forme mapperLigneListeCourses) ;
//   - des lignes de prix retenues pour le magasin choisi
//     (coreResultat.regroupement[magasinId] : { itemId, produit_id, prix }) ;
//   - de la Map des rayons (chargerRayonsProduits) ;
//   - de la Map des marques de variantes (chargerMarquesVariantes, Lot 7) pour
//     les articles sans prix retenu.
// Le produit CONCRET (marque, format, prix, variante pour la photo) vient de
// la ligne de prix retenue quand elle existe — c'est ce que le comparateur a
// réellement affiché. Un article sans prix dans ce magasin est conservé avec
// prix_prevu null (jamais écarté en silence). Fonction pure.
export function construireArticlesSession({ items, lignesPrix, rayons, marquesVariantes }) {
  const parItem = new Map((lignesPrix || []).map(l => [l.itemId, l]));
  const mapRayons = rayons instanceof Map ? rayons : new Map();
  const mapMarques = marquesVariantes instanceof Map ? marquesVariantes : new Map();

  return (items || []).map(item => {
    const prix = parItem.get(item.id)?.prix ?? null;

    const nomReference = item.produit?.nom_reference ?? prix?.nom_produit ?? item.product ?? 'Article';
    // Marque : celle du prix retenu ; sans prix, celle de la variante du
    // caddie (Lot 7 — la photo vient de cette variante, le nom doit suivre).
    // Règle Chantier 84 dans les deux cas : jamais la sous-marque distributeur.
    const marqueCaddie = (!prix && item.variante_produit_id) ? mapMarques.get(item.variante_produit_id) : null;
    const estMdd = prix ? prix.est_mdd === true : marqueCaddie?.est_mdd === true;
    const nomMarque = estMdd ? null : (prix ? (prix.nom_marque ?? null) : (marqueCaddie?.nom ?? null));

    // Format : champs structurés d'abord (formatFormatStructure convertit en
    // unité naturelle — 0,295 kg -> « 295 g », Lot 7), puis libellé de la
    // variante, puis libellé d'affichage du caddie.
    const formatDepuisVariante = item.variante
      ? (formatFormatStructure(item.variante) ?? formatVariante(item.variante))
      : '';
    const formatLibelle = prix
      ? formatConcret(formatFormatStructure(prix) ?? formatDepuisVariante)
      : formatConcret(formatDepuisVariante || (item.formatDisplay ?? item.format ?? ''));

    const article = {
      cle: String(item.id),
      type: 'caddie',
      produit_id: item.produit_id ?? null,
      nom_reference: nomReference,
      nom_marque: nomMarque,
      est_mdd: estMdd,
      format_libelle: formatLibelle,
      quantite: Number(item.qty) || 1,
      prix_prevu: prix?.prix_total ?? null,
      // Variante du PRIX retenu (le produit concret du magasin) pour la photo ;
      // repli sur la variante du caddie.
      variante_produit_id: prix?.variante_produit_id ?? item.variante_produit_id ?? null,
      rayon: (item.produit_id != null && mapRayons.get(item.produit_id)) || RAYON_AUTRES,
      etat: 'a_prendre',
      coche_le: null,
    };
    return { ...article, nom_affiche: assemblerNomArticle(article) };
  });
}

// Document de session figé (version 1). creeLeISO et id sont fournis par
// l'appelant (crypto.randomUUID() côté app) pour garder la fonction pure et
// testable. L'id sert de clé primaire de la ligne Supabase (Lot 4) : l'upsert
// est ainsi idempotent, y compris après une coupure réseau.
export function construireSessionCourses({ id = null, utilisateurId, magasin, articles, totalPrevu, creeLeISO }) {
  return {
    version: 1,
    id,
    statut: 'active',
    utilisateur_id: utilisateurId ?? null,
    cree_le: creeLeISO,
    modifie_le: creeLeISO,
    magasin: {
      magasin_id: magasin?.magasin_id ?? null,
      nom: magasin?.nom ?? 'Magasin',
      enseigne: magasin?.enseigne ?? null,
      adresse: magasin?.adresse ?? null,
      code_postal: magasin?.code_postal ?? null,
      ville: magasin?.ville ?? null,
    },
    total_prevu: Number.isFinite(Number(totalPrevu)) ? Number(totalPrevu) : null,
    articles: articles || [],
  };
}

// ── Lot 4 — filet Supabase (table sessions_courses, migration 20260811130000).
// Le document de session est stocké TEL QUEL dans la colonne jsonb `donnees`
// (miroir exact du localStorage), plus quelques colonnes dénormalisées pour
// les requêtes. Toutes ces fonctions sont best effort côté appelant : un échec
// réseau ne doit JAMAIS bloquer les courses (le localStorage reste la source
// immédiate), mais il est toujours signalé (indicateur, jamais silencieux).

// Id de session (UUID v4) qui fonctionne AUSSI en contexte non sécurisé.
// Leçon de l'incident du 2026-08-11 : crypto.randomUUID n'existe qu'en
// contexte sécurisé (HTTPS/localhost) — sur http://192.168.x.x (test iPhone
// en LAN), son absence faisait échouer le démarrage de session. Repli sur
// crypto.getRandomValues, disponible partout, avec les bits version/variante
// posés à la main (RFC 4122). cryptoApi est injectable pour les tests.
export function genererIdSession(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const octets = new Uint8Array(16);
  cryptoApi.getRandomValues(octets);
  octets[6] = (octets[6] & 0x0f) | 0x40; // version 4
  octets[8] = (octets[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = [...octets].map(o => o.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Ligne sessions_courses correspondant à un document de session. null si le
// document n'a pas d'id (sessions d'avant le Lot 4 : l'appelant doit d'abord
// lui en attribuer un).
export function ligneSupabaseDepuisSession(session) {
  if (!session?.id) return null;
  return {
    id: session.id,
    utilisateur_id: session.utilisateur_id,
    magasin_id: session.magasin?.magasin_id ?? null,
    donnees: session,
    statut: session.statut,
    cree_le: session.cree_le,
    modifie_le: session.modifie_le,
    terminee_le: session.terminee_le ?? null,
  };
}

// Upsert idempotent de la session (clé : id). false si la session n'est pas
// synchronisable (pas d'id ou pas de compte) ; throw sur erreur Supabase.
export async function sauvegarderSessionSupabase(session) {
  const ligne = ligneSupabaseDepuisSession(session);
  if (!ligne || !ligne.utilisateur_id) return false;
  const { error } = await supabase.from('sessions_courses').upsert(ligne, { onConflict: 'id' });
  if (error) throw error;
  return true;
}

// Bascule en 'abandonnee' les sessions actives de l'utilisateur (saufId :
// épargne la session en cours de création). Appelée AVANT l'insertion d'une
// nouvelle session active — l'index unique partiel n'est jamais heurté.
export async function abandonnerSessionsActivesSupabase(utilisateurId, modifieLeISO, { saufId = null } = {}) {
  if (!utilisateurId) return;
  let query = supabase.from('sessions_courses')
    .update({ statut: 'abandonnee', modifie_le: modifieLeISO })
    .eq('utilisateur_id', utilisateurId)
    .eq('statut', 'active');
  if (saufId) query = query.neq('id', saufId);
  const { error } = await query;
  if (error) throw error;
}

// Session active de l'utilisateur en base (document `donnees`), null si
// aucune. L'index unique partiel garantit au plus une ligne.
export async function chargerSessionActiveSupabase(utilisateurId) {
  if (!utilisateurId) return null;
  const { data, error } = await supabase.from('sessions_courses')
    .select('donnees')
    .eq('utilisateur_id', utilisateurId)
    .eq('statut', 'active')
    .maybeSingle();
  if (error) throw error;
  return data?.donnees ?? null;
}

// Départage local / base à la restauration : modifie_le le plus récent gagne.
// À égalité ou dates illisibles, la copie LOCALE gagne (c'est celle que
// l'utilisateur avait sous les yeux sur cet appareil). Fonction pure.
export function choisirSessionLaPlusRecente(locale, distante) {
  if (!locale) return distante ?? null;
  if (!distante) return locale;
  const tLocale = new Date(locale.modifie_le ?? 0).getTime() || 0;
  const tDistante = new Date(distante.modifie_le ?? 0).getTime() || 0;
  return tDistante > tLocale ? distante : locale;
}

// Regroupe des articles par rayon (catégorie), dans l'ordre ordre_affichage de
// la base ; « Autres articles » (ordre 9999) ferme toujours la marche. Le tri
// natif est stable : à ordre égal, l'ordre d'entrée est conservé.
export function grouperParRayon(articles) {
  const groupes = new Map();
  for (const article of articles || []) {
    const rayon = article.rayon || RAYON_AUTRES;
    const cleGroupe = `${rayon.categorie_ordre}::${rayon.categorie_nom}`;
    if (!groupes.has(cleGroupe)) groupes.set(cleGroupe, { rayon, articles: [] });
    groupes.get(cleGroupe).articles.push(article);
  }
  return [...groupes.values()].sort((a, b) => a.rayon.categorie_ordre - b.rayon.categorie_ordre);
}

// Lot 2 — états possibles d'un article de session. Trois états, tous
// réversibles ; toute autre valeur est refusée (jamais d'état inconnu écrit).
export const ETATS_ARTICLE = Object.freeze(['a_prendre', 'au_caddie', 'introuvable']);

// Lot 5 — pseudo-rayon des notes libres ajoutées en cours de courses
// (« Ajoutés en route »). Toujours après « Autres articles ».
export const RAYON_NOTE = Object.freeze({
  categorie_nom: 'Ajoutés en route',
  categorie_slug: 'ajout-note',
  categorie_ordre: 10000,
  sous_categorie_nom: null,
});

// Lot 5 — ajoute une NOTE LIBRE à la session : un simple texte, sans prix,
// sans photo, sans variante, et surtout AUCUNE écriture dans le Core
// (produits/variantes_produit/prix) — la note ne vit que dans le document de
// session (localStorage + sessions_courses.donnees). Texte vide/blanc :
// session inchangée (même référence). idNote est fourni par l'appelant
// (genererIdSession) pour rester pur.
export function ajouterNoteSession(session, texte, modifieLeISO, idNote) {
  const texteNet = (texte || '').trim();
  if (!session || !texteNet || !idNote) return session;
  const note = {
    cle: `note:${idNote}`,
    type: 'note',
    produit_id: null,
    nom_reference: texteNet,
    nom_marque: null,
    est_mdd: false,
    format_libelle: '',
    nom_affiche: texteNet,
    quantite: 1,
    prix_prevu: null,
    variante_produit_id: null,
    rayon: RAYON_NOTE,
    etat: 'a_prendre',
    coche_le: null,
  };
  return { ...session, articles: [...(session.articles || []), note], modifie_le: modifieLeISO };
}

// Lot 5 — supprime une note libre (faute de frappe). REFUSE de supprimer un
// article du caddie (type 'caddie') : la suppression n'existe que pour les
// notes. Clé inconnue ou article non-note : session inchangée (même référence).
export function supprimerNoteSession(session, cle, modifieLeISO) {
  if (!session) return session;
  const articles = session.articles || [];
  const cible = articles.find(a => a.cle === cle);
  if (!cible || cible.type !== 'note') return session;
  return { ...session, articles: articles.filter(a => a.cle !== cle), modifie_le: modifieLeISO };
}

// Lot 2 — change l'état d'un article (cocher / décocher / introuvable) sans
// jamais réordonner la liste : un article décoché retrouve sa place d'origine
// dans son rayon par construction (l'ordre du tableau est stable et
// grouperParRayon ne fait que filtrer). Fonction pure : renvoie une NOUVELLE
// session (modifie_le mis à jour), ou la session inchangée (même référence)
// si la clé est inconnue, l'état invalide ou identique — l'appelant peut
// ainsi éviter une écriture localStorage inutile.
export function appliquerEtatArticle(session, cle, nouvelEtat, modifieLeISO) {
  if (!session || !ETATS_ARTICLE.includes(nouvelEtat)) return session;
  let modifie = false;
  const articles = (session.articles || []).map(article => {
    if (article.cle !== cle || article.etat === nouvelEtat) return article;
    modifie = true;
    return {
      ...article,
      etat: nouvelEtat,
      // coche_le trace la sortie de « à prendre » ; remis à null au retour.
      coche_le: nouvelEtat === 'a_prendre' ? null : modifieLeISO,
    };
  });
  if (!modifie) return session;
  return { ...session, articles, modifie_le: modifieLeISO };
}

// Lot 6 — clôture explicite (« Terminer mes courses »). Ne clôt qu'une
// session active ; sinon même référence (une session déjà terminée ne doit
// jamais être re-clôturée ni réécrite).
export function cloreSession(session, termineeLeISO) {
  if (!session || session.statut !== 'active') return session;
  return { ...session, statut: 'terminee', terminee_le: termineeLeISO, modifie_le: termineeLeISO };
}

// Lot 6 — lignes liste_courses à supprimer au vidage du caddie post-courses.
// Uniquement les articles de type 'caddie' de CETTE session (leur cle est
// l'id de la ligne liste_courses d'origine) : un article ajouté au caddie
// APRÈS le démarrage des courses n'est jamais supprimé (pas de perte
// silencieuse), et les notes libres n'ont rien en base. garderIntrouvables :
// épargne les articles marqués introuvables (pour la prochaine fois).
export function idsCaddieASupprimer(session, { garderIntrouvables = false } = {}) {
  return (session?.articles || [])
    .filter(a => a.type === 'caddie' && (!garderIntrouvables || a.etat !== 'introuvable'))
    .map(a => a.cle);
}

// Chantier 89 Lot 3 — bilan de fin de courses, figé au moment de clore et
// rangé dans le document de session (jsonb `donnees` / localStorage, purement
// additif — aucune migration). total_estime = somme des prix_prevu des
// articles au caddie (calculerTotalPanier, jamais recalculé autrement) :
// c'est une ESTIMATION d'après les prix du comparateur, pas le ticket de
// caisse ; total_incomplet signale des articles achetés sans prix.
// nb_non_achetes = articles hors caddie non gardés pour plus tard (supprimés,
// introuvables, ou laissés dans la liste selon le sort du caddie choisi).
// total_reel : montant_total du ticket rattaché quand le rapprochement
// (chantier 91) l'a posé sur la session (ticket_total_reel), null sinon.
// Fonction pure.
export function construireBilanCourses(articles, { nbReportes = 0, figeLeISO = null, totalReel = null } = {}) {
  const liste = articles || [];
  const { total, incomplet } = calculerTotalPanier(liste);
  const nbAchetes = liste.filter(a => a.etat === 'au_caddie').length;
  const nbNonAchetes = Math.max(0, liste.filter(a => a.etat !== 'au_caddie').length - nbReportes);
  return {
    total_estime: Math.round(total * 100) / 100,
    total_incomplet: incomplet,
    nb_achetes: nbAchetes,
    nb_reporte: nbReportes,
    nb_non_achetes: nbNonAchetes,
    total_reel: totalReel != null && Number.isFinite(Number(totalReel)) ? Number(totalReel) : null,
    fige_le: figeLeISO,
  };
}

// Chantier 90 Lot 4 — faut-il rattacher le ticket scanné à la session ?
// Contrat d'enregistrer_ticket_core : la ligne tickets est créée AVANT la
// boucle des lignes, donc statut 'ok' ET 'rejet_partiel' = ticket créé ;
// statut 'rejet' (parse impossible, magasin non résolu, exception) = aucun
// ticket créé — rattacher le « dernier ticket » raccrocherait alors un
// ancien ticket, jamais. null/undefined (échec technique) = non. Pure.
export function doitRattacherTicketSession(resultatRpc) {
  return !!resultatRpc && resultatRpc.statut !== 'rejet';
}

// Chantier 88 Lot 2 (« À acheter plus tard ») — parmi les articles que le
// vidage choisi s'apprête à supprimer (même périmètre qu'idsCaddieASupprimer,
// mêmes options), ceux qui étaient PRÉVUS MAIS NON ACHETÉS : type 'caddie'
// (leur cle est l'id de la ligne liste_courses) et hors du caddie au moment
// de clôturer (a_prendre ou introuvable). Retourne les articles entiers, pas
// seulement les cles : le dialogue « Choisir » affiche nom et quantité.
export function articlesNonAchetesASupprimer(session, { garderIntrouvables = false } = {}) {
  return (session?.articles || [])
    .filter(a => a.type === 'caddie' && a.etat !== 'au_caddie'
      && (!garderIntrouvables || a.etat !== 'introuvable'));
}

// Lot 8 (ajustement) — total DYNAMIQUE du panier : somme des prix prévus des
// articles déjà cochés (« au_caddie »), recalculée à chaque coche/décoche par
// simple re-rendu. Aucune requête : uniquement les prix déjà figés dans la
// session. Un article coché sans prix (« prix inconnu », note libre) n'ajoute
// rien mais rend le total « incomplet » — l'affichage le signale (« + ? »)
// plutôt que de laisser croire à un total exact. Fonction pure.
export function calculerTotalPanier(articles) {
  let total = 0;
  let incomplet = false;
  for (const article of articles || []) {
    if (article.etat !== 'au_caddie') continue;
    const prix = article.prix_prevu != null ? Number(article.prix_prevu) : null;
    if (prix != null && Number.isFinite(prix)) {
      total += prix * (Number(article.quantite) || 1);
    } else {
      incomplet = true;
    }
  }
  return { total, incomplet };
}

// Progression globale de la session. Les introuvables ne comptent ni comme
// pris ni comme restants dans le ratio principal (ils ont leur section).
export function calculerProgression(articles) {
  const liste = articles || [];
  const pris = liste.filter(a => a.etat === 'au_caddie').length;
  const introuvables = liste.filter(a => a.etat === 'introuvable').length;
  const total = liste.length;
  return {
    total,
    pris,
    introuvables,
    restants: total - pris - introuvables,
  };
}
