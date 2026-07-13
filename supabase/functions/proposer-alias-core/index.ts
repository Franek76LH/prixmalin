// #67 v1 — Suggestions d'alias Core par IA, déclenchées à la demande depuis
// AdminRejetsCorePanel.jsx (bouton "Proposer des alias"). Traite en lot,
// SÉQUENTIELLEMENT (jamais d'appels IA parallèles), les rejets
// rejets_ecriture_core éligibles (motif='alias_non_trouve', traite=false,
// sans suggestion existante). Réutilise OPENROUTER_API_KEY (même secret que
// scan-ticket) et le même modèle. N'écrit RIEN dans lignes_ticket/prix/
// alias_produits directement : ne fait qu'enregistrer des suggestions
// 'en_attente' via la RPC enregistrer_suggestion_alias_core_ia. La création
// effective d'alias + prix rétroactif se fait uniquement via
// valider_suggestion_alias_core, appelée depuis le panneau admin après
// validation humaine explicite.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LIMITE_MAX = 25;
const MODELE_IA = "anthropic/claude-sonnet-4-5";
const PROMPT_VERSION = "v1";

const PROMPT_SYSTEME = `Tu es un assistant qui associe un article de ticket de caisse à un produit existant dans un référentiel fermé.

RÈGLES ABSOLUES :
1. Tu ne peux choisir QUE parmi les candidats listés (candidate_id du type "cand_3"). Interdiction absolue d'inventer un produit ou un identifiant hors de cette liste.
2. Le texte prioritaire est "texte_ticket" (texte réel imprimé sur le ticket). "libelle_interprete" n'est qu'un indice complémentaire, parfois peu fiable (une même ligne réelle a déjà été interprétée différemment d'un scan à l'autre du même article).
3. Compare marque, famille de produit, format/quantité/conditionnement.
4. Si aucun candidat ne correspond avec une bonne certitude, réponds "produit_inconnu_du_referentiel". Ne force jamais un choix approximatif.
5. Réponds UNIQUEMENT en JSON strict, sans texte avant/après, au format :
{"resultat": "suggestion", "candidate_id": "cand_12", "confidence": 92, "reason": "Même marque, même famille produit, format cohérent."}
ou :
{"resultat": "produit_inconnu_du_referentiel", "candidate_id": null, "confidence": 0, "reason": "Aucun candidat ne correspond suffisamment."}

confidence : entier 0-100, certitude que le candidat est EXACTEMENT le même produit que celui du ticket.`;

function libelleSourcePourRejet(rejet: any): string | null {
  const libelleTicket = rejet?.payload?.libelle_ticket;
  if (typeof libelleTicket === "string" && libelleTicket.trim()) return libelleTicket.trim();
  if (typeof rejet?.libelle_non_resolu === "string" && rejet.libelle_non_resolu.trim()) {
    return rejet.libelle_non_resolu.trim();
  }
  return null;
}

// Textes utilisés pour ÉLARGIR la recherche de candidats (filet de sécurité),
// pas pour la décision de l'IA : le texte réel du ticket reste toujours
// prioritaire dans le prompt (voir interrogerOpenRouter). Un libelle_ticket
// trop cryptique pour l'OCR (ex. "VBOU 2KRUMSTECK TOURN UBF") peut ne
// remonter aucun candidat par trigramme, alors que libelle_non_resolu
// (l'interprétation IA du scan, ex. "Rumsteck") en trouverait — les deux
// textes sont donc cherchés quand ils diffèrent, et les résultats fusionnés.
function textesRecherchePourRejet(rejet: any): string[] {
  const libelleTicket = typeof rejet?.payload?.libelle_ticket === "string" ? rejet.payload.libelle_ticket.trim() : "";
  const libelleNonResolu = typeof rejet?.libelle_non_resolu === "string" ? rejet.libelle_non_resolu.trim() : "";
  const textes: string[] = [];
  if (libelleTicket) textes.push(libelleTicket);
  if (libelleNonResolu && libelleNonResolu.toLowerCase() !== libelleTicket.toLowerCase()) textes.push(libelleNonResolu);
  return textes;
}

function cleCandidat(c: any): string {
  return `${c.produit_id}|${c.variante_produit_id ?? ""}`;
}

