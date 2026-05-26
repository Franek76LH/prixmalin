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
