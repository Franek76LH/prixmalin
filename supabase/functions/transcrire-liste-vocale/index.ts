// Chantier « Micro » — LOT 2 : transcription d'une prise vocale en liste de
// courses structurée. UN SEUL appel IA fait transcription + extraction
// (quantités, corrections orales, négations), même clé OPENROUTER_API_KEY que
// scan-ticket. L'audio n'est JAMAIS stocké : il transite, il est transcrit,
// la réponse ne contient que du texte. Modèle audio (Claude ne prend pas
// l'audio en entrée) : google/gemini-2.5-flash via OpenRouter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Formats acceptés par OpenRouter (input_audio). Safari iOS produit du
// audio/mp4 (AAC) => "m4a" ; Chrome/Android du audio/webm (souvent opus).
const FORMATS_AUTORISES = new Set(["m4a", "aac", "mp3", "wav", "ogg", "flac", "webm"]);

// ~12 Mo de base64 (≈ 9 Mo d'audio réel) : très au-dessus d'une prise de
// 3 minutes en AAC (~1,5 Mo), garde-fou contre un payload aberrant.
const TAILLE_MAX_BASE64 = 12_000_000;

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
    const { audioBase64, format } = await req.json();
    if (!audioBase64 || typeof audioBase64 !== "string") throw new Error("audioBase64 manquant");
    if (audioBase64.length > TAILLE_MAX_BASE64) throw new Error("Audio trop volumineux, réessaie avec une prise plus courte");

    // "mp4" (mime audio/mp4 de Safari) est normalisé en "m4a" côté front,
    // mais on re-normalise ici par sécurité.
    const fmt = String(format || "m4a").toLowerCase().replace(/^mp4$/, "m4a");
    if (!FORMATS_AUTORISES.has(fmt)) throw new Error(`Format audio non géré : ${fmt}`);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurée côté serveur");

    const prompt = `Cet audio est une personne qui prépare sa LISTE DE COURSES en français, en inspectant son réfrigérateur et ses placards. Elle énonce librement ce qui lui manque, avec des pauses, des hésitations, parfois des corrections.

Transcris l'audio puis extrais la liste structurée. Réponds en JSON UNIQUEMENT, sans texte avant ou après :
{
  "transcription": "texte complet de ce qui a été dit",
  "elements": [
    { "texte_entendu": "les mots exacts prononcés pour cet élément", "nom": "nom générique du produit", "quantite": null, "unite": null, "qualificatifs": null, "confiance": "haute" }
  ],
  "elements_ignores": [
    { "texte_entendu": "...", "raison": "pourquoi cet élément est écarté" }
  ]
}

RÈGLES D'EXTRACTION :
- Chaque produit ou besoin distinct = UN élément. Une même phrase peut en contenir plusieurs ("de l'eau, du lait et des haricots" -> 3 éléments).
- "nom" : le produit en générique, court, sans quantité ni marque (ex "beurre", "lait", "yaourts nature"). Un adjectif utile prononcé (nature, demi-écrémé, bio...) reste dans le nom s'il précise le produit, sinon dans "qualificatifs". Une marque prononcée va dans "qualificatifs".
- "quantite" : nombre si prononcé, y compris en lettres ("six yaourts" -> 6). Quantité vague ("quelques", "un peu de") -> quantite null et le mot dans "qualificatifs". JAMAIS de quantité inventée.
- "unite" : uniquement si prononcée (bouteilles, packs, boîtes, kg, g, litres...), sinon null.
- CORRECTION ORALE (règle la plus importante) : quand la personne se corrige ("du lait... non, deux bouteilles de lait" ; "deux bouteilles de lait... non, finalement une seule"), le produit RESTE dans "elements" avec la valeur FINALE corrigée. Une correction n'est JAMAIS une annulation : elle ne va JAMAIS dans "elements_ignores". Exemple ANCRÉ : "il me faut deux bouteilles de lait... non, finalement une seule, de l'eau, des haricots" -> "elements" contient { nom: "lait", quantite: 1, unite: "bouteille" } PLUS { nom: "eau" } PLUS { nom: "haricots" }, et "elements_ignores" est vide. Faire DISPARAÎTRE le lait ici serait une erreur grave.
- Une quantité (ou sa correction) s'applique UNIQUEMENT au produit qu'elle concerne, JAMAIS au produit voisin dans la phrase. Dans l'exemple ci-dessus, "une seule" corrige le LAIT ; l'eau et les haricots restent SANS quantité.
- NÉGATION (= renoncement au produit) : "pas besoin de sucre", "finalement non pour le riz", "annule le riz" -> ne PAS mettre dans "elements" ; mettre dans "elements_ignores" avec la raison. "elements_ignores" sert UNIQUEMENT aux renoncements explicites et aux ambiguïtés notables — JAMAIS aux corrections de quantité.
- Hésitations et répétitions IMMÉDIATES ("du... du lait") -> une seule entrée. Deux mentions ESPACÉES du même produit -> deux entrées séparées (la fusion se fera après).
- Paroles hors sujet (quelqu'un parle à côté, digression) -> ni dans elements ni dans elements_ignores, sauf ambiguïté notable.
- "confiance" : "haute" si le produit est clairement identifiable ; "faible" si le mot est mal articulé, coupé ou incertain. Dans ce cas "texte_entendu" reste au plus proche de ce qui a été entendu. NE JAMAIS deviner un produit à la place d'un mot incompréhensible : mieux vaut confiance "faible" qu'une invention.
- Si aucun produit n'est détecté : "elements": [] (et la transcription quand même).
- "texte_entendu" : toujours les mots réellement prononcés, jamais reformulés.`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 8000,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "input_audio", input_audio: { data: audioBase64, format: fmt } },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("[transcrire-liste-vocale] OpenRouter non-2xx", response.status, JSON.stringify(data));
      throw new Error(data?.error?.message || `Erreur HTTP ${response.status}`);
    }

    const text = data.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();
    if (!clean) throw new Error("Réponse vide du modèle");

    // Même parsing robuste que scan-ticket : sous-chaîne entre le premier "{"
    // et le dernier "}", message clair si le JSON est tronqué.
    const debut = clean.indexOf("{");
    const fin = clean.lastIndexOf("}");
    const jsonCandidat = (debut !== -1 && fin !== -1 && fin > debut)
      ? clean.slice(debut, fin + 1)
      : clean;

    let parsed;
    try {
      parsed = JSON.parse(jsonCandidat);
    } catch (_e) {
      throw new Error("Réponse du modèle incomplète, réessaie");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[transcrire-liste-vocale] echec", err?.message, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
