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

export async function scanTicketWithClaude(imageBase64, apiKey, refProducts = []) {
  const refSection = refProducts.length > 0
    ? `\n\nCatalogue de référence (${refProducts.length} produits génériques) :\n` +
      refProducts.map(p => `- ${p.nom} (${p.categorie})`).join("\n") +
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
- Un article manquant est une erreur grave.${refSection}`,
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
