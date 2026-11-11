// Edge Function scan-ticket — cœur de la lecture d'un ticket, SANS AUCUNE
// DÉPENDANCE (ni Deno, ni npm) : le même fichier est importé par index.ts
// (Deno, en production) et par la fonction de test du serveur de dev
// (vite.config.js, Node). Le serveur de dev teste donc EXACTEMENT les
// consignes, l'hébergeur imposé et les journaux qui seront déployés.
//
// Correctif « scan anti-invention » (11/11) — constat en prod : le même ticket
// Utile (5 lignes, 14,68 €) scanné trois fois a donné 7, 21 puis 5 produits,
// avec des lignes inventées (« BAGUETTE COURTE », « CHAUSSON POMME »), une
// ligne de paiement prise pour un article (« CARTE 7,28 € »), une adresse et
// une date absentes du ticket. Trois ajouts, rien d'autre :
//   1. un SEUL hébergeur (Anthropic), sans repli : OpenRouter pouvait servir
//      le même modèle par 7 hébergeurs différents, d'où un résultat différent
//      à chaque essai malgré temperature 0 ;
//   2. des consignes anti-invention AJOUTÉES après le texte v13, qui est
//      reproduit au caractère près (aucune règle validée n'est retirée) ;
//   3. des journaux qui disent la taille de l'image reçue et l'hébergeur qui
//      a réellement répondu.

export type ProduitRef = { nom: string; categorie: string };

export const MODELE = "anthropic/claude-sonnet-4-5";

// Routage OpenRouter : uniquement l'hébergeur Anthropic. allow_fallbacks:false
// = si Anthropic est indisponible, l'appel ÉCHOUE (l'app affiche alors son
// message honnête « service momentanément indisponible ») au lieu de partir
// en silence chez un autre hébergeur.
export const FOURNISSEUR = { order: ["anthropic"], allow_fallbacks: false };

export const VERSION_LECTURE = "anti-invention";

