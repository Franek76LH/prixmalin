import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { traiterRequeteScan } from "./lecture.ts";

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
    // Correctif « scan anti-invention » — la lecture du ticket (consignes,
    // hébergeur unique Anthropic, analyse, journaux) ET la vérification du sens
    // de la photo (demande { orientation }) vivent dans lecture.ts, sans
    // dépendance, pour que le serveur de dev teste exactement ce code.
    // Authentification et CORS ci-dessus : inchangés.
    const parsed = await traiterRequeteScan({
      corps: await req.json(),
      apiKey: Deno.env.get("OPENROUTER_API_KEY"),
      fetchFn: fetch,
    });

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
