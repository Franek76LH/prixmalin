#!/usr/bin/env node
// Chantier 120 — banc d'essai LOCAL de l'Edge Function scan-ticket, sans
// Docker ni Deno : il rejoue EXACTEMENT l'appel de la fonction (même modèle,
// même température, même prompt importé de supabase/functions/scan-ticket/
// prompt.ts, même extraction du JSON), en v13 ET en v14 sur la même entrée.
// N'appelle JAMAIS Supabase, n'écrit RIEN en base. Ne déploie rien.
//
// Usage (Node >= 23, TypeScript exécuté directement) :
//   OPENROUTER_API_KEY=… node scripts/tester-scan-ticket.ts tests-tickets-120/lidl.png
//   node scripts/tester-scan-ticket.ts tests-tickets-120/netto/          (dossier = captures dans l'ordre alphabétique)
//   node scripts/tester-scan-ticket.ts tests-tickets-120/leclerc.pdf     (PDF -> une image par page, via PDFKit)
//   options : --v14-seul | --v13-seul | --a-sec (préparation seule, AUCUN appel réseau)
// La clé peut aussi être mise dans scripts/.env (OPENROUTER_API_KEY=…), ignoré par git.
//
// Préparation des images = celle de l'app : image longue découpée en bandes
// qui se recouvrent (decouperImageLongue), puis chaque morceau ramené à
// 2000 px max en JPEG qualité 92 (comme imageFileToJpegBase64).

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, extname, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { construirePromptTicket, normaliserSortieV14 } from "../supabase/functions/scan-ticket/prompt.ts";
import { decouperImageLongue, MAX_PAGES_PDF } from "../src/lib/importTicketFichier.js";

const ICI = dirname(fileURLToPath(import.meta.url));

function cleOpenRouter(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const env = join(ICI, ".env");
  if (existsSync(env)) {
    const ligne = readFileSync(env, "utf8").split("\n").find((l) => l.trim().startsWith("OPENROUTER_API_KEY="));
    if (ligne) return ligne.slice(ligne.indexOf("=") + 1).trim();
  }
  console.error("OPENROUTER_API_KEY absente (variable d'environnement ou scripts/.env).");
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "scan-ticket-"));
let compteur = 0;
const fichierTmp = (ext: string) => join(tmp, `img-${++compteur}${ext}`);

// Recadrage + compression avec CoreGraphics (sips ignore les recadrages qui
// touchent le bas de l'image). Comme l'app (imageFileToJpegBase64) : on ne
// fait que RÉDUIRE, jamais agrandir, à 2000 px max, JPEG qualité 0,92.
const SWIFT_IMAGE = `
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let a = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
if a[2] == "dim" { print("\\(img.width) \\(img.height)"); exit(0) }
let y = Int(a[3])!, h = Int(a[4])!
let morceau = img.cropping(to: CGRect(x: 0, y: y, width: img.width, height: h))!
let maxCote = 2000.0
let w0 = Double(morceau.width), h0 = Double(morceau.height)
let k = max(w0, h0) > maxCote ? maxCote / max(w0, h0) : 1.0
let W = Int((w0 * k).rounded()), H = Int((h0 * k).rounded())
let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ctx.interpolationQuality = .high
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
ctx.draw(morceau, in: CGRect(x: 0, y: 0, width: W, height: H))
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
CGImageDestinationFinalize(dest)
`;
let binaireImage = "";
function outilImage(): string {
  if (binaireImage) return binaireImage;
  const source = join(tmp, "image.swift");
  writeFileSync(source, SWIFT_IMAGE);
  binaireImage = join(tmp, "outil-image");
  execFileSync("swiftc", ["-O", source, "-o", binaireImage], { stdio: "inherit" });
  return binaireImage;
}

function dimensions(fichier: string): { w: number; h: number } {
  const [w, h] = execFileSync(outilImage(), [fichier, "dim"], { encoding: "utf8" }).trim().split(" ").map(Number);
  return { w, h };
}

// Une bande [y, y+h] de l'image -> JPEG prêt à partir, en base64.
function morceauJpegBase64(fichier: string, y: number, h: number): string {
  const sortie = fichierTmp(".jpg");
  execFileSync(outilImage(), [fichier, sortie, String(y), String(h)]);
  return readFileSync(sortie).toString("base64");
}

function versFichier(b64: string): string {
  const f = fichierTmp(".jpg");
  writeFileSync(f, Buffer.from(b64, "base64"));
  return f;
}

// Image -> ses morceaux (découpage de l'app si elle est longue), compressés.
function decouper(fichier: string): string[] {
  const { w, h } = dimensions(fichier);
  return decouperImageLongue(w, h).map(({ y, h: hb }) => morceauJpegBase64(fichier, y, hb));
}

