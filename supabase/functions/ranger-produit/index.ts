import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rangerProduit, PROPOSITION_VIDE } from "./logique.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const A_RECLASSER = "cba4251f-28b5-4f0d-bfb6-70af5c802205";
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Non autorisé" }, 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Non autorisé" }, 401);

  try {
    const proposition = await rangerProduit({
      corps: await req.json(),
      apiKey: Deno.env.get("OPENROUTER_API_KEY"),
      fetchFn: fetch,
      acces: {
        // Lectures faites AVEC les droits de l'utilisateur connecté.
        async chargerRayons() {
          const { data, error } = await supabase.from("sous_categories").select("id, nom, categories(nom, visible)").eq("actif", true);
          if (error) throw new Error(error.message);
          // deno-lint-ignore no-explicit-any
          return (data || []).filter((r: any) => r.id !== A_RECLASSER && r.categories?.visible !== false)
            // deno-lint-ignore no-explicit-any
            .map((r: any) => ({ id: r.id, nom: r.nom, categorie: r.categories?.nom || "" }))
            // deno-lint-ignore no-explicit-any
            .sort((a: any, b: any) => a.categorie.localeCompare(b.categorie, "fr") || a.nom.localeCompare(b.nom, "fr"));
        },
        async chargerFiches(rayonId: string) {
          const { data, error } = await supabase.from("produits").select("id, nom_reference").eq("sous_categorie_id", rayonId).eq("actif", true).order("nom_reference").limit(250);
          if (error) throw new Error(error.message);
          // deno-lint-ignore no-explicit-any
          return (data || []).map((f: any) => ({ id: f.id, nom: f.nom_reference }));
        },
      },
    });
    return json(proposition);
  } catch (err) {
    console.error("[ranger-produit] echec", (err as Error)?.message);
    return json({ ...PROPOSITION_VIDE });
  }
});
