import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// v14 (chantier 120) — prompt et normalisation sortis dans prompt.ts (sans
// dépendance) pour être testés en local sous Node, sans Docker. Le texte v13
// est reproduit au caractère près ; la v14 ne fait qu'AJOUTER des consignes.
import { construirePromptTicket, lireImagesRequete, normaliserSortieV14 } from "./prompt.ts";

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
    // v14 — accepte imageBase64 / imagesBase64 (noms v13, app actuelle) ET
    // image / images (contrat chantier 120). Une seule image -> appel v13.
    const corps = await req.json();
    const refProducts = Array.isArray(corps?.refProducts) ? corps.refProducts : [];
    const { images, multi: isMulti } = lireImagesRequete(corps);
    if (images.length === 0) throw new Error("imageBase64 ou imagesBase64 manquant");

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurée côté serveur");

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
            { type: "text", text: construirePromptTicket({ nbImages: images.length, refProducts, multi: isMulti }) },
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
    // v14 — champs garantis : remise (>= 0) sur chaque ligne,
    // captures_peut_etre_incompletes (booléen). Tout le reste inchangé.
    parsed = normaliserSortieV14(parsed);

    // Chantier 98 — observabilité des succès : jusqu'ici seuls les échecs
    // étaient tracés, un 200 avec 0 produit était invisible dans les logs.
    console.log("[scan-ticket] ok", JSON.stringify({
      produits: Array.isArray(parsed?.products) ? parsed.products.length : null,
      total_ticket: parsed?.total_ticket ?? null,
      nombre_articles: parsed?.nombre_articles ?? null,
      total_remises: parsed?.total_remises ?? null,
      images: images.length,
      version: "v14",
      remises_ligne: Array.isArray(parsed?.products) ? parsed.products.filter((p: { remise?: number }) => (p?.remise ?? 0) > 0).length : null,
      captures_peut_etre_incompletes: parsed?.captures_peut_etre_incompletes ?? null,
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
