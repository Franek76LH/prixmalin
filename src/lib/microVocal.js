import { supabase } from "./supabase";

// Chantier « Micro » — LOT 2. Pont entre l'écran Micro (App.jsx) et l'Edge
// Function transcrire-liste-vocale. Aucun stockage : l'audio part en base64,
// seule la liste structurée revient.

// mime MediaRecorder -> champ "format" attendu par OpenRouter (input_audio).
// Safari iOS : audio/mp4 (AAC) -> "m4a". Chrome/Android : audio/webm -> "webm".
export function formatDepuisMime(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
  return "m4a"; // défaut iOS, le cas réel principal
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // dataURL = "data:audio/mp4;base64,AAAA..." -> on ne garde que la charge utile
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Impossible de lire l'audio"));
    reader.readAsDataURL(blob);
  });
}

// Valide et normalise la réponse du modèle : ne fait JAMAIS confiance à la
// forme du JSON renvoyé. Tout élément sans nom exploitable est écarté ;
// quantité non numérique -> null ; confiance inconnue -> "faible" (prudence).
export function normaliserResultatTranscription(data) {
  const transcription = typeof data?.transcription === "string" ? data.transcription.trim() : "";

  const elements = (Array.isArray(data?.elements) ? data.elements : [])
    .map((e) => {
      const nom = typeof e?.nom === "string" ? e.nom.trim() : "";
      if (!nom) return null;
      const q = Number(e?.quantite);
      return {
        texte_entendu: typeof e?.texte_entendu === "string" ? e.texte_entendu.trim() : "",
        nom,
        quantite: Number.isFinite(q) && q > 0 ? q : null,
        unite: typeof e?.unite === "string" && e.unite.trim() ? e.unite.trim() : null,
        qualificatifs: typeof e?.qualificatifs === "string" && e.qualificatifs.trim() ? e.qualificatifs.trim() : null,
        confiance: e?.confiance === "haute" ? "haute" : "faible",
      };
    })
    .filter(Boolean);

  const elements_ignores = (Array.isArray(data?.elements_ignores) ? data.elements_ignores : [])
    .map((e) => ({
      texte_entendu: typeof e?.texte_entendu === "string" ? e.texte_entendu.trim() : "",
      raison: typeof e?.raison === "string" ? e.raison.trim() : "",
    }))
    .filter((e) => e.texte_entendu || e.raison);

  return { transcription, elements, elements_ignores };
}

// Envoie une prise à l'Edge Function et renvoie le résultat normalisé.
export async function transcrireAudioListe(blob, mime) {
  const audioBase64 = await blobToBase64(blob);
  if (!audioBase64) throw new Error("Audio vide");
  const { data, error } = await supabase.functions.invoke("transcrire-liste-vocale", {
    body: { audioBase64, format: formatDepuisMime(mime) },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return normaliserResultatTranscription(data);
}
