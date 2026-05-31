// Convertit n'importe quel format image (HEIC, PNG, WEBP…) en JPEG base64
// via canvas, avec redimensionnement si > 2000px pour limiter la taille du payload.
export function imageFileToJpegBase64(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 2000;
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else        { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire l'image")); };
    img.src = url;
  });
}

export async function scanTicketWithClaude(imageBase64, apiKey) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
            {
              type: "text",
              text: `Analyse ce ticket de caisse et extrait les informations suivantes en JSON uniquement, sans texte avant ou après :
{
  "store": "nom du magasin",
  "date": "YYYY-MM-DD",
  "address": "adresse complète du magasin si présente sur le ticket (numéro, rue, code postal, ville), sinon chaîne vide",
  "products": [
    { "brand": "marque ou vide", "name": "nom du produit normalisé", "format": "format ou vide", "price": 0.00 }
  ]
}
Normalise les noms abrégés (ex: LT DEMI ECR → Lait demi-écrémé). Ignore les lignes qui ne sont pas des produits (total, TVA, etc).`,
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const msg = data?.error?.message || `Erreur HTTP ${response.status}`;
    throw new Error(msg);
  }

  const text = data.choices?.[0]?.message?.content || "";
  const clean = text.replace(/```json|```/g, "").trim();

  if (!clean) throw new Error("Réponse vide du modèle");

  try {
    return JSON.parse(clean);
  } catch {
    throw new Error("Le modèle n'a pas retourné un JSON valide");
  }
}
