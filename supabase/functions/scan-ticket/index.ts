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
        `\n\nPour chaque article du ticket, cherche dans ce catalogue le nom générique le plus proche (ex : "LT DEMI ECR" → "Lait demi-écrémé", "POULET ROT" → "Poulet rôti"). Utilise ce nom officiel dans le champ "name". Si aucune correspondance n'est évidente, normalise le nom du ticket (majuscules → minuscules, abréviations développées).`
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
  "products": [
    { "brand": "marque ou vide", "name": "nom du produit normalisé", "libelle_ticket": "texte du ticket recopié tel quel", "format": "format ou vide", "qty": 1, "unit_price": 0.00, "price": 0.00, "total": 0.00 }
  ]
}
Pour chaque ligne article, retourne aussi libelle_ticket : le texte tel qu'il est imprimé sur le ticket, recopié au plus proche, sans correction, sans reformulation, sans interprétation produit. Si le texte exact est partiellement illisible, conserve ce qui est visible et n'invente pas.
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
    if (!response.ok) throw new Error(data?.error?.message || `Erreur HTTP ${response.status}`);

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

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
