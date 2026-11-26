// Edge Function scan-ticket — construction du prompt et normalisation de la
// sortie, SANS AUCUNE DÉPENDANCE (ni Deno, ni réseau) : le même fichier est
// importé par index.ts (Deno, en production) et par le banc d'essai local
// scripts/tester-scan-ticket.ts (Node), pour tester EXACTEMENT le prompt
// déployé sans Docker.
//
// v14 (chantier 120 — import de tickets dématérialisés : image longue Lidl
// Plus, PDF Leclerc Drive / Carrefour, captures Netto). Règle : la v14 AJOUTE
// des paragraphes au prompt v13, elle n'en retire ni n'en modifie aucun. Avec
// `consignesV14: false`, le texte produit est celui de la v13 au caractère
// près (vérifié par prompt.test.ts contre le fichier v13 commité en 1d4388e).

export type ProduitRef = { nom: string; categorie: string };

// ── Ajouts v14 ──────────────────────────────────────────────────────────────
// (a) Recollage — uniquement quand il y a plusieurs images.
export const CONSIGNE_V14_RECOLLAGE =
  `RECOLLAGE DES MORCEAUX (règles précises) : les images sont des morceaux CONSÉCUTIFS d'UN SEUL ticket, dans l'ordre. Entre la fin d'un morceau et le début du suivant, 1 à 3 lignes peuvent se RÉPÉTER (même libellé ET même prix) : ne les compte qu'UNE seule fois. Deux lignes identiques qui ne sont PAS à la jonction de deux morceaux sont deux vrais articles : garde-les toutes les deux. Si deux morceaux consécutifs n'ont AUCUNE ligne en commun, recolle-les quand même dans l'ordre et mets "captures_peut_etre_incompletes": true (il manque peut-être un morceau du ticket entre les deux).\n\n`;

// Champs de sortie ajoutés (décrits à part : l'exemple JSON v13 n'est pas touché).
export const CONSIGNE_V14_CHAMPS =
  `\nCHAMPS SUPPLÉMENTAIRES (en plus de ceux de l'exemple ci-dessus) :
- dans CHAQUE objet de "products" : "remise" (nombre POSITIF, 0 par défaut) = la remise imprimée juste sous cet article (voir REMISE SOUS UNE LIGNE).
- à la racine : "captures_peut_etre_incompletes" (booléen, false par défaut) = true seulement si plusieurs morceaux n'ont pas pu être raccordés (voir RECOLLAGE).`;

// Précision sur total_remises (ajoutée APRÈS la règle des trois cas, qui reste
// intacte). Constat du banc d'essai du 09/11 : le Netto (avantages produits
// crédités sur la carte, 0,43 €) et le Leclerc (« Bon immédiat 1,80 » réglé
// APRÈS le total) sortaient avec un total_remises faux, donc une fausse
// alerte du contrôle de cohérence — dès la v13 pour le Netto.
// v18 (chantier 194, 26/11) — « JUST FOUR CLASSI » lu « Jus d'orange » sur
// un ticket Utile (20/11) : un mot entier n'est pas l'abréviation d'un autre.
export const CONSIGNE_MOT_ENTIER = `UN MOT N'EST PAS UNE ABRÉVIATION D'UN AUTRE : ne développe une abréviation que si c'est un vrai raccourci (lettres retirées : "LT" -> lait, "ECR" -> écrémé). Un mot ENTIER qui ressemble au début d'un autre mot n'en est pas l'abréviation : "JUST" n'est PAS "jus". Les mots d'un nom de marque ou de gamme ne décrivent pas le produit. Exemple ANCRÉ : "JUST FOUR CLASSI" = frites surgelées « Juste au four » classiques, JAMAIS un jus de fruits. Si tu ne reconnais pas le produit derrière un nom de gamme, laisse "name" vide/brut et mets confiance="faible".
`;

