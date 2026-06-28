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
        max_tokens: 4000,
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
    { "brand": "marque ou vide", "name": "nom du produit normalisé", "format": "format ou vide", "qty": 1, "unit_price": 0.00, "price": 0.00, "total": 0.00 }
  ]
}
CODES TVA Carrefour : chaque ligne produit commence par UN SEUL chiffre isolé (1, 2, 4, 6, 8…) suivi d'un espace puis du nom du produit. Ce chiffre est TOUJOURS un code TVA, jamais une quantité. La quantité est TOUJOURS 1 sauf si la ligne contient explicitement un multiplicateur 'x' (ex: 1,95x2). Ne jamais utiliser le code TVA comme quantité, même si aucun multiplicateur n'est présent.
Règles pour qty, unit_price, price et total :
- Si la ligne affiche un multiplicateur "x" (ex : 1,95x2 ou 10,13 x2) : qty = le nombre après le x, unit_price = price = le montant avant le x, total = unit_price × qty.
- Si pas de multiplicateur : qty = 1, unit_price = price = total = le montant affiché sur la ligne.
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

    const parsed = JSON.parse(clean);
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
