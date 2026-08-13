import { supabase } from "./lib/supabase";

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

// Chantier 96 — produits EXPLOITABLES d'un résultat de scan : un nom et un
// prix strictement positif (mêmes critères que le filtre d'import
// p.keep && p.name && p.price > 0). Sert de garde-fou : un scan qui n'en
// produit AUCUN ne doit jamais enchaîner vers l'import — c'est ce trou qui
// laissait passer un « ticket scanné » fantôme (archive marquée, zéro
// écriture Core, realized_saving calculé sur un vieux ticket). Pure.
export function filtrerProduitsExploitables(products) {
  return (products || []).filter(p => p && p.name && Number(p.price) > 0);
}

export async function scanTicketWithClaude(imageBase64, refProducts = []) {
  const { data, error } = await supabase.functions.invoke("scan-ticket", {
    body: { imageBase64, refProducts },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function scanMultipleTicketsWithClaude(imagesBase64, refProducts = []) {
  const { data, error } = await supabase.functions.invoke("scan-ticket", {
    body: { imagesBase64, refProducts },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