// ── Consignes ajoutées (après le texte v13, avant le catalogue) ────────────
// L'exigence de ne rien oublier (RÈGLE ABSOLUE v13) reste en place, juste
// au-dessus : ces règles l'équilibrent, elles ne la remplacent pas.
export const CONSIGNES_ANTI_INVENTION = `
NE JAMAIS INVENTER DE LIGNE (aussi grave qu'en oublier une) :
- Chaque objet de "products" correspond à UNE ligne article RÉELLEMENT IMPRIMÉE et LISIBLE sur l'image. N'ajoute JAMAIS un article que tu ne vois pas écrit, même s'il te paraît probable pour ce type de magasin (pain, viennoiserie, boisson…), et jamais pour « compléter » un total.
- Une ligne en partie illisible : recopie dans "libelle_ticket" seulement ce qui est visible et mets confiance="faible". Si tu ne distingues ni libellé ni prix, ne crée pas de ligne.
- "products" contient un objet par ARTICLE imprimé (un article imprimé sur deux lignes reste UN seul objet, voir ci-dessous) : ni plus, ni moins.
QUANTITÉ IMPRIMÉE SUR LA LIGNE SUIVANTE (fréquent : Utile, Super U, Leclerc Drive…) : quand un libellé d'article est suivi, juste en dessous, d'une ligne SANS libellé de la forme "2X 3.53€ 7.06€", "2 X 3,53 7,06" ou "2 x 8.09 … 16.18", cette ligne FAIT PARTIE de l'article du dessus. Elle donne sa quantité et son prix unitaire, imprimés : qty = le nombre devant le X, unit_price = price = le montant juste après le X, total = le montant en fin de ligne.
- Exemple de disposition (le libellé est un gabarit : recopie TOUJOURS celui réellement imprimé, n'utilise jamais les mots de cet exemple) :
  "B <libellé de l'article>"
  "      2X   3.53€                7.06€"
  -> UN seul objet : libelle_ticket = le libellé imprimé sur la 1re ligne, qty 2, unit_price 3.53, price 3.53, total 7.06. SURTOUT PAS qty 1 avec un prix de 7.06.
- Ce multiplicateur sur la ligne suivante est un multiplicateur EXPLICITE au sens de la règle des codes TVA ("quantité TOUJOURS 1 sauf multiplicateur") : il s'applique.
- Cette ligne n'est ni un article à part, ni une ligne à ignorer : ne la jette pas, reporte ses chiffres sur l'article du dessus.
- Vérification : si le ticket imprime un nombre d'articles ("NB ARTICLES", "NOMBRE D'ARTICLES"…), la somme des qty devrait en général lui être égale. S'il en manque, relis les lignes "NX" sous les libellés — mais n'augmente JAMAIS une quantité sans multiplicateur réellement imprimé, et ne modifie jamais "nombre_articles" (il reste le chiffre imprimé).
OÙ SONT LES ARTICLES : uniquement dans la liste imprimée AVANT le TOTAL final à payer ("TOTAL", "TOTAL A PAYER", "NET A PAYER", "MONTANT DU"). Les sous-totaux de section ("SOUS-TOTAL", "S/TOTAL", total d'une section) ne marquent PAS la fin de la liste : continue après eux, comme le demande la RÈGLE ABSOLUE. Tout ce qui est imprimé APRÈS le total final n'est jamais un article.
LIGNES QUI NE SONT JAMAIS DES ARTICLES, même quand elles portent un montant :
- les paiements : "CARTE", "CB", "CARTE BANCAIRE", "CARTE BLEUE", "SANS CONTACT", "ESPECES", "CHEQUE", "RENDU", "A RENDRE", "PAIEMENT" ;
- la TVA : lignes "TVA", "HT", "TTC", taux et récapitulatif de TVA (à ne pas confondre avec le code TVA à un chiffre en début de ligne article, voir CODES TVA Carrefour) ;
- les totaux : "SOUS-TOTAL", "S/TOTAL", "TOTAL".
Exemple : "CARTE 7,28" est un paiement par carte bancaire, PAS un produit.
ADRESSE ET DATE — RECOPIÉES, JAMAIS DEVINÉES :
- "address" : uniquement l'adresse IMPRIMÉE sur le ticket, recopiée telle quelle. Ne la complète JAMAIS avec ce que tu sais ou supposes du magasin ou de l'enseigne : aucune rue, aucun code postal, aucune ville déduits. Si aucune adresse n'est imprimée lisiblement : chaîne vide "".
- "address" ne contient QUE le numéro, la rue, le code postal et la ville DU MAGASIN : l'adresse imprimée juste sous le nom du magasin, en haut du ticket. N'y mets JAMAIS le nom ou le numéro du magasin ("MAGASIN …", "N°…"), ni l'adresse de la société exploitante ou du siège (bloc qui suit une raison sociale, "SAS", "SARL", "EXPLOITATION", ou accompagné du SIRET / de la TVA intracommunautaire).
- "date" : uniquement la date IMPRIMÉE du passage en caisse (voir la règle DATE). Si elle n'est pas lisible telle quelle : null. N'utilise jamais la date du jour ni une date supposée.`;

