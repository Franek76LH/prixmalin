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

// Chantier 96 — produits EXPLOITABLES d'un résultat de scan : un libellé et
// un prix strictement positif (mêmes critères que le filtre d'import). Sert
// de garde-fou : un scan qui n'en produit AUCUN ne doit jamais enchaîner vers
// l'import — c'est ce trou qui laissait passer un « ticket scanné » fantôme
// (archive marquée, zéro écriture Core, realized_saving sur un vieux ticket).
// Chantier 99 — le libellé est "name" OU, à défaut, "libelle_ticket" : le
// prompt anti-faux-rattachement laisse VOLONTAIREMENT name vide quand le
// produit ne matche pas le catalogue (confiance "faible") ; exiger name
// jetait ces produits pourtant bien lus (faux « ticket illisible »). Pure.
export function filtrerProduitsExploitables(products) {
  return (products || []).filter(p => p && (p.name || p.libelle_ticket) && Number(p.price) > 0);
}

export async function scanTicketWithClaude(imageBase64, refProducts = []) {
  const { data, error } = await supabase.functions.invoke("scan-ticket", {
    body: { imageBase64, refProducts },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// Chantier 98 — lecture OCR fiabilisée. Constat (14/08) : le MÊME ticket net
// donne 2 produits un jour et 0 le lendemain (Edge Function en 200 les deux
// fois) : la lecture est instable côté modèle, PAS côté photo — l'image
// envoyée (2000 px, JPEG 0,92) dépasse déjà le plafond d'ingestion du modèle
// (~1,15 Mpx). D'où : 1 réessai automatique quand le service échoue OU quand
// la lecture ne rend aucun produit exploitable, et un statut honnête pour ne
// plus accuser la photo par défaut. Ne throw JAMAIS — renvoie toujours :
//   { statut: 'ok',                    resultat }  -> ≥ 1 produit exploitable
//   { statut: 'lecture_vide',          resultat }  -> réponses valides mais 0 produit
//   { statut: 'service_indisponible',  message  }  -> échec technique aux 2 essais
export async function scanTicketRobuste(imageBase64, refProducts = [], { essais = 2 } = {}) {
  let dernierResultat = null;
  let derniereErreur = null;
  for (let i = 0; i < essais; i++) {
    try {
      const resultat = await scanTicketWithClaude(imageBase64, refProducts);
      dernierResultat = resultat;
      if (filtrerProduitsExploitables(resultat?.products).length > 0) {
        return { statut: 'ok', resultat };
      }
    } catch (e) {
      derniereErreur = e;
    }
  }
  if (dernierResultat) return { statut: 'lecture_vide', resultat: dernierResultat };
  return { statut: 'service_indisponible', message: derniereErreur?.message || 'Service indisponible' };
}

// Messages honnêtes par statut d'échec : on ne rejette la faute sur la photo
// que si elle peut réellement être en cause, et on propose toujours une porte
// de sortie (réessayer / saisie manuelle).
export const MESSAGES_SCAN = {
  lecture_vide: "Le ticket n'a pas pu être lu (2 tentatives). Si ta photo est nette et entière, c'est un raté du service de lecture : réessaie dans un instant. Sinon, reprends la photo — ou passe en saisie manuelle.",
  service_indisponible: "Le service de lecture est momentanément indisponible — ta photo n'y est pour rien. Réessaie dans un instant, ou passe en saisie manuelle.",
};

export async function scanMultipleTicketsWithClaude(imagesBase64, refProducts = []) {
  const { data, error } = await supabase.functions.invoke("scan-ticket", {
    body: { imagesBase64, refProducts },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
