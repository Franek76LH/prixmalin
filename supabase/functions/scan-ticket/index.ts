import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Non autorisé" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Non autorisé" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { imageBase64, imagesBase64, refProducts = [] } = await req.json();
    const isMulti = Array.isArray(imagesBase64) && imagesBase64.length > 0;
    if (!imageBase64 && !isMulti) throw new Error("imageBase64 ou imagesBase64 manquant");
    const images: string[] = isMulti ? imagesBase64 : [imageBase64 as string];

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurée côté serveur");

    const refSection = refProducts.length > 0
      ? `\n\nCatalogue de référence (${refProducts.length} produits génériques) :\n` +
        refProducts.map((p: { nom: string; categorie: string }) => `- ${p.nom} (${p.categorie})`).join("\n") +
        `\n\nPour chaque article du ticket, cherche dans ce catalogue le nom générique le plus proche (ex : "LT DEMI ECR" → "Lait demi-écrémé", "POULET ROT" → "Poulet rôti"). Utilise ce nom officiel dans le champ "name" UNIQUEMENT si la correspondance est franche. Si aucune correspondance n'est évidente, NE force PAS un rapprochement approximatif : laisse "name" vide ou recopie simplement le libellé du ticket normalisé (majuscules → minuscules, abréviations développées), et mets confiance="faible".`
      : `\nNormalise les noms abrégés (ex: LT DEMI ECR → Lait demi-écrémé).`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4-5",
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
            { type: "text", text: `${isMulti
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
- Un article manquant est une erreur grave.${refSection}` },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      // Journalisation seule (aucun changement de comportement) : on trace le
      // statut HTTP et le corps complet renvoyés par OpenRouter, pour lire la
      // cause exacte dans les logs Supabase de la fonction.
      console.error("[scan-ticket] OpenRouter non-2xx", response.status, JSON.stringify(data));
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

    let parsed;
    try {
      parsed = JSON.parse(jsonCandidat);
    } catch (_e) {
      throw new Error("Réponse du modèle incomplète (ticket trop long ?), réessaie");
    }

    // Chantier 98 — observabilité des succès : jusqu'ici seuls les échecs
    // étaient tracés, un 200 avec 0 produit était invisible dans les logs.
    console.log("[scan-ticket] ok", JSON.stringify({
      produits: Array.isArray(parsed?.products) ? parsed.products.length : null,
      total_ticket: parsed?.total_ticket ?? null,
      nombre_articles: parsed?.nombre_articles ?? null,
      total_remises: parsed?.total_remises ?? null,
      images: images.length,
      finish_reason: data.choices?.[0]?.finish_reason ?? null,
    }));

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Journalisation seule : trace le message complet de l'échec (y compris
    // celui remonté d'OpenRouter) dans les logs Supabase. Réponse inchangée.
    console.error("[scan-ticket] echec", err?.message, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