// ── Construction des consignes ─────────────────────────────────────────────
// Texte v13 recopié mécaniquement depuis index.ts (commit a771c7c) : seul
// l'ajout CONSIGNES_ANTI_INVENTION, inséré juste avant le catalogue, diffère.
// `antiInvention: false` redonne le texte v13 au caractère près (comparaison
// possible avec l'ancien index.ts).
export function construirePromptTicket({
  nbImages,
  isMulti,
  refProducts = [],
  antiInvention = true,
}: { nbImages: number; isMulti: boolean; refProducts?: ProduitRef[]; antiInvention?: boolean }): string {
  const images = { length: nbImages };
  const refSection = refProducts.length > 0
    ? `\n\nCatalogue de référence (${refProducts.length} produits génériques) :\n` +
      refProducts.map((p: ProduitRef) => `- ${p.nom} (${p.categorie})`).join("\n") +
      `\n\nPour chaque article du ticket, cherche dans ce catalogue le nom générique le plus proche (ex : "LT DEMI ECR" → "Lait demi-écrémé", "POULET ROT" → "Poulet rôti"). Utilise ce nom officiel dans le champ "name" UNIQUEMENT si la correspondance est franche. Si aucune correspondance n'est évidente, NE force PAS un rapprochement approximatif : laisse "name" vide ou recopie simplement le libellé du ticket normalisé (majuscules → minuscules, abréviations développées), et mets confiance="faible".`
    : `\nNormalise les noms abrégés (ex: LT DEMI ECR → Lait demi-écrémé).`;
  const ajout = antiInvention ? CONSIGNES_ANTI_INVENTION : "";
  return `${isMulti
                ? `Ces ${images.length} images sont des morceaux successifs d'UN SEUL ticket de caisse, pris dans l'ordre de haut en bas. Les photos peuvent se CHEVAUCHER : un même produit peut apparaître en bas d'une photo et en haut de la suivante. Tu dois reconstituer UNE SEULE liste de produits, dans l'ordre, en supprimant les doublons dus au chevauchement (ne compte chaque produit qu'une seule fois). Le magasin et la date sont en général sur la première image.\n\n`
                : ""}Analyse ce ticket de caisse et extrait les informations suivantes en JSON uniquement, sans texte avant ou après :
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
}
CONTRÔLE DE COHÉRENCE DU TICKET (champs "total_ticket" et "nombre_articles") :
- "total_ticket" (nombre) : le MONTANT TOTAL PAYÉ tel qu'il est IMPRIMÉ sur le ticket (ligne "TOTAL", "TOTAL A PAYER", "NET A PAYER", "MONTANT DU"). C'est le total du ticket, PAS la somme que tu calculerais toi-même à partir des lignes.
- "nombre_articles" (nombre entier) : le NOMBRE D'ARTICLES tel qu'il est IMPRIMÉ sur le ticket (ligne "NOMBRE D'ARTICLES", "NB ARTICLES", "TOTAL ARTICLES"). Là encore, c'est le chiffre imprimé, PAS le nombre de lignes que tu as extraites.
- Si l'un de ces deux chiffres n'est pas imprimé, ou est illisible : mets null. NE LE CALCULE PAS, NE LE DEVINE PAS. Ces deux champs servent à vérifier ta propre lecture : une valeur inventée à partir des lignes rendrait le contrôle inutile, et un ticket mal lu passerait pour bon.
- "total_remises" (nombre) : le TOTAL DES REMISES tel qu'il est IMPRIMÉ sur le ticket (ligne "TOTAL REMISES", "REMISES", "AVANTAGES", "ECONOMIES REALISEES", "TOTAL AVANTAGES"). Les prix des lignes article sont AVANT remise, alors que "total_ticket" est APRÈS remise : sans ce chiffre, la vérification est faussée sur tout ticket en promotion.
  - Si le ticket ne comporte AUCUNE remise ni promotion : mets 0.
  - Si un total de remises est imprimé : recopie-le.
  - Si des remises apparaissent (lignes "2+1", "REMISE 50%", "OFFRE") mais QU'AUCUN total de remises n'est imprimé : mets null. NE LES ADDITIONNE PAS toi-même — un total calculé serait une donnée inventée, et mieux vaut renoncer à vérifier que vérifier faux.
  - Les remises ne sont JAMAIS des lignes de "products". Elles ne figurent que dans ce champ.
