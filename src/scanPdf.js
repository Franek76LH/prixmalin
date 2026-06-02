import * as pdfjsLib from "pdfjs-dist";
import { scanTicketWithClaude } from "./scanTicket";

// Worker via CDN — évite toute config Vite spécifique
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export async function scanPdfWithClaude(file, apiKey, refProducts = []) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  const totalPages = pdf.numPages;

  // Rend toutes les pages et les empile verticalement
  const canvases = [];
  let totalHeight = 0;
  let maxWidth = 0;

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.5 }); // haute résolution pour l'OCR
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    canvases.push(canvas);
    totalHeight += viewport.height;
    maxWidth = Math.max(maxWidth, viewport.width);
  }

  // Fusionne en une seule image
  const merged = document.createElement("canvas");
  merged.width = maxWidth;
  merged.height = totalHeight;
  const ctx = merged.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, maxWidth, totalHeight);
  let y = 0;
  for (const c of canvases) {
    ctx.drawImage(c, 0, y);
    y += c.height;
  }

  const base64 = merged.toDataURL("image/jpeg", 0.9).split(",")[1];
  return scanTicketWithClaude(base64, apiKey, refProducts);
}
