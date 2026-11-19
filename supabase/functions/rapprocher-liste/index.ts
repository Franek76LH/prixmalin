import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rapprocherListe } from "./logique.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
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
    return json(await rapprocherListe({
      corps: await req.json(),
      apiKey: Deno.env.get("OPENROUTER_API_KEY"),
      fetchFn: fetch,
      acces: {
        // Lecture du catalogue AVEC les droits de l'utilisateur connecté, par
        // pages de 1 000 (limite de la base par requête). Rien n'est écrit.
        async chargerFiches() {
          const fiches = [];
          for (let debut = 0; debut < 2000; debut += 1000) {
            const { data, error } = await supabase.from("produits")
              .select("id, nom_reference, sous_categories(nom, categories(visible))")
              .eq("actif", true).order("nom_reference").order("id").range(debut, debut + 999);
            if (error) throw new Error(error.message);
            // deno-lint-ignore no-explicit-any
            for (const p of (data || []) as any[]) {
              if (p.sous_categories?.categories?.visible === false) continue;
              fiches.push({ id: p.id, nom: p.nom_reference, rayon: p.sous_categories?.nom ?? null });
            }
            if (!data || data.length < 1000) break;
          }
          return fiches;
        },
      },
    }));
  } catch (err) {
    console.error("[rapprocher-liste] echec", (err as Error)?.message);
    return json({ resultats: [] });
  }
});