DATE — même exigence : "date" doit être la date IMPRIMÉE du passage en caisse. Ne la déduis JAMAIS d'un autre nombre du ticket : un numéro de téléphone, un numéro de caisse, un code TVA ou un numéro de ticket ne sont PAS des dates. Si aucune date de passage en caisse n'est lisible, mets null plutôt qu'une date reconstituée.
Pour chaque ligne article, retourne aussi libelle_ticket : le texte tel qu'il est imprimé sur le ticket, recopié au plus proche, sans correction, sans reformulation, sans interprétation produit. Si le texte exact est partiellement illisible, conserve ce qui est visible et n'invente pas.
CONFIANCE (champ "confiance", obligatoire, valeur "haute" ou "faible") :
- Mets "haute" UNIQUEMENT quand le rattachement du "name" est franc : le libellé du ticket correspond clairement à un produit (idéalement une entrée du catalogue de référence), sans ambiguïté.
- Mets "faible" dès qu'il n'y a PAS de correspondance franche : libellé trop vague, abréviation ambiguë, ou tu dois deviner. Ne force JAMAIS une devinette pour éviter "faible" : dans le doute, c'est "faible".
NE PAS FORCER UN RATTACHEMENT (règle la plus importante) : si AUCUN produit du catalogue ne correspond franchement au libellé du ticket, tu NE forces PAS un rapprochement approximatif. Dans ce cas : laisse "name" VIDE (ou recopie le libellé brut simplement normalisé) et mets confiance="faible". Rattacher FAUX est PIRE que ne pas rattacher : mieux vaut une ligne non rattachée et signalée "faible" qu'un faux rattachement silencieux. Exemple : "DRP LOW CERISE PET 1.5L" est un sirop — il ne doit SURTOUT PAS devenir "eau de source plate" juste parce que ce serait la moins mauvaise entrée du catalogue ; laisse "name" vide/brut et confiance="faible".
NE JAMAIS INVENTER D'ATTRIBUT : n'ajoute JAMAIS au "name" une caractéristique qui n'est pas ÉCRITE LITTÉRALEMENT dans le libellé du ticket. Exemples d'attributs à ne pas inférer : plate vs gazeuse, entier vs demi-écrémé vs écrémé, nature vs aromatisé, bio, etc.
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
- CONTRÔLE DE COHÉRENCE obligatoire sur chaque ligne : total doit être égal à unit_price × qty. Si un total est imprimé et qu'un multiplicateur est présent, déduis unit_price = total ÷ qty ; ne mets jamais le total dans unit_price.
Ignore uniquement les lignes non-produits : total, sous-total, TVA, remises globales, modes de paiement, points fidélité.
RÈGLE ABSOLUE : extraire CHAQUE article du ticket sans exception.
- Parcours le ticket de haut en bas, ligne par ligne, sans en sauter aucune.
- Inclus les articles dans TOUTES les sections sans exception : alimentaire, "Entretien", "Entretien Hyg-Beauté", "Hygiène", "Non alimentaire", "Bazar", et toute autre section.
- Inclus ABSOLUMENT le dernier article de chaque section, y compris ceux situés juste avant une ligne de total ou de sous-total.
- Ne t'arrête pas à la première section : continue jusqu'à la fin du ticket.
- Si une ligne comporte un nom de produit et un prix, c'est un article à extraire — quelle que soit sa position sur le ticket.
- Un article manquant est une erreur grave.${ajout}${refSection}`;
}

// ── Images reçues ──────────────────────────────────────────────────────────
// Accepte les noms de champs de l'app (imageBase64 / imagesBase64), comme la
// v13. Une liste d'images, même d'une seule, garde le préambule « morceaux »
// (comportement v13 inchangé).
export function lireImagesRequete(corps: { imageBase64?: unknown; imagesBase64?: unknown } | null | undefined): { images: string[]; isMulti: boolean } {
  const liste = Array.isArray(corps?.imagesBase64) ? (corps!.imagesBase64 as unknown[]).filter((x) => typeof x === "string" && x) as string[] : [];
  if (liste.length > 0) return { images: liste, isMulti: true };
  const une = typeof corps?.imageBase64 === "string" && corps!.imageBase64 ? [corps!.imageBase64 as string] : [];
  return { images: une, isMulti: false };
}

function octetsBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}

// Largeur × hauteur d'un JPEG lues dans son en-tête (marqueur SOF), sans
// décoder l'image. On ne lit que le début du fichier : l'app produit un JPEG
// de canvas, sans EXIF, dont l'en-tête est tout au début. null si ce n'est
// pas un JPEG lisible — un journal ne doit jamais faire échouer la lecture.
export function dimensionsJpeg(b64: string): { largeur: number; hauteur: number } | null {
  try {
    const debut = b64.slice(0, 87380 - (87380 % 4)); // ~64 Ko d'en-tête
    const o = octetsBase64(debut);
    if (o[0] !== 0xff || o[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < o.length) {
      if (o[i] !== 0xff) return null;
      const marqueur = o[i + 1];
      if (marqueur === 0xff) { i += 1; continue; }
      const estSof = marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc;
      if (estSof) {
        return { hauteur: (o[i + 5] << 8) | o[i + 6], largeur: (o[i + 7] << 8) | o[i + 8] };
      }
      const longueur = (o[i + 2] << 8) | o[i + 3];
      if (longueur < 2) return null;
      i += 2 + longueur;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

// Taille de chaque image reçue, pour les journaux : poids réel en Ko et
// dimensions en pixels. Une image vide, minuscule ou trop réduite se voit
// alors au premier coup d'œil.
export function infosImages(images: string[]): Array<{ ko: number; largeur: number | null; hauteur: number | null }> {
  return images.map((b64) => {
    const remplissage = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    const octets = Math.max(0, Math.floor((b64.length * 3) / 4) - remplissage);
    const dim = dimensionsJpeg(b64);
    return { ko: Math.round(octets / 1024), largeur: dim?.largeur ?? null, hauteur: dim?.hauteur ?? null };
  });
}

// ── Corps de la requête OpenRouter ─────────────────────────────────────────
export function construireCorpsOpenRouter({ images, isMulti, refProducts = [] }: { images: string[]; isMulti: boolean; refProducts?: ProduitRef[] }) {
  return {
    model: MODELE,
    // Correctif anti-invention — un seul hébergeur, sans repli (voir FOURNISSEUR).
    provider: FOURNISSEUR,
    max_tokens: 16000,
    // Chantier 98 — extraction déterministe : sans temperature explicite,
    // OpenRouter applique la valeur par défaut (1.0), ce qui rend la
    // lecture instable d'un jour à l'autre sur la MÊME photo (constaté :
    // 2 produits la veille, 0 le lendemain). Pour de l'OCR/extraction,
    // temperature 0.
    temperature: 0,
    messages: [{
      role: "user",
      content: [
        ...images.map((b64: string) => ({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${b64}` },
        })),
        { type: "text", text: construirePromptTicket({ nbImages: images.length, isMulti, refProducts }) },
      ],
    }],
  };
}

