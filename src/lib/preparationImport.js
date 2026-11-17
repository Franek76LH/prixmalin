// Chantier 120 — préparation des fichiers importés, CÔTÉ NAVIGATEUR (canvas,
// pdfjs). Ne throw jamais vers l'écran : chaque fonction renvoie un résultat
// ou une erreur lisible. La logique de décision (bornes, découpage) est dans
// importTicketFichier.js, testée.
import { decouperImageLongue, MAX_PAGES_PDF, MESSAGE_PDF_ILLISIBLE } from './importTicketFichier';

// Mêmes réglages que imageFileToJpegBase64 (scan photo) : 2000 px max sur le
// plus grand côté, JPEG qualité 0,92, et on ne fait que réduire.
const COTE_MAX = 2000;
const QUALITE = 0.92;

function chargerImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de lire l'image"));
    img.src = src;
  });
}

// Une bande [y, y+h] d'une source dessinable -> JPEG base64 (sans en-tête).
function bandeEnJpeg(source, largeur, y, h) {
  const k = Math.max(largeur, h) > COTE_MAX ? COTE_MAX / Math.max(largeur, h) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largeur * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, y, largeur, h, 0, 0, canvas.width, canvas.height);
  const base64 = canvas.toDataURL('image/jpeg', QUALITE).split(',')[1];
  return { base64, apercu: `data:image/jpeg;base64,${base64}` };
}

// Source dessinable (image ou canvas) -> morceaux prêts à partir. Une image
// longue (capture défilante) est découpée en bandes qui se recouvrent.
function enMorceaux(source, largeur, hauteur, nom) {
  const bandes = decouperImageLongue(largeur, hauteur);
  return bandes.map(({ y, h }, i) => ({
    ...bandeEnJpeg(source, largeur, y, h),
    nom: bandes.length > 1 ? `${nom} (${i + 1}/${bandes.length})` : nom,
  }));
}

export async function imageEnMorceaux(fichier) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await chargerImage(url);
    return enMorceaux(img, img.naturalWidth, img.naturalHeight, fichier.name || 'image');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// PDF -> une image par page (10 pages max). pdfjs n'est chargé qu'ici, à la
// demande : il ne pèse rien sur le reste de l'app, et s'il ne se charge pas
// (réseau, vieux navigateur) on renvoie le message prévu, sans planter.
export async function pdfEnMorceaux(fichier) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { default: urlWorker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = urlWorker;
  } catch (e) {
    console.error('[C120] pdfjs indisponible :', e);
    return { erreur: MESSAGE_PDF_ILLISIBLE, morceaux: [] };
  }
  try {
    const donnees = new Uint8Array(await fichier.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: donnees }).promise;
    const nbPages = doc.numPages;
    const n = Math.min(nbPages, MAX_PAGES_PDF);
    const morceaux = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      // ~1600 px de large : lisible pour l'OCR sans dépasser la limite de 2000 px.
      const viewport = page.getViewport({ scale: Math.min(3, 1600 / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      morceaux.push(...enMorceaux(canvas, canvas.width, canvas.height, `${fichier.name || 'PDF'} p.${i}`));
    }
    try { await doc.destroy(); } catch { /* sans importance */ }
    return {
      erreur: null,
      morceaux,
      avertissement: nbPages > MAX_PAGES_PDF ? `PDF de ${nbPages} pages : seules les ${MAX_PAGES_PDF} premières ont été gardées.` : null,
    };
  } catch (e) {
    console.error('[C120] PDF illisible :', e);
    return { erreur: MESSAGE_PDF_ILLISIBLE, morceaux: [] };
  }
}

// Fichier quelconque -> { erreur, morceaux, avertissement }.
export async function fichierEnMorceaux(fichier) {
  const estPdf = fichier?.type === 'application/pdf' || /\.pdf$/i.test(fichier?.name || '');
  if (estPdf) return pdfEnMorceaux(fichier);
  try {
    return { erreur: null, morceaux: await imageEnMorceaux(fichier) };
  } catch (e) {
    console.error('[C120] image illisible :', e);
    return { erreur: `Impossible de lire « ${fichier?.name || 'ce fichier'} ». Essaie une capture d'écran.`, morceaux: [] };
  }
}