export const CONSIGNE_V14_REMISES =
  `
  - Une remise RÉDUIT ce que le client paie. Les AVANTAGES DE FIDÉLITÉ crédités sur une carte ou une cagnotte ("AVANTAGES PRODUITS", "TOTAL AVANTAGES DU JOUR", "SOLDE DISPONIBLE", "… € crédités sur votre compte", "Détails de vos avantages fidélité") ne réduisent PAS le montant payé aujourd'hui : ce ne sont PAS des remises. Ne les compte ni dans "total_remises" ni dans le "remise" d'une ligne, même quand ils répètent le nom d'un article. Indice sûr : si le total payé est égal à la somme des lignes article, aucune remise n'a été déduite et "total_remises" vaut 0.
  - Un bon d'achat, "Bon immédiat", chèque cadeau ou cagnotte UTILISÉ, imprimé APRÈS le total parmi les moyens de paiement (avec CB, espèces…), est une façon de PAYER, pas une remise : il n'entre pas dans "total_remises", et "total_ticket" reste le total imprimé des articles — JAMAIS le montant restant débité par carte après ce bon.
  - Les deux cas à ne pas confondre :
    • Remise AVANT le total à payer — "Total avant remises 20.37 / Total Remises immédiates -2.15 / Total à payer 18.22" -> total_ticket = 18.22, total_remises = 2.15.
    • Bon APRÈS le total, parmi les paiements — "Total 30 articles 76.15 / Bon immediat 1.80 / CB Web Drive 74.35" -> total_ticket = 76.15, total_remises = 0 (le bon et la CB sont deux moyens de payer les 76.15).`;

// (b) quantité sur une ligne séparée, (c) remise sous une ligne, (d) sections à ignorer.
export const CONSIGNE_V14_LIGNES =
  `\nQUANTITÉ SUR UNE LIGNE SÉPARÉE (tickets de drive, ex. Leclerc Drive) : une ligne du type "2 x 8.09 … 16.18" placée SOUS un libellé appartient à ce libellé. C'est UN SEUL article : qty = 2, unit_price = price = 8.09, total = 16.18. Ne crée JAMAIS deux lignes pour cet article, et ne crée jamais de ligne produit pour la ligne "2 x …" elle-même.
REMISE SOUS UNE LIGNE (ex. Carrefour "Remise immédiate -2,15", "Remise fidélité -0,50") : une remise imprimée juste sous un article, DANS la liste des articles et AVANT le total, se RATTACHE à l'article du dessus. Un montant qui figure dans une section APRÈS le total (avantages, fidélité, récapitulatifs) n'est jamais une remise de ligne, même s'il répète le nom d'un article. Mets son montant, en nombre POSITIF, dans le champ "remise" de cet article (ex. 2.15). Les champs unit_price, price et total de l'article restent les montants AVANT remise. Une remise n'est JAMAIS une ligne de "products". La règle de "total_remises" ci-dessus reste inchangée (0 / total imprimé / null).
À IGNORER COMPLÈTEMENT (ce ne sont pas des articles) : la section "Détails de vos avantages fidélité" et toutes les sections équivalentes (cagnotte, avantages carte, récapitulatif des économies), les lignes de paiement carte bancaire (CB, montant débité, numéro de carte), les points ou euros de fidélité gagnés, les mentions légales, et tout le pied de ticket.`;