type Journal = { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

// ── LA lecture complète d'un ticket (après l'authentification) ─────────────
// Appelée telle quelle par index.ts (prod) et par la fonction de test du
// serveur de dev. Renvoie l'objet lu, ou lève une Error au message lisible
// (même messages que la v13).
export async function lireTicket({
  corps,
  apiKey,
  fetchFn,
  journal = console,
  prefixe = "[scan-ticket]",
}: {
  corps: { imageBase64?: unknown; imagesBase64?: unknown; refProducts?: unknown } | null;
  apiKey: string | undefined;
  fetchFn: typeof fetch;
  journal?: Journal;
  prefixe?: string;
}): Promise<unknown> {
  const { images, isMulti } = lireImagesRequete(corps);
  if (images.length === 0) throw new Error("imageBase64 ou imagesBase64 manquant");
  const refProducts = (Array.isArray(corps?.refProducts) ? corps!.refProducts : []) as ProduitRef[];
  if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurée côté serveur");

  const tailles = infosImages(images);

  const response = await fetchFn("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(construireCorpsOpenRouter({ images, isMulti, refProducts })),
  });

  // deno-lint-ignore no-explicit-any
  const data: any = await response.json();
  if (!response.ok) {
    // Journalisation seule : statut HTTP et corps complet renvoyés par
    // OpenRouter, plus la taille des images reçues.
    journal.error(`${prefixe} OpenRouter non-2xx`, response.status, JSON.stringify({ images: tailles, reponse: data }));
    throw new Error(data?.error?.message || `Erreur HTTP ${response.status}`);
  }

  const text = data.choices?.[0]?.message?.content || "";
  const clean = text.replace(/```json|```/g, "").trim();
  if (!clean) throw new Error("Réponse vide du modèle");

  // Parsing robuste : on isole la sous-chaîne entre le PREMIER "{" et le
  // DERNIER "}" (le modèle peut ajouter du texte autour, ou une réponse
  // tronquée sur un gros ticket laisse du bruit). Si le parse échoue quand
  // même (réponse coupée en plein milieu du JSON), message clair plutôt
  // que l'erreur brute de JSON.parse.
  const debut = clean.indexOf("{");
  const fin = clean.lastIndexOf("}");
  const jsonCandidat = (debut !== -1 && fin !== -1 && fin > debut)
    ? clean.slice(debut, fin + 1)
    : clean;

  // deno-lint-ignore no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(jsonCandidat);
  } catch (_e) {
    throw new Error("Réponse du modèle incomplète (ticket trop long ?), réessaie");
  }

  // Chantier 98 — observabilité des succès. Correctif anti-invention :
  // + taille des images reçues, hébergeur et modèle qui ont réellement répondu.
  journal.log(`${prefixe} ok`, JSON.stringify({
    produits: Array.isArray(parsed?.products) ? parsed.products.length : null,
    total_ticket: parsed?.total_ticket ?? null,
    nombre_articles: parsed?.nombre_articles ?? null,
    total_remises: parsed?.total_remises ?? null,
    images: images.length,
    tailles_images: tailles,
    fournisseur: data?.provider ?? null,
    modele: data?.model ?? null,
    version: VERSION_LECTURE,
    finish_reason: data.choices?.[0]?.finish_reason ?? null,
  }));

  return parsed;
}