// PDF -> une PNG par page (PDFKit, 2× la taille nominale pour la lisibilité).
function pagesPdf(fichier: string): string[] {
  const dossier = join(tmp, `pdf-${++compteur}`);
  mkdirSync(dossier);
  const swift = `
import PDFKit
import AppKit
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let n = min(doc.pageCount, ${MAX_PAGES_PDF})
for i in 0..<n {
  let page = doc.page(at: i)!
  let r = page.bounds(for: .mediaBox)
  let img = page.thumbnail(of: NSSize(width: r.width * 2, height: r.height * 2), for: .mediaBox)
  let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2] + "/page-\\(String(format: "%02d", i + 1)).png"))
}`;
  const script = join(tmp, "pdf.swift");
  writeFileSync(script, swift);
  execFileSync("swift", [script, fichier, dossier], { stdio: "inherit" });
  return readdirSync(dossier).sort().map((f) => join(dossier, f));
}

function preparer(entree: string): { images: string[]; morceaux: string[] } {
  let sources: string[];
  if (statSync(entree).isDirectory()) {
    sources = readdirSync(entree).filter((f) => /\.(png|jpe?g|heic|webp|pdf)$/i.test(f)).sort().map((f) => join(entree, f));
  } else sources = [entree];
  const images: string[] = [];
  for (const s of sources) {
    if (extname(s).toLowerCase() === ".pdf") pagesPdf(s).forEach((p) => images.push(...decouper(p)));
    else images.push(...decouper(s));
  }
  return { images, morceaux: images };
}

// Même appel et même extraction que index.ts.
async function appeler(images: string[], consignesV14: boolean) {
  const reponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cleOpenRouter()}` },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4-5",
      max_tokens: 16000,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          ...images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } })),
          // L'app envoie imageBase64 pour 1 image, imagesBase64 au-delà.
          { type: "text", text: construirePromptTicket({ nbImages: images.length, multi: images.length > 1, consignesV14 }) },
        ],
      }],
    }),
  });
  const data = await reponse.json();
  if (!reponse.ok) throw new Error(data?.error?.message || `HTTP ${reponse.status}`);
  const texte = (data.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
  const a = texte.indexOf("{"), b = texte.lastIndexOf("}");
  const parsed = JSON.parse(a !== -1 && b > a ? texte.slice(a, b + 1) : texte);
  return { parsed: consignesV14 ? normaliserSortieV14(parsed) : parsed, finish: data.choices?.[0]?.finish_reason };
}

const eur = (n: unknown) => (n == null ? "null" : `${Number(n).toFixed(2)} €`);

function resumer(version: string, r: Record<string, any>) {
  const p: Record<string, any>[] = Array.isArray(r.products) ? r.products : [];
  const somme = p.reduce((s, x) => s + (Number(x.total) || Number(x.price) * (Number(x.qty) || 1) || 0), 0);
  const remises = p.filter((x) => Number(x.remise) > 0);
  const quantites = p.filter((x) => Number(x.qty) > 1);
  const cles = p.map((x) => `${x.libelle_ticket}|${x.total ?? x.price}`);
  const doublons = cles.filter((c, i) => cles.indexOf(c) !== i);
  console.log(`  ${version} : ${p.length} lignes · date ${r.date ?? "null"} · total imprimé ${eur(r.total_ticket)} · total_remises ${eur(r.total_remises)} · somme des lignes ${eur(somme)}`);
  if (remises.length) console.log(`    remises de ligne : ${remises.map((x) => `${x.libelle_ticket} ${eur(x.total)} −${eur(x.remise)}`).join(" ; ")}`);
  if (quantites.length) console.log(`    quantités > 1 : ${quantites.map((x) => `${x.libelle_ticket} ${x.qty} × ${eur(x.unit_price ?? x.price)} = ${eur(x.total)}`).join(" ; ")}`);
  if (doublons.length) console.log(`    lignes identiques (libellé + prix) restantes : ${doublons.join(" ; ")}`);
  if ("captures_peut_etre_incompletes" in r) console.log(`    captures_peut_etre_incompletes : ${r.captures_peut_etre_incompletes}`);
}

const args = process.argv.slice(2);
const versions = args.includes("--v14-seul") ? [true] : args.includes("--v13-seul") ? [false] : [false, true];
const entrees = args.filter((a) => !a.startsWith("--"));
if (entrees.length === 0) { console.error("Indique au moins un fichier ou un dossier de ticket."); process.exit(1); }

for (const entree of entrees) {
  const { images, morceaux } = preparer(entree);
  console.log(`\n=== ${basename(entree)} — ${images.length} image(s) envoyée(s)${morceaux.length > 1 ? " (après découpage / pages)" : ""}`);
  if (args.includes("--a-sec")) {
    images.forEach((b64, i) => { const d = dimensions(versFichier(b64)); console.log(`  morceau ${i + 1} : ${d.w}×${d.h} px, ${(b64.length * 0.75 / 1024).toFixed(0)} Ko`); });
    continue;
  }
  const dossierSortie = join(dirname(entree), "resultats");
  mkdirSync(dossierSortie, { recursive: true });
  for (const v14 of versions) {
    const version = v14 ? "v14" : "v13";
    try {
      const { parsed, finish } = await appeler(images, v14);
      resumer(version, parsed);
      if (finish && finish !== "stop") console.log(`    ⚠ finish_reason=${finish}`);
      writeFileSync(join(dossierSortie, `${basename(entree)}.${version}.json`), JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(`  ${version} : ÉCHEC — ${(e as Error).message}`);
    }
  }
}