// ── Construction du prompt ─────────────────────────────────────────────────
// multi : comme en v13, le préambule « morceaux » dépend du CHAMP utilisé
// (liste d'images), pas du nombre : imagesBase64 avec une seule image donnait
// déjà le préambule en v13. Par défaut : plus d'une image.
export function construirePromptTicket({
  nbImages,
  refProducts = [],
  consignesV14 = true,
  multi,
}: { nbImages: number; refProducts?: ProduitRef[]; consignesV14?: boolean; multi?: boolean }): string {
  const isMulti = multi ?? nbImages > 1;
  const refSection = refProducts.length > 0
    ? `\n\nCatalogue de référence (${refProducts.length} produits génériques) :\n` +
      refProducts.map((p: ProduitRef) => `- ${p.nom} (${p.categorie})`).join("\n") +
      `\n\nPour chaque article du ticket, cherche dans ce catalogue le nom générique le plus proche (ex : "LT DEMI ECR" → "Lait demi-écrémé", "POULET ROT" → "Poulet rôti"). Utilise ce nom officiel dans le champ "name" UNIQUEMENT si la correspondance est franche. Si aucune correspondance n'est évidente, NE force PAS un rapprochement approximatif : laisse "name" vide ou recopie simplement le libellé du ticket normalisé (majuscules → minuscules, abréviations développées), et mets confiance="faible".`
    : `\nNormalise les noms abrégés (ex: LT DEMI ECR → Lait demi-écrémé).`;

  const preambuleMulti = isMulti
    ? `Ces ${nbImages} images sont des morceaux successifs d'UN SEUL ticket de caisse, pris dans l'ordre de haut en bas. Les photos peuvent se CHEVAUCHER : un même produit peut apparaître en bas d'une photo et en haut de la suivante. Tu dois reconstituer UNE SEULE liste de produits, dans l'ordre, en supprimant les doublons dus au chevauchement (ne compte chaque produit qu'une seule fois). Le magasin et la date sont en général sur la première image.\n\n`
      + (consignesV14 ? CONSIGNE_V14_RECOLLAGE : "")
    : "";

  return `${preambuleMulti}Analyse ce ticket de caisse et extrait les informations suivantes en JSON uniquement, sans texte avant ou après :
{
  "store": "nom du magasin",
  "date": "YYYY-MM-DD",
  "address": "adresse complète du magasin si présente sur le ticket (numéro, rue, code postal, ville), sinon chaîne vide",
  "total_ticket": 0.00,
  "nombre_articles": 0,
  "total_remises": 0.00,
  "products": [
    { "brand": "marque ou vide", "name": "nom du produit normalisé", "libelle_ticket": "texte du ticket recopié tel quel", "confiance": "haute", "format": "format ou vide", "quantite_nette": null, "unite_quantite": null, "nombre_unites": null, "qty": 1, "unit_price": 0.00, "price": 0.00, "total": 0.00 }
  ]
}${consignesV14 ? CONSIGNE_V14_CHAMPS : ""}
CONTRÔLE DE COHÉRENCE DU TICKET (champs "total_ticket" et "nombre_articles") :
- "total_ticket" (nombre) : le MONTANT TOTAL PAYÉ tel qu'il est IMPRIMÉ sur le ticket (ligne "TOTAL", "TOTAL A PAYER", "NET A PAYER", "MONTANT DU"). C'est le total du ticket, PAS la somme que tu calculerais toi-même à partir des lignes.
- "nombre_articles" (nombre entier) : le NOMBRE D'ARTICLES tel qu'il est IMPRIMÉ sur le ticket (ligne "NOMBRE D'ARTICLES", "NB ARTICLES", "TOTAL ARTICLES"). Là encore, c'est le chiffre imprimé, PAS le nombre de lignes que tu as extraites.
- Si l'un de ces deux chiffres n'est pas imprimé, ou est illisible : mets null. NE LE CALCULE PAS, NE LE DEVINE PAS. Ces deux champs servent à vérifier ta propre lecture : une valeur inventée à partir des lignes rendrait le contrôle inutile, et un ticket mal lu passerait pour bon.
- "total_remises" (nombre) : le TOTAL DES REMISES tel qu'il est IMPRIMÉ sur le ticket (ligne "TOTAL REMISES", "REMISES", "AVANTAGES", "ECONOMIES REALISEES", "TOTAL AVANTAGES"). Les prix des lignes article sont AVANT remise, alors que "total_ticket" est APRÈS remise : sans ce chiffre, la vérification est faussée sur tout ticket en promotion.
  - Si le ticket ne comporte AUCUNE remise ni promotion : mets 0.
  - Si un total de remises est imprimé : recopie-le.
  - Si des remises apparaissent (lignes "2+1", "REMISE 50%", "OFFRE") mais QU'AUCUN total de remises n'est imprimé : mets null. NE LES ADDITIONNE PAS toi-même — un total calculé serait une donnée inventée, et mieux vaut renoncer à vérifier que vérifier faux.
  - Les remises ne sont JAMAIS des lignes de "products". Elles ne figurent que dans ce champ.${consignesV14 ? CONSIGNE_V14_REMISES : ""}
DATE — même exigence : "date" doit être la date IMPRIMÉE du passage en caisse. Ne la déduis JAMAIS d'un autre nombre du ticket : un numéro de téléphone, un numéro de caisse, un code TVA ou un numéro de ticket ne sont PAS des dates. Si aucune date de passage en caisse n'est lisible, mets null plutôt qu'une date reconstituée.
Pour chaque ligne article, retourne aussi libelle_ticket : le texte tel qu'il est imprimé sur le ticket, recopié au plus proche, sans correction, sans reformulation, sans interprétation produit. Si le texte exact est partiellement illisible, conserve ce qui est visible et n'invente pas.
CONFIANCE (champ "confiance", obligatoire, valeur "haute" ou "faible") :
- Mets "haute" UNIQUEMENT quand le rattachement du "name" est franc : le libellé du ticket correspond clairement à un produit (idéalement une entrée du catalogue de référence), sans ambiguïté.
- Mets "faible" dès qu'il n'y a PAS de correspondance franche : libellé trop vague, abréviation ambiguë, ou tu dois deviner. Ne force JAMAIS une devinette pour éviter "faible" : dans le doute, c'est "faible".
NE PAS FORCER UN RATTACHEMENT (règle la plus importante) : si AUCUN produit du catalogue ne correspond franchement au libellé du ticket, tu NE forces PAS un rapprochement approximatif. Dans ce cas : laisse "name" VIDE (ou recopie le libellé brut simplement normalisé) et mets confiance="faible". Rattacher FAUX est PIRE que ne pas rattacher : mieux vaut une ligne non rattachée et signalée "faible" qu'un faux rattachement silencieux. Exemple : "DRP LOW CERISE PET 1.5L" est un sirop — il ne doit SURTOUT PAS devenir "eau de source plate" juste parce que ce serait la moins mauvaise entrée du catalogue ; laisse "name" vide/brut et confiance="faible".
${consignesV14 ? CONSIGNE_MOT_ENTIER : ""}NE JAMAIS INVENTER D'ATTRIBUT : n'ajoute JAMAIS au "name" une caractéristique qui n'est pas ÉCRITE LITTÉRALEMENT dans le libellé du ticket. Exemples d'attributs à ne pas inférer : plate vs gazeuse, entier vs demi-écrémé vs écrémé, nature vs aromatisé, bio, etc.
- Exemple ANCRÉ (EAU GAZEUSE) : un "G" ISOLÉ dans un libellé d'eau, séparé du reste (pas collé à un nombre), signifie EAU GAZEUSE. "EAU MINERALE NATURELLE G 6X1L" = eau minérale GAZEUSE (le "G" = Gazeuse), format 6×1 L -> name du type "Eau minérale gazeuse". À l'inverse, "EAU MINERALE NATURELLE 6X1L" SANS "G", ou "CRISTALINE", = eau PLATE. Quand tu vois un "G" isolé après un libellé d'eau, traite-la comme gazeuse ; si tu hésites entre plate et gazeuse, mets confiance="faible" plutôt que de deviner.
- Règle générale : si l'attribut n'est pas dans le texte, soit tu l'omets, soit (si l'omettre rend le rattachement incertain) tu mets confiance="faible". Jamais d'invention.
FORMAT STRUCTURÉ : en plus du champ "format" (texte brut recopié, ex "6X1L", "125G"), décompose-le en trois champs :
- "quantite_nette" (nombre) : la quantité d'UNE unité. Ex "6X1L" -> 1 ; "125G" -> 125 ; "1,5L" -> 1.5.
- "unite_quantite" (texte) : l'unité, parmi "g", "kg", "ml", "cl", "L", "piece".
- "nombre_unites" (nombre) : le nombre d'unités du conditionnement. Ex "6X1L" -> 6 ; "125G" -> 1 ; "lot de 3" -> 3.
- UNITÉS — respecte LITTÉRALEMENT l'unité imprimée, ne JAMAIS convertir une unité en une autre : "CL" = centilitres (unite_quantite "cl"), "L" = litres ("L"), "ML" = millilitres ("ml"), "G" suivant un nombre = grammes ("g"), "KG" = kilos ("kg"). Ex : "50CL" -> quantite_nette 50, unite_quantite "cl" (surtout PAS 50 "ml" ni 0,5 "L"). "25CL" ou "25C" -> 25, "cl". Un format qui finit par "C" seul après un nombre est une abréviation de "cl" ("25C" = 25 cl ; "25" seul sur une boisson canette = 25 cl).
- ATTENTION à ne pas confondre le "G" : collé à un nombre ("125G") c'est l'unité grammes ; mais un "G" ISOLÉ après un libellé d'eau ("EAU MINERALE NATURELLE G") n'est PAS une unité, c'est l'abréviation de Gazeuse (voir la règle NE JAMAIS INVENTER ci-dessus) — ne l'utilise pas comme unité de poids.
- Exemples complets : "6X1L" -> quantite_nette 1, unite_quantite "L", nombre_unites 6. "125G" -> quantite_nette 125, unite_quantite "g", nombre_unites 1. "2x500ml" -> quantite_nette 500, unite_quantite "ml", nombre_unites 2. "50CL" -> quantite_nette 50, unite_quantite "cl", nombre_unites 1.
- Si le format est absent, illisible ou non interprétable en quantité : mets les TROIS champs (quantite_nette, unite_quantite, nombre_unites) à null. N'invente aucune quantité.
CODES TVA Carrefour : chaque ligne produit commence par UN SEUL chiffre isolé (1, 2, 4, 6, 8…) suivi d'un espace puis du nom du produit. Ce chiffre est TOUJOURS un code TVA, jamais une quantité. La quantité est TOUJOURS 1 sauf si la ligne contient explicitement un multiplicateur 'x' (ex: 1,95x2). Ne jamais utiliser le code TVA comme quantité, même si aucun multiplicateur n'est présent.
Règles pour qty, unit_price, price et total (IMPORTANT — lis chaque ligne entièrement avant de décider) :
- Un multiplicateur peut s'écrire "x" OU "×" (signe multiplication), avec ou sans espaces : "1,95x2", "1,29 × 2", "10,13 x2". Le nombre À GAUCHE du x/× est le PRIX UNITAIRE (le prix d'UN seul article). Le nombre À DROITE du x/× est la QUANTITÉ.
- Quand il y a un multiplicateur : qty = le nombre à droite, unit_price = price = le montant à gauche, total = unit_price × qty. Sur la même ligne, un montant plus élevé imprimé en fin de ligne est le TOTAL de la ligne (= unit_price × qty), ce n'est JAMAIS le prix unitaire. Exemple concret : "Soda cola 1,29 ×2 ... 2,58" → qty=2, unit_price=1,29, price=1,29, total=2,58 (surtout PAS qty=1 / unit_price=2,58).
- Si pas de multiplicateur : qty = 1, unit_price = price = total = le montant affiché sur la ligne.
- CONTRÔLE DE COHÉRENCE obligatoire sur chaque ligne : total doit être égal à unit_price × qty. Si un total est imprimé et qu'un multiplicateur est présent, déduis unit_price = total ÷ qty ; ne mets jamais le total dans unit_price.${consignesV14 ? CONSIGNE_V14_LIGNES : ""}
Ignore uniquement les lignes non-produits : total, sous-total, TVA, remises globales, modes de paiement, points fidélité.
RÈGLE ABSOLUE : extraire CHAQUE article du ticket sans exception.
- Parcours le ticket de haut en bas, ligne par ligne, sans en sauter aucune.
- Inclus les articles dans TOUTES les sections sans exception : alimentaire, "Entretien", "Entretien Hyg-Beauté", "Hygiène", "Non alimentaire", "Bazar", et toute autre section.
- Inclus ABSOLUMENT le dernier article de chaque section, y compris ceux situés juste avant une ligne de total ou de sous-total.
- Ne t'arrête pas à la première section : continue jusqu'à la fin du ticket.
- Si une ligne comporte un nom de produit et un prix, c'est un article à extraire — quelle que soit sa position sur le ticket.
- Un article manquant est une erreur grave.${refSection}`;
}