// ── Sens de la photo (correctif orientation, 11/11) ────────────────────────
// Constat : un iPhone tenu à plat au-dessus d'un ticket enregistre souvent la
// photo COUCHÉE (2000 × 1500 au lieu de 1500 × 2000) ; le lecteur lit alors un
// texte de travers et invente. Le sens ne se déduit pas des dimensions (une
// photo tête en bas a les mêmes que debout) : l'app envoie 4 miniatures de la
// photo, tournées de 0, 90, 180 et 270° (sens horaire), et un modèle rapide
// dit laquelle se lit à l'endroit. Deux questions en parallèle, avec les
// miniatures dans deux ordres opposés : on ne conclut que si les deux
// réponses désignent la même rotation, avec certitude. Sinon : sens incertain
// et l'app demande de reprendre la photo — aucune image douteuse ne part au
// lecteur. Banc d'essai : 24/24 (6 tickets × 4 sens), ~3 s, ~0,2 centime.

export const MODELE_ORIENTATION = "anthropic/claude-haiku-4.5";
export const ROTATIONS = [0, 90, 180, 270];

export const CONSIGNE_ORIENTATION = `Ces 4 images numérotées 1 à 4 sont LA MÊME photo d'un ticket de caisse, tournée de 4 façons différentes (un quart de tour d'écart entre chaque).
Une seule est dans le bon sens : le texte se lit normalement, lignes horizontales, de gauche à droite et de haut en bas, lettres à l'endroit (pas à l'envers, pas couchées).
Réponds UNIQUEMENT en JSON : {"droite": <numéro de l'image dans le bon sens>, "certain": true|false}.
Si le texte est illisible sur les 4 images, ou si tu hésites entre deux images, réponds {"droite": null, "certain": false}.`;

export type Candidat = { rotation: number; image: string };

// Les 4 miniatures reçues, une par rotation, ou null si la demande est
// incomplète (on ne conclut jamais sur moins de 4 candidats).
export function lireCandidatsOrientation(corps: { orientation?: { candidats?: unknown } } | null | undefined): Candidat[] | null {
  const liste = corps?.orientation?.candidats;
  if (!Array.isArray(liste) || liste.length !== 4) return null;
  const candidats = liste.filter((c): c is Candidat =>
    !!c && typeof c === "object" && ROTATIONS.includes((c as Candidat).rotation) && typeof (c as Candidat).image === "string" && !!(c as Candidat).image);
  if (candidats.length !== 4) return null;
  if (new Set(candidats.map((c) => c.rotation)).size !== 4) return null;
  return candidats;
}

