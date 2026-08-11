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

// Construit les articles FIGÉS de la session à partir :
//   - des items du caddie (forme mapperLigneListeCourses) ;
//   - des lignes de prix retenues pour le magasin choisi
//     (coreResultat.regroupement[magasinId] : { itemId, produit_id, prix }) ;
//   - de la Map des rayons (chargerRayonsProduits).
// Le produit CONCRET (marque, format, prix, variante pour la photo) vient de
// la ligne de prix retenue quand elle existe — c'est ce que le comparateur a
// réellement affiché. Un article sans prix dans ce magasin est conservé avec
// prix_prevu null (jamais écarté en silence). Fonction pure.
export function construireArticlesSession({ items, lignesPrix, rayons }) {
  const parItem = new Map((lignesPrix || []).map(l => [l.itemId, l]));
  const mapRayons = rayons instanceof Map ? rayons : new Map();

  return (items || []).map(item => {
    const prix = parItem.get(item.id)?.prix ?? null;

    const nomReference = item.produit?.nom_reference ?? prix?.nom_produit ?? item.product ?? 'Article';
    const estMdd = prix?.est_mdd === true;
    const nomMarque = estMdd ? null : (prix?.nom_marque ?? null);

    // Format : celui de la ligne de prix retenue (champs structurés de la vue),
    // sinon celui de la variante du caddie, sinon le libellé d'affichage.
    const formatLibelle = prix
      ? formatConcret(formatFormatStructure(prix) ?? (item.variante ? formatVariante(item.variante) : ''))
      : formatConcret(item.variante ? formatVariante(item.variante) : (item.formatDisplay ?? item.format ?? ''));

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

// Document de session figé (version 1). creeLeISO est fourni par l'appelant
// pour garder la fonction pure et testable.
export function construireSessionCourses({ utilisateurId, magasin, articles, totalPrevu, creeLeISO }) {
  return {
    version: 1,
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