// ── Entrée : quatre noms de champ acceptés ─────────────────────────────────
// imageBase64 / imagesBase64 : noms historiques (v13, app actuelle).
// image / images : noms du contrat chantier 120. Une seule image -> appel v13.
// Renvoie { images, multi } : multi = la requête a utilisé un champ LISTE.
export function lireImagesRequete(corps: Record<string, unknown>): { images: string[]; multi: boolean } {
  const liste = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0) as string[] : []);
  const multi = liste(corps?.imagesBase64);
  if (multi.length > 0) return { images: multi, multi: true };
  const multiV14 = liste(corps?.images);
  if (multiV14.length > 0) return { images: multiV14, multi: true };
  const seule = corps?.imageBase64 ?? corps?.image;
  return typeof seule === "string" && seule.length > 0 ? { images: [seule], multi: false } : { images: [], multi: false };
}

// ── Sortie : champs v14 garantis (additif) ─────────────────────────────────
// remise : nombre >= 0 sur chaque ligne (0 si absent / illisible / négatif
// écrit « -2,15 » -> 2.15) ; captures_peut_etre_incompletes : booléen.
// Tout le reste est rendu tel quel.
export function normaliserSortieV14<T extends Record<string, unknown>>(parsed: T): T {
  if (!parsed || typeof parsed !== "object") return parsed;
  const nombre = (v: unknown) => {
    const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
    return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : 0;
  };
  const produits = Array.isArray(parsed.products)
    ? (parsed.products as Record<string, unknown>[]).map((p) => (p && typeof p === "object" ? { ...p, remise: nombre(p.remise) } : p))
    : parsed.products;
  return {
    ...parsed,
    products: produits,
    captures_peut_etre_incompletes: parsed.captures_peut_etre_incompletes === true,
  };
}