export function construireCorpsOrientation(ordre: Candidat[]) {
  const content: unknown[] = [];
  ordre.forEach((c, i) => {
    content.push({ type: "text", text: `Image ${i + 1} :` });
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${c.image}` } });
  });
  content.push({ type: "text", text: CONSIGNE_ORIENTATION });
  return {
    model: MODELE_ORIENTATION,
    provider: FOURNISSEUR,
    temperature: 0,
    max_tokens: 50,
    messages: [{ role: "user", content }],
  };
}

// Réponse du modèle -> rotation désignée (ou null). Tout ce qui n'est pas une
// réponse nette (JSON illisible, numéro hors 1-4, certain:false) vaut null.
export function interpreterReponseOrientation(texte: string, ordre: Candidat[]): { rotation: number | null; certain: boolean } {
  try {
    const t = String(texte || "");
    const json = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    const n = Number(json?.droite);
    if (json?.certain !== true || !Number.isInteger(n) || n < 1 || n > ordre.length) return { rotation: null, certain: false };
    return { rotation: ordre[n - 1].rotation, certain: true };
  } catch (_e) {
    return { rotation: null, certain: false };
  }
}

// Les deux avis doivent être certains ET désigner la même rotation.
export function conclureOrientation(avis: Array<{ rotation: number | null; certain: boolean }>): { rotation: number | null; certain: boolean } {
  if (avis.length < 2) return { rotation: null, certain: false };
  const r = avis[0].rotation;
  const accord = r != null && avis.every((a) => a.certain && a.rotation === r);
  return accord ? { rotation: r, certain: true } : { rotation: null, certain: false };
}

export async function verifierOrientation({
  corps,
  apiKey,
  fetchFn,
  journal = console,
  prefixe = "[scan-ticket]",
}: {
  corps: { orientation?: { candidats?: unknown } } | null;
  apiKey: string | undefined;
  fetchFn: typeof fetch;
  journal?: Journal;
  prefixe?: string;
}): Promise<{ orientation: { rotation: number | null; certain: boolean } }> {
  const candidats = lireCandidatsOrientation(corps);
  if (!candidats) throw new Error("orientation : 4 miniatures attendues (0, 90, 180, 270)");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurée côté serveur");

  // Deux ordres opposés : chaque miniature change de numéro d'une question à
  // l'autre, un tic du modèle sur un numéro ne peut pas passer pour un accord.
  const ordres = [candidats, [...candidats].reverse()];
  const debut = Date.now();
  const reponses = await Promise.all(ordres.map(async (ordre) => {
    const r = await fetchFn("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(construireCorpsOrientation(ordre)),
    });
    // deno-lint-ignore no-explicit-any
    const data: any = await r.json();
    if (!r.ok) {
      journal.error(`${prefixe} orientation non-2xx`, r.status, JSON.stringify(data));
      throw new Error(data?.error?.message || `Erreur HTTP ${r.status}`);
    }
    return { data, avis: interpreterReponseOrientation(data.choices?.[0]?.message?.content || "", ordre) };
  }));
  const conclusion = conclureOrientation(reponses.map((x) => x.avis));

  journal.log(`${prefixe} orientation`, JSON.stringify({
    rotation: conclusion.rotation,
    certain: conclusion.certain,
    avis: reponses.map((x) => x.avis.rotation),
    // deno-lint-ignore no-explicit-any
    recadrage: (corps as any)?.orientation?.recadrage ?? null,
    tailles_miniatures: infosImages(candidats.map((c) => c.image)),
    fournisseur: reponses[0].data?.provider ?? null,
    modele: reponses[0].data?.model ?? null,
    duree_ms: Date.now() - debut,
  }));

  return { orientation: conclusion };
}

// Point d'entrée unique de la fonction (prod et serveur de dev) : une demande
// { orientation: { candidats } } vérifie le sens, toute autre lit le ticket.
export function traiterRequeteScan(args: Parameters<typeof lireTicket>[0]): Promise<unknown> {
  // deno-lint-ignore no-explicit-any
  if ((args.corps as any)?.orientation) return verifierOrientation(args as Parameters<typeof verifierOrientation>[0]);
  return lireTicket(args);
}