async function interrogerOpenRouter(apiKey: string, texteTicket: string, libelleInterprete: string | null, candidats: any[]) {
  const listeCandidats = candidats.map((c, i) => ({
    candidate_id: `cand_${i + 1}`,
    nom: c.nom_reference,
    marque: c.marque || null,
    variante: c.libelle_variante || null,
  }));

  const contenuUtilisateur = JSON.stringify({
    texte_ticket: texteTicket,
    libelle_interprete: libelleInterprete,
    candidats: listeCandidats,
  });

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODELE_IA,
      max_tokens: 500,
      messages: [
        { role: "system", content: PROMPT_SYSTEME },
        { role: "user", content: contenuUtilisateur },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Erreur HTTP ${response.status}`);

  const text = data.choices?.[0]?.message?.content || "";
  const clean = text.replace(/```json|```/g, "").trim();
  if (!clean) throw new Error("Réponse vide du modèle");

  const parsed = JSON.parse(clean);
  return { parsed, candidatsById: new Map(listeCandidats.map((c, i) => [c.candidate_id, candidats[i]])) };
}

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

  // Vérification admin explicite ici (en plus des vérifications internes de
  // chaque RPC) pour échouer vite et clairement, sans consommer d'appel IA.
  const { data: estAdmin } = await supabase.rpc("est_administrateur");
  if (!estAdmin) {
    return new Response(JSON.stringify({ error: "Réservé aux administrateurs" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurée côté serveur");

    let limite = LIMITE_MAX;
    try {
      const body = await req.json();
      if (Number.isFinite(body?.limite)) limite = Math.max(1, Math.min(LIMITE_MAX, Math.floor(body.limite)));
    } catch {
      // Corps absent/invalide : on garde le plafond par défaut.
    }

    const { data: rejets, error: erreurRejets } = await supabase.rpc("lister_rejets_alias_eligibles", { p_limite: limite });
    if (erreurRejets) throw new Error(erreurRejets.message);

    let suggestionsCreees = 0;
    let sansProposition = 0;
    let erreurs = 0;

    // Séquentiel volontairement : jamais d'appels IA massivement parallèles
    // (contrainte explicite #67 v1).
    for (const rejet of rejets || []) {
      try {
        const libelleSource = libelleSourcePourRejet(rejet);
        if (!libelleSource) {
          erreurs++;
          continue;
        }

        // Recherche sur libelle_ticket ET libelle_non_resolu quand ils
        // diffèrent, fusion en gardant le meilleur score par produit/variante,
        // plafond 15 conservé sur le résultat fusionné (pas par texte).
        const candidatsParCle = new Map<string, any>();
        for (const texte of textesRecherchePourRejet(rejet)) {
          const { data: candidatsTexte, error: erreurCandidats } = await supabase.rpc("rechercher_candidats_core", {
            p_libelle: texte,
            p_limite: 15,
          });
          if (erreurCandidats) throw new Error(erreurCandidats.message);
          for (const c of candidatsTexte || []) {
            const cle = cleCandidat(c);
            const existant = candidatsParCle.get(cle);
            if (!existant || c.score > existant.score) candidatsParCle.set(cle, c);
          }
        }
        const candidats = [...candidatsParCle.values()].sort((a, b) => b.score - a.score).slice(0, 15);

        // Aucun candidat dans le référentiel : inutile d'appeler l'IA, le
        // résultat ne peut être que "produit inconnu du référentiel".
        if (!candidats || candidats.length === 0) {
          await supabase.rpc("enregistrer_suggestion_alias_core_ia", {
            p_rejet_id: rejet.id,
            p_libelle_source: libelleSource,
            p_resultat: "produit_inconnu_du_referentiel",
            p_produit_id: null,
            p_variante_produit_id: null,
            p_score: 0,
            p_raison: "Aucun candidat trouvé dans le référentiel Core (shortlist vide).",
            p_modele: null,
            p_prompt_version: PROMPT_VERSION,
          });
          sansProposition++;
          continue;
        }

        // La décision de l'IA reste ancrée sur libelleSource (texte réel du
        // ticket en priorité) ; libelle_non_resolu n'est passé qu'à titre
        // d'indice complémentaire — seul le filet de recherche s'élargit.
        const libelleInterprete = rejet?.libelle_non_resolu || null;
        const { parsed, candidatsById } = await interrogerOpenRouter(apiKey, libelleSource, libelleInterprete, candidats);

        let resultat = parsed?.resultat === "suggestion" ? "suggestion" : "produit_inconnu_du_referentiel";
        let produitId: string | null = null;
        let varianteId: string | null = null;
        let raison = typeof parsed?.reason === "string" ? parsed.reason : null;
        const score = Number.isFinite(parsed?.confidence) ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : 0;

        if (resultat === "suggestion") {
          const candidatChoisi = candidatsById.get(parsed?.candidate_id);
          if (!candidatChoisi) {
            // L'IA a renvoyé un candidate_id hors de la liste envoyée :
            // jamais accepté, retombe sur produit_inconnu (garde-fou anti-invention d'id).
            resultat = "produit_inconnu_du_referentiel";
            raison = "Réponse IA invalide (candidate_id hors de la liste des candidats fournis).";
          } else {
            produitId = candidatChoisi.produit_id;
            varianteId = candidatChoisi.variante_produit_id;
          }
        }

        const { data: enregistrement } = await supabase.rpc("enregistrer_suggestion_alias_core_ia", {
          p_rejet_id: rejet.id,
          p_libelle_source: libelleSource,
          p_resultat: resultat,
          p_produit_id: produitId,
          p_variante_produit_id: varianteId,
          p_score: score,
          p_raison: raison,
          p_modele: MODELE_IA,
          p_prompt_version: PROMPT_VERSION,
        });

        // Le seuil de confiance (85) est vérifié côté RPC (défense en
        // profondeur) : elle peut rabattre 'suggestion' en
        // 'produit_inconnu_du_referentiel' même si ce code l'a laissé passer.
        if (enregistrement?.resultat === "suggestion") suggestionsCreees++;
        else sansProposition++;
      } catch (erreurLigne) {
        console.error("[#67] Erreur sur un rejet", rejet?.id, erreurLigne);
        erreurs++;
      }
    }

    return new Response(
      JSON.stringify({
        traites: (rejets || []).length,
        suggestions_creees: suggestionsCreees,
        sans_proposition: sansProposition,
        erreurs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
