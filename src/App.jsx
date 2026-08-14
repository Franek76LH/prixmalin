import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, Component } from "react";
import { imageFileToJpegBase64, scanMultipleTicketsWithClaude, filtrerProduitsExploitables, scanTicketRobuste, MESSAGES_SCAN } from "./scanTicket";
import { STORES, STALE_DAYS, JOURS_MOYENNE } from "./constants";
import { supabase } from "./lib/supabase";
import { mapperLigneListeCourses, chargerVariantes, getCategoryPresentation, formatFormatStructure, calculerPrixUnitaire } from "./lib/catalogueCore";
import { calculerPrixReferenceParUnite } from "./lib/unitesCore";
import { urlPhotoVariante, offLargeSource, offFullUrl, cloudinaryAgrandi } from "./lib/photosProduits";
import { nomComposeVariante, formatEtiquetteVariante } from "./lib/nomProduit";
import { transcrireAudioListe, normaliserNomElement, comptesParNom, fusionnerParNom } from "./lib/microVocal";
// Chantier « Courses » Lot 1 — session de courses figée (shadow estFrancois).
import { chargerRayonsProduits, construireArticlesSession, construireSessionCourses, grouperParRayon, calculerProgression, emojiRayon, appliquerEtatArticle, sauvegarderSessionSupabase, abandonnerSessionsActivesSupabase, chargerSessionActiveSupabase, choisirSessionLaPlusRecente, genererIdSession, ajouterNoteSession, supprimerNoteSession, cloreSession, idsCaddieASupprimer, articlesNonAchetesASupprimer, construireBilanCourses, doitRattacherTicketSession, chargerMarquesVariantes, calculerTotalPanier } from "./lib/sessionCoursesCore";
// Chantier 91 Lot 5 — rapprochement liste / cochés / ticket.
import { rapprocherSessionTicket, appliquerRapprochementSession, deciderAchatArticle, construireNormaliseur, textesARapprocher } from "./lib/rapprochementCoursesCore";
// Chantier 92 Lot 6 — favoris Core (par format) & récurrents. Distinct des
// « courses habituelles » (legacy favorites), qui ne bougent pas.
import { chargerFavoris, ajouterFavori, retirerFavori, chercherFavori, chargerRecurrents, proposerFavorisApresTicket } from "./lib/favorisCore";
// Chantier 93 Lot 7 — anti-doublon de ticket (empreinte déterministe).
import { calculerEmpreinteTicket, chercherTicketParEmpreinte, poserEmpreinteApresImport } from "./lib/empreinteTicket";
// Chantier 94 Lot 10 — Points Malin / niveaux / badges (affichage seul, le
// serveur attribue tout — Lots 8-9).
import { agregerPoints, calculerNiveau, progressionBadge, detecterNouveauxBadges, statistiquesContributions, chargerProfilGamification, chargerBadgesUtilisateur, sommerPointsDernierTicket } from "./lib/gamificationCore";
// Chantier 95 Lot 11 — sollicitation « relève le prix » pendant les courses.
import { diagnostiquerPrix, doitSolliciter, doitProposerSollicitation, marquerSollicitationPrix, fileACompleter, chargerPrixPourDiagnostic } from "./lib/sollicitationPrixCore";
import { capturerEvenement } from "./lib/posthog";
import ShadowCompareDiagnostic from "./components/dev/ShadowCompareDiagnostic";
import { construirePanierEtMagasins, resoudreIdentiteMagasin } from "./lib/adaptateurPanierPrix";
import { classerMagasinsPourPanier, calculerEconomiePotentielle } from "./lib/classementPanierCore";
import ClassementPanierShadow from "./components/dev/ClassementPanierShadow";
import AdminRejetsCorePanel from "./components/admin/AdminRejetsCorePanel";
// Chantier "Scan code-barres", bout 1 — BarcodeDetector natif absent d'iOS
// Safari, on utilise @zxing/browser (getUserMedia + décodage JS, éprouvé sur
// iOS). Shadow François uniquement, voir estFrancois plus bas.
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import AValiderSheet from "./components/dev/AValiderSheet";
// Chantier "Scan code-barres", bout 3B — console de validation admin
import ValidationScanSheet from "./components/admin/ValidationScanSheet";
// #65 — bandeau de mise à jour PWA (pont vers registerSW dans main.jsx)
import { onNeedRefresh, applyUpdate } from "./lib/swUpdate";
// #56.5.A — double écriture Core, fire-and-forget, invisible pour l'utilisateur
import { envoyerTicketCore, envoyerPrixManuelCore } from "./lib/doubleEcritureCore";
// Chantier 97 — sélecteur de magasin CORE obligatoire avant l'import du ticket.
import { chargerMagasinsCoreActifs, chargerFrequencesMagasins, classerMagasins as classerMagasinsSelecteur, filtrerMagasins, obtenirPositionAppareil, trouverStoreLegacyPourMagasin, formaterAdresseMagasin, formaterDistance } from "./lib/selecteurMagasinCore";
// #56.6 — realized_saving Core scopé à un ticket, réutilise #56.5.B
import { calculerRealizedSavingTicket } from "./lib/economiesCoreConfirmees";
// #56.4 — vrai moteur Core (produits/prix/magasins via la vue prix_comparables),
// pour le mode debug admin de CompareTab. Distinct du pipeline #58.2
// (adaptateurPanierPrix/classementPanierCore, lui basé sur price_db legacy),
// qui n'est ni touché ni réutilisé ici.
import {
  construireCiblesComparaison,
  chargerPrixComparables,
  faireCorrespondrePrix,
  regrouperParMagasin,
  calculerTotauxMagasins,
  classerMagasins,
} from "./lib/comparateurCore";

const C = {
  blue:      "#CC0000",   blueLight:  "#FFF0F0",
  orange:     "#FFD000",   orangeLight: "#FFFBEA",
  white:      "#FFFFFF",   bg:          "#F8F8F8",
  gray:       "#999999",   grayLight:   "#EFEFEF",
  text:       "#111111",   textLight:   "#555555",
  green:      "#00B341",   red:         "#CC0000",   yellow: "#FFD000",
};

// Chantier 83 « Photos produits » (shadow, additif) — vignette/photo d'un produit
// via son code-barres (Open Food Facts + Cloudinary). Additif : le `fallback`
// (emoji de catégorie / carré placeholder existant) reste affiché PENDANT le
// chargement ET si aucune photo n'est trouvée. Chargement PARESSEUX : l'appel
// réseau OFF n'est déclenché que lorsque l'élément entre dans le viewport
// (IntersectionObserver). Ne plante jamais (toute erreur -> on garde le fallback).
function PhotoProduit({ varianteId, taille = 'thumb', fallback = null, radius = 9, onAgrandir = null }) {
  const [url, setUrl] = useState(null);
  const [offLarge, setOffLarge] = useState(null);   // URL OFF brute (pour l'agrandi)
  // Si IntersectionObserver n'existe pas (vieux moteur), on considère visible
  // d'emblée (valeur initiale, pas de setState synchrone dans l'effet).
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '150px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !varianteId) return;
    let cancelled = false;
    urlPhotoVariante(varianteId, taille)
      .then(u => { if (!cancelled) setUrl(u); })
      .catch(() => { /* silencieux : on garde le fallback */ });
    // Chantier 85 — résout aussi l'URL OFF brute quand l'agrandi est possible
    // (caches partagés : quasi gratuit). Sert à rendre la vignette cliquable.
    if (onAgrandir) {
      offLargeSource(varianteId)
        .then(o => { if (!cancelled) setOffLarge(o); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [visible, varianteId, taille, onAgrandir]);

  // Cliquable seulement s'il y a réellement une photo (jamais d'overlay vide).
  const cliquable = !!(onAgrandir && url && offLarge);
  return (
    <div ref={ref} onClick={cliquable ? () => onAgrandir(offLarge) : undefined}
      style={{ position:"relative", width:"100%", height:"100%", borderRadius:radius, overflow:"hidden", cursor: cliquable ? "pointer" : undefined }}>
      {fallback}
      {url && (
        <img src={url} loading="lazy" alt="" onError={()=>setUrl(null)}
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain", background:"#fff" }} />
      )}
    </div>
  );
}

// Chantier 85 — overlay/lightbox partagé (factorisé du chantier 83) : photo
// pleine résolution OFF (.full via Cloudinary c_limit w_1000), repli sur le 400
// si .full échoue ; fermeture hors image ou ×, aucun dialog natif. Réutilisé par
// la fiche produit ET le comparateur (FamilleDepliee).
function LightboxPhoto({ offLarge, onClose }) {
  const [replie, setReplie] = useState(false);
  if (!offLarge) return null;
  return (
    <div onClick={(e)=>{ e.stopPropagation(); onClose(); }}
      style={{ position:"fixed", inset:0, zIndex:400, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, animation:"fadeIn 0.15s ease" }}>
      <button onClick={(e)=>{ e.stopPropagation(); onClose(); }} aria-label="Fermer"
        style={{ position:"absolute", top:16, right:16, width:40, height:40, borderRadius:99, border:"none", background:"rgba(255,255,255,0.2)", color:"#fff", fontSize:20, cursor:"pointer" }}>✕</button>
      <img src={replie ? offLarge : cloudinaryAgrandi(offFullUrl(offLarge))}
        onClick={(e)=>e.stopPropagation()}
        onError={()=>{ if (!replie) setReplie(true); }}
        alt="" style={{ maxWidth:"90vw", maxHeight:"90vh", objectFit:"contain", borderRadius:8 }} />
    </div>
  );
}


function isStale(d){ return d && (Date.now()-new Date(d))/86400000 > STALE_DAYS; }
function daysAgo(d){ return d ? Math.floor((Date.now()-new Date(d))/86400000) : null; }
function storeIdFromName(n){
  if(!n) return "autre";
  const s=n.toLowerCase();
  if(s.includes("leclerc"))   return "leclerc";
  if(s.includes("carrefour")) return "carrefour";
  if(s.includes("auchan"))    return "auchan";
  if(s.includes("lidl"))      return "lidl";
  if(s.includes("intermarché")||s.includes("intermarche")) return "intermarche";
  if(s.includes("monoprix"))  return "monoprix";
  if(s.includes("vival"))     return "vival";
  if(s.includes("spar"))      return "spar";
  if(s.includes("netto"))     return "netto";
  if(s.includes("franprix"))  return "franprix";
  if(s.includes("casino"))   return "casino";
  if(s.includes("super u")||s.includes("superu")) return "superu";
  if(s.includes("simply"))   return "simply";
  if(s.includes("bio c"))    return "biocbon";
  return "autre";
}

// Normalise un nom de produit ou marque : minuscules + sans accents
function normName(s) {
  return (s||"").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g,"")
    .replace(/\s+/g," ");
}
// Normalise un format : minuscules + sans accents + sans espaces + virgule→point
function normFormat(s) {
  return (s||"").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g,"")
    .replace(/,/g,".").replace(/\s+/g,"");
}

/*
 * #50 — SUJET MARQUE : réflexion en attente (à traiter après #47)
 *
 * La marque (brand) est présente dans ~30 endroits du code :
 * priceKey, itemMatchesPrice, OCR, Supabase, comparateur, etc.
 * Supprimer le champ séparé est une refonte complète, pas une retouche.
 *
 * Vision retenue :
 * - Marques nationales fortes (Coca-Cola, Nutella, Pepsi...) →
 *   la marque fait partie du NOM du produit. Ex : "Coca-Cola 1,5L".
 *   Pas besoin d'un champ brand séparé.
 * - Produits génériques (lait, riz, pâtes...) →
 *   pas de marque. Ex : "Lait demi-écrémé 1L".
 *   Le champ brand est inutile dans ce cas aussi.
 *
 * Conclusion : le champ brand séparé ne sert dans aucun des deux cas.
 * Mais le supprimer sans casser le matching et l'unicité Supabase
 * demande de clarifier d'abord l'identité produit via #47.
 *
 * Ne pas toucher à brand avant que #47 soit terminé.
 */
// Clé unique d'un article de prix : marque+produit+format+magasin
function priceKey(p){ return `${normName(p.brand)}_${normName(p.product)}_${normFormat(p.format)}_${p.storeId}`; }

// A.1 — rend lisible le format structuré lu par l'IA (quantite_nette /
// unite_quantite / nombre_unites), ex "6 × 1 L", "125 g", "2 × 500 ml".
// Retourne "" si l'IA n'a pas su décomposer (champs à null) : l'appelant
// retombe alors sur le format brut.
function formatStructureLu(p) {
  if (!p) return "";
  const q = p.quantite_nette, u = p.unite_quantite, n = p.nombre_unites;
  if (q == null || !u) return "";
  const qStr = String(q).replace(".", ",");
  const base = `${qStr} ${u}`;
  return (n && Number(n) > 1) ? `${n} × ${base}` : base;
}

// Prix à l'unité (€/kg ou €/L) à partir du format texte
function calcUnitPrice(price, format) {
  if (!price || !format) return null;
  const s = String(format).toLowerCase().trim().replace(/\s+/g,'').replace(',','.');
  const multi = s.match(/^(\d+(?:\.\d+)?)[x×*](\d+(?:\.\d+)?)(g|kg|mg|l|ml|cl|dl)$/);
  const single = s.match(/^(\d+(?:\.\d+)?)(g|kg|mg|l|ml|cl|dl)$/);
  const [amt, unit] = multi
    ? [parseFloat(multi[1]) * parseFloat(multi[2]), multi[3]]
    : single ? [parseFloat(single[1]), single[2]] : [null, null];
  if (!amt || !unit) return null;
  const bases = { g: [1000,'kg'], kg:[1,'kg'], mg:[1e6,'kg'], l:[1,'L'], ml:[1000,'L'], cl:[100,'L'], dl:[10,'L'] };
  const [div, label] = bases[unit] || [null,null];
  if (!div) return null;
  const perUnit = price / (amt / div);
  return perUnit > 0 ? { value: perUnit, unit: label } : null;
}
function fmtUnitPrice(price, format) {
  const up = calcUnitPrice(price, format);
  return up ? `${up.value.toFixed(2).replace('.',',')} €/${up.unit}` : null;
}
function parseFormat(format) {
  if (!format) return { quantite: null, unite: null, conditionnement: 1 };
  const s = format.trim();

  // NxMunit — "4x100g", "6x1l"
  let m = s.match(/^(\d+)[xX](\d+(?:[.,]\d+)?)\s*(g|kg|cl|ml|l)$/i);
  if (m) return {
    conditionnement: parseInt(m[1]),
    quantite:        parseFloat(m[2].replace(',', '.')),
    unite:           m[3].toLowerCase(),
  };

  // Nunit — "220g", "1,5L", "0.314 kg"
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|cl|ml|l)$/i);
  if (m) return {
    quantite:        parseFloat(m[1].replace(',', '.')),
    unite:           m[2].toLowerCase(),
    conditionnement: 1,
  };

  // "7 pièces"
  m = s.match(/^(\d+)\s*pièces?$/i);
  if (m) return { quantite: 1, unite: 'pièce', conditionnement: parseInt(m[1]) };

  // "x40"
  m = s.match(/^[xX](\d+)$/);
  if (m) return { quantite: 1, unite: 'pièce', conditionnement: parseInt(m[1]) };

  // "12x"
  m = s.match(/^(\d+)[xX]$/);
  if (m) return { quantite: 1, unite: 'pièce', conditionnement: parseInt(m[1]) };

  return { quantite: null, unite: null, conditionnement: 1 };
}
function calcPrixUnitaire(price, quantite, unite, conditionnement) {
  if (!price || !quantite || !unite) return null;
  const q = quantite * conditionnement;
  let pu = null;
  if (unite === 'g')           pu = price / (q / 1000);
  else if (unite === 'kg')     pu = price / q;
  else if (unite === 'cl')     pu = price / (q / 100);
  else if (unite === 'ml')     pu = price / (q / 1000);
  else if (unite === 'l')      pu = price / q;
  else if (unite === 'pièce')  pu = price / conditionnement;
  return pu !== null ? Math.round(pu * 100) / 100 : null;
}
const MOIS=['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
function formatMonth(yyyymm){ if(!yyyymm) return ''; const [y,m]=yyyymm.split('-'); return `${MOIS[parseInt(m)-1]} ${y}`; }

async function geocodeAddress(address) {
  try {
    const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`);
    const d = await r.json();
    const f = d.features?.[0];
    if (!f) return null;
    const [lng, lat] = f.geometry.coordinates;
    // Chantier géoloc comparateur — label lisible en plus des coordonnées ;
    // ne casse aucun appelant existant (tous ne lisent que .lat/.lng).
    const label = f.properties?.label || f.properties?.city || null;
    return { lat, lng, label };
  } catch { return null; }
}

// Chantier géoloc comparateur — reverse-geocoding best-effort d'un point GPS
// vers un nom de ville affichable. null si l'API échoue ou ne trouve rien :
// l'appelant retombe alors sur un libellé générique ("Ma position").
async function reverseGeocodeLabel(lat, lng) {
  try {
    const r = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}`);
    const d = await r.json();
    const f = d.features?.[0];
    return f?.properties?.city || f?.properties?.label || null;
  } catch { return null; }
}

// Chantier 81 — zone du comparateur persistée localement (point + libellé +
// rayon), même esprit que les favoris : réhydratée à l'init pour ne pas
// repasser par l'écran de choix ni attendre le round-trip Supabase. null si
// rien de stocké ou JSON illisible.
const ZONE_STORAGE_KEY = 'prixmalin_zone_v1';
function lireZoneStockee() {
  try { return JSON.parse(localStorage.getItem(ZONE_STORAGE_KEY) || 'null'); }
  catch { return null; }
}

async function insertStoreInDB(enseigne, address, lat, lng, name = null) {
  const BRANDS = [
    { match: ["super u", "superu"],                 canonical: "Super U"     },
    { match: ["hyper u", "hyperu"],                 canonical: "Hyper U"     },
    { match: ["u express", "uexpress"],             canonical: "U Express"   },
    { match: ["leclerc", "e.leclerc", "e leclerc"], canonical: "Leclerc"     },
    { match: ["intermarché", "intermarche"],        canonical: "Intermarché" },
    { match: ["carrefour"],                         canonical: "Carrefour"   },
    { match: ["lidl"],                              canonical: "Lidl"        },
    { match: ["netto"],                             canonical: "Netto"       },
    { match: ["franprix"],                          canonical: "Franprix"    },
    { match: ["aldi"],                              canonical: "Aldi"        },
    { match: ["utile"],                             canonical: "Utile"       },
    { match: ["vival"],                             canonical: "Vival"       },
    { match: ["spar"],                              canonical: "Spar"        },
    { match: ["monoprix"],                          canonical: "Monoprix"    },
    { match: ["picard"],                            canonical: "Picard"      },
    { match: ["action"],                            canonical: "Action"      },
  ];
  const normalizeStoreName = (n) => {
    if (!n) return n;
    const lower = n.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const brand of BRANDS) {
      for (const m of brand.match) {
        if (lower === m || lower.startsWith(m + " ") || lower.startsWith(m + "-"))
          return brand.canonical;
      }
    }
    return n.trim().charAt(0).toUpperCase() + n.trim().slice(1).toLowerCase();
  };

  try {
    const { data } = await supabase.from('stores')
      .insert({ enseigne, address, latitude: lat, longitude: lng, name: normalizeStoreName(name) })
      .select('id').single();
    return data?.id ?? null;
  } catch { return null; }
}

// Devine la catégorie d'un produit à partir de mots-clés dans son nom
function guessCategory(name) {
  const n = (name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\b(lait|beurre|fromage|yaourt|creme fraiche|creme|oeuf|emmental|gruyere|camembert|mozzarella|ricotta|parmesan|raclette|reblochon|feta|chevre)\b/.test(n)) return "Produits laitiers, œufs & fromages";
  if (/\b(biere|vin|cidre|champagne|whisky|vodka|rhum)\b/.test(n)) return "Boissons alcoolisées";
  if (/\b(cola|jus|eau|sirop|cafe|the|limonade|soda|nectar|orangina|schweppes|boisson|infusion|kombucha|smoothie)\b/.test(n)) return "Boissons non alcoolisées";
  if (/\b(pomme|poire|banane|orange|tomate|carotte|salade|courgette|oignon|ail|poireau|celeri|brocoli|poivron|aubergine|concombre|champignon|fraise|framboise|raisin|peche|abricot|melon|citron|kiwi|mangue|ananas|pamplemousse|legume|fruit|epinard|chou|navet|fenouil|radis|betterave|pasteque)\b/.test(n)) return "Fruits et légumes";
  if (/\b(saumon|thon|poisson|merlan|cabillaud|lieu|bar|dorade|sardine|maquereau|truite|crevette|moule|fruit de mer)\b/.test(n)) return "Poissons & fruits de mer";
  if (/\b(poulet|boeuf|porc|jambon|viande|steak|filet|escalope|dinde|lapin|agneau|canard|veau|lardons|chorizo|saucisse|merguez|andouille|rillettes|pate campagne)\b/.test(n)) return "Viandes & charcuterie";
  if (/surgel/.test(n)) return "Légumes surgelés";
  if (/\b(papier toilette|lessive|vaisselle|shampooing|shampoing|dentifrice|deodorant|savon|gel douche|rasoir|coton|essuie.tout|sac poubelle|nettoyant|desinfectant|lingette|brosse a dents|after.shave|mousse a raser)\b/.test(n)) return "Hygiène & Maison";
  if (/\b(sucre|chocolat|bonbon|confiture|miel|gateau|biscuit|cereale|compote|caramel|nougat|nutella|dessert|speculoos|madeleine|financier|brownie|macaron|praline|pate tartiner)\b/.test(n)) return "Épicerie sucrée & petit déjeuner";
  if (/\b(pates|riz|farine|huile|sel|poivre|sauce|conserve|soupe|chips|moutarde|mayonnaise|ketchup|vinaigre|lentilles|haricots|pois chiche|quinoa|couscous|pain|crackers|biscottes|bouillon|levure|chapelure|grissini)\b/.test(n)) return "Épicerie salée";
  return "Autres";
}

const SHARE_CATEGORIES = [
  "Fruits et légumes",
  "Viandes & charcuterie",
  "Poissons & fruits de mer",
  "Produits laitiers œufs & fromages",
  "Épicerie salée",
  "Épicerie sucrée & petit déjeuner",
  "Boissons non alcoolisées",
  "Boissons alcoolisées",
  "Surgelés",
  "Plats préparés & traiteur",
  "Entretien & nettoyage",
  "Hygiène & beauté",
  "Animalerie",
  "Ustensiles & équipement",
];
// Clé de matching pour la liste : produit+format+(marque si précisée)
function itemMatchesPrice(item, price) {
  const sameProduct = normName(price.product) === normName(item.product);
  const formatOk    = !item.format || !price.format || normFormat(price.format) === normFormat(item.format);
  const brandOk     = !item.brand || normName(item.brand) === normName(price.brand||"");
  return sameProduct && formatOk && brandOk;
}

// ── PSEUDO MODAL ─────────────────────────────────────────────────────────────
function PseudoModal({ onSave }) {
  const F = "'Nunito',sans-serif";
  const [value,   setValue]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handle = async () => {
    if (!value.trim()) return;
    setLoading(true); setError('');
    const result = await onSave(value.trim());
    if (result?.error) setError(result.error);
    setLoading(false);
  };

  const canSubmit = value.trim().length > 0 && !loading;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, padding:24 }}>
      <div style={{ background:"#fff", borderRadius:20, padding:"32px 24px", width:"100%", maxWidth:360, boxShadow:"0 20px 60px rgba(0,0,0,0.25)", animation:"popIn 0.35s ease" }}>
        <div style={{ fontSize:48, textAlign:"center", marginBottom:12 }}>👋</div>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:20, color:C.text, textAlign:"center", marginBottom:8 }}>
          Comment tu veux t'appeler ?
        </div>
        <div style={{ fontFamily:F, fontSize:13, color:C.textLight, textAlign:"center", marginBottom:24, lineHeight:1.6 }}>
          Ce pseudo sera affiché dans ton cercle privé.
        </div>
        <input
          type="text" autoFocus maxLength={30}
          value={value} onChange={e=>setValue(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&handle()}
          placeholder="Nico, Marie, Papy…"
          style={{ width:"100%", padding:"14px 16px", borderRadius:12, border:`2px solid ${value.trim()?C.blue:C.grayLight}`, fontFamily:F, fontSize:16, color:C.text, boxSizing:"border-box", marginBottom:error?8:16, textAlign:"center" }}
        />
        {error && <div style={{ fontFamily:F, fontSize:12, color:"#CC0000", fontWeight:700, marginBottom:12, textAlign:"center" }}>⚠️ {error}</div>}
        <button onClick={handle} disabled={!canSubmit}
          style={{ width:"100%", padding:"14px", border:"none", borderRadius:12, background:canSubmit?C.red:C.grayLight, fontFamily:F, fontWeight:900, fontSize:15, color:canSubmit?C.white:C.gray, cursor:canSubmit?"pointer":"default" }}>
          {loading ? "…" : "Valider →"}
        </button>
      </div>
    </div>
  );
}

// ── AUTH SCREEN ───────────────────────────────────────────────────────────────
function AuthScreen() {
  const F = "'Nunito',sans-serif";
  const [mode,     setMode]     = useState('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [cguAccepted, setCguAccepted] = useState(false);

  const switchMode = (m) => { setMode(m); setError(''); setSuccess(''); setConfirm(''); setShowPwd(false); setShowConf(false); setCguAccepted(false); };

  const handle = async () => {
    if (!email.trim() || !password.trim()) { setError("Remplis tous les champs"); return; }
    if (mode === 'register' && password !== confirm) { setError("Les mots de passe ne correspondent pas"); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      const { error } = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });
      if (error) throw error;
      if (mode === 'register') { switchMode('register_success'); }
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const pwdInput = (value, onChange, show, onToggle, placeholder, onEnter) => (
    <div style={{ position:"relative", marginBottom:14 }}>
      <input
        type={show ? "text" : "password"}
        value={value} onChange={onChange} placeholder={placeholder}
        onKeyDown={onEnter ? e=>e.key==='Enter'&&handle() : undefined}
        style={{ width:"100%", padding:"12px 44px 12px 14px", borderRadius:10, border:`2px solid ${C.grayLight}`, fontFamily:F, fontSize:14, color:C.text, boxSizing:"border-box" }}
      />
      <button onClick={onToggle} tabIndex={-1}
        style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:16, color:C.gray, padding:0, lineHeight:1 }}>
        {show ? "🙈" : "👁️"}
      </button>
    </div>
  );

  if (mode === 'register_success') return (
    <div style={{ minHeight:"100vh", background:C.bg, maxWidth:430, margin:"0 auto", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", padding:"32px 24px", overflowY:"auto" }}>
      <div style={{ fontSize:60, marginBottom:6 }}>🛒</div>
      <div style={{ fontFamily:F, fontWeight:900, fontSize:28, color:C.red, marginBottom:4 }}>PrixMalin</div>
      <div style={{ fontFamily:F, fontSize:13, color:C.textLight, marginBottom:24 }}>Comparez. Économisez.</div>

      <div style={{ background:C.white, borderRadius:20, padding:"24px 20px", width:"100%", boxShadow:"0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:18, color:C.text, marginBottom:20 }}>Bienvenue sur PrixMalin ✨</div>

        <div style={{ background:"#FFFBEA", borderRadius:12, padding:"14px 16px", marginBottom:14, border:"1.5px solid #FFD000" }}>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:13, color:"#7A5800", marginBottom:6 }}>📧 Vérifie ta boîte mail !</div>
          <div style={{ fontFamily:F, fontSize:12, color:"#5A4000", lineHeight:1.6 }}>
            Tu vas recevoir un email de confirmation de la part de Supabase (expéditeur du type <b>noreply@mail.app.supabase.io</b>). Ce n'est pas un email indésirable, c'est nécessaire pour activer ton compte. Clique sur le lien pour confirmer, puis reviens ici pour te connecter.
          </div>
        </div>

        <div style={{ background:"#F0FFF5", borderRadius:12, padding:"14px 16px", marginBottom:14, border:`1.5px solid ${C.green}` }}>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:13, color:"#006B27", marginBottom:6 }}>🔒 Tes données restent anonymes</div>
          <div style={{ fontFamily:F, fontSize:12, color:"#004D1C", lineHeight:1.6 }}>
            Les prix que tu scannes alimentent la comparaison pour toute la communauté, mais toujours de façon anonyme : personne ne sait que c'est toi qui as scanné tel ou tel prix. Ton pseudo n'est visible que si tu choisis de partager un achat avec ton cercle de proches.
          </div>
        </div>

        <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Conditions générales d'utilisation</div>
        <div style={{ background:C.bg, borderRadius:12, padding:"14px 16px", maxHeight:200, overflowY:"auto", marginBottom:16, border:`1px solid ${C.grayLight}` }}>
          <div style={{ fontFamily:F, fontWeight:800, fontSize:12, color:C.text, marginBottom:10 }}>📋 EN BREF</div>
          {[
            "PrixMalin est un projet personnel en phase de test, pas une entreprise. L'app peut évoluer, et son fonctionnement n'est pas garanti à 100%.",
            "Tes prix scannés alimentent la comparaison de prix pour tous les utilisateurs, mais toujours de façon anonyme — personne ne sait que c'est toi. Ton pseudo n'est visible que si tu choisis de partager un achat avec ton cercle de proches, article par article.",
            "Ton email n'est jamais visible par les autres utilisateurs. Pour t'identifier auprès de tes proches, seul ton pseudo (unique sur l'app) est utilisé.",
            "Si tu rejoins un cercle, les prix que tu partages restent visibles aux membres de ce cercle même si tu le quittes plus tard, sauf demande contraire de ta part.",
            "Les prix affichés (les tiens ou ceux partagés par ta communauté) sont fournis à titre indicatif. PrixMalin ne garantit pas qu'ils correspondent exactement au prix réel en magasin.",
            "Le créateur de l'app peut suspendre un compte en cas d'usage abusif ou de mauvaise foi (informations volontairement fausses, etc.).",
            "Tu peux demander la suppression de ton compte et de tes données à tout moment via le formulaire de contact de l'app.",
            "Ces règles peuvent évoluer ; tu seras informé des changements importants.",
          ].map((item, i) => (
            <div key={i} style={{ display:"flex", gap:8, marginBottom:8, fontFamily:F, fontSize:12, color:C.textLight, lineHeight:1.6 }}>
              <span style={{ flexShrink:0, color:C.red, fontWeight:900 }}>·</span>
              <span>{item}</span>
            </div>
          ))}
          <div style={{ marginTop:10, fontFamily:F, fontSize:12, color:C.text, fontWeight:700, fontStyle:"italic", lineHeight:1.5 }}>
            En cochant la case ci-dessous, tu confirmes avoir lu et accepté les Conditions Générales d'Utilisation complètes de PrixMalin.
          </div>
        </div>

        <div onClick={()=>setCguAccepted(v=>!v)}
          style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:20, cursor:"pointer" }}>
          <div style={{ width:22, height:22, borderRadius:6, border:`2px solid ${cguAccepted?C.green:C.gray}`, background:cguAccepted?C.green:"#fff", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", marginTop:1 }}>
            {cguAccepted && <span style={{ color:"#fff", fontSize:14, fontWeight:900, lineHeight:1 }}>✓</span>}
          </div>
          <div style={{ fontFamily:F, fontSize:13, color:C.text, fontWeight:700, lineHeight:1.5 }}>
            J'ai lu et j'accepte les Conditions Générales d'Utilisation
          </div>
        </div>

        <button onClick={()=>{ localStorage.setItem('prixmalin_cgu_pending','true'); switchMode('login'); }} disabled={!cguAccepted}
          style={{ width:"100%", padding:"14px", border:"none", borderRadius:12, background:cguAccepted?C.red:C.grayLight, fontFamily:F, fontWeight:900, fontSize:15, color:cguAccepted?C.white:C.gray, cursor:cguAccepted?"pointer":"default" }}>
          Continuer → Se connecter
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, maxWidth:430, margin:"0 auto", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px" }}>
      <div style={{ fontSize:60, marginBottom:6 }}>🛒</div>
      <div style={{ fontFamily:F, fontWeight:900, fontSize:28, color:C.red, marginBottom:4 }}>PrixMalin</div>
      <div style={{ fontFamily:F, fontSize:13, color:C.textLight, marginBottom:36 }}>Comparez. Économisez.</div>

      <div style={{ background:C.white, borderRadius:20, padding:"28px 24px", width:"100%", boxShadow:"0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:18, color:C.text, marginBottom:20 }}>
          {mode === 'login' ? 'Connexion' : 'Créer un compte'}
        </div>

        <div style={{ fontFamily:F, fontSize:12, fontWeight:700, color:C.gray, marginBottom:6 }}>Email</div>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="ton@email.com"
          style={{ width:"100%", padding:"12px 14px", borderRadius:10, border:`2px solid ${C.grayLight}`, fontFamily:F, fontSize:14, color:C.text, marginBottom:14, boxSizing:"border-box" }}
        />

        <div style={{ fontFamily:F, fontSize:12, fontWeight:700, color:C.gray, marginBottom:6 }}>Mot de passe</div>
        {pwdInput(password, e=>setPassword(e.target.value), showPwd, ()=>setShowPwd(s=>!s), "••••••••", mode==='login')}

        {mode === 'register' && (<>
          <div style={{ fontFamily:F, fontSize:12, fontWeight:700, color:C.gray, marginBottom:6 }}>Confirmer le mot de passe</div>
          {pwdInput(confirm, e=>setConfirm(e.target.value), showConf, ()=>setShowConf(s=>!s), "••••••••", true)}
        </>)}

        {error   && <div style={{ background:"#FEE", borderRadius:8, padding:"10px 12px", marginBottom:12, fontFamily:F, fontSize:13, color:C.red,   fontWeight:700 }}>⚠️ {error}</div>}
        {success && <div style={{ background:"#F0FFF5", borderRadius:8, padding:"10px 12px", marginBottom:12, fontFamily:F, fontSize:13, color:C.green, fontWeight:700 }}>✓ {success}</div>}

        <button onClick={handle} disabled={loading}
          style={{ width:"100%", padding:"14px", border:"none", borderRadius:12, background:loading?C.grayLight:C.red, fontFamily:F, fontWeight:900, fontSize:15, color:loading?C.gray:C.white, cursor:loading?"default":"pointer", marginBottom:12 }}>
          {loading ? "…" : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
        </button>

        <button onClick={()=>switchMode(mode==='login'?'register':'login')}
          style={{ width:"100%", padding:"10px", border:"none", background:"none", fontFamily:F, fontSize:13, color:C.blue, fontWeight:700, cursor:"pointer" }}>
          {mode === 'login' ? "Pas encore de compte → S'inscrire" : '← Déjà un compte ? Se connecter'}
        </button>
      </div>
    </div>
  );
}

// ── PROFIL SHEET ─────────────────────────────────────────────────────────────
function CircleSheet({ circles, userId, userEmail, profileMap, pseudo, archives, onClose, onInvite, onUpdateStatus }) {
  const F = "'Nunito',sans-serif";
  const [invitePseudo,  setInvitePseudo]  = useState('');
  const [inviteError,   setInviteError]   = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const inviteRef = useRef(null);
  const avatarColors = ["#E5181B","#F5C200","#00B341","#4A90D9","#8E44AD","#FF6B35"];

  const isMe = c => c.recipient_id === userId || c.recipient_email?.toLowerCase() === userEmail?.toLowerCase();
  const received = circles.filter(c => isMe(c) && c.status === 'pending');
  const accepted = circles.filter(c => c.status === 'accepted' && (c.requester_id === userId || isMe(c)));
  const sent     = circles.filter(c => c.requester_id === userId && c.status === 'pending');
  const otherDisplay = c => {
    const otherId = c.requester_id === userId ? c.recipient_id : c.requester_id;
    return (otherId && profileMap[otherId]) || '?';
  };
  const initial = s => (s || '?')[0].toUpperCase();

  const handleInvite = async () => {
    if (!invitePseudo.trim()) return;
    setInviteLoading(true); setInviteError('');
    const { error } = await onInvite(invitePseudo);
    if (error) setInviteError(error); else setInvitePseudo('');
    setInviteLoading(false);
  };

  const ringR = 56;
  const ringMembers = accepted.slice(0, 4);
  const extraMembers = accepted.length > 4 ? accepted.slice(4) : [];

  const thisMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  const scanned = archives.filter(a => a.ticket_scanned && a.realized_saving != null);
  const cagnotteTotal = scanned.reduce((s, a) => s + (a.realized_saving || 0), 0);
  const thisMonthSaving = scanned
    .filter(a => (a.date || '').startsWith(thisMonthStr))
    .reduce((s, a) => s + (a.realized_saving || 0), 0);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"24px 24px 0 0", width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"90vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease" }}>

        {/* Header */}
        <div style={{ background:C.red, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, borderRadius:"24px 24px 0 0" }}>
          <div>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.6)" }}>PrixMalin</div>
            <div style={{ fontFamily:F, fontSize:20, fontWeight:900, color:"#fff" }}>Mon Cercle</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", borderRadius:99, width:36, height:36, border:"none", fontSize:16, color:"#fff", cursor:"pointer" }}>✕</button>
        </div>

        {/* Avatar ring + savings */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", paddingTop:20, paddingBottom:4, flexShrink:0 }}>
          <div style={{ position:"relative", width:168, height:168 }}>
            <svg width="168" height="168" style={{ position:"absolute", inset:0 }}>
              <circle cx="84" cy="84" r={ringR} fill="none" stroke={C.grayLight} strokeWidth="2"/>
            </svg>
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
              <div style={{ fontFamily:F, fontWeight:900, fontSize:28, color:C.text, lineHeight:1 }}>{cagnotteTotal >= 0 ? "+" : ""}{cagnotteTotal.toFixed(2)} €</div>
              <div style={{ fontFamily:F, fontSize:11, color:thisMonthSaving === 0 ? C.gray : C.green, fontWeight:700, marginTop:3 }}>{thisMonthSaving >= 0 ? "+" : ""}{thisMonthSaving.toFixed(2)} € ce mois-ci</div>
            </div>
            {ringMembers.length === 0 ? (
              <div style={{ position:"absolute", left:84+ringR-14, top:84-14, width:28, height:28, borderRadius:"50%", background:C.grayLight, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:C.gray, border:"2px solid white" }}>+</div>
            ) : <>
              {ringMembers.map((c, i) => {
                const angle = (2 * Math.PI * i / ringMembers.length) - Math.PI / 2;
                const x = 84 + ringR * Math.cos(angle) - 14;
                const y = 84 + ringR * Math.sin(angle) - 14;
                return (
                  <div key={c.id} style={{ position:"absolute", left:x, top:y, width:28, height:28, borderRadius:"50%", background:avatarColors[i%avatarColors.length], display:"flex", alignItems:"center", justifyContent:"flex-start", fontFamily:F, fontWeight:900, fontSize:8, color:"#fff", border:"2px solid white", boxShadow:"0 2px 6px rgba(0,0,0,0.15)", paddingLeft:3, overflow:"visible" }}>
                    <span style={{ color:"#fff" }}>{otherDisplay(c).substring(0, 5)}</span>
                    <span style={{ color:"rgba(0,0,0,0.2)" }}>{otherDisplay(c).substring(5)}</span>
                  </div>
                );
              })}
              {extraMembers.map((c, j) => {
                const baseAngle = (2 * Math.PI * (ringMembers.length - 1) / ringMembers.length) - Math.PI / 2;
                const baseX = 84 + ringR * Math.cos(baseAngle) - 14;
                const baseY = 84 + ringR * Math.sin(baseAngle) - 14;
                return (
                  <div key={c.id} style={{ position:"absolute", left:baseX+(j+1)*4, top:baseY+(j+1)*4, width:28, height:28, borderRadius:"50%", background:"#999", display:"flex", alignItems:"center", justifyContent:"flex-start", fontFamily:F, fontWeight:900, fontSize:8, color:"#fff", border:"2px solid white", opacity:0.4, zIndex:extraMembers.length - j, paddingLeft:3, overflow:"visible" }}>
                    <span style={{ color:"#fff" }}>{otherDisplay(c).substring(0, 5)}</span>
                    <span style={{ color:"rgba(0,0,0,0.2)" }}>{otherDisplay(c).substring(5)}</span>
                  </div>
                );
              })}
            </>}
          </div>
        </div>

        {/* Scrollable */}
        <div style={{ overflowY:"auto", flex:1, padding:"8px 20px 40px" }}>

          {/* Invitations reçues */}
          {received.length > 0 && (<>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:"#E5181B", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
              📩 {received.length} invitation{received.length>1?"s":""} reçue{received.length>1?"s":""}
            </div>
            {received.map(c => (
              <div key={c.id} style={{ background:"#FFFBEA", borderRadius:12, padding:"12px 14px", marginBottom:8, border:"1.5px solid #FFD000", display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:F, fontWeight:800, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{profileMap[c.requester_id] || 'Utilisateur inconnu'}</div>
                  <div style={{ fontFamily:F, fontSize:11, color:C.textLight }}>veut partager ses prix avec toi</div>
                </div>
                <button onClick={()=>onUpdateStatus(c.id,'accepted')} style={{ padding:"8px 10px", border:"none", borderRadius:8, background:C.green, fontFamily:F, fontWeight:800, fontSize:12, color:"#fff", cursor:"pointer", flexShrink:0 }}>✓</button>
                <button onClick={()=>onUpdateStatus(c.id,'declined')} style={{ padding:"8px 10px", border:"1px solid #EFEFEF", borderRadius:8, background:"#fff", fontFamily:F, fontWeight:800, fontSize:12, color:C.gray, cursor:"pointer", flexShrink:0 }}>✕</button>
              </div>
            ))}
          </>)}

          {/* MON CERCLE */}
          <div style={{ background:C.bg, borderRadius:16, padding:"14px 16px", marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:accepted.length+sent.length>0?12:0 }}>
              <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em" }}>Mon cercle · Famille</div>
              <button onClick={()=>{ inviteRef.current?.focus(); inviteRef.current?.scrollIntoView({behavior:"smooth",block:"center"}); }}
                style={{ background:C.blue, border:"none", borderRadius:20, padding:"6px 14px", fontFamily:F, fontWeight:800, fontSize:12, color:"#fff", cursor:"pointer" }}>
                + Inviter
              </button>
            </div>
            {accepted.length === 0 && sent.length === 0 && (
              <div style={{ fontFamily:F, fontSize:13, color:C.textLight, padding:"8px 0 4px" }}>Aucun membre pour l'instant</div>
            )}
            {accepted.map((c, i) => {
              const name = otherDisplay(c);
              return (
                <div key={c.id} style={{ display:"flex", alignItems:"center", gap:12, paddingTop:i>0?10:0, paddingBottom:10, borderTop:i>0?`1px solid ${C.grayLight}`:"none" }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:avatarColors[i%avatarColors.length], display:"flex", alignItems:"center", justifyContent:"center", fontFamily:F, fontWeight:900, fontSize:14, color:"#fff", flexShrink:0 }}>
                    {initial(name)}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:F, fontWeight:800, fontSize:14, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
                    <div style={{ fontFamily:F, fontSize:11, color:C.green, fontWeight:700 }}>● Partage actif</div>
                  </div>
                  <button onClick={()=>onUpdateStatus(c.id,'revoked')} style={{ padding:"4px 10px", border:`1px solid ${C.grayLight}`, borderRadius:8, background:"#fff", fontFamily:F, fontSize:11, color:C.gray, cursor:"pointer" }}>Retirer</button>
                </div>
              );
            })}
            {sent.map((c, i) => (
              <div key={c.id} style={{ display:"flex", alignItems:"center", gap:12, paddingTop:accepted.length+i>0?10:0, paddingBottom:10, borderTop:accepted.length+i>0?`1px solid ${C.grayLight}`:"none" }}>
                <div style={{ width:36, height:36, borderRadius:"50%", background:C.grayLight, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:F, fontWeight:900, fontSize:14, color:C.gray, flexShrink:0 }}>?</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:F, fontWeight:700, fontSize:13, color:C.textLight, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{(c.recipient_id && profileMap[c.recipient_id]) || 'Invitation en attente'}</div>
                  <div style={{ fontFamily:F, fontSize:11, color:"#FFD000", fontWeight:700 }}>⏳ En attente</div>
                </div>
                <button onClick={()=>onUpdateStatus(c.id,'revoked')} style={{ padding:"4px 10px", border:`1px solid ${C.grayLight}`, borderRadius:8, background:"#fff", fontFamily:F, fontSize:11, color:C.gray, cursor:"pointer" }}>Annuler</button>
              </div>
            ))}
          </div>

          {/* Invite form */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Inviter par pseudo</div>
            <div style={{ display:"flex", gap:8 }}>
              <input ref={inviteRef} type="text" value={invitePseudo} onChange={e=>setInvitePseudo(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&handleInvite()}
                placeholder="@pseudo de ton ami"
                style={{ flex:1, padding:"12px 14px", borderRadius:10, border:`2px solid ${invitePseudo?C.blue:C.grayLight}`, fontFamily:F, fontSize:14, color:C.text, outline:"none" }}
              />
              <button onClick={handleInvite} disabled={inviteLoading||!invitePseudo.trim()}
                style={{ padding:"12px 16px", border:"none", borderRadius:10, background:inviteLoading||!invitePseudo.trim()?C.grayLight:C.blue, fontFamily:F, fontWeight:900, fontSize:14, color:inviteLoading||!invitePseudo.trim()?C.gray:"#fff", cursor:inviteLoading||!invitePseudo.trim()?"default":"pointer", flexShrink:0 }}>
                {inviteLoading ? "…" : "Inviter"}
              </button>
            </div>
            {inviteError && <div style={{ fontFamily:F, fontSize:12, color:"#CC0000", fontWeight:700, marginTop:8 }}>⚠️ {inviteError}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsSheet({ userId, archives, onClose }) {
  const F = "'Nunito',sans-serif";
  const [sharedCount, setSharedCount] = useState(null);
  useEffect(() => {
    supabase.from('community_prices')
      .select('id', { count:'exact', head:true })
      .eq('user_id', userId)
      .then(({ count }) => setSharedCount(count ?? 0));
  }, [userId]);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"24px 24px 0 0", width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"90vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:C.red, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, borderRadius:"24px 24px 0 0" }}>
          <div>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.6)" }}>PrixMalin</div>
            <div style={{ fontFamily:F, fontSize:20, fontWeight:900, color:"#fff" }}>Mes Statistiques</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", borderRadius:99, width:36, height:36, border:"none", fontSize:16, color:"#fff", cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ overflowY:"auto", flex:1, padding:"20px 20px 40px" }}>
          {/* Chantier 94 — le « Rang #1 » codé en dur est retiré : uniquement
              des chiffres réels et traçables. */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10 }}>
            {[
              { label:"Prix partagés", value: sharedCount === null ? "…" : String(sharedCount) },
              { label:"Tickets",       value: String(archives.length) },
            ].map(s => (
              <div key={s.label} style={{ background:C.bg, borderRadius:14, padding:"14px 8px", textAlign:"center" }}>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:22, color:C.text }}>{s.value}</div>
                <div style={{ fontFamily:F, fontSize:11, color:C.textLight, fontWeight:600, marginTop:3 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Chantier 92 Lot 6 — « Mes Favoris » (table Core favoris, par format).
// Même mécanique de sheet que « Mes Statistiques ». Distinct des « courses
// habituelles » (legacy favorites), qui ne bougent pas. Lecture best effort :
// un échec affiche un message, jamais un plantage.
function FavorisSheet({ userId, onClose }) {
  const F = "'Nunito',sans-serif";
  const [favoris, setFavoris] = useState(null); // null = chargement
  const [chargeErreur, setChargeErreur] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const data = await chargerFavoris(userId);
        if (!annule) setFavoris(data);
      } catch {
        if (!annule) { setFavoris([]); setChargeErreur(true); }
      }
    })();
    return () => { annule = true; };
  }, [userId]);

  // Retrait optimiste, restauré si la suppression échoue.
  const retirer = async (fav) => {
    setFavoris(prev => (prev || []).filter(f => f.id !== fav.id));
    const ok = await retirerFavori(fav.id);
    if (!ok) setFavoris(prev => [...(prev || []), fav]);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"24px 24px 0 0", width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"90vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:C.red, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, borderRadius:"24px 24px 0 0" }}>
          <div>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.6)" }}>PrixMalin</div>
            <div style={{ fontFamily:F, fontSize:20, fontWeight:900, color:"#fff" }}>Mes Favoris</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", borderRadius:99, width:36, height:36, border:"none", fontSize:16, color:"#fff", cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ overflowY:"auto", flex:1, padding:"16px 16px 40px" }}>
          {favoris === null && (
            <div style={{ fontFamily:F, fontSize:13, color:C.textLight, textAlign:"center", padding:"24px 0" }}>⏳ Chargement…</div>
          )}
          {favoris !== null && chargeErreur && (
            <div style={{ fontFamily:F, fontSize:13, color:C.textLight, textAlign:"center", padding:"24px 0" }}>⚠️ Favoris indisponibles pour le moment — réessaie plus tard.</div>
          )}
          {favoris !== null && !chargeErreur && favoris.length === 0 && (
            <div style={{ background:"#FFF0F0", borderRadius:16, padding:"28px 20px", textAlign:"center", border:"2px dashed #CC0000" }}>
              <div style={{ fontSize:44, marginBottom:8 }}>❤️</div>
              <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:"#CC0000", marginBottom:6 }}>Aucun favori pour l'instant</div>
              <div style={{ fontFamily:F, fontSize:13, color:C.textLight }}>Ajoute un format en favori depuis une fiche produit (❤️), ou laisse PrixMalin te proposer tes achats réguliers après un ticket.</div>
            </div>
          )}
          {favoris !== null && favoris.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {favoris.map(f => (
                <div key={f.id} style={{ display:"flex", alignItems:"center", gap:12, background:C.white, borderRadius:12, padding:"12px 14px", border:`1px solid ${C.grayLight}`, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                  <div style={{ width:38, height:38, flexShrink:0 }}>
                    <PhotoProduit varianteId={f.variante_produit_id} taille="thumb" radius={8}
                      fallback={<div style={{ width:"100%", height:"100%", borderRadius:8, background:C.grayLight, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>❤️</div>} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:F, fontWeight:800, fontSize:14, color:C.text }}>
                      {f.variante?.marques?.nom ? `${f.variante.marques.nom} · ` : ""}{f.produit?.nom_reference ?? "Produit"}
                    </div>
                    <div style={{ fontFamily:F, fontSize:12, color:C.gray, marginTop:1 }}>
                      {f.variante ? (formatFormatStructure(f.variante) || f.variante.libelle || "Format") : "Tous formats"}
                      {f.magasin?.nom ? ` · 🏪 ${f.magasin.nom}` : ""}
                    </div>
                  </div>
                  <button onClick={()=>retirer(f)} title="Retirer des favoris"
                    style={{ background:"none", border:"none", fontSize:15, cursor:"pointer", color:C.gray }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Chantier 94 Lot 10 — « Mon profil » : Points Malin, niveau, badges et
// statistiques RÉELLES. Affichage pur : le serveur attribue points et badges
// (Lots 8-9), le client ne fait que des SELECT. Chaque lecture a son filet :
// section dégradée (« bientôt disponible » / 0), jamais d'erreur bloquante.
// Stats privées — aucun classement public, aucun autre utilisateur exposé.
function ProfilSheet({ userId, pseudo, onClose, onBadgesVus }) {
  const F = "'Nunito',sans-serif";
  const [donnees, setDonnees] = useState(null); // null = chargement

  useEffect(() => {
    let annule = false;
    (async () => {
      const d = await chargerProfilGamification(userId);
      if (annule) return;
      setDonnees(d);
      // Tous les badges affichés sont considérés « vus » (plus de célébration
      // pour eux au prochain chargement).
      if (d.badges) { try { onBadgesVus?.(d.badges.map(b => b.code_badge)); } catch { /* jamais bloquant */ } }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const mouvements = donnees?.mouvements ?? null;
  const points = agregerPoints(mouvements || []);
  const niveau = calculerNiveau(points.total_valide);
  const stats = statistiquesContributions(mouvements || []);
  const badgesObtenus = donnees?.badges ?? null;
  const catalogue = donnees?.catalogue ?? null;
  const codesObtenus = new Set((badgesObtenus || []).map(b => b.code_badge));
  const catalogueParCode = new Map((catalogue || []).map(c => [c.code, c]));
  const aObtenir = (catalogue || []).filter(c => !codesObtenus.has(c.code));

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"24px 24px 0 0", width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"90vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:C.red, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, borderRadius:"24px 24px 0 0" }}>
          <div>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.6)" }}>PrixMalin</div>
            <div style={{ fontFamily:F, fontSize:20, fontWeight:900, color:"#fff" }}>Mon profil</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", borderRadius:99, width:36, height:36, border:"none", fontSize:16, color:"#fff", cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ overflowY:"auto", flex:1, padding:"16px 16px 40px" }}>
          {donnees === null && (
            <div style={{ fontFamily:F, fontSize:13, color:C.textLight, textAlign:"center", padding:"24px 0" }}>⏳ Chargement…</div>
          )}
          {donnees !== null && (
            <>
              {/* En-tête : pseudo, niveau, points validés / en attente, progression */}
              <div style={{ background:"linear-gradient(135deg,#CC0000,#FF1A1A)", borderRadius:16, padding:"16px", marginBottom:14, color:"#fff" }}>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:17 }}>{pseudo || "Moi"}</div>
                <div style={{ fontFamily:F, fontWeight:800, fontSize:13, opacity:0.9, marginBottom:10 }}>🏅 {niveau.niveau_actuel}</div>
                {mouvements === null ? (
                  <div style={{ fontFamily:F, fontSize:13, opacity:0.85 }}>Points Malin bientôt disponibles — réessaie plus tard.</div>
                ) : (
                  <>
                    <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                      <span style={{ fontFamily:F, fontWeight:900, fontSize:30 }}>{points.total_valide}</span>
                      <span style={{ fontFamily:F, fontWeight:800, fontSize:13, opacity:0.85 }}>Points Malin</span>
                      {points.total_en_attente > 0 && (
                        <span style={{ fontFamily:F, fontWeight:800, fontSize:12, background:"rgba(255,255,255,0.2)", borderRadius:99, padding:"3px 9px", marginLeft:"auto" }}>
                          + {points.total_en_attente} en attente
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop:10, height:8, borderRadius:99, background:"rgba(255,255,255,0.25)", overflow:"hidden" }}>
                      <div style={{ width:`${niveau.progression_pct}%`, height:"100%", borderRadius:99, background:"#FFD700" }} />
                    </div>
                    <div style={{ fontFamily:F, fontSize:12, fontWeight:700, marginTop:6, opacity:0.9 }}>
                      {niveau.niveau_suivant
                        ? `Plus que ${niveau.points_restants} point${niveau.points_restants > 1 ? "s" : ""} pour devenir ${niveau.niveau_suivant}`
                        : "Niveau maximum atteint — chapeau !"}
                    </div>
                  </>
                )}
              </div>

              {/* Badges obtenus */}
              <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>Badges obtenus</div>
              {badgesObtenus === null && (
                <div style={{ fontFamily:F, fontSize:13, color:C.textLight, marginBottom:14 }}>Bientôt disponibles.</div>
              )}
              {badgesObtenus !== null && badgesObtenus.length === 0 && (
                <div style={{ fontFamily:F, fontSize:13, color:C.textLight, marginBottom:14 }}>Aucun badge pour l'instant — tes contributions validées les débloqueront.</div>
              )}
              {badgesObtenus !== null && badgesObtenus.length > 0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
                  {badgesObtenus.map(b => {
                    const fiche = catalogueParCode.get(b.code_badge);
                    return (
                      <div key={b.code_badge} style={{ display:"flex", alignItems:"center", gap:12, background:"#FFF8E6", border:"1.5px solid #F0DFA8", borderRadius:12, padding:"10px 12px" }}>
                        <span style={{ fontSize:26, flexShrink:0 }}>{fiche?.icone || "🏅"}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontFamily:F, fontWeight:900, fontSize:14, color:C.text }}>{fiche?.nom || b.code_badge}</div>
                          {fiche?.description && <div style={{ fontFamily:F, fontSize:12, color:C.textLight }}>{fiche.description}</div>}
                          {b.obtenu_le && (
                            <div style={{ fontFamily:F, fontSize:11, color:C.gray, marginTop:2 }}>
                              Obtenu le {new Date(b.obtenu_le).toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Badges à débloquer (grisés, avec progression réelle) */}
              {aObtenir.length > 0 && (
                <>
                  <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>À débloquer</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
                    {aObtenir.map(c => {
                      const prog = progressionBadge(c.condition_type, c.seuil, mouvements || []);
                      return (
                        <div key={c.code} style={{ display:"flex", alignItems:"center", gap:12, background:"#F7F7F7", border:"1px solid #eee", borderRadius:12, padding:"10px 12px", opacity:0.75 }}>
                          <span style={{ fontSize:26, flexShrink:0, filter:"grayscale(1)" }}>{c.icone || "🏅"}</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontFamily:F, fontWeight:900, fontSize:14, color:"#666" }}>{c.nom}</div>
                            {c.description && <div style={{ fontFamily:F, fontSize:12, color:C.gray }}>{c.description}</div>}
                          </div>
                          {mouvements !== null && prog.courant != null && (
                            <span style={{ fontFamily:F, fontWeight:900, fontSize:12, color:C.gray, whiteSpace:"nowrap" }}>
                              {Math.min(prog.courant, prog.seuil)}/{prog.seuil}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Statistiques réelles uniquement (privées) */}
              <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>Mes contributions</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10 }}>
                {[
                  mouvements !== null && { label:"Prix ajoutés",       value: String(stats.prix_ajoutes) },
                  mouvements !== null && { label:"Prix actualisés",    value: String(stats.prix_actualises) },
                  donnees.nbTickets !== null && { label:"Tickets analysés", value: String(donnees.nbTickets) },
                  mouvements !== null && { label:"Magasins contribués", value: String(stats.magasins_contribues) },
                ].filter(Boolean).map(s => (
                  <div key={s.label} style={{ background:C.bg, borderRadius:14, padding:"14px 8px", textAlign:"center" }}>
                    <div style={{ fontFamily:F, fontWeight:900, fontSize:22, color:C.text }}>{s.value}</div>
                    <div style={{ fontFamily:F, fontSize:11, color:C.textLight, fontWeight:600, marginTop:3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily:F, fontSize:11, color:C.gray, textAlign:"center", marginTop:14 }}>
                Tes statistiques sont privées — personne d'autre ne les voit.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FaqSheet({ userId, pseudo, onClose }) {
  const F = "'Nunito',sans-serif";
  const [showFeedback,      setShowFeedback]      = useState(false);
  const [feedbackCategorie, setFeedbackCategorie] = useState('suggestion');
  const [feedbackMessage,   setFeedbackMessage]   = useState('');
  const [feedbackLoading,   setFeedbackLoading]   = useState(false);
  const [feedbackError,     setFeedbackError]     = useState('');
  const [feedbackSuccess,   setFeedbackSuccess]   = useState(false);
  const handleFeedback = async () => {
    if (!feedbackMessage.trim()) return;
    setFeedbackLoading(true); setFeedbackError('');
    const { error } = await supabase.from('feedback').insert({ user_id:userId, pseudo, categorie:feedbackCategorie, message:feedbackMessage.trim() });
    if (error) {
      setFeedbackError("Erreur lors de l'envoi, réessaie.");
    } else {
      setFeedbackSuccess(true);
      setTimeout(() => { setShowFeedback(false); setFeedbackSuccess(false); setFeedbackMessage(''); setFeedbackCategorie('bug'); }, 2000);
    }
    setFeedbackLoading(false);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"24px 24px 0 0", width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"90vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:C.red, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, borderRadius:"24px 24px 0 0" }}>
          <div>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.6)" }}>PrixMalin</div>
            <div style={{ fontFamily:F, fontSize:20, fontWeight:900, color:"#fff" }}>Nous contacter</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", borderRadius:99, width:36, height:36, border:"none", fontSize:16, color:"#fff", cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ overflowY:"auto", flex:1, padding:"20px 20px 40px" }}>
          {!showFeedback ? (
            <button onClick={()=>setShowFeedback(true)} style={{ width:"100%", padding:"14px", border:`1.5px solid ${C.blue}`, borderRadius:14, background:"#fff", fontFamily:F, fontWeight:800, fontSize:14, color:C.blue, cursor:"pointer" }}>
              Contact / Signaler un problème
            </button>
          ) : (
            <div style={{ background:C.bg, borderRadius:16, padding:"14px 16px" }}>
              <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:12 }}>Contact / Signaler un problème</div>
              {feedbackSuccess ? (
                <div style={{ fontFamily:F, fontSize:14, fontWeight:700, color:C.green, textAlign:"center", padding:"12px 0" }}>Merci, ton message a été envoyé !</div>
              ) : (<>
                <select value={feedbackCategorie} onChange={e=>setFeedbackCategorie(e.target.value)} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1.5px solid ${C.grayLight}`, fontFamily:F, fontSize:14, color:C.text, background:"#fff", marginBottom:10, outline:"none", boxSizing:"border-box" }}>
                  <option value="suggestion">💡 Suggestion</option>
                  <option value="bug">🔧 Signaler un problème</option>
                  <option value="question">❓ Question</option>
                  <option value="autre">💬 Autre</option>
                </select>
                <textarea value={feedbackMessage} onChange={e=>setFeedbackMessage(e.target.value)} placeholder="Décris ton problème ou ta suggestion…" rows={4} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1.5px solid ${feedbackMessage?C.blue:C.grayLight}`, fontFamily:F, fontSize:14, color:C.text, outline:"none", resize:"none", boxSizing:"border-box", marginBottom:10 }}/>
                {feedbackError && <div style={{ fontFamily:F, fontSize:12, color:"#CC0000", fontWeight:700, marginBottom:8 }}>⚠️ {feedbackError}</div>}
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>{ setShowFeedback(false); setFeedbackMessage(''); setFeedbackError(''); setFeedbackCategorie('bug'); }} style={{ flex:1, padding:"12px", border:`1px solid ${C.grayLight}`, borderRadius:10, background:"#fff", fontFamily:F, fontWeight:800, fontSize:14, color:C.gray, cursor:"pointer" }}>Annuler</button>
                  <button onClick={handleFeedback} disabled={feedbackLoading||!feedbackMessage.trim()} style={{ flex:2, padding:"12px", border:"none", borderRadius:10, background:feedbackLoading||!feedbackMessage.trim()?C.grayLight:C.blue, fontFamily:F, fontWeight:900, fontSize:14, color:feedbackLoading||!feedbackMessage.trim()?C.gray:"#fff", cursor:feedbackLoading||!feedbackMessage.trim()?"default":"pointer" }}>
                    {feedbackLoading ? "…" : "Envoyer"}
                  </button>
                </div>
              </>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MesPrixSheet({ priceDB, setPriceDB, archives, updateArchive, onTicketValidated, onCreateArchive, userId, produitsRef, onClose, coreActifGlobal }) {
  const F = "'Nunito',sans-serif";
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"24px 24px 0 0", width:"100%", maxWidth:430, margin:"0 auto", maxHeight:"90vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:C.red, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, borderRadius:"24px 24px 0 0" }}>
          <div>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.6)" }}>PrixMalin</div>
            <div style={{ fontFamily:F, fontSize:20, fontWeight:900, color:"#fff" }}>Mes Prix</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", borderRadius:99, width:36, height:36, border:"none", fontSize:16, color:"#fff", cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ overflowY:"auto", flex:1 }}>
          <PricesTab priceDB={priceDB} setPriceDB={setPriceDB} archives={archives} updateArchive={updateArchive} onTicketValidated={onTicketValidated} onCreateArchive={onCreateArchive} userId={userId} produitsRef={produitsRef} hideActions={true} coreActifGlobal={coreActifGlobal}/>
        </div>
      </div>
    </div>
  );
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function Header({ tab, itemCount, userEmail, displayName, onLogout, pendingCount, onCircle }) {
  const F = "'Nunito',sans-serif";
  const titles = { list:"Ma liste", catalog:"Catalogue", compare:"Comparer", prices:"Mes prix", archive:"Historique", economies:"Mes économies", rejets:"Rejets", micro:"Micro" };
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);
  return (
    <div style={{ background:C.blue, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", boxShadow:"0 4px 20px rgba(204,0,0,0.4)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:"#FFFFFF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>🛒</div>
        <div>
          <div style={{ fontFamily:F, fontWeight:700, fontSize:11, color:"rgba(255,255,255,0.7)", lineHeight:1 }}>PrixMalin</div>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:20, color:C.white, marginTop:1 }}>{titles[tab]}</div>
          {tab==="archive" && (
            <div style={{ fontFamily:F, fontSize:10, color:"rgba(255,255,255,0.55)", marginTop:2 }}>
              Tous tes tickets scannés, par mois ou par produit
            </div>
          )}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {tab==="list" && itemCount>0 && (
          <div style={{ background:C.orange, borderRadius:99, padding:"6px 14px", fontFamily:F, fontWeight:800, fontSize:13, color:C.white }}>
            🧾 {itemCount} article{itemCount>1?"s":""}
          </div>
        )}
        {userEmail && (
          <div ref={menuRef} style={{ position:"relative" }}>
            <button onClick={()=>setShowMenu(s=>!s)}
              style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:99, padding:"6px 10px", fontFamily:F, fontSize:12, fontWeight:700, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", gap:5, position:"relative" }}>
              👤 {displayName || userEmail.split('@')[0]}
              {pendingCount > 0 && (
                <span style={{ position:"absolute", top:-4, right:-4, background:C.orange, borderRadius:99, width:16, height:16, fontSize:10, fontWeight:900, color:C.white, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>{pendingCount}</span>
              )}
            </button>
            {showMenu && (
              <div style={{ position:"absolute", right:0, top:38, background:C.white, borderRadius:12, boxShadow:"0 4px 20px rgba(0,0,0,0.15)", padding:"8px", zIndex:200, minWidth:170 }}>
                <div style={{ fontFamily:F, padding:"6px 10px" }}>
                  {displayName && <div style={{ fontSize:13, fontWeight:800, color:C.text }}>{displayName}</div>}
                  <div style={{ fontSize:12, color:C.textLight }}>{userEmail}</div>
                </div>
                <button onClick={()=>{ setShowMenu(false); onCircle(); }}
                  style={{ width:"100%", padding:"10px 12px", border:"none", background:"none", borderRadius:8, fontFamily:F, fontWeight:800, fontSize:13, color:C.text, cursor:"pointer", textAlign:"left", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <span>👥 Mon cercle</span>
                  {pendingCount > 0 && <span style={{ background:C.orange, borderRadius:99, padding:"2px 7px", fontSize:11, color:C.white, fontWeight:900 }}>{pendingCount}</span>}
                </button>
                <button onClick={()=>{ setShowMenu(false); onLogout(); }}
                  style={{ width:"100%", padding:"10px 12px", border:"none", background:"#FEE", borderRadius:8, fontFamily:F, fontWeight:800, fontSize:13, color:C.red, cursor:"pointer", textAlign:"left" }}>
                  Se déconnecter
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TAB BAR ───────────────────────────────────────────────────────────────────
// Couleurs par identité d'onglet (id), jamais par index/position — pack
// d'animations "Fou furieux". home/economies réutilisent C.blue/C.green ;
// archive/rejets reprennent des teintes déjà présentes ailleurs dans l'app
// (bleu de AutresOptionsSheet/MultiPhotoSheet, violet du mode debug Core #56.4)
// plutôt que d'inventer une palette nouvelle.
const TAB_COLORS = {
  home:      C.blue,
  archive:   "#4A90D9",
  economies: C.green,
  rejets:    "#8E44AD",
};

function runTabBounce(el) {
  if (!el?.animate) return;
  el.animate([
    { transform:"scale(0.7) rotate(0deg)",   offset:0 },
    { transform:"scale(1.55) rotate(4deg)",  offset:0.4 },
    { transform:"scale(1.22) rotate(-2deg)", offset:0.7 },
    { transform:"scale(1.3) rotate(0deg)",   offset:1 },
  ], { duration:550, easing:"cubic-bezier(.34,1.56,.64,1)" });
}

function runTabParticles(layer, el, color) {
  if (!layer || !el?.animate) return;
  const layerRect = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width/2 - layerRect.left;
  const cy = r.top  + r.height/2 - layerRect.top;
  const N = 12;
  for (let i=0; i<N; i++) {
    const angle = (i/N) * Math.PI * 2;
    const dist  = 30 + Math.random()*12;
    const dx = Math.cos(angle)*dist, dy = Math.sin(angle)*dist;
    const size = 6 + Math.random()*2;
    const white = i % 4 === 0;
    const p = document.createElement("div");
    p.style.cssText = `position:absolute;width:${size}px;height:${size}px;border-radius:50%;left:${cx-size/2}px;top:${cy-size/2}px;background:${white?"#fff":color};pointer-events:none;`;
    layer.appendChild(p);
    p.animate([
      { transform:"translate(0,0) scale(1)", opacity:1 },
      { transform:`translate(${dx}px,${dy}px) scale(0.2)`, opacity:0 },
    ], { duration:600, easing:"cubic-bezier(.2,.7,.3,1)" }).onfinish = () => p.remove();
  }
}

function runTabComet(layer, fromEl, toEl, color, onArrive) {
  if (!layer || !fromEl?.animate || !toEl) return;
  const layerRect = layer.getBoundingClientRect();
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const ax = a.left + a.width/2 - layerRect.left, ay = a.top + a.height/2 - layerRect.top;
  const bx = b.left + b.width/2 - layerRect.left, by = b.top + b.height/2 - layerRect.top;
  const dx = bx - ax, dy = by - ay;

  const comet = document.createElement("div");
  comet.style.cssText = `position:absolute;width:16px;height:16px;border-radius:50%;left:${ax-8}px;top:${ay-8}px;background:radial-gradient(circle,#fff 0%,${color} 70%);box-shadow:0 0 10px 3px ${color},0 0 4px 2px #fff;pointer-events:none;`;
  layer.appendChild(comet);

  let step = 0;
  const totalSteps = 6;
  const trailTimer = setInterval(() => {
    step += 1;
    if (step >= totalSteps) { clearInterval(trailTimer); return; }
    const t = step / totalSteps;
    const sx = ax + dx*t, sy = ay + dy*t;
    // Poussière d'étoiles : taille aléatoire 4-10px, retombe doucement
    // (10-20px de descente) en rétrécissant/s'estompant, avec un
    // scintillement (opacity qui varie) pendant la chute — durée de vie
    // volontairement longue (~1-1,2s) pour rester visible derrière la comète.
    const size = 4 + Math.random()*6;
    const fall = 10 + Math.random()*10;
    const spark = document.createElement("div");
    spark.style.cssText = `position:absolute;width:${size}px;height:${size}px;border-radius:50%;left:${sx-size/2}px;top:${sy-size/2}px;background:${color};pointer-events:none;`;
    layer.appendChild(spark);
    spark.animate([
      { opacity:0.9,  transform:"translateY(0) scale(1)",                     offset:0    },
      { opacity:0.45, transform:`translateY(${fall*0.4}px) scale(0.85)`,      offset:0.35 },
      { opacity:0.8,  transform:`translateY(${fall*0.6}px) scale(0.7)`,       offset:0.55 },
      { opacity:0.25, transform:`translateY(${fall*0.85}px) scale(0.45)`,     offset:0.8  },
      { opacity:0,    transform:`translateY(${fall}px) scale(0.15)`,          offset:1    },
    ], { duration:1000 + Math.random()*200, easing:"ease-out" }).onfinish = () => spark.remove();
  }, 500/totalSteps);

  const cometAnim = comet.animate([
    { transform:"translate(0,0)",                     offset:0   },
    { transform:`translate(${dx*0.5}px,${dy*0.5}px)`, offset:0.5 },
    { transform:`translate(${dx}px,${dy}px)`,         offset:1   },
  ], { duration:500, easing:"ease-in" });

  cometAnim.onfinish = () => {
    clearInterval(trailTimer);
    comet.remove();

    // Éclat d'impact — deux couches : flash central + onde de choc (anneau
    // net qui s'étend en s'affinant), plus quelques éclats blancs projetés.
    // Diamètre de référence pris sur le cercle d'arrivée déjà rendu (donc
    // déjà à sa taille "actif" éventuelle) pour calibrer l'expansion en 1,5-2x.
    const diam = b.width;
    const flashMax = diam * 1.8;

    const flash = document.createElement("div");
    flash.style.cssText = `position:absolute;width:${diam*0.5}px;height:${diam*0.5}px;border-radius:50%;left:${bx-diam*0.25}px;top:${by-diam*0.25}px;background:radial-gradient(circle,#fff 0%,${color} 60%,transparent 75%);pointer-events:none;`;
    layer.appendChild(flash);
    flash.animate([
      { opacity:1, transform:"scale(1)" },
      { opacity:0, transform:`scale(${flashMax/(diam*0.5)})` },
    ], { duration:650, easing:"ease-out" }).onfinish = () => flash.remove();

    const ring = document.createElement("div");
    ring.style.cssText = `position:absolute;width:${diam}px;height:${diam}px;border-radius:50%;left:${bx-diam/2}px;top:${by-diam/2}px;border:3px solid #fff;background:transparent;pointer-events:none;`;
    layer.appendChild(ring);
    ring.animate([
      { opacity:0.9, transform:"scale(1)",                 borderWidth:"3px" },
      { opacity:0,   transform:`scale(${flashMax/diam})`,  borderWidth:"0px" },
    ], { duration:650, easing:"ease-out" }).onfinish = () => ring.remove();

    const nbEclats = 4 + Math.floor(Math.random()*3);
    for (let i=0; i<nbEclats; i++) {
      const angle = Math.random()*Math.PI*2;
      const dist = diam*0.5 + Math.random()*diam*0.4;
      const ex = Math.cos(angle)*dist, ey = Math.sin(angle)*dist;
      const eclat = document.createElement("div");
      eclat.style.cssText = `position:absolute;width:5px;height:5px;border-radius:50%;left:${bx-2.5}px;top:${by-2.5}px;background:#fff;pointer-events:none;`;
      layer.appendChild(eclat);
      eclat.animate([
        { transform:"translate(0,0) scale(1)", opacity:1 },
        { transform:`translate(${ex}px,${ey}px) scale(0.2)`, opacity:0 },
      ], { duration:500, easing:"ease-out" }).onfinish = () => eclat.remove();
    }

    onArrive?.();
  };
}

function TabBar({ tab, setTab, isAdmin }) {
  const F = "'Nunito',sans-serif";
  const tabs = [
    { id:"home",      icon:"🏠", label:"Accueil"   },
    { id:"archive",   icon:"📦", label:"Historique"},
    { id:"economies", icon:"💰", label:"Économies" },
    // #56.3b — onglet admin uniquement, jamais rendu pour un utilisateur non-admin.
    ...(isAdmin ? [{ id:"rejets", icon:"🛠️", label:"Rejets" }] : []),
  ];

  const btnRefs = useRef({});
  const fxLayerRef = useRef(null);
  const prevTabRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mql) return;
    const onChange = () => setReducedMotion(mql.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  // Rebond + particules + comète : uniquement au CHANGEMENT d'onglet, jamais
  // au montage initial (prevTabRef démarre à null pour distinguer les deux).
  // useLayoutEffect (pas useEffect) pour démarrer l'animation avant peinture
  // et éviter un flash "scale(1.3) statique" avant le rebond.
  useLayoutEffect(() => {
    if (prevTabRef.current === null) { prevTabRef.current = tab; return; }
    const prevId = prevTabRef.current;
    prevTabRef.current = tab;
    if (prevId === tab || reducedMotion) return;

    const layer = fxLayerRef.current;
    const toEl = btnRefs.current[tab];
    const fromEl = btnRefs.current[prevId];
    if (!layer || !toEl) return;

    const color = TAB_COLORS[tab] || C.text;
    const arrivee = () => { runTabBounce(toEl); runTabParticles(layer, toEl, color); };
    if (fromEl) runTabComet(layer, fromEl, toEl, color, arrivee);
    else arrivee();
  }, [tab, reducedMotion]);

  return (
    <div className="tabBarRoot" style={{ position:"fixed", bottom:16, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, display:"flex", justifyContent:"space-evenly", alignItems:"center", zIndex:50, pointerEvents:"none" }}>
      {tabs.map(t=>{
        const active = tab===t.id;
        const color = TAB_COLORS[t.id] || C.text;
        return (
          <button key={t.id} onClick={()=>setTab(t.id)} onTouchStart={()=>{}} style={{ border:"none", background:"none", cursor:"pointer", padding:0, display:"flex", flexDirection:"column", alignItems:"center", pointerEvents:"all" }}>
            <div
              ref={el => { btnRefs.current[t.id] = el; }}
              className="tabCircleBtn"
              style={{
                width:48, height:48, borderRadius:"50%", boxSizing:"border-box",
                background: color,
                border: active ? "5px solid #fff" : "3px solid #fff",
                display:"flex", alignItems:"center", justifyContent:"center",
                transform: active ? "scale(1.3)" : "scale(1)",
                transition: "transform 0.2s ease",
                // Anneau blanc net via border (couche intermédiaire) ; le néon
                // (box-shadow) démarre par nature au bord externe du border,
                // donc toujours à l'extérieur de l'anneau, jamais par-dessus.
                boxShadow: active
                  ? (reducedMotion
                      ? `0 4px 12px rgba(0,0,0,0.15), 0 0 8px 2px ${color}88`
                      : `0 4px 12px rgba(0,0,0,0.15), 0 0 10px 2px ${color}`)
                  : "0 4px 12px rgba(0,0,0,0.15)",
                animation: active && !reducedMotion ? "tabNeonPulse 1.2s ease-in-out infinite" : "none",
                "--tab-glow": color,
              }}
            >
              <span style={{ fontSize:24 }}>{t.icon}</span>
            </div>
            <span style={{ marginTop:4, fontFamily:F, fontSize:10, fontWeight: active?900:700, color: active?color:C.textLight }}>
              {t.label}
            </span>
          </button>
        );
      })}
      <div ref={fxLayerRef} style={{ position:"absolute", inset:0, pointerEvents:"none", overflow:"visible" }} />
    </div>
  );
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function Toast({ msg, ok = true }) {
  return (
    <div style={{
      position:"fixed", bottom:76, left:"50%", transform:"translateX(-50%)",
      background:ok?C.green:C.red, color:C.white,
      padding:"10px 22px", borderRadius:99,
      fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14,
      zIndex:500, animation:"popIn 0.3s ease",
      boxShadow:"0 4px 16px rgba(0,0,0,0.2)",
      whiteSpace:"nowrap", pointerEvents:"none",
    }}>
      {msg}
    </div>
  );
}

// ── BROUILLON DE SCAN (Chantier 79) ───────────────────────────────────────────
// Reprise d'un scan interrompu. L'état post-OCR d'ImportTicketSheet ne vit
// qu'en mémoire et est perdu quand iOS recharge la page en arrière-plan. On le
// sérialise dans localStorage (léger : le résultat OCR déjà parsé + les
// éditions + l'étape, JAMAIS l'image). Clé versionnée : changer le suffixe
// invalide proprement un ancien format. Aucun réseau, aucune base.
const SCAN_DRAFT_KEY = 'prixmalin_scanDraft_v1';
function lireScanDraft() {
  try { const s = localStorage.getItem(SCAN_DRAFT_KEY); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
function ecrireScanDraft(draft) {
  try { localStorage.setItem(SCAN_DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota/mode privé : on ignore */ }
}
function effacerScanDraft() {
  try { localStorage.removeItem(SCAN_DRAFT_KEY); } catch { /* ignore */ }
}
function formatDateBrouillon(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
}
// ── BROUILLON MICRO (Chantier Micro, Lot 3) ──────────────────────────────────
// Même mécanique éprouvée que le brouillon de scan : le RÉCAPITULATIF (texte
// seulement — jamais l'audio, qui n'est pas conservé) survit à un rechargement
// iOS en arrière-plan via localStorage. Clé versionnée.
const MICRO_DRAFT_KEY = 'prixmalin_microDraft_v1';
function lireMicroDraft() {
  try { const s = localStorage.getItem(MICRO_DRAFT_KEY); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
function ecrireMicroDraft(draft) {
  try { localStorage.setItem(MICRO_DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota/mode privé : on ignore */ }
}
function effacerMicroDraft() {
  try { localStorage.removeItem(MICRO_DRAFT_KEY); } catch { /* ignore */ }
}
// Identifiant local d'un élément du récapitulatif. Volontairement HORS
// composant (compteur module) : pas d'appel impur dans le corps du composant
// (règle react-hooks/purity), unicité garantie au sein de la session.
let microSeqElement = 0;
// ── SESSION DE COURSES (Chantier « Courses », Lot 1 — shadow estFrancois) ────
// Même mécanique éprouvée que les brouillons de scan et de micro : la session
// de courses figée survit à un rechargement / une fermeture via localStorage.
// Clé versionnée. Le filet Supabase arrive au Lot 4 (obligatoire avant toute
// sortie du shadow — arbitrage François du 2026-08-11).
const SESSION_COURSES_KEY = 'prixmalin_sessionCourses_v1';
function lireSessionCourses() {
  try { const s = localStorage.getItem(SESSION_COURSES_KEY); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
function ecrireSessionCourses(sessionCourses) {
  try { localStorage.setItem(SESSION_COURSES_KEY, JSON.stringify(sessionCourses)); } catch { /* quota/mode privé : on ignore */ }
}
// Lot 3 — abandon explicite depuis la carte d'accueil (et clôture au Lot 6).
function effacerSessionCourses() {
  try { localStorage.removeItem(SESSION_COURSES_KEY); } catch { /* ignore */ }
}
// Lot 3 — ancienneté d'une session pour le bandeau de la carte d'accueil
// (arbitrage François : jamais d'expiration automatique, seulement informer).
function joursDepuis(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
function genIdElementMicro() {
  microSeqElement += 1;
  return `el_${microSeqElement}_${Math.random().toString(36).slice(2, 8)}`;
}

// Étape du scan en langage utilisateur (pas la valeur technique de status).
// Le brouillon n'est sauvegardé qu'aux étapes 'store' et 'share' ; 'store'
// couvre à la fois le magasin et la revue des produits.
function etapeLisibleScan(status) {
  if (status === 'share') return 'Partage';
  if (status === 'store') return 'Vérification du magasin et des produits';
  return 'Prise de photo';
}

// ── IMPORT TICKET SHEET ───────────────────────────────────────────────────────
function ImportTicketSheet({ onClose, onImport, refProducts = [], directCamera = false, autoOpenGallery = false, onManualEntry, initialResult = null, resumeDraft = null, estFrancois = false, magasinSession = null, onVoirTicketExistant = null, onDoublonTardif = null, onPointsCredites = null }) {
  const [jsonText, setJsonText] = useState("");
  const [status,   setStatus]   = useState(directCamera ? "camera" : "idle");
  const [error,    setError]    = useState("");
  const [result,   setResult]   = useState(null);
  const [selectedStore, setSelectedStore] = useState("");
  const [editableProducts, setEditableProducts] = useState([]);
  const [scanning,      setScanning]      = useState(false);
  const [galleryScanning, setGalleryScanning] = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [storeNameEdit, setStoreNameEdit] = useState("");
  const [storeLocation, setStoreLocation] = useState("");
  const [knownStores, setKnownStores] = useState([]);
  const [knownStoresLoading, setKnownStoresLoading] = useState(false);
  const [resolvedStoreId, setResolvedStoreId] = useState(null);
  const [newStoreSubMode, setNewStoreSubMode] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [manualRue, setManualRue] = useState('');
  const [manualCP, setManualCP] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [manualVille, setManualVille] = useState('');
  const [manualGeocoding,   setManualGeocoding]   = useState(false);
  const [enseigneQuery,     setEnseigneQuery]     = useState('');
  const [showEnseigneDrop,   setShowEnseigneDrop]   = useState(false);
  const [showEnseigneSearch, setShowEnseigneSearch] = useState(false);
  const [showManualAddress, setShowManualAddress] = useState(false);
  const [savedGpsCoords,    setSavedGpsCoords]    = useState(null);
  // LOT 1 « reconnaissance magasin au scan » (shadow estFrancois) : catégorie du
  // magasin (1 tap, pré-sélection heuristique) + gestion de la zone grise
  // anti-doublon (candidat proche -> l'utilisateur tranche). magasinAmbigu porte
  // le candidat renvoyé par la RPC ; ambiguResolverRef débloque l'await une fois
  // le choix fait.
  const [categorieMagasin,  setCategorieMagasin]  = useState(null);
  const [magasinAmbigu,     setMagasinAmbigu]     = useState(null);
  // Chantier 93 Lot 7 — doublon de ticket détecté AVANT import : null ou
  // { date_ticket } du ticket existant. Tant que non nul, rien n'a été écrit.
  const [doublonTicket,     setDoublonTicket]     = useState(null);
  // Chantier 97 — magasin CORE obligatoire avant tout import. magasinCore est
  // LE gate : tant qu'il est nul, goToShare/confirm refusent, donc AUCUNE
  // écriture (ni Core, ni legacy price_db/community_prices/archive) n'est
  // possible. Le ref miroir évite les lectures d'état périmé dans les
  // enchaînements async (session, création de magasin).
  const [magasinCore,        setMagasinCoreState]  = useState(null);
  const magasinCoreRef = useRef(null);
  const definirMagasinCore = (m) => { magasinCoreRef.current = m; setMagasinCoreState(m); };
  // Sélecteur : { tous, habituels, proches, autres } ; null = pas encore chargé.
  const [magasinsCore,        setMagasinsCore]        = useState(null);
  const [magasinsCoreLoading, setMagasinsCoreLoading] = useState(false);
  const magasinsCoreLoadingRef = useRef(false);
  const [rechercheMagasin,    setRechercheMagasin]    = useState('');
  const [modeAjoutMagasin,    setModeAjoutMagasin]    = useState(false);
  const ambiguResolverRef = useRef(null);
  const fileInputRef    = useRef(null);
  const galleryInputRef = useRef(null);

  // Additif — #61bis : ouvre directement le sélecteur de galerie au montage,
  // sans changer le comportement par défaut (status reste "idle" comme sans
  // ce prop). Réutilise l'input existant (galleryInputRef), n'en recrée aucun.
  useEffect(() => {
    if (!autoOpenGallery) return;
    galleryInputRef.current?.click();
  }, []);

  useEffect(() => {
    // Chantier 79 — la reprise d'un brouillon prime sur un initialResult
    // (scan frais). Les deux ne s'appliquent jamais ensemble.
    if (resumeDraft || !initialResult) return;
    // Chantier 96 — même garde-fou que les scans directs : un résultat sans
    // produit exploitable n'enchaîne jamais vers l'import. Chantier 98 —
    // message honnête (l'OCR a déjà tourné en amont, ce n'est pas forcément
    // la photo).
    if (filtrerProduitsExploitables(initialResult?.products).length === 0) {
      setError(MESSAGES_SCAN.lecture_vide);
      return;
    }
    const enseigne = storeIdFromName(initialResult.store);
    const prods = initialResult.products.map((p, i) => ({ ...p, id: i, keep: true }));
    setResult(initialResult);
    setSelectedStore(enseigne);
    setEditableProducts(prods);
    if (magasinSession) {
      // Chantier 90 — magasin de la session confirmé : étape magasin sautée.
      arriverAvecMagasinSession(initialResult, prods);
      return;
    }
    setStoreNameEdit(initialResult.store || "");
    setStoreLocation(estFrancois ? "" : (initialResult.address || ""));
    arriverEtapeMagasin(enseigne, initialResult.address || null, initialResult.store || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!(scanning || galleryScanning)) return;
    const block = e => e.preventDefault();
    document.addEventListener('touchstart', block, { passive: false });
    document.addEventListener('touchmove',  block, { passive: false });
    return () => {
      document.removeEventListener('touchstart', block);
      document.removeEventListener('touchmove',  block);
    };
  }, [scanning, galleryScanning]);

  // Chantier 78 — après un scan, le CODE POSTAL du ticket PRIME sur le
  // "dernier magasin utilisé". `adresseTicket` est passé depuis le flux de
  // scan (address du ticket) ; le flux manuel (changement d'enseigne dans le
  // menu) l'appelle sans adresse -> comportement d'avant inchangé. Aucun
  // appel réseau : on extrait le CP par regex de l'adresse du ticket ET de
  // l'adresse (texte libre) de chaque magasin déjà chargé.
  const fetchKnownStores = async (enseigne, adresseTicket = null) => {
    if (!enseigne || enseigne === 'autre') { setKnownStores([]); return; }
    setKnownStoresLoading(true);
    setResolvedStoreId(null);
    setNewStoreSubMode(null);
    setManualAddress('');
    const { data } = await supabase.from('stores').select('*').eq('enseigne', enseigne);
    const stores = data || [];
    setKnownStores(stores);

    const extraireCP = (txt) => { const m = String(txt || '').match(/\b\d{5}\b/); return m ? m[0] : null; };
    const cpTicket = extraireCP(adresseTicket);
    const lastId = localStorage.getItem(`prixmalin_lastStore_${enseigne}`);
    const lastConnu = lastId && stores.some(s => s.id === lastId) ? lastId : null;

    let choisi = null;
    if (cpTicket) {
      // (a) Un magasin de l'enseigne correspond au CP du ticket -> il prime.
      const candidatsCP = stores.filter(s => extraireCP(s.address) === cpTicket);
      if (candidatsCP.length > 0) {
        // Entre doublons de MÊME CP, on garde le "dernier utilisé" s'il en
        // fait partie, sinon le premier.
        choisi = (lastConnu && candidatsCP.some(s => s.id === lastConnu)) ? lastConnu : candidatsCP[0].id;
      } else if (lastConnu) {
        // (b) Aucun magasin à ce CP : repli sur le dernier utilisé UNIQUEMENT
        // s'il ne CONTREDIT pas le CP du ticket (règle : jamais auto-choisir
        // un magasin dont le CP contredit le ticket).
        const cpLast = extraireCP(stores.find(s => s.id === lastConnu)?.address);
        if (!cpLast || cpLast === cpTicket) choisi = lastConnu;
      }
      // sinon : le dernier utilisé contredit le CP -> rien de sélectionné,
      // l'utilisateur choisit / crée le magasin.
    } else {
      // (c) Pas de CP exploitable dans le ticket -> comportement d'avant.
      choisi = lastConnu;
    }

    if (choisi) setResolvedStoreId(choisi);
    setKnownStoresLoading(false);
  };

  // ── Chantier 97 — sélecteur de magasin CORE ─────────────────────────────
  // Charge magasins actifs + fréquences d'usage (tickets & sessions) +
  // position (GPS seulement si permission déjà accordée, sinon zone
  // utilisateur du chantier 81, sinon rien). Jamais bloquant : toute panne
  // aboutit à des listes vides et l'utilisateur passe par la recherche ou
  // l'ajout. `suggestion` (nom OCR du ticket, ex. « Auchan ») pré-remplit la
  // recherche UNIQUEMENT si elle matche au moins un magasin.
  const chargerSelecteurMagasins = async (suggestion = null) => {
    if (magasinsCoreLoadingRef.current) return;
    magasinsCoreLoadingRef.current = true;
    setMagasinsCoreLoading(true);
    try {
      const [tous, frequences, positionGps] = await Promise.all([
        chargerMagasinsCoreActifs(),
        chargerFrequencesMagasins(),
        obtenirPositionAppareil({ timeoutMs: 2500 }),
      ]);
      const position = positionGps || lireZoneStockee()?.userPos || null;
      setMagasinsCore({ tous, ...classerMagasinsSelecteur({ magasins: tous, frequences, position }) });
      if (suggestion && filtrerMagasins(tous, suggestion).length > 0) {
        setRechercheMagasin(prev => prev || suggestion);
      }
    } catch (e) {
      console.error('[C97] chargement sélecteur magasins', e);
      setMagasinsCore({ tous: [], habituels: [], proches: [], autres: [] });
    }
    magasinsCoreLoadingRef.current = false;
    setMagasinsCoreLoading(false);
  };

  // Choix d'un magasin CORE existant : satisfait le gate, et ALIGNE le circuit
  // legacy sur le même magasin (nom/adresse affichés + store_id legacy via la
  // correspondance, best effort — null si aucune fiche legacy rattachée).
  const choisirMagasinCore = async (m) => {
    definirMagasinCore({ id: m.id, nom: m.nom, adresse: m.adresse || '', code_postal: m.code_postal || '', ville: m.ville || '' });
    setError('');
    setStoreNameEdit(m.nom || '');
    setStoreLocation(formaterAdresseMagasin(m));
    const slugLegacy = storeIdFromName(m.enseignes?.nom || m.nom);
    if (slugLegacy) setSelectedStore(slugLegacy);
    const legacyId = await trouverStoreLegacyPourMagasin(m.id);
    setResolvedStoreId(legacyId);
  };

  // Arrivée à l'étape magasin (tous les points d'entrée du scan) : le
  // sélecteur Core se charge en parallèle, la résolution legacy silencieuse
  // (fetchKnownStores) continue pour la cohérence du circuit legacy.
  const arriverEtapeMagasin = async (enseigne, adresse, nomOcr = null) => {
    setStatus("store"); // l'étape s'affiche tout de suite, chaque chargement a son propre état
    chargerSelecteurMagasins(nomOcr);
    await fetchKnownStores(enseigne, adresse || null);
  };

  // LOT 1 « reconnaissance magasin au scan » — heuristique de catégorie :
  // les enseignes/format de proximité -> 'proximite', sinon 'grande_surface'.
  // Sert de PRÉ-sélection (l'utilisateur peut changer d'un tap).
  const devinerCategorieMagasin = (nom) => {
    const t = (nom || '').toLowerCase();
    return /express|city|contact|proximit|market|vival|utile|spar|franprix/.test(t)
      ? 'proximite' : 'grande_surface';
  };

  // LOT 1 — appel de la RPC Core. Renvoie l'objet {statut, magasin_id?, candidat?}.
  // Fire-and-forget côté erreur technique : on n'interrompt jamais le flux legacy.
  const appelerCreationMagasinCore = async (legacyId, enseigne, adresse, lat, lng, nom, extra = {}) => {
    const cp = (adresse && adresse.match(/\b\d{5}\b/)) ? adresse.match(/\b\d{5}\b/)[0] : null;
    let ville = null;
    if (cp) {
      const apres = (adresse.split(cp)[1] || '').replace(/^[,\s]+/, '').trim();
      ville = apres && apres.toLowerCase() !== 'france' ? apres.replace(/,?\s*france$/i, '').trim() : null;
    }
    try {
      const { data, error } = await supabase.rpc('resoudre_ou_creer_magasin_core', {
        p_store_legacy_id: legacyId,
        p_nom:             nom || null,
        p_adresse:         adresse || null,
        p_code_postal:     cp,
        p_ville:           ville,
        p_latitude:        lat ?? null,
        p_longitude:       lng ?? null,
        p_enseigne_slug:   enseigne || null,
        p_categorie:       categorieMagasin || devinerCategorieMagasin(nom),
        p_forcer_creation: extra.forcerCreation ?? false,
        p_rattacher_magasin_id: extra.rattacherMagasinId ?? null,
      });
      if (error) { console.error('[LOT1] resoudre_ou_creer_magasin_core', error); return null; }
      return data ?? null;
    } catch (e) { console.error('[LOT1] resoudre_ou_creer_magasin_core (exception)', e); return null; }
  };

  // Zone grise anti-doublon : suspend jusqu'au choix utilisateur dans la modale.
  const demanderChoixMagasinAmbigu = (candidat) =>
    new Promise((resolve) => { ambiguResolverRef.current = resolve; setMagasinAmbigu(candidat); });

  // #54 — évite de créer une fiche `stores` dupliquée : réutilise une fiche
  // existante de la même enseigne (déjà chargée dans knownStores) si son
  // adresse correspond, une fois normalisée (casse/accents/espaces via
  // normName, déjà utilisé ailleurs dans ce fichier pour ce genre de
  // comparaison). Sinon, comportement inchangé : insertStoreInDB crée la
  // fiche.
  //
  // LOT 1, ouvert à tous par le Chantier 97 : une fois la fiche legacy
  // obtenue, on crée AUSSI la fiche Core (magasins + correspondance) via la
  // RPC — son magasin_id est désormais REQUIS par le gate magasin. La zone
  // grise (candidat proche mais incertain) est tranchée par l'utilisateur.
  // Renvoie { legacyId, magasinCoreId, magasinCoreNom } ; magasinCoreId null
  // = échec côté Core (le gate reste fermé, l'utilisateur réessaie ou choisit
  // dans la liste).
  const resoudreOuCreerStore = async (enseigne, adresse, lat, lng, nom) => {
    const existant = knownStores.find(s => s.address && normName(s.address) === normName(adresse));
    const legacyId = existant ? existant.id : await insertStoreInDB(enseigne, adresse, lat, lng, nom);
    if (!legacyId) return { legacyId: null, magasinCoreId: null, magasinCoreNom: null };

    let magasinCoreNom = null;
    let res = await appelerCreationMagasinCore(legacyId, enseigne, adresse, lat, lng, nom);
    if (res && res.statut === 'ambigu' && res.candidat) {
      const choix = await demanderChoixMagasinAmbigu(res.candidat);
      if (choix === 'rattacher') magasinCoreNom = res.candidat.nom || null;
      res = await appelerCreationMagasinCore(legacyId, enseigne, adresse, lat, lng, nom,
        choix === 'rattacher'
          ? { rattacherMagasinId: res.candidat.magasin_id }
          : { forcerCreation: true });
    }
    return { legacyId, magasinCoreId: res?.magasin_id ?? null, magasinCoreNom };
  };

  const EXAMPLE = `{
  "store": "Intermarché",
  "date": "2026-04-11",
  "products": [
    { "brand": "Florette", "name": "Mâche", "format": "125g", "price": 1.82 },
    { "brand": "Maille",   "name": "Vinaigre Cidre", "format": "50cl", "price": 2.42 },
    { "brand": "Alter Eco","name": "Café Mexique", "format": "260g", "price": 5.78 },
    { "brand": "Look",     "name": "Cola Zéro", "format": "1L", "price": 0.49 }
  ]
}`;

  const parseAndPreview = async (text) => {
    try {
      const clean=(text||"").replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(clean);
      if(!parsed.products||!Array.isArray(parsed.products)) throw new Error("Champ 'products' manquant");
      const enseigne = storeIdFromName(parsed.store);
      setResult(parsed);
      setSelectedStore(enseigne);
      setEditableProducts(parsed.products.map((p,i)=>({...p,id:i,keep:true,share:true})));
      setStoreNameEdit(parsed.store||"");
      setStoreLocation(estFrancois ? "" : (parsed.address||""));
      setError("");
      await arriverEtapeMagasin(enseigne, parsed.address || null, parsed.store || null);
    } catch(e) { setError("JSON invalide : "+e.message); }
  };

  const [shareChecked, setShareChecked] = useState(new Set());
  const [editingId,    setEditingId]    = useState(null);
  const [editDraft,    setEditDraft]    = useState({});

  // ── Chantier 79 — brouillon reprenable ──────────────────────────────────
  // draftCreatedAt : date de début du brouillon, stable entre sauvegardes.
  // draftRef : dernier brouillon calculé, pour le flush sur éviction (les
  // listeners captureraient sinon un state figé).
  const draftCreatedAt = useRef(resumeDraft?.createdAt || null);
  const draftRef = useRef(null);

  // Réhydratation d'un brouillon repris : on replace TOUT l'état + l'étape.
  // Ne re-fetch pas knownStores (resolvedStoreId sauvegardé suffit au confirm).
  useEffect(() => {
    if (!resumeDraft) return;
    setResult(resumeDraft.result || null);
    setEditableProducts(Array.isArray(resumeDraft.editableProducts) ? resumeDraft.editableProducts : []);
    setSelectedStore(resumeDraft.selectedStore || "");
    setResolvedStoreId(resumeDraft.resolvedStoreId || null);
    setStoreNameEdit(resumeDraft.storeNameEdit || "");
    setStoreLocation(resumeDraft.storeLocation || "");
    setShareChecked(new Set(Array.isArray(resumeDraft.shareChecked) ? resumeDraft.shareChecked : []));
    // Chantier 97 — le magasin CORE fait partie du brouillon. Un vieux
    // brouillon sans magasinCore (d'avant le chantier) ne peut PAS reprendre
    // en share : retour à l'étape magasin, le gate reste étanche.
    definirMagasinCore(resumeDraft.magasinCore?.id ? resumeDraft.magasinCore : null);
    const statutRepris = resumeDraft.status === 'share' && resumeDraft.magasinCore?.id ? 'share' : 'store';
    if (statutRepris === 'store') chargerSelecteurMagasins();
    setStatus(statutRepris);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sauvegarde du brouillon à chaque changement significatif, UNIQUEMENT
  // pendant les étapes de validation (result présent + étape store/share).
  useEffect(() => {
    if (!result || (status !== 'store' && status !== 'share')) { draftRef.current = null; return; }
    if (!draftCreatedAt.current) draftCreatedAt.current = new Date().toISOString();
    const draft = {
      v: 1,
      createdAt: draftCreatedAt.current,
      updatedAt: new Date().toISOString(),
      result, editableProducts, selectedStore, resolvedStoreId,
      storeNameEdit, storeLocation, status,
      shareChecked: Array.from(shareChecked),
      magasinCore, // Chantier 97 — le magasin CORE validé voyage avec le brouillon
    };
    draftRef.current = draft;
    ecrireScanDraft(draft);
  }, [result, editableProducts, selectedStore, resolvedStoreId, storeNameEdit, storeLocation, status, shareChecked, magasinCore]);

  // Flush fiable juste avant que iOS évince/recharge la page : on re-écrit le
  // dernier brouillon connu sur passage en arrière-plan (visibilitychange
  // document.hidden) et sur pagehide.
  useEffect(() => {
    const flush = () => { if (draftRef.current) ecrireScanDraft({ ...draftRef.current, updatedAt: new Date().toISOString() }); };
    const onVisibility = () => { if (document.hidden) flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  const loadExample = () => { setJsonText(EXAMPLE); parseAndPreview(EXAMPLE); };
  const toggleProduct = id => setEditableProducts(prev=>prev.map(p=>p.id===id?{...p,keep:!p.keep}:p));
  // Chantier 99 — libellé affichable d'un produit lu : "name" OU, à défaut,
  // "libelle_ticket" brut. Le prompt anti-faux-rattachement laisse
  // volontairement name vide (confiance "faible") quand rien ne matche le
  // catalogue : ces produits restent exploitables/affichables/éditables, on
  // ne force JAMAIS un name.
  const libelleProduit = (p) => (p?.name?.trim() || p?.libelle_ticket?.trim() || "");
  const updatePrice = (id,val) => setEditableProducts(prev=>prev.map(p=>p.id===id?{...p,price:parseFloat(val)||0}:p));

  const confirm = async (idsToShare) => {
    if (saving) return;
    // Chantier 97 — ceinture et bretelles du gate magasin : même si un état
    // inattendu (vieux brouillon, enchaînement imprévu) a mené jusqu'ici sans
    // magasin CORE, RIEN n'est écrit — ni Core, ni legacy. Retour à l'étape
    // magasin avec message clair.
    if (!magasinCoreRef.current?.id) {
      setError("Choisis d'abord le magasin de ce ticket");
      if (!magasinsCore && !magasinsCoreLoadingRef.current) chargerSelecteurMagasins();
      setStatus("store");
      return;
    }
    setSaving(true);
    if (resolvedStoreId && selectedStore && selectedStore !== 'autre') {
      localStorage.setItem(`prixmalin_lastStore_${selectedStore}`, resolvedStoreId);
    }
    // Chantier 99 — exploitable = libellé (name OU libelle_ticket) + prix > 0.
    const toImport=editableProducts.filter(p=>p.keep&&(p.name||p.libelle_ticket)&&p.price>0).map(p=>({
      id:           Date.now()+p.id,
      brand:        p.brand||"",
      product:      p.name || p.libelle_ticket || "",
      libelle_ticket: p.libelle_ticket||null,
      format:       p.format||"",
      // A.1 — transportés depuis le scan (voyagent mais NON écrits en base : ce
      // sera A.2). confiance sert au badge « à vérifier » ; quantite_nette /
      // unite_quantite / nombre_unites au format affiché.
      confiance:      p.confiance||null,
      quantite_nette: p.quantite_nette ?? null,
      unite_quantite: p.unite_quantite ?? null,
      nombre_unites:  p.nombre_unites ?? null,
      qty:          p.qty||1,
      storeId:      selectedStore||"autre",
      store_name:   storeNameEdit.trim() || result?.store || "",
      store_address:storeLocation.trim(),
      store_id:     resolvedStoreId,
      price:        p.price,
      date:         result?.date?new Date(result.date).toISOString():new Date().toISOString(),
      share:        idsToShare.has(p.id),
    }));
    // Chantier 96 — ceinture ET bretelles : si, malgré le garde-fou d'arrivée,
    // il n'y a AUCUN produit exploitable au moment de confirmer (liste vidée
    // par édition, état inattendu…), on n'importe RIEN : ni écriture Core, ni
    // legacy, ni archive marquée — c'est ce trou qui produisait un « ticket
    // scanné » fantôme. Retour à la prise de photo avec un message clair ;
    // le brouillon de scan reste intact.
    if (toImport.length === 0) {
      setSaving(false);
      setError("Aucun produit exploitable sur ce ticket — rien n'a été importé. Reprends la photo.");
      setStatus(directCamera ? "camera" : "idle");
      return;
    }
    // Chantier 93 Lot 7 — anti-doublon AVANT toute écriture : empreinte
    // déterministe du ticket revu à l'écran (magasin, date, total, nb de
    // lignes, libellés bruts normalisés triés). Si un ticket du compte porte
    // déjà cette empreinte -> AUCUNE écriture (ni Core, ni legacy price_db,
    // ni community_prices, ni archive, ni rattachement de session) et message
    // bloquant. Vérification impossible (réseau) -> on laisse passer, jamais
    // de blocage abusif : l'index unique reste le filet.
    const empreinte = calculerEmpreinteTicket({
      magasinId:  resolvedStoreId || null,
      magasinNom: storeNameEdit.trim() || result?.store || null,
      dateTicket: result?.date || null,
      lignes: toImport.map(p => ({ libelle: p.libelle_ticket || p.product, prix: p.price, quantite: p.qty })),
    });
    const verifDoublon = await chercherTicketParEmpreinte(empreinte);
    if (verifDoublon?.existe) {
      setSaving(false);
      setDoublonTicket({ date_ticket: verifDoublon.ticket?.date_ticket ?? null });
      return;
    }

    // #56.5.A — double écriture Core, un seul appel. #56.6 : la promesse est
    // transmise à onImport (au lieu d'être ignorée via void) pour permettre
    // un realized_saving Core scopé à ce ticket quand core_actif=true — mais
    // confirm() ne l'attend jamais lui-même, le flux legacy reste inchangé.
    // Chantier 97 — le magasin CORE validé part dans le payload sous la clé
    // magasin_id (contrat : la base le lira en priorité) ; magasin_texte
    // devient le nom exact de la fiche Core (résolution par texte exact OK
    // même avant la mise à jour SQL) et store_legacy_id reste le filet.
    const ecritureCorePromise = envoyerTicketCore(toImport, {
      magasinId:     magasinCoreRef.current?.id || null,
      storeLegacyId: resolvedStoreId || null,
      magasinTexte:  magasinCoreRef.current?.nom || storeNameEdit.trim() || result?.store || null,
      dateTicket:    result?.date || null,
    });
    // Chantier 93 — pose de l'empreinte sur le ticket créé (fire & forget,
    // filets internes) ; une course entre deux scans simultanés (23505) est
    // signalée comme doublon via onDoublonTardif, jamais un plantage.
    poserEmpreinteApresImport(ecritureCorePromise, empreinte, { onDoublonTardif: onDoublonTardif ?? undefined });
    // Chantier 94 Lot 10 — notification légère de Points Malin après import
    // (uniquement quand la gamification est visible : onPointsCredites câblé).
    // Fire & forget avec filets : jamais bloquant pour le flux d'import.
    if (onPointsCredites) {
      sommerPointsDernierTicket(ecritureCorePromise).then(r => {
        if (!r?.credite || r.total === 0) return; // pas de ticket ou rien à annoncer
        onPointsCredites(r.total != null
          ? `✨ +${r.total} Points Malin (en attente de validation)`
          : "✨ Contributions enregistrées — points en attente de validation");
      }).catch(() => { /* jamais bloquant */ });
    }
    onImport(toImport, ecritureCorePromise);
    // Chantier 79 — écriture en base lancée : le brouillon n'a plus lieu
    // d'être. On l'efface AVANT onClose (jamais sur un simple ✕/onClose).
    draftRef.current = null;
    draftCreatedAt.current = null;
    effacerScanDraft();
    onClose();
  };

  const goToShare = (products) => {
    // Chantier 97 — GATE MAGASIN : aucun passage à la validation/partage des
    // articles sans magasin CORE validé. Comme confirm() n'est atteignable
    // que depuis l'étape share, ce verrou bloque LES DEUX circuits (Core ET
    // legacy price_db/community_prices/archive). Lecture via le ref pour ne
    // jamais rater une sélection posée dans le même tick (session, création).
    if (!magasinCoreRef.current?.id) {
      setError("Choisis d'abord le magasin de ce ticket");
      if (!magasinsCore && !magasinsCoreLoadingRef.current) chargerSelecteurMagasins();
      setStatus("store");
      return;
    }
    const list = products || editableProducts;
    const ids = new Set(list.filter(p => p.keep && (p.name || p.libelle_ticket) && p.price > 0).map(p => p.id));
    setShareChecked(ids);
    setStatus("share");
  };

  // Chantier 90 Lot 4 — scan lancé depuis la session de courses avec magasin
  // confirmé (« Ticket effectué chez X ? » -> Oui) : le magasin est déjà
  // connu, on ne le redemande pas. Champs pré-remplis depuis la session,
  // résolution de la fiche legacy par la mécanique EXISTANTE (fetchKnownStores,
  // priorité au code postal), puis passage direct au choix des produits —
  // l'étape « store » est sautée. Repli sur les valeurs du ticket scanné pour
  // tout champ manquant ; une résolution ratée laisse resolvedStoreId null et
  // le confirm() suit son chemin normal (magasin_texte). Jamais bloquant.
  const arriverAvecMagasinSession = async (parsed, prods) => {
    const nom = (magasinSession?.nom || parsed?.store || "").trim();
    const enseigne = storeIdFromName(magasinSession?.enseigne || nom || parsed?.store);
    const adresse = [magasinSession?.adresse, [magasinSession?.code_postal, magasinSession?.ville].filter(Boolean).join(" ")]
      .filter(Boolean).join(", ") || (parsed?.address || "");
    setSelectedStore(enseigne);
    setStoreNameEdit(nom);
    setStoreLocation(adresse);
    // Chantier 97 — le magasin CORE de la session satisfait directement le
    // gate (c'est déjà un magasin validé par l'utilisateur à l'ouverture de
    // la session). Sans magasin_id Core en session (cas limite), pas de
    // passe-droit : l'étape magasin s'affiche avec le sélecteur.
    if (magasinSession?.magasin_id) {
      definirMagasinCore({
        id: magasinSession.magasin_id,
        nom: nom || 'Magasin',
        adresse: magasinSession?.adresse || '',
        code_postal: magasinSession?.code_postal || '',
        ville: magasinSession?.ville || '',
      });
      await fetchKnownStores(enseigne, adresse || null);
      goToShare(prods);
    } else {
      await arriverEtapeMagasin(enseigne, adresse, nom || parsed?.store || null);
    }
  };

  const repondreAmbigu = (choix) => {
    const resolve = ambiguResolverRef.current;
    ambiguResolverRef.current = null;
    setMagasinAmbigu(null);
    resolve?.(choix);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={(status==="idle"||status==="camera")?onClose:undefined}>
      {/* LOT 1 (shadow estFrancois) — zone grise anti-doublon : un magasin proche
          existe déjà, mais sans certitude. L'utilisateur tranche. */}
      {/* Chantier 93 Lot 7 — doublon détecté AVANT import : rien n'a été
          écrit (ni Core, ni legacy, ni archive, ni session). Fermer garde le
          brouillon de scan intact (seul confirm() l'efface). */}
      {doublonTicket && (
        <div onClick={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, padding:20 }}>
          <div style={{ background:C.white, borderRadius:18, padding:"22px 20px", maxWidth:360, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.text, marginBottom:8 }}>🧾 Ce ticket a déjà été scanné</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, marginBottom:16 }}>
              Un ticket identique (même magasin, même total, mêmes produits{doublonTicket.date_ticket ? `, daté du ${new Date(doublonTicket.date_ticket).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : ""}) est déjà enregistré. Rien n'a été réimporté — aucun prix ni ticket en double.
            </div>
            {onVoirTicketExistant && (
              <button onClick={()=>{ setDoublonTicket(null); onClose(); onVoirTicketExistant(); }}
                style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:"#4A90D9", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                📂 Voir le ticket existant (Historique)
              </button>
            )}
            <button onClick={()=>{ setDoublonTicket(null); onClose(); }}
              style={{ width:"100%", padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#333", cursor:"pointer" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {magasinAmbigu && (
        <div onClick={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, padding:20 }}>
          <div style={{ background:C.white, borderRadius:18, padding:"22px 20px", maxWidth:360, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.text, marginBottom:8 }}>Ce magasin existe peut-être déjà</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, marginBottom:6 }}>Un magasin proche est déjà connu :</div>
            <div style={{ background:C.grayLight, borderRadius:10, padding:"10px 12px", marginBottom:16 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{magasinAmbigu.nom}</div>
              {magasinAmbigu.adresse && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginTop:2 }}>{magasinAmbigu.adresse}</div>}
            </div>
            <button onClick={()=>repondreAmbigu('rattacher')}
              style={{ width:"100%", padding:"14px", border:"none", borderRadius:12, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.white, cursor:"pointer", marginBottom:10 }}>
              C'est ce magasin
            </button>
            <button onClick={()=>repondreAmbigu('nouveau')}
              style={{ width:"100%", padding:"13px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, cursor:"pointer" }}>
              Non, en créer un nouveau
            </button>
          </div>
        </div>
      )}
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"92vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease", overflow:"hidden" }}>
        <div style={{ background:C.orange, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:C.white }}>🧾 Importer un ticket</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:"rgba(255,255,255,0.75)" }}>📷 Scanne ton ticket → import automatique</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:28, height:28, color:C.white, fontSize:14, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ overflowY:"auto", flex:1, padding:"20px 20px 44px" }}>
          {status==="idle" && (
            <>
              <div style={{ background:C.blueLight, borderRadius:14, padding:"16px", marginBottom:16 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.blue, marginBottom:10 }}>Comment ça marche :</div>
                {[
                  {n:"1",t:"📷 Scanne un ticket photo"},
                  {n:"2",t:"🤖 L'IA lit le ticket et extrait produits, prix et magasin"},
                  {n:"3",t:"✅ Vérifié et prix importés !"},
                ].map(s=>(
                  <div key={s.n} style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:8 }}>
                    <div style={{ width:24, height:24, borderRadius:99, background:C.orange, color:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{s.n}</div>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, lineHeight:1.5 }}>{s.t}</div>
                  </div>
                ))}
              </div>
<input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={async (e) => {
                const file = e.target.files[0];
                if(!file) return;
                setScanning(true); setError("");
                try {
                  const base64 = await imageFileToJpegBase64(file);
                  // Chantier 96 (garde-fou 0 produit) + Chantier 98 : lecture
                  // fiabilisée (1 réessai auto) et message HONNÊTE — un échec
                  // du service de lecture n'accuse plus la photo.
                  const scan = await scanTicketRobuste(base64, refProducts);
                  if (scan.statut !== 'ok') {
                    setError(MESSAGES_SCAN[scan.statut] || MESSAGES_SCAN.service_indisponible);
                    setScanning(false);
                    return;
                  }
                  const parsed = scan.resultat;
                  const enseigne = storeIdFromName(parsed.store);
                  const prods = parsed.products.map((p,i) => ({...p, id:i, keep:true}));
                  setResult(parsed); setSelectedStore(enseigne);
                  setEditableProducts(prods);
                  if (magasinSession) {
                    // Chantier 90 — magasin de la session confirmé : étape magasin sautée.
                    await arriverAvecMagasinSession(parsed, prods);
                  } else {
                    setStoreNameEdit(parsed.store||"");
                    setStoreLocation(estFrancois ? "" : (parsed.address||""));
                    await arriverEtapeMagasin(enseigne, parsed.address || null, parsed.store || null);
                  }
                } catch(e) { setError("Erreur scan : " + e.message); }
                setScanning(false);
              }} style={{ display:"none" }} />

              {/* Galerie */}
              <input ref={galleryInputRef} type="file" accept="image/*" onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                setGalleryScanning(true); setError("");
                try {
                  const base64 = await imageFileToJpegBase64(file);
                  // Chantier 96 + 98 — même garde-fou et même lecture fiabilisée
                  // que la caméra : réessai auto, message honnête.
                  const scan = await scanTicketRobuste(base64, refProducts);
                  if (scan.statut !== 'ok') {
                    setError(MESSAGES_SCAN[scan.statut] || MESSAGES_SCAN.service_indisponible);
                    setGalleryScanning(false);
                    e.target.value = "";
                    return;
                  }
                  const parsed = scan.resultat;
                  const enseigne = storeIdFromName(parsed.store);
                  const prods = parsed.products.map((p,i) => ({...p, id:i, keep:true, share:true}));
                  setResult(parsed); setSelectedStore(enseigne);
                  setEditableProducts(prods);
                  if (magasinSession) {
                    // Chantier 90 — magasin de la session confirmé : étape magasin sautée.
                    await arriverAvecMagasinSession(parsed, prods);
                  } else {
                    setStoreNameEdit(parsed.store || "");
                    setStoreLocation(estFrancois ? "" : (parsed.address || ""));
                    await arriverEtapeMagasin(enseigne, parsed.address || null, parsed.store || null);
                  }
                } catch(e) { setError("Erreur scan : " + e.message); }
                setGalleryScanning(false);
                e.target.value = "";
              }} style={{ display:"none" }} />
              <button onClick={()=>galleryInputRef.current?.click()} disabled={scanning||galleryScanning}
                style={{ width:"100%", padding:"15px", marginTop:10, border:"none", borderRadius:12, background:galleryScanning?"#999":"#4A90D9", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"white", cursor:galleryScanning?"default":"pointer" }}>
                {galleryScanning ? "⏳ Analyse en cours..." : "🖼️ Importer une photo"}
              </button>
              <button onClick={()=>{ onClose(); onManualEntry?.(); }} disabled={scanning||galleryScanning}
                style={{ width:"100%", padding:"15px", marginTop:10, border:"none", borderRadius:12, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                ✏️ Saisie manuelle
              </button>

            </>
          )}

          {status==="camera" && (
            <>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={async (e) => {
                const file = e.target.files[0];
                if(!file) return;
                setScanning(true); setError("");
                try {
                  const base64 = await imageFileToJpegBase64(file);
                  // Chantier 96 + 98 — même garde-fou et même lecture fiabilisée
                  // que ci-dessus : réessai auto, message honnête.
                  const scan = await scanTicketRobuste(base64, refProducts);
                  if (scan.statut !== 'ok') {
                    setError(MESSAGES_SCAN[scan.statut] || MESSAGES_SCAN.service_indisponible);
                    setScanning(false);
                    return;
                  }
                  const parsed = scan.resultat;
                  const enseigne = storeIdFromName(parsed.store);
                  const prods = parsed.products.map((p,i) => ({...p, id:i, keep:true}));
                  setResult(parsed); setSelectedStore(enseigne);
                  setEditableProducts(prods);
                  if (magasinSession) {
                    // Chantier 90 — magasin de la session confirmé : étape magasin sautée.
                    await arriverAvecMagasinSession(parsed, prods);
                  } else {
                    setStoreNameEdit(parsed.store||"");
                    setStoreLocation(estFrancois ? "" : (parsed.address||""));
                    await arriverEtapeMagasin(enseigne, parsed.address || null, parsed.store || null);
                  }
                } catch(e) { setError("Erreur scan : " + e.message); }
                setScanning(false);
              }} style={{ display:"none" }} />
              {error && <div style={{ background:"#FEE", borderRadius:10, padding:"10px 14px", marginBottom:16, fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red, fontWeight:700 }}>⚠️ {error}</div>}
              <button onClick={()=>fileInputRef.current?.click()} disabled={scanning} style={{ width:"100%", padding:"28px 20px", border:"none", borderRadius:16, background:scanning?"#999":"#00B341", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:"white", cursor:scanning?"default":"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:48 }}>📷</span>
                {scanning ? "⏳ Analyse en cours..." : "Ouvrir la caméra"}
              </button>
              {/* Chantier 98 — repli quand la lecture échoue : ne jamais bloquer,
                  la saisie manuelle reste toujours possible. */}
              {error && onManualEntry && (
                <button onClick={()=>{ onClose(); onManualEntry(); }} disabled={scanning}
                  style={{ width:"100%", padding:"14px", marginTop:12, border:"none", borderRadius:12, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.white, cursor:"pointer" }}>
                  ✏️ Saisie manuelle
                </button>
              )}
              <button onClick={()=>setStatus("idle")} style={{ width:"100%", padding:"14px", marginTop:12, border:"none", borderRadius:12, background:"#4A90D9", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.white, cursor:"pointer" }}>
                Autres options
              </button>
            </>
          )}

          {status==="store" && result && (
            <>
              {/* Banner produits */}
              <div style={{ background:C.blueLight, borderRadius:12, padding:"12px 16px", marginBottom:16 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:C.blue, marginBottom:4 }}>
                  ✅ {editableProducts.length} produit{editableProducts.length>1?"s":""} détecté{editableProducts.length>1?"s":""}
                </div>
                {result.date && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>📅 {new Date(result.date).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}</div>}
              </div>

              {/* Chantier 97 — étape magasin refondue : le magasin CORE est
                  obligatoire (gate des DEUX circuits d'écriture). Trois vues :
                  magasin validé -> carte de confirmation ; sinon sélecteur
                  intelligent (habituels / proximité / recherche) ; sinon
                  formulaire d'ajout (ex-formulaire unifié). */}
              {magasinCore ? (
                /* ── Magasin CORE validé ── */
                <>
                  <div style={{ background:"#F0FFF5", borderRadius:14, padding:"16px", marginBottom:20, border:`1.5px solid ${C.green}` }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.green, marginBottom:4 }}>
                      ✅ {magasinCore.nom}
                    </div>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>
                      {formaterAdresseMagasin(magasinCore) || "Adresse non renseignée"}
                    </div>
                    <button onClick={()=>{ definirMagasinCore(null); setResolvedStoreId(null); setShowManualAddress(false); setSavedGpsCoords(null); setError(""); if (!magasinsCore && !magasinsCoreLoadingRef.current) chargerSelecteurMagasins(); }}
                      style={{ marginTop:8, background:"none", border:"none", fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.blue, fontWeight:800, cursor:"pointer", padding:0, textDecoration:"underline" }}>
                      Changer de magasin
                    </button>
                  </div>
                  <button onClick={()=>goToShare()} style={{ width:"100%", padding:"16px", border:"none", borderRadius:12, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.white, cursor:"pointer", marginBottom:10, boxShadow:"0 6px 20px rgba(204,0,0,0.35)" }}>
                    Continuer →
                  </button>
                  <button onClick={()=>setStatus("idle")} style={{ width:"100%", padding:"13px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
                    ← Retour
                  </button>
                </>

              ) : !modeAjoutMagasin ? (
                /* ── Sélecteur intelligent de magasins CORE ── */
                <>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.text, marginBottom:10 }}>
                    🏪 Dans quel magasin as-tu fait ce ticket ?
                  </div>
                  {error && <div style={{ background:"#FEE", borderRadius:10, padding:"10px 14px", marginBottom:12, fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red, fontWeight:700 }}>⚠️ {error}</div>}
                  <div style={{ position:"relative", marginBottom:14 }}>
                    <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:16, pointerEvents:"none" }}>🔍</span>
                    <input value={rechercheMagasin} onChange={e=>setRechercheMagasin(e.target.value)}
                      placeholder="Enseigne, ville ou code postal..."
                      style={{ width:"100%", padding:"11px 14px 11px 38px", borderRadius:10, border:`2px solid ${rechercheMagasin.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.text, outline:"none", boxSizing:"border-box" }} />
                  </div>
                  {(magasinsCoreLoading || !magasinsCore) ? (
                    <div style={{ textAlign:"center", padding:"24px 0", fontFamily:"'Nunito',sans-serif", fontSize:14, color:C.textLight }}>⏳ Chargement des magasins...</div>
                  ) : (()=>{
                    const q = rechercheMagasin.trim();
                    const titreSection = (t) => (
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", margin:"12px 0 6px" }}>{t}</div>
                    );
                    const boutonMagasin = (m, badge=null) => (
                      <button key={m.id} onClick={()=>choisirMagasinCore(m)}
                        style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`2px solid ${C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", cursor:"pointer", textAlign:"left", boxSizing:"border-box" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontWeight:800, fontSize:14, color:C.text, flex:1 }}>{m.nom}</span>
                          {badge && <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.blue, flexShrink:0 }}>{badge}</span>}
                        </div>
                        {formaterAdresseMagasin(m) && <div style={{ fontSize:11, fontWeight:600, color:C.textLight, marginTop:2 }}>{formaterAdresseMagasin(m)}</div>}
                      </button>
                    );
                    if (q) {
                      const resultats = filtrerMagasins(magasinsCore.tous, q).slice(0, 30);
                      return resultats.length > 0 ? (
                        <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:280, overflowY:"auto" }}>{resultats.map(m=>boutonMagasin(m))}</div>
                      ) : (
                        <div style={{ textAlign:"center", padding:"14px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>Aucun magasin trouvé pour « {q} » — ajoute-le ci-dessous.</div>
                      );
                    }
                    return (
                      <>
                        {magasinsCore.habituels.length > 0 && <>
                          {titreSection("⭐ Tes magasins habituels")}
                          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>{magasinsCore.habituels.map(m=>boutonMagasin(m))}</div>
                        </>}
                        {magasinsCore.proches.length > 0 && <>
                          {titreSection("📍 À proximité")}
                          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>{magasinsCore.proches.map(m=>boutonMagasin(m, m.distance_km != null ? formaterDistance(m.distance_km) : null))}</div>
                        </>}
                        {magasinsCore.autres.length > 0 && <>
                          {titreSection("Tous les magasins")}
                          <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:220, overflowY:"auto" }}>{magasinsCore.autres.map(m=>boutonMagasin(m))}</div>
                        </>}
                        {magasinsCore.tous.length === 0 && (
                          <div style={{ textAlign:"center", padding:"14px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>Aucun magasin enregistré pour l'instant — ajoute le tien ci-dessous.</div>
                        )}
                      </>
                    );
                  })()}
                  <button onClick={()=>{ setModeAjoutMagasin(true); setError(""); if (!storeNameEdit.trim() && result?.store) setStoreNameEdit(result.store); }}
                    style={{ width:"100%", padding:"13px", marginTop:14, border:`2px dashed ${C.blue}`, borderRadius:12, background:C.blueLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.blue, cursor:"pointer" }}>
                    ➕ Ajouter un magasin
                  </button>
                  <button onClick={()=>setStatus("idle")} style={{ width:"100%", padding:"13px", marginTop:8, border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
                    ← Retour
                  </button>
                </>

              ) : (
                /* ── Ajout d'un magasin (ex-formulaire unifié) ── */
                <>
                  {/* Nom du magasin */}
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Nom du magasin</div>
                  {(()=>{
                    const suggestions = storeNameEdit.trim().length >= 2
                      ? STORES.filter(s => s.id !== 'autre' && s.name.toLowerCase().includes(storeNameEdit.trim().toLowerCase()))
                      : [];
                    return (
                      <div style={{ position:"relative" }}>
                        <input value={storeNameEdit} onChange={e=>setStoreNameEdit(e.target.value)}
                          onFocus={()=>setShowSuggestions(true)}
                          onBlur={()=>setTimeout(()=>setShowSuggestions(false), 150)}
                          placeholder="Ex : Intermarché Sanary, Lidl..."
                          style={{ width:"100%", padding:"13px 14px", borderRadius:12, border:`2px solid ${storeNameEdit.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:15, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:14 }} />
                        {showSuggestions && suggestions.length > 0 && (
                          <div style={{ position:"absolute", zIndex:50, background:C.white, borderRadius:12, border:`1px solid ${C.grayLight}`, boxShadow:"0 4px 16px rgba(0,0,0,0.1)", width:"100%", marginTop:-10 }}>
                            {suggestions.map(s => (
                              <div key={s.id} onMouseDown={()=>{ setStoreNameEdit(s.name); setShowSuggestions(false); fetchKnownStores(s.id); }}
                                style={{ padding:"12px 14px", display:"flex", gap:10, alignItems:"center", cursor:"pointer" }}>
                                <span style={{ fontSize:18 }}>{s.logo}</span>
                                <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{s.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Enseigne */}
                  {(()=>{
                    const ENSEIGNES_LIST = [
                      { id:"lidl",        name:"Lidl"          },
                      { id:"leclerc",     name:"E.Leclerc"     },
                      { id:"intermarche", name:"Intermarché"   },
                      { id:"netto",       name:"Netto"         },
                      { id:"carrefour",   name:"Carrefour"     },
                      { id:"franprix",    name:"Franprix"      },
                      { id:"aldi",        name:"Aldi"          },
                      { id:"superu",      name:"Super U"       },
                      { id:"hyperu",      name:"Hyper U"       },
                      { id:"uexpress",    name:"U Express"     },
                      { id:"utile",       name:"Utile"         },
                      { id:"vival",       name:"Vival"         },
                      { id:"spar",        name:"Spar"          },
                      { id:"monoprix",    name:"Monoprix"      },
                      { id:"picard",      name:"Picard"        },
                      { id:"action",      name:"Action"        },
                      { id:"casino",      name:"Casino"        },
                      { id:"simply",      name:"Simply Market" },
                      { id:"biocbon",     name:"Bio c'Bon"     },
                      { id:"autre",       name:"Autre"         },
                    ];
                    const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
                    const filtered = enseigneQuery.trim()
                      ? ENSEIGNES_LIST.filter(e => norm(e.name).includes(norm(enseigneQuery)))
                      : ENSEIGNES_LIST;
                    const selectedEns = ENSEIGNES_LIST.find(e => e.id === selectedStore);
                    const showSearch = showEnseigneSearch || !selectedEns;
                    return (
                      <div style={{ marginBottom:16, position:"relative" }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Enseigne</div>
                        {selectedEns && !showSearch ? (
                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                            <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:C.blueLight, borderRadius:99, padding:"6px 14px" }}>
                              <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:800, color:C.blue }}>{selectedEns.name}</span>
                              <button onMouseDown={()=>{ setSelectedStore("autre"); setEnseigneQuery(""); setShowEnseigneSearch(true); fetchKnownStores("autre"); }}
                                style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:C.gray, padding:0, lineHeight:1 }}>✕</button>
                            </div>
                            <button onMouseDown={()=>setShowEnseigneSearch(true)}
                              style={{ background:"none", border:"none", fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.blue, fontWeight:700, cursor:"pointer", padding:0, textDecoration:"underline" }}>
                              Changer
                            </button>
                          </div>
                        ) : (
                          <>
                            <div style={{ position:"relative" }}>
                              <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:16, pointerEvents:"none" }}>🔍</span>
                              <input
                                value={enseigneQuery}
                                onChange={e=>{ setEnseigneQuery(e.target.value); setShowEnseigneDrop(true); }}
                                onFocus={e=>{ setShowEnseigneDrop(true); e.target.style.borderColor=enseigneQuery.trim()?C.orange:C.grayLight; }}
                                onBlur={e=>{ setTimeout(()=>setShowEnseigneDrop(false), 150); e.target.style.borderColor=enseigneQuery.trim()?C.orange:C.grayLight; }}
                                placeholder="Rechercher une enseigne..."
                                style={{ width:"100%", padding:"11px 14px 11px 38px", borderRadius:10, border:`2px solid ${enseigneQuery.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.text, outline:"none", boxSizing:"border-box" }}
                              />
                              <style>{`input::placeholder { color: #6B7280; font-style: italic; }`}</style>
                            </div>
                            {selectedEns && !showEnseigneDrop && (
                              <div style={{ marginTop:6, display:"inline-flex", alignItems:"center", gap:6, background:C.blueLight, borderRadius:99, padding:"4px 12px" }}>
                                <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:800, color:C.blue }}>{selectedEns.name}</span>
                                <button onMouseDown={()=>{ setSelectedStore("autre"); setEnseigneQuery(""); fetchKnownStores("autre"); }}
                                  style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:C.gray, padding:0, lineHeight:1 }}>✕</button>
                              </div>
                            )}
                            {showEnseigneDrop && (
                              <div style={{ position:"absolute", zIndex:50, background:C.white, borderRadius:12, border:`1px solid ${C.grayLight}`, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", width:"100%", maxHeight:220, overflowY:"auto", marginTop:2 }}>
                                {filtered.map(e=>(
                                  <div key={e.id} onMouseDown={async()=>{ setSelectedStore(e.id); setStoreNameEdit(e.name); setEnseigneQuery(e.name); setShowEnseigneDrop(false); setShowEnseigneSearch(false); await fetchKnownStores(e.id); }}
                                    style={{ padding:"11px 14px", display:"flex", alignItems:"center", cursor:"pointer", borderBottom:`1px solid ${C.grayLight}`, background:selectedStore===e.id?"#F0F8FF":C.white }}>
                                    <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:selectedStore===e.id?900:700, fontSize:14, color:selectedStore===e.id?C.blue:C.text, flex:1 }}>{e.name}</span>
                                    {selectedStore===e.id && <span style={{ color:C.blue, fontSize:13 }}>✓</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* LOT 1, ouvert à tous (Chantier 97) — Catégorie du magasin,
                      1 tap. Pré-sélection heuristique sur le nom ; l'utilisateur
                      peut basculer. Transmise à la RPC de création Core. */}
                  {(()=>{
                    const cat = categorieMagasin || devinerCategorieMagasin(storeNameEdit);
                    const opts = [
                      { id:'grande_surface', label:'🛒 Grande surface' },
                      { id:'proximite',      label:'🏪 Proximité' },
                    ];
                    return (
                      <div style={{ marginBottom:16 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Catégorie</div>
                        <div style={{ display:"flex", gap:8 }}>
                          {opts.map(o => (
                            <button key={o.id} onClick={()=>setCategorieMagasin(o.id)}
                              style={{ flex:1, padding:"11px 8px", borderRadius:12, border:`2px solid ${cat===o.id?C.orange:C.grayLight}`, background:cat===o.id?"#FFF6F0":C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:cat===o.id?C.orange:"#555", cursor:"pointer" }}>
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Adresse */}
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Adresse (optionnel)</div>
                  {storeLocation.trim() && !showManualAddress ? (
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, background:C.grayLight, borderRadius:10, padding:"10px 14px" }}>
                      <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.text, fontWeight:700, flex:1 }}>{storeLocation.trim()}</span>
                      <button onClick={()=>{
                        setShowManualAddress(true); setSavedGpsCoords(null);
                        if (!manualRue) {
                          const parts = storeLocation.split(',').map(s => s.trim());
                          setManualRue(parts[0] || '');
                          let cp = '', ville = '';
                          for (const part of parts.slice(1)) {
                            const m = part.match(/(\d{5})/);
                            if (m) { cp = m[1]; ville = part.replace(/\d{5}/,'').trim(); break; }
                          }
                          setManualCP(cp);
                          setManualVille(ville.toLowerCase() === 'france' ? '' : ville);
                        }
                      }} style={{ background:"none", border:"none", fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.blue, fontWeight:800, cursor:"pointer", padding:0, flexShrink:0 }}>
                        ✏️ Modifier
                      </button>
                    </div>
                  ) : !showManualAddress ? (
                    <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                      <button onClick={()=>{
                        setGpsLoading(true); setError("");
                        navigator.geolocation.getCurrentPosition(
                          async pos => {
                            const { latitude:lat, longitude:lng } = pos.coords;
                            setSavedGpsCoords({ lat, lng });
                            try {
                              const r = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}`);
                              const d = await r.json();
                              const f = d.features?.[0]?.properties;
                              if (f) {
                                setManualRue((f.housenumber ? f.housenumber + " " : "") + (f.street || f.name || ""));
                                setManualCP(f.postcode || "");
                                setManualVille(f.city || f.municipality || "");
                              }
                            } catch {}
                            setShowManualAddress(true);
                            setGpsLoading(false);
                          },
                          () => { setError("Géolocalisation refusée ou indisponible"); setGpsLoading(false); }
                        );
                      }} disabled={gpsLoading}
                        style={{ flex:1, padding:"12px 8px", border:`2px solid ${gpsLoading?"#0066CC":C.grayLight}`, borderRadius:12, background:gpsLoading?"#EEF5FF":C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#0066CC", cursor:gpsLoading?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                        📍 GPS
                      </button>
                      <button onClick={()=>{ setShowManualAddress(true); setSavedGpsCoords(null); }}
                        style={{ flex:1, padding:"12px 8px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#555", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                        ✏️ Manuel
                      </button>
                    </div>
                  ) : null}
                  {gpsLoading && (
                    <div style={{ textAlign:"center", padding:"4px 0 10px", fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#0066CC" }}>⏳ Localisation en cours...</div>
                  )}
                  {showManualAddress && (
                    <>
                      <input value={manualRue} onChange={e=>setManualRue(e.target.value)}
                        placeholder="Rue et numéro"
                        style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`2px solid ${manualRue.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:8 }} />
                      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                        <input value={manualCP} onChange={e=>setManualCP(e.target.value)}
                          placeholder="Code postal"
                          style={{ width:"40%", padding:"11px 14px", borderRadius:10, border:`2px solid ${manualCP.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.text, outline:"none", boxSizing:"border-box" }} />
                        <input value={manualVille} onChange={e=>setManualVille(e.target.value)}
                          placeholder="Ville"
                          style={{ flex:1, padding:"11px 14px", borderRadius:10, border:`2px solid ${manualVille.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.text, outline:"none", boxSizing:"border-box" }} />
                      </div>
                    </>
                  )}

                  {error && <div style={{ background:"#FEE", borderRadius:10, padding:"10px 14px", marginBottom:12, fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red, fontWeight:700 }}>⚠️ {error}</div>}

                  {/* Chantier 97 — la création du magasin CORE est le SEUL chemin
                      de sortie de ce formulaire : plus de « Passer », et une
                      adresse (GPS, manuelle ou celle du ticket) est requise pour
                      que l'anti-doublon (CP/GPS) puisse travailler. En cas
                      d'échec Core, le gate reste fermé — message et on réessaie. */}
                  <button disabled={!storeNameEdit.trim() || manualGeocoding} onClick={async()=>{
                    setError("");
                    const aAdresseManuelle = showManualAddress && (manualRue.trim() || manualCP.trim() || manualVille.trim());
                    const aAdresseTicket   = !showManualAddress && storeLocation.trim();
                    if (!aAdresseManuelle && !aAdresseTicket) {
                      setError("Ajoute l'adresse du magasin (GPS ou manuel) pour pouvoir le créer");
                      return;
                    }
                    setManualGeocoding(true);
                    let adresse, coords;
                    if (aAdresseManuelle) {
                      adresse = [manualRue.trim(), [manualCP.trim(), manualVille.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
                      coords = savedGpsCoords || await geocodeAddress(adresse);
                      if (!coords && !manualCP.trim()) {
                        // sans coordonnées NI code postal, l'anti-doublon est aveugle
                        setError("Adresse introuvable — vérifie (ou ajoute au moins le code postal) et réessaie");
                        setManualGeocoding(false);
                        return;
                      }
                    } else {
                      adresse = storeLocation.trim();
                      coords = await geocodeAddress(adresse); // peut échouer : on continue (comportement d'avant)
                    }
                    const creation = await resoudreOuCreerStore(selectedStore, adresse, coords?.lat ?? null, coords?.lng ?? null, storeNameEdit.trim()||null);
                    setManualGeocoding(false);
                    if (creation?.magasinCoreId) {
                      if (creation.legacyId) setResolvedStoreId(creation.legacyId);
                      const nomFinal = creation.magasinCoreNom || storeNameEdit.trim() || 'Magasin';
                      setStoreNameEdit(nomFinal);
                      setStoreLocation(adresse);
                      definirMagasinCore({ id: creation.magasinCoreId, nom: nomFinal, adresse, code_postal: '', ville: '' });
                      setModeAjoutMagasin(false);
                      goToShare();
                    } else {
                      setError("Magasin non enregistré — réessaie, ou choisis-le dans la liste");
                    }
                  }}
                    style={{ width:"100%", padding:"16px", border:"none", borderRadius:12, background:storeNameEdit.trim()&&!manualGeocoding?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:storeNameEdit.trim()&&!manualGeocoding?C.white:C.gray, cursor:storeNameEdit.trim()&&!manualGeocoding?"pointer":"default", marginBottom:12, boxShadow:storeNameEdit.trim()&&!manualGeocoding?"0 6px 20px rgba(204,0,0,0.35)":"none" }}>
                    {manualGeocoding ? "⏳ Validation..." : "Créer et valider →"}
                  </button>
                  <button onClick={()=>{ setModeAjoutMagasin(false); setError(""); }} style={{ width:"100%", padding:"13px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
                    ← Choisir dans la liste
                  </button>
                </>
              )}
            </>
          )}

          {status==="preview" && result && (
            <>
              <div style={{ background:C.blueLight, borderRadius:12, padding:"12px 16px", marginBottom:16 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:C.blue, marginBottom:6 }}>
                  ✅ {editableProducts.length} produit{editableProducts.length>1?"s":""} détecté{editableProducts.length>1?"s":""}
                </div>
                {result.date && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>📅 {new Date(result.date).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}</div>}
              </div>

              <div style={{ background:C.grayLight, borderRadius:10, padding:"10px 14px", marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:16 }}>🏪</span>
                <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{storeNameEdit}{storeLocation.trim()?` – ${storeLocation.trim()}`:""}</span>
                <button onClick={()=>setStatus("store")} style={{ marginLeft:"auto", background:"none", border:"none", fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.blue, fontWeight:800, cursor:"pointer", padding:0 }}>Modifier</button>
              </div>

              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Produits à importer</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
                {editableProducts.map(p=>(
                  <div key={p.id} style={{ background:p.keep?C.white:C.grayLight, borderRadius:12, border:`1px solid ${p.keep?C.blue:C.grayLight}`, opacity:p.keep?1:0.5, overflow:"hidden" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px" }}>
                      <button onClick={()=>toggleProduct(p.id)} style={{ width:24, height:24, borderRadius:6, flexShrink:0, cursor:"pointer", border:`2px solid ${p.keep?C.blue:C.gray}`, background:p.keep?C.blue:C.white, color:C.white, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>{p.keep?"✓":""}</button>
                      <div style={{ flex:1 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{p.brand?`${p.brand} · `:""}{libelleProduit(p)}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginTop:2 }}>
                          {(formatStructureLu(p) || p.format) && (
                            <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>{formatStructureLu(p) || p.format}</span>
                          )}
                          {p.confiance === "faible" && (
                            <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:900, color:"#B25900", background:"#FFE7C2", borderRadius:99, padding:"2px 8px" }}>⚠ à vérifier</span>
                          )}
                        </div>
                      </div>
                      <input type="number" step="0.01" min="0" value={p.price} onChange={e=>updatePrice(p.id,e.target.value)}
                        style={{ width:68, padding:"6px 8px", textAlign:"right", borderRadius:8, border:`2px solid ${C.orange}`, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.orange, outline:"none" }} />
                      <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.orange }}>€</span>
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={() => goToShare()} style={{ width:"100%", padding:"16px", border:"none", borderRadius:12, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.white, cursor:"pointer", marginBottom:10, boxShadow:"0 6px 20px rgba(204,0,0,0.35)" }}>
                Continuer →
              </button>
              <button onClick={()=>setStatus("idle")} style={{ width:"100%", padding:"13px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
                ← Coller un autre JSON
              </button>
            </>
          )}

          {status==="share" && (
            <>
              <div style={{ background:"#F0FFF5", borderRadius:14, padding:"14px 16px", marginBottom:20, border:`1.5px solid ${C.green}` }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.green, marginBottom:4 }}>
                  👥 Partager avec ton cercle ?
                </div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, lineHeight:1.5 }}>
                  Ces prix seront visibles par tes contacts PrixMalin. Décoche les articles que tu veux garder privés.
                </div>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
                {editableProducts.filter(p=>p.keep&&(p.name||p.libelle_ticket)&&p.price>0).map(p => {
                  const checked = shareChecked.has(p.id);
                  const toggle = () => setShareChecked(prev => {
                    const next = new Set(prev);
                    checked ? next.delete(p.id) : next.add(p.id);
                    return next;
                  });
                  const isEditing = editingId === p.id;
                  const openEdit = () => {
                    if (isEditing) { setEditingId(null); return; }
                    setEditingId(p.id);
                    setEditDraft({ name: libelleProduit(p), price: p.price, category: p.category || guessCategory(libelleProduit(p)) });
                  };
                  const saveEdit = () => {
                    setEditableProducts(prev => prev.map(ep => ep.id === p.id
                      ? { ...ep, name: editDraft.name, price: parseFloat(editDraft.price) || ep.price, category: editDraft.category }
                      : ep));
                    setEditingId(null);
                  };
                  return (
                    <div key={p.id} style={{ borderRadius:12, border:`1.5px solid ${isEditing?"#4A90D9":checked?C.green:C.grayLight}`, overflow:"hidden", background:isEditing?"#F0F8FF":checked?"#F0FFF5":C.white }}>
                      <div onClick={openEdit} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", cursor:"pointer" }}>
                        <div onClick={e=>{ e.stopPropagation(); toggle(); }} style={{ width:24, height:24, borderRadius:6, flexShrink:0, border:`2px solid ${checked?C.green:C.gray}`, background:checked?C.green:C.white, display:"flex", alignItems:"center", justifyContent:"center", color:C.white, fontSize:13 }}>
                          {checked ? "✓" : ""}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {p.brand ? `${p.brand} · ` : ""}{libelleProduit(p)}
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginTop:2 }}>
                            {(formatStructureLu(p) || p.format) && (
                              <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>{formatStructureLu(p) || p.format}</span>
                            )}
                            {p.confiance === "faible" && (
                              <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:900, color:"#B25900", background:"#FFE7C2", borderRadius:99, padding:"2px 8px" }}>⚠ à vérifier</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.orange }}>{p.price.toFixed(2)} €</div>
                          <span style={{ fontSize:11, color:C.gray }}>✏️</span>
                        </div>
                      </div>
                      {isEditing && (
                        <div onClick={e=>e.stopPropagation()} style={{ padding:"12px 14px", borderTop:"1px solid #D0E8FF", background:"#F4F9FF" }}>
                          <div style={{ marginBottom:8 }}>
                            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>Nom du produit</div>
                            <input value={editDraft.name} onChange={e=>setEditDraft(d=>({...d,name:e.target.value}))}
                              style={{ width:"100%", padding:"8px 12px", borderRadius:8, border:"1.5px solid #4A90D9", fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
                          </div>
                          <div style={{ marginBottom:8 }}>
                            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>Prix (€)</div>
                            <input type="number" step="0.01" min="0" value={editDraft.price} onChange={e=>setEditDraft(d=>({...d,price:e.target.value}))}
                              style={{ width:"100%", padding:"8px 12px", borderRadius:8, border:`1.5px solid ${C.orange}`, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:900, color:C.orange, outline:"none", boxSizing:"border-box" }} />
                          </div>
                          <div style={{ marginBottom:10 }}>
                            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 }}>Catégorie</div>
                            <select value={editDraft.category} onChange={e=>setEditDraft(d=>({...d,category:e.target.value}))}
                              style={{ width:"100%", padding:"8px 12px", borderRadius:8, border:`1.5px solid ${C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.text, background:"#fff", outline:"none", boxSizing:"border-box" }}>
                              {SHARE_CATEGORIES.map(cat=><option key={cat} value={cat}>{cat}</option>)}
                            </select>
                          </div>
                          <button onClick={saveEdit} style={{ width:"100%", padding:"10px", border:"none", borderRadius:8, background:"#4A90D9", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer" }}>
                            ✓ OK
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button onClick={()=>confirm(shareChecked)} disabled={saving}
                style={{ width:"100%", padding:"16px", border:"none", borderRadius:12, background:saving?C.grayLight:C.green, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.white, cursor:saving?"default":"pointer", marginBottom:10, boxShadow:saving?"none":"0 6px 20px rgba(0,179,65,0.35)" }}>
                👥 Partager {shareChecked.size} article{shareChecked.size !== 1 ? "s" : ""}
              </button>
              <button onClick={()=>confirm(new Set())} disabled={saving}
                style={{ width:"100%", padding:"14px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:saving?C.gray:C.textLight, cursor:saving?"default":"pointer" }}>
                Non merci — garder tout privé
              </button>
            </>
          )}
        </div>
      </div>
      {(scanning || galleryScanning) && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:999, pointerEvents:"all" }}>
          <div style={{ width:48, height:48, border:"4px solid rgba(255,255,255,0.2)", borderTopColor:"#F5C200", borderRadius:"50%", animation:"spin 0.8s linear infinite", marginBottom:20 }}/>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:16, color:"#fff" }}>Analyse en cours...</div>
        </div>
      )}
    </div>
  );
}

// ── PRICE ENTRY SHEET (saisie manuelle) ───────────────────────────────────────
// Chantier 95 Lot 11 (additif) — prefill : pré-remplit les champs produit
// SANS passer en mode « modification » (existingPrice), pour que la double
// écriture Core (création) reste active. magasinVerrouille { nom, enseigne,
// storeLegacyId, adresse } : le magasin est CONNU (session de courses) — il
// n'est jamais redemandé, le sélecteur est remplacé par un simple rappel.
function PriceEntrySheet({ onClose, onSave, existingPrice, prefill = null, magasinVerrouille = null }) {
  const [brand,   setBrand]   = useState(existingPrice?.brand || prefill?.brand || "");
  const [product, setProduct] = useState(existingPrice?.product || prefill?.product || "");
  const [format,  setFormat]  = useState(existingPrice?.format||"");
  const [quantite,       setQuantite]       = useState(existingPrice?.quantite || "");
  const [unite,          setUnite]          = useState(existingPrice?.unite || "");
  const [conditionnement,setConditionnement]= useState(existingPrice?.conditionnement || 1);
  const [price,   setPrice]   = useState(existingPrice?.price?.toString()||"");

  // Sélecteur de magasin (même logique que le flux post-scan #35)
  const [selectedStore,      setSelectedStore]      = useState(existingPrice?.storeId || (magasinVerrouille ? (storeIdFromName(magasinVerrouille.enseigne || magasinVerrouille.nom) || 'autre') : ""));
  const [storeNameEdit,      setStoreNameEdit]      = useState(existingPrice?.store_name || magasinVerrouille?.nom || "");
  const [knownStores,        setKnownStores]        = useState([]);
  const [knownStoresLoading, setKnownStoresLoading] = useState(false);
  const [resolvedStoreId,    setResolvedStoreId]    = useState(existingPrice?.store_id || magasinVerrouille?.storeLegacyId || null);
  const [enseigneQuery,      setEnseigneQuery]      = useState('');
  const [showEnseigneDrop,   setShowEnseigneDrop]   = useState(false);
  const [showEnseigneSearch, setShowEnseigneSearch] = useState(false);
  const [showSuggestions,    setShowSuggestions]    = useState(false);
  const [showAddressSection, setShowAddressSection] = useState(false);
  const [gpsLoading,         setGpsLoading]         = useState(false);
  const [showManualAddress,  setShowManualAddress]  = useState(false);
  const [manualRue,          setManualRue]          = useState('');
  const [manualCP,           setManualCP]           = useState('');
  const [manualVille,        setManualVille]        = useState('');
  const [savedGpsCoords,     setSavedGpsCoords]     = useState(null);
  const [manualGeocoding,    setManualGeocoding]    = useState(false);
  const [error,              setError]              = useState('');

  const [productSuggestions, setProductSuggestions] = useState([]);
  const [showProductDrop,    setShowProductDrop]    = useState(false);
  const allProductNames = useRef([]);
  const allStores = useRef([]);

  useEffect(() => {
    supabase.from('price_db').select('product').then(({ data }) => {
      if (data) allProductNames.current = [...new Set(data.map(p => p.product).filter(Boolean))];
    });
  }, []);

  useEffect(() => {
    supabase.from('stores').select('id, name, enseigne, address').then(({ data }) => {
      if (data) allStores.current = data;
    });
  }, []);

  const canSubmit = product.trim() && (!quantite || !!unite) && price && !isNaN(parseFloat(price)) && (resolvedStoreId || selectedStore || magasinVerrouille);

  const ENSEIGNES_LIST = [
    { id:"lidl",        name:"Lidl"          },
    { id:"leclerc",     name:"E.Leclerc"     },
    { id:"intermarche", name:"Intermarché"   },
    { id:"netto",       name:"Netto"         },
    { id:"carrefour",   name:"Carrefour"     },
    { id:"franprix",    name:"Franprix"      },
    { id:"aldi",        name:"Aldi"          },
    { id:"superu",      name:"Super U"       },
    { id:"hyperu",      name:"Hyper U"       },
    { id:"uexpress",    name:"U Express"     },
    { id:"utile",       name:"Utile"         },
    { id:"vival",       name:"Vival"         },
    { id:"spar",        name:"Spar"          },
    { id:"monoprix",    name:"Monoprix"      },
    { id:"picard",      name:"Picard"        },
    { id:"action",      name:"Action"        },
    { id:"casino",      name:"Casino"        },
    { id:"simply",      name:"Simply Market" },
    { id:"biocbon",     name:"Bio c'Bon"     },
    { id:"autre",       name:"Autre"         },
  ];

  const fetchKnownStores = async (enseigne) => {
    if (!enseigne || enseigne === 'autre') { setKnownStores([]); return; }
    setKnownStoresLoading(true);
    setResolvedStoreId(null);
    const { data } = await supabase.from('stores').select('*').eq('enseigne', enseigne);
    const stores = data || [];
    setKnownStores(stores);
    const lastId = localStorage.getItem(`prixmalin_lastStore_${enseigne}`);
    if (lastId && stores.some(s => s.id === lastId)) setResolvedStoreId(lastId);
    setKnownStoresLoading(false);
  };

  const submit = () => {
    if (!canSubmit || manualGeocoding) return;
    if (resolvedStoreId && selectedStore && selectedStore !== 'autre') {
      localStorage.setItem(`prixmalin_lastStore_${selectedStore}`, resolvedStoreId);
    }
    const storeRecord = knownStores.find(s => s.id === resolvedStoreId);
    const entry = {
      brand:         brand.trim(),
      product:       product.trim(),
      format:        (() => {
        if (!quantite) return "";
        const cond = Number(conditionnement) || 1;
        if (unite === 'pièce' && cond > 1) return `x${cond}`;
        if (unite === 'pièce' && cond === 1) return "1 pièce";
        if (cond > 1) return `${cond}x${quantite}${unite}`;
        return `${quantite}${unite}`;
      })(),
      quantite:      quantite ? Number(quantite) : null,
      unite:         unite || '',
      conditionnement: Number(conditionnement) || 1,
      storeId:       selectedStore || 'autre',
      store_name:    storeNameEdit.trim(),
      store_address: storeRecord?.address || magasinVerrouille?.adresse || '',
      store_id:      resolvedStoreId,
      price:         parseFloat(price),
      date:          new Date().toISOString(),
    };
    // #56.5.A — double écriture Core, uniquement pour une création (jamais
    // pour une modification via existingPrice, qui créerait un doublon côté
    // Core puisque la RPC ne fait qu'un INSERT, jamais une correction).
    if (existingPrice == null) {
      void envoyerPrixManuelCore(entry, {
        storeLegacyId: resolvedStoreId || null,
        magasinTexte:  storeNameEdit.trim() || null,
      });
    }
    onSave(entry);
    onClose();
  };

  const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");

  const updateProductSuggestions = (query) => {
    if (query.trim().length < 2) { setProductSuggestions([]); return; }
    const q = normName(query);
    const matches = allProductNames.current.filter(n => normName(n).includes(q)).slice(0, 6);
    setProductSuggestions(matches);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"90vh", overflowY:"auto", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:C.orange, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:10 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:C.white }}>{existingPrice?"Modifier":"Saisir un prix"}</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:28, height:28, color:C.white, fontSize:14, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:"20px 20px 44px" }}>

          {/* Produit * — avec autocomplétion price_db */}
          <div style={{ marginBottom:14, position:"relative" }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Produit *</div>
            <input value={product}
              onChange={e=>{ setProduct(e.target.value); updateProductSuggestions(e.target.value); }}
              onFocus={()=>{ updateProductSuggestions(product); setShowProductDrop(true); }}
              onBlur={()=>setTimeout(()=>setShowProductDrop(false), 150)}
              placeholder="Ex : Cola Zéro, Lait, Pâtes..."
              style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${product?C.orange:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
            {showProductDrop && productSuggestions.length > 0 && (
              <div style={{ position:"absolute", zIndex:50, background:C.white, borderRadius:12, border:`1px solid ${C.grayLight}`, boxShadow:"0 4px 16px rgba(0,0,0,0.1)", width:"100%", marginTop:2 }}>
                {productSuggestions.map((name, i) => (
                  <div key={i} onMouseDown={()=>{ setProduct(name); setProductSuggestions([]); setShowProductDrop(false); }}
                    style={{ padding:"11px 14px", fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.text, cursor:"pointer", borderBottom:i<productSuggestions.length-1?`1px solid ${C.grayLight}`:"none" }}>
                    {name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Marque (optionnel) */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Marque (optionnel)</div>
            <input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="Ex : Look, Coca-Cola, Président..."
              style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${brand?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
          </div>

          {/* Quantité / Unité / Conditionnement */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Quantité</div>
            <input type="number" min="0" value={quantite} onChange={e=>setQuantite(e.target.value)} placeholder="Ex: 500"
              style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${quantite?C.orange:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Unité{quantite ? " *" : ""}</div>
            <select value={unite} onChange={e=>setUnite(e.target.value)}
              style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${unite?C.orange:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }}>
              <option value=""></option>
              <option value="g">g</option>
              <option value="kg">kg</option>
              <option value="cl">cl</option>
              <option value="ml">ml</option>
              <option value="L">L</option>
              <option value="pièce">pièce</option>
            </select>
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Conditionnement</div>
            <input type="number" min="1" value={conditionnement} onChange={e=>setConditionnement(e.target.value)} placeholder="Ex: 4 pour 4x100g"
              style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${Number(conditionnement)>1?C.orange:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
          </div>

          {/* Prix */}
          <div style={{ marginBottom:22 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Prix *</div>
            <div style={{ position:"relative" }}>
              <input type="number" step="0.01" min="0" value={price} onChange={e=>setPrice(e.target.value)} placeholder="0.00"
                style={{ width:"100%", padding:"16px 50px 16px 16px", borderRadius:12, border:`2px solid ${price?C.orange:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:24, fontWeight:900, color:C.text, outline:"none", boxSizing:"border-box" }} />
              <span style={{ position:"absolute", right:16, top:"50%", transform:"translateY(-50%)", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.orange }}>€</span>
            </div>
          </div>

          {/* ─── Sélecteur de magasin (même logique que le flux post-scan #35) ─── */}
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 }}>Magasin *</div>

          {/* Chantier 95 — magasin de la session : connu, jamais redemandé. */}
          {magasinVerrouille ? (
            <div style={{ background:"#F0FFF5", borderRadius:14, padding:"14px 16px", marginBottom:16, border:`1.5px solid ${C.green}` }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.green, marginBottom:2 }}>
                🏪 {storeNameEdit || magasinVerrouille.nom || "Magasin de tes courses"}
              </div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>
                {magasinVerrouille.adresse || "Le magasin de ta session de courses"}
              </div>
            </div>
          ) : resolvedStoreId ? (
            /* Magasin résolu */
            <div style={{ background:"#F0FFF5", borderRadius:14, padding:"14px 16px", marginBottom:16, border:`1.5px solid ${C.green}` }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.green, marginBottom:4 }}>
                ✅ {storeNameEdit || knownStores.find(s=>s.id===resolvedStoreId)?.name || "Magasin reconnu"}
              </div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>
                {knownStores.find(s=>s.id===resolvedStoreId)?.address || "Position GPS enregistrée"}
              </div>
              <button onClick={()=>{ setResolvedStoreId(null); setShowManualAddress(false); setSavedGpsCoords(null); setError(""); }}
                style={{ marginTop:8, background:"none", border:"none", fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.blue, fontWeight:800, cursor:"pointer", padding:0, textDecoration:"underline" }}>
                Changer de magasin
              </button>
            </div>

          ) : (
            <>
              {/* Nom du magasin : autocomplétion ENSEIGNES_LIST + table stores */}
              {(()=>{
                const q = normName(storeNameEdit.trim());
                const suggestions = storeNameEdit.trim().length >= 2
                  ? [
                      ...ENSEIGNES_LIST
                        .filter(e => e.id !== 'autre' && normName(e.name).includes(q))
                        .map(e => ({ type:'enseigne', id:e.id, name:e.name, logo:STORES.find(s=>s.id===e.id)?.logo||'🏪', address:null, enseigne:e.id })),
                      ...allStores.current
                        .filter(s => normName(s.name||'').includes(q))
                        .map(s => ({ type:'store', id:s.id, name:s.name, logo:STORES.find(st=>st.id===s.enseigne)?.logo||'🏪', address:s.address, enseigne:s.enseigne })),
                    ].slice(0, 8)
                  : [];
                return (
                  <div style={{ position:"relative", marginBottom:12 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:700, color:C.gray, marginBottom:4 }}>Nom du magasin</div>
                    <input value={storeNameEdit} onChange={e=>{ setStoreNameEdit(e.target.value); setShowSuggestions(true); }}
                      onFocus={()=>setShowSuggestions(true)}
                      onBlur={()=>setTimeout(()=>setShowSuggestions(false), 150)}
                      placeholder="Ex : Intermarché Sanary, Lidl…"
                      style={{ width:"100%", padding:"12px 14px", borderRadius:10, border:`2px solid ${storeNameEdit.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, outline:"none", boxSizing:"border-box" }} />
                    {showSuggestions && suggestions.length > 0 && (
                      <div style={{ position:"absolute", zIndex:50, background:C.white, borderRadius:12, border:`1px solid ${C.grayLight}`, boxShadow:"0 4px 16px rgba(0,0,0,0.1)", width:"100%", marginTop:2, overflow:"hidden" }}>
                        <div style={{ maxHeight:200, overflowY:"auto" }}>
                          {suggestions.map((s, i) => (
                            <div key={i} onMouseDown={()=>{
                              setStoreNameEdit(s.name);
                              setShowSuggestions(false);
                              if (s.type === 'store') {
                                setResolvedStoreId(s.id);
                                setSelectedStore(s.enseigne);
                                setEnseigneQuery(ENSEIGNES_LIST.find(e=>e.id===s.enseigne)?.name || s.enseigne);
                                setShowEnseigneSearch(false);
                                setKnownStores(prev => prev.some(k=>k.id===s.id) ? prev : [...prev, s]);
                              } else {
                                setSelectedStore(s.id);
                                setEnseigneQuery(s.name);
                                setShowEnseigneSearch(false);
                                fetchKnownStores(s.id);
                              }
                            }}
                              style={{ padding:"12px 14px", display:"flex", gap:10, alignItems:"center", cursor:"pointer", borderBottom:`1px solid ${C.grayLight}` }}>
                              <span style={{ fontSize:18 }}>{s.logo}</span>
                              <div>
                                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{s.name}</div>
                                {s.address && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight }}>{s.address}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}


              {/* Magasins connus de cette enseigne */}
              {knownStoresLoading && (
                <div style={{ textAlign:"center", padding:"12px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>⏳ Recherche du magasin…</div>
              )}
              {!knownStoresLoading && knownStores.length > 0 && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:700, color:C.gray, marginBottom:6 }}>Sélectionne ton magasin</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {knownStores.map(s => (
                      <button key={s.id} onClick={()=>{ setResolvedStoreId(s.id); if (s.name) setStoreNameEdit(s.name); }}
                        style={{ padding:"10px 14px", borderRadius:10, border:`2px solid ${resolvedStoreId===s.id?C.green:C.grayLight}`, background:resolvedStoreId===s.id?"#F0FFF5":C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:resolvedStoreId===s.id?C.green:C.text, cursor:"pointer", textAlign:"left" }}>
                        {s.name || storeNameEdit}
                        {s.address && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:600, color:C.textLight, marginTop:2 }}>{s.address}</div>}
                      </button>
                    ))}
                  </div>
                  {!showAddressSection && (
                    <button onClick={()=>{ setShowAddressSection(true); setShowManualAddress(false); setSavedGpsCoords(null); }}
                      style={{ marginTop:8, background:"none", border:"none", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.blue, fontWeight:800, cursor:"pointer", padding:0, textDecoration:"underline" }}>
                      ➕ Ajouter une nouvelle adresse
                    </button>
                  )}
                </div>
              )}

              {/* Formulaire adresse nouveau magasin */}
              {!resolvedStoreId && (showAddressSection || (selectedStore && (knownStores.length === 0 || showManualAddress) && !knownStoresLoading)) && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:700, color:C.gray, marginBottom:6 }}>
                    {knownStores.length === 0 ? "Magasin inconnu — ajoute son adresse" : "Adresse du nouveau magasin"}
                  </div>
                  {!showManualAddress ? (
                    <div style={{ display:"flex", gap:8 }}>
                      <button onClick={()=>{
                        setGpsLoading(true); setError("");
                        navigator.geolocation.getCurrentPosition(
                          async pos => {
                            const { latitude:lat, longitude:lng } = pos.coords;
                            setSavedGpsCoords({ lat, lng });
                            try {
                              const r = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}`);
                              const d = await r.json();
                              const f = d.features?.[0]?.properties;
                              if (f) {
                                setManualRue((f.housenumber ? f.housenumber + " " : "") + (f.street || f.name || ""));
                                setManualCP(f.postcode || "");
                                setManualVille(f.city || f.municipality || "");
                              }
                            } catch {}
                            setShowManualAddress(true);
                            setGpsLoading(false);
                          },
                          () => { setError("Géolocalisation refusée"); setGpsLoading(false); }
                        );
                      }} disabled={gpsLoading}
                        style={{ flex:1, padding:"11px 8px", border:`2px solid ${C.grayLight}`, borderRadius:10, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#0066CC", cursor:gpsLoading?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                        📍 GPS
                      </button>
                      <button onClick={()=>{ setShowManualAddress(true); setSavedGpsCoords(null); }}
                        style={{ flex:1, padding:"11px 8px", border:`2px solid ${C.grayLight}`, borderRadius:10, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#555", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                        ✏️ Saisir
                      </button>
                    </div>
                  ) : (
                    <>
                      <input value={manualRue} onChange={e=>setManualRue(e.target.value)} placeholder="Rue et numéro"
                        style={{ width:"100%", padding:"10px 14px", borderRadius:10, border:`2px solid ${manualRue.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:13, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:6 }} />
                      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                        <input value={manualCP} onChange={e=>setManualCP(e.target.value)} placeholder="Code postal"
                          style={{ width:"40%", padding:"10px 14px", borderRadius:10, border:`2px solid ${manualCP.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:13, color:C.text, outline:"none", boxSizing:"border-box" }} />
                        <input value={manualVille} onChange={e=>setManualVille(e.target.value)} placeholder="Ville"
                          style={{ flex:1, padding:"10px 14px", borderRadius:10, border:`2px solid ${manualVille.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:13, color:C.text, outline:"none", boxSizing:"border-box" }} />
                      </div>
                      {(manualRue.trim() || manualVille.trim()) && (
                        <button disabled={manualGeocoding} onClick={async()=>{
                          setManualGeocoding(true); setError("");
                          try {
                            let lat, lng;
                            if (savedGpsCoords) { lat = savedGpsCoords.lat; lng = savedGpsCoords.lng; }
                            else {
                              const fullAddr = [manualRue.trim(), manualCP.trim(), manualVille.trim()].filter(Boolean).join(', ');
                              const coords = await geocodeAddress(fullAddr);
                              if (!coords) { setError("Adresse introuvable — vérifie et réessaie"); setManualGeocoding(false); return; }
                              lat = coords.lat; lng = coords.lng;
                            }
                            const fullAddr = [manualRue.trim(), manualCP.trim(), manualVille.trim()].filter(Boolean).join(', ');
                            const id = await insertStoreInDB(selectedStore, fullAddr, lat, lng, storeNameEdit.trim()||null);
                            if (id) { setResolvedStoreId(id); setKnownStores(prev=>[...prev, { id, address: fullAddr, name: storeNameEdit }]); setShowAddressSection(false); }
                            else setError("Impossible d'enregistrer le magasin");
                          } catch { setError("Erreur lors de l'enregistrement"); }
                          setManualGeocoding(false);
                        }}
                          style={{ width:"100%", padding:"11px", border:"none", borderRadius:10, background:manualGeocoding?C.grayLight:"#4A90D9", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:manualGeocoding?C.gray:"#fff", cursor:manualGeocoding?"default":"pointer", marginBottom:6 }}>
                          {manualGeocoding ? "⏳ Enregistrement…" : "📍 Valider et lier ce magasin"}
                        </button>
                      )}
                    </>
                  )}
                  {gpsLoading && <div style={{ textAlign:"center", padding:"4px 0 6px", fontFamily:"'Nunito',sans-serif", fontSize:12, color:"#0066CC" }}>⏳ Localisation…</div>}
                </div>
              )}

              {error && <div style={{ background:"#FEE", borderRadius:10, padding:"10px 14px", marginBottom:10, fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.red, fontWeight:700 }}>⚠️ {error}</div>}
            </>
          )}

          <button onClick={submit} disabled={!canSubmit || manualGeocoding}
            style={{ width:"100%", padding:"16px", border:"none", borderRadius:12, background:canSubmit&&!manualGeocoding?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:canSubmit&&!manualGeocoding?C.white:C.gray, cursor:canSubmit&&!manualGeocoding?"pointer":"default", marginTop:8 }}>
            💾 Enregistrer ce prix
          </button>
        </div>
      </div>
    </div>
  );
}


// ── CATALOG TAB ───────────────────────────────────────────────────────────────
function ProductPickerSheet({ produit, categoryPresentation, onClose, onAdd, items }) {
  const [variantes,        setVariantes]        = useState([]);
  const [varianteId,       setVarianteId]       = useState(null);
  const [variantesLoading, setVariantesLoading] = useState(true);
  const [varianteError,    setVarianteError]    = useState(null);
  const [qty,              setQty]              = useState(1);
  const [submitting,       setSubmitting]       = useState(false);
  const [submitError,      setSubmitError]      = useState(null);
  // Chantier 74 — sélecteur Marque/Format à partir des champs structurés.
  // 'all' = "Toutes les marques" / "Tous les formats", sélectionné par défaut.
  const [marqueSelectionnee, setMarqueSelectionnee] = useState('all');
  const [formatSelectionne,  setFormatSelectionne]  = useState('all');
  // Chantier 84 — Temps 1 : segment Marques Nationales / Marque Distributeur de
  // l'article qu'on ajoute. Défaut 'nationale' ; sauf produit qui n'existe QU'en
  // marque distributeur -> bascule auto en 'mdd' (note affichée).
  const [segmentMarque, setSegmentMarque] = useState('nationale');
  const [basculeAutoMdd, setBasculeAutoMdd] = useState(false);
  // Chantier 83 (ajustement) — agrandi/lightbox de la photo de fiche.
  const [offLarge,      setOffLarge]      = useState(null);   // URL OFF brute (400) ou null
  const [agrandi,       setAgrandi]       = useState(false);  // overlay ouvert ? (repli géré dans LightboxPhoto)
  // Chantier 92 Lot 6 — favori du FORMAT résolu (table Core favoris, jamais
  // les « courses habituelles » legacy). statut : 'inconnu' (pas de format
  // précis ou vérification en cours), 'aucun', 'favori', 'travail'.
  const [favoriEtat, setFavoriEtat] = useState({ statut: 'inconnu', id: null });
  const [favoriMsg,  setFavoriMsg]  = useState(null);

  const loadVariantes = async () => {
    setVarianteError(null);
    setVariantesLoading(true);
    setMarqueSelectionnee('all');
    setFormatSelectionne('all');
    try {
      const data = await chargerVariantes(produit.id);
      setVariantes(data);
      setVarianteId(data.length === 0 ? 'any' : null);
      // Bascule auto MDD si le produit n'a AUCUNE variante nationale
      // (nationale = est_mdd !== true, donc inclut les sans-marque).
      const aUneNationale = data.some(v => v.marques?.est_mdd !== true);
      const aUneMdd = data.some(v => v.marques?.est_mdd === true);
      if (!aUneNationale && aUneMdd) { setSegmentMarque('mdd'); setBasculeAutoMdd(true); }
      else { setSegmentMarque('nationale'); setBasculeAutoMdd(false); }
    } catch (e) {
      console.error("Erreur chargement variantes :", e);
      setVariantes([]);
      setVarianteId(null); // jamais 'any' sur erreur : on ne sait pas si le produit a des variantes
      setVarianteError("Impossible de charger les formats.");
    } finally {
      setVariantesLoading(false);
    }
  };

  // Temps 1 — choix explicite du segment pour l'article en cours d'ajout et
  // annule l'état "bascule auto". Repart propre côté marque/format. La valeur
  // sera écrite sur la ligne (marque_pref) à la validation.
  const choisirSegment = (seg) => {
    const s = seg === 'mdd' ? 'mdd' : 'nationale';
    setSegmentMarque(s);
    setBasculeAutoMdd(false);
    setMarqueSelectionnee('all');
  };

  useEffect(() => {
    loadVariantes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produit.id]);

  // Chantier 83 (ajustement) — résout l'URL OFF brute (pour l'agrandi) quand une
  // variante est connue. Sert à savoir si la photo est cliquable et à construire
  // la pleine résolution. Ne plante jamais (erreur -> pas d'agrandi).
  const varianteRefId = variantes[0]?.id;
  useEffect(() => {
    let cancelled = false;
    // offLargeSource(undefined) résout null : pas de setState synchrone ici.
    offLargeSource(varianteRefId)
      .then(u => { if (!cancelled) setOffLarge(u); })
      .catch(() => { if (!cancelled) setOffLarge(null); });
    return () => { cancelled = true; };
  }, [varianteRefId]);

  // Variantes retenues par le segment courant. Nationale = est_mdd !== true
  // (inclut les sans-marque) ; MDD = est_mdd === true.
  const variantesSegment = useMemo(
    () => segmentMarque === 'mdd'
      ? variantes.filter(v => v.marques?.est_mdd === true)
      : variantes.filter(v => v.marques?.est_mdd !== true),
    [variantes, segmentMarque]
  );

  // Marques affichables en Temps 2 : UNIQUEMENT des marques NATIONALES
  // (jamais un nom de MDD). Vide hors segment nationale.
  const marquesListe = useMemo(() => {
    if (segmentMarque !== 'nationale') return [];
    const pertinentes = formatSelectionne === 'all'
      ? variantesSegment
      : variantesSegment.filter(v => formatFormatStructure(v) === formatSelectionne);
    const map = new Map();
    pertinentes.forEach(v => { if (v.marque_id && v.marques?.nom && v.marques?.est_mdd !== true) map.set(v.marque_id, v.marques.nom); });
    return [...map.entries()]
      .map(([id, nom]) => ({ id, nom }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [variantesSegment, formatSelectionne, segmentMarque]);

  // Formats disponibles dans le segment, filtrés par la marque nationale
  // éventuellement choisie.
  const formatsListe = useMemo(() => {
    const base = (segmentMarque === 'nationale' && marqueSelectionnee !== 'all')
      ? variantesSegment.filter(v => v.marque_id === marqueSelectionnee)
      : variantesSegment;
    const labels = new Set();
    base.forEach(v => { const l = formatFormatStructure(v); if (l) labels.add(l); });
    return [...labels];
  }, [variantesSegment, marqueSelectionnee, segmentMarque]);

  // Variante(s) résolues par (segment, marque, format). La marque ne filtre
  // qu'en segment nationale ; en MDD, pas de sous-marque.
  const variantesResolues = useMemo(() => {
    return variantesSegment.filter(v =>
      (segmentMarque !== 'nationale' || marqueSelectionnee === 'all' || v.marque_id === marqueSelectionnee) &&
      (formatSelectionne === 'all' || formatFormatStructure(v) === formatSelectionne)
    );
  }, [variantesSegment, marqueSelectionnee, formatSelectionne, segmentMarque]);

  // Chantier 92 Lot 6 — le cœur ne s'applique qu'à un FORMAT précis :
  // exactement une variante résolue par (segment, marque, format). Vérification
  // d'existence best effort (anti-doublon rejoué de toute façon à l'écriture).
  const varianteResolueId = variantesResolues.length === 1 ? variantesResolues[0].id : null;
  useEffect(() => {
    setFavoriMsg(null);
    if (!varianteResolueId) { setFavoriEtat({ statut: 'inconnu', id: null }); return; }
    let annule = false;
    chercherFavori({ produitId: produit.id, varianteProduitId: varianteResolueId })
      .then(f => { if (!annule) setFavoriEtat(f ? { statut: 'favori', id: f.id } : { statut: 'aucun', id: null }); });
    return () => { annule = true; };
  }, [varianteResolueId, produit.id]);

  const basculerFavori = async () => {
    if (!varianteResolueId || favoriEtat.statut === 'travail') return;
    const avant = favoriEtat;
    setFavoriMsg(null);
    setFavoriEtat({ statut: 'travail', id: avant.id });
    if (avant.statut === 'favori') {
      const ok = avant.id ? await retirerFavori(avant.id) : false;
      setFavoriEtat(ok ? { statut: 'aucun', id: null } : avant);
      if (!ok) setFavoriMsg("Retrait impossible, réessaie.");
    } else {
      const res = await ajouterFavori({ produitId: produit.id, varianteProduitId: varianteResolueId });
      if (res.statut === 'ajoute') {
        setFavoriEtat({ statut: 'favori', id: res.id ?? null });
      } else if (res.statut === 'deja') {
        // Anti-doublon : jamais réinséré, l'index unique reste le filet.
        setFavoriEtat({ statut: 'favori', id: res.id ?? null });
        setFavoriMsg("Déjà en favori");
      } else {
        setFavoriEtat(avant);
        setFavoriMsg("Favori non enregistré, réessaie.");
      }
    }
  };

  // Chantier 74 (suite) — un seul bouton vert plein par rangée (le choix actif),
  // tous les autres en gris neutre (jamais un contour vert qui donnerait
  // l'impression que tout est sélectionné).
  const pillStyle = (actif) => ({
    padding: "9px 16px", background: actif ? C.green : C.grayLight, border: `2px solid ${actif ? C.green : "transparent"}`,
    borderRadius: 99, fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 14,
    color: actif ? C.white : C.textLight, cursor: "pointer",
  });

  const alreadyInList = items.some(i => i.product.toLowerCase().trim() === produit.nom_reference.toLowerCase().trim());
  const canSubmit = !variantesLoading && !varianteError && !submitting;

  // Le résultat booléen d'addItem (via App.addItem) détermine si l'article a bien
  // été enregistré — un simple await ne suffit pas car les erreurs y sont interceptées.
  const submit = async () => {
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    let ajoutReussi = false;

    try {
      const item = {
        id:                  Date.now() + Math.random(),
        product:             produit.nom_reference,
        format:              '',
        brand:               '',
        qty,
        checked:             false,
        produit_id:          produit.id,
        // Chantier 74 — le couple (marque, format) peut résoudre 0, 1 ou
        // plusieurs variantes (ex. "Tous les formats" + une marque qui a
        // 3 tailles) ; seul le cas à exactement 1 variante fixe un
        // variante_produit_id précis, sinon null (même comportement que
        // l'ancien "Format indifférent").
        variante_produit_id:
          varianteId === 'any' ? null : (variantesResolues.length === 1 ? variantesResolues[0].id : null),
        // Chantier 84 — préférence marque de CET article (défaut 'nationale',
        // ou 'mdd' si produit uniquement en marque distributeur / choix explicite).
        marque_pref: segmentMarque === 'mdd' ? 'mdd' : 'nationale',
      };

      const ok = await onAdd(item);

      if (ok === true || ok === 'duplicate') {
        // 'duplicate' : déjà dans la liste, message affiché par App — on ferme
        // simplement la fiche, sans erreur.
        ajoutReussi = true;
      } else {
        setSubmitError("Ajout impossible, réessaie.");
      }
    } catch (error) {
      console.error("Erreur ajout depuis le Catalogue :", error);
      setSubmitError("Ajout impossible, réessaie.");
    } finally {
      // En cas de succès, on laisse le bouton en état "chargement" jusqu'au
      // démontage de la fiche (onClose ci-dessous) — évite un dernier flash visuel.
      if (!ajoutReussi) {
        setSubmitting(false);
      }
    }

    if (ajoutReussi) {
      onClose(); // retour automatique à la liste des produits de la sous-catégorie
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300, animation:"fadeIn 0.2s ease" }} onClick={onClose}>

      {/* Chantier 83 — lightbox : photo agrandie pleine résolution (OFF .full via
          Cloudinary c_limit w_1000), repli sur le 400 si .full échoue. Fermeture
          en tapant hors image ou sur ×. Aucun dialog natif bloquant. */}
      {agrandi && offLarge && <LightboxPhoto offLarge={offLarge} onClose={()=>setAgrandi(false)} />}

      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"90vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease", overflow:"hidden" }}>

        {/* Header produit */}
        <div style={{ background:`linear-gradient(135deg, ${categoryPresentation.color}, ${categoryPresentation.color}CC)`, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:28 }}>{categoryPresentation.emoji}</span>
            <div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.white }}>{produit.nom_reference}</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:"rgba(255,255,255,0.7)" }}>
                Choisis un format
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:32, height:32, color:C.white, fontSize:16, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ overflowY:"auto", flex:1, padding:"16px 16px 40px" }}>

          {/* Chantier 83 — photo produit en grand (OFF+Cloudinary) ; repli sur
              l'emoji de catégorie pendant le chargement et si aucune photo.
              Cliquable pour l'agrandir SEULEMENT si une photo OFF existe (offLarge). */}
          {variantes[0]?.id && (
            <div onClick={offLarge ? () => setAgrandi(true) : undefined}
              style={{ position:"relative", height:200, marginBottom:14, borderRadius:14, overflow:"hidden", background:"#F6F2E9", cursor: offLarge ? "pointer" : "default", WebkitTapHighlightColor:"transparent" }}>
              <PhotoProduit varianteId={variantes[0].id} taille="large" radius={14}
                fallback={<div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:64 }}>{categoryPresentation.emoji}</div>} />
              {offLarge && (
                <div style={{ position:"absolute", right:8, bottom:8, width:28, height:28, borderRadius:99, background:"rgba(0,0,0,0.45)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, pointerEvents:"none" }}>⤢</div>
              )}
            </div>
          )}

          {alreadyInList && !submitting && (
            <div style={{ background:"#F0FFF5", border:`1.5px solid ${C.green}`, borderRadius:12, padding:"10px 12px", marginBottom:14, fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:700, color:C.green }}>
              ✓ Déjà dans ta liste
            </div>
          )}

          {variantesLoading && (
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, marginBottom:14 }}>Chargement des formats…</div>
          )}

          {varianteError && !variantesLoading && (
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:14 }}>
              <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red }}>⚠️ {varianteError}</span>
              <button onClick={loadVariantes} style={{ background:"none", border:"none", color:C.blue, fontWeight:700, cursor:"pointer", fontSize:13, textDecoration:"underline" }}>Réessayer</button>
            </div>
          )}

          {!variantesLoading && !varianteError && variantes.length === 0 && (
            <div style={{ marginBottom:14 }}>
              <span style={{ display:"inline-block", padding:"9px 16px", background:C.green, borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.white }}>
                ✓ Format indifférent
              </span>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.gray, marginTop:6 }}>
                Aucun autre format référencé
              </div>
            </div>
          )}

          {!variantesLoading && !varianteError && variantes.length > 0 && (
            <>
              {/* Chantier 84 — Temps 1 : préférence marque de CET article
                  (écrite sur la ligne à la validation). Défaut Marques Nationales,
                  ou Marque Distributeur auto si le produit n'existe qu'en MDD. */}
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Préférence marque</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom: basculeAutoMdd ? 6 : 14 }}>
                <button onClick={()=>choisirSegment('nationale')} style={pillStyle(segmentMarque==='nationale')}>
                  Marques nationales
                </button>
                <button onClick={()=>choisirSegment('mdd')} style={pillStyle(segmentMarque==='mdd')}>
                  Marque Distributeur
                </button>
              </div>
              {basculeAutoMdd && (
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.orange, fontWeight:700, marginBottom:14 }}>
                  Ce produit n'existe qu'en Marque Distributeur.
                </div>
              )}

              {/* Temps 2 — en nationale : liste des MARQUES NATIONALES (jamais
                  un nom de MDD) + "Toutes les marques". En MDD : état générique,
                  aucune sous-marque affichée. */}
              {segmentMarque === 'nationale' && marquesListe.length > 0 && (
                <>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Marque</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
                    <button onClick={()=>setMarqueSelectionnee('all')} style={pillStyle(marqueSelectionnee==='all')}>
                      Toutes les marques
                    </button>
                    {marquesListe.map(m => (
                      <button key={m.id} onClick={()=>setMarqueSelectionnee(m.id)} style={pillStyle(marqueSelectionnee===m.id)}>
                        {m.nom}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {/* Chantier 84 — plus de bulle « Marque distributeur (MDD) » : le
                  bouton Temps 1 « Marque Distributeur » suffit (redondant). */}

              {/* Chantier 74 — Format, construit uniquement à partir des champs structurés */}
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Format</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
                <button onClick={()=>setFormatSelectionne('all')} style={pillStyle(formatSelectionne==='all')}>
                  Tous les formats
                </button>
                {formatsListe.map(label => (
                  <button key={label} onClick={()=>setFormatSelectionne(label)} style={pillStyle(formatSelectionne===label)}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Chantier 92 Lot 6 — favori du FORMAT résolu (Core favoris).
                  Visible seulement quand le couple (marque, format) désigne
                  exactement une variante. Best effort, jamais bloquant. */}
              {varianteResolueId && favoriEtat.statut !== 'inconnu' && (
                <div style={{ marginBottom:14 }}>
                  <button onClick={basculerFavori} disabled={favoriEtat.statut === 'travail'}
                    style={{ width:"100%", padding:"11px 14px", borderRadius:12, border:`2px solid ${favoriEtat.statut === 'favori' ? "#E5181B" : C.grayLight}`, background: favoriEtat.statut === 'favori' ? "#FFF0F0" : C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color: favoriEtat.statut === 'favori' ? "#E5181B" : C.textLight, cursor: favoriEtat.statut === 'travail' ? "default" : "pointer" }}>
                    {favoriEtat.statut === 'travail' ? "⏳ …"
                      : favoriEtat.statut === 'favori' ? "❤️ Ce format est en favori — retirer"
                      : "🤍 Mettre ce format en favori"}
                  </button>
                  {favoriMsg && (
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.orange, fontWeight:700, marginTop:5 }}>{favoriMsg}</div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Quantité */}
          <div style={{ display:"flex", alignItems:"center", background:C.grayLight, borderRadius:12, padding:"10px 16px", marginBottom:14 }}>
            <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, flex:1 }}>Quantité</span>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{ width:32, height:32, borderRadius:99, border:"2px solid #CC0000", background:C.white, cursor:"pointer", color:"#CC0000", fontWeight:900, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
              <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:"#CC0000", minWidth:24, textAlign:"center" }}>{qty}</span>
              <button onClick={()=>setQty(q=>q+1)} style={{ width:32, height:32, borderRadius:99, border:"none", background:"#CC0000", cursor:"pointer", color:C.white, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
            </div>
          </div>

          {submitError && (
            <div style={{ color:C.red, fontSize:13, fontFamily:"'Nunito',sans-serif", fontWeight:700, marginBottom:8 }}>⚠️ {submitError}</div>
          )}

          <button onClick={submit} disabled={!canSubmit} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:canSubmit?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:canSubmit?"#111111":C.gray, cursor:canSubmit?"pointer":"default", boxShadow:canSubmit?"0 6px 16px rgba(200,160,0,0.4)":"none" }}>
            + Ajouter à ma liste
          </button>
        </div>
      </div>
    </div>
  );
}


// Chantier « Catalogue épuré » — contenu déplié d'une famille : liste scrollable
// groupée par SORTE (sous_famille), puis par MARQUE (repliée, triée du meilleur
// €/kg au pire), qui se déplie sur ses FORMATS (triés du meilleur €/kg au pire).
// Le €/kg vient des relevés (prix_comparables) : min prix relevé par format,
// converti au kilo/litre via calculerPrixReferenceParUnite (robuste aux unités).
// Aucune valeur en dur ; une seule marque ouverte à la fois.
// modeRayon (Chantier 84) : réutilise CE composant pour un RAYON entier (sous-
// catégorie), pas seulement une famille de recherche. Différences UNIQUEMENT
// quand modeRayon=true (la recherche reste strictement inchangée) : les fiches
// SANS relevé restent visibles en repli, et une sous_famille nulle regroupe par
// produit (pas un gros « Autres »). onOpenProduct ouvre la modale (fiches repli).
function FamilleDepliee({ membres, items, onAdd, onUpdate, onRemove, modeRayon = false, onOpenProduct }) {
  const [prix,       setPrix]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [openMarque, setOpenMarque] = useState(null);   // clé "sorte||marque" (une seule ouverte)
  const [maintenant] = useState(() => Date.now());       // instant figé au montage (fraîcheur, pur au rendu)
  const [lightbox,   setLightbox]   = useState(null);    // Chantier 85 — URL OFF de l'agrandi, ou null

  const produitIds = useMemo(() => membres.map(m => m.id), [membres]);
  const sousFamilleParProduit = useMemo(() => {
    const m = new Map();
    membres.forEach(p => m.set(p.id, (p.sous_famille || '').trim()));   // brute (peut être vide)
    return m;
  }, [membres]);
  const nomRefParProduit = useMemo(() => {
    const m = new Map();
    membres.forEach(p => m.set(p.id, p.nom_reference || 'Produit'));
    return m;
  }, [membres]);
  // Clé de SORTE : sous_famille si présente ; sinon 'Autres' (recherche) OU le
  // nom du produit en mode rayon (une entrée par fiche sur les rayons hétérogènes).
  const sorteDe = useCallback((produitId) => {
    const sf = sousFamilleParProduit.get(produitId);
    if (sf) return sf;
    return modeRayon ? (nomRefParProduit.get(produitId) || 'Autres') : 'Autres';
  }, [sousFamilleParProduit, nomRefParProduit, modeRayon]);

  // Monté à neuf à chaque ouverture de famille (état initial loading=true) : pas
  // de setState synchrone ici, uniquement le chargement asynchrone.
  useEffect(() => {
    let cancelled = false;
    chargerPrixComparables(produitIds, {})
      .then(rows => { if (!cancelled) { setPrix(rows || []); setLoading(false); } })
      .catch(e => { if (!cancelled) { console.error('Erreur chargement prix famille :', e); setError("Impossible de charger les prix."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [produitIds]);

  // Arbre sorte -> marque -> formats. Par format (variante) : min/max €/kg,
  // min/max prix du paquet (sur TOUS les magasins, pas de filtre zone), et la
  // date du relevé LE PLUS ANCIEN composant la fourchette (décision : la
  // fourchette ne vaut que par sa donnée la plus périmée).
  const arbre = useMemo(() => {
    const parFormat = new Map();
    for (const row of prix) {
      if (!row.variante_produit_id) continue;
      const ref = calculerPrixReferenceParUnite({
        prix_total:     row.prix_total,
        quantite_nette: row.quantite_nette,
        unite_quantite: row.unite_quantite,
        nombre_unites:  row.nombre_unites,
      });
      if (!ref) continue; // pas de €/kg (pièce, unité inconnue, donnée manquante) -> exclu
      const paq = Number(row.prix_total);
      const dateMs = row.observe_le ? new Date(row.observe_le).getTime() : null;
      const e = parFormat.get(row.variante_produit_id);
      if (!e) {
        parFormat.set(row.variante_produit_id, {
          varianteId: row.variante_produit_id, produitId: row.produit_id,
          nomProduit: row.nom_produit, estMdd: !!row.est_mdd,
          // Masquage MDD (AFFICHAGE seul) : toutes les variantes est_mdd=true sont
          // regroupées sous une marque virtuelle unique « Marques distributeurs »
          // (fusion, pas renommage). La vraie marque en base reste intacte.
          marqueNom: row.est_mdd ? 'Marques distributeurs'
            : ((row.nom_marque && row.nom_marque.trim()) ? row.nom_marque.trim() : 'Sans marque'),
          // Signature de format (quantité + unité + conditionnement) pour fusionner
          // les formats identiques de MDD différentes une fois le groupe déplié.
          sig: `${row.quantite_nette}|${(row.unite_quantite || '').toLowerCase().trim()}|${Number(row.nombre_unites) || 1}`,
          label: formatFormatStructure(row) || row.libelle_variante || 'Format',
          uniteRef: ref.unite,
          kgMin: ref.valeur, kgMax: ref.valeur, paqMin: paq, paqMax: paq, dateAncienne: dateMs,
        });
      } else {
        if (ref.valeur < e.kgMin) e.kgMin = ref.valeur;
        if (ref.valeur > e.kgMax) e.kgMax = ref.valeur;
        if (paq < e.paqMin) e.paqMin = paq;
        if (paq > e.paqMax) e.paqMax = paq;
        if (dateMs != null && (e.dateAncienne == null || dateMs < e.dateAncienne)) e.dateAncienne = dateMs;
      }
    }

    const tousFormats = [...parFormat.values()];
    const produitsAvecPrix = new Set(tousFormats.map(f => f.produitId));

    // Fiches SANS relevé (mode rayon) : gardées visibles en repli, jamais masquées.
    const sansPrix = modeRayon ? membres.filter(m => !produitsAvecPrix.has(m.id)) : [];

    // Fusion MDD par signature de format (plusieurs MDD au même quantité+unité ->
    // une seule ligne « Marques distributeurs »).
    const fusionnerMdd = (fmts) => {
      const parSig = new Map();
      for (const f of fmts) {
        const e = parSig.get(f.sig);
        if (!e) { parSig.set(f.sig, { ...f, mddMerged: true }); }
        else {
          e.kgMin = Math.min(e.kgMin, f.kgMin);
          e.kgMax = Math.max(e.kgMax, f.kgMax);
          e.paqMin = Math.min(e.paqMin, f.paqMin);
          e.paqMax = Math.max(e.paqMax, f.paqMax);
          if (f.dateAncienne != null && (e.dateAncienne == null || f.dateAncienne < e.dateAncienne)) e.dateAncienne = f.dateAncienne;
        }
      }
      return [...parSig.values()];
    };
    const stats = (formats) => ({
      best:  formats[0]?.kgMin ?? Infinity,
      kgMin: Math.min(...formats.map(f => f.kgMin)),
      kgMax: Math.max(...formats.map(f => f.kgMax)),
      uniteRef: formats[0]?.uniteRef || 'kg',
    });
    const ordreCle = (a, b) => (a === 'Autres') - (b === 'Autres') || a.localeCompare(b, 'fr');

    // ── Arbre sorte (sous_famille) -> marque -> formats. Marques et formats triés
    // du moins cher au plus cher, MDD regroupés sous « Marques distributeurs ».
    // L'ordre des VARIÉTÉS (sortes) reste stable (ordreCle), sans tri par prix.
    const sortesMarques = new Map();
    for (const f of tousFormats) {
      const sorte = sorteDe(f.produitId);
      if (!sortesMarques.has(sorte)) sortesMarques.set(sorte, new Map());
      const marques = sortesMarques.get(sorte);
      if (!marques.has(f.marqueNom)) marques.set(f.marqueNom, []);
      marques.get(f.marqueNom).push(f);
    }
    const sansPrixParSorte = new Map();
    for (const m of sansPrix) {
      const sorte = sorteDe(m.id);
      if (!sansPrixParSorte.has(sorte)) sansPrixParSorte.set(sorte, []);
      sansPrixParSorte.get(sorte).push(m);
    }
    const buildMarques = (marques) => [...marques.entries()].map(([nom, fmts]) => {
      const formats = (nom === 'Marques distributeurs' ? fusionnerMdd(fmts) : fmts.slice()).sort((a, b) => a.kgMin - b.kgMin);
      return { nom, formats, ...stats(formats) };
    }).sort((a, b) => a.best - b.best);
    const toutesSortes = new Set([...sortesMarques.keys(), ...sansPrixParSorte.keys()]);
    return [...toutesSortes].sort(ordreCle).map(sorte => ({
      sorte,
      marques: buildMarques(sortesMarques.get(sorte) || new Map()),
      sansPrix: sansPrixParSorte.get(sorte) || [],
    }));
  }, [prix, sorteDe, membres, modeRayon]);

  const fmtEur = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Fourchette : une seule valeur si min == max (au centime), sinon "lo – hi".
  const rng = (lo, hi) => (Math.round(lo * 100) === Math.round(hi * 100)) ? fmtEur(lo) : `${fmtEur(lo)} – ${fmtEur(hi)}`;
  const labelUnite = (u) => (u === 'L' ? '€/L' : '€/kg');
  const fraicheur = (dateMs) => {
    if (dateMs == null) return null;
    const jours = Math.max(0, Math.floor((maintenant - dateMs) / 86400000));
    if (jours <= 14) {
      const t = jours === 0 ? "Relevé aujourd'hui" : jours === 1 ? 'Relevé hier' : `Relevé il y a ${jours} j`;
      return { texte: t, type: 'fresh' };
    }
    return { texte: `Relevé il y a ${Math.round(jours / 7)} sem.`, type: 'stale' };
  };

  // Compteur relié à la liste de courses (colonne quantite). Quantité lue depuis
  // `items`. 0->1 = ajout, +/- = update, retour à 0 = suppression de l'article.
  const itemDeFormat = (f) => items.find(i => i.produit_id === f.produitId && i.variante_produit_id === f.varianteId);
  const changerQty = async (f, delta) => {
    const it = itemDeFormat(f);
    const cur = it?.qty ?? 0;
    const next = cur + delta;
    if (next <= 0) { if (it) await onRemove(it.id); return; }
    if (!it) {
      await onAdd({ product: f.nomProduit, format: '', brand: '', qty: 1, checked: false,
        produit_id: f.produitId, variante_produit_id: f.varianteId, marque_pref: f.estMdd ? 'mdd' : 'nationale' });
      return;
    }
    await onUpdate({ ...it, qty: next });
  };

  // Palette de la maquette (distincte de C : cet écran suit la maquette).
  const M = {
    card:'#FFFFFF', ink:'#16191D', ink2:'#5C646E', ink3:'#98A0A9', line:'#E6E9EC',
    green:'#12854B', greenSoft:'#E7F5ED', amber:'#F5C13B', amberDeep:'#B8860B',
    amberSoft:'#FFF4E0', brand:'#9B1C1C', brandSoft:'#FBEDED', thumb:'#F6F2E9', chip:'#F1F3F5',
  };
  const F = "'Nunito',sans-serif";
  const badgeStyle = (kind) => {
    const base = { fontFamily:F, fontSize:10.5, fontWeight:700, padding:'3px 7px', borderRadius:6, letterSpacing:'.2px' };
    if (kind === 'best')  return { ...base, background:M.green, color:'#fff' };
    if (kind === 'fresh') return { ...base, background:M.greenSoft, color:M.green };
    if (kind === 'stale') return { ...base, background:M.amberSoft, color:M.amberDeep };
    if (kind === 'gap')   return { ...base, background:M.brandSoft, color:M.brand };
    return { ...base, background:M.chip, color:M.ink2 }; // gris (N× le meilleur prix)
  };
  // ══════════════════════════════════════════════════════════════════════════
  // BLOCS DE PRÉSENTATION (standard visuel de l'app). Volontairement isolés et
  // nommés pour être EXTRAITS en composants réutilisables lors d'un chantier
  // ultérieur (Ma liste, recherche, historique, comparateur…). Ne rien
  // généraliser ici : ce sont des fonctions locales de rendu, appelées par le
  // return ci-dessous.
  // ══════════════════════════════════════════════════════════════════════════

  // BLOC — COMPTEUR de quantité (bouton jaune ＋ / pilule verte − n ＋).
  // MDD : désactivé tant que l'ajout du groupe n'est pas arbitré.
  const blocCompteur = (f, q, mdd) => {
    if (mdd) return (
      <button disabled aria-label="Ajout du groupe MDD à définir" title="Ajout à définir"
        style={{ width:44, height:44, borderRadius:"50%", border:"none", background:M.line, color:M.ink3, fontSize:22, fontWeight:700, cursor:"not-allowed", display:"grid", placeItems:"center", fontFamily:F, opacity:.7 }}>＋</button>
    );
    if (q === 0) return (
      <button onClick={()=>changerQty(f, +1)} aria-label="Ajouter à ma liste"
        style={{ width:44, height:44, borderRadius:"50%", border:"none", background:M.amber, color:"#4A3800", fontSize:22, fontWeight:700, cursor:"pointer", display:"grid", placeItems:"center", fontFamily:F }}>＋</button>
    );
    return (
      <div style={{ display:"flex", alignItems:"center", background:M.green, borderRadius:99, padding:3 }}>
        <button onClick={()=>changerQty(f, -1)} aria-label="Retirer un paquet" style={{ width:36, height:36, border:"none", background:"transparent", color:"#fff", fontSize:21, fontWeight:800, cursor:"pointer", borderRadius:"50%", display:"grid", placeItems:"center", fontFamily:F, lineHeight:1 }}>−</button>
        <span style={{ minWidth:24, textAlign:"center", color:"#fff", fontWeight:800, fontSize:16, fontFamily:F }}>{q}</span>
        <button onClick={()=>changerQty(f, +1)} aria-label="Ajouter un paquet" style={{ width:36, height:36, border:"none", background:"transparent", color:"#fff", fontSize:21, fontWeight:800, cursor:"pointer", borderRadius:"50%", display:"grid", placeItems:"center", fontFamily:F, lineHeight:1 }}>＋</button>
      </div>
    );
  };

  // BLOC — BADGES d'un format (Meilleur rapport / Gros écart / N× / fraîcheur).
  const blocBadges = (estBest, gap, ratio, fr) => (
    <div style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap" }}>
      {estBest && <span style={badgeStyle('best')}>Meilleur rapport</span>}
      {gap && <span style={badgeStyle('gap')}>Gros écart selon magasin</span>}
      {!estBest && ratio >= 2 && <span style={badgeStyle('gray')}>{ratio.toLocaleString('fr-FR', { minimumFractionDigits:1, maximumFractionDigits:1 })}× le meilleur prix</span>}
      {fr && <span style={badgeStyle(fr.type)}>{fr.texte}</span>}
    </div>
  );

  // BLOC — LIGNE DE FORMAT (vignette 42px + prix/fourchette + sous-ligne + badges + compteur).
  const blocLigneFormat = (f, idx, mq) => {
    const mdd = !!f.mddMerged;                             // groupe « Marques distributeurs »
    const q = mdd ? 0 : (itemDeFormat(f)?.qty ?? 0);
    const picked = !mdd && q > 0;
    const estBest = idx === 0 && mq.formats.length >= 2;   // le moins cher du groupe (si comparable)
    const gap = f.kgMax >= 1.4 * f.kgMin;
    const ratio = mq.best > 0 ? f.kgMin / mq.best : 1;
    const fr = fraicheur(f.dateAncienne);
    return (
      // BUG 2 (chantier 85) — fond vert PLEIN = « dans ma liste » (picked), identique
      // sur tous les formats de la liste. Le « Meilleur rapport » n'a plus de vert :
      // seulement son badge (via blocBadges).
      <div key={mdd ? f.sig : f.varianteId} style={{ display:"flex", alignItems:"center", gap:11, background: picked ? M.greenSoft : M.card, border:`${picked?'1.5px':'1px'} solid ${picked?M.green:M.line}`, borderRadius:14, padding:"13px 12px 13px 14px" }}>
        {/* Vignette 42px : photo produit (OFF+Cloudinary) si dispo, sinon le carré
            placeholder. Pas de photo pour le groupe MDD (ne pas trahir la marque).
            Chantier 85 — cliquable → agrandi partagé (LightboxPhoto). */}
        <div style={{ width:42, height:42, flex:"0 0 auto" }}>
          <PhotoProduit varianteId={mdd ? null : f.varianteId} taille="thumb" radius={9}
            onAgrandir={mdd ? null : (off)=>setLightbox(off)}
            fallback={<div style={{ width:"100%", height:"100%", borderRadius:9, background:M.thumb }} />} />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:F, fontWeight:800, fontSize:19, color:M.ink, letterSpacing:"-.3px" }}>
            {rng(f.kgMin, f.kgMax)} <span style={{ fontSize:13, fontWeight:700, color:M.ink2 }}>{labelUnite(f.uniteRef)}</span>
          </div>
          <div style={{ fontFamily:F, fontSize:12.5, color:M.ink2, marginTop:2, lineHeight:1.35 }}>
            {!mdd && `${f.nomProduit} · `}{f.label} · le paquet {rng(f.paqMin, f.paqMax)} €
          </div>
          {blocBadges(estBest, gap, ratio, fr)}
        </div>
        <div style={{ flex:"0 0 auto" }}>{blocCompteur(f, q, mdd)}</div>
      </div>
    );
  };

  // BLOC — LIGNE DE MARQUE repliable (nom + fourchette €/kg + chevron).
  const blocLigneMarque = (mq, cle, ouvert) => (
    <button onClick={()=>setOpenMarque(ouvert ? null : cle)}
      style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:M.card, border:`${ouvert?'1.5px':'1px'} solid ${ouvert?M.brand:M.line}`, borderRadius:14, padding:"15px 16px", cursor:"pointer", textAlign:"left" }}>
      <span style={{ fontFamily:F, fontWeight:800, fontSize:16, color:M.ink }}>{mq.nom}</span>
      <span style={{ display:"flex", alignItems:"center", gap:8, fontFamily:F, fontWeight:700, fontSize:14, color:M.green }}>
        {rng(mq.kgMin, mq.kgMax)} {labelUnite(mq.uniteRef)}
        <span style={{ color:M.ink3, fontSize:12, transform: ouvert?"rotate(90deg)":"none", transition:"transform .15s" }}>›</span>
      </span>
    </button>
  );

  // BLOC — FICHE SANS PRIX (mode rayon) : reste visible, « pas encore de prix ».
  // Tap → ouvre la modale format pour l'ajouter (rebascule au comparateur dès
  // qu'un relevé existe). Jamais masquée.
  const blocLigneSansPrix = (m) => {
    const inList = items.some(i => i.produit_id === m.id);
    return (
      <button key={`sp-${m.id}`} onClick={()=>onOpenProduct?.(m)}
        style={{ display:"flex", alignItems:"center", gap:11, width:"100%", textAlign:"left", background:M.card, border:`1px solid ${inList?M.green:M.line}`, borderRadius:14, padding:"13px 12px 13px 14px", cursor:"pointer" }}>
        <div style={{ width:42, height:42, flex:"0 0 auto", borderRadius:9, background:M.thumb }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:F, fontWeight:800, fontSize:15, color:M.ink }}>{m.nom_reference}</div>
          <div style={{ fontFamily:F, fontSize:12.5, color:M.ink3, marginTop:2 }}>{inList ? "✓ dans ta liste · " : ""}Pas encore de prix</div>
        </div>
        <span style={{ fontFamily:F, fontSize:20, color:M.ink3, flex:"0 0 auto" }}>›</span>
      </button>
    );
  };

  // ── Assemblage : intertitre de SORTE → lignes de marque → lignes de format ──
  return (
    <div style={{ paddingLeft:14, borderLeft:`2px solid ${M.line}`, marginLeft:6, display:"flex", flexDirection:"column", gap:14 }}>
      {lightbox && <LightboxPhoto offLarge={lightbox} onClose={()=>setLightbox(null)} />}
      <div style={{ fontFamily:F, fontSize:12.5, color:M.ink2, fontStyle:"italic", lineHeight:1.45 }}>Prix au kilo relevés en magasin par la communauté. Ils varient d'une enseigne à l'autre — vérifie en rayon.</div>

      {loading && <div style={{ fontFamily:F, fontSize:13, color:M.ink3 }}>Chargement des prix…</div>}
      {error && !loading && <div style={{ fontFamily:F, fontSize:13, color:M.brand, fontWeight:700 }}>⚠️ {error}</div>}
      {!loading && !error && arbre.length === 0 && (
        <div style={{ fontFamily:F, fontSize:13, color:M.ink3 }}>Pas encore de relevé de prix pour cette famille.</div>
      )}

      {!loading && !error && arbre.map(({ sorte, marques, sansPrix }) => (
        <div key={sorte} style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ fontFamily:F, fontWeight:800, fontSize:17, color:M.ink }}>
            {sorte}{marques.length > 0 && <span style={{ fontSize:13, fontWeight:600, color:M.ink3 }}> · {marques.length} marque{marques.length>1?'s':''}</span>}
          </div>

          {marques.map(mq => {
            const cle = `${sorte}||${mq.nom}`;
            const ouvert = openMarque === cle;
            return (
              <div key={cle} style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {blocLigneMarque(mq, cle, ouvert)}
                {ouvert && (
                  <div style={{ display:"flex", flexDirection:"column", gap:7, paddingLeft:12 }}>
                    {mq.formats.map((f, idx) => blocLigneFormat(f, idx, mq))}
                  </div>
                )}
              </div>
            );
          })}

          {sansPrix.map(m => blocLigneSansPrix(m))}
        </div>
      ))}
    </div>
  );
}

function CatalogTab({ items, onAdd, onUpdate, onRemove, setTab }) {
  const [categories,      setCategories]      = useState([]);
  const [catLoading,      setCatLoading]      = useState(true);
  const [catError,        setCatError]        = useState(null);
  const [categoryCounts,  setCategoryCounts]  = useState({});

  const [selectedCat,     setSelectedCat]     = useState(null);
  const [sousCategories,  setSousCategories]  = useState([]);
  const [scLoading,       setScLoading]       = useState(false);
  const [scError,         setScError]         = useState(null);

  const [selectedSousCat, setSelectedSousCat] = useState(null);
  const [produits,        setProduits]        = useState([]);
  const [prodLoading,     setProdLoading]     = useState(false);
  const [prodError,       setProdError]       = useState(null);

  const [openProduct,     setOpenProduct]     = useState(null);
  const [searchQuery,     setSearchQuery]     = useState("");
  const [searchResults,   setSearchResults]   = useState([]);
  const [searching,       setSearching]       = useState(false);
  const [searchError,     setSearchError]     = useState(null);
  // Chantier « famille » — familles dépliées dans les RAYONS (chantier 86).
  const [openFamilles,    setOpenFamilles]    = useState(new Set());
  // Chantier 88 (suite) — fiches dépliées dans les résultats de RECHERCHE (à plat).
  const [openFiches,      setOpenFiches]      = useState(new Set());
  const searchSeq = useRef(0);

  const toggleFamille = (fam) => setOpenFamilles(prev => {
    const next = new Set(prev);
    next.has(fam) ? next.delete(fam) : next.add(fam);
    return next;
  });
  const toggleFiche = (id) => setOpenFiches(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Chantier 88 (suite) — Recherche À PLAT (façon drive) : plus AUCUN regroupement
  // par famille en recherche. Chaque fiche renvoyée est une carte individuelle,
  // dépliable sur son propre comparateur (marques/formats/prix). Le regroupement
  // famille → sous-famille (FamilleDepliee sur plusieurs membres) reste réservé à
  // la navigation par RAYONS (entreesRayon / modeRayon, chantier 86, inchangé).
  // On mémoïse un tableau [fiche] STABLE par id : FamilleDepliee dérive ses
  // produitIds de `membres`, donc un nouveau tableau à chaque rendu relancerait le
  // chargement des prix en boucle.
  const membresParFiche = useMemo(() => {
    const m = new Map();
    for (const r of searchResults) m.set(r.id, [r]);
    return m;
  }, [searchResults]);

  // Chantier 86 — RAYON (niveau 3) : parent « famille » comme la recherche.
  // Entrées ORDONNÉES (tri nom_reference conservé) : un bloc « famille » prend la
  // position de sa 1re fiche ; les fiches SANS famille forment des « runs »
  // contigus rendus par un FamilleDepliee à plat. Générique (aucune famille en
  // dur). Mémoïsé sur `produits` : les tableaux `membres` restent STABLES, sinon
  // chaque FamilleDepliee rechargerait ses prix à chaque rendu.
  const entreesRayon = useMemo(() => {
    const entrees = [];
    const idxFamille = new Map();
    let flatRun = null;
    for (const p of produits) {
      const fam = (p.famille || '').trim();
      if (fam) {
        flatRun = null; // coupe le run de fiches sans famille
        if (idxFamille.has(fam)) entrees[idxFamille.get(fam)].membres.push(p);
        else { idxFamille.set(fam, entrees.length); entrees.push({ type: 'famille', famille: fam, membres: [p] }); }
      } else {
        if (!flatRun) { flatRun = { type: 'flat', membres: [] }; entrees.push(flatRun); }
        flatRun.membres.push(p);
      }
    }
    return entrees;
  }, [produits]);

  const totalInList = items.filter(i=>!i.checked).length;

  // Propage le booléen de succès/échec d'App.addItem jusqu'à ProductPickerSheet.
  const addItem = item => { return onAdd(item); };

  // Une seule requête légère (pas une par catégorie) : les catégories visibles,
  // et un comptage local des produits actifs par categorie_id pour les badges.
  const loadCategories = useCallback(async () => {
    setCatLoading(true);
    setCatError(null);
    try {
      const [catsRes, prodsRes] = await Promise.all([
        supabase.from('categories').select('id, nom, slug, icone, ordre_affichage').eq('visible', true).order('ordre_affichage'),
        supabase.from('produits').select('id, sous_categories!inner(categorie_id)').eq('actif', true).eq('sous_categories.actif', true),
      ]);
      if (catsRes.error) { setCatError("Impossible de charger les catégories."); return; }
      setCategories(catsRes.data || []);
      if (prodsRes.error) {
        console.error("Erreur chargement compteurs catégories :", prodsRes.error);
        setCategoryCounts({});
        return;
      }
      const counts = {};
      (prodsRes.data || []).forEach(p => {
        const catId = p.sous_categories?.categorie_id;
        if (catId) counts[catId] = (counts[catId] || 0) + 1;
      });
      setCategoryCounts(counts);
    } catch (e) {
      console.error("Erreur chargement catégories :", e);
      setCatError("Impossible de charger les catégories.");
    } finally {
      setCatLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const selectCategory = (cat) => {
    setSelectedCat(cat);
    setSousCategories([]); setSelectedSousCat(null); setProduits([]); setOpenProduct(null);
    setScLoading(true); setScError(null);
    supabase.from('sous_categories')
      .select('id, categorie_id, nom, slug, ordre_affichage')
      .eq('categorie_id', cat.id)
      .eq('actif', true)
      .order('ordre_affichage')
      .then(({ data, error }) => {
        if (error) { setScError("Impossible de charger les sous-catégories."); setScLoading(false); return; }
        setSousCategories(data || []);
        setScLoading(false);
      });
  };

  const selectSousCat = (sc) => {
    setSelectedSousCat(sc);
    setProduits([]); setOpenProduct(null);
    setProdLoading(true); setProdError(null);
    supabase.from('produits')
      .select('id, sous_categorie_id, nom_reference, slug, type_unite, unite_base, famille, sous_famille')
      .eq('sous_categorie_id', sc.id)
      .eq('actif', true)
      .order('nom_reference')
      .then(({ data, error }) => {
        if (error) { setProdError("Impossible de charger les produits."); setProdLoading(false); return; }
        setProduits(data || []);
        setProdLoading(false);
      });
  };

  const backToCategories = () => {
    setSelectedCat(null); setSousCategories([]); setSelectedSousCat(null); setProduits([]); setOpenProduct(null);
  };
  const backToSousCategories = () => {
    setSelectedSousCat(null); setProduits([]); setOpenProduct(null);
  };

  // Recherche Core sur produits.nom_reference : debounce ~280ms, protection anti-désordre.
  const runSearch = useCallback(async (q) => {
    const mySeq = ++searchSeq.current;
    setSearching(true);
    setSearchError(null);
    try {
      // Chantier 87 — RPC DÉDIÉ au catalogue : chaque mot doit apparaître dans
      // nom_reference + famille + sous_famille (extensions.unaccent, multi-mots),
      // limite 100. Distinct de rechercher_produits_pour_correction (tickets), qui
      // reste inchangé. Le RPC ne renvoie que produit_id + nom_reference : on
      // recharge ensuite les colonnes complètes (catégorie/sous-catégorie) pour
      // garder la forme attendue par l'affichage et la navigation.
      const COLS = 'id, nom_reference, famille, sous_famille, sous_categorie_id, sous_categories(id, nom, categorie_id, categories(id, nom, slug, icone))';
      const { data: matches, error: errRpc } = await supabase
        .rpc('rechercher_produits_catalogue', { p_terme: q });
      if (mySeq !== searchSeq.current) return; // réponse obsolète, ignorée
      if (errRpc) { setSearchError("Recherche impossible."); setSearching(false); return; }
      const ids = (matches || []).map(m => m.produit_id);
      if (ids.length === 0) { setSearchResults([]); setSearching(false); return; }
      const { data, error } = await supabase.from('produits').select(COLS).in('id', ids);
      if (mySeq !== searchSeq.current) return;
      if (error) { setSearchError("Recherche impossible."); setSearching(false); return; }
      // Chantier 88 — Recherche PRÉCISE puis À PLAT (logique drive) : on n'affiche
      // QUE les fiches réellement renvoyées par le RPC pour le terme tapé (nom /
      // famille / sous-famille qui matchent). On ne recharge PLUS toute la famille
      // (comportement du chantier 87, désormais réservé aux RAYONS — modeRayon /
      // entreesRayon, inchangé). L'affichage des résultats est une LISTE À PLAT :
      // une carte par fiche, dépliable sur son propre comparateur (voir le rendu,
      // membresParFiche). Aucun regroupement de famille en recherche.
      // Ex. « penne » ne remonte que les penne ; « pâtes » (nom de famille) remonte
      // toutes les fiches de famille « Pâtes » car elles matchent le terme.
      const parId = new Map((data || []).map(p => [p.id, p]));
      setSearchResults(ids.map(id => parId.get(id)).filter(Boolean)); // ordre de pertinence du RPC
      setSearching(false);
    } catch (e) {
      if (mySeq !== searchSeq.current) return;
      console.error("Erreur recherche produits :", e);
      setSearchError("Recherche impossible.");
      setSearching(false);
    }
  }, []);

  // Aucun setState synchrone dans le corps de l'effet : uniquement l'armement du timer.
  useEffect(() => {
    if (searchQuery.trim().length < 2) return;
    const timer = setTimeout(() => runSearch(searchQuery.trim()), 280);
    return () => clearTimeout(timer);
  }, [searchQuery, runSearch]);

  return (
    <div style={{ padding:"16px 16px 110px" }}>

      {/* Titre */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.text, letterSpacing:"-0.5px" }}>
          Catalogue <span style={{ color:"#CC0000" }}>🛍️</span>
        </div>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, marginTop:2 }}>
          Parcours les rayons et ajoute tes produits
        </div>
      </div>

      {/* Barre de recherche */}
      <input value={searchQuery} onChange={e=>{
          const val = e.target.value;
          setSearchQuery(val);
          if (val.trim().length < 2) {
            searchSeq.current++; // invalide toute requête en cours
            setSearchResults([]);
            setSearchError(null);
            setSearching(false);
          }
        }} placeholder="🔍 Chercher un produit..."
        style={{ width:"100%", padding:"12px 16px", borderRadius:12, border:`2px solid ${searchQuery?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:16 }} />

      {/* Résultats de recherche */}
      {searching && (
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, marginBottom:16 }}>Recherche…</div>
      )}
      {searchError && !searching && (
        <div style={{ background:"#FEE", borderRadius:12, padding:"12px 14px", marginBottom:16, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red, fontWeight:700 }}>⚠️ {searchError}</span>
          <button onClick={()=>runSearch(searchQuery.trim())} style={{ background:"none", border:"none", color:C.blue, fontWeight:700, cursor:"pointer", fontSize:13, textDecoration:"underline" }}>Réessayer</button>
        </div>
      )}
      {!searching && !searchError && searchResults.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
          {/* Chantier 88 (suite) — Recherche À PLAT : une carte par fiche renvoyée
              (aucun accordéon de famille). La carte se déplie sur son PROPRE
              comparateur (FamilleDepliee sur cette seule fiche) : marques
              regroupées (MDD fusionnées) et formats du moins cher au plus cher. */}
          {searchResults.map((r) => {
            const pres = getCategoryPresentation(r.sous_categories?.categories || {});
            const ouvert = openFiches.has(r.id);
            // Chantier 88 (suite 2) — libellé = RAYON (sous-catégorie), plus proche
            // d'un drive que la grande catégorie. Repli sur la catégorie de niveau 1
            // si la sous-catégorie manque, sinon rien (jamais de plantage).
            const rayon = r.sous_categories?.nom || r.sous_categories?.categories?.nom || null;
            return (
              <div key={r.id} style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <button onClick={()=>toggleFiche(r.id)}
                  style={{ display:"flex", alignItems:"center", gap:12, background:C.white, border:`1px solid ${ouvert?C.blue:C.grayLight}`, borderRadius:12, padding:"12px 14px", cursor:"pointer", textAlign:"left", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                  <span style={{ fontSize:22 }}>{pres.emoji}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{r.nom_reference}</div>
                    {rayon && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:pres.color, fontWeight:700, marginTop:2 }}>{rayon}</div>}
                  </div>
                  <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:16, color:C.gray, transform: ouvert?"rotate(90deg)":"none", transition:"transform 0.15s" }}>›</span>
                </button>
                {ouvert && <FamilleDepliee membres={membresParFiche.get(r.id) || [r]} items={items} onAdd={addItem} onUpdate={onUpdate} onRemove={onRemove} />}
              </div>
            );
          })}
        </div>
      )}
      {!searching && !searchError && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
        <div style={{ background:C.grayLight, borderRadius:12, padding:"16px", textAlign:"center", marginBottom:16 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray }}>Aucun produit trouvé pour « {searchQuery} »</div>
        </div>
      )}

      {/* Barre du bas (maquette) — bloc résumé sobre, PAS un bouton d'action :
          « Ma liste » + N articles + chevron. Au clic : ouvre l'onglet Ma liste.
          Pas de fourchette totale, pas de jauge, pas d'écart en euros. */}
      {totalInList>0 && (
        <button onClick={()=>setTab("list")} style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
          background:"#FFFFFF", border:"1px solid #E6E9EC", borderRadius:14,
          padding:"12px 14px", marginBottom:20, cursor:"pointer", textAlign:"left",
        }}>
          <span style={{ display:"flex", flexDirection:"column", gap:1 }}>
            <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:15, color:"#16191D" }}>Ma liste</span>
            <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:600, fontSize:12.5, color:"#5C646E" }}>{totalInList} article{totalInList>1?"s":""}</span>
          </span>
          <span style={{ color:"#98A0A9", fontSize:19, fontWeight:700 }}>›</span>
        </button>
      )}

      {/* Niveau 1 : Catégories */}
      {!selectedCat && (
        <>
          {catLoading && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, textAlign:"center", padding:"20px 0" }}>Chargement…</div>}
          {catError && !catLoading && (
            <div style={{ background:"#FEE", borderRadius:12, padding:"16px", textAlign:"center", marginBottom:16 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red, fontWeight:700, marginBottom:8 }}>⚠️ {catError}</div>
              <button onClick={loadCategories} style={{ background:"none", border:"none", color:C.blue, fontWeight:700, cursor:"pointer", textDecoration:"underline" }}>Réessayer</button>
            </div>
          )}
          {!catLoading && !catError && categories.length === 0 && (
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, textAlign:"center", padding:"20px 0" }}>Aucune catégorie disponible.</div>
          )}
          {!catLoading && !catError && categories.length > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {categories.map((cat,i) => {
                const pres = getCategoryPresentation(cat);
                const count = categoryCounts[cat.id] || 0;
                return (
                  <button key={cat.id} onClick={()=>selectCategory(cat)} style={{
                    padding:0, background:C.white,
                    border:`2px solid ${count>0?pres.color:C.grayLight}`,
                    borderRadius:20, cursor:"pointer", overflow:"hidden",
                    boxShadow: count>0 ? `0 6px 20px ${pres.color}40` : "0 2px 10px rgba(0,0,0,0.08)",
                    animation: `slideIn 0.3s ease ${i*0.05}s both`,
                    position:"relative",
                    aspectRatio:"1",
                  }}>
                    {/* Badge compteur */}
                    {count>0 && (
                      <div style={{ position:"absolute", top:10, right:10, width:24, height:24, borderRadius:99, background:pres.color, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:12, color:C.white, zIndex:2, boxShadow:"0 2px 6px rgba(0,0,0,0.2)" }}>
                        {count}
                      </div>
                    )}
                    {/* Fond dégradé plein + emoji géant */}
                    <div style={{
                      background:`linear-gradient(145deg, ${pres.color}22, ${pres.color}55)`,
                      width:"100%", height:"68%",
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>
                      <span style={{ fontSize:60, lineHeight:1, filter:"drop-shadow(0 4px 8px rgba(0,0,0,0.15))" }}>{pres.emoji}</span>
                    </div>
                    {/* Label en bas */}
                    <div style={{ padding:"8px 10px 10px", textAlign:"center", background:C.white }}>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.text, lineHeight:1.2 }}>{cat.nom}</div>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, color:pres.color, marginTop:2, fontWeight:700 }}>
                        {count} produit{count>1?"s":""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Niveau 2 : Sous-catégories */}
      {selectedCat && !selectedSousCat && (
        <div>
          <button onClick={backToCategories} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", marginBottom:16, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.gray }}>
            ← Catégories
          </button>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.text, marginBottom:14 }}>{selectedCat.nom}</div>
          {scLoading && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, textAlign:"center", padding:"20px 0" }}>Chargement…</div>}
          {scError && !scLoading && (
            <div style={{ background:"#FEE", borderRadius:12, padding:"16px", textAlign:"center" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red, fontWeight:700, marginBottom:8 }}>⚠️ {scError}</div>
              <button onClick={()=>selectCategory(selectedCat)} style={{ background:"none", border:"none", color:C.blue, fontWeight:700, cursor:"pointer", textDecoration:"underline" }}>Réessayer</button>
            </div>
          )}
          {!scLoading && !scError && sousCategories.length === 0 && (
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, textAlign:"center", padding:"20px 0" }}>Aucune sous-catégorie disponible.</div>
          )}
          {!scLoading && !scError && sousCategories.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {sousCategories.map(sc => (
                <button key={sc.id} onClick={()=>selectSousCat(sc)}
                  style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:C.white, border:`1px solid ${C.grayLight}`, borderRadius:12, padding:"14px 16px", cursor:"pointer", textAlign:"left", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                  <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{sc.nom}</span>
                  <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:C.gray }}>›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Niveau 3 : Produits */}
      {selectedSousCat && (
        <div>
          <button onClick={backToSousCategories} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", marginBottom:16, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.gray }}>
            ← {selectedCat?.nom}
          </button>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.text, marginBottom:14 }}>{selectedSousCat.nom}</div>
          {prodLoading && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, textAlign:"center", padding:"20px 0" }}>Chargement…</div>}
          {prodError && !prodLoading && (
            <div style={{ background:"#FEE", borderRadius:12, padding:"16px", textAlign:"center" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red, fontWeight:700, marginBottom:8 }}>⚠️ {prodError}</div>
              <button onClick={()=>selectSousCat(selectedSousCat)} style={{ background:"none", border:"none", color:C.blue, fontWeight:700, cursor:"pointer", textDecoration:"underline" }}>Réessayer</button>
            </div>
          )}
          {!prodLoading && !prodError && produits.length === 0 && (
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, textAlign:"center", padding:"20px 0" }}>Aucun produit disponible.</div>
          )}
          {/* Chantier 84 — le rayon affiche LE MÊME comparateur que la recherche
              (FamilleDepliee, mode rayon). Fiches sans relevé gardées en repli.
              Chantier 86 — niveau parent « famille » : les fiches avec une famille
              sont regroupées sous un accordéon (comme la recherche) ; les fiches
              sans famille restent à plat. Si aucune famille -> un seul FamilleDepliee. */}
          {!prodLoading && !prodError && produits.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {entreesRayon.map((e, i) => {
                if (e.type === 'flat') {
                  return (
                    <FamilleDepliee key={`flat-${i}`} membres={e.membres} items={items} onAdd={addItem}
                      onUpdate={onUpdate} onRemove={onRemove} modeRayon onOpenProduct={setOpenProduct} />
                  );
                }
                // Bloc parent « famille » — même rendu/interaction que l'accordéon
                // de la recherche (openFamilles/toggleFamille réutilisés).
                const ouvert = openFamilles.has(e.famille);
                const presFam = getCategoryPresentation(selectedCat || {});
                return (
                  <div key={`fam-${e.famille}`} style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    <button onClick={()=>toggleFamille(e.famille)}
                      style={{ display:"flex", alignItems:"center", gap:12, background:C.white, border:`1px solid ${ouvert?C.blue:C.grayLight}`, borderRadius:12, padding:"12px 14px", cursor:"pointer", textAlign:"left", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                      <span style={{ fontSize:22 }}>{presFam.emoji}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.text }}>{e.famille}</div>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:presFam.color, fontWeight:700, marginTop:2 }}>{ouvert ? "Masquer les variétés" : "Voir les variétés"}</div>
                      </div>
                      <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:16, color:C.gray, transform: ouvert?"rotate(90deg)":"none", transition:"transform 0.15s" }}>›</span>
                    </button>
                    {ouvert && (
                      <FamilleDepliee membres={e.membres} items={items} onAdd={addItem}
                        onUpdate={onUpdate} onRemove={onRemove} modeRayon onOpenProduct={setOpenProduct} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {openProduct && (
        <ProductPickerSheet
          produit={openProduct}
          categoryPresentation={getCategoryPresentation(selectedCat || {})}
          onClose={()=>setOpenProduct(null)}
          onAdd={addItem}
          items={items}
        />
      )}
    </div>
  );
}

// ── EDIT ITEM SHEET ───────────────────────────────────────────────────────────
function EditItemSheet({ item, onClose, onSave }) {
  const isCore = !!item.produit_id;

  // Branche article libre — comportement inchangé
  const [product,    setProduct]    = useState(item.product);
  const [format,     setFormat]     = useState(item.format);
  const [brand,      setBrand]      = useState(item.brand || "");
  const [brandFixed, setBrandFixed] = useState(!!item.brand);
  const [qty,        setQty]        = useState(item.qty);

  // Branche article Core — produit (modifiable via recherche) + sélecteur de variantes
  const [produitId,        setProduitId]        = useState(item.produit_id || null);
  const [produitNom,       setProduitNom]       = useState(item.product);
  const [changingProduct,  setChangingProduct]  = useState(false);
  const [searchQuery,      setSearchQuery]      = useState("");
  const [suggestions,      setSuggestions]      = useState([]);
  const [variantes,        setVariantes]        = useState([]);
  const [varianteId,       setVarianteId]       = useState(item.variante_produit_id || null);
  const [variantesLoading, setVariantesLoading] = useState(isCore);
  const [varianteError,    setVarianteError]    = useState(null);
  const [submitting,       setSubmitting]       = useState(false);
  const [submitError,      setSubmitError]      = useState(null);
  const variantSeq = useRef(0);
  const searchSeq  = useRef(0);

  // Protège tous les setState (succès, erreur, finally) contre une réponse
  // obsolète (garde par numéro de séquence).
  const loadVariantesFor = async (pid, preserveVarianteId) => {
    const mySeq = ++variantSeq.current;
    setVarianteError(null);
    setVariantesLoading(true);
    try {
      const data = await chargerVariantes(pid);
      if (mySeq !== variantSeq.current) return; // réponse obsolète, ignorée
      setVariantes(data);
      if (data.length === 0) {
        setVarianteId('any');
      } else if (preserveVarianteId && data.some(v => v.id === preserveVarianteId)) {
        setVarianteId(preserveVarianteId);
      } else {
        setVarianteId(null);
      }
    } catch (e) {
      if (mySeq !== variantSeq.current) return;
      console.error("Erreur chargement variantes :", e);
      setVariantes([]);
      setVarianteId(null); // jamais 'any' sur erreur : on ne sait pas si le produit a des variantes
      setVarianteError("Impossible de charger les formats.");
    } finally {
      if (mySeq === variantSeq.current) {
        setVariantesLoading(false);
      }
    }
  };

  useEffect(() => {
    if (isCore) loadVariantesFor(item.produit_id, item.variante_produit_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Protège tous les setState (succès, erreur résolue, exception) contre une
  // réponse obsolète, sur le même principe que loadVariantesFor.
  const searchProducts = async val => {
    if (val.length < 2) {
      searchSeq.current++; // invalide toute recherche en cours
      setSuggestions([]);
      return;
    }
    const mySeq = ++searchSeq.current;
    try {
      const { data, error } = await supabase
        .from('alias_produits')
        .select('libelle_alias, produit_id, produits(nom_reference)')
        .ilike('libelle_alias', `%${val}%`)
        .eq('statut', 'actif')
        .limit(8);
      if (mySeq !== searchSeq.current) return; // réponse obsolète, ignorée
      if (error) { console.error("Erreur recherche produits :", error); setSuggestions([]); return; }
      const seen = new Set();
      const deduped = (data || []).filter(r => {
        const key = r.produit_id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setSuggestions(deduped);
    } catch (e) {
      if (mySeq !== searchSeq.current) return;
      console.error("Erreur recherche produits :", e);
      setSuggestions([]);
    }
  };

  // Sélection d'un nouveau produit : réinitialise variante/erreur de façon
  // synchrone avant de lancer le chargement du nouveau produit — jamais de
  // variante de l'ancien produit affichée pendant le chargement.
  const pickSuggestion = s => {
    const nom = s.produits?.nom_reference || s.libelle_alias;
    const pid = s.produit_id || null;
    if (!pid) return;
    searchSeq.current++; // invalide toute recherche encore en cours
    setSuggestions([]);
    setProduitId(pid);
    setProduitNom(nom);
    setChangingProduct(false);
    setSearchQuery("");
    setVariantes([]);
    setVarianteId(null);
    setVarianteError(null);
    loadVariantesFor(pid, null);
  };

  const cancelChangeProduct = () => {
    searchSeq.current++; // invalide toute recherche encore en cours
    setSuggestions([]);
    setChangingProduct(false);
    setSearchQuery("");
  };

  const canSubmit = isCore
    ? (!changingProduct && !variantesLoading && !varianteError && varianteId !== null)
    : (product.trim() && format.trim());

  const submit = async () => {
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    let succes = false;

    try {
      const payload = isCore
        ? (() => {
            const varianteObj = (varianteId && varianteId !== 'any') ? variantes.find(v => v.id === varianteId) : null;
            return {
              ...item,
              qty,
              produit_id:           produitId,
              product:              produitNom,
              variante_produit_id:  varianteObj?.id ?? null,
              variante:             varianteObj ?? null,
              format:               '',
              formatDisplay:        varianteObj ? formatEtiquetteVariante(varianteObj) : 'Format indifférent',
            };
          })()
        : { ...item, product: product.trim(), format: format.trim(), brand: brandFixed ? brand.trim() : "", qty };

      const ok = await onSave(payload);

      if (ok === true) {
        succes = true;
      } else {
        setSubmitError("Enregistrement impossible, réessaie.");
      }
    } catch (error) {
      console.error("Erreur modification depuis la fiche :", error);
      setSubmitError("Enregistrement impossible, réessaie.");
    } finally {
      // En cas de succès, on laisse le bouton en état "chargement" jusqu'au
      // démontage de la fiche (onClose ci-dessous) — évite un dernier flash visuel.
      if (!succes) {
        setSubmitting(false);
      }
    }

    if (succes) {
      onClose();
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"90vh", overflowY:"auto", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:"linear-gradient(135deg,#CC0000,#FF1A1A)", padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:10 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:C.white }}>Modifier l'article</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:28, height:28, color:C.white, fontSize:14, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:"20px 20px 44px" }}>
          {isCore ? (
            <>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Produit</div>
                {!changingProduct ? (
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ flex:1, padding:"13px 16px", borderRadius:10, background:C.grayLight, fontFamily:"'Nunito',sans-serif", fontSize:15, fontWeight:700, color:C.text }}>
                      {produitNom}
                    </div>
                    <button onClick={()=>setChangingProduct(true)} style={{ background:"none", border:"none", color:C.blue, fontWeight:700, cursor:"pointer", fontSize:13, textDecoration:"underline", whiteSpace:"nowrap" }}>
                      Changer
                    </button>
                  </div>
                ) : (
                  <div style={{ position:"relative" }}>
                    <input
                      value={searchQuery}
                      onChange={e=>{ const val = e.target.value; setSearchQuery(val); searchProducts(val); }}
                      onBlur={()=>setTimeout(()=>setSuggestions([]), 150)}
                      placeholder="Chercher un nouveau produit..."
                      autoFocus
                      style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${C.blue}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:15, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }}
                    />
                    {suggestions.length > 0 && (
                      <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:C.white, border:`1px solid ${C.grayLight}`, borderRadius:10, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", zIndex:300, overflow:"hidden" }}>
                        {suggestions.map((s, i) => (
                          <button
                            key={i}
                            onClick={()=>pickSuggestion(s)}
                            style={{ display:"block", width:"100%", padding:"11px 16px", background:"transparent", border:"none", borderBottom:i<suggestions.length-1?`1px solid ${C.grayLight}`:"none", fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.text, cursor:"pointer", textAlign:"left" }}
                          >
                            {s.produits?.nom_reference || s.libelle_alias}
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={cancelChangeProduct} style={{ marginTop:8, background:"none", border:"none", color:C.gray, fontWeight:700, cursor:"pointer", fontSize:13, textDecoration:"underline" }}>
                      Annuler
                    </button>
                  </div>
                )}
              </div>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Format</div>
                {variantesLoading && (
                  <div style={{ fontSize:13, color:C.textLight }}>Chargement des formats…</div>
                )}
                {varianteError && !variantesLoading && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontSize:13, color:C.red }}>⚠️ {varianteError}</span>
                    <button onClick={()=>loadVariantesFor(produitId, varianteId)} style={{ background:'none', border:'none', color:C.blue, fontWeight:700, cursor:'pointer', fontSize:13, textDecoration:'underline' }}>Réessayer</button>
                  </div>
                )}
                {!variantesLoading && !varianteError && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {variantes.map(v => (
                      <button key={v.id} onClick={()=>setVarianteId(v.id)}
                        style={{
                          padding:'8px 14px', borderRadius:20, fontSize:14, cursor:'pointer',
                          background: varianteId===v.id ? C.green : C.grayLight,
                          color:      varianteId===v.id ? C.white : C.text,
                          border:     varianteId===v.id ? `2px solid ${C.green}` : '2px solid transparent',
                          fontWeight: varianteId===v.id ? 700 : 400,
                        }}>
                        {formatEtiquetteVariante(v)}
                      </button>
                    ))}
                    <button onClick={()=>setVarianteId('any')}
                      style={{
                        padding:'8px 14px', borderRadius:20, fontSize:14, cursor:'pointer',
                        background: varianteId==='any' ? C.gray : C.grayLight,
                        color:      varianteId==='any' ? C.white : C.textLight,
                        border:     '2px solid transparent',
                        fontWeight: 400,
                      }}>
                      Format indifférent
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            [
              {label:"Produit *", val:product, set:setProduct, ph:"Ex : Cola Zéro, Lait..."},
              {label:"Format *",  val:format,  set:setFormat,  ph:"Ex : 1L, 500g, x6..."},
            ].map(f=>(
              <div key={f.label} style={{ marginBottom:14 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>{f.label}</div>
                <input value={f.val} onChange={e=>f.set(e.target.value)} placeholder={f.ph}
                  style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${f.val?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:15, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
              </div>
            ))
          )}
          {!isCore && (
            <div style={{ background:C.grayLight, borderRadius:12, padding:"12px 16px", marginBottom:18 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:brandFixed?12:0 }}>
                <div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>Marque imposée ?</div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginTop:2 }}>
                    {brandFixed ? "Oui — une marque précise" : "Non — peu importe la marque"}
                  </div>
                </div>
                <button onClick={()=>setBrandFixed(v=>!v)} style={{ width:44, height:26, borderRadius:99, border:"none", background:brandFixed?C.blue:C.gray, cursor:"pointer", position:"relative", transition:"background 0.2s", flexShrink:0 }}>
                  <div style={{ width:20, height:20, borderRadius:99, background:C.white, position:"absolute", top:3, transition:"left 0.2s", left:brandFixed?21:3 }} />
                </button>
              </div>
              {brandFixed && (
                <input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="Ex : Look, Coca-Cola..."
                  style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`2px solid ${brand?C.orange:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
              )}
            </div>
          )}
          <div style={{ display:"flex", alignItems:"center", background:C.grayLight, borderRadius:12, padding:"10px 16px", marginBottom:22 }}>
            <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, flex:1 }}>Quantité</span>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{ width:32, height:32, borderRadius:99, border:`2px solid ${C.blue}`, background:C.white, cursor:"pointer", color:C.blue, fontWeight:900, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
              <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:C.blue, minWidth:24, textAlign:"center" }}>{qty}</span>
              <button onClick={()=>setQty(q=>q+1)} style={{ width:32, height:32, borderRadius:99, border:"none", background:C.blue, cursor:"pointer", color:C.white, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
            </div>
          </div>
          {submitError && (
            <div style={{ color:C.red, fontSize:13, fontFamily:"'Nunito',sans-serif", fontWeight:700, marginBottom:8 }}>⚠️ {submitError}</div>
          )}
          <button onClick={submit} disabled={!canSubmit || submitting} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:(canSubmit&&!submitting)?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:(canSubmit&&!submitting)?"#111111":C.gray, cursor:(canSubmit&&!submitting)?"pointer":"default" }}>
            💾 Enregistrer les modifications
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LIST TAB ──────────────────────────────────────────────────────────────────
function ListTab({ items, onAdd, onUpdate, onToggle, onRemove, setTab, favorites, saveFavorites, onSetMarquePref, itemsReportes = [], onReactiverReporte, onSupprimerReporte }) {
  const [showFavModal, setShowFavModal] = useState(false);
  const [editItem,     setEditItem]     = useState(null);

  // Chantier 83 (finition) — l'ajout d'un produit se fait UNIQUEMENT via le
  // Catalogue (recherche unique). Le formulaire in-line et son toast local ont
  // été retirés ; le bouton « + Ajouter un produit » bascule sur l'onglet
  // Catalogue, d'où l'utilisateur revient à Ma liste par la barre du bas.
  const toggleCheck   = id  => onToggle(id);
  const removeItem    = id  => onRemove(id);
  const updateItem    = updated => onUpdate(updated);
  const removeFavorite = i  => saveFavorites(favorites.filter((_,idx)=>idx!==i));
  const unchecked = items.filter(i=>!i.checked);
  const checked   = items.filter(i=>i.checked);

  // Sauvegarder la liste courante comme favoris — les identifiants Core sont
  // conservés s'ils existent, pour éviter de repasser par le rapprochement alias
  // au rechargement ; les anciens favoris sans ces champs restent inchangés.
  const saveAsFavorites = () => {
    const favItems = items.map(i=>({
      product: i.product,
      format:  i.format,
      brand:   i.brand,
      qty:     i.qty,
      ...(i.produit_id ? { produit_id: i.produit_id } : {}),
      ...(i.variante_produit_id ? { variante_produit_id: i.variante_produit_id } : {}),
    }));
    saveFavorites(favItems);
    setShowFavModal(false);
  };

  // Recharger les favoris dans la liste
  const loadFavorites = () => {
    items.forEach(i => onRemove(i.id));
    const newItems = favorites.map(f=>({ ...f, id:Date.now()+Math.random(), checked:false }));
    newItems.forEach(item => onAdd(item));
    setShowFavModal(false);
  };

  // Ajouter les favoris à la liste existante (sans effacer)
  const appendFavorites = () => {
    const newItems = favorites.map(f=>({ ...f, id:Date.now()+Math.random(), checked:false }));
    newItems.forEach(item => onAdd(item));
    setShowFavModal(false);
  };

  // Comparateur — le toggle reflète et édite le PROFIL GLOBAL (même réglage
  // pour tous les produits, persisté). Plus de préférence par item.
  const ItemRow = ({item, done}) => {
    // Chantier 84 — préférence marque PAR ARTICLE (défaut 'nationale' si NULL).
    const pref = item.marque_pref === 'mdd' ? 'mdd' : 'nationale';
    return (
    <div style={{ display:"flex", alignItems:"center", gap:12, background:done?'#F3FAF5':C.white, borderRadius:12, padding:"12px 14px", border:`1px solid ${done?'#C8E6C9':C.grayLight}`, opacity:1, boxShadow:done?'inset 3px 0 0 #4CAF50':'0 1px 4px rgba(0,0,0,0.06)' }}>
      <button onClick={()=>toggleCheck(item.id)} style={{ width:26, height:26, borderRadius:6, border:`2px solid ${done?C.green:C.blue}`, background:done?C.green:C.white, cursor:"pointer", flexShrink:0, color:C.white, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>
        {done?"✓":""}
      </button>
      {/* Chantier 83 — petite vignette photo (OFF+Cloudinary) ; carré neutre en repli. */}
      <div style={{ width:38, height:38, flexShrink:0 }}>
        <PhotoProduit varianteId={item.variante_produit_id} taille="thumb" radius={8}
          fallback={<div style={{ width:"100%", height:"100%", borderRadius:8, background:C.grayLight }} />} />
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, textDecoration:'none' }}>
          {item.brand?`${item.brand} · `:""}{item.product}
        </div>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.gray, marginTop:1 }}>
          {item.formatDisplay ?? item.format}{item.brand?"":""} {!item.brand&&<span style={{ color:C.orange, fontSize:11 }}>· toutes marques</span>}
        </div>
        {/* Chantier 84 — préférence marque PAR ARTICLE : chaque bouton écrit
            liste_courses.marque_pref de CETTE ligne. "nationale" écarte les
            marques distributeur (sauf produit qui n'existe qu'en distributeur),
            "distributeur" les inclut — affichées en générique dans le comparateur. */}
        {!done && (
          <div style={{ display:"inline-flex", marginTop:6, borderRadius:8, overflow:"hidden", border:`1px solid ${C.grayLight}` }}>
            <button onClick={()=>onSetMarquePref?.(item.id, 'nationale')} style={{ padding:"3px 9px", border:"none", cursor:"pointer", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:11, background:pref==='nationale'?C.blue:C.white, color:pref==='nationale'?C.white:C.gray }}>
              Marque nationale
            </button>
            <button onClick={()=>onSetMarquePref?.(item.id, 'mdd')} style={{ padding:"3px 9px", border:"none", cursor:"pointer", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:11, background:pref==='mdd'?C.blue:C.white, color:pref==='mdd'?C.white:C.gray }}>
              Marque Distributeur
            </button>
          </div>
        )}
      </div>
      <div style={{ background:done?C.green:C.blue, color:C.white, borderRadius:8, padding:"3px 9px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13 }}>×{item.qty}</div>
      {!done && <button onClick={()=>setEditItem(item)} style={{ background:C.grayLight, border:"none", borderRadius:8, padding:"4px 7px", fontSize:12, cursor:"pointer" }}>✏️</button>}
      <button onClick={()=>removeItem(item.id)} style={{ background:"none", border:"none", fontSize:15, cursor:"pointer", color:C.gray }}>✕</button>
    </div>
    );
  };

  return (
    <div style={{ padding:"16px 16px 110px" }}>
      {items.length===0 && (
        <div style={{ background:"#FFF0F0", borderRadius:16, padding:"32px 24px", textAlign:"center", marginBottom:16, border:"2px dashed #CC0000" }}>
          <div style={{ fontSize:52, marginBottom:10 }}>🛒</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:"#CC0000", marginBottom:6 }}>Ta liste est vide</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>Ajoute tes produits avec marque et format pour comparer les prix</div>
        </div>
      )}
      {unchecked.length>0 && (
        <>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>À acheter ({unchecked.length})</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
            {unchecked.map(item=><ItemRow key={item.id} item={item} done={false}/>)}
          </div>
        </>
      )}
      {checked.length>0 && (
        <>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>Dans le panier ({checked.length})</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
            {checked.map(item=><ItemRow key={item.id} item={item} done={true}/>)}
          </div>
        </>
      )}
      {/* Chantier 88 Lot 2 — section « À acheter plus tard » : lignes
          liste_courses de statut 'reporte' (gardées à la clôture des
          courses). Jamais comptées comme achetées, jamais dans la liste
          active ni le comparateur. ↩︎ les remet dans la liste active
          ('a_acheter'), ✕ les supprime définitivement. */}
      {itemsReportes.length>0 && (
        <>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>⏳ À acheter plus tard ({itemsReportes.length})</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
            {itemsReportes.map(item=>(
              <div key={item.id} style={{ display:"flex", alignItems:"center", gap:12, background:"#FAF7F0", borderRadius:12, padding:"12px 14px", border:"1px dashed #D8CFBB" }}>
                <div style={{ width:38, height:38, flexShrink:0, opacity:0.75 }}>
                  <PhotoProduit varianteId={item.variante_produit_id} taille="thumb" radius={8}
                    fallback={<div style={{ width:"100%", height:"100%", borderRadius:8, background:C.grayLight }} />} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#6B6152" }}>
                    {item.product}
                  </div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.gray, marginTop:1 }}>
                    {item.formatDisplay ?? item.format}
                  </div>
                </div>
                <div style={{ background:"#D8CFBB", color:"#4A4436", borderRadius:8, padding:"3px 9px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13 }}>×{item.qty}</div>
                <button onClick={()=>onReactiverReporte?.(item.id)} title="Remettre dans la liste"
                  style={{ background:C.blue, border:"none", borderRadius:8, padding:"6px 9px", fontSize:13, cursor:"pointer", color:C.white, fontWeight:900 }}>↩︎</button>
                <button onClick={()=>onSupprimerReporte?.(item.id)} style={{ background:"none", border:"none", fontSize:15, cursor:"pointer", color:C.gray }}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}
      {/* Chantier 81 — la rangée de rayons a été retirée de l'onglet Liste :
          le rayon se règle uniquement dans le sélecteur de zone du comparateur. */}
      {items.length>=1 && (
        <button onClick={()=>setTab("compare")} style={{ width:"100%", padding:"15px", marginBottom:10, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 6px 20px rgba(180,0,0,0.45)" }}>
          🏪 Comparer les prix
        </button>
      )}
      {/* Bouton favoris */}
      {favorites.length>0 && (
        <button onClick={()=>setShowFavModal(true)} style={{ width:"100%", padding:"15px", marginBottom:10, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 6px 16px rgba(180,0,0,0.4)" }}>
          ⭐ Recharger mes courses habituelles
        </button>
      )}

      <button onClick={()=>setTab("catalog")} style={{ width:"100%", padding:"15px", background:C.orange, border:"none", borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"#111111", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 6px 16px rgba(200,160,0,0.4)" }}>
        + Ajouter un produit
      </button>

      {/* Sauvegarder comme favoris (si liste non vide) */}
      {items.length>0 && (
        <button onClick={()=>setShowFavModal(true)} style={{ width:"100%", padding:"12px", marginTop:10, background:"transparent", border:`2px solid ${C.grayLight}`, borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:13, color:C.gray, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
          ⭐ {favorites.length>0?"Mettre à jour mes courses habituelles":"Sauvegarder comme courses habituelles"}
        </button>
      )}

      {editItem && <EditItemSheet item={editItem} onClose={()=>setEditItem(null)} onSave={updateItem}/>}

      {/* Modal favoris */}
      {showFavModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={()=>setShowFavModal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", animation:"slideUp 0.3s ease", overflow:"hidden" }}>
            <div style={{ background:"linear-gradient(135deg,#CC0000,#FF1A1A)", padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:C.white }}>⭐ Courses habituelles</div>
              <button onClick={()=>setShowFavModal(false)} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:28, height:28, color:C.white, fontSize:14, cursor:"pointer" }}>✕</button>
            </div>
            <div style={{ padding:"20px 20px 44px" }}>

              {/* Aperçu des favoris */}
              {favorites.length>0 && (
                <div style={{ background:C.grayLight, borderRadius:12, padding:"12px 16px", marginBottom:20 }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 }}>
                    {favorites.length} produit{favorites.length>1?"s":""} sauvegardé{favorites.length>1?"s":""}
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {favorites.map((f,i)=>(
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:4, background:C.white, borderRadius:99, padding:"4px 6px 4px 12px", fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:700, color:C.text, border:`1px solid ${C.grayLight}` }}>
                        <span>{f.brand?`${f.brand} · `:""}{f.product} <span style={{ color:C.gray }}>{f.format}</span> ×{f.qty}</span>
                        <button onClick={()=>removeFavorite(i)} style={{ background:"#EFEFEF", border:"none", borderRadius:99, width:18, height:18, fontSize:10, cursor:"pointer", color:C.gray, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions selon contexte */}
              {favorites.length>0 && (
                <>
                  <button onClick={loadFavorites} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.white, cursor:"pointer", marginBottom:10, boxShadow:"0 6px 16px rgba(180,0,0,0.4)" }}>
                    🔄 Remplacer ma liste par mes habituelles
                  </button>
                  <button onClick={appendFavorites} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"#111111", cursor:"pointer", marginBottom:10, boxShadow:"0 6px 16px rgba(200,160,0,0.4)" }}>
                    ➕ Ajouter mes habituelles à la liste
                  </button>
                </>
              )}

              {items.length>0 && (
                <button onClick={saveAsFavorites} style={{ width:"100%", padding:"13px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
                  💾 {favorites.length>0?"Mettre à jour avec la liste actuelle":"Sauvegarder la liste actuelle comme habituelles"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ECONOMIES TAB ─────────────────────────────────────────────────────────────
function EconomiesTab({ priceDB, archives, items, setTab }) {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const scannedArchives = useMemo(() =>
    archives.filter(a => a.ticket_scanned && a.realized_saving != null),
    [archives]
  );

  const cagnotte = useMemo(() => ({
    total: scannedArchives.reduce((a, arc) => a + (arc.realized_saving || 0), 0),
  }), [scannedArchives]);

  const monthly = useMemo(() => {
    const map = {};
    scannedArchives.forEach(arc => {
      const m = (arc.date||'').substring(0,7);
      if (!m) return;
      if (!map[m]) map[m] = { total:0, count:0 };
      map[m].total += arc.realized_saving || 0;
      map[m].count += 1;
    });
    return Object.entries(map)
      .sort((a,b) => b[0].localeCompare(a[0]))
      .map(([m,d]) => ({ month:m, ...d }));
  }, [scannedArchives]);

  const monthArchives = useMemo(() => {
    if (!selectedMonth) return [];
    return scannedArchives
      .filter(arc => (arc.date||'').substring(0,7) === selectedMonth)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [scannedArchives, selectedMonth]);

  const years = useMemo(() => {
    const set = new Set();
    scannedArchives.forEach(arc => {
      const y = parseInt((arc.date||'').substring(0,4));
      if (y >= 2025) set.add(y);
    });
    return Array.from(set).sort((a,b) => b-a);
  }, [scannedArchives]);

  const bestMonth = useMemo(() => {
    const map = {};
    scannedArchives.forEach(arc => {
      const m = (arc.date||'').substring(0,7);
      if (!m) return;
      map[m] = (map[m] || 0) + (arc.realized_saving || 0);
    });
    const best = Object.entries(map).sort((a,b) => b[1]-a[1])[0];
    return (best && best[1] > 0) ? best[0] : null;
  }, [scannedArchives]);

  const thisMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;

  const fullMonthLabel = (yyyymm) => {
    const [y, m] = yyyymm.split('-');
    const s = new Date(parseInt(y), parseInt(m)-1, 1).toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  return (
    <div style={{ padding:"16px 16px 110px" }}>

      {scannedArchives.length === 0 ? (
        <div style={{ background:"#F0FFF5", borderRadius:14, padding:"20px 16px", textAlign:"center", marginBottom:24, border:`2px dashed ${C.green}` }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🧾</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, lineHeight:1.6 }}>
            Valide une liste, fais tes courses, scanne le ticket — tes économies vs le magasin alternatif s'accumuleront ici.
          </div>
        </div>
      ) : (
        <>
          {/* Cagnotte totale — toujours affiché */}
          <div style={{ background:"linear-gradient(135deg,#00B341,#00C850)", borderRadius:14, padding:"18px 20px", marginBottom:16 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Cagnotte réalisée sur les prix moyens du marché</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:36, color:C.white, lineHeight:1 }}>
              {cagnotte.total >= 0 ? "+" : ""}{cagnotte.total.toFixed(2)} €
            </div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:"rgba(255,255,255,0.7)", marginTop:6 }}>
              {scannedArchives.length} course{scannedArchives.length>1?"s":""} analysée{scannedArchives.length>1?"s":""}
            </div>
            {bestMonth && (
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:"rgba(255,255,255,0.85)", marginTop:4 }}>
                Meilleur mois : {fullMonthLabel(bestMonth)}
              </div>
            )}
          </div>

          {selectedMonth ? (
            /* VUE DÉTAIL D'UN MOIS */
            <>
              <button onClick={() => setSelectedMonth(null)} style={{ background:"none", border:"none", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.blue, cursor:"pointer", padding:"0 0 14px", display:"flex", alignItems:"center", gap:6 }}>
                ← {fullMonthLabel(selectedMonth)}
              </button>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {monthArchives.map((arc, i) => {
                  const store = arc.store || {};
                  const pos = (arc.realized_saving || 0) >= 0;
                  return (
                    <div key={arc.id||i} style={{ background:C.white, borderRadius:12, padding:"12px 14px", border:`1px solid ${C.grayLight}`, display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:20, flexShrink:0 }}>{store?.logo || "🏪"}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {store?.name || "Courses"}
                        </div>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight }}>
                          {new Date(arc.date).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}
                        </div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:pos?C.green:"#CC3300" }}>
                          {pos?"+":""}{(arc.realized_saving||0).toFixed(2)} €
                        </div>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, color:C.textLight }}>vs prix moyen</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* VUE PRINCIPALE — navigation par mois */
            <>
              {years.length > 1 && (
                <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
                  {years.map(y => (
                    <button key={y} onClick={() => setSelectedYear(y)}
                      style={{ borderRadius:20, padding:"6px 16px", fontSize:13, border:"none", cursor:"pointer", fontFamily:"'Nunito',sans-serif", fontWeight:y===selectedYear?900:400, background:y===selectedYear?C.red:C.grayLight, color:y===selectedYear?"#fff":C.textLight }}>
                      {y}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {monthly.filter(m => m.month.startsWith(`${selectedYear}-`)).map(m => {
                  const isZero = m.total === 0;
                  return (
                    <div key={m.month} onClick={() => setSelectedMonth(m.month)}
                      style={{ display:"flex", alignItems:"center", background:isZero?"#EBEBEB":m.month===thisMonthStr?"#F0FFF5":C.white, borderRadius:12, padding:"12px 14px", border:`1.5px solid ${isZero?C.grayLight:m.month===thisMonthStr?C.green:C.grayLight}`, cursor:"pointer" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:isZero?C.textLight:C.text, fontStyle:isZero?"italic":"normal" }}>{fullMonthLabel(m.month)}</div>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight, marginTop:2 }}>
                          {m.count} course{m.count>1?"s":""}
                        </div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:isZero?C.gray:m.total>=0?C.green:"#CC3300" }}>
                            {m.total>=0?"+":""}{m.total.toFixed(2)} €
                          </div>
                          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, color:C.textLight }}>vs prix moyen</div>
                        </div>
                        <span style={{ color:C.gray, fontSize:18, opacity:isZero?0.4:1 }}>›</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── PRICES TAB ────────────────────────────────────────────────────────────────
function PricesTab({ priceDB, setPriceDB, archives, updateArchive, onTicketValidated, onCreateArchive, userId, produitsRef = [], autoOpenCamera = false, onAutoOpenConsumed, autoResumeScan = false, onAutoResumeConsumed, initialScanResult = null, onInitialScanConsumed, hideActions = false, coreActifGlobal = false, estFrancois = false, magasinSession = null, onImportSession, onScanSessionFerme, onVoirTicketExistant = null, notifierPoints = false }) {
  const [showImport,    setShowImport]    = useState(false);
  const [capturedResult] = useState(initialScanResult);
  // Chantier 79 — brouillon de scan reprenable. scanDraft : détecté au montage
  // (survit au rechargement, contrairement à ImportTicketSheet démonté).
  // resumeDraft : brouillon transmis à la feuille pour réhydratation.
  // showNewScanPrompt : demande avant d'écraser un brouillon par un nouveau scan.
  const [scanDraft, setScanDraft] = useState(() => lireScanDraft());
  const [resumeDraft, setResumeDraft] = useState(null);
  const [showNewScanPrompt, setShowNewScanPrompt] = useState(false);
  const [confirmAbandonScan, setConfirmAbandonScan] = useState(false);

  useEffect(() => {
    const draft = lireScanDraft();
    // Chantier 79 (ajustement) — "Reprendre" depuis l'accueil : rouvrir
    // directement la feuille sur le brouillon.
    if (autoResumeScan && draft) {
      setScanDraft(draft); setResumeDraft(draft); setShowImport(true);
      onAutoResumeConsumed?.();
      return;
    }
    if (autoOpenCamera || capturedResult) {
      // Nouveau scan demandé, mais un brouillon existe : ne pas écraser en
      // douce -> proposer de reprendre ou repartir de zéro.
      if (draft) { setScanDraft(draft); setShowNewScanPrompt(true); }
      else setShowImport(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showEntry,     setShowEntry]     = useState(false);
  const [editPrice,     setEditPrice]     = useState(null);
  const [filterStore,    setFilterStore]    = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterPeriod,   setFilterPeriod]   = useState("all");
  const [sortBy,         setSortBy]         = useState("date");
  const [searchQuery,    setSearchQuery]    = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [toast,         setToast]         = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),2500); };
  const savePrice = entry => {
    const updated=[...priceDB.filter(p=>priceKey(p)!==priceKey(entry)),{...entry,id:Date.now()}];
    setPriceDB(updated);
    showToast("✓ Prix enregistré");
  };
  const importPrices = async (entries, ecritureCorePromise) => {
    // Chantier 90 Lot 4 — scan lancé depuis une session de courses : signale
    // l'import à la racine avec la promesse d'écriture Core, pour rattacher
    // le ticket créé à la session (best effort, jamais bloquant pour ce flux).
    onImportSession?.(ecritureCorePromise);
    // Trouve la dernière archive sans ticket scanné
    const openArchive = [...archives].reverse().find(a => !a.ticket_scanned);

    let realizedSaving = null;
    if (openArchive) {
      if (coreActifGlobal) {
        // #56.6 — attend l'écriture Core déjà lancée par confirm() (un seul
        // appel, jamais dupliqué), puis calcule le realized_saving scopé à CE
        // ticket via #56.5.B (calculerRealizedSavingTicket), jamais tout
        // l'historique. Produits non résolus ignorés proprement (total à 0
        // si rien n'est calculable, jamais de faux positif).
        // Chantier 96 — le drapeau ticket_scanned ne ment plus JAMAIS : si
        // l'écriture Core n'a PAS créé de ticket (résultat null ou statut
        // 'rejet' — ex. magasin non résolu), l'archive n'est PAS marquée et
        // aucun realized_saving n'est calculé (il l'aurait été sur un VIEUX
        // ticket, le « dernier » de l'utilisateur). Message explicite, flux
        // legacy (priceDB/partage) inchangé plus bas.
        const resultatCoreEcriture = await ecritureCorePromise;
        if (!doitRattacherTicketSession(resultatCoreEcriture)) {
          showToast("⚠️ Ticket non enregistré (lecture ou magasin non résolus) — l'archive reste à scanner.", false);
          realizedSaving = null; // sentinelle : pas de marquage plus bas
        } else {
          const resultatCore = await calculerRealizedSavingTicket({ utilisateurId: userId });
          realizedSaving = resultatCore.total;
        }
      } else {
        realizedSaving = 0;
        entries.forEach(e => {
          // Est-ce que cet article était sur la liste archivée ?
          const archiveItem = openArchive.items.find(item =>
            normName(item.product) === normName(e.product) &&
            normFormat(item.format || '') === normFormat(e.format || '')
          );
          if (!archiveItem) return;
          const qty = archiveItem.qty || 1;
          const eKey = `${normName(e.brand||'')}_${normName(e.product)}_${normFormat(e.format||'')}`;
          const cutoffMoy = Date.now() - JOURS_MOYENNE * 86400000;
          const alts = priceDB.filter(p => {
            const pKey = `${normName(p.brand||'')}_${normName(p.product)}_${normFormat(p.format||'')}`;
            return pKey === eKey && p.storeId !== e.storeId && new Date(p.date).getTime() >= cutoffMoy;
          });
          if (alts.length > 0) {
            const avgMarket = alts.reduce((s, p) => s + p.price, 0) / alts.length;
            realizedSaving += (avgMarket - e.price) * qty;
          }
        });
        realizedSaving = Math.round(realizedSaving * 100) / 100;
      }
      // Chantier 96 — marquage UNIQUEMENT si un ticket a réellement été
      // ingéré (branche Core) ou en mode legacy historique (realizedSaving
      // est alors toujours un nombre). null = échec Core, archive intacte.
      if (realizedSaving !== null) {
        updateArchive(openArchive.id, { ticket_scanned: true, realized_saving: realizedSaving });
        onTicketValidated?.(openArchive.id, openArchive.store);
      }
    } else {
      const storeId = entries[0]?.storeId || "autre";
      const storeObj = STORES.find(s => s.id === storeId);
      const storeInfo = storeId === "autre"
        ? { id:"autre", name: entries[0]?.store_name || "Autre", logo:"🏪" }
        : storeObj || { id:"autre", name: entries[0]?.store_name || "Autre", logo:"🏪" };
      const total = Math.round(entries.reduce((s,e) => s + (e.price||0) * (e.qty||1), 0) * 100) / 100;
      const newArc = {
        date:    entries[0]?.date || new Date().toISOString(),
        store:   storeInfo,
        total,
        items:   entries.map(e => ({ id: Date.now()+Math.random(), product: e.product, format: e.format||"", brand: e.brand||"", qty: e.qty||1, unit_price: e.unit_price||null, price: e.price||null, total: e.total||null, checked: false })),
        potential_saving: 0,
        realized_saving:  0,
        ticket_scanned:   true,
      };
      onCreateArchive?.(newArc);
    }

    let updated = [...priceDB];
    entries.forEach(e => { updated = [...updated.filter(p => priceKey(p) !== priceKey(e)), e]; });
    setPriceDB(updated);

    // Copie anonyme dans community_prices
    if (userId) {
      const communityEntries = entries.map(e => ({
        user_id:       userId,
        product:       e.product,
        brand:         e.brand || '',
        format:        e.format || '',
        category:      guessCategory(e.product),
        price:         e.price,
        date:          e.date,
        store_name:    e.store_name || '',
        store_address: e.store_address || '',
        store_id:      e.store_id || null,
        is_private:    e.share === false,
      }));
      supabase.from('community_prices').insert(communityEntries)
        .then(({ error }) => { if (error) { console.error("Erreur community_prices :", error); showToast("⚠️ Partage communauté échoué", false); } });
    }

    const savingMsg = realizedSaving !== null
      ? ` · Économies : ${realizedSaving >= 0 ? '+' : ''}${realizedSaving.toFixed(2)} €`
      : '';
    showToast(`✓ ${entries.length} prix importé${entries.length > 1 ? "s" : ""}${savingMsg}`);
  };
  const deletePrice = async (entry) => {
    const previous = priceDB;
    setPriceDB(priceDB.filter(p => p.id !== entry.id));
    const { error } = await supabase.from('price_db').delete().eq('id', entry.id);
    if (error) {
      console.error("Erreur suppression Supabase :", error);
      setPriceDB(previous);
    }
  };

  const categories = useMemo(()=>
    [...new Set(priceDB.map(p=>p.category||"Autres"))].sort()
  ,[priceDB]);

  const suggestions = useMemo(()=>{
    const q=searchQuery.toLowerCase().trim();
    if(!q||q.length<2) return [];
    const seen=new Set(), result=[];
    for(const p of priceDB){
      if(p.product.toLowerCase().includes(q)||(p.brand||"").toLowerCase().includes(q)){
        const key=`${p.brand||""}_${p.product}`.toLowerCase();
        if(!seen.has(key)){
          seen.add(key);
          result.push({ label:p.brand?`${p.brand} · ${p.product}`:p.product, value:p.product });
          if(result.length>=6) break;
        }
      }
    }
    return result;
  },[priceDB,searchQuery]);

  const grouped = useMemo(()=>{
    const periodDays = {"7d":7,"30d":30,"90d":90};
    const cutoff = periodDays[filterPeriod] ? Date.now() - periodDays[filterPeriod]*86400000 : 0;
    const q = searchQuery.toLowerCase().trim();
    const filtered = priceDB
      .filter(p=>filterStore==="all"||p.storeId===filterStore)
      .filter(p=>filterCategory==="all"||(p.category||"Autres")===filterCategory)
      .filter(p=>!cutoff||new Date(p.date).getTime()>=cutoff)
      .filter(p=>!q||p.product.toLowerCase().includes(q)||(p.brand||"").toLowerCase().includes(q)||p.format.toLowerCase().includes(q));
    const groups={};
    filtered.forEach(p=>{
      const key=`${p.brand||""}_${p.product}_${p.format}`.toLowerCase();
      if(!groups[key]) groups[key]={brand:p.brand,product:p.product,format:p.format,entries:[]};
      groups[key].entries.push(p);
    });
    const arr=Object.values(groups);
    if(sortBy==="date")       arr.sort((a,b)=>Math.max(...b.entries.map(e=>new Date(e.date)))-Math.max(...a.entries.map(e=>new Date(e.date))));
    else if(sortBy==="price") arr.sort((a,b)=>Math.min(...a.entries.map(e=>e.price))-Math.min(...b.entries.map(e=>e.price)));
    else if(sortBy==="name")  arr.sort((a,b)=>a.product.localeCompare(b.product,"fr"));
    return arr;
  },[priceDB,filterStore,filterCategory,filterPeriod,sortBy,searchQuery]);

  return (
    <div style={{ padding:"16px 16px 110px" }}>
      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        <div style={{ flex:1, background:C.blue, borderRadius:12, padding:"12px 14px" }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)", textTransform:"uppercase", letterSpacing:"0.06em" }}>Prix enregistrés</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.white }}>{priceDB.length}</div>
        </div>
        <div style={{ flex:1, background:C.green, borderRadius:12, padding:"12px 14px" }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)", textTransform:"uppercase", letterSpacing:"0.06em" }}>Produits distincts</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.white }}>{grouped.length}</div>
        </div>
      </div>

      {/* Chantier 79 — bandeau de reprise d'un scan interrompu (au montage,
          survit au rechargement de la page). Masqué pendant que la feuille
          ou la demande "nouveau scan" est ouverte. */}
      {!hideActions && scanDraft && !showImport && !showNewScanPrompt && (
        <div style={{ background:"#FFF8E6", border:`1.5px solid ${C.yellow}`, borderRadius:14, padding:"12px 14px", marginBottom:12 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:"#7A6000" }}>
            🧾 Scan de ticket en cours
          </div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:"#7A6000", marginTop:2 }}>
            étape : {etapeLisibleScan(scanDraft.status)}{scanDraft.createdAt ? ` · commencé le ${formatDateBrouillon(scanDraft.createdAt)}` : ""}
          </div>
          <div style={{ display:"flex", gap:8, marginTop:10 }}>
            <button onClick={()=>{ setResumeDraft(scanDraft); setShowImport(true); }} style={{ flex:1, padding:"10px", border:"none", borderRadius:10, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.white, cursor:"pointer" }}>
              Reprendre
            </button>
            <button onClick={()=>setConfirmAbandonScan(true)} style={{ padding:"10px 14px", border:"1.5px solid rgba(122,96,0,0.35)", borderRadius:10, background:"transparent", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#7A6000", cursor:"pointer" }}>
              Abandonner
            </button>
          </div>
        </div>
      )}

      {/* Chantier 79 — confirmation d'abandon du scan en cours */}
      {confirmAbandonScan && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:250, padding:24 }} onClick={()=>setConfirmAbandonScan(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:16, padding:"20px", maxWidth:320, width:"100%" }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.text, marginBottom:6 }}>Abandonner ce scan en cours ?</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, marginBottom:16 }}>Le ticket scanné et les modifications seront perdus.</div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>{ effacerScanDraft(); setScanDraft(null); setConfirmAbandonScan(false); }} style={{ flex:1, padding:"12px", border:"none", borderRadius:10, background:"#CC0000", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.white, cursor:"pointer" }}>
                Abandonner
              </button>
              <button onClick={()=>setConfirmAbandonScan(false)} style={{ padding:"12px 16px", border:`1.5px solid ${C.grayLight}`, borderRadius:10, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, cursor:"pointer" }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {!hideActions && (
        <button onClick={()=>{ const d = lireScanDraft(); if (d) { setScanDraft(d); setShowNewScanPrompt(true); } else setShowImport(true); }} style={{ width:"100%", padding:"18px", marginBottom:12, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, boxShadow:"0 6px 24px rgba(204,0,0,0.45)" }}>
          <span style={{ fontSize:22 }}>🧾</span> Importer un ticket de caisse
        </button>
      )}

      {priceDB.length>0 && (
        <div style={{ position:"relative", marginBottom:10 }}>
          <input
            value={searchQuery}
            onChange={e=>{ setSearchQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={()=>setShowSuggestions(true)}
            onBlur={()=>setTimeout(()=>setShowSuggestions(false),150)}
            onKeyDown={e=>e.key==="Escape"&&setShowSuggestions(false)}
            placeholder="🔍 Chercher un produit..."
            style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`2px solid ${searchQuery?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }}
          />
          {showSuggestions && suggestions.length>0 && (
            <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:C.white, borderRadius:10, border:`1.5px solid ${C.blue}`, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", zIndex:50, overflow:"hidden" }}>
              {suggestions.map((s,i)=>(
                <button key={i} onMouseDown={()=>{ setSearchQuery(s.value); setShowSuggestions(false); }}
                  style={{ width:"100%", textAlign:"left", padding:"11px 14px", border:"none", borderBottom:i<suggestions.length-1?`1px solid ${C.grayLight}`:"none", background:"none", fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:C.text, cursor:"pointer" }}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {priceDB.length>0 && (() => {
        const sel = { width:"100%", padding:"10px 12px", borderRadius:10, border:`1.5px solid ${C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:C.text, background:C.white, outline:"none", cursor:"pointer", boxSizing:"border-box" };
        const priceActive = sortBy==="price_asc"||sortBy==="price_desc";
        const filtersActive = filterStore!=="all"||filterCategory!=="all"||filterPeriod!=="all"||priceActive||searchQuery.trim();
        const resetFilters = () => { setFilterStore("all"); setFilterCategory("all"); setFilterPeriod("all"); setSortBy("date"); setSearchQuery(""); };
        return (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:filtersActive?6:16 }}>
              <select value={filterStore} onChange={e=>setFilterStore(e.target.value)} style={sel}>
                <option value="all">Tous les magasins</option>
                {STORES.filter(s=>priceDB.some(p=>p.storeId===s.id)).map(s=>(
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <select value={filterCategory} onChange={e=>setFilterCategory(e.target.value)} style={sel}>
                <option value="all">Toutes catégories</option>
                {categories.map(cat=><option key={cat} value={cat}>{cat}</option>)}
              </select>
              <select value={filterPeriod} onChange={e=>setFilterPeriod(e.target.value)} style={sel}>
                <option value="all">Toute période</option>
                <option value="7d">7 derniers jours</option>
                <option value="30d">30 derniers jours</option>
                <option value="90d">3 derniers mois</option>
              </select>
              <button
                onClick={()=>setSortBy(s=>s==="price_asc"?"price_desc":s==="price_desc"?"date":"price_asc")}
                style={{ padding:"10px 12px", borderRadius:10, border:"none", background:priceActive?C.blue:C.grayLight, color:priceActive?C.white:C.text, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, cursor:"pointer" }}
              >
                {sortBy==="price_desc" ? "Prix ↓" : "Prix ↑"}
              </button>
            </div>
            {filtersActive && (
              <div style={{ textAlign:"right", marginBottom:14 }}>
                <button onClick={resetFilters} style={{ background:"none", border:"none", fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:800, color:C.gray, cursor:"pointer", textDecoration:"underline" }}>
                  Réinitialiser les filtres
                </button>
              </div>
            )}
          </>
        );
      })()}

      {priceDB.length===0 && (
        <div style={{ background:C.orangeLight, borderRadius:16, padding:"28px 24px", textAlign:"center", marginBottom:16, border:`2px dashed ${C.orange}` }}>
          <div style={{ fontSize:44, marginBottom:10 }}>🧾</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.orange, marginBottom:6 }}>Aucun prix encore</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, lineHeight:1.5 }}>Envoie une photo de ton ticket à Claude → importe le JSON ici !</div>
        </div>
      )}

      {grouped.map(group=>{
        const best=group.entries.reduce((m,e)=>e.price<m.price?e:m,group.entries[0]);
        return (
          <div key={`${group.brand}_${group.product}_${group.format}`} style={{ background:C.white, borderRadius:14, border:`1px solid ${C.grayLight}`, overflow:"hidden", marginBottom:10, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <div style={{ background:C.blueLight, padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.blue }}>{group.brand?`${group.brand} · `:""}{group.product}</div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>{group.format}</div>
              </div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, fontWeight:700 }}>
                meilleur : <span style={{ color:C.green, fontWeight:900 }}>{best.price.toFixed(2)} €</span> {STORES.find(s=>s.id===best.storeId)?.logo}
              </div>
            </div>
            {group.entries.sort((a,b)=>a.price-b.price).map(entry=>{
              const store=STORES.find(s=>s.id===entry.storeId);
              const stale=isStale(entry.date);
              const days=daysAgo(entry.date);
              return (
                <div key={entry.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderBottom:`1px solid ${C.grayLight}` }}>
                  <span style={{ fontSize:18 }}>{store?.logo}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{store?.name}</div>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:stale?C.orange:C.green, fontWeight:700, marginTop:1 }}>
                      {stale?`⚠️ Il y a ${days}j`:days===0?"✓ Aujourd'hui":`✓ Il y a ${days}j`}
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:entry.price===best.price?C.green:C.text }}>{entry.price.toFixed(2)} €</div>
                    {fmtUnitPrice(entry.price, group.format) && (
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, color:C.gray, fontWeight:700, marginTop:1 }}>{fmtUnitPrice(entry.price, group.format)}</div>
                    )}
                  </div>
                  <button onClick={()=>{setEditPrice(entry);setShowEntry(true);}} style={{ background:C.grayLight, border:"none", borderRadius:8, padding:"5px 8px", fontSize:12, cursor:"pointer" }}>✏️</button>
                 {pendingDelete === entry.id ? (
                    <div style={{ display:"flex", gap:4 }}>
                      <button onClick={()=>setPendingDelete(null)} style={{ background:C.grayLight, border:"none", borderRadius:6, padding:"3px 8px", fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:11, cursor:"pointer", color:C.text }}>Non</button>
                      <button onClick={()=>{ deletePrice(entry); setPendingDelete(null); }} style={{ background:C.red, border:"none", borderRadius:6, padding:"3px 8px", fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:11, cursor:"pointer", color:C.white }}>Oui</button>
                    </div>
                  ) : (
                    <button onClick={()=>setPendingDelete(entry.id)} style={{ background:"none", border:"none", fontSize:14, cursor:"pointer", color:C.gray }}>✕</button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {!hideActions && (
        <button onClick={()=>{setEditPrice(null);setShowEntry(true);}} style={{ position:"fixed", bottom:72, right:16, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:99, padding:"13px 18px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", gap:6, boxShadow:"0 6px 20px rgba(180,0,0,0.45)", zIndex:40 }}>
          ✏️ Saisie manuelle
        </button>
      )}

      {/* Chantier 79 — demande avant d'écraser un brouillon par un nouveau scan */}
      {showNewScanPrompt && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:250, padding:24 }} onClick={()=>setShowNewScanPrompt(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:16, padding:"20px", maxWidth:340, width:"100%" }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.text, marginBottom:6 }}>Un scan est déjà en cours</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, marginBottom:16 }}>
              Le reprendre, ou repartir de zéro ?{scanDraft?.createdAt ? ` (commencé le ${formatDateBrouillon(scanDraft.createdAt)})` : ""}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <button onClick={()=>{ setResumeDraft(scanDraft); setShowNewScanPrompt(false); setShowImport(true); }} style={{ padding:"12px", border:"none", borderRadius:10, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.white, cursor:"pointer" }}>
                Reprendre le scan en cours
              </button>
              <button onClick={()=>{ effacerScanDraft(); setScanDraft(null); setResumeDraft(null); setShowNewScanPrompt(false); setShowImport(true); }} style={{ padding:"12px", border:`1.5px solid ${C.grayLight}`, borderRadius:10, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, cursor:"pointer" }}>
                Repartir de zéro
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport    && <ImportTicketSheet onClose={()=>{setShowImport(false);setResumeDraft(null);setScanDraft(lireScanDraft());onAutoOpenConsumed?.();onInitialScanConsumed?.();onScanSessionFerme?.();}} onImport={importPrices} refProducts={produitsRef.map(p=>({ nom: p.produit_generique, categorie: p.sous_categorie }))} directCamera={autoOpenCamera} onManualEntry={()=>{ setShowImport(false); setShowEntry(true); }} initialResult={capturedResult} resumeDraft={resumeDraft} estFrancois={estFrancois} magasinSession={magasinSession} onVoirTicketExistant={onVoirTicketExistant} onDoublonTardif={()=>showToast("🧾 Ce ticket a déjà été scanné (doublon détecté)", false)} onPointsCredites={notifierPoints ? (msg)=>showToast(msg) : null}/>}
      {showEntry     && <PriceEntrySheet  onClose={()=>{setShowEntry(false);setEditPrice(null);}} onSave={savePrice} existingPrice={editPrice}/>}
      {toast && <Toast msg={toast.msg} ok={toast.ok}/>}
    </div>
  );
}

// ── COMPARE TAB ───────────────────────────────────────────────────────────────
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Chantier 84 — clé de rapprochement stores(legacy)/magasins(Core) par
// coordonnées arrondies : les deux tables partagent lat/long au magasin près
// (vérifié), mais leurs id diffèrent. Sert à connaître la catégorie d'un
// magasin legacy (categorie n'existe que dans la table magasins Core).
function cleCoords(lat, lng) {
  if (lat == null || lng == null) return null;
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

function CompareTab({ items, priceDB, onValidate, setTab, searchRadius, setSearchRadius, userPos, setUserPos, zoneLabel, setZoneLabel, zonePrete = true, userId, isAdmin, modeCoreActif, coreActifGlobal, categorieMagasin = 'grande_surface', setCategorieMagasin, sessionCoursesAccessible = false }) {
  const F = "'Nunito',sans-serif";

  // Chantier géoloc comparateur — sélecteur de zone (point de référence).
  // zoneEditOpen forcé "ouvert" tant qu'aucun point n'existe (userPos null) :
  // voir le early-return plus bas, jamais de liste de prix sans point.
  const [zoneEditOpen, setZoneEditOpen] = useState(false);
  const [adresseSaisie, setAdresseSaisie] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [gpsEnCours, setGpsEnCours] = useState(false);
  const [gpsError, setGpsError] = useState(null);
  const inputRef = useRef(null);

  // Persiste le point choisi (coords + libellé) sur profiles, même mécanisme
  // que les favoris (table Supabase liée à l'utilisateur) : un point choisi
  // sur un appareil est donc retrouvé sur un autre. userId absent (session
  // pas encore prête) -> on garde quand même le point en mémoire locale.
  const definirZone = async (coords, label) => {
    setUserPos(coords);
    setZoneLabel(label);
    setZoneEditOpen(false);
    setSuggestions([]);
    setGpsError(null);
    if (!userId) return;
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      zone_lat: coords?.lat ?? null,
      zone_lng: coords?.lng ?? null,
      zone_label: label ?? null,
    });
    if (error) console.error("Erreur sauvegarde de la zone de comparaison :", error);
  };

  const utiliserGps = () => {
    if (!navigator.geolocation) { setGpsError("Géolocalisation non disponible sur cet appareil."); return; }
    setGpsEnCours(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const label = await reverseGeocodeLabel(coords.lat, coords.lng);
        await definirZone(coords, label || "Ma position");
        setGpsEnCours(false);
      },
      () => {
        setGpsError("Position indisponible, saisis une adresse ci-dessous.");
        setGpsEnCours(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    );
  };

  // Chantier 81 — autocomplétion adresse (api-adresse), debounce ~300 ms.
  // On n'appelle plus de géocodage au "Valider" : les coordonnées sont déjà
  // dans chaque suggestion (geometry.coordinates), pas de second aller-retour.
  useEffect(() => {
    const q = adresseSaisie.trim();
    if (q.length < 3) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5&autocomplete=1`);
        const d = await r.json();
        setSuggestions(d.features || []);
      } catch { setSuggestions([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [adresseSaisie]);

  const choisirSuggestion = (f) => {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return;
    const [lng, lat] = coords;
    definirZone({ lat, lng }, f.properties?.label || adresseSaisie.trim());
    setAdresseSaisie("");
    setSuggestions([]);
  };

  // Chantier 81 — plus AUCUNE demande GPS automatique : la géolocalisation
  // n'est déclenchée qu'au tap explicite sur "Utiliser ma position" (évite le
  // popup GPS surprise à l'ouverture et le double popup avec le bouton
  // "Comparer les prix"). Sans point, l'écran de choix de zone reste affiché.

  const [storesGeo, setStoresGeo] = useState([]);

  // Chantier 83 — catégorie ('grande_surface' | 'proximite') des magasins Core
  // actifs, pour restreindre les magasins candidats du comparateur. La vue
  // prix_comparables n'expose pas categorie : on charge une map magasin_id ->
  // categorie depuis la table magasins (statut actif, non fusionnés).
  const [magasinsCat, setMagasinsCat] = useState([]);
  useEffect(() => {
    supabase.from('magasins').select('id, categorie, latitude, longitude').eq('statut', 'actif')
      .then(({data})=> setMagasinsCat(data || []));
  }, []);
  // categorie null (aucun magasin actif aujourd'hui) traitée comme grande surface.
  const categorieParMagasin = useMemo(
    () => new Map(magasinsCat.map(m => [m.id, m.categorie || 'grande_surface'])),
    [magasinsCat]
  );
  // Chantier 84 — même catégorie, indexée par coordonnées, pour les moteurs
  // legacy (analysis/storeTotals) et le diagnostic shadow, qui raisonnent par
  // stores (id legacy) et non par magasin_id Core. Coords inconnues / magasin
  // non rapproché -> grande surface par défaut (règle Chantier 83).
  const categorieParCoords = useMemo(() => {
    const m = new Map();
    magasinsCat.forEach(mg => {
      const k = cleCoords(mg.latitude, mg.longitude);
      if (k) m.set(k, mg.categorie || 'grande_surface');
    });
    return m;
  }, [magasinsCat]);

  // #56.6 — source de vérité : modeCoreActif (tri-état, admin uniquement)
  // prend le dessus s'il est explicitement défini (override de comparaison
  // ponctuelle), sinon coreActifGlobal (kill switch, tout le monde) décide.
  // badgeDebugVisible reste strictement l'ancien comportement #56.4 : jamais
  // affiché à un non-admin, jamais lié au réglage global lui-même.
  const utiliserCore = (isAdmin === true && modeCoreActif !== null) ? modeCoreActif : coreActifGlobal;
  const badgeDebugVisible = isAdmin === true && modeCoreActif === true;

  useEffect(()=>{
    supabase.from('stores').select('id, name, enseigne, latitude, longitude')
      .then(({data})=> setStoresGeo(data || []));
  }, []);

  // #58.2.B étape 2 — interrupteur dev uniquement (défaut : vue actuelle,
  // inchangée). N'existe pas en prod : voir le rendu du toggle plus bas,
  // gardé par import.meta.env.DEV.
  const [vueDev, setVueDev] = useState('actuelle');

  // Calcul shadow : uniquement en DEV, et uniquement quand la nouvelle vue
  // est effectivement affichée (pas de calcul superflu sur "Vue actuelle").
  // Ne réimplémente ni le matching produit/prix, ni le filtre de fraîcheur,
  // ni le filtre de distance : réutilise itemMatchesPrice et reproduit à
  // l'identique les conditions déjà inline dans `analysis` ci-dessous (même
  // STALE_DAYS, même distanceKm) — même principe que ShadowCompareDiagnostic.
  const shadowPanier = useMemo(() => {
    if (!import.meta.env.DEV || vueDev !== 'nouvelle') return null;

    const storeMap = Object.fromEntries(storesGeo.map(s => [s.id, s]));
    const cutoff = Date.now() - STALE_DAYS * 86400000;
    const estRecentShadow = (prix) => new Date(prix.date).getTime() >= cutoff;
    const estDansRayonShadow = (prix, geo) => {
      if (!userPos) return false; // Chantier 81 — jamais de prix sans point
      if (!prix.store_id) return true; // prix sans magasin : rien à filtrer
      if (!geo?.latitude || !geo?.longitude) return false; // Chantier 82 — magasin sans coords → hors zone
      if (distanceKm(userPos.lat, userPos.lng, geo.latitude, geo.longitude) > searchRadius) return false;
      // Chantier 84 — restriction catégorie aussi dans le diagnostic shadow.
      return (categorieParCoords.get(cleCoords(geo.latitude, geo.longitude)) || 'grande_surface') === categorieMagasin;
    };

    const { panier, magasins } = construirePanierEtMagasins({
      items, priceDB, magasinsGeo: storesGeo,
      itemMatchesPrice, estRecent: estRecentShadow, estDansRayon: estDansRayonShadow,
    });
    const classement = classerMagasinsPourPanier(panier, magasins);

    // Détail brut (prix, format) par magasin physique et par article, pour
    // l'affichage ligne à ligne uniquement (nom/prix/ratio) — le classement
    // ci-dessus ne porte que des agrégats. Réutilise resoudreIdentiteMagasin
    // et les mêmes prédicats injectés : ne réévalue aucune règle de matching,
    // de fraîcheur ou de distance, se contente de les rejouer pour lire le
    // détail que classerMagasinsPourPanier n'expose pas.
    const detailParMagasin = new Map();
    items.forEach(item => {
      priceDB.forEach(prix => {
        if (!itemMatchesPrice(item, prix)) return;
        if (!estRecentShadow(prix)) return;
        const geo = prix.store_id != null ? storeMap[prix.store_id] : undefined;
        if (!estDansRayonShadow(prix, geo)) return;
        const identite = resoudreIdentiteMagasin(prix, geo);
        if (!identite) return;
        if (!detailParMagasin.has(identite.magasinId)) detailParMagasin.set(identite.magasinId, new Map());
        const parArticle = detailParMagasin.get(identite.magasinId);
        const existant = parArticle.get(item.id);
        if (!existant || prix.price < existant.price) parArticle.set(item.id, prix);
      });
    });

    const construireLigne = (magasinId, articleId) => {
      const item = items.find(i => i.id === articleId);
      const rawEntry = detailParMagasin.get(magasinId)?.get(articleId);
      const libelle = panier.find(a => a.articleId === articleId)?.libelle ?? item?.product ?? '';
      const qty = Number(item?.qty) || 1;
      return {
        articleId,
        libelle,
        total: rawEntry ? rawEntry.price * qty : null,
        ratioLabel: rawEntry ? fmtUnitPrice(rawEntry.price, item?.format) : null,
      };
    };

    // Adresse du magasin physique — même source que le bouton "Y aller" :
    // l'adresse la plus récente parmi les lignes de prix rattachées à ce
    // magasin (detailParMagasin), null si aucune n'en porte.
    const trouverAdresseMagasin = (magasinId) => {
      const entries = Array.from(detailParMagasin.get(magasinId)?.values() ?? []);
      const adresseEntree = entries
        .filter(p => p?.store_address?.trim())
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      return adresseEntree ? adresseEntree.store_address : null;
    };

    const construireMapsUrlShadow = (magasinNom, adresse) => {
      const query = `${magasinNom}${adresse ? ' ' + adresse : ''}`;
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    };

    // #58.2.D — économie potentielle, décomposée par magasin : coût du
    // panier au prix moyen de la zone (déjà filtrée par estDansRayonShadow
    // ci-dessus, en amont de `magasins`) moins le coût réel de chaque
    // magasin retenu. Fonction pure, aucune logique de matching/filtre
    // réévaluée ici.
    const { economieTotale, economiePrincipal, economieAppoint } = calculerEconomiePotentielle(panier, magasins, classement);

    const adressePrincipal = classement.principal ? trouverAdresseMagasin(classement.principal.magasinId) : null;
    const adresseAppoint = classement.appoint ? trouverAdresseMagasin(classement.appoint.magasinId) : null;

    return {
      totalArticles: items.length,
      economieTotale,
      economiePrincipal,
      economieAppoint,
      principal: classement.principal ? {
        ...classement.principal,
        lignes: classement.principal.articlesTrouves.map(id => construireLigne(classement.principal.magasinId, id)),
        adresse: adressePrincipal,
        mapsUrl: construireMapsUrlShadow(classement.principal.magasinNom, adressePrincipal),
      } : null,
      appoint: classement.appoint ? {
        ...classement.appoint,
        lignes: classement.appoint.articlesTrouves.map(id => construireLigne(classement.appoint.magasinId, id)),
        adresse: adresseAppoint,
        mapsUrl: construireMapsUrlShadow(classement.appoint.magasinNom, adresseAppoint),
      } : null,
      nonTrouves: classement.nonTrouves,
    };
  }, [items, priceDB, storesGeo, userPos, searchRadius, vueDev, categorieParCoords, categorieMagasin]);

  // #56.4 — vrai pipeline Core (produits/prix/magasins via prix_comparables),
  // uniquement quand utiliserCore est vrai. Séquence reprise à l'identique
  // de ShadowCompareDiagnostic.jsx (mêmes fonctions, même ordre, même garde
  // d'annulation) : on ne réinvente aucune logique de matching/agrégation.
  const [coreResultat,   setCoreResultat]   = useState(null);
  const [coreChargement, setCoreChargement] = useState(false);
  const [coreErreur,     setCoreErreur]     = useState(null);

  useEffect(() => {
    if (!utiliserCore) { setCoreResultat(null); setCoreErreur(null); return; }
    // Chantier 81 — verrou de sécurité : jamais de prix sans point de
    // référence. L'écran de zone empêche déjà d'arriver ici, mais on ne
    // calcule rien tant que userPos est null (sinon faireCorrespondrePrix
    // ne filtrerait aucune distance → tous les magasins, toutes villes).
    if (!userPos) { setCoreResultat(null); setCoreErreur(null); setCoreChargement(false); return; }
    let annule = false;
    (async () => {
      try {
        setCoreChargement(true);
        setCoreErreur(null);
        const { cibles, exclusions } = construireCiblesComparaison(items);

        // Chantier 75 (révision) — un article ajouté en "toutes marques/tous
        // formats" (variante_produit_id null) n'a normalement AUCUN format
        // démontrable et reste donc exclu de la comparaison (exclusions.
        // produitIdSansFormat, inchangé). On lui donne quand même un prix par
        // magasin : pour chaque magasin qui vend ce produit_id (n'importe
        // quelle variante), on retient l'offre la MOINS CHÈRE AU KILO/LITRE/
        // PIÈCE (repli sur le prix le plus bas si aucune offre de ce magasin
        // n'a de prix unitaire calculable) — c'est ce qui rend comparables
        // des formats différents. Ces "cibles sans format" et leurs lignes
        // résolues sont ADDITIONNÉES à cibles/regroupement (jamais retirées
        // ni modifiées) : faireCorrespondrePrix/regrouperParMagasin restent
        // strictement inchangées pour les articles à format fixé.
        const itemsSansFormat = exclusions.produitIdSansFormat;
        const produitIdsSansFormat = [...new Set(itemsSansFormat.map(item => item.produit_id))];
        const produitIds = [...new Set([...cibles.map(c => c.produit_id), ...produitIdsSansFormat])];
        const cutoffISO = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
        const prixBruts = await chargerPrixComparables(produitIds, {});
        if (annule) return;

        // Comparateur v1 — profil marque GLOBAL. "nationale" = tout SAUF les
        // MDD explicites (est_mdd=true), MAIS on garde les MDD d'un produit qui
        // n'existe QU'en MDD (bascule auto -> pas de "aucun prix" trompeur).
        // "mdd" = tout autorisé. est_mdd absent (sans-marque) => national.
        const produitsAvecOffreNationale = new Set(
          prixBruts.filter(p => p?.est_mdd !== true && p?.produit_id != null).map(p => p.produit_id)
        );
        // Chantier 84 — préférence marque PAR ARTICLE (item.marque_pref, défaut
        // 'nationale'). Le fallback MDD-only est conservé et reste par produit
        // (produitsAvecOffreNationale, ci-dessus).
        const marquePrefDe = (item) => item?.marque_pref === 'mdd' ? 'mdd' : 'nationale';
        const offreAutorisee = (prixRow, marquePref) => {
          if (marquePref === 'mdd') return true;
          if (prixRow?.est_mdd !== true) return true; // national / sans-marque
          return !produitsAvecOffreNationale.has(prixRow?.produit_id); // marque distributeur gardée seulement si produit sans nationale
        };

        // Chantier 82 — zone active : un prix dont le magasin n'a pas de
        // coordonnées valides est traité comme HORS ZONE (jamais affiché).
        // Ceinture posée ici, en post-filtre, car faireCorrespondrePrix
        // (comparateurCore.js, non modifié) laisse passer ces prix : sa garde
        // distance ne s'active que si latitude/longitude sont non nuls.
        const dansZoneAvecCoords = (prixRow) => {
          if (!userPos) return true;
          return prixRow?.latitude != null && prixRow?.longitude != null;
        };

        // Chantier 83 — restreint les magasins candidats à la catégorie
        // sélectionnée (grandes surfaces / proximité), EN PLUS de la zone.
        // categorie null -> grande surface (règle par défaut). Si la map n'est
        // pas encore chargée, on ne filtre pas (l'effet re-tourne au chargement).
        const bonneCategorie = (magId) => {
          if (categorieParMagasin.size === 0) return true;
          return (categorieParMagasin.get(magId) || 'grande_surface') === categorieMagasin;
        };

        const correspondancesFraiches = faireCorrespondrePrix(cibles, prixBruts, { userPos, searchRadius, staleCutoffISO: cutoffISO });
        // Post-filtre marque + zone + catégorie additif AVANT le regroupement.
        // Ne touche pas comparateurCore.js.
        const correspondancesFiltrees = correspondancesFraiches.map(c => {
          const mp = marquePrefDe(c.item); // préférence de CET article
          return {
            ...c,
            correspondances: (c.correspondances || []).filter(pr => offreAutorisee(pr, mp) && dansZoneAvecCoords(pr) && bonneCategorie(pr.magasin_id)),
          };
        });
        const regroupement = regrouperParMagasin(correspondancesFiltrees);

        const ciblesSansFormat = [];
        const regroupementEtendu = { ...regroupement };
        itemsSansFormat.forEach(item => {
          ciblesSansFormat.push({ itemId: item.id, produit_id: item.produit_id, item });

          const marquePrefItem = marquePrefDe(item); // préférence de CET article
          const candidats = prixBruts.filter(p => {
            if (p.produit_id !== item.produit_id) return false;
            if (p.magasin_id == null) return false;
            // Préférence marque de l'article (même règle que le post-filtre).
            if (!offreAutorisee(p, marquePrefItem)) return false;
            if (!dansZoneAvecCoords(p)) return false; // Chantier 82 — hors zone si magasin sans coords
            if (!bonneCategorie(p.magasin_id)) return false; // Chantier 83 — catégorie sélectionnée
            if (p.observe_le && new Date(p.observe_le) < new Date(cutoffISO)) return false;
            if (userPos && searchRadius != null && p.latitude != null && p.longitude != null) {
              if (distanceKm(userPos.lat, userPos.lng, p.latitude, p.longitude) > searchRadius) return false;
            }
            return true;
          });
          if (candidats.length === 0) return;

          const parMagasin = new Map();
          candidats.forEach(p => {
            if (!parMagasin.has(p.magasin_id)) parMagasin.set(p.magasin_id, []);
            parMagasin.get(p.magasin_id).push(p);
          });

          parMagasin.forEach((lignesMagasin, magasinId) => {
            const enrichies = lignesMagasin.map(p => ({ p, unitaire: calculerPrixUnitaire({ prix: p.prix_total }, p) }));
            const avecUnitaire = enrichies.filter(e => e.unitaire);
            const choisi = avecUnitaire.length > 0
              ? avecUnitaire.reduce((a, b) => (a.unitaire.valeur <= b.unitaire.valeur ? a : b)).p
              : lignesMagasin.reduce((a, b) => (a.prix_total <= b.prix_total ? a : b));

            if (!regroupementEtendu[magasinId]) regroupementEtendu[magasinId] = [];
            regroupementEtendu[magasinId] = [...regroupementEtendu[magasinId], { itemId: item.id, produit_id: item.produit_id, prix: choisi }];
          });
        });

        const ciblesEtendues = [...cibles, ...ciblesSansFormat];
        const totauxParMagasin = calculerTotauxMagasins(regroupementEtendu, ciblesEtendues);
        const classement = classerMagasins(totauxParMagasin);
        if (!annule) setCoreResultat({ classement, regroupement: regroupementEtendu, exclusions, cibles: ciblesEtendues });
      } catch (err) {
        if (!annule) { setCoreErreur(err?.message || 'Erreur inconnue'); setCoreResultat(null); }
      } finally {
        if (!annule) setCoreChargement(false);
      }
    })();
    return () => { annule = true; };
  }, [utiliserCore, items, userPos, searchRadius, categorieMagasin, categorieParMagasin]);

  // Adaptateur — résultat comparateurCore.js → même forme que analysis/ranked
  // legacy (ci-dessous), pour alimenter les cartes existantes sans les
  // modifier. N'invente jamais de prix : un magasin sans correspondance
  // n'apparaît simplement pas dans byStore pour cet article (identique au
  // comportement legacy quand priceDB n'a rien).
  const coreAdapte = useMemo(() => {
    if (!utiliserCore || !coreResultat) return null;
    const { classement, regroupement, exclusions, cibles } = coreResultat;

    const parItemMagasin = new Map();
    Object.entries(regroupement).forEach(([magasinId, lignes]) => {
      lignes.forEach(ligne => {
        if (!parItemMagasin.has(ligne.itemId)) parItemMagasin.set(ligne.itemId, {});
        const prixLigne = ligne.prix;
        parItemMagasin.get(ligne.itemId)[magasinId] = {
          ...prixLigne,
          price: prixLigne.prix_total,
          date: prixLigne.observe_le,
          store_address: prixLigne.adresse_magasin || '',
        };
      });
    });

    const analysisCore = items.map(item => ({
      item,
      byStore: parItemMagasin.get(item.id) || {},
    }));

    const rankedCore = classement.map(entree => {
      const premierPrix = entree.articlesTrouves[0]?.prix;
      return {
        id: entree.magasinId,
        name: premierPrix?.nom_magasin || 'Magasin',
        logo: STORES.find(s => s.id === premierPrix?.slug_enseigne)?.logo || '🏪',
        total: entree.total,
        found: entree.found,
        missing: entree.articlesManquants.map(c => c.item.product),
      };
    });

    // "Manquant partout" en mode Core : exclu du pipeline (alias/format non
    // démontrable) OU cible reconnue mais 0 correspondance dans aucun magasin.
    const idsAvecCorrespondance = new Set();
    Object.values(regroupement).forEach(lignes => lignes.forEach(l => idsAvecCorrespondance.add(l.itemId)));
    const missingGlobalCore = items.filter(item => {
      const cible = cibles.find(c => c.itemId === item.id);
      if (!cible) return true;
      return !idsAvecCorrespondance.has(item.id);
    });

    return { analysis: analysisCore, ranked: rankedCore, missingGlobal: missingGlobalCore, exclusions };
  }, [utiliserCore, coreResultat, items]);

  if(items.length===0) return (
    <div style={{ padding:"40px 20px 100px", textAlign:"center" }}>
      <div style={{ fontSize:60, marginBottom:14 }}>🏪</div>
      <div style={{ fontFamily:F, fontWeight:900, fontSize:17, color:"#CC0000", marginBottom:6 }}>Ta liste est vide</div>
      <div style={{ fontFamily:F, fontSize:13, color:C.textLight }}>Ajoute des produits dans "Liste" pour comparer</div>
    </div>
  );

  // Chantier géoloc comparateur — tant qu'aucun point de référence n'existe
  // (GPS jamais accepté et rien de mémorisé/saisi), CE sélecteur remplace la
  // liste de prix dans le rendu final (jamais de comparaison sans point — le
  // bug d'origine montrait tous les prix, toutes villes confondues). Construit
  // ici comme une simple valeur JSX, PAS comme un early return : userPos peut
  // changer de null à défini pendant que ce composant est monté (résolution
  // GPS après l'ouverture), et un early return avant les hooks ci-dessous
  // (analysis, storeTotals, lastVerified) romprait alors l'ordre des Hooks
  // React entre deux rendus du même montage.
  const zoneManquante = !userPos || zoneEditOpen;
  const selecteurZone = (
    <>
      {userPos && (
        <button onClick={()=>setZoneEditOpen(false)} style={{ background:"none", border:"none", padding:0, marginBottom:14, fontFamily:F, fontWeight:700, fontSize:13, color:C.textLight, cursor:"pointer" }}>
          ← Annuler
        </button>
      )}
      <div style={{ fontSize:44, textAlign:"center", marginBottom:10 }}>📍</div>
      <div style={{ fontFamily:F, fontWeight:900, fontSize:16, color:C.text, textAlign:"center", marginBottom:6 }}>D'où fais-tu tes courses ?</div>
      <div style={{ fontFamily:F, fontSize:13, color:C.textLight, textAlign:"center", marginBottom:20 }}>
        On compare les prix autour de ce point — chez toi, au travail, où tu veux.
      </div>

      <button onClick={utiliserGps} disabled={gpsEnCours} style={{ width:"100%", padding:"14px", marginBottom:10, border:"none", borderRadius:14, background:gpsEnCours?C.grayLight:C.blue, fontFamily:F, fontWeight:900, fontSize:15, color:"#fff", cursor:gpsEnCours?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
        📍 {gpsEnCours ? "Localisation..." : "Utiliser ma position (GPS)"}
      </button>
      {gpsError && <div style={{ fontFamily:F, fontSize:12, color:C.red, marginBottom:10, textAlign:"center" }}>⚠️ {gpsError}</div>}

      <div style={{ textAlign:"center", fontFamily:F, fontSize:12, color:C.textLight, margin:"10px 0" }}>ou</div>

      <input
        ref={inputRef}
        value={adresseSaisie}
        onChange={e=>setAdresseSaisie(e.target.value)}
        onKeyDown={e=>{ if (e.key === 'Enter' && suggestions[0]) choisirSuggestion(suggestions[0]); }}
        placeholder="Adresse, ville ou code postal"
        autoComplete="off"
        style={{ width:"100%", padding:"12px 14px", borderRadius:12, border:`2px solid ${C.grayLight}`, fontFamily:F, fontSize:14, boxSizing:"border-box" }}
      />
      {suggestions.length > 0 && (
        <div style={{ marginTop:6, border:`1px solid ${C.grayLight}`, borderRadius:12, overflow:"hidden" }}>
          {suggestions.map((f, i) => (
            <button key={f.properties?.id || i} onClick={()=>choisirSuggestion(f)}
              style={{ display:"block", width:"100%", textAlign:"left", padding:"11px 14px", border:"none",
                       borderTop: i === 0 ? "none" : `1px solid ${C.grayLight}`, background:"#fff",
                       fontFamily:F, fontSize:14, color:C.text, cursor:"pointer" }}>
              {f.properties?.label}
            </button>
          ))}
        </div>
      )}

      {/* Chantier 81 — le rayon se règle ICI, mais seulement quand on MODIFIE
          une zone existante (userPos défini). Au tout premier choix de zone,
          aucun choix de rayon : 10 km par défaut appliqué en silence. */}
      {userPos && (
        <div style={{ marginTop:24 }}>
          <div style={{ fontFamily:F, fontWeight:800, fontSize:13, color:C.text, marginBottom:8 }}>Rayon autour du point</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {[2,5,10,20,50,100].map(r=>(
              <button key={r} onClick={()=>setSearchRadius(r)} style={{
                padding:"6px 14px", borderRadius:20, border:"none", cursor:"pointer",
                fontFamily:F, fontWeight:700, fontSize:13,
                background: searchRadius===r ? "#CC0000" : "#f0f0f0",
                color: searchRadius===r ? "#fff" : "#333",
                whiteSpace:"nowrap"
              }}>{r} km</button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  // Chantier 81 — écran de chargement neutre le temps que la zone soit résolue
  // (localStorage + filet Supabase). Évite tout clignotement de l'écran de
  // zone avant que le point mémorisé ne soit connu.
  const ecranChargement = (
    <div style={{ padding:"48px 20px", textAlign:"center", fontFamily:F, color:C.textLight }}>
      <div style={{ fontSize:26, marginBottom:10 }}>⏳</div>
      <div style={{ fontSize:14 }}>Chargement de ta zone…</div>
    </div>
  );

  const analysis = useMemo(()=>{
    const storeMap = Object.fromEntries(storesGeo.map(s => [s.id, s]));
    return items.map(item=>{
      const matches = priceDB.filter(p=>itemMatchesPrice(item,p));
      const byStore = {};
      const cutoff = Date.now() - STALE_DAYS * 86400000;
      matches.forEach(p=>{
        if(new Date(p.date).getTime() < cutoff) return;
        if(!userPos) return; // Chantier 81 — jamais de prix sans point de référence
        const geo = p.store_id ? storeMap[p.store_id] : null;
        if(p.store_id) {
          // Chantier 82 — magasin sans coordonnées valides → hors zone (exclu)
          if(!geo || geo.latitude == null || geo.longitude == null) return;
          if(distanceKm(userPos.lat, userPos.lng, geo.latitude, geo.longitude) > searchRadius) return;
        }
        // Chantier 84 — restriction catégorie aussi sur le moteur legacy (magasin
        // sans coords / sans store => grande surface par défaut).
        if((categorieParCoords.get(cleCoords(geo?.latitude, geo?.longitude)) || 'grande_surface') !== categorieMagasin) return;
        if(!byStore[p.storeId]||p.price<byStore[p.storeId].price) byStore[p.storeId]=p;
      });
      return { item, byStore };
    });
  },[items, priceDB, userPos, searchRadius, storesGeo, categorieParCoords, categorieMagasin]);

  const storeTotals = useMemo(()=>{
    const totals={};

    // Filtrer les magasins selon le rayon. Chantier 81 — sans point de
    // référence, aucun magasin (jamais de prix toutes-villes confondues).
    const storesInRange = userPos
      ? storesGeo.filter(s => {
          if(!s.latitude || !s.longitude) return false; // Chantier 82 — magasin sans coords → hors zone
          if(distanceKm(userPos.lat, userPos.lng, s.latitude, s.longitude) > searchRadius) return false;
          // Chantier 84 — restriction catégorie aussi sur le moteur legacy.
          if((categorieParCoords.get(cleCoords(s.latitude, s.longitude)) || 'grande_surface') !== categorieMagasin) return false;
          return true;
        })
      : [];

    // Fallback : si storesGeo pas encore chargé, utiliser toutes les enseignes
    const activeStores = storesGeo.length === 0
      ? STORES
      : STORES.filter(s =>
          storesInRange.some(sg => sg.enseigne === s.id || sg.enseigne === s.id.replace('superu','systemu'))
        );

    activeStores.forEach(s=>{ totals[s.id]={total:0,found:0,missing:[]}; });
    analysis.forEach(({item,byStore})=>{
      activeStores.forEach(s=>{
        if(byStore[s.id]){ totals[s.id].total+=byStore[s.id].price*item.qty; totals[s.id].found+=1; }
        else              { totals[s.id].missing.push(item.product); }
      });
    });
    return totals;
  },[analysis, userPos, searchRadius, storesGeo, categorieParCoords, categorieMagasin]);

  const ranked          = STORES.map(s=>({...s,...storeTotals[s.id]})).filter(s=>s.found>0).sort((a,b)=>b.found!==a.found?b.found-a.found:a.total-b.total);
  const best            = ranked[0];
  const secondBest      = ranked[1] ?? null;
  const worstTotal      = ranked.length>1 ? ranked[ranked.length-1].total : 0;
  const savingsVsSecond = (best && secondBest) ? secondBest.total - best.total : 0;

  const bestStoreEntry = best
    ? analysis
        .map(({ byStore }) => byStore[best.id])
        .filter(p => p?.store_address?.trim())
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0] ?? null
    : null;
  const mapsQuery      = best ? `${best.name}${bestStoreEntry ? ' ' + bestStoreEntry.store_address : ''}` : '';
  const mapsUrl        = best ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : '#';
  const maxSavings   = best ? worstTotal - best.total : 0;
  const totalItems   = items.reduce((a,i)=>a+i.qty,0);
  const missingGlobal= items.filter(item=>!priceDB.some(p=>itemMatchesPrice(item,p)));

  // #56.4 — variables "Affichée" : legacy par défaut, Core uniquement si
  // utiliserCore. Tout ce qui précède (analysis, ranked, best,
  // secondBest, missingGlobal...) reste inchangé et continue d'exister —
  // utiliserCore===false garde donc un comportement identique à avant.
  const analysisAffichee       = utiliserCore ? (coreAdapte?.analysis ?? []) : analysis;
  const rankedAffiche          = utiliserCore ? (coreAdapte?.ranked ?? []) : ranked;
  const bestAffiche            = rankedAffiche[0];
  const secondBestAffiche      = rankedAffiche[1] ?? null;
  const worstTotalAffiche      = rankedAffiche.length > 1 ? rankedAffiche[rankedAffiche.length - 1].total : 0;
  const savingsVsSecondAffiche = (bestAffiche && secondBestAffiche) ? secondBestAffiche.total - bestAffiche.total : 0;
  const bestStoreEntryAffiche  = bestAffiche
    ? analysisAffichee
        .map(({ byStore }) => byStore[bestAffiche.id])
        .filter(p => p?.store_address?.trim())
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0] ?? null
    : null;
  const mapsQueryAffichee   = bestAffiche ? `${bestAffiche.name}${bestStoreEntryAffiche ? ' ' + bestStoreEntryAffiche.store_address : ''}` : '';
  const mapsUrlAffiche      = bestAffiche ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQueryAffichee)}` : '#';
  const maxSavingsAffiche   = bestAffiche ? worstTotalAffiche - bestAffiche.total : 0;
  const missingGlobalAffiche = utiliserCore ? (coreAdapte?.missingGlobal ?? []) : missingGlobal;

  // Chantier 83 — magasins de chaque catégorie réellement présents dans la zone
  // (rayon), indépendamment des produits : distingue « aucun magasin de cette
  // catégorie ici » d'un simple « pas de prix ». categorie null -> grande surface.
  // Calcul simple (≤ 14 magasins), pas un hook : évite d'ajouter un useMemo
  // après le early return items.length===0 ci-dessus.
  const comptesCategorieEnZone = (() => {
    if (!userPos) return { choisie: 0, autre: 0 };
    let choisie = 0, autre = 0;
    magasinsCat.forEach(m => {
      if (m.latitude == null || m.longitude == null) return;
      if (distanceKm(userPos.lat, userPos.lng, m.latitude, m.longitude) > searchRadius) return;
      if ((m.categorie || 'grande_surface') === categorieMagasin) choisie++; else autre++;
    });
    return { choisie, autre };
  })();
  const categorieVideEnZone = magasinsCat.length > 0 && comptesCategorieEnZone.choisie === 0;
  const autreCategorie = categorieMagasin === 'grande_surface' ? 'proximite' : 'grande_surface';
  const libelleCategorie = (c) => c === 'proximite' ? 'proximité' : 'grandes surfaces';

  const [lastVerified, setLastVerified] = useState(null);
  useEffect(() => {
    if (!bestAffiche) { setLastVerified(null); return; }
    let mostRecent = null;
    analysisAffichee.forEach(({ byStore }) => {
      const p = byStore[bestAffiche.id];
      if (p && (!mostRecent || new Date(p.date) > new Date(mostRecent.date))) mostRecent = p;
    });
    if (!mostRecent?.user_id) { setLastVerified(null); return; }
    supabase.from('profiles').select('pseudo').eq('id', mostRecent.user_id).maybeSingle()
      .then(({ data }) => {
        const days = Math.floor((Date.now() - new Date(mostRecent.date)) / 86400000);
        const dateLabel = days === 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`;
        setLastVerified({ dateLabel, pseudo: data?.pseudo || 'un utilisateur' });
      });
  }, [bestAffiche?.id]);

  return (
    <div style={{ padding: (!zonePrete || zoneManquante) ? "24px 20px 100px" : "16px 16px 110px" }}>
      {/* Chantier 83 (finition) — retour à la liste : bouton plein bien visible
          (‹ + libellé), cohérent avec les accents de l'app. */}
      <button onClick={()=>setTab?.('list')} aria-label="Retour à la liste"
        style={{ display:"inline-flex", alignItems:"center", gap:6, marginBottom:14, padding:"9px 16px 9px 12px", background:C.orange, border:"none", borderRadius:12, fontFamily:F, fontWeight:900, fontSize:15, color:"#111111", cursor:"pointer", boxShadow:"0 3px 10px rgba(0,0,0,0.15)" }}>
        <span style={{ fontSize:24, lineHeight:1, marginTop:-2 }}>‹</span> Ma liste
      </button>
      {!zonePrete ? ecranChargement : zoneManquante ? selecteurZone : (
      <>
      {/* Chantier 81 — zone active DISCRÈTE : tout l'élément est cliquable et
          rouvre le sélecteur (changement de point ET de rayon). Plus de rangée
          de rayons ni de bandeau sur l'écran des prix ; aucune redemande auto. */}
      <button onClick={()=>setZoneEditOpen(true)}
        style={{ display:"inline-flex", alignItems:"center", gap:6, marginBottom:16, padding:"6px 12px",
                 maxWidth:"100%", background:"#f4f4f4", border:"none", borderRadius:20, cursor:"pointer",
                 fontFamily:F, fontWeight:700, fontSize:13, color:C.text }}>
        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          📍 {zoneLabel || "Ma position"} · {searchRadius} km
        </span>
        <span style={{ color:C.textLight, fontSize:11, flexShrink:0 }}>✏️</span>
      </button>

      {/* Chantier 83 — toggle catégorie de magasins (grandes surfaces /
          proximité), même modèle visuel que le toggle Marque nationale/MDD.
          Indépendant du profil marque ; défaut auto selon la taille de la liste
          (< 6 -> proximité, >= 6 -> grandes surfaces), respecté si l'utilisateur
          bascule manuellement. */}
      <div style={{ marginBottom:16 }}>
        <div style={{ display:"inline-flex", borderRadius:8, overflow:"hidden", border:`1px solid ${C.grayLight}` }}>
          <button onClick={()=>setCategorieMagasin?.('grande_surface')} style={{ padding:"6px 14px", border:"none", cursor:"pointer", fontFamily:F, fontWeight:800, fontSize:12, background:categorieMagasin==='grande_surface'?C.blue:C.white, color:categorieMagasin==='grande_surface'?C.white:C.gray }}>
            Grandes surfaces
          </button>
          <button onClick={()=>setCategorieMagasin?.('proximite')} style={{ padding:"6px 14px", border:"none", cursor:"pointer", fontFamily:F, fontWeight:800, fontSize:12, background:categorieMagasin==='proximite'?C.blue:C.white, color:categorieMagasin==='proximite'?C.white:C.gray }}>
            Proximité
          </button>
        </div>
      </div>

      {/* Résumé liste */}
      <div style={{ background:C.blue, borderRadius:14, padding:"14px 18px", marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ fontSize:30 }}>🛒</div>
        <div>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:C.white }}>
            {items.length} produit{items.length>1?"s":""} · {totalItems} article{totalItems>1?"s":""}
          </div>
          {maxSavingsAffiche>0.05 && (
            <div style={{ fontFamily:F, fontSize:12, color:"rgba(255,255,255,0.75)", marginTop:2 }}>
              Jusqu'à <strong style={{ color:"#FFD700" }}>{maxSavingsAffiche.toFixed(2)} €</strong> d'écart entre magasins
            </div>
          )}
        </div>
      </div>

      {/* #56.6 — badge réservé à l'override admin explicite (isAdmin && modeCoreActif===true),
          jamais lié au réglage global lui-même : un non-admin ne le voit jamais. */}
      {badgeDebugVisible && (
        <div style={{ background:"#8E44AD", borderRadius:10, padding:"8px 14px", marginBottom:14, textAlign:"center", fontFamily:F, fontWeight:800, fontSize:12, color:"#fff", letterSpacing:"0.03em" }}>
          🔧 MODE CORE — debug
        </div>
      )}
      {utiliserCore && coreChargement && (
        <div style={{ textAlign:"center", padding:"20px", fontFamily:F, fontSize:13, color:C.textLight }}>Chargement des prix…</div>
      )}
      {utiliserCore && coreErreur && (
        <div style={{ background:"#FEE", borderRadius:12, padding:"14px", marginBottom:14, fontFamily:F, fontSize:13, color:C.red, fontWeight:700 }}>
          ⚠️ Problème de chargement des prix, réessaie plus tard.
        </div>
      )}

      {/* #58.2.B étape 2 — interrupteur dev uniquement, n'existe pas en prod */}
      {import.meta.env.DEV && (
        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          <button
            onClick={()=>setVueDev('actuelle')}
            style={{ flex:1, padding:"8px 10px", borderRadius:10, border:`2px solid ${vueDev==='actuelle'?C.blue:C.grayLight}`, background:vueDev==='actuelle'?C.blue:"#fff", fontFamily:F, fontWeight:800, fontSize:12, color:vueDev==='actuelle'?C.white:C.textLight, cursor:"pointer" }}
          >
            Vue actuelle
          </button>
          <button
            onClick={()=>setVueDev('nouvelle')}
            style={{ flex:1, padding:"8px 10px", borderRadius:10, border:`2px solid ${vueDev==='nouvelle'?C.green:C.grayLight}`, background:vueDev==='nouvelle'?C.green:"#fff", fontFamily:F, fontWeight:800, fontSize:12, color:vueDev==='nouvelle'?C.white:C.textLight, cursor:"pointer" }}
          >
            🧪 Nouvelle vue (classement)
          </button>
        </div>
      )}

      {vueDev === 'actuelle' && !(utiliserCore && coreChargement) && (
        <>
      {/* Chantier 83 — aucun magasin de la catégorie choisie dans la zone :
          message clair + bascule vers l'autre catégorie / élargir le rayon
          (jamais un comparatif vide sans explication). */}
      {categorieVideEnZone && (
        <div style={{ background:C.orangeLight, borderRadius:14, padding:"22px 20px", textAlign:"center", border:`2px dashed ${C.orange}`, marginBottom:14 }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🏪</div>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:C.orange, marginBottom:6 }}>
            Aucun magasin de {libelleCategorie(categorieMagasin)} dans ta zone
          </div>
          <div style={{ fontFamily:F, fontSize:13, color:C.textLight, marginBottom:14 }}>
            Rayon actuel : {searchRadius} km.{comptesCategorieEnZone.autre>0 ? ` Il y a des magasins de ${libelleCategorie(autreCategorie)} à proximité.` : ''}
          </div>
          <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
            {comptesCategorieEnZone.autre>0 && (
              <button onClick={()=>setCategorieMagasin?.(autreCategorie)} style={{ padding:"9px 16px", border:"none", borderRadius:12, background:C.blue, color:"#fff", fontFamily:F, fontWeight:800, fontSize:13, cursor:"pointer" }}>
                Voir les {libelleCategorie(autreCategorie)}
              </button>
            )}
            <button onClick={()=>setZoneEditOpen(true)} style={{ padding:"9px 16px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:"#fff", color:C.text, fontFamily:F, fontWeight:800, fontSize:13, cursor:"pointer" }}>
              Élargir le rayon
            </button>
          </div>
        </div>
      )}

      {/* Aucun prix */}
      {rankedAffiche.length===0 && !categorieVideEnZone && (
        <div style={{ background:C.orangeLight, borderRadius:14, padding:"24px 20px", textAlign:"center", border:`2px dashed ${C.orange}` }}>
          <div style={{ fontSize:40, marginBottom:10 }}>💰</div>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:C.orange, marginBottom:6 }}>Aucun prix correspondant</div>
          <div style={{ fontFamily:F, fontSize:13, color:C.textLight }}>Vérifie le <strong>nom</strong> et le <strong>format</strong> dans "Mes prix".</div>
        </div>
      )}

      {/* Produits sans aucun prix */}
      {missingGlobalAffiche.length>0 && rankedAffiche.length>0 && (
        <div style={{ background:"#FFF8E6", borderRadius:12, padding:"12px 14px", marginBottom:14, border:`1px solid ${C.yellow}` }}>
          <div style={{ fontFamily:F, fontWeight:800, fontSize:13, color:"#7A6000", marginBottom:6 }}>⚠️ Aucun prix enregistré pour :</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {missingGlobalAffiche.map(item=>(
              <span key={item.id} style={{ background:C.yellow, borderRadius:99, padding:"3px 10px", fontFamily:F, fontSize:12, fontWeight:700, color:C.text }}>
                {item.brand?`${item.brand} · `:""}{item.product} {item.format}
              </span>
            ))}
          </div>
        </div>
      )}

      {rankedAffiche.length>0 && (
        <>
          {/* ── MEILLEUR MAGASIN (grand) ── */}
          <div style={{ background:"linear-gradient(145deg,#CC0000,#E00000)", borderRadius:18, overflow:"hidden", marginBottom:16, boxShadow:"0 10px 32px rgba(204,0,0,0.45)", animation:"slideIn 0.3s ease both" }}>

            {/* Badge + Prix total */}
            <div style={{ padding:"18px 18px 0", display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
              <div style={{ background:C.orange, borderRadius:8, padding:"4px 12px", fontFamily:F, fontWeight:900, fontSize:11, color:C.white, letterSpacing:"0.04em" }}>
                🥇 {bestAffiche.missing.length > 0 ? "MEILLEUR PRIX PARTIEL" : "MEILLEUR PRIX"}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:34, color:C.white, lineHeight:1 }}>{bestAffiche.total.toFixed(2)} €</div>
                {bestAffiche.missing.length > 0 && (
                  <div style={{ fontFamily:F, fontSize:11, color:"#FFD700", fontWeight:700, marginTop:4 }}>
                    Prix pour {bestAffiche.found} article{bestAffiche.found>1?"s":""} sur {items.length} — panier incomplet
                  </div>
                )}
                {maxSavingsAffiche>0.05 && <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.6)", marginTop:2 }}>−{maxSavingsAffiche.toFixed(2)} € vs le + cher</div>}
              </div>
            </div>

            {/* Nom magasin */}
            <div style={{ padding:"10px 18px 14px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                <span style={{ fontSize:26 }}>{bestAffiche.logo}</span>
                <div>
                  <div style={{ fontFamily:F, fontWeight:900, fontSize:20, color:C.white }}>{bestAffiche.name}</div>
                  {/* Chantier 83 (finition) — adresse + code postal (et ville) du
                      magasin, discret, sous le nom. Le CP est un champ à part de
                      prix_comparables (adresse_magasin = rue seule). */}
                  {bestStoreEntryAffiche?.store_address && (
                    <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.6)", marginTop:2 }}>
                      {bestStoreEntryAffiche.store_address}
                      {bestStoreEntryAffiche.code_postal
                        ? `, ${bestStoreEntryAffiche.code_postal}${bestStoreEntryAffiche.ville ? ' ' + bestStoreEntryAffiche.ville : ''}`
                        : ''}
                    </div>
                  )}
                  <div style={{ fontFamily:F, fontSize:12, color:"rgba(255,255,255,0.6)" }}>
                    {bestAffiche.found}/{items.length} produit{items.length>1?"s":""} trouvé{bestAffiche.found>1?"s":""}
                    {bestAffiche.missing.length>0 && <span style={{ color:"#FFD700" }}> · {bestAffiche.missing.length} manquant{bestAffiche.missing.length>1?"s":""}</span>}
                  </div>
                  {lastVerified && (
                    <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.85)", fontWeight:500, marginTop:3 }}>
                      Dernier prix vérifié {lastVerified.dateLabel} par {lastVerified.pseudo}
                    </div>
                  )}
                </div>
              </div>
              <a href={mapsUrlAffiche} target="_blank" rel="noopener noreferrer"
                style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:"#fff", border:"2px solid #D32F2F", borderRadius:20, padding:"10px 18px", fontFamily:F, fontWeight:700, fontSize:14, color:"#D32F2F", textDecoration:"none", boxShadow:"0 2px 6px rgba(0,0,0,0.15)" }}>
                📍 Y aller
              </a>
            </div>

            {/* Liste des articles */}
            <div style={{ background:"rgba(0,0,0,0.18)", marginBottom:12 }}>
              {analysisAffichee.map(({item,byStore})=>{
                const p     = byStore[bestAffiche.id];
                const total = p ? p.price*item.qty : null;
                return (
                  <div key={item.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 18px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontFamily:F, fontWeight:700, fontSize:13, color:"rgba(255,255,255,0.92)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {item.brand?`${item.brand} · `:""}{item.product}
                        {/* Chantier 84 — badge générique « Marque Distributeur »
                            quand l'offre retenue en est une (est_mdd). Jamais le
                            nom de la sous-marque distributeur. */}
                        {utiliserCore && p?.est_mdd === true && (
                          <span style={{ marginLeft:6, background:"rgba(255,255,255,0.22)", color:"#fff", borderRadius:5, padding:"1px 5px", fontSize:9, fontWeight:900, verticalAlign:"middle", whiteSpace:"nowrap" }}>Marque Distributeur</span>
                        )}
                      </div>
                      <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:1 }}>
                        {item.format}{item.qty>1?` × ${item.qty}`:""}
                      </div>
                    </div>
                    {total!==null ? (
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:"#FFD700" }}>{total.toFixed(2)} €</div>
                        {item.qty>1 && <div style={{ fontFamily:F, fontSize:10, color:"rgba(255,255,255,0.4)" }}>{p.price.toFixed(2)} €/u</div>}
                        {fmtUnitPrice(p.price, item.format) && (
                          <div style={{ fontFamily:F, fontSize:10, color:"rgba(255,255,255,0.35)", marginTop:1 }}>{fmtUnitPrice(p.price, item.format)}</div>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontFamily:F, fontSize:12, fontWeight:800, color:"#FFD700", flexShrink:0 }}>⚠️ manquant</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bouton valider */}
            <div style={{ padding:"0 12px 16px" }}>
              <button onClick={()=>{
                // Chantier « Courses » — bascule générale 2026-08-12 : en mode
                // Core, transmet en 3e argument (additif) les lignes de prix
                // RETENUES du magasin gagnant, pour figer la session de
                // courses côté racine. En mode legacy (pas de magasin réel),
                // extrasCourses est null et onValidate garde le flux
                // historique (archive + vidage + Historique).
                // Chantier 87 Lot 1 — sessionCoursesAccessible (flag global OU
                // François) : sans accès, extrasCourses reste null et la
                // validation suit le flux historique, comme avant la session.
                const extrasCourses = (utiliserCore && coreResultat && sessionCoursesAccessible)
                  ? {
                      magasinId: bestAffiche.id,
                      nomEnseigne: coreResultat.regroupement[bestAffiche.id]?.[0]?.prix?.nom_enseigne ?? null,
                      adresse: bestStoreEntryAffiche ? {
                        adresse: bestStoreEntryAffiche.store_address ?? null,
                        code_postal: bestStoreEntryAffiche.code_postal ?? null,
                        ville: bestStoreEntryAffiche.ville ?? null,
                      } : null,
                      lignesPrix: coreResultat.regroupement[bestAffiche.id] ?? [],
                    }
                  : null;
                onValidate(bestAffiche, savingsVsSecondAffiche, extrasCourses);
              }} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:C.orange, fontFamily:F, fontWeight:900, fontSize:16, color:"#111", cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.25)" }}>
                ✅ Je fais mes courses chez {bestAffiche.name}
              </button>

              {secondBestAffiche && savingsVsSecondAffiche > 0 && (
                <div style={{ fontFamily:F, fontSize:12, color:"rgba(255,255,255,0.75)", textAlign:"center", marginTop:10 }}>
                  Avec cette liste de courses, aujourd'hui <strong style={{ color:"#FFD700" }}>{bestAffiche.name}</strong> est le plus malin · tu économises <strong style={{ color:"#FFD700" }}>{savingsVsSecondAffiche.toFixed(2)} €</strong>
                </div>
              )}

            </div>

            {/* Suggestions pour produits manquants — après le bouton */}
            {analysisAffichee.some(({byStore})=>!byStore[bestAffiche.id]&&Object.keys(byStore).length>0) && (
              <div style={{ padding:"0 12px 16px", display:"flex", flexDirection:"column", gap:6 }}>
                {analysisAffichee
                  .filter(({byStore})=>!byStore[bestAffiche.id]&&Object.keys(byStore).length>0)
                  .map(({item,byStore})=>{
                    const alt = Object.entries(byStore)
                      .map(([sid,pr])=>({ store: utiliserCore ? { logo:'🏪', name: pr?.nom_magasin || 'Magasin' } : STORES.find(s=>s.id===sid), pr }))
                      .sort((a,b)=>a.pr.price-b.pr.price)[0];
                    return (
                      <div key={item.id} style={{ background:"rgba(255,255,255,0.1)", borderRadius:8, padding:"8px 12px", display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:14 }}>{alt?.store?.logo}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontFamily:F, fontWeight:800, fontSize:12, color:"rgba(255,255,255,0.9)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {item.brand?`${item.brand} · `:""}{item.product} <span style={{ fontWeight:600, color:"rgba(255,255,255,0.5)" }}>{item.format}</span>
                          </div>
                          <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.5)", marginTop:1 }}>
                            disponible chez <span style={{ fontWeight:800, color:"rgba(255,255,255,0.75)" }}>{alt?.store?.name}</span>
                          </div>
                        </div>
                        <div style={{ fontFamily:F, fontWeight:900, fontSize:13, color:"rgba(255,255,255,0.8)", flexShrink:0 }}>
                          {alt ? (alt.pr.price*item.qty).toFixed(2)+" €" : "—"}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

        </>
      )}
        </>
      )}

      {import.meta.env.DEV && vueDev === 'nouvelle' && shadowPanier && (
        <ClassementPanierShadow resultat={shadowPanier} />
      )}
      </>
      )}
    </div>
  );
}

// ── ARCHIVE TAB ───────────────────────────────────────────────────────────────
function ArchiveTab({ archives, storeRatings = {}, onDelete, onAddToList, priceDB, onImport, onSavePrice, produitsRef = [], libelleVersNomProduit = {}, onLibelleResolu, estFrancois = false }) {
  // Chantier 1 — affichage seulement : si la ligne de ticket correspondante
  // est rattachée à un produit Core (résolu au chargement dans App, via
  // lignes_ticket.produit_id), on montre nom_reference à la place du libellé
  // brut du ticket. Sinon on garde item.product tel quel (comportement
  // identique à avant). Ne touche ni item.product ni aucune donnée en base —
  // seule la chaîne rendue à l'écran change.
  const nomAffiche = (item) => libelleVersNomProduit[normName(item.product)] || item.product;
  // Chantier 2 — correction d'un article depuis le détail ticket : { arc, item } de l'article tapé.
  const [correctionCible, setCorrectionCible] = useState(null);
  // Chantier 2b — enseigne du ticket en cours (magasins.enseigne_id), pour
  // faire remonter en tête les produits déjà vus dans cette enseigne côté
  // RPC de recherche. null si non résolue (recherche non filtrée/triée par
  // enseigne dans ce cas, jamais bloquante).
  const [enseigneCourante, setEnseigneCourante] = useState(null);
  const [pendingDeleteArc, setPendingDeleteArc] = useState(null);
  const [added, setAdded] = useState(new Set());
  const [sort, setSort] = useState("produit");
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterPeriod, setFilterPeriod] = useState("all");
  const [showImport, setShowImport] = useState(false);
  const [showEntry, setShowEntry] = useState(false);
  const [subTab, setSubTab] = useState("produit");
  const [selectedMonth, setSelectedMonth] = useState(null);

  // Chantier 2 — retrouve la (les) ligne(s) lignes_ticket correspondant à cet
  // article d'archive, via la même correspondance textuelle normalisée que le
  // Chantier #69 (archives.items[].product ↔ lignes_ticket.libelle_brut),
  // scopée en plus au jour du ticket (archives n'a pas de ticket_id, donc pas
  // de clé technique directe — la RLS restreint déjà lignes_ticket à
  // l'utilisateur courant).
  const trouverLignesTicket = async (arc, item) => {
    const jour = new Date(arc.date).toISOString().slice(0, 10);
    const { data: lignes, error } = await supabase
      .from('lignes_ticket')
      .select('id, libelle_brut, tickets!inner(date_ticket, magasin_id)')
      .eq('tickets.date_ticket', jour);
    if (error) return { candidats: [], error };
    const cible = normName(item.product);
    return { candidats: (lignes || []).filter(l => normName(l.libelle_brut) === cible), error: null };
  };

  // Puis appelle la RPC existante corriger_association_ligne_ticket (déjà
  // utilisée ailleurs dans le repo pour une correction manuelle, méthode
  // 'humaine'). Chantier #71.1 — varianteId est résolu en amont par
  // CorrigerProduitSheet (0 variante active -> null légitime, 1 -> automatique,
  // plusieurs -> choix explicite de l'utilisateur, jamais une valeur par défaut).
  // Chantier "Scan code-barres" bout 1 — methode='scan_code_barres' appelle
  // relier_variante_scan_code_barres à la place : même effet de bord que
  // corriger_association_ligne_ticket (elle l'appelle en interne, aucune
  // logique dupliquée), seule la méthode tracée et l'origine de l'alias
  // changent.
  const rattacherProduit = async (arc, item, produit, varianteId = null, methode = 'humaine') => {
    const { candidats, error: errLignes } = await trouverLignesTicket(arc, item);
    if (errLignes) return { ok: false, message: "Recherche du ticket impossible, vérifie ta connexion." };
    if (candidats.length === 0) {
      return { ok: false, message: "Impossible de retrouver cet article dans le système (ticket ancien ou non synchronisé)." };
    }

    let succes = 0;
    for (const ligne of candidats) {
      const { error } = methode === 'scan_code_barres'
        ? await supabase.rpc('relier_variante_scan_code_barres', {
            p_ligne_ticket_id: ligne.id,
            p_produit_id: produit.id,
            p_variante_produit_id: varianteId,
            p_libelle_alias: ligne.libelle_brut,
          })
        : await supabase.rpc('corriger_association_ligne_ticket', {
            p_ligne_ticket_id: ligne.id,
            p_produit_id: produit.id,
            p_variante_produit_id: varianteId,
          });
      if (!error) succes++;
    }
    if (succes === 0) return { ok: false, message: "Le rattachement a échoué, réessaie." };

    onLibelleResolu?.(normName(item.product), produit.nom_reference);
    return { ok: true };
  };

  // Chantier 2b — résout l'enseigne du ticket en cours (via magasin_id) dès
  // l'ouverture de la modale de correction, pour trier les résultats de la
  // RPC de recherche. Best-effort : si le ticket/magasin n'est pas
  // retrouvé, enseigneCourante reste null et la recherche n'est simplement
  // pas triée par enseigne (jamais bloquant).
  useEffect(() => {
    if (!correctionCible) { setEnseigneCourante(null); return; }
    let annule = false;
    (async () => {
      const { candidats } = await trouverLignesTicket(correctionCible.arc, correctionCible.item);
      const magasinId = candidats[0]?.tickets?.magasin_id;
      if (!magasinId) { if (!annule) setEnseigneCourante(null); return; }
      const { data } = await supabase.from('magasins').select('enseigne_id').eq('id', magasinId).maybeSingle();
      if (!annule) setEnseigneCourante(data?.enseigne_id ?? null);
    })();
    return () => { annule = true; };
  }, [correctionCible]);

  const categories = useMemo(() => {
    const seen = new Set();
    archives.forEach(arc => arc.items.forEach(item => {
      const cat = item.category || guessCategory(item.product);
      if (cat) seen.add(cat);
    }));
    return [...seen].sort();
  }, [archives]);

  const periodCutoff = useMemo(() => {
    if (filterPeriod === "week")  return Date.now() - 7  * 86400000;
    if (filterPeriod === "month") return Date.now() - 30 * 86400000;
    if (filterPeriod === "3m")    return Date.now() - 90 * 86400000;
    return 0;
  }, [filterPeriod]);

  const filteredArchives = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return archives.filter(arc => {
      if (periodCutoff && new Date(arc.date).getTime() < periodCutoff) return false;
      if (q && !arc.items.some(i =>
        i.product.toLowerCase().includes(q) ||
        (i.brand||"").toLowerCase().includes(q)
      )) return false;
      if (filterCategory !== "all" && !arc.items.some(i =>
        (i.category || guessCategory(i.product)) === filterCategory
      )) return false;
      return true;
    });
  }, [archives, searchQuery, filterCategory, periodCutoff]);

  const totalSpent = filteredArchives.reduce((a,arc)=>a+arc.total,0);
  const FILTERS=[{id:"date",label:"Date ↓"},{id:"magasin",label:"Magasin"},{id:"produit",label:"Produit"},{id:"montant",label:"Montant"}];
  const sorted=[...filteredArchives];
  if(sort==="date")    sorted.reverse();
  else if(sort==="magasin") sorted.sort((a,b)=>a.store.name.localeCompare(b.store.name,"fr"));
  else if(sort==="montant") sorted.sort((a,b)=>b.total-a.total);
  const productList=useMemo(()=>{
    const seen=new Set(); const result=[];
    [...filteredArchives].reverse().forEach(arc=>arc.items.forEach(item=>{
      const key=`${normName(item.brand||"")}_${normName(item.product)}_${normName(item.format||"")}`;
      if(!seen.has(key)){
        seen.add(key);
        const matches=(priceDB||[]).filter(p=>normName(p.product)===normName(item.product)&&normName(p.format||"")===normName(item.format||"")&&normName(p.brand||"")===normName(item.brand||""));
        const best=matches.sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
        result.push({...item,unitPrice:best?.price??null});
      }
    }));
    return result.sort((a,b)=>a.product.localeCompare(b.product,"fr"));
  },[filteredArchives,priceDB]);

  const now        = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const months = useMemo(() => {
    const map = {};
    archives.forEach(arc => {
      const d   = new Date(arc.date);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (!map[key]) map[key] = { key, year: d.getFullYear(), month: d.getMonth(), saving: 0, count: 0 };
      map[key].saving += arc.potential_saving || 0;
      map[key].count  += 1;
    });
    if (!map[currentKey])
      map[currentKey] = { key: currentKey, year: now.getFullYear(), month: now.getMonth(), saving: 0, count: 0 };
    return Object.values(map).sort((a, b) => b.key.localeCompare(a.key));
  }, [archives]);

  const monthLabel = (year, month) => {
    const s = new Date(year, month, 1).toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const monthArchives = useMemo(() => {
    if (!selectedMonth) return [];
    return archives
      .filter(arc => {
        const d = new Date(arc.date);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === selectedMonth;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [archives, selectedMonth]);

  if (selectedMonth) {
    const info = months.find(m => m.key === selectedMonth) || {};
    return (
      <div style={{ padding:"16px 16px 110px" }}>
        <button onClick={() => setSelectedMonth(null)} style={{ background:"none", border:"none", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.blue, cursor:"pointer", padding:"0 0 16px", display:"flex", alignItems:"center", gap:6 }}>
          ← {monthLabel(info.year, info.month)}
        </button>
        {monthArchives.length === 0 ? (
          <div style={{ textAlign:"center", padding:"40px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>
            Aucun achat ce mois-ci
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {monthArchives.map(arc => (
              <div key={arc.id} style={{ background:C.white, borderRadius:14, border:`1px solid ${C.grayLight}`, padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.text }}>{arc.store?.logo} {arc.store?.name}</div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginTop:2 }}>{new Date(arc.date).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })}</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end" }}>
                  <div style={{ background:C.blue, borderRadius:10, padding:"6px 14px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.white }}>
                    {(arc.total || 0).toFixed(2)} €
                  </div>
                  {arc.potential_saving > 0 && (
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.green, marginTop:4 }}>
                      Économie : {arc.potential_saving.toFixed(2)} €
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <button onClick={()=>setShowEntry(true)} style={{ position:"fixed", bottom:72, right:16, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:99, padding:"13px 18px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", gap:6, boxShadow:"0 6px 20px rgba(180,0,0,0.45)", zIndex:40 }}>
          ✏️ Saisie manuelle
        </button>
        {showImport && <ImportTicketSheet onClose={()=>setShowImport(false)} onImport={onImport} refProducts={produitsRef.map(p=>({ nom: p.produit_generique, categorie: p.sous_categorie }))} estFrancois={estFrancois}/>}
        {showEntry  && <PriceEntrySheet  onClose={()=>setShowEntry(false)} onSave={onSavePrice}/>}
      </div>
    );
  }

  return (
    <div style={{ padding:"16px 16px 110px" }}>
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        {[{id:"produit",label:"Par produit"},{id:"mois",label:"Par mois"}].map(t=>(
          <button key={t.id} onClick={()=>{ setSubTab(t.id); if(t.id==="produit") setSort("produit"); }} style={{ flex:1, padding:"10px", border:"none", borderRadius:10, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, cursor:"pointer", background:subTab===t.id?C.blue:C.grayLight, color:subTab===t.id?C.white:C.textLight }}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === "mois" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {months.map(m => (
            <div key={m.key} onClick={() => setSelectedMonth(m.key)} style={{ background:C.white, borderRadius:14, border:`1px solid ${C.grayLight}`, padding:"16px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.text }}>{monthLabel(m.year, m.month)}</div>
                {m.count > 0 && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginTop:2 }}>{m.count} course{m.count>1?'s':''}</div>}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                {m.saving > 0.01 && <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.green }}>−{m.saving.toFixed(2)} €</div>}
                <span style={{ color:C.gray, fontSize:18 }}>›</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {subTab === "produit" && (<>
      <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
        placeholder="🔍 Chercher un produit ou une marque..."
        style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`2px solid ${searchQuery?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:14 }}
      />
      {archives.length === 0 ? (
        <div style={{ textAlign:"center", padding:"40px 0 20px" }}>
          <div style={{ fontSize:60, marginBottom:14 }}>📦</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:C.blue, marginBottom:6 }}>Pas encore d'historique</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>Valide ta première liste pour voir l'historique</div>
        </div>
      ) : (
        <>
          <div style={{ display:"flex", gap:10, marginBottom:16 }}>
            <div style={{ flex:1, background:C.blue, borderRadius:12, padding:"12px 14px" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)", textTransform:"uppercase", letterSpacing:"0.06em" }}>Courses</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.white }}>{filteredArchives.length}</div>
            </div>
            <div style={{ flex:1, background:C.green, borderRadius:12, padding:"12px 14px" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)", textTransform:"uppercase", letterSpacing:"0.06em" }}>Total dépensé</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.white }}>{totalSpent.toFixed(0)} €</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, overflowX:"auto", marginBottom:10, paddingBottom:2, WebkitOverflowScrolling:"touch" }}>
            {FILTERS.map(f=>(
              <button key={f.id} onClick={()=>{ setSort(f.id); setExpandedProduct(null); }} style={{ flexShrink:0, background:sort===f.id?C.blue:C.grayLight, color:sort===f.id?C.white:C.textLight, border:"none", borderRadius:99, padding:"6px 14px", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>{f.label}</button>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
            <select value={filterCategory} onChange={e=>setFilterCategory(e.target.value)}
              style={{ padding:"9px 12px", borderRadius:10, border:`1.5px solid ${C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:C.text, background:C.white, outline:"none", cursor:"pointer", boxSizing:"border-box" }}>
              <option value="all">Toutes catégories</option>
              {categories.map(cat=><option key={cat} value={cat}>{cat}</option>)}
            </select>
            <select value={filterPeriod} onChange={e=>setFilterPeriod(e.target.value)}
              style={{ padding:"9px 12px", borderRadius:10, border:`1.5px solid ${C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:C.text, background:C.white, outline:"none", cursor:"pointer", boxSizing:"border-box" }}>
              <option value="all">Toute période</option>
              <option value="week">Cette semaine</option>
              <option value="month">Ce mois</option>
              <option value="3m">3 derniers mois</option>
            </select>
          </div>
          {filteredArchives.length === 0 ? (
            <div style={{ textAlign:"center", padding:"24px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>
              Aucun résultat pour cette recherche
            </div>
          ) : sort==="produit" ? (
            <div style={{ display:"flex", flexDirection:"column" }}>
              {productList.map((item,i)=>{
                const key=`pl_${normName(item.brand||"")}_${normName(item.product)}_${normName(item.format||"")}`; const done=added.has(key); const isOpen=expandedProduct===key;
                const history=(priceDB||[]).filter(p=>normName(p.product)===normName(item.product)&&normName(p.format||"")===normName(item.format||"")&&normName(p.brand||"")===normName(item.brand||"")).sort((a,b)=>new Date(a.date)-new Date(b.date));
                return (
                  <div key={i} style={{ borderBottom:`1px solid ${C.grayLight}` }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 4px" }}>
                      <div onClick={()=>setExpandedProduct(isOpen?null:key)} style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:C.text, cursor:"pointer", flex:1 }}>{item.brand?`${item.brand} · `:""}{nomAffiche(item)}{item.format?` ${item.format}`:""} <span style={{ fontSize:10, color:C.textLight }}>{isOpen?"▲":"▼"}</span></div>
                      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0, marginLeft:12 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:900, color:C.blue }}>{item.unitPrice!=null?`${item.unitPrice.toFixed(2)} €`:"—"}</div>
                        <button onClick={()=>{ if(!done){ onAddToList(item); setAdded(prev=>new Set(prev).add(key)); } }} style={{ background:done?C.green:"#E8E8E8", border:"none", borderRadius:99, width:26, height:26, display:"inline-flex", alignItems:"center", justifyContent:"center", cursor:done?"default":"pointer", color:C.white, fontSize:14, fontWeight:900, padding:0, flexShrink:0 }}>{done?"✓":"🛒"}</button>
                      </div>
                    </div>
                    {isOpen && (history.length<=1
                      ? <div style={{ padding:"6px 4px 12px", fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, fontStyle:"italic" }}>Pas assez de données</div>
                      : (()=>{
                          const W=280,H=72,px=12,py=10;
                          const ts=history.map(p=>new Date(p.date).getTime());
                          const ps=history.map(p=>p.price);
                          const minT=Math.min(...ts),maxT=Math.max(...ts),minP=Math.min(...ps),maxP=Math.max(...ps);
                          const xOf=t=>px+(t-minT)/((maxT-minT)||1)*(W-2*px);
                          const yOf=p=>H-py-((p-minP)/((maxP-minP)||1))*(H-2*py);
                          const pts=history.map(p=>`${xOf(new Date(p.date).getTime())},${yOf(p.price)}`).join(" ");
                          return (
                            <div style={{ padding:"4px 4px 12px" }}>
                              <svg viewBox={`0 0 ${W} ${H+14}`} width="100%" style={{ display:"block", overflow:"visible" }}>
                                <polyline points={pts} fill="none" stroke={C.blue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
                                {history.map((p,j)=>(
                                  <circle key={j} cx={xOf(new Date(p.date).getTime())} cy={yOf(p.price)} r="3" fill={C.blue}/>
                                ))}
                                <text x={xOf(ts[0])} y={H+12} fontFamily="'Nunito',sans-serif" fontSize="8" fill={C.textLight} textAnchor="start">{new Date(history[0].date).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}</text>
                                <text x={xOf(ts[ts.length-1])} y={H+12} fontFamily="'Nunito',sans-serif" fontSize="8" fill={C.textLight} textAnchor="end">{new Date(history[history.length-1].date).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}</text>
                                <text x={W-px} y={yOf(maxP)-3} fontFamily="'Nunito',sans-serif" fontSize="8" fill={C.blue} textAnchor="end">{maxP.toFixed(2)} €</text>
                                <text x={W-px} y={yOf(minP)+9} fontFamily="'Nunito',sans-serif" fontSize="8" fill={C.textLight} textAnchor="end">{minP.toFixed(2)} €</text>
                              </svg>
                            </div>
                          );
                        })()
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {sorted.map((arc,i)=>(
                <div key={arc.id} style={{ background:C.white, borderRadius:14, border:`1px solid ${C.grayLight}`, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", animation:`slideIn 0.25s ease ${i*0.06}s both` }}>
                  <div style={{ background:C.blueLight, padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.blue }}>{arc.store?.logo} {arc.store?.name}</div>
                        {(()=>{ const key=arc.store?.id&&arc.store.id!=='autre'?arc.store.id:(arc.store?.name||'autre'); const avg=storeRatings[key]; if(!avg) return null; const pct=(avg/5*100).toFixed(1)+'%'; return <div style={{ position:"relative", display:"inline-block", fontSize:13, lineHeight:1, letterSpacing:1, whiteSpace:"nowrap" }}><span style={{ color:"#D0D0D0" }}>★★★★★</span><span style={{ position:"absolute", top:0, left:0, width:pct, overflow:"hidden", color:"#F5C200" }}>★★★★★</span></div>; })()}
                      </div>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginTop:1 }}>{new Date(arc.date).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ background:C.blue, borderRadius:10, padding:"6px 14px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.white }}>{(arc.items?.reduce((s,i)=>{ const up=i.unit_price??i.price??0; return s+(up*(i.qty||1)); },0)||arc.total||0).toFixed(2)} €</div>
                      {pendingDeleteArc === arc.id ? (
                        <div style={{ display:"flex", gap:4 }}>
                          <button onClick={()=>setPendingDeleteArc(null)} style={{ background:C.grayLight, border:"none", borderRadius:6, padding:"4px 9px", fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:11, cursor:"pointer", color:C.text }}>Non</button>
                          <button onClick={()=>{ onDelete(arc); setPendingDeleteArc(null); }} style={{ background:C.red, border:"none", borderRadius:6, padding:"4px 9px", fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:11, cursor:"pointer", color:C.white }}>Oui</button>
                        </div>
                      ) : (
                        <button onClick={()=>setPendingDeleteArc(arc.id)} style={{ background:"none", border:"none", fontSize:14, cursor:"pointer", color:C.gray, padding:"4px" }}>✕</button>
                      )}
                    </div>
                  </div>
                  <div style={{ padding:"10px 16px 14px", display:"flex", flexWrap:"wrap", gap:6 }}>
                    {arc.items.map((item,j)=>(
                      <span key={j} style={{ background:C.grayLight, borderRadius:99, padding:"4px 8px 4px 12px", fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:700, color:C.textLight, display:"inline-flex", alignItems:"center", gap:6 }}>
                        <span onClick={()=>setCorrectionCible({arc,item})} style={{ cursor:"pointer" }} title="Corriger le produit rattaché">
                          {(()=>{ const up=item.unit_price??item.price??null; const qty=item.qty||1; const tot=up!=null?up*qty:null; return `${item.brand?item.brand+' · ':""}${nomAffiche(item)} ${item.format} | ×${qty} | ${up!=null?Number(up).toFixed(2).replace('.',','):"—"} € | = ${tot!=null?Number(tot).toFixed(2).replace('.',','):"—"} €`; })()}
                        </span>
                        {(()=>{ const key=`${arc.id}_${j}`; const done=added.has(key); return (
                          <button onClick={()=>{ if(!done){ onAddToList(item); setAdded(prev=>new Set(prev).add(key)); } }} style={{ background:done?C.green:"#E8E8E8", border:"none", borderRadius:99, width:22, height:22, display:"inline-flex", alignItems:"center", justifyContent:"center", cursor:done?"default":"pointer", color:C.white, fontSize:12, fontWeight:900, padding:0, flexShrink:0 }}>{done?"✓":"🛒"}</button>
                        );})()}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      </>)}
      {showImport && <ImportTicketSheet onClose={()=>setShowImport(false)} onImport={onImport} refProducts={produitsRef.map(p=>({ nom: p.produit_generique, categorie: p.sous_categorie }))} onManualEntry={()=>setShowEntry(true)} estFrancois={estFrancois}/>}
      {showEntry  && <PriceEntrySheet  onClose={()=>setShowEntry(false)} onSave={onSavePrice}/>}
      {correctionCible && (
        <CorrigerProduitSheet
          item={correctionCible.item}
          enseigne={enseigneCourante}
          estFrancois={estFrancois}
          onClose={()=>setCorrectionCible(null)}
          onChoisir={(produit,varianteId,methode)=>rattacherProduit(correctionCible.arc, correctionCible.item, produit, varianteId, methode)}
        />
      )}
    </div>
  );
}

// ── CORRIGER PRODUIT SHEET (Chantier 2, recherche RPC depuis Chantier 2b) ───
// Recherche tolérante (accents/ordre/multi-mots) déléguée à la RPC Postgres
// rechercher_produits_pour_correction — voir le bloc SQL fourni séparément.
// Plus de chargement client du catalogue : la RPC filtre, trie (enseigne du
// ticket en tête) et limite à 20 côté serveur.
// Chantier "Scan code-barres" bout 1 — nom composé pour une variante trouvée
// par code-barres : marque + libellé + quantité, tel que demandé (distinct de
// libelleVariante ci-dessus, qui ne sert qu'au sélecteur "plusieurs variantes"
// de la recherche par nom).
// ── BARCODE SCANNER SHEET (Chantier "Scan code-barres", bout 1) ────────────
// Caméra arrière + décodage EAN-13/EAN-8/UPC-A via @zxing/browser
// (BarcodeDetector natif absent d'iOS Safari — cette lib décode en JS pur à
// partir du flux vidéo, éprouvée sur iOS). Ferme la caméra dès qu'un code est
// lu ou à la fermeture manuelle ; ne laisse jamais un flux caméra ouvert.
function BarcodeScannerSheet({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const [erreur, setErreur] = useState(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    let annule = false;
    let controls = null;
    (async () => {
      try {
        const hints = new Map();
        // Formats : EAN/UPC courants + UPC-E (sûr). Code 128 / ITF volontairement
        // EXCLUS pour l'instant (faux positifs). TRY_HARDER = décodage plus robuste
        // (codes mats, petits, légèrement bombés) pour lire les vrais emballages.
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints);
        controls = await reader.decodeFromConstraints(
          // Contraintes en IDEAL (souples, jamais 'exact' -> pas d'OverconstrainedError) :
          // meilleure résolution pour résoudre les fines barres + autofocus continu
          // (best-effort, ignoré si l'appareil ne le supporte pas).
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] } },
          videoRef.current,
          (result) => {
            if (annule || !result) return;
            controls?.stop();
            // Remonte le texte ET le format détecté (nom lisible via BarcodeFormat).
            onDetected(result.getText(), BarcodeFormat[result.getBarcodeFormat()]);
          }
        );
        if (!annule) setPret(true);
      } catch (e) {
        if (annule) return;
        console.error('[BarcodeScannerSheet] ouverture caméra :', e);
        setErreur(
          e?.name === 'NotAllowedError'
            ? "Accès à la caméra refusé — autorise-le dans Réglages > Safari > Caméra, puis réessaie."
            : "Impossible d'ouvrir la caméra sur cet appareil."
        );
      }
    })();
    return () => { annule = true; controls?.stop(); };
  }, [onDetected]);

  return (
    <div style={{ position:"fixed", inset:0, background:"#000", zIndex:600, display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"14px 16px calc(14px + env(safe-area-inset-top, 0px))", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <span style={{ color:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14 }}>📷 Scanner le code-barres</span>
        <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:30, height:30, color:"#fff", fontSize:15, cursor:"pointer" }}>✕</button>
      </div>
      <div style={{ flex:1, position:"relative", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
        <video ref={videoRef} style={{ width:"100%", height:"100%", objectFit:"cover" }} muted playsInline autoPlay />
        {!pret && !erreur && (
          <div style={{ position:"absolute", color:"#fff", fontFamily:"'Nunito',sans-serif", fontSize:13 }}>Ouverture de la caméra...</div>
        )}
        {erreur && (
          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", padding:24, textAlign:"center", background:"rgba(0,0,0,0.7)" }}>
            <div style={{ color:"#fff", fontFamily:"'Nunito',sans-serif", fontSize:14 }}>{erreur}</div>
          </div>
        )}
        {pret && !erreur && (
          <div style={{ position:"absolute", width:"72%", maxWidth:320, aspectRatio:"2/1", border:"3px solid #00B341", borderRadius:12, pointerEvents:"none" }} />
        )}
      </div>
    </div>
  );
}

function CorrigerProduitSheet({ item, enseigne = null, estFrancois = false, onClose, onChoisir }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const seq = useRef(0);
  // Chantier #71.1 — résolution de la variante. resolvingVariante : appel en
  // cours pour compter les variantes actives du produit tapé. produitEnAttente
  // + variantesAChoisir : on entre dans l'écran de choix uniquement si
  // plusieurs variantes actives existent — jamais de repli silencieux sur
  // NULL ni sur la première de la liste.
  const [resolvingVariante, setResolvingVariante] = useState(false);
  const [produitEnAttente, setProduitEnAttente] = useState(null);
  const [variantesAChoisir, setVariantesAChoisir] = useState(null);
  const [varianteChoisie, setVarianteChoisie] = useState(null);
  // Chantier "Scan code-barres" bout 1 — scanOuvert : caméra affichée.
  // barcodeCandidats : plusieurs variantes partagent le même code (rare),
  // laisse choisir. barcodeConfirmation : une variante trouvée, en attente de
  // "Relier ce produit" / "Annuler". barcodeMessage : erreur ou "code inconnu".
  const [scanOuvert, setScanOuvert] = useState(false);
  const [rechercheBarcode, setRechercheBarcode] = useState(false);
  const [barcodeMessage, setBarcodeMessage] = useState(null);
  const [barcodeCandidats, setBarcodeCandidats] = useState(null);
  const [barcodeConfirmation, setBarcodeConfirmation] = useState(null);
  // Chantier "Scan code-barres" bout 2 — code scanné mais absent de la base :
  // gardé en mémoire pour que la recherche catalogue (déjà présente) devienne
  // un "apprentissage" (enregistre le code sur la variante choisie) au lieu
  // d'un rattachement classique. conflitCodeBarres : la variante choisie a
  // déjà un AUTRE code -> confirmation explicite avant tout remplacement.
  const [codeBarresEnAttente, setCodeBarresEnAttente] = useState(null);
  const [conflitCodeBarres, setConflitCodeBarres] = useState(null);
  // Diagnostic scan (shadow estFrancois) — remonte à l'écran ce que le lecteur a
  // réellement décodé + le déroulé de la recherche, pour ne jamais avoir d'écran
  // muet : { brut, format, normalise, rechercheLancee, resultat }.
  const [scanDiag, setScanDiag] = useState(null);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setError(null); return; }
    const mySeq = ++seq.current;
    setSearching(true); setError(null);
    const timer = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('rechercher_produits_pour_correction', {
        p_terme: query.trim(),
        p_enseigne: enseigne,
      });
      if (mySeq !== seq.current) return; // réponse obsolète, ignorée
      if (err) { setError("Recherche impossible."); setSearching(false); return; }
      setResults(data || []);
      setSearching(false);
    }, 280);
    return () => clearTimeout(timer);
  }, [query, enseigne]);

  const finaliser = async (produit, varianteId, methode = 'humaine', texteConfirmation = null) => {
    setSaving(true);
    setError(null);
    const res = await onChoisir({ id: produit.produit_id, nom_reference: produit.nom_reference }, varianteId, methode);
    setSaving(false);
    if (!res.ok) { setError(res.message); return; }
    setConfirmation(texteConfirmation ?? `✓ Rattaché à « ${produit.nom_reference} »`);
    setTimeout(onClose, 900);
  };

  // Chantier "Scan code-barres" bout 1 — recherche par code_barres exact
  // (espaces retirés, zéros initiaux CONSERVÉS — un EAN commençant par 0 n'est
  // pas le même code sans ce zéro). 0 résultat -> message clair, pas d'erreur
  // ni de blocage (le lot suivant gèrera ce cas). Plusieurs résultats -> choix
  // explicite, jamais une variante prise au hasard.
  const rechercherParCodeBarres = async (codeBrut, format = null) => {
    const code = (codeBrut || '').replace(/\s+/g, '');   // espaces retirés, zéros initiaux CONSERVÉS
    setScanOuvert(false);
    setRechercheBarcode(true);
    setBarcodeMessage(null);
    setCodeBarresEnAttente(null);
    // Diagnostic (shadow) : on trace ce qui a été décodé + le déroulé.
    setScanDiag({ brut: codeBrut ?? '—', format: format ?? '—', normalise: code, rechercheLancee: true, resultat: '…' });

    // Rattrapage UPC-A(12 chiffres) <-> EAN-13(13, préfixe 0) : un code stocké en
    // EAN-13 doit matcher un UPC-A scanné (et inversement).
    const candidats = [code];
    if (/^\d{12}$/.test(code)) candidats.push('0' + code);
    if (/^0\d{12}$/.test(code)) candidats.push(code.slice(1));

    // Source de vérité = codes_barres_variante (multi-codes ; code UNIQUE -> 0/1).
    const { data: cbv, error: errCbv } = await supabase
      .from('codes_barres_variante')
      .select('variante_produit_id, code_barres')
      .in('code_barres', candidats)
      .limit(1);
    if (errCbv) {
      setRechercheBarcode(false);
      setScanDiag(d => ({ ...(d || {}), resultat: 'erreur' }));
      setBarcodeMessage("Recherche impossible, réessaie.");
      return;
    }

    // Code décodé mais absent (ou variante inactive) : gardé pour apprentissage.
    const inconnu = () => {
      setScanDiag(d => ({ ...(d || {}), resultat: 'non trouvé' }));
      setCodeBarresEnAttente(code);
      setBarcodeMessage(`Code-barres ${code} détecté, mais aucun article correspondant n'existe encore.`);
    };

    const trouve = cbv && cbv[0];
    if (!trouve) { setRechercheBarcode(false); inconnu(); return; }

    const { data: variante, error: errV } = await supabase
      .from('variantes_produit')
      .select('id, produit_id, libelle, quantite_nette, unite_quantite, url_image, produits(nom_reference), marques(nom)')
      .eq('id', trouve.variante_produit_id)
      .eq('actif', true)
      .maybeSingle();
    setRechercheBarcode(false);
    if (errV) {
      setScanDiag(d => ({ ...(d || {}), resultat: 'erreur' }));
      setBarcodeMessage("Recherche impossible, réessaie.");
      return;
    }
    if (!variante) { inconnu(); return; }
    setScanDiag(d => ({ ...(d || {}), resultat: 'trouvé' }));
    setBarcodeConfirmation(variante);
  };

  const annulerBarcode = () => {
    setBarcodeConfirmation(null);
    setBarcodeCandidats(null);
    setBarcodeMessage(null);
  };

  const relierViaBarcode = () => {
    if (!barcodeConfirmation) return;
    finaliser(
      { produit_id: barcodeConfirmation.produit_id, nom_reference: barcodeConfirmation.produits?.nom_reference ?? nomComposeVariante(barcodeConfirmation) },
      barcodeConfirmation.id,
      'scan_code_barres'
    );
  };

  const annulerApprentissage = () => {
    setCodeBarresEnAttente(null);
    setConflitCodeBarres(null);
    setBarcodeMessage(null);
  };

  // Chantier "Scan code-barres" bout 2 / étape 4b — apprentissage : on AJOUTE le
  // code scanné comme code SECONDAIRE de la variante dans codes_barres_variante
  // (multi-codes), puis on relie la ligne via le même chemin que le bout 1
  // (relier_variante_scan_code_barres, appelé par finaliser). On ne touche plus
  // à variantes_produit.code_barres (retrait prévu en 4c). L'unicité globale du
  // code est garantie par UNIQUE(code_barres) : si le code appartient déjà à une
  // autre variante, l'INSERT échoue (23505) -> message clair, rien n'est créé.
  // Accès inchangé (bouton scanner gated estFrancois ; policy INSERT admin).
  const procederApprentissage = async (produit, varianteId) => {
    if (!varianteId) {
      setError("Ce produit n'a pas de variante précise à associer à ce code-barres.");
      return;
    }
    setSaving(true);
    setError(null);

    const { error: errInsert } = await supabase
      .from('codes_barres_variante')
      .insert({ variante_produit_id: varianteId, code_barres: codeBarresEnAttente, est_principal: false, source: 'scan' });
    if (errInsert) {
      setSaving(false);
      setError(errInsert.code === '23505'
        ? "Ce code-barres est déjà rattaché à un autre produit."
        : "Enregistrement du code-barres impossible, réessaie.");
      return;
    }

    setSaving(false);
    await finaliser(produit, varianteId, 'scan_code_barres', `✓ Code-barres enregistré sur « ${produit.nom_reference} » + ligne reliée`);
    setCodeBarresEnAttente(null);
  };

  // Sur un produit tapé : 0 variante active -> NULL légitime (vrac/frais) ;
  // 1 -> automatique ; plusieurs -> écran de choix explicite, jamais de repli.
  const choisir = async (produit) => {
    if (saving || resolvingVariante) return;
    setError(null);
    setResolvingVariante(true);
    const { data, error: errVar } = await supabase
      .from('variantes_produit')
      .select('id, libelle, quantite_nette, unite_quantite, nombre_unites, marque_id, marques(nom)')
      .eq('produit_id', produit.produit_id)
      .eq('actif', true);
    setResolvingVariante(false);

    if (errVar) { setError("Impossible de vérifier les variantes de ce produit, réessaie."); return; }

    const liste = data || [];
    if (liste.length <= 1) {
      const varianteId = liste[0]?.id ?? null;
      if (codeBarresEnAttente) await procederApprentissage(produit, varianteId);
      else await finaliser(produit, varianteId);
      return;
    }

    setProduitEnAttente(produit);
    setVariantesAChoisir([...liste].sort((a, b) => formatEtiquetteVariante(a).localeCompare(formatEtiquetteVariante(b), "fr")));
    setVarianteChoisie(null);
  };

  const annulerChoixVariante = () => {
    setProduitEnAttente(null);
    setVariantesAChoisir(null);
    setVarianteChoisie(null);
  };

  const validerVariante = () => {
    if (!varianteChoisie || !produitEnAttente) return;
    if (codeBarresEnAttente) procederApprentissage(produitEnAttente, varianteChoisie);
    else finaliser(produitEnAttente, varianteChoisie);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"85vh", display:"flex", flexDirection:"column", padding:"20px 20px calc(20px + env(safe-area-inset-bottom, 0px))", boxSizing:"border-box", overflow:"hidden" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.text }}>
              {conflitCodeBarres ? "Code déjà utilisé ?" : barcodeConfirmation || barcodeCandidats ? "Code-barres" : variantesAChoisir ? "Quelle quantité ?" : "Choisir le bon produit"}
            </div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginTop:2 }}>
              {variantesAChoisir && !codeBarresEnAttente ? produitEnAttente?.nom_reference : `Actuellement : ${item.product}${item.format?` ${item.format}`:""}`}
            </div>
          </div>
          <button onClick={conflitCodeBarres ? ()=>setConflitCodeBarres(null) : barcodeConfirmation || barcodeCandidats ? annulerBarcode : variantesAChoisir ? annulerChoixVariante : onClose} style={{ background:C.grayLight, border:"none", borderRadius:99, width:28, height:28, color:C.textLight, fontSize:14, cursor:"pointer" }}>
            {conflitCodeBarres || barcodeConfirmation || barcodeCandidats || variantesAChoisir ? "←" : "✕"}
          </button>
        </div>

        {/* Diagnostic scan (shadow estFrancois) — visible dans toutes les branches
            dès qu'un code a été décodé. Ne s'affiche jamais pour les autres. */}
        {estFrancois && scanDiag && (
          <div style={{ fontFamily:"ui-monospace, Menlo, monospace", fontSize:11, lineHeight:1.5, background:"#F4F6F8", border:`1px solid ${C.grayLight}`, borderRadius:8, padding:"8px 10px", marginBottom:12, color:"#333", whiteSpace:"pre-line" }}>
            {`🔎 Diagnostic scan
Code brut détecté : ${scanDiag.brut}
Format détecté : ${scanDiag.format}
Code normalisé : ${scanDiag.normalise}
Recherche lancée : ${scanDiag.rechercheLancee ? 'oui' : 'non'}
Résultat : ${scanDiag.resultat}`}
          </div>
        )}

        {confirmation ? (
          <div style={{ textAlign:"center", padding:"24px 0", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.green }}>
            {confirmation}
          </div>
        ) : conflitCodeBarres ? (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {error && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#CC0000" }}>⚠️ {error}</div>}
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, color:C.text, lineHeight:1.5 }}>
              « {conflitCodeBarres.produit.nom_reference} » a déjà le code-barres <strong>{conflitCodeBarres.ancienCode}</strong>.<br/>
              Le remplacer par <strong>{codeBarresEnAttente}</strong> ?
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>procederApprentissage(conflitCodeBarres.produit, conflitCodeBarres.varianteId, true)} disabled={saving} style={{ flex:1, padding:"13px", border:"none", borderRadius:12, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.white, background:saving?C.grayLight:"#CC0000", cursor:saving?"default":"pointer" }}>
                {saving ? "..." : "Remplacer"}
              </button>
              <button onClick={()=>setConflitCodeBarres(null)} disabled={saving} style={{ padding:"13px 16px", border:"none", borderRadius:12, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, background:C.grayLight, cursor:"pointer" }}>
                Annuler
              </button>
            </div>
          </div>
        ) : barcodeConfirmation ? (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {error && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#CC0000" }}>⚠️ {error}</div>}
            <div style={{ display:"flex", gap:12, alignItems:"center" }}>
              {barcodeConfirmation.url_image && (
                <img src={barcodeConfirmation.url_image} alt="" style={{ width:64, height:64, borderRadius:10, objectFit:"cover", background:C.grayLight, flexShrink:0 }} />
              )}
              <div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.text }}>{nomComposeVariante(barcodeConfirmation)}</div>
                {barcodeConfirmation.produits?.nom_reference && (
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginTop:2 }}>{barcodeConfirmation.produits.nom_reference}</div>
                )}
              </div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={relierViaBarcode} disabled={saving} style={{ flex:1, padding:"13px", border:"none", borderRadius:12, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.white, background:saving?C.grayLight:C.green, cursor:saving?"default":"pointer" }}>
                {saving ? "..." : "Relier ce produit"}
              </button>
              <button onClick={annulerBarcode} disabled={saving} style={{ padding:"13px 16px", border:"none", borderRadius:12, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, background:C.grayLight, cursor:"pointer" }}>
                Annuler
              </button>
            </div>
          </div>
        ) : barcodeCandidats ? (
          <div style={{ overflowY:"auto", WebkitOverflowScrolling:"touch", flex:1, minHeight:0, paddingBottom:24 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginBottom:8 }}>Plusieurs produits partagent ce code-barres, choisis le bon :</div>
            {barcodeCandidats.map(v => (
              <div key={v.id} onClick={()=>{ setBarcodeConfirmation(v); setBarcodeCandidats(null); }} style={{ padding:"12px 10px", borderBottom:`1px solid ${C.grayLight}`, display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                {v.url_image && <img src={v.url_image} alt="" style={{ width:36, height:36, borderRadius:8, objectFit:"cover", background:C.grayLight, flexShrink:0 }} />}
                <div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text }}>{nomComposeVariante(v)}</div>
                  {v.produits?.nom_reference && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight }}>{v.produits.nom_reference}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : variantesAChoisir ? (
          <>
            {error && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#CC0000", marginBottom:8 }}>⚠️ {error}</div>}
            <div style={{ overflowY:"auto", WebkitOverflowScrolling:"touch", flex:1, minHeight:0, paddingBottom:24 }}>
              {variantesAChoisir.map(v => (
                <div key={v.id} onClick={()=>setVarianteChoisie(v.id)} style={{ padding:"12px 10px", borderBottom:`1px solid ${C.grayLight}`, display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                  <div style={{ width:20, height:20, borderRadius:99, border:`2px solid ${varianteChoisie===v.id?C.blue:C.grayLight}`, background:varianteChoisie===v.id?C.blue:"transparent", flexShrink:0 }} />
                  <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text }}>{formatEtiquetteVariante(v)}</span>
                </div>
              ))}
            </div>
            <button onClick={validerVariante} disabled={!varianteChoisie || saving} style={{ marginTop:12, width:"100%", padding:"13px", border:"none", borderRadius:12, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.white, background:(!varianteChoisie || saving)?C.grayLight:C.blue, cursor:(!varianteChoisie || saving)?"default":"pointer" }}>
              Valider
            </button>
          </>
        ) : (
          <>
            <input autoFocus value={query} onChange={e=>setQuery(e.target.value)}
              placeholder="🔍 Chercher un produit du catalogue..."
              style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`2px solid ${query?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:12 }}
            />
            {estFrancois && (
              <button onClick={()=>{ setBarcodeMessage(null); setScanDiag(null); setScanOuvert(true); }} disabled={rechercheBarcode} style={{ width:"100%", padding:"10px", marginBottom:12, border:`1.5px dashed ${C.blue}`, borderRadius:10, background:"transparent", color:C.blue, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, cursor:"pointer" }}>
                📷 Scanner le code-barres
              </button>
            )}
            {rechercheBarcode && <div style={{ textAlign:"center", padding:"8px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>Recherche du code-barres...</div>}
            {barcodeMessage && (
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#B8860B", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                <span>ℹ️ {barcodeMessage}</span>
                {codeBarresEnAttente && (
                  <button onClick={annulerApprentissage} style={{ background:"none", border:"none", color:C.textLight, fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:800, textDecoration:"underline", cursor:"pointer", flexShrink:0 }}>Annuler</button>
                )}
              </div>
            )}
            {error && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#CC0000", marginBottom:8 }}>⚠️ {error}</div>}
            <div style={{ overflowY:"auto", WebkitOverflowScrolling:"touch", flex:1, minHeight:0, paddingBottom:24 }}>
              {query.trim().length < 2 && (
                <div style={{ textAlign:"center", padding:"20px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>Tape au moins 2 caractères pour chercher</div>
              )}
              {(searching || resolvingVariante) && <div style={{ textAlign:"center", padding:"12px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>{resolvingVariante ? "Vérification..." : "Recherche..."}</div>}
              {!searching && query.trim().length >= 2 && results.length === 0 && !error && (
                <div style={{ textAlign:"center", padding:"20px 0", fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>
                  {codeBarresEnAttente ? "Produit introuvable — création gérée au prochain lot." : "Aucun produit trouvé"}
                </div>
              )}
              {results.map(p => (
                <div key={p.produit_id} onClick={()=>choisir(p)} style={{ padding:"12px 10px", borderBottom:`1px solid ${C.grayLight}`, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, cursor:(saving||resolvingVariante)?"default":"pointer", opacity:(saving||resolvingVariante)?0.6:1 }}>
                  <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text }}>{p.nom_reference}</span>
                  {p.dernier_prix != null && (
                    <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:700, color:C.textLight, flexShrink:0 }}>
                      {Number(p.dernier_prix).toFixed(2).replace('.', ',')} €
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {scanOuvert && (
        <BarcodeScannerSheet onDetected={rechercherParCodeBarres} onClose={()=>setScanOuvert(false)}/>
      )}
    </div>
  );
}

// ── MULTI PHOTO SHEET ────────────────────────────────────────────────────────
function MultiPhotoSheet({ onClose, refProducts, onSuccess }) {
  const F = "'Nunito',sans-serif";
  const MAX = 6;
  const [photos, setPhotos] = useState([]);
  const [adding, setAdding] = useState(false);
  const [scanningMulti, setScanningMulti] = useState(false);
  const [scanError, setScanError] = useState("");
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAdding(true);
    try {
      const base64 = await imageFileToJpegBase64(file);
      setPhotos(prev => [...prev, { base64, preview: `data:image/jpeg;base64,${base64}` }]);
    } catch (_) {}
    setAdding(false);
    e.target.value = "";
  };

  const removePhoto = (idx) => setPhotos(prev => prev.filter((_, i) => i !== idx));
  const canAdd = photos.length < MAX && !adding && !scanningMulti;

  const handleTerminer = async () => {
    setScanningMulti(true);
    setScanError("");
    try {
      const result = await scanMultipleTicketsWithClaude(photos.map(p => p.base64), refProducts);
      onSuccess(result);
    } catch (_) {
      setScanError("Échec de l'analyse, réessaie");
    }
    setScanningMulti(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex",
                  alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }}
         onClick={scanningMulti ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()}
           style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%",
                    animation:"slideUp 0.3s ease", maxHeight:"90vh", display:"flex", flexDirection:"column" }}>

        <div style={{ background:"#4A90D9", padding:"16px 20px", display:"flex",
                      alignItems:"center", justifyContent:"space-between",
                      flexShrink:0, borderRadius:"20px 20px 0 0" }}>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:17, color:"white" }}>📸 Grand ticket</div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontFamily:F, fontWeight:800, fontSize:14, color:"rgba(255,255,255,0.9)" }}>
              {photos.length} / {MAX} photos
            </span>
            <button onClick={scanningMulti ? undefined : onClose}
              style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99,
                       width:28, height:28, fontSize:14,
                       cursor:scanningMulti ? "default" : "pointer",
                       color:scanningMulti ? "rgba(255,255,255,0.3)" : "white",
                       opacity:scanningMulti ? 0.4 : 1 }}>✕</button>
          </div>
        </div>

        <div style={{ overflowY:"auto", flex:1, padding:"20px 20px 8px" }}>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
                 onChange={handleFileChange} style={{ display:"none" }} />

          {photos.length === 0 && !adding && (
            <div style={{ textAlign:"center", padding:"32px 20px", fontFamily:F, color:C.textLight }}>
              <div style={{ fontSize:48, marginBottom:12 }}>📷</div>
              <div style={{ fontWeight:700, fontSize:15, color:C.text, marginBottom:6 }}>Aucune photo pour l'instant</div>
              <div style={{ fontSize:13, lineHeight:1.6 }}>Commence par l'en-tête du ticket<br/>(nom + adresse du magasin)</div>
            </div>
          )}

          {adding && (
            <div style={{ textAlign:"center", padding:"20px", fontFamily:F, color:C.textLight, fontSize:14 }}>
              ⏳ Traitement en cours…
            </div>
          )}

          {photos.length > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, marginBottom:16 }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position:"relative", borderRadius:10, overflow:"hidden",
                                      aspectRatio:"1 / 1", background:"#eee" }}>
                  <img src={p.preview} alt={`Photo ${i + 1}`}
                       style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                  <button onClick={() => removePhoto(i)}
                    style={{ position:"absolute", top:4, right:4, background:"rgba(0,0,0,0.6)",
                             border:"none", borderRadius:99, width:22, height:22, color:"white",
                             fontSize:11, cursor:"pointer", display:"flex",
                             alignItems:"center", justifyContent:"center" }}>✕</button>
                  <div style={{ position:"absolute", bottom:4, left:6, fontFamily:F,
                                fontWeight:900, fontSize:11, color:"white",
                                textShadow:"0 1px 3px rgba(0,0,0,0.8)" }}>{i + 1}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding:"12px 20px 44px", borderTop:`1px solid ${C.grayLight}`, flexShrink:0 }}>
          {!canAdd && photos.length >= MAX && !scanningMulti && (
            <div style={{ fontFamily:F, fontSize:12, color:C.textLight, textAlign:"center", marginBottom:8 }}>
              Maximum atteint (6 photos)
            </div>
          )}
          {scanError && (
            <div style={{ fontFamily:F, fontSize:13, color:C.red, fontWeight:700, textAlign:"center", marginBottom:8 }}>
              ⚠️ {scanError}
            </div>
          )}
          <button onClick={() => canAdd && fileInputRef.current?.click()} disabled={!canAdd}
            style={{ width:"100%", padding:"14px", marginBottom:10,
                     border:`2px dashed ${canAdd ? "#4A90D9" : "#ccc"}`, borderRadius:14,
                     background:"transparent", fontFamily:F, fontWeight:900, fontSize:15,
                     color:canAdd ? "#4A90D9" : "#bbb", cursor:canAdd ? "pointer" : "default" }}>
            📷 Ajouter une photo
          </button>
          <button onClick={photos.length > 0 && !scanningMulti ? handleTerminer : undefined}
                  disabled={photos.length === 0 || scanningMulti}
            style={{ width:"100%", padding:"15px", border:"none", borderRadius:14,
                     background:photos.length > 0 ? C.green : "#ddd", fontFamily:F,
                     fontWeight:900, fontSize:15,
                     color:photos.length > 0 ? "white" : "#aaa",
                     cursor:photos.length > 0 && !scanningMulti ? "pointer" : "default" }}>
            {scanningMulti
              ? "⏳ Analyse en cours…"
              : photos.length > 0
                ? `✅ J'ai terminé (${photos.length} photo${photos.length > 1 ? "s" : ""})`
                : "J'ai terminé"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SCAN CHOIX SHEET ─────────────────────────────────────────────────────────
function ScanChoixSheet({ onClose, onUnePhoto, onPlusieursPhotos, onAutresOptions }) {
  const F = "'Nunito',sans-serif";
  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex",
               alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%",
                 animation:"slideUp 0.3s ease", overflow:"hidden" }}
      >
        <div style={{ background:C.orange, padding:"16px 20px", display:"flex",
                      alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:17, color:"#111" }}>
            🧾 Scanner mon ticket
          </div>
          <button onClick={onClose}
            style={{ background:"rgba(0,0,0,0.12)", border:"none", borderRadius:99,
                     width:28, height:28, fontSize:14, cursor:"pointer", color:"#111" }}>
            ✕
          </button>
        </div>

        <div style={{ padding:"24px 20px 44px" }}>
          <div style={{ display:"flex", gap:12, marginBottom:16 }}>
            <button onClick={onUnePhoto}
              style={{ flex:1, background:C.green, border:"none", borderRadius:16,
                       padding:"20px 12px", cursor:"pointer", display:"flex",
                       flexDirection:"column", alignItems:"center", gap:12 }}>
              <img src="/scan-plusieurs-photos.png" alt=""
                style={{ width:96, height:96, objectFit:"contain" }} />
              <span style={{ fontFamily:F, fontWeight:900, fontSize:17, color:C.white }}>
                Ticket court
              </span>
              <span style={{ fontFamily:F, fontSize:12, color:"rgba(255,255,255,0.85)", textAlign:"center", marginTop:4 }}>
                Tient en une seule photo
              </span>
            </button>

            <button onClick={onPlusieursPhotos}
              style={{ flex:1, background:"#4A90D9", border:"none", borderRadius:16,
                       padding:"20px 12px", cursor:"pointer", display:"flex",
                       flexDirection:"column", alignItems:"center", gap:12 }}>
              <img src="/scan-1-photo.png" alt=""
                style={{ width:96, height:96, objectFit:"contain" }} />
              <span style={{ fontFamily:F, fontWeight:900, fontSize:17, color:C.white }}>
                Grand ticket
              </span>
              <span style={{ fontFamily:F, fontSize:12, color:"rgba(255,255,255,0.85)", textAlign:"center", marginTop:4 }}>
                On le scanne en plusieurs fois
              </span>
            </button>
          </div>

          <div style={{ fontFamily:F, fontSize:12, color:C.textLight,
                        textAlign:"center", lineHeight:1.6, padding:"0 8px", marginBottom:16 }}>
            💡 Commence toujours par l'en-tête du ticket — nom et adresse du magasin
          </div>

          <button onClick={onAutresOptions}
            style={{ width:"100%", padding:"10px", border:"none", background:"none",
                     fontFamily:F, fontWeight:700, fontSize:13, color:"#4A90D9", cursor:"pointer" }}>
            Autres options
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AUTRES OPTIONS SHEET ─────────────────────────────────────────────────────
// Écran dédié ouvert depuis ScanChoixSheet ("Autres options"). Ne recrée
// aucun mécanisme : "Saisie manuelle" rebranche sur le même PriceEntrySheet
// que celui déjà utilisé ailleurs dans l'app (voir handleSavePrice), et
// "Importer une photo" rebranche sur ImportTicketSheet via le prop additif
// autoOpenGallery (voir plus haut) — même input galerie, aucune duplication.
function AutresOptionsSheet({ onClose, onBack, onGalleryImport, onManualEntry }) {
  const F = "'Nunito',sans-serif";
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", animation:"slideUp 0.3s ease", overflow:"hidden" }}>
        <div style={{ background:C.orange, padding:"16px 20px", display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={onBack} style={{ background:"rgba(0,0,0,0.12)", border:"none", borderRadius:99, width:28, height:28, fontSize:16, cursor:"pointer", color:"#111" }}>←</button>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:17, color:"#111", flex:1 }}>Autres options</div>
          <button onClick={onClose} style={{ background:"rgba(0,0,0,0.12)", border:"none", borderRadius:99, width:28, height:28, fontSize:14, cursor:"pointer", color:"#111" }}>✕</button>
        </div>

        <div style={{ padding:"20px 20px 44px", display:"flex", flexDirection:"column", gap:12 }}>
          <button onClick={onGalleryImport}
            style={{ width:"100%", padding:"16px", border:"none", borderRadius:14, background:"#4A90D9", fontFamily:F, cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left" }}>
            <span style={{ fontSize:26 }}>🖼️</span>
            <div>
              <div style={{ fontWeight:900, fontSize:15, color:"#fff" }}>Importer une photo</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.85)", marginTop:2 }}>Depuis ta pellicule</div>
            </div>
          </button>

          <button onClick={onManualEntry}
            style={{ width:"100%", padding:"16px", border:"none", borderRadius:14, background:C.orange, fontFamily:F, cursor:"pointer", display:"flex", alignItems:"center", gap:14, textAlign:"left" }}>
            <span style={{ fontSize:26 }}>✏️</span>
            <div>
              <div style={{ fontWeight:900, fontSize:15, color:"#fff" }}>Saisie manuelle</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.85)", marginTop:2 }}>Sans ticket, tu tapes le prix</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── HOME TAB ─────────────────────────────────────────────────────────────────
// #64.1 — animation pure d'affichage, aucun calcul d'économie touché ici.
// Roulement d'un montant vers un autre, easing décéléré (rapide→doux).
function animateAmountRoll(from, to, duration, onFrame, onDone) {
  const start = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    onFrame(from + (to - from) * ease(t));
    if (t < 1) requestAnimationFrame(step);
    else onDone?.();
  }
  requestAnimationFrame(step);
}

function runConfettiRain(layer, onDone) {
  if (!layer) { onDone?.(); return; }
  const COLORS = ["#fff", "#F5C200", "#FF7A00", "#4A90D9", "#FF4FA3", "#00B341", "#E5181B"];
  const N = 160;
  const vw = window.innerWidth, vh = window.innerHeight;
  for (let i = 0; i < N; i++) {
    setTimeout(() => {
      const size   = 8 + Math.random()*14;
      const isRect = Math.random() < 0.5;
      const color  = COLORS[Math.floor(Math.random()*COLORS.length)];
      const startX = Math.random()*vw;
      const drift  = (Math.random()-0.5)*220;
      const fallMs = 1600 + Math.random()*1400;
      const rot0   = Math.random()*360;
      const rot1   = rot0 + (Math.random()<0.5?1:-1)*(360+Math.random()*360);
      const el = document.createElement("div");
      el.style.cssText = `position:absolute;left:${startX}px;top:-20px;width:${size}px;height:${isRect?size*0.5:size}px;background:${color};${isRect?"":"border-radius:50%;"}pointer-events:none;`;
      layer.appendChild(el);
      el.animate([
        { transform:`translate(0,0) rotate(${rot0}deg)`,                 opacity:1, offset:0    },
        { transform:`translate(${drift}px,${vh+40}px) rotate(${rot1}deg)`, opacity:1, offset:0.85 },
        { transform:`translate(${drift}px,${vh+40}px) rotate(${rot1}deg)`, opacity:0, offset:1    },
      ], { duration:fallMs, easing:"cubic-bezier(.4,0,.6,1)" }).onfinish = () => el.remove();
    }, Math.random()*500);
  }
  setTimeout(() => onDone?.(), 3600);
}

// ── CHANTIER « MICRO » — LOT 4 : liaison d'un élément vocal au Catalogue ─────
// Feuille de recherche : même RPC que l'onglet Catalogue
// (rechercher_produits_catalogue) puis la MÊME fiche produit
// (ProductPickerSheet), réutilisée en mode « capture » : son onAdd ne touche
// PAS au caddie, il renvoie le choix (produit/variante/marque_pref) à
// l'élément de « Ma liste ». L'ajout réel au caddie est le Lot 5.
// Jamais de rattachement automatique : 0, 1 ou 50 résultats, c'est toujours
// l'utilisateur qui tape sur le produit voulu.
function MicroLienSheet({ element, onClose, onResolu, onIntrouvable }) {
  const F = "'Nunito',sans-serif";
  const [query,     setQuery]     = useState(element.nom || "");
  const [results,   setResults]   = useState([]);
  // true d'emblée seulement si la recherche initiale va réellement partir.
  const [searching, setSearching] = useState(() => (element.nom || "").trim().length >= 2);
  const [searchErr, setSearchErr] = useState(null);
  const [produitChoisi, setProduitChoisi] = useState(null);
  const seq = useRef(0);

  // Même colonnes que la recherche du Catalogue (rayon + catégorie pour
  // l'emoji), même protection anti-désordre.
  const chercher = useCallback(async (q) => {
    const mySeq = ++seq.current;
    setSearching(true);
    setSearchErr(null);
    try {
      const COLS = 'id, nom_reference, famille, sous_famille, sous_categorie_id, sous_categories(id, nom, categorie_id, categories(id, nom, slug, icone))';
      const { data: matches, error: errRpc } = await supabase
        .rpc('rechercher_produits_catalogue', { p_terme: q });
      if (mySeq !== seq.current) return;
      if (errRpc) { setSearchErr("Recherche impossible."); setSearching(false); return; }
      const ids = (matches || []).map(m => m.produit_id);
      if (ids.length === 0) { setResults([]); setSearching(false); return; }
      const { data, error } = await supabase.from('produits').select(COLS).in('id', ids);
      if (mySeq !== seq.current) return;
      if (error) { setSearchErr("Recherche impossible."); setSearching(false); return; }
      const parId = new Map((data || []).map(p => [p.id, p]));
      setResults(ids.map(id => parId.get(id)).filter(Boolean));
      setSearching(false);
    } catch (e) {
      if (mySeq !== seq.current) return;
      console.error("Erreur recherche liaison Micro :", e);
      setSearchErr("Recherche impossible.");
      setSearching(false);
    }
  }, []);

  // Recherche lancée d'emblée avec le nom de l'élément, puis à la frappe
  // (debounce ~280 ms, min 2 caractères — mêmes règles que le Catalogue).
  // Aucun setState synchrone dans l'effet (règle react-hooks) : le nettoyage
  // « moins de 2 caractères » se fait dans le onChange du champ, comme au
  // Catalogue.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => chercher(q), 280);
    return () => clearTimeout(timer);
  }, [query, chercher]);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"85vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease", overflow:"hidden" }}>

        <div style={{ background:C.blue, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div>
            <div style={{ fontFamily:F, fontWeight:900, fontSize:16, color:C.white }}>Relier « {element.nom} »</div>
            <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.75)" }}>Choisis le produit du catalogue qui correspond</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:32, height:32, color:C.white, fontSize:16, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ padding:"12px 14px", overflowY:"auto", flex:1 }}>
          <input value={query} onChange={e=>{
              const val = e.target.value;
              setQuery(val);
              if (val.trim().length < 2) {
                seq.current++; // invalide toute requête en cours
                setResults([]);
                setSearchErr(null);
                setSearching(false);
              }
            }}
            placeholder="🔍 Chercher dans le catalogue…"
            style={{ width:"100%", padding:"11px 14px", borderRadius:11, border:`2px solid ${C.blue}`, background:C.white, fontFamily:F, fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:12 }} />

          {searching && <div style={{ fontFamily:F, fontSize:13, color:C.gray }}>Recherche…</div>}
          {searchErr && !searching && (
            <div style={{ background:"#FEE", borderRadius:10, padding:"10px 12px", marginBottom:10, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <span style={{ fontFamily:F, fontSize:12, color:C.red, fontWeight:700 }}>⚠️ {searchErr}</span>
              <button onClick={()=>chercher(query.trim())} style={{ background:"none", border:"none", color:C.blue, fontWeight:700, cursor:"pointer", fontSize:12, textDecoration:"underline" }}>Réessayer</button>
            </div>
          )}

          {!searching && !searchErr && results.length === 0 && query.trim().length >= 2 && (
            <div style={{ background:C.grayLight, borderRadius:10, padding:"12px", textAlign:"center", marginBottom:10, fontFamily:F, fontSize:12.5, color:C.gray }}>
              Aucun produit du catalogue pour « {query.trim()} ».<br/>Modifie la recherche, ou marque l'élément introuvable.
            </div>
          )}

          {!searching && results.map(r => {
            const pres = getCategoryPresentation(r.sous_categories?.categories || {});
            const rayon = r.sous_categories?.nom || r.sous_categories?.categories?.nom || null;
            return (
              <button key={r.id} onClick={()=>setProduitChoisi(r)}
                style={{ width:"100%", display:"flex", alignItems:"center", gap:12, background:C.white, border:`1px solid ${C.grayLight}`, borderRadius:12, padding:"11px 13px", marginBottom:8, cursor:"pointer", textAlign:"left", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <span style={{ fontSize:20 }}>{pres.emoji}</span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"block", fontFamily:F, fontWeight:800, fontSize:14, color:C.text }}>{r.nom_reference}</span>
                  {rayon && <span style={{ display:"block", fontFamily:F, fontSize:11, color:pres.color, fontWeight:700, marginTop:1 }}>{rayon}</span>}
                </span>
                <span style={{ fontFamily:F, fontSize:16, color:C.gray }}>›</span>
              </button>
            );
          })}

          <button onClick={()=>onIntrouvable(element.id)}
            style={{ width:"100%", marginTop:6, padding:"11px", border:`1.5px dashed ${C.grayLight}`, borderRadius:11, background:"transparent", fontFamily:F, fontWeight:800, fontSize:13, color:C.textLight, cursor:"pointer" }}>
            🚫 Marquer « {element.nom} » introuvable au catalogue
          </button>
        </div>

        {/* Fiche produit habituelle en mode capture : le choix revient sur
            l'élément, rien ne part au caddie (Lot 5). */}
        {produitChoisi && (
          <ProductPickerSheet
            produit={produitChoisi}
            categoryPresentation={getCategoryPresentation(produitChoisi.sous_categories?.categories || {})}
            items={[]}
            onAdd={async (item) => {
              onResolu(element.id, {
                produit_id:          item.produit_id,
                variante_produit_id: item.variante_produit_id ?? null,
                marque_pref:         item.marque_pref === 'mdd' ? 'mdd' : 'nationale',
                produit_nom:         item.product,
                qty:                 item.qty,
              });
              return true;
            }}
            onClose={()=>setProduitChoisi(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── CHANTIER « MICRO » — LOTS 1-2 (shadow estFrancois) ───────────────────────
// Création vocale de la liste de courses. Lot 1 : enregistrement local
// (Démarrer/Arrêter, réécoute, suppression). Lot 2 : à l'arrêt de chaque
// prise, l'audio part vers l'Edge Function transcrire-liste-vocale
// (OpenRouter, comme scan-ticket) qui renvoie la liste structurée ; l'audio
// n'est jamais stocké. Toujours aucune écriture en base (caddie = Lot 5).
// L'écran n'est rendu que pour François (même mécanique shadow que le LOT 1
// « reconnaissance magasin ») : invisible pour tout autre utilisateur en prod.
// Prise plafonnée à 3 minutes (décision chantier), enchaînable à volonté.
const MICRO_PRISE_MAX_S = 3 * 60;

function MicroTab({ onAdd, setTab }) {
  const F = "'Nunito',sans-serif";
  // Détections une seule fois au montage (pas de setState synchrone au rendu).
  // Le micro exige un contexte sécurisé (https, ou localhost) : en http local,
  // mediaDevices n'existe même pas — on distingue ce cas d'un vrai navigateur
  // incompatible pour afficher le bon message (retour de test du 2026-08-11).
  const [contexteSecurise] = useState(() =>
    typeof window !== "undefined" && window.isSecureContext !== false
  );
  // getUserMedia + MediaRecorder requis.
  // (SpeechRecognition volontairement PAS utilisée : cassée en PWA iOS.)
  const [supporte] = useState(() =>
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" && !!window.MediaRecorder
  );
  const [etat,   setEtat]   = useState("repos"); // repos | demande | ecoute
  const [erreur, setErreur] = useState(null);
  const [prises, setPrises] = useState([]);      // { id, url, duree, blob, mime, statut, resultat }
  const [chrono, setChrono] = useState(0);       // secondes de la prise en cours

  // Lot 3 — RÉCAPITULATIF unique, alimenté par toutes les prises + les ajouts
  // manuels. Restauré depuis le brouillon localStorage au montage (l'audio des
  // anciennes prises, lui, n'est pas conservé — texte seulement).
  const [elementsListe, setElementsListe] = useState(() => {
    const d = lireMicroDraft();
    // Lot 4 — un brouillon d'avant le Lot 4 n'a pas de statut de liaison :
    // défauts appliqués à la lecture (les valeurs présentes gagnent).
    return (Array.isArray(d?.elements) ? d.elements : []).map(e => ({
      statut_resolution: "a_relier", produit_id: null, variante_produit_id: null, produit_nom: null, ...e,
    }));
  });
  // Lot 4 — élément en cours de liaison au Catalogue (feuille ouverte).
  const [lienElement, setLienElement] = useState(null);
  // Lot 5 — ajout groupé au caddie.
  const [confirmAjout, setConfirmAjout] = useState(false);
  const [ajoutEnCours, setAjoutEnCours] = useState(false);
  const [bilanAjout,   setBilanAjout]   = useState(null); // { ajoutes, doublons, echecs }
  const [listeRestauree] = useState(() => (lireMicroDraft()?.elements?.length ?? 0) > 0);
  const [nouvelElement, setNouvelElement] = useState("");
  const [editionId,  setEditionId]  = useState(null);
  const [editionNom, setEditionNom] = useState("");
  const [confirmVider, setConfirmVider] = useState(false);

  // Brouillon écrit à chaque évolution du récapitulatif ; liste vide = brouillon
  // effacé (rien à reprendre).
  useEffect(() => {
    if (elementsListe.length === 0) effacerMicroDraft();
    else ecrireMicroDraft({ version: 1, elements: elementsListe });
  }, [elementsListe]);

  const recorderRef    = useRef(null);
  const streamRef      = useRef(null);
  const chunksRef      = useRef([]);
  const chronoRef      = useRef(null);
  const debutRef       = useRef(0);
  const interrompueRef = useRef(false); // écran éteint / app en arrière-plan
  // Miroir des URLs de réécoute pour pouvoir les libérer au démontage
  // (le cleanup d'effet n'a pas accès au dernier état `prises`).
  const urlsRef        = useRef([]);
  useEffect(() => { urlsRef.current = prises.map(p => p.url); }, [prises]);

  const reducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const stopperChrono = () => { if (chronoRef.current) { clearInterval(chronoRef.current); chronoRef.current = null; } };
  const libererStream = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };

  // Lot 6 — verrou d'écran (Wake Lock) pendant l'écoute : l'écran ne s'éteint
  // pas tout seul en pleine prise. Supporté Safari 16.4+ ; si absent ou refusé,
  // on continue sans (la consigne « garde l'écran allumé » reste affichée).
  const wakeLockRef = useRef(null);
  const demanderWakeLock = async () => {
    try { wakeLockRef.current = await navigator.wakeLock?.request?.("screen") ?? null; }
    catch { wakeLockRef.current = null; /* refusé (batterie faible…) : non bloquant */ }
  };
  const relacherWakeLock = () => {
    try { wakeLockRef.current?.release?.(); } catch { /* déjà relâché */ }
    wakeLockRef.current = null;
  };

  const arreter = () => {
    stopperChrono();
    relacherWakeLock();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); return; } catch { /* onstop ne viendra pas : nettoyage direct */ }
    }
    libererStream();
    setEtat("repos");
    setChrono(0);
  };

  const demarrer = async () => {
    if (etat !== "repos") return;
    setErreur(null);
    setEtat("demande");

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const nom = e?.name || "";
      if (nom === "NotAllowedError" || nom === "SecurityError" || nom === "PermissionDeniedError") {
        setErreur("PrixMalin n'a pas l'autorisation d'utiliser le micro. Sur iPhone : Réglages > Apps > Safari > Micro, puis reviens ici et réessaie.");
      } else if (nom === "NotFoundError" || nom === "OverconstrainedError") {
        setErreur("Aucun microphone n'a été trouvé sur cet appareil.");
      } else {
        console.error("Erreur accès micro :", e);
        setErreur("Impossible d'accéder au micro. Ferme les autres apps qui l'utilisent, puis réessaie.");
      }
      setEtat("repos");
      return;
    }
    streamRef.current = stream;

    // Format : Safari iOS ne sait produire que audio/mp4 (AAC) ; Chrome/Android
    // préfère webm. Si isTypeSupported manque ou refuse tout, on laisse le
    // navigateur choisir son format par défaut.
    let options;
    try {
      if (window.MediaRecorder.isTypeSupported?.("audio/mp4"))       options = { mimeType: "audio/mp4" };
      else if (window.MediaRecorder.isTypeSupported?.("audio/webm")) options = { mimeType: "audio/webm" };
    } catch { /* on laisse options indéfini */ }

    let rec;
    try {
      rec = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
    } catch {
      try { rec = new MediaRecorder(stream); }
      catch (e2) {
        console.error("MediaRecorder indisponible :", e2);
        libererStream();
        setErreur("L'enregistrement audio n'est pas disponible sur ce navigateur.");
        setEtat("repos");
        return;
      }
    }

    chunksRef.current = [];
    rec.ondataavailable = ev => { if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data); };
    // Erreur matérielle en cours de prise (micro repris par un appel, etc.)
    rec.onerror = () => { interrompueRef.current = true; arreter(); };
    rec.onstop = () => {
      stopperChrono();
      relacherWakeLock();
      const duree = Math.max(1, Math.round((Date.now() - debutRef.current) / 1000));
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/mp4" });
      chunksRef.current = [];
      libererStream();
      if (blob.size > 0) {
        const url = URL.createObjectURL(blob);
        // id unique sans nouvel appel Date.now() (règle react-hooks/purity) :
        // l'horodatage de DÉBUT de prise est déjà unique, le hasard décolle
        // deux prises démarrées dans la même milliseconde.
        const id = debutRef.current + Math.random();
        const mime = rec.mimeType || "audio/mp4";
        // Le blob reste attaché à la prise pour pouvoir RELANCER la
        // transcription en cas d'échec (réseau) sans réenregistrer.
        setPrises(prev => [...prev, { id, url, duree, blob, mime, statut: "transcription", resultat: null, erreurMsg: null }]);
        lancerTranscription(id, blob, mime);
      } else if (!interrompueRef.current) {
        setErreur("Rien n'a été enregistré, réessaie.");
      }
      if (interrompueRef.current) {
        setErreur("⚠️ L'écoute a été interrompue (écran éteint, appel ou changement d'app). Ce qui a été dit avant la coupure est conservé ci-dessous.");
      }
      interrompueRef.current = false;
      setEtat("repos");
      setChrono(0);
    };

    recorderRef.current = rec;
    // Lot 6 — verrou d'écran le temps de la prise (best effort, jamais bloquant).
    demanderWakeLock();
    // Faux positif react-hooks/purity : demarrer est un gestionnaire de clic
    // (jamais appelé pendant le rendu), l'horodatage de début de prise y est
    // légitime.
    // eslint-disable-next-line react-hooks/purity
    debutRef.current = Date.now();
    setChrono(0);
    // timeslice 1 s : les morceaux arrivent au fil de l'eau — si iOS coupe
    // brutalement, tout ce qui précède la coupure est déjà dans chunksRef.
    rec.start(1000);
    setEtat("ecoute");
    chronoRef.current = setInterval(() => {
      const s = Math.round((Date.now() - debutRef.current) / 1000);
      setChrono(s);
      if (s >= MICRO_PRISE_MAX_S) arreter(); // plafond 3 min : arrêt propre, prise conservée
    }, 250);
  };

  // iOS coupe le micro quand l'app passe en arrière-plan : on arrête proprement
  // nous-mêmes pour conserver la prise et l'expliquer, plutôt que de laisser un
  // enregistreur zombie. Refs uniquement (pas de dépendance d'état).
  useEffect(() => {
    const onHide = () => {
      const rec = recorderRef.current;
      if (document.visibilityState === "hidden" && rec && rec.state === "recording") {
        interrompueRef.current = true;
        if (chronoRef.current) { clearInterval(chronoRef.current); chronoRef.current = null; }
        try { rec.stop(); } catch { /* déjà arrêté */ }
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // Démontage : arrêt de l'enregistreur, libération du micro, du verrou
  // d'écran et des URLs de réécoute.
  useEffect(() => () => {
    if (chronoRef.current) clearInterval(chronoRef.current);
    try { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); } catch { /* ignore */ }
    streamRef.current?.getTracks().forEach(t => t.stop());
    try { wakeLockRef.current?.release?.(); } catch { /* déjà relâché */ }
    urlsRef.current.forEach(u => URL.revokeObjectURL(u));
  }, []);

  const supprimerPrise = (id) => {
    setPrises(prev => {
      const p = prev.find(x => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter(x => x.id !== id);
    });
  };

  // Lot 2 — envoie la prise à l'Edge Function transcrire-liste-vocale et range
  // le résultat (ou l'erreur) SUR la prise. L'échec réseau n'efface jamais la
  // prise : le blob est conservé et le bouton Réessayer relance cet appel.
  const lancerTranscription = async (priseId, blob, mime) => {
    setPrises(prev => prev.map(p => p.id === priseId ? { ...p, statut: "transcription", erreurMsg: null } : p));
    try {
      const resultat = await transcrireAudioListe(blob, mime);
      setPrises(prev => prev.map(p => p.id === priseId ? { ...p, statut: "ok", resultat } : p));
      // Lot 3 — les éléments extraits rejoignent le RÉCAPITULATIF unique
      // (une seule fois : le statut ne repasse jamais de "ok" à autre chose).
      if (resultat.elements.length > 0) {
        setElementsListe(prev => [
          ...prev,
          ...resultat.elements.map(e => ({ ...e, id: genIdElementMicro(), origine: "vocal", statut_resolution: "a_relier", produit_id: null, variante_produit_id: null, produit_nom: null })),
        ]);
      }
      // Lot 6 — mesure d'usage (jamais le contenu : des comptes, pas des mots).
      capturerEvenement("micro_prise_transcrite", {
        nb_elements: resultat.elements.length,
        nb_ignores: resultat.elements_ignores.length,
      });
    } catch (e) {
      console.error("Erreur transcription prise vocale :", e);
      setPrises(prev => prev.map(p => p.id === priseId
        ? { ...p, statut: "erreur", erreurMsg: "Transcription impossible (pas de réseau ?). La prise est conservée, tu peux réessayer." }
        : p));
    }
  };

  // Lot 3 — actions du récapitulatif. Renommer vaut validation humaine :
  // la confiance passe à "haute" (le badge « à vérifier » disparaît).
  const ajouterElementManuel = () => {
    const nom = nouvelElement.trim();
    if (!nom) return;
    setElementsListe(prev => [...prev, { id: genIdElementMicro(), texte_entendu: "", nom, quantite: null, unite: null, qualificatifs: null, confiance: "haute", origine: "manuel", statut_resolution: "a_relier", produit_id: null, variante_produit_id: null, produit_nom: null }]);
    setNouvelElement("");
  };
  const changerQuantite = (id, delta) => {
    setElementsListe(prev => prev.map(e => e.id === id ? { ...e, quantite: Math.max(1, (e.quantite ?? 1) + delta) } : e));
  };
  const supprimerElement = (id) => setElementsListe(prev => prev.filter(e => e.id !== id));
  const demarrerEdition = (el) => { setEditionId(el.id); setEditionNom(el.nom); };
  const validerEdition = () => {
    const nom = editionNom.trim();
    // Renommer remet aussi la liaison Catalogue à zéro : le nouveau nom peut
    // correspondre à un tout autre produit (statut « à relier »).
    if (nom) setElementsListe(prev => prev.map(e => e.id === editionId
      ? { ...e, nom, confiance: "haute", statut_resolution: "a_relier", produit_id: null, variante_produit_id: null, produit_nom: null }
      : e));
    setEditionId(null); setEditionNom("");
  };

  // Lot 4 — issue de la feuille de liaison : le choix (produit/variante/marque)
  // est écrit SUR l'élément ; la quantité choisie dans la fiche remplace celle
  // de l'élément seulement si elle a été modifiée (≠ 1).
  const resoudreElement = (id, liaison) => {
    setElementsListe(prev => prev.map(e => e.id === id
      ? {
          ...e,
          statut_resolution:   "resolu",
          produit_id:          liaison.produit_id,
          variante_produit_id: liaison.variante_produit_id,
          marque_pref:         liaison.marque_pref,
          produit_nom:         liaison.produit_nom,
          quantite:            (liaison.qty && liaison.qty !== 1) ? liaison.qty : e.quantite,
          confiance:           "haute", // choix humain = validé
        }
      : e));
    setLienElement(null);
  };
  const marquerIntrouvable = (id) => {
    setElementsListe(prev => prev.map(e => e.id === id
      ? { ...e, statut_resolution: "introuvable", produit_id: null, variante_produit_id: null, produit_nom: null }
      : e));
    setLienElement(null);
  };

  // Lot 5 — ajout groupé au caddie via le addItem OFFICIEL (le même que le
  // Catalogue) : un appel par élément, séquentiel. Relié => produit/variante/
  // marque_pref ; non relié ou introuvable => texte libre (le rapprochement
  // alias existant d'addItem peut encore le reconnaître). Les succès et les
  // doublons sortent de « Ma liste » (et donc du brouillon) ; les échecs
  // restent, rien n'est jamais perdu.
  const lancerAjoutCaddie = async () => {
    if (ajoutEnCours || elementsListe.length === 0 || typeof onAdd !== "function") return;
    setConfirmAjout(false);
    setAjoutEnCours(true);

    let ajoutes = 0, doublons = 0;
    const idsEchecs = new Set();
    for (const e of [...elementsListe]) {
      const estRelie = e.statut_resolution === "resolu" && e.produit_id;
      const item = estRelie
        ? { product: e.produit_nom, format: "", brand: "", qty: e.quantite ?? 1, checked: false,
            produit_id: e.produit_id, variante_produit_id: e.variante_produit_id ?? null,
            marque_pref: e.marque_pref === "mdd" ? "mdd" : "nationale" }
        : { product: e.nom, format: "", brand: "", qty: e.quantite ?? 1, checked: false };
      let ok = false;
      try { ok = await onAdd(item); } catch (err) { console.error("Erreur ajout caddie depuis Micro :", err); ok = false; }
      if (ok === true) ajoutes++;
      else if (ok === "duplicate") doublons++;
      else idsEchecs.add(e.id);
    }

    setElementsListe(prev => prev.filter(e => idsEchecs.has(e.id)));
    setBilanAjout({ ajoutes, doublons, echecs: idsEchecs.size });
    setAjoutEnCours(false);
    // Lot 6 — mesure d'usage (comptes uniquement, jamais les produits).
    capturerEvenement("micro_ajout_caddie", { ajoutes, doublons, echecs: idsEchecs.size });
  };
  // Fusion : TOUJOURS à la demande de l'utilisateur, jamais automatique.
  const fusionner = (nomNorm) => setElementsListe(prev => fusionnerParNom(prev, nomNorm));
  const viderTout = () => {
    setPrises(prev => { prev.forEach(p => URL.revokeObjectURL(p.url)); return []; });
    setElementsListe([]);
    effacerMicroDraft();
    setConfirmVider(false);
  };

  // Doublons candidats à la fusion (nom normalisé présent 2 fois ou plus).
  const doublons = useMemo(
    () => [...comptesParNom(elementsListe).entries()].filter(([, c]) => c > 1),
    [elementsListe]
  );

  // Lot 4 — bilan de liaison affiché sous le titre de la liste.
  const bilanLiaison = useMemo(() => {
    let ok = 0, ko = 0, todo = 0;
    for (const e of elementsListe) {
      const s = e.statut_resolution ?? "a_relier";
      if (s === "resolu") ok++; else if (s === "introuvable") ko++; else todo++;
    }
    return { ok, ko, todo };
  }, [elementsListe]);

  const fmtDuree = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const ecoute = etat === "ecoute";

  return (
    <div style={{ padding:"16px 16px 110px" }}>

      {/* Titre — même gabarit que le Catalogue */}
      <div style={{ marginBottom:6 }}>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:24, color:C.text, letterSpacing:"-0.5px" }}>
          Micro <span style={{ color:"#CC0000" }}>🎤</span>
        </div>
        <div style={{ fontFamily:F, fontSize:13, color:C.gray, marginTop:2 }}>
          Dis ce qu'il te manque, on en fera ta liste de courses
        </div>
      </div>

      {/* Badge shadow : rappel que cette version n'est visible que par François */}
      <div style={{ display:"inline-block", background:"#FFF8E6", border:"1.5px solid #F5C200", borderRadius:99, padding:"4px 12px", marginBottom:14, fontFamily:F, fontSize:11, fontWeight:800, color:"#7A6000" }}>
        🧪 Version test — visible uniquement par toi
      </div>

      {!contexteSecurise && (
        <div style={{ background:"#FEE", borderRadius:12, padding:"14px", fontFamily:F, fontSize:13, color:C.red, fontWeight:700 }}>
          ⚠️ Le micro exige une adresse sécurisée (https). Tu es sur une adresse http (serveur de test local ?) : ouvre l'app via son adresse https habituelle.
        </div>
      )}
      {contexteSecurise && !supporte && (
        <div style={{ background:"#FEE", borderRadius:12, padding:"14px", fontFamily:F, fontSize:13, color:C.red, fontWeight:700 }}>
          ⚠️ Ce navigateur ne permet pas d'enregistrer le micro. Essaie avec Safari (iPhone) ou Chrome (Android) à jour.
        </div>
      )}

      {contexteSecurise && supporte && (
        <>
          {/* Confidentialité — Lot 2 : l'audio part à l'arrêt de la prise pour
              être transcrit, puis est oublié ; jamais stocké nulle part. */}
          <div style={{ background:C.grayLight, borderRadius:12, padding:"10px 12px", marginBottom:18, fontFamily:F, fontSize:12, color:C.textLight }}>
            🔒 Quand tu arrêtes une prise, l'audio est envoyé de façon sécurisée pour être transformé en liste, puis aussitôt oublié : il n'est jamais conservé.
          </div>

          {/* Bouton principal Démarrer / Arrêter — état d'écoute impossible à rater */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:14, margin:"6px 0 24px" }}>
            <button
              onClick={ecoute ? arreter : demarrer}
              disabled={etat === "demande"}
              style={{
                width:150, height:150, borderRadius:"50%",
                background: ecoute ? "#E5181B" : (etat === "demande" ? "#F0A0A2" : "#E5181B"),
                border:"5px solid #fff", cursor: etat === "demande" ? "default" : "pointer",
                display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6,
                boxShadow:"0 8px 36px rgba(229,24,27,0.55)",
                animation: ecoute && !reducedMotion ? "microPulse 1.4s ease-out infinite" : "none",
              }}>
              <span style={{ fontSize:34 }}>{ecoute ? "⏹" : "🎤"}</span>
              <span style={{ fontFamily:F, fontWeight:900, fontSize:17, color:"#fff" }}>
                {etat === "demande" ? "Autorisation…" : ecoute ? "Arrêter" : "Démarrer"}
              </span>
            </button>

            {ecoute && (
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ width:10, height:10, borderRadius:99, background:"#E5181B", animation: reducedMotion ? "none" : "fadeIn 1s ease-in-out infinite alternate" }} />
                <span style={{ fontFamily:F, fontWeight:900, fontSize:15, color:"#E5181B" }}>
                  J'écoute… {fmtDuree(chrono)}
                </span>
                <span style={{ fontFamily:F, fontSize:12, color:C.gray }}>(max 3:00)</span>
              </div>
            )}
            {!ecoute && etat === "repos" && (
              <div style={{ fontFamily:F, fontSize:13, color:C.textLight, textAlign:"center", maxWidth:280 }}>
                Garde l'écran allumé pendant que tu parles. Tu peux enchaîner plusieurs prises (frigo, placards…).
              </div>
            )}
          </div>

          {erreur && (
            <div style={{ background:"#FEE", borderRadius:12, padding:"12px 14px", marginBottom:16, fontFamily:F, fontSize:13, color:C.red, fontWeight:700 }}>
              {erreur}
            </div>
          )}

          {/* Lot 3 — RÉCAPITULATIF unique : toutes les prises + ajouts manuels,
              entièrement éditable, sauvegardé en brouillon localStorage. */}
          {(elementsListe.length > 0 || listeRestauree) && (
            <div style={{ marginBottom:20 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <div>
                  <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase" }}>
                    Ma liste ({elementsListe.length})
                  </div>
                  {elementsListe.length > 0 && (
                    <div style={{ fontFamily:F, fontSize:10.5, fontWeight:700, color:C.gray, marginTop:1 }}>
                      <span style={{ color:C.green }}>{bilanLiaison.ok} relié{bilanLiaison.ok > 1 ? "s" : ""}</span>
                      {" · "}{bilanLiaison.todo} à relier
                      {bilanLiaison.ko > 0 && <span style={{ color:"#B45309" }}>{" · "}{bilanLiaison.ko} introuvable{bilanLiaison.ko > 1 ? "s" : ""}</span>}
                    </div>
                  )}
                </div>
                {elementsListe.length > 0 && (
                  <button onClick={() => setConfirmVider(true)}
                    style={{ background:"none", border:"none", fontFamily:F, fontSize:12, fontWeight:800, color:C.red, cursor:"pointer", padding:"2px 4px" }}>
                    Vider et recommencer
                  </button>
                )}
              </div>

              {listeRestauree && (
                <div style={{ background:"#FFF8E6", border:"1px solid #F5C200", borderRadius:10, padding:"7px 10px", marginBottom:8, fontFamily:F, fontSize:11, fontWeight:700, color:"#7A6000" }}>
                  🗂 Liste reprise de ta dernière session (l'audio, lui, n'est jamais conservé).
                </div>
              )}

              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {elementsListe.map((e) => (
                  <div key={e.id} style={{ background:C.white, border:`1px solid ${C.grayLight}`, borderRadius:12, padding:"9px 12px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                   <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    {editionId === e.id ? (
                      <>
                        <input value={editionNom} autoFocus onChange={ev => setEditionNom(ev.target.value)}
                          onKeyDown={ev => { if (ev.key === "Enter") validerEdition(); }}
                          style={{ flex:1, minWidth:0, padding:"7px 10px", borderRadius:9, border:`2px solid ${C.blue}`, fontFamily:F, fontSize:14, fontWeight:700, color:C.text, outline:"none" }} />
                        <button onClick={validerEdition}
                          style={{ border:"none", borderRadius:9, background:C.green, color:C.white, fontFamily:F, fontWeight:900, fontSize:13, padding:"8px 12px", cursor:"pointer", flexShrink:0 }}>
                          OK
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => demarrerEdition(e)} style={{ flex:1, minWidth:0, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"left" }}>
                          <span style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                            <span style={{ fontFamily:F, fontWeight:800, fontSize:14, color:C.text }}>
                              {e.nom}{e.unite ? ` (${e.unite}${(e.quantite ?? 1) > 1 ? "s" : ""})` : ""}
                            </span>
                            {e.qualificatifs && <span style={{ fontFamily:F, fontSize:11, color:C.gray }}>({e.qualificatifs})</span>}
                            {e.confiance === "faible" && (
                              <span style={{ fontFamily:F, fontSize:10, fontWeight:800, color:"#7A6000", background:"#FFF8E6", border:"1px solid #F5C200", borderRadius:99, padding:"1px 8px" }}>
                                à vérifier
                              </span>
                            )}
                          </span>
                          {e.texte_entendu && normaliserNomElement(e.texte_entendu) !== normaliserNomElement(e.nom) && (
                            <span style={{ display:"block", fontFamily:F, fontSize:10.5, fontStyle:"italic", color:C.gray, marginTop:1 }}>
                              entendu : « {e.texte_entendu} »
                            </span>
                          )}
                        </button>
                        <div style={{ display:"flex", alignItems:"center", gap:0, border:`1px solid ${C.grayLight}`, borderRadius:9, overflow:"hidden", flexShrink:0 }}>
                          <button onClick={() => changerQuantite(e.id, -1)} aria-label="Diminuer la quantité"
                            style={{ border:"none", background:C.grayLight, width:28, height:30, fontSize:15, fontWeight:900, color:C.text, cursor:"pointer" }}>−</button>
                          <span style={{ fontFamily:F, fontWeight:900, fontSize:13, color:C.text, minWidth:24, textAlign:"center" }}>{e.quantite ?? 1}</span>
                          <button onClick={() => changerQuantite(e.id, 1)} aria-label="Augmenter la quantité"
                            style={{ border:"none", background:C.grayLight, width:28, height:30, fontSize:15, fontWeight:900, color:C.text, cursor:"pointer" }}>+</button>
                        </div>
                        <button onClick={() => supprimerElement(e.id)} aria-label={`Supprimer ${e.nom}`}
                          style={{ border:"none", background:"none", cursor:"pointer", fontSize:16, flexShrink:0, padding:2 }}>
                          🗑️
                        </button>
                      </>
                    )}
                   </div>

                   {/* Lot 4 — statut de liaison au Catalogue (hors mode édition) */}
                   {editionId !== e.id && (
                     <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                       {(e.statut_resolution ?? "a_relier") === "a_relier" && (
                         <button onClick={() => setLienElement(e)}
                           style={{ border:"1px solid #BFDBFE", borderRadius:99, background:"#EFF6FF", color:"#1D4ED8", fontFamily:F, fontWeight:800, fontSize:11.5, padding:"5px 11px", cursor:"pointer" }}>
                           🔗 Relier au catalogue
                         </button>
                       )}
                       {e.statut_resolution === "resolu" && (
                         <>
                           <span style={{ fontFamily:F, fontSize:11.5, fontWeight:800, color:C.green }}>
                             ✓ {e.produit_nom}
                           </span>
                           <button onClick={() => setLienElement(e)}
                             style={{ border:"none", background:"none", fontFamily:F, fontSize:11, fontWeight:700, color:C.gray, cursor:"pointer", textDecoration:"underline", padding:0 }}>
                             changer
                           </button>
                         </>
                       )}
                       {e.statut_resolution === "introuvable" && (
                         <>
                           <span style={{ fontFamily:F, fontSize:11, fontWeight:800, color:"#B45309", background:"#FFF7ED", border:"1px solid #FDBA74", borderRadius:99, padding:"3px 10px" }}>
                             🚫 Introuvable au catalogue
                           </span>
                           <button onClick={() => setLienElement(e)}
                             style={{ border:"none", background:"none", fontFamily:F, fontSize:11, fontWeight:700, color:C.gray, cursor:"pointer", textDecoration:"underline", padding:0 }}>
                             chercher quand même
                           </button>
                         </>
                       )}
                     </div>
                   )}
                  </div>
                ))}
              </div>

              {/* Fusion des doublons — proposée, jamais imposée */}
              {doublons.map(([nomNorm, count]) => (
                <div key={nomNorm} style={{ display:"flex", alignItems:"center", gap:8, background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:10, padding:"8px 10px", marginTop:8, flexWrap:"wrap" }}>
                  <span style={{ fontFamily:F, fontSize:12, fontWeight:700, color:"#1D4ED8" }}>
                    « {nomNorm} » apparaît {count} fois
                  </span>
                  <button onClick={() => fusionner(nomNorm)}
                    style={{ border:"none", borderRadius:99, background:"#1D4ED8", color:"#fff", fontFamily:F, fontWeight:800, fontSize:12, padding:"5px 12px", cursor:"pointer" }}>
                    Fusionner en une ligne
                  </button>
                </div>
              ))}

              {/* Ajout manuel — produit oublié ou trop mal transcrit */}
              <div style={{ display:"flex", gap:8, marginTop:10 }}>
                <input value={nouvelElement} onChange={ev => setNouvelElement(ev.target.value)}
                  onKeyDown={ev => { if (ev.key === "Enter") ajouterElementManuel(); }}
                  placeholder="Ajouter un produit à la main…"
                  style={{ flex:1, minWidth:0, padding:"10px 12px", borderRadius:10, border:`1.5px solid ${C.grayLight}`, fontFamily:F, fontSize:13, fontWeight:700, color:C.text, outline:"none" }} />
                <button onClick={ajouterElementManuel} disabled={!nouvelElement.trim()}
                  style={{ border:"none", borderRadius:10, background:nouvelElement.trim() ? C.green : "#ccc", color:C.white, fontFamily:F, fontWeight:900, fontSize:13, padding:"10px 14px", cursor:nouvelElement.trim() ? "pointer" : "default", flexShrink:0 }}>
                  Ajouter
                </button>
              </div>

              {/* Lot 5 — envoi de toute la liste vers le caddie officiel */}
              {elementsListe.length > 0 && (
                <button onClick={() => setConfirmAjout(true)} disabled={ajoutEnCours}
                  style={{ width:"100%", marginTop:12, padding:"14px", border:"none", borderRadius:13,
                    background: ajoutEnCours ? "#9CCFAF" : C.green, color:C.white,
                    fontFamily:F, fontWeight:900, fontSize:15, cursor: ajoutEnCours ? "default" : "pointer",
                    boxShadow:"0 4px 14px rgba(0,179,65,0.35)", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  {ajoutEnCours ? (
                    <>
                      <span style={{ width:16, height:16, border:"3px solid rgba(255,255,255,0.4)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.8s linear infinite", display:"inline-block" }}/>
                      Ajout en cours…
                    </>
                  ) : (
                    <>🛒 Ajouter au caddie ({elementsListe.length})</>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Lot 5 — confirmation avant l'ajout groupé : le détail est annoncé,
              l'utilisateur peut annuler pour aller relier ce qui manque. */}
          {confirmAjout && (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }} onClick={() => setConfirmAjout(false)}>
              <div onClick={ev => ev.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%" }}>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:8 }}>Ajouter au caddie ?</div>
                <div style={{ fontFamily:F, fontSize:13, color:"#555", lineHeight:1.5, marginBottom:6 }}>
                  <span style={{ color:C.green, fontWeight:800 }}>{bilanLiaison.ok}</span> produit{bilanLiaison.ok > 1 ? "s" : ""} relié{bilanLiaison.ok > 1 ? "s" : ""} au catalogue
                </div>
                {(bilanLiaison.todo + bilanLiaison.ko) > 0 && (
                  <div style={{ fontFamily:F, fontSize:13, color:"#555", lineHeight:1.5, marginBottom:6 }}>
                    <span style={{ color:"#B45309", fontWeight:800 }}>{bilanLiaison.todo + bilanLiaison.ko}</span> partiront en <strong>texte libre</strong> (non reliés ou introuvables) — tu pourras les préciser plus tard dans Ma liste.
                  </div>
                )}
                <div style={{ fontFamily:F, fontSize:12, color:"#999", marginBottom:16 }}>
                  Les quantités et tes préférences de marque sont conservées.
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={lancerAjoutCaddie} style={{ flex:1, padding:"12px", border:"none", borderRadius:10, background:C.green, fontFamily:F, fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer" }}>
                    Ajouter
                  </button>
                  <button onClick={() => setConfirmAjout(false)} style={{ padding:"12px 16px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:F, fontWeight:800, fontSize:14, color:"#333", cursor:"pointer" }}>
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Lot 5 — bilan après l'ajout groupé */}
          {bilanAjout && (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }} onClick={() => setBilanAjout(null)}>
              <div onClick={ev => ev.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%", textAlign:"center" }}>
                <div style={{ fontSize:36, marginBottom:6 }}>{bilanAjout.echecs > 0 ? "⚠️" : "🎉"}</div>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:16, color:"#1a1a1a", marginBottom:10 }}>
                  {bilanAjout.ajoutes > 0 ? `${bilanAjout.ajoutes} produit${bilanAjout.ajoutes > 1 ? "s" : ""} ajouté${bilanAjout.ajoutes > 1 ? "s" : ""} à ton caddie` : "Aucun produit ajouté"}
                </div>
                <div style={{ fontFamily:F, fontSize:13, color:"#555", lineHeight:1.6, marginBottom:16 }}>
                  {bilanAjout.doublons > 0 && <div>{bilanAjout.doublons} déjà dans ta liste (non dupliqué{bilanAjout.doublons > 1 ? "s" : ""})</div>}
                  {bilanAjout.echecs > 0 && <div style={{ color:C.red, fontWeight:700 }}>{bilanAjout.echecs} échec{bilanAjout.echecs > 1 ? "s" : ""} (réseau ?) — ces éléments restent dans Ma liste, réessaie.</div>}
                </div>
                <button onClick={() => { setBilanAjout(null); setTab?.("list"); }}
                  style={{ width:"100%", padding:"13px", border:"none", borderRadius:11, background:"#E5181B", fontFamily:F, fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                  Voir ma liste 🛒
                </button>
                <button onClick={() => setBilanAjout(null)}
                  style={{ background:"none", border:"none", fontFamily:F, fontSize:13, fontWeight:700, color:"#999", cursor:"pointer", padding:"6px" }}>
                  Rester ici
                </button>
              </div>
            </div>
          )}

          {/* Lot 4 — feuille de liaison au Catalogue */}
          {lienElement && (
            <MicroLienSheet
              element={lienElement}
              onClose={() => setLienElement(null)}
              onResolu={resoudreElement}
              onIntrouvable={marquerIntrouvable}
            />
          )}

          {/* Confirmation « Vider et recommencer » */}
          {confirmVider && (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }} onClick={() => setConfirmVider(false)}>
              <div onClick={ev => ev.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:320, width:"100%" }}>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:6 }}>Vider toute la liste ?</div>
                <div style={{ fontFamily:F, fontSize:13, color:"#888", marginBottom:16 }}>Les {elementsListe.length} éléments et les prises de cette session seront supprimés.</div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={viderTout} style={{ flex:1, padding:"12px", border:"none", borderRadius:10, background:"#CC0000", fontFamily:F, fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer" }}>
                    Vider
                  </button>
                  <button onClick={() => setConfirmVider(false)} style={{ padding:"12px 16px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:F, fontWeight:800, fontSize:14, color:"#333", cursor:"pointer" }}>
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Prises enregistrées — réécoute locale (le Lot 2 en fera la transcription) */}
          {prises.length > 0 && (
            <div>
              <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>
                Prises enregistrées ({prises.length})
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {prises.map((p, i) => (
                  <div key={p.id} style={{ background:C.white, border:`1px solid ${C.grayLight}`, borderRadius:12, padding:"10px 12px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ fontFamily:F, fontWeight:800, fontSize:13, color:C.text, flexShrink:0 }}>
                        Prise {i + 1} · {fmtDuree(p.duree)}
                      </div>
                      <audio controls src={p.url} preload="metadata" style={{ flex:1, minWidth:0, height:36 }} />
                      <button onClick={() => supprimerPrise(p.id)} aria-label={`Supprimer la prise ${i + 1}`}
                        style={{ border:"none", background:"none", cursor:"pointer", fontSize:18, flexShrink:0, padding:4 }}>
                        🗑️
                      </button>
                    </div>

                    {/* Lot 2 — résultat de la transcription de CETTE prise */}
                    {p.statut === "transcription" && (
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8 }}>
                        <div style={{ width:14, height:14, border:"3px solid #EFEFEF", borderTopColor:"#CC0000", borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }}/>
                        <span style={{ fontFamily:F, fontSize:12, fontWeight:700, color:C.textLight }}>Je transforme ta voix en liste…</span>
                      </div>
                    )}
                    {p.statut === "erreur" && (
                      <div style={{ marginTop:8, background:"#FEE", borderRadius:10, padding:"8px 10px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span style={{ fontFamily:F, fontSize:12, fontWeight:700, color:C.red }}>⚠️ {p.erreurMsg}</span>
                        <button onClick={() => lancerTranscription(p.id, p.blob, p.mime)}
                          style={{ background:"none", border:"none", color:"#CC0000", fontFamily:F, fontWeight:800, cursor:"pointer", fontSize:12, textDecoration:"underline", padding:0 }}>
                          Réessayer
                        </button>
                      </div>
                    )}
                    {p.statut === "ok" && p.resultat && (
                      <div style={{ marginTop:8 }}>
                        {p.resultat.transcription && (
                          <div style={{ fontFamily:F, fontSize:11, fontStyle:"italic", color:C.gray, marginBottom:6 }}>
                            « {p.resultat.transcription} »
                          </div>
                        )}
                        {/* Lot 3 — le détail des éléments vit dans « Ma liste »
                            ci-dessus ; ici, un simple bilan de la prise. */}
                        {p.resultat.elements.length === 0 ? (
                          <div style={{ fontFamily:F, fontSize:12, fontWeight:700, color:C.textLight }}>
                            Aucun produit reconnu dans cette prise.
                          </div>
                        ) : (
                          <div style={{ fontFamily:F, fontSize:12, fontWeight:800, color:C.green }}>
                            ✓ {p.resultat.elements.length} produit{p.resultat.elements.length > 1 ? "s" : ""} ajouté{p.resultat.elements.length > 1 ? "s" : ""} à ta liste
                          </div>
                        )}
                        {p.resultat.elements_ignores.length > 0 && p.resultat.elements_ignores.map((e, j) => (
                          <div key={`ig-${j}`} style={{ fontFamily:F, fontSize:11, color:C.gray, padding:"2px 0", textDecoration:"line-through" }}>
                            {e.texte_entendu}{e.raison ? ` — ${e.raison}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── CHANTIER « COURSES » — LOTS 1-2 (shadow estFrancois) ─────────────────────
// Écran de courses : session FIGÉE créée à la validation du comparatif
// (en-tête magasin + total prévu + progression, sections par rayon =
// CATÉGORIE dans l'ordre ordre_affichage de la base). Lot 2 — interactions :
// cocher → « Dans le caddie » (repliée par défaut), décocher → retour à sa
// place d'origine dans son rayon (l'ordre du tableau de la session est
// stable), bouton 🚫 → « Introuvables » (réversible ↩︎, la case restant
// cochable si l'article est finalement trouvé). Chaque action est persistée
// immédiatement en localStorage par la racine (onChangerEtat). Un rayon
// entièrement pris disparaît de « À prendre » (repli automatique). Carte
// d'accueil au Lot 3, clôture (« Terminer mes courses ») au Lot 6.
function LigneArticleCourses({ article, variante, onCocher, onIntrouvable, onRestaurer, onSupprimer }) {
  const F = "'Nunito',sans-serif";
  const prise = variante === 'au_caddie';
  const introuvable = variante === 'introuvable';
  const attenue = prise || introuvable;
  // Lot 5 — une note libre n'a ni prix ni marquage « introuvable » ; elle est
  // supprimable (✕) depuis sa section tant qu'elle n'est pas cochée.
  const estNote = article.type === 'note';
  // Lot 8 — refonte visuelle « note épurée » (direction A) : rangée blanche
  // séparée par un filet, rond à cocher fin façon Rappels, prix discret,
  // introuvable marqué par un simple liseré ambré. AUCUN changement de
  // logique : mêmes props, mêmes handlers, mêmes aria-labels, mêmes
  // fallbacks (icône de rayon, « prix inconnu ») qu'au Lot 7.
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, background:"transparent", padding:"7px 0 7px 2px", borderBottom:"1px solid #F2F2F2", borderLeft: introuvable ? `3px solid ${C.yellow}` : "3px solid transparent" }}>
      {/* Zone tactile 44×44, rond visuel 26 px */}
      <button onClick={onCocher}
        aria-label={prise ? `Retirer « ${article.nom_affiche} » du caddie` : `Mettre « ${article.nom_affiche} » dans le caddie`}
        style={{ width:44, height:44, flexShrink:0, background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>
        <span aria-hidden="true" style={{ width:26, height:26, borderRadius:99, border:`1.5px solid ${prise ? C.green : "#C7C7CC"}`, background: prise ? C.green : "#fff", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:900, boxSizing:"border-box" }}>
          {prise ? "✓" : ""}
        </span>
      </button>
      <div style={{ width:40, height:40, flexShrink:0, opacity: attenue ? 0.55 : 1 }}>
        <PhotoProduit varianteId={article.variante_produit_id} taille="thumb" radius={8}
          fallback={<div style={{ width:"100%", height:"100%", borderRadius:8, background:"#F5F5F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:19 }}>{emojiRayon(article.rayon)}</div>} />
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontFamily:F, fontWeight:700, fontSize:15, color: prise ? "#AEAEB2" : "#1a1a1a", textDecoration: prise ? "line-through" : "none", textDecorationColor:"#C7C7CC" }}>
          {article.nom_affiche}
          {article.est_mdd && (
            <span style={{ marginLeft:6, background:"#F2F2F2", color:"#8E8E93", borderRadius:5, padding:"1px 5px", fontSize:9, fontWeight:900, verticalAlign:"middle", whiteSpace:"nowrap" }}>Marque Distributeur</span>
          )}
        </div>
        {article.rayon?.sous_categorie_nom && (
          <div style={{ fontFamily:F, fontSize:11, color:"#8E8E93", marginTop:1 }}>{article.rayon.sous_categorie_nom}</div>
        )}
      </div>
      {!estNote && (
        <div style={{ textAlign:"right", flexShrink:0, opacity: attenue ? 0.55 : 1 }}>
          {article.prix_prevu != null ? (
            <div style={{ fontFamily:F, fontWeight:700, fontSize:13, color:"#6D6D72" }}>
              {article.quantite > 1 && <span style={{ fontSize:11, color:"#AEAEB2", marginRight:4 }}>×{article.quantite}</span>}
              {(article.prix_prevu * article.quantite).toFixed(2)} €
            </div>
          ) : (
            <div style={{ fontFamily:F, fontWeight:700, fontSize:11, fontStyle:"italic", color:"#B08A3E" }}>
              {article.quantite > 1 && <span style={{ marginRight:4 }}>×{article.quantite}</span>}
              prix inconnu
            </div>
          )}
        </div>
      )}
      {variante === 'a_prendre' && !estNote && (
        <button onClick={onIntrouvable} aria-label={`Marquer « ${article.nom_affiche} » introuvable`}
          style={{ width:36, height:44, flexShrink:0, background:"none", border:"none", cursor:"pointer", fontSize:14, padding:0, opacity:0.35 }}>🚫</button>
      )}
      {estNote && onSupprimer && (
        <button onClick={onSupprimer} aria-label={`Supprimer la note « ${article.nom_affiche} »`}
          style={{ width:36, height:44, flexShrink:0, background:"none", border:"none", cursor:"pointer", fontSize:15, color:"#AEAEB2", padding:0 }}>✕</button>
      )}
      {introuvable && (
        <button onClick={onRestaurer} aria-label={`Remettre « ${article.nom_affiche} » à prendre`}
          style={{ width:36, height:44, flexShrink:0, background:"none", border:"none", cursor:"pointer", fontSize:18, color:C.blue, fontWeight:900, padding:0 }}>↩︎</button>
      )}
    </div>
  );
}

function CoursesTab({ session, onChangerEtat, onAjouterNote, onSupprimerNote, onTerminer, onPasserEnCaisse, syncEchec = false }) {
  const F = "'Nunito',sans-serif";
  // « Dans le caddie » repliée par défaut — hooks déclarés AVANT le early
  // return (règle des Hooks : ordre stable entre rendus).
  const [caddieOuvert, setCaddieOuvert] = useState(false);
  // Lot 8 (ajustement) — rayons pliables de « À prendre » : map cléRayon ->
  // replié. Vide par défaut = tous dépliés ; état d'affichage en mémoire
  // seulement (perdu en quittant l'écran, non persisté — voulu). Chaque rayon
  // est indépendant. Même mécanisme de repli que « Dans le caddie ».
  const [rayonsReplies, setRayonsReplies] = useState({});
  // Lot 5 — saisie d'une note libre (null = champ fermé).
  const [texteNote, setTexteNote] = useState(null);
  // Lot 7 — annulation immédiate du dernier cochage ({cle, nom}, effacé après 4 s).
  const [derniereCoche, setDerniereCoche] = useState(null);
  useEffect(() => {
    if (!derniereCoche) return;
    const t = setTimeout(() => setDerniereCoche(null), 4000);
    return () => clearTimeout(t);
  }, [derniereCoche]);
  // Lot 7 — verrou d'écran pendant les courses (même pattern que le Micro,
  // Lot 6 du chantier Micro) : l'écran ne s'éteint pas en magasin. Optionnel
  // et silencieux (refus batterie faible, API absente...). iOS relâche le
  // verrou quand l'app passe en arrière-plan : on le redemande au retour.
  useEffect(() => {
    let verrou = null;
    const demander = async () => {
      try { verrou = await navigator.wakeLock?.request?.("screen") ?? null; }
      catch { verrou = null; /* refusé : non bloquant */ }
    };
    demander();
    const surVisibilite = () => { if (document.visibilityState === 'visible') demander(); };
    document.addEventListener('visibilitychange', surVisibilite);
    return () => {
      document.removeEventListener('visibilitychange', surVisibilite);
      try { verrou?.release?.(); } catch { /* déjà relâché */ }
    };
  }, []);
  if (!session) return null;
  const articles = session.articles || [];
  const prog = calculerProgression(articles);
  // Les notes libres ont leur propre section « Ajoutés en route » : elles ne
  // sont jamais mélangées aux rayons du magasin.
  const aPrendreRayons = articles.filter(a => a.etat === 'a_prendre' && a.type !== 'note');
  const groupes = grouperParRayon(aPrendreRayons);
  const notesAPrendre = articles.filter(a => a.etat === 'a_prendre' && a.type === 'note');
  const introuvables = articles.filter(a => a.etat === 'introuvable');
  const auCaddie = articles.filter(a => a.etat === 'au_caddie');
  const validerNote = () => {
    const texte = (texteNote || '').trim();
    if (texte) onAjouterNote?.(texte);
    setTexteNote(null);
  };
  const toutPris = prog.total > 0 && prog.restants === 0;
  const ratio = prog.total > 0 ? prog.pris / prog.total : 0;
  // Lot 8 (ajustement) — montant dynamique du panier (articles cochés).
  const panier = calculerTotalPanier(articles);
  // Lot 8 — le magasin n'est plus AFFICHÉ (il reste dans session.magasin,
  // nécessaire à la clôture et à la carte d'accueil) : plus de bandeau rouge.

  return (
    <div style={{ padding:"20px 20px 110px", background:"#fff", minHeight:"calc(100vh - 68px)", boxSizing:"border-box" }}>
      {/* Lot 8 (ajustement) — plus de lien « ‹ Accueil » ici : le retour passe
          par le bouton Accueil de la barre d'onglets du bas, toujours rendue. */}

      {/* Lot 8 — en-tête léger sur fond blanc : titre, compteur du caddie,
          barre de progression, et à droite le TOTAL DYNAMIQUE DU PANIER
          (somme des articles cochés, recalculée à chaque coche — « + ? »
          quand un article coché n'a pas de prix connu). */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:24, color:"#1a1a1a" }}>Mes courses</div>
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginTop:6 }}>
          <div aria-live="polite" style={{ fontFamily:F, fontWeight:800, fontSize:13, color:"#6D6D72" }}>
            {prog.pris} / {prog.total} au caddie
          </div>
          <div style={{ fontFamily:F, fontWeight:700, fontSize:12, color:"#8E8E93" }}>
            {panier.total.toFixed(2)} €{panier.incomplet ? " + ?" : ""} au panier
          </div>
        </div>
        <div style={{ marginTop:8, height:5, borderRadius:99, background:"#F0F0F0", overflow:"hidden" }}>
          <div style={{ width:`${Math.round(ratio*100)}%`, height:"100%", borderRadius:99, background:"#E5181B", transition:"width 0.3s ease" }} />
        </div>
      </div>

      {/* Lot 4 — indicateur d'échec du filet Supabase : discret, jamais
          silencieux. Rien n'est affiché quand tout va bien (cas normal). */}
      {syncEchec && (
        <div style={{ background:"#FFF8E6", border:`1px solid ${C.yellow}`, borderRadius:10, padding:"8px 12px", marginBottom:12, fontFamily:F, fontWeight:800, fontSize:12, color:"#7A6000" }}>
          ⚠️ Sauvegarde en ligne impossible pour l'instant — tes courses restent enregistrées sur ce téléphone.
        </div>
      )}

      {/* À PRENDRE — sections par rayon (catégorie), ordre de la base. Un
          rayon entièrement pris n'a plus d'article ici : il disparaît de
          lui-même (repli automatique). */}
      {groupes.length > 0 && (
        <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>
          À prendre ({aPrendreRayons.length})
        </div>
      )}
      {groupes.map(groupe => {
        const cleRayon = `${groupe.rayon.categorie_ordre}-${groupe.rayon.categorie_nom}`;
        const replie = !!rayonsReplies[cleRayon];
        return (
          <div key={cleRayon} style={{ marginBottom:16 }}>
            {/* Lot 8 (ajustement) — en-tête de rayon cliquable, même flèche et
                même mécanisme de repli que « Dans le caddie ». Le compteur
                reste visible replié ; la progression et le montant du panier
                ne dépendent pas de l'affichage (calculés sur les articles). */}
            <button onClick={()=>setRayonsReplies(prev => ({ ...prev, [cleRayon]: !prev[cleRayon] }))}
              aria-expanded={!replie}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:6, background:"none", border:"none", padding:"6px 2px", marginBottom:2, cursor:"pointer", textAlign:"left" }}>
              <span style={{ fontSize:13 }}>{emojiRayon(groupe.rayon)}</span>
              <span style={{ fontFamily:F, fontWeight:800, fontSize:11, color:"#8E8E93", letterSpacing:"0.07em", textTransform:"uppercase" }}>{groupe.rayon.categorie_nom} ({groupe.articles.length})</span>
              <span style={{ marginLeft:"auto", fontFamily:F, fontWeight:900, fontSize:13, color:"#AEAEB2" }}>{replie ? "▸" : "▾"}</span>
            </button>
            {!replie && (
              <div style={{ display:"flex", flexDirection:"column" }}>
                {groupe.articles.map(article => (
                  <LigneArticleCourses key={article.cle} article={article} variante="a_prendre"
                    onCocher={()=>{ onChangerEtat?.(article.cle, 'au_caddie'); setDerniereCoche({ cle: article.cle, nom: article.nom_affiche }); }}
                    onIntrouvable={()=>onChangerEtat?.(article.cle, 'introuvable')} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Tout est pris — état célébratoire, version épurée (Lot 8) */}
      {toutPris && (
        <div style={{ padding:"22px 0", textAlign:"center", marginBottom:10 }}>
          <div style={{ fontSize:32, marginBottom:4 }}>🎉</div>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:C.green }}>
            Tout est dans le caddie !
          </div>
        </div>
      )}
      {!toutPris && groupes.length === 0 && introuvables.length > 0 && (
        <div style={{ padding:"12px 0", textAlign:"center", marginBottom:10, fontFamily:F, fontWeight:700, fontSize:13, color:"#B08A3E" }}>
          Il ne reste que des articles introuvables 👇
        </div>
      )}

      {/* INTROUVABLES — visible seulement s'il y en a ; toujours dépliée
          (peu d'articles, et il faut les garder à l'œil). */}
      {introuvables.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:"#B08A3E", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:2 }}>
            🚫 Introuvables ({introuvables.length})
          </div>
          <div style={{ display:"flex", flexDirection:"column" }}>
            {introuvables.map(article => (
              <LigneArticleCourses key={article.cle} article={article} variante="introuvable"
                onCocher={()=>{ onChangerEtat?.(article.cle, 'au_caddie'); setDerniereCoche({ cle: article.cle, nom: article.nom_affiche }); }}
                onRestaurer={()=>onChangerEtat?.(article.cle, 'a_prendre')} />
            ))}
          </div>
        </div>
      )}

      {/* DANS LE CADDIE — repliée par défaut, en-tête cliquable (Lot 8 :
          simple rangée de texte discrète, plus de pastille verte) */}
      {auCaddie.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <button onClick={()=>setCaddieOuvert(o=>!o)}
            aria-expanded={caddieOuvert}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:6, background:"none", border:"none", borderTop:"1px solid #F2F2F2", padding:"12px 2px", cursor:"pointer" }}>
            <span style={{ fontFamily:F, fontWeight:800, fontSize:11, color:C.green, letterSpacing:"0.07em", textTransform:"uppercase" }}>✓ Dans le caddie ({auCaddie.length})</span>
            <span style={{ marginLeft:"auto", fontFamily:F, fontWeight:900, fontSize:13, color:"#AEAEB2" }}>{caddieOuvert ? "▾" : "▸"}</span>
          </button>
          {caddieOuvert && (
            <div style={{ display:"flex", flexDirection:"column" }}>
              {auCaddie.map(article => (
                <LigneArticleCourses key={article.cle} article={article} variante="au_caddie"
                  onCocher={()=>{ onChangerEtat?.(article.cle, 'a_prendre'); setDerniereCoche(null); }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lot 5 — AJOUTÉS EN ROUTE : notes libres tapées pendant les courses.
          Cochables comme le reste (elles filent alors dans « Dans le caddie »),
          supprimables (✕), comptées dans la progression. Aucune écriture Core. */}
      <div style={{ marginBottom:14 }}>
        {notesAPrendre.length > 0 && (
          <>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:"#8E8E93", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:2 }}>
              📝 Ajoutés en route ({notesAPrendre.length})
            </div>
            <div style={{ display:"flex", flexDirection:"column", marginBottom:6 }}>
              {notesAPrendre.map(article => (
                <LigneArticleCourses key={article.cle} article={article} variante="a_prendre"
                  onCocher={()=>{ onChangerEtat?.(article.cle, 'au_caddie'); setDerniereCoche({ cle: article.cle, nom: article.nom_affiche }); }}
                  onSupprimer={()=>onSupprimerNote?.(article.cle)} />
              ))}
            </div>
          </>
        )}
        {texteNote === null ? (
          <button onClick={()=>setTexteNote("")}
            style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"12px 2px", border:"none", background:"transparent", fontFamily:F, fontWeight:700, fontSize:14, color:"#8E8E93", cursor:"pointer", textAlign:"left" }}>
            <span style={{ fontSize:18, lineHeight:1, color:"#E5181B" }}>＋</span> Ajouter un article oublié
          </button>
        ) : (
          <div style={{ display:"flex", gap:8 }}>
            <input
              autoFocus
              value={texteNote}
              onChange={e=>setTexteNote(e.target.value)}
              onKeyDown={e=>{ if (e.key === 'Enter') validerNote(); if (e.key === 'Escape') setTexteNote(null); }}
              placeholder="Ex. : Sopalin"
              style={{ flex:1, minWidth:0, padding:"11px 14px", borderRadius:10, border:"1.5px solid #D1D1D6", fontFamily:F, fontSize:15, boxSizing:"border-box" }}
            />
            <button onClick={validerNote} aria-label="Ajouter la note"
              style={{ padding:"0 16px", border:"none", borderRadius:12, background:C.blue, fontFamily:F, fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer" }}>
              Ajouter
            </button>
            <button onClick={()=>setTexteNote(null)} aria-label="Annuler l'ajout"
              style={{ padding:"0 12px", border:`1.5px solid ${C.grayLight}`, borderRadius:12, background:"#fff", fontFamily:F, fontWeight:800, fontSize:14, color:C.gray, cursor:"pointer" }}>
              ✕
            </button>
          </div>
        )}
      </div>

      {prog.total === 0 && (
        <div style={{ background:C.orangeLight, borderRadius:14, padding:"24px 20px", textAlign:"center", border:`2px dashed ${C.orange}` }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🛒</div>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:C.orange }}>Aucun article dans cette session</div>
        </div>
      )}

      {/* Chantier 90 Lot 4 — « Je passe en caisse » : lance le parcours de
          scan de ticket EXISTANT depuis la session (confirmation du magasin
          gérée par la racine). N'affecte en rien la clôture ci-dessous. */}
      {prog.total > 0 && (
        <button onClick={()=>onPasserEnCaisse?.()}
          style={{ width:"100%", padding:"14px", marginTop:16, border:"2px solid #E5181B", borderRadius:14, background:"#fff", fontFamily:F, fontWeight:900, fontSize:15, color:"#E5181B", cursor:"pointer" }}>
          🧾 Je passe en caisse — scanner le ticket
        </button>
      )}

      {/* Lot 6 — clôture explicite, en fin de liste. Vert quand tout est pris,
          neutre sinon (la confirmation « il reste X articles » est gérée par
          la racine — jamais de clôture silencieuse). */}
      {prog.total > 0 && (
        <button onClick={()=>onTerminer?.()}
          style={{ width:"100%", padding:"15px", marginTop:10, border:"none", borderRadius:14, background: toutPris ? C.green : "#E5181B", fontFamily:F, fontWeight:900, fontSize:15, color:"#fff", cursor:"pointer", boxShadow: toutPris ? "0 4px 14px rgba(0,140,60,0.25)" : "0 4px 14px rgba(229,24,27,0.25)" }}>
          🏁 Terminer mes courses
        </button>
      )}

      {/* Lot 7 — annulation immédiate du dernier cochage (4 s), au-dessus de
          la TabBar. Le cochage reste de toute façon réversible depuis « Dans
          le caddie » ; ce raccourci évite d'ouvrir la section repliée. */}
      {derniereCoche && (
        <div role="status" style={{ position:"fixed", bottom:92, left:"50%", transform:"translateX(-50%)", width:"calc(100% - 48px)", maxWidth:380, background:"rgba(20,20,20,0.92)", borderRadius:12, padding:"10px 14px", display:"flex", alignItems:"center", gap:10, zIndex:60, boxShadow:"0 6px 20px rgba(0,0,0,0.35)" }}>
          <span style={{ fontFamily:F, fontWeight:700, fontSize:13, color:"#fff", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            ✓ {derniereCoche.nom}
          </span>
          <button onClick={()=>{ onChangerEtat?.(derniereCoche.cle, 'a_prendre'); setDerniereCoche(null); }}
            style={{ background:"none", border:"none", fontFamily:F, fontWeight:900, fontSize:13, color:"#FFD700", cursor:"pointer", padding:"4px 6px", flexShrink:0 }}>
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}

function HomeTab({ items, circles, profileMap, userId, setTab, onCircle, onFlash, onResumeScan, archives = [], pseudo, onStats, onMesPrix, onFavoris, onProfil = null, onFaq, onSignOut, pendingCagnotte, onConsumeCagnotteCelebration, pendingPotential, onConsumePotentialCelebration, estFrancois = false, sessionCourses = null, onReprendreCourses, onAbandonnerCourses }) {
  const F = "'Nunito',sans-serif";
  // Chantier 79 (ajustement) — scan en cours visible dès l'accueil. HomeTab
  // n'étant monté que sur l'onglet home, la lecture au montage reflète l'état
  // courant du brouillon (relu à chaque retour sur l'accueil).
  const [scanDraft, setScanDraft] = useState(() => lireScanDraft());
  const [confirmAbandonScan, setConfirmAbandonScan] = useState(false);
  // Chantier « Courses » Lot 3 (shadow estFrancois) — confirmation d'abandon
  // de la session de courses (même pattern que l'abandon de scan).
  const [confirmAbandonCourses, setConfirmAbandonCourses] = useState(false);
  const progCourses = sessionCourses ? calculerProgression(sessionCourses.articles) : null;
  const joursCourses = sessionCourses ? joursDepuis(sessionCourses.cree_le) : 0;
  const unchecked = items.filter(i => !i.checked).length;
  const members   = circles.filter(c => c.status === 'accepted');
  const avatarBg  = ["#E5181B","#F5C200","#00B341","#4A90D9","#8E44AD"];
  const scannedArchives = archives.filter(a => a.ticket_scanned && a.realized_saving != null);
  const cagnotteTotal   = scannedArchives.reduce((a, arc) => a + (arc.realized_saving || 0), 0);
  const potentialTotal  = archives.reduce((a, arc) => a + (arc.potential_saving || 0), 0);

  // #64.1 — célébration purement visuelle. La détection du CHANGEMENT vit
  // maintenant au niveau racine (pendingCagnotte/pendingPotential, props :
  // survit aux montages/démontages de HomeTab quand on change d'onglet).
  // HomeTab se contente de JOUER la célébration en attente si elle existe
  // (au montage, ou en direct si elle arrive pendant qu'il est déjà affiché),
  // puis prévient la racine pour qu'elle l'efface (jouée une seule fois).
  // N'observe/ne modifie aucun calcul d'économie.
  const [displayCagnotte, setDisplayCagnotte]   = useState(() => pendingCagnotte ? pendingCagnotte.from : cagnotteTotal);
  const [displayPotential, setDisplayPotential] = useState(() => pendingPotential ? pendingPotential.from : potentialTotal);
  const [hideRealCagnotte, setHideRealCagnotte] = useState(false);
  const cagnotteRealRef  = useRef(null);
  const estimeesRef      = useRef(null);
  const fxLayerRef       = useRef(null);
  const confettiBusyRef  = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mql) return;
    const onChange = () => setReducedMotion(mql.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  // "Confirmées" — roulement + pop géant (échappe à overflow:hidden via clone
  // fixed) + pluie de confettis plein écran. Se joue dès qu'une célébration
  // en attente existe (au montage si elle s'est accumulée pendant que
  // HomeTab n'était pas affiché, ou immédiatement si on est déjà dessus).
  useEffect(() => {
    if (!pendingCagnotte) return;
    const { from, to } = pendingCagnotte;
    if (from === to) { onConsumeCagnotteCelebration?.(); return; }
    if (reducedMotion) { setDisplayCagnotte(to); onConsumeCagnotteCelebration?.(); return; }

    const rect = cagnotteRealRef.current?.getBoundingClientRect();
    let popEl = null;
    if (rect && fxLayerRef.current) {
      const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
      setHideRealCagnotte(true);
      popEl = document.createElement("div");
      popEl.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;transform:translate(-50%,-50%) scale(1);font-family:'Nunito',sans-serif;font-weight:900;font-size:18px;color:#fff;white-space:nowrap;pointer-events:none;z-index:9998;text-shadow:0 2px 8px rgba(0,0,0,0.25);`;
      popEl.textContent = `${from>=0?"+":""}${from.toFixed(2)} €`;
      fxLayerRef.current.appendChild(popEl);
      popEl.animate([
        { transform:"translate(-50%,-50%) scale(1)",   offset:0    },
        { transform:"translate(-50%,-50%) scale(2.6)", offset:0.35 },
        { transform:"translate(-50%,-50%) scale(2.6)", offset:0.8  },
        { transform:"translate(-50%,-50%) scale(1)",   offset:1    },
      ], { duration:1300, easing:"cubic-bezier(.34,1.56,.64,1)" }).onfinish = () => {
        popEl.remove();
        setHideRealCagnotte(false);
      };
    }

    animateAmountRoll(from, to, 1300, v => {
      setDisplayCagnotte(v);
      if (popEl) popEl.textContent = `${v>=0?"+":""}${v.toFixed(2)} €`;
    });

    if (!confettiBusyRef.current) {
      confettiBusyRef.current = true;
      runConfettiRain(fxLayerRef.current, () => { confettiBusyRef.current = false; });
    }

    onConsumeCagnotteCelebration?.();
  }, [pendingCagnotte, reducedMotion]);

  // "Estimées" — roulement + pop léger uniquement, jamais de confettis.
  useEffect(() => {
    if (!pendingPotential) return;
    const { from, to } = pendingPotential;
    if (from === to) { onConsumePotentialCelebration?.(); return; }
    if (reducedMotion) { setDisplayPotential(to); onConsumePotentialCelebration?.(); return; }

    estimeesRef.current?.animate([
      { transform:"scale(1)",    offset:0    },
      { transform:"scale(1.25)", offset:0.35 },
      { transform:"scale(1.25)", offset:0.8  },
      { transform:"scale(1)",    offset:1    },
    ], { duration:1300, easing:"cubic-bezier(.34,1.56,.64,1)" });

    animateAmountRoll(from, to, 1300, v => setDisplayPotential(v));
    onConsumePotentialCelebration?.();
  }, [pendingPotential, reducedMotion]);

  const [showMenuProfil, setShowMenuProfil] = useState(false);
  const menuProfilRef = useRef(null);
  useEffect(() => {
    if (!showMenuProfil) return;
    const handler = e => { if (menuProfilRef.current && !menuProfilRef.current.contains(e.target)) setShowMenuProfil(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenuProfil]);

  const NavBtn = ({ label, icon, target, style = {} }) => (
    <button onClick={() => setTab(target)} style={{
      background: "#fff",
      border: "none",
      borderRadius: 16,
      padding: "11px 18px",
      fontFamily: F, fontWeight: 900, fontSize: 14, color: "#111",
      cursor: "pointer",
      boxShadow: "0 4px 20px rgba(0,0,0,0.13)",
      display: "flex", alignItems: "center", gap: 7,
      whiteSpace: "nowrap",
      ...style,
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      {label}
    </button>
  );

  return (
    <div style={{
      background: "linear-gradient(160deg, #F5C200 60%, #FFDA44 100%)",
      minHeight: "calc(100vh - 68px)",
      position: "relative",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>

      {/* Illustration de fond (fournie par l'utilisateur → /illustration-home.png) */}
      <div style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", overflow:"hidden", zIndex:1, pointerEvents:"none" }}>
        <img
          src="/illustration-home.png" alt=""
          style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"center -64px", pointerEvents:"none" }}
          onError={e => { e.target.parentElement.style.display = "none"; }}
        />
      </div>

      {/* ── Barre du haut ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 20px 0", position:"relative", zIndex:20 }}>

        {/* Bouton Moi — haut gauche avec dropdown */}
        <div ref={menuProfilRef} style={{ position:"relative" }}>
          <div onClick={() => setShowMenuProfil(s => !s)} style={{ background:"#E5181B", borderRadius:99, width:54, height:54, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:F, fontWeight:900, fontSize:13, color:"#fff", boxShadow:"0 3px 12px rgba(229,24,27,0.45)", cursor:"pointer" }}>
            {pseudo ? pseudo.substring(0, 6) : "Moi"}
          </div>
          {showMenuProfil && (
            <div style={{ position:"absolute", top:60, left:0, width:220, background:"#fff", borderRadius:14, boxShadow:"0 6px 24px rgba(0,0,0,0.16)", zIndex:20, overflow:"hidden" }}>
              {[
                // Chantier 94 — profil Points Malin, seulement quand le flag
                // gamification_visible l'autorise (onProfil absent sinon).
                ...(onProfil ? [{ emoji:"🏅", label:"Mon profil", action: () => { setShowMenuProfil(false); onProfil(); } }] : []),
                { img:"/menu-cercle.png",     label:"Mon Cercle",          action: () => { setShowMenuProfil(false); onCircle(); } },
                { img:"/menu-stats.png",       label:"Mes Statistiques",    action: () => { setShowMenuProfil(false); onStats?.(); } },
                { img:"/menu-prix.png",        label:"Mes Prix",            action: () => { setShowMenuProfil(false); onMesPrix?.(); } },
                // Chantier 92 — favoris Core (par format), entrée à emoji
                // (pas d'image dédiée dans /public).
                { emoji:"❤️",                  label:"Mes Favoris",         action: () => { setShowMenuProfil(false); onFavoris?.(); } },
                { img:"/menu-faq.png",         label:"Nous contacter",      action: () => { setShowMenuProfil(false); onFaq?.(); } },
              ].map(({ img, emoji, label, action }) => (
                <div key={label} onClick={action} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", cursor:"pointer", borderBottom:"1px solid #F0F0F0" }}
                  onMouseEnter={e => e.currentTarget.style.background="#F9F9F9"}
                  onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  {img
                    ? <img src={img} alt="" width={32} height={32} style={{ borderRadius:6, flexShrink:0 }} />
                    : <span style={{ width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{emoji}</span>}
                  <span style={{ fontFamily:F, fontWeight:700, fontSize:14, color:"#111" }}>{label}</span>
                </div>
              ))}
              <div style={{ borderTop:"2px solid #EBEBEB" }}/>
              <div onClick={() => { setShowMenuProfil(false); onSignOut?.(); }} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", cursor:"pointer" }}
                onMouseEnter={e => e.currentTarget.style.background="#FEE2E2"}
                onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                <img src="/menu-deconnexion.png" alt="" width={32} height={32} style={{ borderRadius:6, flexShrink:0 }} />
                <span style={{ fontFamily:F, fontWeight:700, fontSize:14, color:"#CC0000" }}>Se Déconnecter</span>
              </div>
              {/* #66 — version SemVer, source unique package.json via __APP_VERSION__ (vite.config.js), jamais en dur ici */}
              <div style={{ textAlign:"center", padding:"8px 0 10px" }}>
                <span style={{ fontFamily:F, fontSize:10, color:C.gray }}>PrixMalin v{__APP_VERSION__}</span>
              </div>
            </div>
          )}
        </div>

        {/* Logo PrixMalin — centre */}
        <img src="/prixmalin-logo.png" alt="PrixMalin" style={{ height:64, width:"auto", filter:"drop-shadow(0 3px 10px rgba(0,0,0,0.35))" }} />

        {/* Bouton caddie Ma liste — haut droite */}
        <div onClick={() => setTab("list")} style={{ position:"relative", background:"#E5181B", borderRadius:99, width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, boxShadow:"0 3px 12px rgba(229,24,27,0.45)", cursor:"pointer" }}>
          🛒
          {unchecked > 0 && (
            <span style={{ position:"absolute", top:-4, right:-4, background:"#E5181B", border:"2px solid #fff", color:"#fff", borderRadius:99, minWidth:18, height:18, fontSize:10, fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px", boxSizing:"border-box" }}>
              {unchecked}
            </span>
          )}
        </div>
      </div>

      <div style={{margin:'10px 40px', padding:'8px 16px', background:'rgba(0,140,60,0.58)', borderRadius:12, display:'flex', justifyContent:'space-around', alignItems:'center', position:'relative', zIndex:10}}>
        <div style={{display:'flex', alignItems:'center', gap:6}}>
          <span style={{fontSize:'14px', color:'rgba(255,255,255,0.85)'}}>💰 Estimées</span>
          <span ref={estimeesRef} style={{fontSize:'18px', fontWeight:'bold', color:'white', display:'inline-block'}}>{displayPotential >= 0 ? "+" : ""}{displayPotential.toFixed(2)} €</span>
        </div>
        <div style={{width:1, height:20, background:'rgba(255,255,255,0.3)'}}/>
        <div style={{display:'flex', alignItems:'center', gap:6}}>
          <span style={{fontSize:'14px', color:'rgba(255,255,255,0.85)'}}>✅ Confirmées</span>
          <span ref={cagnotteRealRef} style={{fontSize:'18px', fontWeight:'bold', color:'white', display:'inline-block', opacity: hideRealCagnotte ? 0 : 1}}>{displayCagnotte >= 0 ? "+" : ""}{displayCagnotte.toFixed(2)} €</span>
        </div>
      </div>

      {/* Chantier 79 (ajustement) — carte "scan en cours" visible dès l'accueil */}
      {scanDraft && (
        <div style={{ margin:'12px 20px 0', padding:'12px 14px', background:'#FFF8E6', border:'1.5px solid #F5C200', borderRadius:14, position:'relative', zIndex:10, boxShadow:'0 3px 12px rgba(0,0,0,0.12)' }}>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:13, color:'#7A6000' }}>
            🧾 Scan de ticket en cours
          </div>
          <div style={{ fontFamily:F, fontSize:12, color:'#7A6000', marginTop:2 }}>
            étape : {etapeLisibleScan(scanDraft.status)}{scanDraft.createdAt ? ` · commencé le ${formatDateBrouillon(scanDraft.createdAt)}` : ''}
          </div>
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            <button onClick={() => onResumeScan?.()} style={{ flex:1, padding:'10px', border:'none', borderRadius:10, background:'#E5181B', fontFamily:F, fontWeight:900, fontSize:13, color:'#fff', cursor:'pointer' }}>
              Reprendre
            </button>
            <button onClick={() => setConfirmAbandonScan(true)} style={{ padding:'10px 14px', border:'1.5px solid rgba(122,96,0,0.35)', borderRadius:10, background:'transparent', fontFamily:F, fontWeight:800, fontSize:13, color:'#7A6000', cursor:'pointer' }}>
              Abandonner
            </button>
          </div>
        </div>
      )}

      {/* Chantier « Courses » Lot 3 (shadow estFrancois) — carte de reprise :
          visible uniquement quand une session est active, entièrement
          cliquable (Reprendre), progression réelle mise à jour à chaque
          cochage, bandeau d'ancienneté au-delà de 2 jours. Ne disparaît que
          sur abandon explicite (ou clôture, Lot 6) — jamais d'expiration
          automatique. Distincte du bouton caddie 🛒 en haut à droite (qui
          ouvre « Ma liste » pour PRÉPARER un comparatif). */}
      {sessionCourses && (
        <div onClick={() => onReprendreCourses?.()}
          style={{ margin:'12px 20px 0', padding:'12px 14px', background:'#fff', border:'2px solid #E5181B', borderRadius:14, position:'relative', zIndex:10, boxShadow:'0 3px 12px rgba(0,0,0,0.12)', cursor:'pointer' }}>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:13, color:'#1a1a1a' }}>
            🛒 Courses en cours chez {sessionCourses.magasin?.nom}
          </div>
          <div style={{ fontFamily:F, fontSize:12, color:'#666', marginTop:2 }}>
            {progCourses.pris} article{progCourses.pris > 1 ? 's' : ''} sur {progCourses.total} dans le caddie
            {progCourses.introuvables > 0 ? ` · ${progCourses.introuvables} introuvable${progCourses.introuvables > 1 ? 's' : ''}` : ''}
          </div>
          <div style={{ marginTop:6, height:6, borderRadius:99, background:'#F0F0F0', overflow:'hidden' }}>
            <div style={{ width:`${progCourses.total > 0 ? Math.round(progCourses.pris / progCourses.total * 100) : 0}%`, height:'100%', borderRadius:99, background:'#E5181B' }} />
          </div>
          {joursCourses >= 2 && (
            <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:'#7A6000', background:'#FFF8E6', border:`1px solid ${C.yellow}`, borderRadius:8, padding:'4px 8px', marginTop:8, display:'inline-block' }}>
              ⚠️ commencées il y a {joursCourses} jours
            </div>
          )}
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            <button onClick={(e) => { e.stopPropagation(); onReprendreCourses?.(); }}
              style={{ flex:1, padding:'10px', border:'none', borderRadius:10, background:'#E5181B', fontFamily:F, fontWeight:900, fontSize:13, color:'#fff', cursor:'pointer' }}>
              Reprendre
            </button>
            <button onClick={(e) => { e.stopPropagation(); setConfirmAbandonCourses(true); }}
              style={{ padding:'10px 14px', border:'1.5px solid rgba(204,0,0,0.3)', borderRadius:10, background:'transparent', fontFamily:F, fontWeight:800, fontSize:13, color:'#CC0000', cursor:'pointer' }}>
              Abandonner
            </button>
          </div>
        </div>
      )}

      {/* Confirmation d'abandon des courses en cours */}
      {confirmAbandonCourses && sessionCourses && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:24 }} onClick={() => setConfirmAbandonCourses(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:16, padding:'20px', maxWidth:320, width:'100%' }}>
            <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:'#1a1a1a', marginBottom:6 }}>Abandonner ces courses en cours ?</div>
            <div style={{ fontFamily:F, fontSize:13, color:'#888', marginBottom:16 }}>
              La progression ({progCourses.pris} sur {progCourses.total}) sera perdue. Ton caddie « Ma liste » n'est pas touché.
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => { onAbandonnerCourses?.(); setConfirmAbandonCourses(false); }} style={{ flex:1, padding:'12px', border:'none', borderRadius:10, background:'#CC0000', fontFamily:F, fontWeight:900, fontSize:14, color:'#fff', cursor:'pointer' }}>
                Abandonner
              </button>
              <button onClick={() => setConfirmAbandonCourses(false)} style={{ padding:'12px 16px', border:'1.5px solid #eee', borderRadius:10, background:'#fff', fontFamily:F, fontWeight:800, fontSize:14, color:'#333', cursor:'pointer' }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation d'abandon du scan en cours */}
      {confirmAbandonScan && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:24 }} onClick={() => setConfirmAbandonScan(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:16, padding:'20px', maxWidth:320, width:'100%' }}>
            <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:'#1a1a1a', marginBottom:6 }}>Abandonner ce scan en cours ?</div>
            <div style={{ fontFamily:F, fontSize:13, color:'#888', marginBottom:16 }}>Le ticket scanné et les modifications seront perdus.</div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => { effacerScanDraft(); setScanDraft(null); setConfirmAbandonScan(false); }} style={{ flex:1, padding:'12px', border:'none', borderRadius:10, background:'#CC0000', fontFamily:F, fontWeight:900, fontSize:14, color:'#fff', cursor:'pointer' }}>
                Abandonner
              </button>
              <button onClick={() => setConfirmAbandonScan(false)} style={{ padding:'12px 16px', border:'1.5px solid #eee', borderRadius:10, background:'#fff', fontFamily:F, fontWeight:800, fontSize:14, color:'#333', cursor:'pointer' }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* #64.1 — calque plein écran pour le pop géant (clone échappant à
          l'overflow:hidden du conteneur racine) et la pluie de confettis */}
      <div ref={fxLayerRef} style={{position:'fixed', inset:0, pointerEvents:'none', zIndex:9999, overflow:'visible'}} />

      {/* ── Navigation circulaire ── */}
      <div style={{ flex:1, display:"flex", alignItems:"flex-start", justifyContent:"center", position:"relative", zIndex:10, paddingTop:8 }}>
        <div style={{ position:"relative", width:300, height:290 }}>

          {/* Catalogue — bas centre. Chantier « Micro » Lot 1 (shadow) : la
              pastille Micro n'est rendue QUE pour François ; pour tout autre
              utilisateur le rangée flex ne contient que Catalogue, centré
              exactement comme avant. */}
          <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)", display:"flex", gap:10 }}>
            <NavBtn label="Catalogue" icon="🛍️" target="catalog" />
            {estFrancois && <NavBtn label="Micro" icon="🎤" target="micro" />}
          </div>

          {/* Bouton Flasher — centre */}
          <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%, -46%)", display:"flex", flexDirection:"column", alignItems:"center" }}>
            <button onClick={() => onFlash()} style={{
              width:125, height:125,
              borderRadius:"50%",
              background:"#E5181B",
              border:"5px solid #fff",
              cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4,
              boxShadow:"0 8px 36px rgba(229,24,27,0.55), 0 0 0 10px rgba(229,24,27,0.12)",
              transition:"transform 0.15s ease",
            }}
              onMouseDown={e => e.currentTarget.style.transform = "scale(0.94)"}
              onMouseUp={e   => e.currentTarget.style.transform = "scale(1)"}
              onTouchStart={e => e.currentTarget.style.transform = "scale(0.94)"}
              onTouchEnd={e   => e.currentTarget.style.transform = "scale(1)"}
            >
              <span style={{ fontSize:28 }}>📷</span>
              <span style={{ fontFamily:F, fontWeight:900, fontSize:16, color:"#fff", letterSpacing:"0.01em" }}>Flasher</span>
              <span style={{ fontFamily:F, fontWeight:500, fontSize:11, color:"rgba(255,255,255,0.85)", letterSpacing:"0.01em" }}>ticket de caisse</span>
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}

function StoreRatingScreen({ store, onSave, onSkip }) {
  const [rating, setRating] = useState(0);
  const [hover,  setHover]  = useState(0);
  const F = "'Nunito',sans-serif";
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, animation:"fadeIn 0.2s ease" }}>
      <div style={{ background:C.white, borderRadius:20, padding:"32px 28px", textAlign:"center", maxWidth:320, width:"90%", animation:"popIn 0.35s ease", boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:18, color:C.blue, marginBottom:6 }}>{store.logo} {store.name}</div>
        <div style={{ fontFamily:F, fontSize:14, color:C.text, marginBottom:20 }}>Comment était ce magasin ?</div>
        <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:24 }}>
          {[1,2,3,4,5].map(n=>(
            <button key={n} onClick={()=>setRating(n)} onMouseEnter={()=>setHover(n)} onMouseLeave={()=>setHover(0)}
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:52, lineHeight:1, padding:0, color:(hover||rating)>=n?"#F5C200":"#D0D0D0", transition:"color 0.1s" }}>★</button>
          ))}
        </div>
        <button onClick={()=>onSave(rating)} disabled={rating===0}
          style={{ width:"100%", padding:"13px", border:"none", borderRadius:12, background:rating>0?C.blue:"#ccc", fontFamily:F, fontWeight:900, fontSize:15, color:C.white, cursor:rating>0?"pointer":"default", marginBottom:10 }}>
          Enregistrer
        </button>
        <button onClick={onSkip} style={{ background:"none", border:"none", fontFamily:F, fontSize:14, fontWeight:700, color:C.textLight, cursor:"pointer", padding:"8px" }}>
          Passer
        </button>
      </div>
    </div>
  );
}

// ── CGU RATTRAPAGE ────────────────────────────────────────────────────────────
const CGU_ITEMS = [
  "PrixMalin est un projet personnel en phase de test, pas une entreprise. L'app peut évoluer, et son fonctionnement n'est pas garanti à 100%.",
  "Tes prix scannés alimentent la comparaison de prix pour tous les utilisateurs, mais toujours de façon anonyme — personne ne sait que c'est toi. Ton pseudo n'est visible que si tu choisis de partager un achat avec ton cercle de proches, article par article.",
  "Ton email n'est jamais visible par les autres utilisateurs. Pour t'identifier auprès de tes proches, seul ton pseudo (unique sur l'app) est utilisé.",
  "Si tu rejoins un cercle, les prix que tu partages restent visibles aux membres de ce cercle même si tu le quittes plus tard, sauf demande contraire de ta part.",
  "Les prix affichés (les tiens ou ceux partagés par ta communauté) sont fournis à titre indicatif. PrixMalin ne garantit pas qu'ils correspondent exactement au prix réel en magasin.",
  "Le créateur de l'app peut suspendre un compte en cas d'usage abusif ou de mauvaise foi (informations volontairement fausses, etc.).",
  "Tu peux demander la suppression de ton compte et de tes données à tout moment via le formulaire de contact de l'app.",
  "Ces règles peuvent évoluer ; tu seras informé des changements importants.",
];

function CguRattrapageScreen({ onAccept }) {
  const F = "'Nunito',sans-serif";
  const [accepted, setAccepted] = useState(false);
  const [saving,   setSaving]   = useState(false);
  return (
    <div style={{ minHeight:"100vh", background:C.bg, maxWidth:430, margin:"0 auto", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", padding:"32px 24px", overflowY:"auto" }}>
      <div style={{ fontSize:60, marginBottom:6 }}>🛒</div>
      <div style={{ fontFamily:F, fontWeight:900, fontSize:28, color:C.red, marginBottom:4 }}>PrixMalin</div>
      <div style={{ fontFamily:F, fontSize:13, color:C.textLight, marginBottom:24 }}>Comparez. Économisez.</div>
      <div style={{ background:C.white, borderRadius:20, padding:"24px 20px", width:"100%", boxShadow:"0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:18, color:C.text, marginBottom:6 }}>Avant de continuer…</div>
        <div style={{ fontFamily:F, fontSize:13, color:C.textLight, marginBottom:16, lineHeight:1.5 }}>
          L'app a évolué depuis ta dernière connexion. Merci de lire et accepter les conditions ci-dessous.
        </div>
        <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Conditions générales d'utilisation</div>
        <div style={{ background:C.bg, borderRadius:12, padding:"14px 16px", maxHeight:260, overflowY:"auto", marginBottom:16, border:`1px solid ${C.grayLight}` }}>
          <div style={{ fontFamily:F, fontWeight:800, fontSize:12, color:C.text, marginBottom:10 }}>📋 EN BREF</div>
          {CGU_ITEMS.map((item, i) => (
            <div key={i} style={{ display:"flex", gap:8, marginBottom:8, fontFamily:F, fontSize:12, color:C.textLight, lineHeight:1.6 }}>
              <span style={{ flexShrink:0, color:C.red, fontWeight:900 }}>·</span>
              <span>{item}</span>
            </div>
          ))}
          <div style={{ marginTop:10, fontFamily:F, fontSize:12, color:C.text, fontWeight:700, fontStyle:"italic", lineHeight:1.5 }}>
            En cochant la case ci-dessous, tu confirmes avoir lu et accepté les Conditions Générales d'Utilisation complètes de PrixMalin.
          </div>
        </div>
        <div onClick={()=>setAccepted(v=>!v)}
          style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:20, cursor:"pointer" }}>
          <div style={{ width:22, height:22, borderRadius:6, border:`2px solid ${accepted?C.green:C.gray}`, background:accepted?C.green:"#fff", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", marginTop:1 }}>
            {accepted && <span style={{ color:"#fff", fontSize:14, fontWeight:900, lineHeight:1 }}>✓</span>}
          </div>
          <div style={{ fontFamily:F, fontSize:13, color:C.text, fontWeight:700, lineHeight:1.5 }}>
            J'ai lu et j'accepte les Conditions Générales d'Utilisation
          </div>
        </div>
        <button onClick={async()=>{ setSaving(true); await onAccept(); setSaving(false); }}
          disabled={!accepted||saving}
          style={{ width:"100%", padding:"14px", border:"none", borderRadius:12, background:accepted&&!saving?C.red:C.grayLight, fontFamily:F, fontWeight:900, fontSize:15, color:accepted&&!saving?C.white:C.gray, cursor:accepted&&!saving?"pointer":"default" }}>
          {saving ? "…" : "Continuer →"}
        </button>
      </div>
    </div>
  );
}

// Chantier 84 — filet de sécurité contre une erreur de rendu d'un onglet
// (ex. donnée inattendue au passage MDD) : au lieu d'une page blanche qui fait
// « disparaître » toute l'app (et paniquer sur une perte de liste), on isole le
// crash à l'onglet, on garde l'état de l'app (items/liste préservés, jamais
// vidés par un plantage d'affichage), et on propose de réessayer. En DEV, le
// message d'erreur est affiché pour diagnostic.
class TabErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { erreur: null }; }
  static getDerivedStateFromError(erreur) { return { erreur }; }
  componentDidCatch(erreur, info) { console.error("[TabErrorBoundary] plantage de rendu d'un onglet :", erreur, info); }
  render() {
    if (this.state.erreur) {
      const F = "'Nunito',sans-serif";
      return (
        <div style={{ padding:"40px 24px 100px", textAlign:"center", fontFamily:F }}>
          <div style={{ fontSize:44, marginBottom:12 }}>😵</div>
          <div style={{ fontWeight:900, fontSize:16, color:"#CC0000", marginBottom:8 }}>Cet écran a rencontré un problème</div>
          <div style={{ fontSize:13, color:"#666", lineHeight:1.6, marginBottom:18 }}>
            Ta liste de courses est intacte. Réessaie ou change d'onglet.
          </div>
          {import.meta.env.DEV && (
            <pre style={{ textAlign:"left", background:"#FEE", border:"1px solid #F5C6C6", borderRadius:10, padding:"10px 12px", fontSize:11, color:"#900", overflowX:"auto", marginBottom:16 }}>
              {String(this.state.erreur?.stack || this.state.erreur?.message || this.state.erreur)}
            </pre>
          )}
          <button onClick={()=>this.setState({ erreur: null })}
            style={{ padding:"12px 22px", border:"none", borderRadius:12, background:"#CC0000", color:"#fff", fontFamily:F, fontWeight:800, fontSize:14, cursor:"pointer" }}>
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [session,   setSession]   = useState(null);
  const [authReady, setAuthReady] = useState(false);
  // #56.3b — statut admin, dérivé de la session (jamais true par défaut ni
  // par accident : false pendant le chargement, false sans session, false
  // sur toute erreur RPC).
  const [isAdmin, setIsAdmin] = useState(false);
  // Chantier "Scan code-barres", bout 1 — shadow strict sur le compte de
  // François uniquement (pas isAdmin en général : critère volontairement
  // plus étroit qu'un rôle admin générique, pour rester invisible même si
  // d'autres comptes admin existent un jour). Dérivé de la session à chaque
  // rendu, jamais mis en cache localement.
  const estFrancois = session?.user?.email === 'francois.pimor@gmail.com';
  // #56.6 — modeCoreActif devient tri-état : null = suivre coreActifGlobal
  // (comportement par défaut, pour tout le monde) ; true/false = override
  // explicite de l'admin pour comparer ponctuellement l'autre moteur. Jamais
  // persisté (aucun localStorage, aucun paramètre URL) : repasse à null à
  // chaque rechargement de page.
  const [modeCoreActif, setModeCoreActif] = useState(null);

  // #56.6 — kill switch global (parametres_globaux.core_actif via la RPC
  // core_est_actif()). Legacy par défaut, et sur toute erreur/absence : ne
  // devient jamais Core par accident. Relu au changement de session et au
  // retour au premier plan (visibilitychange) — pas de polling permanent, pas
  // de localStorage : un onglet resté ouvert en arrière-plan ne verra le
  // changement qu'à son retour au premier plan ou au rechargement.
  const [coreActifGlobal, setCoreActifGlobal] = useState(false);

  // Chantier 87 Lot 1 — feature-flag « session_courses_ouverte »
  // (parametres_globaux), même principe de lecture défensive que le kill
  // switch core_actif ci-dessus : false par défaut, et sur toute erreur
  // (clé absente, table indisponible, réseau) on retombe sur false — seul
  // François garde alors l'accès à la session de courses.
  const [sessionCoursesOuverte, setSessionCoursesOuverte] = useState(false);
  // Chantier 87 Lot 1 — accès au parcours session de courses : flag global à
  // true OU François (qui garde toujours accès, même flag à false). Ne touche
  // à AUCUN autre gating estFrancois (Micro, admin…).
  const sessionCoursesAccessible = sessionCoursesOuverte || estFrancois;
  // Chantier 94 Lot 10 — flag gamification_visible (même principe) : le
  // profil Points Malin n'est visible que si le flag est à true OU pour
  // François. Absent/illisible => masqué (sauf François), jamais de plantage.
  const [gamificationVisible, setGamificationVisible] = useState(false);
  const profilVisible = gamificationVisible || estFrancois;

  // #65 — bandeau de mise à jour. needRefresh vient de registerSW (main.jsx,
  // hors arbre React) via le pont swUpdate.js ; jamais mis à jour tout seul.
  const [needRefresh, setNeedRefresh] = useState(false);
  useEffect(() => onNeedRefresh(() => setNeedRefresh(true)), []);

  const [tab, setTab]           = useState("home");
  const [items, setItems]       = useState([]);
  // Chantier « Courses » Lot 1 (shadow estFrancois) — session de courses figée,
  // réhydratée depuis localStorage à l'init (survit au rechargement). Rendue
  // uniquement pour François via tab==="courses" (aucun onglet TabBar ajouté).
  const [sessionCourses, setSessionCourses] = useState(() => lireSessionCourses());
  // Lot 3 — validation demandée alors qu'une session est déjà active :
  // mémorise la validation en attente ({store, potentialSaving, extrasCourses})
  // le temps que François choisisse « reprendre » ou « remplacer ».
  const [confirmCoursesExistantes, setConfirmCoursesExistantes] = useState(null);
  // Lot 6 — étape de clôture en cours : null (rien), 'confirmation' (il reste
  // des articles à prendre, jamais de clôture silencieuse), 'choixCaddie'
  // (récap + sort du caddie).
  const [clotureCourses, setClotureCourses] = useState(null);
  // Chantier 88 Lot 2 — dialogue « À acheter plus tard » à la clôture :
  // null (rien) ou { actionCaddie, articles, mode: 'simple' | 'choisir',
  // selection: { [cle]: bool } } pour les articles prévus mais non achetés
  // que le vidage choisi s'apprête à supprimer. Posé APRÈS le choix du sort
  // du caddie, AVANT toute clôture effective (Annuler ramène au choix).
  const [plusTardCourses, setPlusTardCourses] = useState(null);
  // Chantier 89 Lot 3 — bilan de fin de courses : null (rien) ou le snapshot
  // figé à la clôture ({ total_estime, nb_achetes, … }). Affiché en dernière
  // étape à la place de l'ancien toast, par-dessus l'accueil — la session est
  // déjà close quand il apparaît, le fermer ne détruit rien.
  const [bilanCourses, setBilanCourses] = useState(null);
  // Chantier 90 Lot 4 — « Je passe en caisse » : caisseCourses affiche la
  // confirmation du magasin ; scanCaisse mémorise le scan en attente de
  // rattachement ({ sessionId, magasin }) — magasin null = « changer de
  // magasin » (résolution existante dans le sheet). Doublé d'une ref pour que
  // le rattachement asynchrone lise toujours la valeur du moment, jamais une
  // fermeture périmée.
  const [caisseCourses, setCaisseCourses] = useState(false);
  const [scanCaisse, setScanCaisse] = useState(null);
  const scanCaisseRef = useRef(null);
  const definirScanCaisse = (v) => { scanCaisseRef.current = v; setScanCaisse(v); };
  // Chantier 91 Lot 5 — résultat du rapprochement ticket <-> session :
  // null (rien), { sansLignes: true } (ticket sans ligne exploitable — message
  // seulement, RIEN n'est classé) ou { compteurs, totalReel } (récap).
  // verifCourses : file des cles d'articles 'a_verifier' à trancher un par un
  // dans le mini-dialogue, une fois le récap fermé.
  const [rapprochementCourses, setRapprochementCourses] = useState(null);
  const [verifCourses, setVerifCourses] = useState([]);
  // Chantier 95 Lot 11 — sollicitation « relève le prix » : carte discrète
  // après un cochage (null ou { cle, nom }), saisie de prix ouverte (null ou
  // { cle, article, origine: 'carte' | 'file' }), et visibilité de la file
  // « À compléter ». Tout est non bloquant ; l'anti-répétition et la file
  // vivent dans le doc de session (sollicitations_prix, additif).
  const [sollicitationPrix, setSollicitationPrix] = useState(null);
  const [sollicitationSaisie, setSollicitationSaisie] = useState(null);
  const [fileACompleterVisible, setFileACompleterVisible] = useState(false);
  // Chantier 88 Lot 2 — lignes liste_courses de statut 'reporte', tenues à
  // l'écart de `items` (liste active, comparateur, session) : elles ne
  // comptent jamais comme achetées et ne polluent pas la liste active.
  const [itemsReportes, setItemsReportes] = useState([]);
  // Lot 3 — session réellement exploitable : active ET appartenant à
  // l'utilisateur connecté (le localStorage est partagé par appareil — une
  // session d'un autre compte ne doit ni s'afficher ni être reprise).
  const sessionCoursesActive = (sessionCourses?.statut === 'active'
    && sessionCourses?.utilisateur_id === session?.user?.id) ? sessionCourses : null;
  // Lot 4 — état du filet Supabase : null = rien à dire, 'echec' = la dernière
  // sauvegarde base a échoué (indicateur discret sur l'écran de courses —
  // jamais silencieux, jamais bloquant : le localStorage reste la source
  // immédiate).
  const [syncCoursesEchec, setSyncCoursesEchec] = useState(false);
  // Lot 4 — restauration base exécutée une seule fois par connexion.
  const restaurationCoursesFaite = useRef(false);

  // Lot 4 — sauvegarde Supabase débouncée (~2 s) après chaque changement de
  // session (création, coche, décoche, introuvable). L'écriture localStorage,
  // elle, reste immédiate (changerEtatArticleSession). Une session d'avant le
  // Lot 4 (sans id) reçoit son id ici, une seule fois, puis l'effet relancé
  // par le re-rendu fait l'upsert.
  useEffect(() => {
    if (!sessionCoursesActive) return;
    const t = setTimeout(async () => {
      if (!sessionCoursesActive.id) {
        // genererIdSession (jamais crypto.randomUUID nu) + try : l'attribution
        // d'id ne doit jamais produire de rejet non géré (incident 2026-08-11).
        try {
          const avecId = { ...sessionCoursesActive, id: genererIdSession() };
          ecrireSessionCourses(avecId);
          setSessionCourses(avecId);
        } catch (e) {
          console.error("Attribution d'id de session impossible :", e);
          setSyncCoursesEchec(true);
        }
        return;
      }
      try {
        await sauvegarderSessionSupabase(sessionCoursesActive);
        setSyncCoursesEchec(false);
      } catch (e) {
        console.error("Filet Supabase courses (sauvegarde) :", e);
        setSyncCoursesEchec(true);
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [sessionCoursesActive]);

  // Lot 4 — restauration à deux sources à la connexion : le localStorage est
  // déjà hydraté ; on lit la session active en base et le modifie_le le plus
  // récent gagne (reprise depuis un autre appareil, ou localStorage purgé par
  // Safari). Échec réseau : silencieux ici car la copie locale reste affichée
  // et la sauvegarde débouncée resignalera tout vrai problème d'écriture.
  useEffect(() => {
    if (!session?.user?.id || restaurationCoursesFaite.current) return;
    restaurationCoursesFaite.current = true;
    let annule = false;
    (async () => {
      try {
        const distante = await chargerSessionActiveSupabase(session.user.id);
        if (annule || !distante) return;
        const locale = (sessionCourses?.statut === 'active'
          && sessionCourses?.utilisateur_id === session.user.id) ? sessionCourses : null;
        const retenue = choisirSessionLaPlusRecente(locale, distante);
        if (retenue && retenue !== locale) {
          ecrireSessionCourses(retenue);
          setSessionCourses(retenue);
        }
      } catch (e) {
        console.error("Filet Supabase courses (restauration) :", e);
      }
    })();
    return () => { annule = true; };
  }, [session?.user?.id, sessionCourses]);
  const [priceDB, setPriceDB]     = useState([]);
  // Chantier 81 — zone du comparateur (point + rayon + libellé) réhydratée
  // depuis localStorage à l'init : au retour, l'utilisateur retrouve sa zone
  // sans repasser par l'écran de choix. Le filet Supabase (profiles) ne sert
  // plus que de repli cross-device (voir le chargement de profil, gardé pour
  // ne pas écraser une zone locale déjà hydratée).
  const [searchRadius, setSearchRadius] = useState(() => {
    const z = lireZoneStockee();
    return (z && Number.isFinite(z.searchRadius)) ? z.searchRadius : 10;
  });
  const [userPos, setUserPos] = useState(() => {
    const z = lireZoneStockee();
    return (z?.userPos?.lat != null && z?.userPos?.lng != null)
      ? { lat: z.userPos.lat, lng: z.userPos.lng } : null;
  });
  // Chantier géoloc comparateur — libellé du point de référence actif
  // (ville/adresse saisie, ou "Ma position"/ville retrouvée par reverse-geocoding
  // pour un point GPS).
  const [zoneLabel, setZoneLabel] = useState(() => lireZoneStockee()?.zoneLabel ?? null);
  // Chantier 81 — anti-flash : la zone est "prête" dès qu'un point local existe
  // (hydraté synchronement ci-dessus), sinon on attend la fin du chargement du
  // profil Supabase (voir l'init, setZonePrete(true) juste avant setLoaded).
  const [zonePrete, setZonePrete] = useState(() => !!lireZoneStockee()?.userPos);

  // Chantier 81 — écrit la zone dans localStorage à chaque changement (point,
  // libellé ou rayon), comme un favori local.
  useEffect(() => {
    try {
      localStorage.setItem(ZONE_STORAGE_KEY, JSON.stringify({
        userPos: userPos ? { lat: userPos.lat, lng: userPos.lng } : null,
        zoneLabel: zoneLabel ?? null,
        searchRadius,
      }));
    } catch { /* mode privé/quota : ignore */ }
  }, [userPos, zoneLabel, searchRadius]);
  // Chantier 84 — la préférence marque est désormais PAR ARTICLE
  // (liste_courses.marque_pref), plus de profil global ni de localStorage.
  // Met à jour la ligne en base + l'état local (défaut 'nationale').
  const setMarquePrefItem = async (itemId, pref) => {
    const val = pref === 'mdd' ? 'mdd' : 'nationale';
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, marque_pref: val } : i));
    const { error } = await supabase.from('liste_courses').update({ marque_pref: val }).eq('id', itemId);
    if (error) {
      console.error("Erreur maj marque_pref :", error);
      showAppToast("⚠️ Préférence marque non sauvegardée, vérifie ta connexion", false);
    }
  };
  // Chantier 83 — catégorie de magasins du comparateur ('grande_surface' |
  // 'proximite'). NON persisté : défaut automatique selon la taille de la liste
  // (< 6 articles -> proximité, >= 6 -> grandes surfaces). categorieChoix null
  // = suit le défaut ; dès que l'utilisateur bascule, son choix est respecté et
  // le défaut n'est plus re-forcé. Indépendant du profil marque (les deux se
  // combinent dans le comparateur).
  const [categorieChoix, setCategorieChoix] = useState(null);
  const categorieMagasin = categorieChoix ?? (items.length >= 6 ? 'grande_surface' : 'proximite');
  const [archives, setArchives]   = useState([]);
  // Chantier 1 — libellé officiel du Core (nom_reference) pour une ligne
  // d'historique déjà rattachée à un produit via lignes_ticket.produit_id.
  // Clé = libelle_brut normalisé (normName) ; affichage uniquement, ne
  // modifie jamais archives.items ni aucune donnée en base.
  const [libelleVersNomProduit, setLibelleVersNomProduit] = useState({});
  const [loaded, setLoaded]       = useState(false);

  // #64.1 — mémoire de "célébration en attente" pour la bannière Accueil.
  // Vit ici (racine), pas dans HomeTab, car HomeTab démonte/remonte à chaque
  // changement d'onglet ({loaded && tab==="home" && <HomeTab/>}) : une
  // confirmation d'économie a lieu pendant le scan, donc typiquement pendant
  // que HomeTab n'est PAS monté. Uniquement en mémoire vive (aucun
  // localStorage/DB) : un rechargement de page perd toute célébration en
  // attente, conformément à la règle "jamais d'animation au chargement".
  // N'observe QUE cagnotteTotal/potentialTotal, recalculés ici avec
  // exactement la même formule que dans HomeTab — aucun nouveau calcul
  // d'économie, aucune donnée modifiée.
  const prevCagnotteRootRef  = useRef(null);
  const prevPotentialRootRef = useRef(null);
  const [pendingCagnotte, setPendingCagnotte]   = useState(null);
  const [pendingPotential, setPendingPotential] = useState(null);

  // Réarme une référence neuve à chaque nouveau cycle de chargement (login,
  // reconnexion, changement de session) : sans ça, les totaux d'une session
  // précédente resteraient comparés à ceux de la nouvelle après un logout/login.
  useEffect(() => {
    if (loaded) return;
    prevCagnotteRootRef.current  = null;
    prevPotentialRootRef.current = null;
    setPendingCagnotte(null);
    setPendingPotential(null);
  }, [loaded]);

  useEffect(() => {
    // Tant que le chargement initial n'est pas terminé, archives peut valoir
    // [] puis passer à son contenu réel : ce n'est PAS un changement du point
    // de vue utilisateur, juste l'arrivée des données. On ignore tout tant
    // que loaded n'est pas vrai ; le premier passage APRÈS loaded===true sert
    // uniquement de référence, jamais de déclencheur (cf. bug rechargement).
    if (!loaded) return;
    const scannedArchives = archives.filter(a => a.ticket_scanned && a.realized_saving != null);
    const newCagnotte  = scannedArchives.reduce((a, arc) => a + (arc.realized_saving || 0), 0);
    const newPotential = archives.reduce((a, arc) => a + (arc.potential_saving || 0), 0);

    if (prevCagnotteRootRef.current === null) {
      prevCagnotteRootRef.current = newCagnotte;
    } else if (prevCagnotteRootRef.current !== newCagnotte) {
      const oldVal = prevCagnotteRootRef.current;
      prevCagnotteRootRef.current = newCagnotte;
      setPendingCagnotte(p => p ? { from: p.from, to: newCagnotte } : { from: oldVal, to: newCagnotte });
    }

    if (prevPotentialRootRef.current === null) {
      prevPotentialRootRef.current = newPotential;
    } else if (prevPotentialRootRef.current !== newPotential) {
      const oldVal = prevPotentialRootRef.current;
      prevPotentialRootRef.current = newPotential;
      setPendingPotential(p => p ? { from: p.from, to: newPotential } : { from: oldVal, to: newPotential });
    }
  }, [archives, loaded]);

  // #64.1 — outils de simulation dev uniquement (import.meta.env.DEV, jamais
  // en prod). N'écrivent rien en base, ne touchent à aucune archive réelle :
  // arment juste directement une célébration en attente, comme le ferait une
  // vraie confirmation détectée par l'effet ci-dessus.
  const simulerCagnotteDev = () => {
    const from = prevCagnotteRootRef.current ?? 0;
    const to = Math.round((from + 0.5) * 100) / 100;
    prevCagnotteRootRef.current = to;
    setPendingCagnotte(p => p ? { from: p.from, to } : { from, to });
  };
  const simulerPotentialDev = () => {
    const from = prevPotentialRootRef.current ?? 0;
    const to = Math.round((from + 0.5) * 100) / 100;
    prevPotentialRootRef.current = to;
    setPendingPotential(p => p ? { from: p.from, to } : { from, to });
  };

  const [storeRatings, setStoreRatings] = useState({});
  const [showSuccess, setShowSuccess] = useState(null);
  const [showRating,  setShowRating]  = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [loadRetry, setLoadRetry] = useState(0);
  const [produitsRef, setProduitsRef] = useState([]);
  const [circles,    setCircles]    = useState([]);
  const [autoOpenCamera, setAutoOpenCamera] = useState(false);
  const [showScanChoix, setShowScanChoix]  = useState(false);
  const [showMultiPhoto, setShowMultiPhoto] = useState(false);
  const [showAutresOptions, setShowAutresOptions] = useState(false);
  const [showManualEntryFromScan, setShowManualEntryFromScan] = useState(false);
  const [showGalleryImportFromScan, setShowGalleryImportFromScan] = useState(false);
  const [autoImportResult, setAutoImportResult] = useState(null);
  // Chantier anti-doublon, étape 1 — écran "À valider", dev uniquement (voir
  // le bouton flottant plus bas, gardé par import.meta.env.DEV).
  const [showAValider, setShowAValider] = useState(false);
  // Chantier Micro Lot 6 — pastille 🛠️ qui replie les outils admin flottants.
  const [adminOutilsOuverts, setAdminOutilsOuverts] = useState(false);
  // Chantier "Scan code-barres", bout 3B — console de validation admin des
  // propositions envoyées par les utilisateurs non-admin (file d'attente
  // propositions_liaison_scan). pendingScanCount alimente le badge du bouton
  // flottant même quand la console n'est pas ouverte.
  const [showValidationScan, setShowValidationScan] = useState(false);
  const [pendingScanCount, setPendingScanCount] = useState(0);
  const handleFlash = () => setShowScanChoix(true);
  const handleFlashConfirmed = () => { setShowScanChoix(false); setAutoOpenCamera(true); setTab("prices"); };
  // Chantier 79 (ajustement) — "Reprendre" depuis l'accueil : bascule sur
  // l'onglet Prix qui rouvrira la feuille avec le brouillon (autoResumeScan).
  const [autoResumeScan, setAutoResumeScan] = useState(false);
  const handleResumeScan = () => { setAutoResumeScan(true); setTab("prices"); };
  const [showCircleSheet,  setShowCircleSheet]  = useState(false);
  const [showStatsSheet,   setShowStatsSheet]   = useState(false);
  const [showFaqSheet,     setShowFaqSheet]     = useState(false);
  const [showMesPrixSheet, setShowMesPrixSheet] = useState(false);
  // Chantier 92 Lot 6 — sheet « Mes Favoris » (même mécanique que Stats/Prix).
  const [showFavorisSheet, setShowFavorisSheet] = useState(false);
  // Chantier 94 Lot 10 — sheet « Mon profil » + célébration de badge (null ou
  // { icone, nom }). La détection compare les badges actuels aux codes déjà
  // vus (localStorage) ; au tout premier passage on mémorise sans célébrer
  // (pas de fête rétroactive au lancement de la feature).
  const [showProfilSheet, setShowProfilSheet] = useState(false);
  const [nouveauBadge, setNouveauBadge] = useState(null);

  const cleBadgesVus = () => `prixmalin_badgesVus_v1_${session?.user?.id ?? ''}`;
  const lireBadgesVus = () => {
    try { const s = localStorage.getItem(cleBadgesVus()); return s ? JSON.parse(s) : null; } catch { return null; }
  };
  const memoriserBadgesVus = (codes) => {
    try {
      const existants = new Set(lireBadgesVus() || []);
      (codes || []).forEach(c => existants.add(c));
      localStorage.setItem(cleBadgesVus(), JSON.stringify([...existants]));
    } catch { /* quota / mode privé : on ignore */ }
  };

  // Chantier 94 — détection de nouveaux badges au chargement (les badges sont
  // attribués côté serveur à la validation des prix, donc typiquement entre
  // deux sessions). Best effort ; jamais rien si le profil n'est pas visible.
  useEffect(() => {
    if (!session?.user?.id || !profilVisible) return;
    let annule = false;
    (async () => {
      const badges = await chargerBadgesUtilisateur(session.user.id);
      if (annule || badges === null) return;
      const vus = lireBadgesVus();
      if (vus === null) { memoriserBadgesVus(badges.map(b => b.code_badge)); return; }
      const nouveaux = detecterNouveauxBadges(vus, badges);
      if (nouveaux.length === 0) return;
      memoriserBadgesVus(nouveaux);
      try {
        const { data } = await supabase.from('badges_catalogue')
          .select('code, nom, icone').eq('code', nouveaux[0]).maybeSingle();
        if (!annule) setNouveauBadge({ icone: data?.icone || '🏅', nom: data?.nom || nouveaux[0], reste: nouveaux.length - 1 });
      } catch {
        if (!annule) setNouveauBadge({ icone: '🏅', nom: nouveaux[0], reste: nouveaux.length - 1 });
      }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, profilVisible]);
  // Chantier 92 Lot 6 — proposition post-rapprochement : null ou
  // { propositions: [...], selection: { [cle]: bool } }. Rien n'est jamais
  // ajouté aux favoris sans action explicite.
  const [propositionFavoris, setPropositionFavoris] = useState(null);
  const [pseudo,        setPseudo]        = useState(null);
  const [cguAcceptedAt, setCguAcceptedAt] = useState(undefined);
  const [profileMap, setProfileMap] = useState({});

  const listRowId = useRef(null);
  const favRowId  = useRef(null);
  const [appToast, setAppToast] = useState(null);
  const showAppToast = (msg, ok=true) => { setAppToast({msg,ok}); setTimeout(()=>setAppToast(null),3000); };

  // Auth — écoute la session Supabase
  useEffect(()=>{
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setItems([]); setPriceDB([]); setArchives([]); setFavorites([]); setCircles([]);
        setPseudo(null); setCguAcceptedAt(undefined); setProfileMap({});
        setLoaded(false); listRowId.current = null; favRowId.current = null;
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // #56.3b — recalculé à chaque changement de session (login/logout/switch
  // de compte), jamais une seule fois au montage : sans quoi une bascule de
  // compte dans le même onglet garderait le statut admin du compte précédent.
  useEffect(() => {
    if (!session) { setIsAdmin(false); return; }
    let annule = false;
    supabase.rpc('est_administrateur').then(({ data, error }) => {
      if (annule) return;
      setIsAdmin(!error && data === true);
    });
    return () => { annule = true; };
  }, [session]);

  // Chantier "Scan code-barres", bout 3B — compteur du badge, lu directement
  // sur la table (sa RLS autorise déjà l'admin à voir toutes les lignes, pas
  // besoin de la RPC de liste ici). Relu à l'ouverture/fermeture de la
  // console pour rester juste sans dépendre d'un polling.
  useEffect(() => {
    if (!isAdmin) { setPendingScanCount(0); return; }
    let annule = false;
    supabase.from('propositions_liaison_scan').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente')
      .then(({ count, error }) => { if (!annule && !error) setPendingScanCount(count || 0); });
    return () => { annule = true; };
  }, [isAdmin, showValidationScan]);

  // #56.6 — kill switch global, même principe que isAdmin ci-dessus : relu à
  // chaque changement de session, plus au retour au premier plan (l'app ne
  // recharge pas forcément la page à ce moment-là, contrairement à isAdmin
  // qui n'a besoin que du cas session).
  useEffect(() => {
    if (!session) { setCoreActifGlobal(false); return; }
    let annule = false;
    const lireCoreActif = () => {
      supabase.rpc('core_est_actif').then(({ data, error }) => {
        if (annule) return;
        setCoreActifGlobal(!error && data === true);
      });
    };
    lireCoreActif();
    const onVisibilite = () => { if (document.visibilityState === 'visible') lireCoreActif(); };
    document.addEventListener('visibilitychange', onVisibilite);
    return () => { annule = true; document.removeEventListener('visibilitychange', onVisibilite); };
  }, [session]);

  // Chantier 87 Lot 1 — lecture du flag session_courses_ouverte, même
  // mécanique que le kill switch ci-dessus (relu au changement de session et
  // au retour au premier plan). Lecture directe de parametres_globaux (policy
  // SELECT authenticated déjà en place — pas de RPC dédiée) ; clé absente,
  // valeur ≠ 'true', erreur ou table indisponible ⇒ false, jamais de plantage.
  useEffect(() => {
    if (!session) { setSessionCoursesOuverte(false); return; }
    let annule = false;
    const lireFlagCourses = () => {
      try {
        supabase.from('parametres_globaux').select('valeur').eq('cle', 'session_courses_ouverte').maybeSingle()
          .then(({ data, error }) => {
            if (annule) return;
            setSessionCoursesOuverte(!error && data?.valeur === 'true');
          }, () => { if (!annule) setSessionCoursesOuverte(false); });
      } catch {
        if (!annule) setSessionCoursesOuverte(false);
      }
    };
    lireFlagCourses();
    const onVisibiliteCourses = () => { if (document.visibilityState === 'visible') lireFlagCourses(); };
    document.addEventListener('visibilitychange', onVisibiliteCourses);
    return () => { annule = true; document.removeEventListener('visibilitychange', onVisibiliteCourses); };
  }, [session]);

  // Chantier 94 Lot 10 — lecture du flag gamification_visible, strictement la
  // même mécanique défensive que session_courses_ouverte ci-dessus.
  useEffect(() => {
    if (!session) { setGamificationVisible(false); return; }
    let annule = false;
    const lireFlagGamification = () => {
      try {
        supabase.from('parametres_globaux').select('valeur').eq('cle', 'gamification_visible').maybeSingle()
          .then(({ data, error }) => {
            if (annule) return;
            setGamificationVisible(!error && data?.valeur === 'true');
          }, () => { if (!annule) setGamificationVisible(false); });
      } catch {
        if (!annule) setGamificationVisible(false);
      }
    };
    lireFlagGamification();
    const onVisibiliteGamif = () => { if (document.visibilityState === 'visible') lireFlagGamification(); };
    document.addEventListener('visibilitychange', onVisibiliteGamif);
    return () => { annule = true; document.removeEventListener('visibilitychange', onVisibiliteGamif); };
  }, [session]);

  const fetchStoreRatings = useCallback(async () => {
    const { data } = await supabase.rpc('get_store_ratings');
    if (!data) return;
    const avgs = {};
    data.forEach(r => { avgs[r.store_key] = r.avg_rating; });
    setStoreRatings(avgs);
  }, []);

  // Chargement données — uniquement si session active
  useEffect(()=>{
    if (!session) return;
    setLoaded(false);
    setLoadError(null);
    (async ()=>{
      try {
        const [list, prices, arcs, favs, refs, circs, prof, lignesTicketResolues] = await Promise.all([
          // LEGACY - shopping_list conservé temporairement
          // supabase.from('shopping_list').select('id, items').order('id').limit(1),
          supabase.from('liste_courses')
            .select(`id, texte_libre, libelle_saisi, quantite, format_selectionne, statut, produit_id, variante_produit_id, marque_pref,
              produit:produits(id, nom_reference),
              variante:variantes_produit(id, libelle, quantite_nette, unite_quantite, nombre_unites)`)
            .eq('utilisateur_id', session?.user?.id)
            .order('cree_le'),
          supabase.from('price_db').select('*'),
          supabase.from('archives').select('*').order('date'),
          supabase.from('favorites').select('id, items').order('id').limit(1),
          supabase.from('produits_ref').select('produit_generique, sous_categorie').order('id'),
          supabase.from('circles').select('*'),
          supabase.from('profiles').select('pseudo, cgu_accepted_at, zone_lat, zone_lng, zone_label').eq('id', session.user.id).maybeSingle(),
          // Chantier 1 — pont Historique (archives.items[].product, libellé
          // brut) → nom officiel Core. RLS restreint déjà lignes_ticket aux
          // tickets de l'utilisateur courant (tickets.utilisateur_id = auth.uid()).
          // lignes_ticket a deux FK vers produits (produit_id et
          // produit_suggere_ia_id) : l'embed doit désambiguïser explicitement,
          // sinon PostgREST rejette la requête ("more than one relationship").
          supabase.from('lignes_ticket')
            .select('libelle_brut, produits!lignes_ticket_produit_id_fkey(nom_reference)')
            .not('produit_id', 'is', null),
        ]);
        if (refs.data) setProduitsRef(refs.data);
        if (lignesTicketResolues.data) {
          const map = {};
          for (const ligne of lignesTicketResolues.data) {
            const nom = ligne.produits?.nom_reference;
            if (nom) map[normName(ligne.libelle_brut)] = nom;
          }
          setLibelleVersNomProduit(map);
        }
        if (list.data) {
          // Chantier 88 Lot 2 — les lignes 'reporte' vivent à part (section
          // « À acheter plus tard »), jamais dans la liste active.
          const lignes = (list.data || []).map(mapperLigneListeCourses);
          setItems(lignes.filter(l => l.statut !== 'reporte'));
          setItemsReportes(lignes.filter(l => l.statut === 'reporte'));
        }
        if (prices.data) {
          setPriceDB(prices.data.map(p => ({ ...p, storeId: p.storeId || 'autre', category: p.category || guessCategory(p.product) })));
          const toFix = prices.data.filter(p => !p.category);
          if (toFix.length > 0) {
            supabase.from('price_db').upsert(toFix.map(p => ({ ...p, category: guessCategory(p.product) })));
          }
        }
        if (arcs.data) setArchives(arcs.data);
        fetchStoreRatings();
        if (favs.data?.[0]) { setFavorites(favs.data[0].items || []); favRowId.current = favs.data[0].id; }
        if (circs.data) {
          setCircles(circs.data);
          const memberIds = [...new Set(circs.data
            .flatMap(c => [c.requester_id, c.recipient_id])
            .filter(id => id && id !== session.user.id)
          )];
          if (memberIds.length) {
            supabase.from('profiles').select('id, pseudo').in('id', memberIds)
              .then(({ data: mProfs }) => {
                if (mProfs) {
                  const map = {};
                  mProfs.forEach(p => { if (p.pseudo) map[p.id] = p.pseudo; });
                  setProfileMap(map);
                }
              });
          }
        }
        setPseudo(prof.data?.pseudo ?? null);
        // Chantier géoloc comparateur / 81 — point de référence mémorisé.
        // localStorage est prioritaire (hydraté à l'init) : profiles ne sert
        // que de repli cross-device et n'écrase jamais une zone locale déjà
        // définie.
        if (prof.data?.zone_lat != null && prof.data?.zone_lng != null && !lireZoneStockee()?.userPos) {
          setUserPos({ lat: prof.data.zone_lat, lng: prof.data.zone_lng });
          setZoneLabel(prof.data.zone_label ?? null);
        }
        const cguAt = prof.data?.cgu_accepted_at ?? null;
        if (!cguAt) {
          const pending = localStorage.getItem('prixmalin_cgu_pending');
          if (pending) {
            const now = new Date().toISOString();
            await supabase.from('profiles').upsert({ id: session.user.id, cgu_accepted_at: now });
            localStorage.removeItem('prixmalin_cgu_pending');
            setCguAcceptedAt(now);
          } else {
            setCguAcceptedAt(null);
          }
        } else {
          setCguAcceptedAt(cguAt);
        }
        setZonePrete(true); // Chantier 81 — zone résolue (profil chargé), fin de l'anti-flash
        setLoaded(true);
      } catch(e){
        console.error("Supabase load:", e);
        setLoadError("Impossible de charger tes données. Vérifie ta connexion.");
      }
    })();
  },[session, loadRetry]);

  // LEGACY - shopping_list conservé temporairement
  // const saveItems = async (v) => {
  //   setItems(v);
  //   try {
  //     if (listRowId.current) {
  //       const { error } = await supabase.from('shopping_list').update({items:v}).eq('id', listRowId.current);
  //       if (error) throw error;
  //     } else {
  //       const { data, error } = await supabase.from('shopping_list').insert({items:v, user_id: session?.user?.id}).select('id').single();
  //       if (error) throw error;
  //       if (data) listRowId.current = data.id;
  //     }
  //   } catch(e) {
  //     console.error("Erreur sauvegarde liste :", e);
  //     showAppToast("⚠️ Sauvegarde échouée, vérifie ta connexion", false);
  //   }
  // };

  const chargerListe = async () => {
    const { data, error } = await supabase.from('liste_courses')
      .select(`id, texte_libre, libelle_saisi, quantite, format_selectionne, statut, produit_id, variante_produit_id, marque_pref,
        produit:produits(id, nom_reference),
        variante:variantes_produit(id, libelle, quantite_nette, unite_quantite, nombre_unites)`)
      .eq('utilisateur_id', session?.user?.id)
      .order('cree_le');
    if (error) {
      console.error("Erreur rechargement liste_courses :", error);
      throw error;
    }
    // Chantier 88 Lot 2 — même partition qu'au chargement initial : les
    // lignes 'reporte' à part, hors liste active et hors comparateur.
    const lignes = (data || []).map(mapperLigneListeCourses);
    setItems(lignes.filter(l => l.statut !== 'reporte'));
    setItemsReportes(lignes.filter(l => l.statut === 'reporte'));
    return true;
  };

  // Chantier 83 (finition) — identité d'un article, alignée sur ce qui distingue
  // une ligne dans le comparateur : produit_id + variante_produit_id (Core) ;
  // repli sur le texte normalisé pour un article libre sans produit_id.
  const cleArticle = (it) => it?.produit_id != null
    ? `p:${it.produit_id}|v:${it.variante_produit_id ?? ''}`
    : `t:${normName(it?.product || '')}`;

  const addItem = async (item) => {
    // Dédoublonnage : ne pas ajouter deux fois la même ligne (corrige le bug où
    // un doublon était compté "manquant" à tort dans le comparateur).
    if (items.some(i => cleArticle(i) === cleArticle(item))) {
      showAppToast("Article déjà dans la liste", false);
      return 'duplicate';
    }
    const optimistic = { ...item, id: item.id ?? (Date.now() + Math.random()) };
    setItems(prev => [...prev, optimistic]);

    // Rapprochement automatique via alias_produits (correspondance exacte uniquement)
    let produit_id = item.produit_id ?? null;
    let texte_libre = item.produit_id ? null : item.product;
    // Conserve le texte tapé par l'utilisateur quand la reconnaissance d'alias
    // résout un produit_id à sa place (jamais quand produit_id venait déjà du
    // catalogue) — pour l'afficher tel quel plutôt que le nom_reference.
    let libelle_saisi = null;
    if (!produit_id && item.product?.trim()) {
      const { data: aliases } = await supabase
        .from('alias_produits')
        .select('produit_id')
        .eq('statut', 'actif')
        .ilike('libelle_alias', item.product.trim());
      if (aliases && aliases.length === 1) {
        produit_id = aliases[0].produit_id;
        texte_libre = null; // contrainte liste_courses_produit_ou_texte
        libelle_saisi = item.product.trim();
      }
    }

    const payload = {
      utilisateur_id:      session?.user?.id,
      texte_libre:         texte_libre,
      quantite:            item.qty ?? 1,
      format_selectionne:  item.format || null,
      statut:              'a_acheter',
      produit_id:          produit_id,
      variante_produit_id: item.variante_produit_id ?? null,
      libelle_saisi:       libelle_saisi,
      // Chantier 84 — préférence marque de l'article (défaut 'nationale' à l'ajout).
      marque_pref:         item.marque_pref === 'mdd' ? 'mdd' : 'nationale',
    };

    // Phase 1 : insertion — seule cette phase déclenche un rollback de l'optimiste.
    let insertedId;
    try {
      const { data, error } = await supabase.from('liste_courses').insert(payload).select('id').single();
      if (error || !data?.id) {
        throw error || new Error("Insertion sans id retourné");
      }
      insertedId = data.id;
    } catch (e) {
      console.error("Erreur ajout liste — détail complet :", {
        message: e?.message, code: e?.code, details: e?.details, hint: e?.hint,
      });
      console.error("Erreur ajout liste :", e);
      setItems(prev => prev.filter(i => i.id !== optimistic.id));
      showAppToast("⚠️ Sauvegarde échouée, vérifie ta connexion", false);
      return false;
    }

    // La ligne existe désormais bel et bien en base : on remplace l'id temporaire
    // par le véritable id, et on ne la supprime plus jamais localement à partir d'ici.
    setItems(prev => prev.map(i => i.id === optimistic.id ? { ...i, id: insertedId } : i));

    // Phase 2 : rechargement — un échec ici n'annule pas l'insertion déjà réussie.
    try {
      await chargerListe();
      return true;
    } catch (e) {
      console.error("Erreur rechargement après ajout :", e);
      showAppToast("⚠️ Produit ajouté, mais la liste n'a pas pu être actualisée.", false);
      return true;
    }
  };

  const updateItem = async (updated) => {
    const previous = items.find(i => i.id === updated.id);
    // Fusion (et non remplacement) pour ne pas perdre des champs non gérés par
    // l'édition — notamment marque_pref (Chantier 84).
    setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));

    const payload = updated.produit_id
      ? {
          texte_libre:         null,
          quantite:            updated.qty ?? 1,
          format_selectionne:  null,
          produit_id:          updated.produit_id,
          variante_produit_id: updated.variante_produit_id ?? null,
        }
      : {
          texte_libre:         (updated.product || '').trim() || null,
          quantite:            updated.qty ?? 1,
          format_selectionne:  updated.format || null,
          produit_id:          null,
          variante_produit_id: null,
        };

    // Phase 1 : écriture — seule cette phase déclenche un rollback vers `previous`.
    try {
      const { data, error } = await supabase.from('liste_courses').update(payload).eq('id', updated.id).select('id').single();
      if (error || !data?.id) {
        throw error || new Error("Mise à jour sans id retourné");
      }
    } catch (e) {
      console.error("Erreur modification liste :", e);
      if (previous) setItems(prev => prev.map(i => i.id === updated.id ? previous : i));
      showAppToast("⚠️ Sauvegarde échouée, vérifie ta connexion", false);
      return false;
    }

    // Phase 2 : rechargement — un échec ici n'annule pas l'écriture déjà réussie.
    try {
      await chargerListe();
      return true;
    } catch (e) {
      console.error("Erreur rechargement après modification :", e);
      showAppToast("⚠️ Modification enregistrée, mais la liste n'a pas pu être actualisée.", false);
      return true;
    }
  };

  const toggleCheck = async (id) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const newChecked = !item.checked;
    setItems(prev => prev.map(i => i.id === id ? { ...i, checked: newChecked } : i));
    try {
      const { error } = await supabase.from('liste_courses')
        .update({ statut: newChecked ? 'achete' : 'a_acheter' })
        .eq('id', id);
      if (error) throw error;
    } catch(e) {
      console.error("Erreur coche liste :", e);
      setItems(prev => prev.map(i => i.id === id ? { ...i, checked: item.checked } : i));
      showAppToast("⚠️ Sauvegarde échouée, vérifie ta connexion", false);
    }
  };

  const removeItem = async (id) => {
    const previous = items.find(i => i.id === id);
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      const { error } = await supabase.from('liste_courses').delete().eq('id', id);
      if (error) throw error;
    } catch(e) {
      console.error("Erreur suppression liste :", e);
      if (previous) setItems(prev => [...prev, previous]);
      showAppToast("⚠️ Sauvegarde échouée, vérifie ta connexion", false);
    }
  };
  const savePriceDB = async (v) => {
    setPriceDB(v);
    const clean = v.map(p => ({
      product:       p.product,
      format:        p.format,
      brand:         p.brand || '',
      storeId:       p.storeId || '',
      store_name:    p.store_name || '',
      store_address: p.store_address || '',
      store_id:      p.store_id || null,
      price:         parseFloat(p.price),
      date:          p.date || new Date().toISOString(),
      category:      p.category || guessCategory(p.product),
      user_id:       session?.user?.id,
      ...parseFormat(p.format),
      prix_unitaire: (() => { const { quantite, unite, conditionnement } = parseFormat(p.format); return calcPrixUnitaire(parseFloat(p.price), quantite, unite, conditionnement); })(),
    }));

    const { error } = await supabase
      .from('price_db')
      .upsert(clean, { onConflict: 'product,format,brand,storeId' });
    if (error) {
      console.error("Erreur insertion Supabase :", error);
      showAppToast("⚠️ Sauvegarde des prix échouée, vérifie ta connexion", false);
    } else {
      const { data } = await supabase.from('price_db').select('*');
      if (data) setPriceDB(data.map(p => ({ ...p, storeId: p.storeId || 'autre' })));
    }

  };
  const saveArchives = async (v) => {
    setArchives(v);
    if (v.length > 0) {
      const last = v[v.length-1];
      const {id, ...rest} = last;
      const { error } = await supabase.from('archives').insert({...rest, user_id: session?.user?.id});
      if (error) {
        console.error("Erreur sauvegarde historique :", error);
        showAppToast("⚠️ Historique non sauvegardé, vérifie ta connexion", false);
      } else {
        const { data } = await supabase.from('archives').select('*').order('date');
        if (data) setArchives(data);
      }
    }
  };
  const deleteArchive = async (arc) => {
    const previous = archives;
    setArchives(archives.filter(a => a.id !== arc.id));
    const { error } = await supabase.from('archives').delete().eq('id', arc.id);
    if (error) {
      console.error("Erreur suppression archive :", error);
      setArchives(previous);
      showAppToast("⚠️ Suppression échouée, vérifie ta connexion", false);
    }
  };
  const saveFavorites = async (v) => {
    setFavorites(v);
    try {
      if (favRowId.current) {
        const { error } = await supabase.from('favorites').update({items:v}).eq('id', favRowId.current);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('favorites').insert({items:v, user_id: session?.user?.id}).select('id').single();
        if (error) throw error;
        if (data) favRowId.current = data.id;
      }
    } catch(e) {
      console.error("Erreur sauvegarde favoris :", e);
      showAppToast("⚠️ Favoris non sauvegardés, vérifie ta connexion", false);
    }
  };

  const updateArchive = async (id, updates) => {
    const { error } = await supabase.from('archives').update(updates).eq('id', id);
    if (!error) {
      setArchives(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
    } else {
      console.error("Erreur mise à jour archive :", error);
    }
    return { error };
  };

  // Chantier « Courses » Lot 1 (shadow estFrancois) — construit l'instantané
  // FIGÉ de la session depuis les lignes de prix retenues du magasin gagnant
  // (transmises par CompareTab) puis ouvre l'écran de courses. Rayon =
  // catégorie (arbitrage 2026-08-11) ; un rayon non résolu (erreur réseau
  // comprise) retombe sur « Autres articles », jamais un blocage.
  const demarrerSessionCourses = async (store, extrasCourses) => {
    // Rayons + marques des variantes du caddie (Lot 7), en parallèle et chacun
    // avec son repli : un échec réseau ne bloque jamais le démarrage.
    const [rayons, marquesVariantes] = await Promise.all([
      chargerRayonsProduits(items.map(i => i.produit_id).filter(Boolean))
        .catch(e => { console.error("Rayons non résolus (repli « Autres articles ») :", e); return new Map(); }),
      chargerMarquesVariantes(items.map(i => i.variante_produit_id).filter(Boolean))
        .catch(e => { console.error("Marques de variantes non résolues (nom sans marque) :", e); return new Map(); }),
    ]);
    const articles = construireArticlesSession({ items, lignesPrix: extrasCourses.lignesPrix, rayons, marquesVariantes });
    const nouvelleSession = construireSessionCourses({
      // Lot 4 — id client : clé primaire de la ligne Supabase (upsert
      // idempotent). genererIdSession et non crypto.randomUUID : ce dernier
      // n'existe pas en contexte non sécurisé (incident 2026-08-11).
      id: genererIdSession(),
      utilisateurId: session?.user?.id ?? null,
      magasin: {
        magasin_id: extrasCourses.magasinId ?? null,
        nom: store?.name ?? 'Magasin',
        enseigne: extrasCourses.nomEnseigne ?? null,
        adresse: extrasCourses.adresse?.adresse ?? null,
        code_postal: extrasCourses.adresse?.code_postal ?? null,
        ville: extrasCourses.adresse?.ville ?? null,
      },
      articles,
      totalPrevu: store?.total,
      creeLeISO: new Date().toISOString(),
    });
    ecrireSessionCourses(nouvelleSession);
    setSessionCourses(nouvelleSession);
    setTab("courses");

    // Lot 4 — filet Supabase, best effort (jamais bloquant) : d'abord basculer
    // toute ancienne session active en 'abandonnee' (index unique partiel),
    // PUIS upsert de la nouvelle. Un échec est signalé par l'indicateur et la
    // sauvegarde débouncée réessaiera au prochain changement.
    (async () => {
      try {
        await abandonnerSessionsActivesSupabase(session?.user?.id, nouvelleSession.cree_le, { saufId: nouvelleSession.id });
        await sauvegarderSessionSupabase(nouvelleSession);
        setSyncCoursesEchec(false);
      } catch (e) {
        console.error("Filet Supabase courses (création) :", e);
        setSyncCoursesEchec(true);
      }
    })();
  };

  // Chantier « Courses » Lot 2 (shadow estFrancois) — cocher / décocher /
  // introuvable. La sauvegarde localStorage est IMMÉDIATE, avant même le
  // re-rendu : chaque action survit à une fermeture instantanée de l'app.
  // appliquerEtatArticle renvoie la même référence si rien ne change
  // (clé inconnue, état identique) : aucune écriture inutile dans ce cas.
  const appliquerSessionCourses = (suivante) => {
    if (suivante === sessionCourses) return;
    ecrireSessionCourses(suivante);
    setSessionCourses(suivante);
  };

  const changerEtatArticleSession = (cle, nouvelEtat) => {
    appliquerSessionCourses(appliquerEtatArticle(sessionCourses, cle, nouvelEtat, new Date().toISOString()));
    // Lot 7 — retour haptique léger quand un article rejoint le caddie
    // (Android ; l'API n'existe pas sur Safari iOS → no-op silencieux, le
    // retour visuel — case verte, bascule de section — fait l'équivalent).
    if (nouvelEtat === 'au_caddie') { try { navigator.vibrate?.(15); } catch { /* ignore */ } }
    // Chantier 95 Lot 11 — au cochage : diagnostic de prix asynchrone, jamais
    // bloquant pour le cochage lui-même. Au décochage : la carte de cet
    // article disparaît (rien d'autre ne change).
    if (nouvelEtat === 'au_caddie') proposerSollicitationPrix(cle);
    else if (sollicitationPrix?.cle === cle) setSollicitationPrix(null);
  };

  // Chantier 95 Lot 11 — propose (peut-être) de relever le prix de l'article
  // qu'on vient de cocher : uniquement si le prix du produit/format à CE
  // magasin est absent ou trop ancien, une seule fois par produit et par
  // session. Tout échec (réseau, doc absent) => silence, jamais de carte.
  const proposerSollicitationPrix = async (cle) => {
    try {
      const doc = lireSessionCourses(); // écrit synchroniquement par le cochage
      if (!doc || doc.statut !== 'active' || doc.utilisateur_id !== session?.user?.id) return;
      const article = doc.articles?.find(a => a.cle === cle);
      const magasinId = doc.magasin?.magasin_id;
      if (!article || article.type !== 'caddie' || article.etat !== 'au_caddie'
        || !article.produit_id || !magasinId) return;
      if (!doitProposerSollicitation(doc, cle)) return; // anti-répétition
      const lignes = await chargerPrixPourDiagnostic(article.produit_id, magasinId);
      if (lignes === null) return; // diagnostic impossible -> pas de sollicitation
      const diagnostic = diagnostiquerPrix(article, lignes, { maintenantMs: Date.now() });
      if (!doitSolliciter(diagnostic)) return;
      // Marque 'proposee' tout de suite (une seule sollicitation par session).
      setSessionCourses(prev => {
        if (!prev || prev.id !== doc.id) return prev;
        const suivante = marquerSollicitationPrix(prev, cle, 'proposee', new Date().toISOString());
        if (suivante !== prev) { try { ecrireSessionCourses(suivante); } catch { /* best effort */ } }
        return suivante;
      });
      setSollicitationPrix({ cle, nom: article.nom_affiche ?? article.nom_reference ?? 'ce produit' });
    } catch (e) {
      console.error('Sollicitation prix (sautée, best effort) :', e);
    }
  };

  // Chantier 95 — décision sur la carte ('plus_tard' -> file, 'ignoree' ->
  // plus de sollicitation pour ce produit cette session). Réversible de fait :
  // tout vit dans le doc de session.
  const deciderSollicitationPrix = (cle, etat) => {
    setSessionCourses(prev => {
      if (!prev) return prev;
      const suivante = marquerSollicitationPrix(prev, cle, etat, new Date().toISOString());
      if (suivante !== prev) { try { ecrireSessionCourses(suivante); } catch { /* best effort */ } }
      return suivante;
    });
    setSollicitationPrix(null);
  };

  // Chantier 95 — « Relever » : ouvre la saisie de prix EXISTANTE, préremplie
  // produit/marque, magasin de la session verrouillé (jamais redemandé).
  const ouvrirSaisieSollicitation = (cle, origine) => {
    const article = sessionCoursesActive?.articles?.find(a => a.cle === cle);
    setSollicitationPrix(null);
    if (origine === 'file') setFileACompleterVisible(false);
    if (!article) return;
    setSollicitationSaisie({ cle, article, origine });
  };

  // Chantier 95 — prix enregistré depuis la sollicitation : sauvegarde legacy
  // via le mécanisme existant (handleSavePrice ; l'écriture Core est déjà
  // faite DANS PriceEntrySheet), puis l'article sort de la file ('relevee').
  const enregistrerPrixSollicitation = (entry) => {
    const saisie = sollicitationSaisie;
    setSollicitationSaisie(null);
    try { handleSavePrice(entry); } catch (e) { console.error('Sauvegarde prix sollicitation :', e); }
    if (saisie?.cle) {
      setSessionCourses(prev => {
        if (!prev) return prev;
        const suivante = marquerSollicitationPrix(prev, saisie.cle, 'relevee', new Date().toISOString());
        if (suivante !== prev) { try { ecrireSessionCourses(suivante); } catch { /* best effort */ } }
        return suivante;
      });
    }
    if (saisie?.origine === 'file') setFileACompleterVisible(true);
  };

  // Lot 5 — notes libres « Ajoutés en route » : données de session uniquement
  // (localStorage + sessions_courses.donnees via la synchro débouncée),
  // JAMAIS d'écriture dans produits/variantes_produit/prix.
  const ajouterNoteCourses = (texte) => {
    appliquerSessionCourses(ajouterNoteSession(sessionCourses, texte, new Date().toISOString(), genererIdSession()));
  };

  const supprimerNoteCourses = (cle) => {
    appliquerSessionCourses(supprimerNoteSession(sessionCourses, cle, new Date().toISOString()));
  };

  // Lot 3 — abandon explicite depuis la carte d'accueil (jamais automatique).
  // Le caddie n'est pas touché ; l'archive créée à la validation reste, comme
  // pour un comparatif validé sans scan de ticket (comportement historique).
  const abandonnerSessionCourses = () => {
    const utilisateurId = session?.user?.id;
    // Chantier 91 — même purge des dialogues de rapprochement qu'à la clôture.
    setRapprochementCourses(null);
    setVerifCourses([]);
    // Chantier 95 — même purge des sollicitations de prix.
    setSollicitationPrix(null);
    setSollicitationSaisie(null);
    setFileACompleterVisible(false);
    effacerSessionCourses();
    setSessionCourses(null);
    // Lot 4 — bascule aussi la ligne base en 'abandonnee' (best effort). Si
    // l'écriture échoue (hors ligne), la ligne restera active en base et la
    // session réapparaîtrait à la prochaine restauration : gênant mais jamais
    // une perte — l'abandon pourra être refait.
    (async () => {
      try {
        await abandonnerSessionsActivesSupabase(utilisateurId, new Date().toISOString());
      } catch (e) {
        console.error("Filet Supabase courses (abandon) :", e);
      }
    })();
  };

  // Lot 6 — demande de clôture depuis l'écran de courses : s'il reste des
  // articles à prendre, confirmation d'abord (jamais de clôture silencieuse) ;
  // sinon, directement le choix du sort du caddie.
  const demanderTerminerCourses = () => {
    if (!sessionCoursesActive) return;
    const prog = calculerProgression(sessionCoursesActive.articles);
    setClotureCourses(prog.restants > 0 ? 'confirmation' : 'choixCaddie');
  };

  // Chantier 90 Lot 4 — « Je passe en caisse » : confirmation du magasin de
  // la session, puis lancement du parcours de scan EXISTANT (même chemin que
  // le bouton Scanner de l'accueil : caméra directe sur l'onglet Mes prix).
  // magasin non-nul = magasin de la session confirmé (étape magasin sautée
  // dans le sheet) ; null = « changer de magasin » (résolution existante).
  const lancerScanCaisse = (magasin) => {
    const sessionId = sessionCoursesActive?.id ?? null;
    setCaisseCourses(false);
    if (!sessionId) return;
    definirScanCaisse({ sessionId, magasin });
    setAutoOpenCamera(true);
    setTab("prices");
  };

  // Chantier 90 Lot 4 — rattachement du ticket scanné à la session, appelé
  // par importPrices avec la promesse d'écriture Core. Best effort de bout en
  // bout : si l'écriture Core échoue ou ne crée pas de ticket (statut
  // 'rejet'), si le « dernier ticket » est introuvable ou si l'update
  // Supabase rate, ticket_id reste simplement null — ni la session ni le
  // scan ne sont jamais cassés. Le « dernier ticket de l'utilisateur » est
  // le même mécanisme que calculerRealizedSavingTicket (#56.5.B).
  const rattacherTicketScanSession = (ecritureCorePromise) => {
    const cible = scanCaisseRef.current;
    definirScanCaisse(null);
    if (!cible?.sessionId) return;
    (async () => {
      try {
        const resultat = await ecritureCorePromise;
        if (!doitRattacherTicketSession(resultat)) return;
        const { data: dernierTicket } = await supabase
          .from('tickets').select('id')
          .eq('utilisateur_id', session?.user?.id)
          .order('cree_le', { ascending: false })
          .limit(1)
          .maybeSingle();
        const ticketId = dernierTicket?.id ?? null;
        if (!ticketId) return;
        // Colonne ticket_id + miroir dans donnees (lecture-modification de la
        // seule ligne visée) — la ligne peut être encore active ou déjà close.
        let donneesMaj;
        try {
          const { data: ligne } = await supabase.from('sessions_courses')
            .select('donnees')
            .eq('id', cible.sessionId)
            .eq('utilisateur_id', session?.user?.id)
            .maybeSingle();
          donneesMaj = ligne?.donnees ? { ...ligne.donnees, ticket_id: ticketId } : undefined;
        } catch { donneesMaj = undefined; }
        const { error } = await supabase.from('sessions_courses')
          .update({ ticket_id: ticketId, ...(donneesMaj ? { donnees: donneesMaj } : {}) })
          .eq('id', cible.sessionId)
          .eq('utilisateur_id', session?.user?.id);
        if (error) throw error;
        // Miroir local si c'est toujours la session affichée (l'upsert
        // débouncé repropagera donnees avec ticket_id).
        setSessionCourses(prev => {
          if (!prev || prev.id !== cible.sessionId || prev.ticket_id === ticketId) return prev;
          const suivante = { ...prev, ticket_id: ticketId };
          try { ecrireSessionCourses(suivante); } catch { /* best effort */ }
          return suivante;
        });
        // Chantier 91 Lot 5 — rapprochement automatique après rattachement.
        // Best effort avec ses propres filets : un échec ne casse ni la
        // session ni le flux de scan qui vient de se terminer.
        await lancerRapprochementSession(cible.sessionId, ticketId);
      } catch (e) {
        console.error("Rattachement ticket → session de courses (best effort) :", e);
      }
    })();
  };

  // Chantier 91 Lot 5 — rapprochement liste / cochés / ticket, lancé après le
  // rattachement (chantier 90). Lit la session depuis le localStorage (source
  // de vérité écrite synchroniquement, jamais une fermeture React périmée) et
  // ne travaille QUE sur la session active visée. Charge les lignes du ticket
  // (RLS propriétaire) + montant_total ; échec de chargement => rapprochement
  // SAUTÉ proprement, aucun classement. Ticket sans ligne exploitable =>
  // message seulement (garde-fou : jamais « tout non acheté » sur un ticket
  // illisible). Résultat écrit uniquement dans le document de session
  // (localStorage + upsert débouncé de donnees) — AUCUNE écriture dans
  // prix / lignes_ticket / produits / variantes.
  const lancerRapprochementSession = async (sessionId, ticketId) => {
    try {
      const locale = lireSessionCourses();
      if (!locale || locale.id !== sessionId || locale.statut !== 'active'
        || locale.utilisateur_id !== session?.user?.id) return;

      const [lignesRes, ticketRes] = await Promise.all([
        supabase.from('lignes_ticket')
          .select('produit_id, variante_produit_id, libelle_brut, libelle_ticket, quantite, prix_unitaire, statut_validation_produit')
          .eq('ticket_id', ticketId),
        supabase.from('tickets').select('montant_total').eq('id', ticketId).maybeSingle(),
      ]);
      if (lignesRes.error) throw lignesRes.error;
      const lignes = lignesRes.data || [];
      const brutTotal = ticketRes?.data?.montant_total;
      const totalReel = brutTotal != null && Number.isFinite(Number(brutTotal)) ? Number(brutTotal) : null;

      if (lignes.length === 0) {
        setRapprochementCourses({ sansLignes: true });
        return;
      }

      // Normalisation via la RPC normaliser_libelle (repli local intégré),
      // puis cœur PUR ; application par cle sur l'état React courant pour ne
      // jamais écraser un cochage intervenu entre-temps.
      const normaliser = await construireNormaliseur(textesARapprocher(locale.articles, lignes));
      const resultat = rapprocherSessionTicket(locale.articles, lignes, { normaliser });
      const maintenant = new Date().toISOString();
      setSessionCourses(prev => {
        const base = (prev && prev.id === sessionId) ? prev : null;
        if (!base) return prev;
        const suivante = appliquerRapprochementSession(base, resultat, totalReel, maintenant);
        try { ecrireSessionCourses(suivante); } catch { /* best effort */ }
        return suivante;
      });
      setVerifCourses(resultat.articles.filter(a => a?.type === 'caddie' && a.achat === 'a_verifier').map(a => a.cle));
      setRapprochementCourses({ compteurs: resultat.compteurs, totalReel });

      // Chantier 92 Lot 6 — proposition de favoris : parmi les achats
      // CONFIRMÉS (articles + hors liste), ceux qui sont RÉCURRENTS (>= 3
      // tickets distincts) et pas déjà favoris. Jamais d'ajout automatique —
      // le dialogue attend une action explicite. Best effort intégral.
      try {
        const achatsConfirmes = [
          ...resultat.articles.filter(a => a?.type === 'caddie' && a.achat === 'confirme'),
          ...(resultat.achats_hors_liste || []),
        ];
        if (achatsConfirmes.length > 0) {
          const [recurrents, favorisExistants] = await Promise.all([
            chargerRecurrents(session?.user?.id),
            chargerFavoris(session?.user?.id),
          ]);
          const propositions = proposerFavorisApresTicket({ achatsConfirmes, recurrents, favorisExistants });
          if (propositions.length > 0) {
            setPropositionFavoris({ propositions, selection: Object.fromEntries(propositions.map(p => [p.cle, true])) });
          }
        }
      } catch (e) {
        console.error("Proposition de favoris post-ticket (best effort) :", e);
      }
    } catch (e) {
      console.error("Rapprochement ticket <-> session (sauté, best effort) :", e);
    }
  };

  // Chantier 92 Lot 6 — ajout des favoris sélectionnés (action explicite).
  // Anti-doublon rejoué par ajouterFavori (vérification + index unique) ;
  // bilan en toast, jamais bloquant.
  const validerPropositionFavoris = async () => {
    const p = propositionFavoris;
    setPropositionFavoris(null);
    const choisis = (p?.propositions || []).filter(x => p.selection?.[x.cle]);
    if (choisis.length === 0) return;
    let ajoutes = 0, dejas = 0, echecs = 0;
    for (const c of choisis) {
      const res = await ajouterFavori({ utilisateurId: session?.user?.id, produitId: c.produit_id, varianteProduitId: c.variante_produit_id });
      if (res.statut === 'ajoute') ajoutes += 1;
      else if (res.statut === 'deja') dejas += 1;
      else echecs += 1;
    }
    const morceaux = [];
    if (ajoutes) morceaux.push(`${ajoutes} favori${ajoutes > 1 ? "s" : ""} ajouté${ajoutes > 1 ? "s" : ""}`);
    if (dejas) morceaux.push(`${dejas} déjà en favori`);
    if (echecs) morceaux.push(`${echecs} non enregistré${echecs > 1 ? "s" : ""}`);
    if (morceaux.length) showAppToast(`${echecs ? "⚠️" : "❤️"} ${morceaux.join(" · ")}`, !echecs);
  };

  // Chantier 91 Lot 5 — décision utilisateur sur un article 'a_verifier' :
  // 'confirme' / 'non_achete', ou null pour « article mal reconnu » (l'achat
  // reste 'a_verifier' — honnête et réversible — et on renvoie vers l'outil
  // de réconciliation existant, l'Historique). Retire toujours l'article de
  // la file du mini-dialogue.
  const trancherVerifCourses = (cle, achat, { versHistorique = false } = {}) => {
    if (achat) {
      setSessionCourses(prev => {
        if (!prev) return prev;
        const suivante = deciderAchatArticle(prev, cle, achat, new Date().toISOString());
        if (suivante !== prev) { try { ecrireSessionCourses(suivante); } catch { /* best effort */ } }
        return suivante;
      });
    }
    setVerifCourses(prev => prev.filter(c => c !== cle));
    if (versHistorique) setTab("archive");
  };

  // Chantier 88 Lot 2 — aiguillage après le choix du sort du caddie : si le
  // vidage choisi s'apprête à supprimer des articles PRÉVUS MAIS NON ACHETÉS
  // (a_prendre ou introuvable), on propose D'ABORD, une seule fois, de les
  // garder pour plus tard — rien n'est clos ni écrit à ce stade (Annuler
  // ramène au choix du caddie). Sinon (« garder » ou aucun non-acheté
  // concerné) : clôture immédiate, strictement comme avant.
  const choisirActionCaddie = (actionCaddie) => {
    if (actionCaddie !== 'garder') {
      const nonAchetes = articlesNonAchetesASupprimer(sessionCoursesActive, { garderIntrouvables: actionCaddie === 'garder_introuvables' });
      if (nonAchetes.length > 0) {
        setClotureCourses(null);
        setPlusTardCourses({
          actionCaddie,
          articles: nonAchetes,
          mode: 'simple',
          // « Choisir » : tout coché par défaut (cocher = garder pour plus tard).
          selection: Object.fromEntries(nonAchetes.map(a => [a.cle, true])),
        });
        return;
      }
    }
    executerClotureCourses(actionCaddie);
  };

  // Lot 6 — clôture effective. actionCaddie : 'vider' | 'garder_introuvables'
  // | 'garder'. La session est close d'abord (localStorage effacé, carte
  // disparue, retour accueil) ; l'écriture base (statut 'terminee') et
  // l'éventuel vidage du caddie sont best effort, avec toast explicite en cas
  // d'échec — supprimer moins que prévu n'est jamais une perte de données.
  // Chantier 88 Lot 2 (additif) — reporteIds : lignes liste_courses à passer
  // en statut 'reporte' (« À acheter plus tard ») AU LIEU d'être supprimées.
  // Best effort aussi : en cas d'échec, la ligne reste dans son état actuel
  // (toujours visible dans « Ma liste »), jamais de perte ni de blocage.
  const executerClotureCourses = async (actionCaddie, { reporteIds = [] } = {}) => {
    const sessionAClore = sessionCoursesActive;
    setPlusTardCourses(null);
    if (!sessionAClore) { setClotureCourses(null); return; }
    // Chantier 89 Lot 3 — comptes du vidage calculés AVANT la clôture (purs),
    // pour figer le bilan dans le document de session : mêmes règles que les
    // écritures plus bas (garde-fou compris), aucune divergence possible.
    const maintenantISO = new Date().toISOString();
    const idsSupprimables = actionCaddie === 'garder' ? [] : idsCaddieASupprimer(sessionAClore, { garderIntrouvables: actionCaddie === 'garder_introuvables' });
    // Garde-fou : on ne reporte que des lignes que le vidage allait supprimer.
    const aReporter = reporteIds.filter(id => idsSupprimables.includes(id));
    const ids = idsSupprimables.filter(id => !aReporter.includes(id));
    // Chantier 91 Lot 5 — total réel du ticket rattaché (posé par le
    // rapprochement sur la session), null si aucun ticket n'a été scanné.
    const bilan = construireBilanCourses(sessionAClore.articles, { nbReportes: aReporter.length, figeLeISO: maintenantISO, totalReel: sessionAClore.ticket_total_reel ?? null });
    // Bilan figé DANS le doc terminé (jsonb donnees / localStorage) — champ
    // additif, aucune migration.
    const terminee = { ...cloreSession(sessionAClore, maintenantISO), bilan };
    setClotureCourses(null);
    // Chantier 91 — dialogues de rapprochement purgés : la session se ferme,
    // les décisions restantes vivent déjà dans donnees (réversibles).
    setRapprochementCourses(null);
    setVerifCourses([]);
    // Chantier 95 — sollicitations de prix purgées avec la session.
    setSollicitationPrix(null);
    setSollicitationSaisie(null);
    setFileACompleterVisible(false);
    effacerSessionCourses();
    setSessionCourses(null);
    setTab("home");
    // Chantier 89 Lot 3 — l'écran-bilan remplace l'ancien toast « 🎉 Courses
    // terminées ! » : affiché depuis l'état local, donc visible même si toutes
    // les écritures Supabase ci-dessous échouent.
    setBilanCourses(bilan);

    try {
      // Correctif (test 2026-08-12) — un doc d'avant le Lot 4 (sans id, vieux
      // localStorage) rendait l'upsert silencieusement muet : la ligne base
      // restait « active » pour toujours et ressuscitait à chaque
      // restauration. Id de secours + trace explicite quand rien n'est écrit.
      const aSauver = terminee?.id ? terminee : { ...terminee, id: genererIdSession() };
      const sauvee = await sauvegarderSessionSupabase(aSauver);
      if (!sauvee) console.error("Clôture : session non synchronisable (id ou compte manquant) — le balayage ci-dessous ferme la ligne base.");
    } catch (e) {
      console.error("Filet Supabase courses (clôture) :", e);
    }
    // Invariant Lot 4 « une seule session active par compte », étendu à la
    // clôture : après « Terminer mes courses », plus AUCUNE ligne active ne
    // doit rester en base pour ce compte — même si l'upsert ci-dessus a
    // échoué ou visait un autre id que la ligne base. Best effort, comme
    // l'abandon depuis la carte d'accueil.
    try {
      await abandonnerSessionsActivesSupabase(session?.user?.id, new Date().toISOString());
    } catch (e) {
      console.error("Filet Supabase courses (clôture, balayage) :", e);
    }

    if (actionCaddie === 'garder') return;
    let listeATouchee = false;
    if (ids.length > 0) {
      try {
        const { error } = await supabase.from('liste_courses')
          .delete()
          .eq('utilisateur_id', session?.user?.id)
          .in('id', ids);
        if (error) throw error;
        listeATouchee = true;
      } catch (e) {
        console.error("Vidage du caddie post-courses :", e);
        showAppToast("⚠️ Le caddie n'a pas pu être vidé — tu peux le faire depuis « Ma liste ».", false);
      }
    }
    if (aReporter.length > 0) {
      try {
        const { error } = await supabase.from('liste_courses')
          .update({ statut: 'reporte' })
          .eq('utilisateur_id', session?.user?.id)
          .in('id', aReporter);
        if (error) throw error;
        listeATouchee = true;
      } catch (e) {
        console.error("Report « à acheter plus tard » post-courses :", e);
        showAppToast("⚠️ Ces articles n'ont pas pu être mis de côté — ils restent dans « Ma liste ».", false);
      }
    }
    if (listeATouchee) {
      try {
        await chargerListe();
      } catch (e) {
        console.error("Rechargement de la liste post-clôture :", e);
      }
    }
  };

  // Chantier 88 Lot 2 — depuis la section « À acheter plus tard » de Ma liste :
  // remettre une ligne dans la liste active ('reporte' -> 'a_acheter'). Si le
  // même article a été rajouté entre-temps, on supprime la ligne reportée au
  // lieu de créer un doublon (même identité que le dédoublonnage d'addItem).
  const reactiverReporte = async (id) => {
    const ligne = itemsReportes.find(i => i.id === id);
    if (!ligne) return;
    try {
      if (items.some(i => cleArticle(i) === cleArticle(ligne))) {
        const { error } = await supabase.from('liste_courses').delete().eq('id', id);
        if (error) throw error;
        showAppToast("Article déjà dans la liste", false);
      } else {
        const { error } = await supabase.from('liste_courses')
          .update({ statut: 'a_acheter' })
          .eq('id', id);
        if (error) throw error;
      }
      await chargerListe();
    } catch (e) {
      console.error("Réactivation d'un article reporté :", e);
      showAppToast("⚠️ Sauvegarde échouée, vérifie ta connexion", false);
    }
  };

  // Chantier 88 Lot 2 — suppression individuelle d'une ligne reportée
  // (optimiste + restauration, même mécanique que removeItem).
  const supprimerReporte = async (id) => {
    const previous = itemsReportes.find(i => i.id === id);
    setItemsReportes(prev => prev.filter(i => i.id !== id));
    try {
      const { error } = await supabase.from('liste_courses').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Suppression d'un article reporté :", e);
      if (previous) setItemsReportes(prev => [...prev, previous]);
      showAppToast("⚠️ Sauvegarde échouée, vérifie ta connexion", false);
    }
  };

  const handleValidate = async (store, potentialSaving = 0, extrasCourses = null, forcerRemplacement = false) => {
    // Lot 3 (bascule générale 2026-08-12) — une session est déjà active : on
    // demande AVANT toute écriture (ni archive ni session créées à ce stade)
    // si l'utilisateur reprend ses courses ou remplace par cette nouvelle
    // liste. « Reprendre » ne crée donc rien — pas d'archive fantôme.
    if (extrasCourses && sessionCoursesActive && !forcerRemplacement) {
      setConfirmCoursesExistantes({ store, potentialSaving, extrasCourses });
      return;
    }

    let totalSaving = 0;
    const details = [];
    items.forEach(item => {
      const matches = priceDB.filter(p => itemMatchesPrice(item, p));
      const byStore = {};
      matches.forEach(p => { if (!byStore[p.storeId] || p.price < byStore[p.storeId].price) byStore[p.storeId] = p; });
      const opts = Object.values(byStore).sort((a,b) => a.price - b.price);
      if (opts.length >= 2) {
        const saving = (opts[opts.length-1].price - opts[0].price) * item.qty;
        totalSaving += saving;
        details.push({ item, opts, saving, best: STORES.find(s => s.id === opts[0].storeId), worst: STORES.find(s => s.id === opts[opts.length-1].storeId) });
      }
    });
    const arc = {
      id: Date.now(),
      date: new Date().toISOString(),
      store,
      total: store.total,
      items: [...items],
      potential_saving: Math.round((potentialSaving || 0) * 100) / 100,
      realized_saving: null,
      ticket_scanned: false,
    };
    saveArchives([...archives, arc]);

    // Chantier « Courses » Lot 1 (shadow estFrancois) — l'archive vient d'être
    // créée À L'IDENTIQUE (cagnotte et scan de ticket inchangés) ; pour
    // François, la validation ouvre directement l'écran de courses : le caddie
    // est CONSERVÉ jusqu'à la clôture (Lot 6), l'écran succès et l'Historique
    // sont sautés. En cas d'échec de création de session, repli complet sur le
    // flux standard ci-dessous — jamais de perte silencieuse. Pour tout autre
    // utilisateur, extrasCourses est null : comportement strictement identique
    // à avant.
    if (extrasCourses) {
      try {
        await demarrerSessionCourses(store, extrasCourses);
      } catch (e) {
        // Incident 2026-08-11 — plus JAMAIS de repli vers le flux standard
        // ici : il viderait le caddie (c'est exactement ce qui s'est produit
        // quand crypto.randomUUID manquait en contexte non sécurisé). Échec de
        // démarrage => caddie INTACT, message clair, on reste sur le
        // comparateur. L'archive créée ci-dessus est conservée (même situation
        // qu'un comparatif validé jamais scanné).
        console.error("Création de la session de courses échouée :", e);
        showAppToast("⚠️ Impossible de démarrer les courses — ta liste est intacte, réessaie.", false);
      }
      return;
    }

    setItems([]);
    try {
      await supabase.from('liste_courses').delete().eq('utilisateur_id', session?.user?.id);
    } catch(e) {
      console.error("Erreur vidage liste :", e);
    }
    setShowSuccess({ store, potentials: { totalSaving, details } });
    setTimeout(()=>{setShowSuccess(null);setTab("archive");},2800);
  };

  const inviteByPseudo = async (pseudoInput) => {
    const trimmed = pseudoInput.trim();
    if (!trimmed) return { error: "Saisis un pseudo" };

    const { data: found } = await supabase
      .from('profiles').select('id, pseudo')
      .ilike('pseudo', trimmed)
      .neq('id', session.user.id)
      .maybeSingle();

    if (!found) return { error: "Aucun utilisateur avec ce pseudo" };

    const existing = circles.find(c =>
      (c.requester_id === session.user.id && c.recipient_id === found.id) ||
      (c.recipient_id === session.user.id && c.requester_id === found.id)
    );
    if (existing && existing.status !== 'revoked' && existing.status !== 'declined') {
      return { error: "Invitation déjà envoyée ou cercle déjà actif" };
    }

    const { data, error } = await supabase.from('circles').insert({
      requester_id: session.user.id,
      recipient_id: found.id,
      requester_email: session.user.email,
    }).select().single();

    if (error) return { error: error.message };
    setCircles(prev => [...prev, data]);
    setProfileMap(prev => ({ ...prev, [found.id]: found.pseudo }));
    return {};
  };

  const updateCircleStatus = async (id, status) => {
    const { error } = await supabase.from('circles').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (!error) {
      if (status === 'revoked') {
        setCircles(prev => prev.filter(c => c.id !== id));
      } else {
        // Recharge depuis Supabase pour récupérer recipient_id mis à jour par le trigger
        const { data } = await supabase.from('circles').select('*');
        if (data) setCircles(data);
        else setCircles(prev => prev.map(c => c.id === id ? { ...c, status } : c));
      }
    }
  };

  const savePseudo = async (value) => {
    const { data: taken } = await supabase
      .from('profiles').select('id')
      .ilike('pseudo', value)
      .neq('id', session.user.id)
      .maybeSingle();
    if (taken) return { error: "Ce pseudo est déjà pris, choisis-en un autre" };
    const { error } = await supabase.from('profiles').upsert({ id: session.user.id, pseudo: value });
    if (error) return { error: error.message };
    setPseudo(value);
    return {};
  };

  const handleCguAccept = async () => {
    const now = new Date().toISOString();
    await supabase.from('profiles').upsert({ id: session.user.id, cgu_accepted_at: now });
    setCguAcceptedAt(now);
  };

  const handleImportPrices = async (entries, ecritureCorePromise) => {
    const openArchive = [...archives].reverse().find(a => !a.ticket_scanned);
    let realizedSaving = null;
    if (openArchive) {
      if (coreActifGlobal) {
        // #56.6 — même principe que importPrices (PricesTab) : un seul appel
        // Core déjà lancé par confirm(), attendu ici, puis realized_saving
        // scopé à ce ticket via #56.5.B, jamais tout l'historique.
        // Chantier 96 — même honnêteté que PricesTab : pas de ticket Core
        // réellement créé => pas de marquage, pas de realized_saving sur un
        // vieux ticket.
        const resultatCoreEcriture = await ecritureCorePromise;
        if (!doitRattacherTicketSession(resultatCoreEcriture)) {
          showAppToast("⚠️ Ticket non enregistré (lecture ou magasin non résolus) — l'archive reste à scanner.", false);
          realizedSaving = null; // sentinelle : pas de marquage plus bas
        } else {
          const resultatCore = await calculerRealizedSavingTicket({ utilisateurId: session?.user?.id });
          realizedSaving = resultatCore.total;
        }
      } else {
        realizedSaving = 0;
        entries.forEach(e => {
          const archiveItem = openArchive.items.find(item =>
            normName(item.product) === normName(e.product) &&
            normFormat(item.format || '') === normFormat(e.format || '')
          );
          if (!archiveItem) return;
          const qty = archiveItem.qty || 1;
          const eKey = `${normName(e.brand||'')}_${normName(e.product)}_${normFormat(e.format||'')}`;
          const cutoffMoy = Date.now() - JOURS_MOYENNE * 86400000;
          const alts = priceDB.filter(p => {
            const pKey = `${normName(p.brand||'')}_${normName(p.product)}_${normFormat(p.format||'')}`;
            return pKey === eKey && p.storeId !== e.storeId && new Date(p.date).getTime() >= cutoffMoy;
          });
          if (alts.length > 0) {
            const avgMarket = alts.reduce((s, p) => s + p.price, 0) / alts.length;
            realizedSaving += (avgMarket - e.price) * qty;
          }
        });
        realizedSaving = Math.round(realizedSaving * 100) / 100;
      }
      // Chantier 96 — marquage uniquement si l'ingestion a réellement abouti
      // (voir importPrices, même règle).
      if (realizedSaving !== null) {
        updateArchive(openArchive.id, { ticket_scanned: true, realized_saving: realizedSaving });
        setShowRating({ id: openArchive.id, store: openArchive.store });
      }
    } else {
      const storeId = entries[0]?.storeId || "autre";
      const storeInfo = STORES.find(s => s.id === storeId) || { id:"autre", name: entries[0]?.store_name || "Autre", logo:"🏪" };
      const total = Math.round(entries.reduce((s,e) => s + (e.price||0) * (e.qty||1), 0) * 100) / 100;
      const newArc = {
        date:    entries[0]?.date || new Date().toISOString(),
        store:   storeInfo,
        total,
        items:   entries.map(e => ({ id: Date.now()+Math.random(), product: e.product, format: e.format||"", brand: e.brand||"", qty: e.qty||1, unit_price: e.unit_price||null, price: e.price||null, total: e.total||null, checked: false })),
        potential_saving: 0,
        realized_saving:  0,
        ticket_scanned:   true,
      };
      (async () => {
        const {id:_id,...rest}=newArc;
        const {data,error}=await supabase.from('archives').insert({...rest,user_id:session?.user?.id}).select('id').single();
        if(error){ console.error("Erreur création archive ticket :",error); showAppToast("⚠️ Archive non sauvegardée, vérifie ta connexion",false); }
        else {
          const {data:all}=await supabase.from('archives').select('*').order('date');
          if(all) setArchives(all);
          setShowRating({id:data.id,store:newArc.store});
        }
      })();
    }
    let updated = [...priceDB];
    entries.forEach(e => { updated = [...updated.filter(p => priceKey(p) !== priceKey(e)), e]; });
    savePriceDB(updated);
    if (session?.user?.id) {
      const communityEntries = entries.map(e => ({
        user_id:       session.user.id,
        product:       e.product,
        brand:         e.brand || '',
        format:        e.format || '',
        category:      guessCategory(e.product),
        price:         e.price,
        date:          e.date,
        store_name:    e.store_name || '',
        store_address: e.store_address || '',
        store_id:      e.store_id || null,
        is_private:    e.share === false,
      }));
      supabase.from('community_prices').insert(communityEntries)
        .then(({ error }) => { if (error) { console.error("Erreur community_prices :",error); showAppToast("⚠️ Partage communauté échoué",false); } });
    }
    const savingMsg = realizedSaving !== null
      ? ` · Économies : ${realizedSaving >= 0 ? '+' : ''}${realizedSaving.toFixed(2)} €`
      : '';
    showAppToast(`✓ ${entries.length} prix importé${entries.length > 1 ? "s" : ""}${savingMsg}`);
  };

  const handleSavePrice = entry => {
    const updated=[...priceDB.filter(p=>priceKey(p)!==priceKey(entry)),{...entry,id:Date.now()}];
    savePriceDB(updated);
    showAppToast("✓ Prix enregistré");
  };

  const handleLogout = async () => { await supabase.auth.signOut(); };

  const globalStyle = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{background:#F8F8F8;} ::selection{background:#CC0000;color:white;}
      @keyframes slideIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
      @keyframes fadeIn {from{opacity:0}to{opacity:1}}
      @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
      @keyframes spin   {to{transform:rotate(360deg)}}
      @keyframes popIn  {0%{opacity:0;transform:scale(0.85)}60%{transform:scale(1.04)}100%{opacity:1;transform:scale(1)}}
      @keyframes tabNeonPulse {0%,100%{box-shadow:0 4px 12px rgba(0,0,0,0.15), 0 0 10px 2px var(--tab-glow)}50%{box-shadow:0 4px 12px rgba(0,0,0,0.15), 0 0 32px 8px var(--tab-glow), 0 0 14px 3px var(--tab-glow)}}
      @keyframes microPulse {0%,100%{box-shadow:0 8px 36px rgba(229,24,27,0.55), 0 0 0 0 rgba(229,24,27,0.35)}50%{box-shadow:0 8px 36px rgba(229,24,27,0.55), 0 0 0 22px rgba(229,24,27,0)}}
      .tabCircleBtn:active{transform:scale(0.9) !important;transition:transform 0.1s ease !important;}
      .tabBarRoot,.tabBarRoot *{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:manipulation;}
      input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
      textarea:focus,input:focus{outline:none;}
    `}</style>
  );

  if (!authReady) return (
    <>{globalStyle}
      <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <div style={{ width:40, height:40, border:"4px solid #EFEFEF", borderTopColor:"#CC0000", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
      </div>
    </>
  );

  if (!session) return <>{globalStyle}<AuthScreen/></>;

  if (loaded && cguAcceptedAt === null) return (
    <>{globalStyle}<CguRattrapageScreen onAccept={handleCguAccept}/></>
  );

  return (
    <>
      {globalStyle}
      {/* #65 — bandeau non bloquant, jamais au-dessus de la TabBar (bottom)
          ni du bouton Flasher (centre HomeTab) : ancré en haut du viewport. */}
      {needRefresh && (
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:600, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"10px 16px", background:C.blue, boxShadow:"0 2px 10px rgba(0,0,0,0.25)" }}>
          <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#fff" }}>🔄 Nouvelle version disponible</span>
          <button onClick={() => applyUpdate()} style={{ padding:"6px 14px", borderRadius:20, border:"none", background:"#fff", color:C.blue, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:12, cursor:"pointer", flexShrink:0 }}>
            Mettre à jour
          </button>
        </div>
      )}
      <div style={{ minHeight:"100vh", background:C.bg, maxWidth:430, margin:"0 auto" }}>
        {tab !== "home" && (
          <Header tab={tab} itemCount={items.length} userEmail={session.user.email} displayName={pseudo} onLogout={handleLogout}
            pendingCount={circles.filter(c=>(c.recipient_id===session.user.id||c.recipient_email?.toLowerCase()===session.user.email?.toLowerCase())&&c.status==='pending').length}
            onCircle={()=>setShowCircleSheet(true)}/>
        )}
        <div style={{ paddingTop: tab === "home" ? 0 : 4 }}>
          {!loaded && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:200, gap:16 }}>
              {loadError ? (
                <>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, color:"#CC0000", textAlign:"center", padding:"0 24px" }}>{loadError}</div>
                  <button onClick={() => setLoadRetry(r => r + 1)} style={{ padding:"10px 24px", background:"#CC0000", color:"#fff", border:"none", borderRadius:8, fontFamily:"'Nunito',sans-serif", fontSize:14, cursor:"pointer" }}>Réessayer</button>
                </>
              ) : (
                <>
                  <div style={{ width:40, height:40, border:"4px solid #EFEFEF", borderTopColor:"#CC0000", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, color:"#999" }}>Chargement...</div>
                </>
              )}
            </div>
          )}
          <TabErrorBoundary key={tab}>
          {loaded && tab==="home"      && <HomeTab      items={items} circles={circles} profileMap={profileMap} userId={session?.user?.id} setTab={setTab} onCircle={()=>setShowCircleSheet(true)} onFlash={handleFlash} onResumeScan={handleResumeScan} archives={archives} pseudo={pseudo} onStats={()=>setShowStatsSheet(true)} onMesPrix={()=>setShowMesPrixSheet(true)} onFavoris={()=>setShowFavorisSheet(true)} onProfil={profilVisible ? ()=>setShowProfilSheet(true) : null} onFaq={()=>setShowFaqSheet(true)} onSignOut={handleLogout} pendingCagnotte={pendingCagnotte} onConsumeCagnotteCelebration={()=>setPendingCagnotte(null)} pendingPotential={pendingPotential} onConsumePotentialCelebration={()=>setPendingPotential(null)} estFrancois={estFrancois} sessionCourses={sessionCoursesAccessible ? sessionCoursesActive : null} onReprendreCourses={()=>setTab("courses")} onAbandonnerCourses={abandonnerSessionCourses}/>}
          {/* Chantier « Micro » Lot 1 — même mécanique shadow que rejets (#56.3b) :
              jamais rendu pour un autre utilisateur, même si tab="micro" traîne en state.
              Lot 5 : onAdd = le addItem OFFICIEL du caddie (même chemin que le Catalogue). */}
          {loaded && estFrancois && tab==="micro" && <MicroTab onAdd={addItem} setTab={setTab}/>}
          {/* Chantier « Courses » Lot 1 (shadow estFrancois) — écran de courses,
              accessible uniquement via la validation du comparatif (aucun
              onglet TabBar). Session absente -> rien n'est rendu. */}
          {/* Chantier 87 Lot 1 — jamais rendu sans accès (flag OU François),
              même si tab="courses" traîne en state. */}
          {loaded && tab==="courses" && sessionCoursesAccessible && sessionCoursesActive && <CoursesTab session={sessionCoursesActive} onChangerEtat={changerEtatArticleSession} onAjouterNote={ajouterNoteCourses} onSupprimerNote={supprimerNoteCourses} onTerminer={demanderTerminerCourses} onPasserEnCaisse={()=>setCaisseCourses(true)} syncEchec={syncCoursesEchec}/>}
          {loaded && tab==="list"      && <ListTab      items={items} onAdd={addItem} onUpdate={updateItem} onToggle={toggleCheck} onRemove={removeItem} setTab={setTab} favorites={favorites} saveFavorites={saveFavorites} onSetMarquePref={setMarquePrefItem} itemsReportes={itemsReportes} onReactiverReporte={reactiverReporte} onSupprimerReporte={supprimerReporte}/>}
          {loaded && tab==="catalog"   && <CatalogTab   items={items} onAdd={addItem} onUpdate={updateItem} onRemove={removeItem} setTab={setTab}/>}
          {loaded && tab==="compare"   && <CompareTab   items={items} priceDB={priceDB} onValidate={handleValidate} setTab={setTab} searchRadius={searchRadius} setSearchRadius={setSearchRadius} userPos={userPos} setUserPos={setUserPos} zoneLabel={zoneLabel} setZoneLabel={setZoneLabel} zonePrete={zonePrete} userId={session?.user?.id} isAdmin={isAdmin} modeCoreActif={modeCoreActif} coreActifGlobal={coreActifGlobal} categorieMagasin={categorieMagasin} setCategorieMagasin={setCategorieChoix} sessionCoursesAccessible={sessionCoursesAccessible}/>}
          {loaded && tab==="compare"   && import.meta.env.DEV && <ShadowCompareDiagnostic items={items} priceDB={priceDB} searchRadius={searchRadius} userPos={userPos}/>}
          {loaded && tab==="prices"    && <PricesTab    priceDB={priceDB} setPriceDB={savePriceDB} archives={archives} updateArchive={updateArchive} coreActifGlobal={coreActifGlobal} estFrancois={estFrancois} userId={session?.user?.id} autoOpenCamera={autoOpenCamera} onAutoOpenConsumed={()=>setAutoOpenCamera(false)} autoResumeScan={autoResumeScan} onAutoResumeConsumed={()=>setAutoResumeScan(false)} initialScanResult={autoImportResult} onInitialScanConsumed={()=>setAutoImportResult(null)} magasinSession={scanCaisse?.magasin ?? null} onImportSession={rattacherTicketScanSession} onScanSessionFerme={()=>definirScanCaisse(null)} onVoirTicketExistant={()=>setTab("archive")} notifierPoints={profilVisible} onTicketValidated={(id,store)=>setShowRating({id,store})} onCreateArchive={async newArc=>{
            const {id:_id,...rest}=newArc;
            const {data,error}=await supabase.from('archives').insert({...rest,user_id:session?.user?.id}).select('id').single();
            if(error){ console.error("Erreur création archive ticket :",error); showAppToast("⚠️ Archive non sauvegardée, vérifie ta connexion",false); }
            else {
              const {data:all}=await supabase.from('archives').select('*').order('date');
              if(all) setArchives(all);
              setShowRating({id:data.id,store:newArc.store});
            }
          }} userId={session?.user?.id} produitsRef={produitsRef}/>}
          {loaded && tab==="archive"   && <ArchiveTab   archives={archives} storeRatings={storeRatings} onDelete={deleteArchive} priceDB={priceDB} onImport={handleImportPrices} onSavePrice={handleSavePrice} produitsRef={produitsRef} libelleVersNomProduit={libelleVersNomProduit} onLibelleResolu={(cle,nom)=>setLibelleVersNomProduit(prev=>({...prev,[cle]:nom}))} estFrancois={estFrancois} onAddToList={arcItem=>{
            const newItem={id:Date.now()+Math.random(),product:arcItem.product,format:arcItem.format||"",brand:arcItem.brand||"",qty:arcItem.qty||1,checked:false};
            addItem(newItem);
            showAppToast(`✓ ${arcItem.product} ajouté à ta liste`);
          }}/>}
          {loaded && tab==="economies" && <EconomiesTab priceDB={priceDB} archives={archives} items={items} setTab={setTab}/>}
          {/* #56.3b — jamais rendu pour un non-admin, même si tab="rejets" traîne en state */}
          {loaded && isAdmin && tab==="rejets" && <AdminRejetsCorePanel modeCoreActif={modeCoreActif} onToggleModeCore={setModeCoreActif} coreActifGlobal={coreActifGlobal}/>}
          </TabErrorBoundary>
        </div>
        <TabBar tab={tab} setTab={setTab} isAdmin={isAdmin}/>
        {/* #64.1 — dev uniquement, jamais en prod, jamais sur l'Accueil : reproduit
            le vrai parcours (simulation hors Accueil → retour Accueil → célébration) */}
        {import.meta.env.DEV && tab !== "home" && (
          <div style={{ position:"fixed", bottom:90, right:12, zIndex:500, display:"flex", flexDirection:"column", gap:6 }}>
            <button onClick={simulerCagnotteDev} style={{ padding:"8px 12px", borderRadius:10, border:"none", background:"#00B341", color:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:11, cursor:"pointer", boxShadow:"0 3px 10px rgba(0,0,0,0.25)" }}>
              🎉 Simuler économie confirmée
            </button>
            <button onClick={simulerPotentialDev} style={{ padding:"8px 12px", borderRadius:10, border:"none", background:"#4A90D9", color:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:11, cursor:"pointer", boxShadow:"0 3px 10px rgba(0,0,0,0.25)" }}>
              💰 Simuler économie estimée
            </button>
          </div>
        )}
        {/* Chantier #73 + "Scan code-barres" 3B — accès discrets réservés admin
            (isAdmin via la RPC est_administrateur() / app_metadata.role==='admin'),
            jamais dans la TabBar, invisibles pour tout autre utilisateur en prod.
            Chantier Micro Lot 6 : REPLIÉS derrière une pastille 🛠️ unique — les
            deux gros boutons chevauchaient les titres d'écran (Micro, Ma liste…).
            Le badge pendingScanCount reste visible sur la pastille repliée. */}
        {isAdmin && (
          <div style={{ position:"fixed", top:10, left:10, zIndex:500, display:"flex", flexDirection:"column", gap:6, alignItems:"flex-start" }}>
            <button onClick={()=>setAdminOutilsOuverts(o=>!o)} aria-label="Outils admin"
              style={{ width:32, height:32, borderRadius:99, border:"none", background:"rgba(0,0,0,0.55)", color:"#fff", fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", position:"relative", padding:0 }}>
              {adminOutilsOuverts ? "✕" : "🛠️"}
              {pendingScanCount > 0 && !adminOutilsOuverts && (
                <span style={{ position:"absolute", top:-4, right:-4, background:"#CC0000", borderRadius:99, minWidth:15, height:15, padding:"0 3px", fontSize:9, fontWeight:900, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>{pendingScanCount}</span>
              )}
            </button>
            {adminOutilsOuverts && (
              <>
                <button onClick={()=>{ setShowAValider(true); setAdminOutilsOuverts(false); }} style={{ padding:"6px 10px", borderRadius:8, border:"none", background:"rgba(0,0,0,0.55)", color:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:10, cursor:"pointer" }}>
                  🔍 À valider
                </button>
                <button onClick={()=>{ setShowValidationScan(true); setAdminOutilsOuverts(false); }} style={{ padding:"6px 10px", borderRadius:8, border:"none", background:"rgba(0,0,0,0.55)", color:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:10, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                  🧾 Validation scan
                  {pendingScanCount > 0 && (
                    <span style={{ background:"#CC0000", borderRadius:99, minWidth:16, height:16, padding:"0 4px", fontSize:10, fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>{pendingScanCount}</span>
                  )}
                </button>
              </>
            )}
          </div>
        )}
        {showAValider && isAdmin && <AValiderSheet onClose={()=>setShowAValider(false)}/>}
        {showValidationScan && isAdmin && <ValidationScanSheet onClose={()=>setShowValidationScan(false)} onCountChange={setPendingScanCount}/>}
        {appToast && <Toast msg={appToast.msg} ok={appToast.ok}/>}
        {showCircleSheet  && <CircleSheet  circles={circles} userId={session.user.id} userEmail={session.user.email} profileMap={profileMap} pseudo={pseudo} archives={archives} onClose={()=>setShowCircleSheet(false)} onInvite={inviteByPseudo} onUpdateStatus={updateCircleStatus}/>}
        {showStatsSheet   && <StatsSheet   userId={session.user.id} archives={archives} onClose={()=>setShowStatsSheet(false)}/>}
        {showFavorisSheet && <FavorisSheet userId={session?.user?.id} onClose={()=>setShowFavorisSheet(false)}/>}
        {showProfilSheet && profilVisible && <ProfilSheet userId={session?.user?.id} pseudo={pseudo} onBadgesVus={memoriserBadgesVus} onClose={()=>setShowProfilSheet(false)}/>}
        {/* Chantier 94 — célébration COURTE d'un nouveau badge (popIn existant,
            aucune animation longue), fermable d'un tap, jamais bloquante. */}
        {nouveauBadge && profilVisible && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9998, padding:24 }} onClick={()=>setNouveauBadge(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:18, padding:"26px 20px", maxWidth:320, width:"100%", textAlign:"center", animation:"popIn 0.35s ease", boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
              <div style={{ fontSize:52, marginBottom:8 }}>{nouveauBadge.icone}</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:"#1a1a1a", marginBottom:4 }}>Nouveau badge !</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#CC0000", marginBottom:12 }}>
                {nouveauBadge.nom}{nouveauBadge.reste > 0 ? ` (+${nouveauBadge.reste} autre${nouveauBadge.reste > 1 ? "s" : ""})` : ""}
              </div>
              <button onClick={()=>{ setNouveauBadge(null); setShowProfilSheet(true); }}
                style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:"#CC0000", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                Voir mon profil
              </button>
              <button onClick={()=>setNouveauBadge(null)}
                style={{ width:"100%", padding:"11px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#333", cursor:"pointer" }}>
                Fermer
              </button>
            </div>
          </div>
        )}
        {showFaqSheet     && <FaqSheet     userId={session.user.id} pseudo={pseudo} onClose={()=>setShowFaqSheet(false)}/>}
        {showMesPrixSheet && <MesPrixSheet priceDB={priceDB} setPriceDB={savePriceDB} archives={archives} updateArchive={updateArchive} coreActifGlobal={coreActifGlobal} onTicketValidated={(id,store)=>setShowRating({id,store})} onCreateArchive={async newArc=>{ const {id:_id,...rest}=newArc; const {data,error}=await supabase.from('archives').insert({...rest,user_id:session?.user?.id}).select('id').single(); if(error){ showAppToast("⚠️ Archive non sauvegardée, vérifie ta connexion",false); } else { const {data:all}=await supabase.from('archives').select('*').order('date'); if(all) setArchives(all); setShowRating({id:data.id,store:newArc.store}); } }} userId={session?.user?.id} produitsRef={produitsRef} onClose={()=>setShowMesPrixSheet(false)}/>}
        {showScanChoix && (
          <ScanChoixSheet
            onClose={() => setShowScanChoix(false)}
            onUnePhoto={handleFlashConfirmed}
            onPlusieursPhotos={() => { setShowScanChoix(false); setShowMultiPhoto(true); }}
            onAutresOptions={() => { setShowScanChoix(false); setShowAutresOptions(true); }}
          />
        )}
        {showMultiPhoto && (
          <MultiPhotoSheet
            onClose={() => setShowMultiPhoto(false)}
            refProducts={produitsRef.map(p => ({ nom: p.produit_generique, categorie: p.sous_categorie }))}
            onSuccess={(result) => { setShowMultiPhoto(false); setAutoImportResult(result); setTab("prices"); }}
          />
        )}
        {showAutresOptions && (
          <AutresOptionsSheet
            onClose={() => setShowAutresOptions(false)}
            onBack={() => { setShowAutresOptions(false); setShowScanChoix(true); }}
            onGalleryImport={() => { setShowAutresOptions(false); setShowGalleryImportFromScan(true); }}
            onManualEntry={() => { setShowAutresOptions(false); setShowManualEntryFromScan(true); }}
          />
        )}
        {showManualEntryFromScan && (
          <PriceEntrySheet
            onClose={() => setShowManualEntryFromScan(false)}
            onSave={handleSavePrice}
          />
        )}
        {showGalleryImportFromScan && (
          <ImportTicketSheet
            onClose={() => setShowGalleryImportFromScan(false)}
            onImport={handleImportPrices}
            refProducts={produitsRef.map(p => ({ nom: p.produit_generique, categorie: p.sous_categorie }))}
            autoOpenGallery
            estFrancois={estFrancois}
          />
        )}
        {loaded && pseudo === null && <PseudoModal onSave={savePseudo}/>}
        {showRating && (
          <StoreRatingScreen
            store={showRating.store}
            onSave={async rating=>{ const {error}=await updateArchive(showRating.id,{store_rating:rating}); if(error) showAppToast("⚠️ Note non sauvegardée, vérifie ta connexion",false); else fetchStoreRatings(); setShowRating(null); setTab("home"); }}
            onSkip={()=>{ setShowRating(null); setTab("home"); }}
          />
        )}
        {/* Lot 3 (shadow estFrancois) — validation demandée alors que des
            courses sont déjà en cours : reprendre (ne crée RIEN) ou remplacer
            (relance la validation complète avec forcerRemplacement). */}
        {confirmCoursesExistantes && sessionCoursesActive && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }} onClick={()=>setConfirmCoursesExistantes(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:6 }}>Des courses sont déjà en cours 🛒</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#888", marginBottom:16 }}>
                Chez <strong>{sessionCoursesActive.magasin?.nom}</strong> — {calculerProgression(sessionCoursesActive.articles).pris} article{calculerProgression(sessionCoursesActive.articles).pris > 1 ? "s" : ""} sur {calculerProgression(sessionCoursesActive.articles).total} déjà dans le caddie. Remplacer effacera cette progression.
              </div>
              <button onClick={()=>{ setConfirmCoursesExistantes(null); setTab("courses"); }}
                style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:C.green, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                ▶️ Reprendre mes courses
              </button>
              <button onClick={()=>{ const p = confirmCoursesExistantes; setConfirmCoursesExistantes(null); handleValidate(p.store, p.potentialSaving, p.extrasCourses, true); }}
                style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:"#CC0000", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                🔄 Remplacer par cette nouvelle liste
              </button>
              <button onClick={()=>setConfirmCoursesExistantes(null)}
                style={{ width:"100%", padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#333", cursor:"pointer" }}>
                Annuler
              </button>
            </div>
          </div>
        )}
        {/* Lot 6 (shadow estFrancois) — étape 1 : il reste des articles à
            prendre, jamais de clôture silencieuse. */}
        {clotureCourses === 'confirmation' && sessionCoursesActive && (() => {
          const prog = calculerProgression(sessionCoursesActive.articles);
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }} onClick={()=>setClotureCourses(null)}>
              <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%" }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:6 }}>
                  Il reste {prog.restants} article{prog.restants > 1 ? "s" : ""} à prendre
                </div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#888", marginBottom:16 }}>
                  Veux-tu quand même terminer tes courses ?
                </div>
                <button onClick={()=>setClotureCourses('choixCaddie')}
                  style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:"#CC0000", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                  Terminer quand même
                </button>
                <button onClick={()=>setClotureCourses(null)}
                  style={{ width:"100%", padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#333", cursor:"pointer" }}>
                  Continuer mes courses
                </button>
              </div>
            </div>
          );
        })()}

        {/* Lot 6 — étape 2 : récap + sort du caddie « Ma liste » (arbitrage
            Q6 : proposer, jamais de vidage automatique). Chaque bouton clôt
            la session ; « Annuler » ramène aux courses sans rien clore. */}
        {clotureCourses === 'choixCaddie' && sessionCoursesActive && (() => {
          const prog = calculerProgression(sessionCoursesActive.articles);
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }} onClick={()=>setClotureCourses(null)}>
              <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%" }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:"#1a1a1a", marginBottom:6 }}>🎉 Terminer mes courses</div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#555", marginBottom:4 }}>
                  {prog.pris} article{prog.pris > 1 ? "s" : ""} dans le caddie
                  {prog.introuvables > 0 ? ` · ${prog.introuvables} introuvable${prog.introuvables > 1 ? "s" : ""}` : ""}
                  {prog.restants > 0 ? ` · ${prog.restants} non pris` : ""}
                  {sessionCoursesActive.total_prevu != null ? ` · total prévu ${Number(sessionCoursesActive.total_prevu).toFixed(2)} €` : ""}
                </div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#888", marginBottom:16 }}>
                  Que fait-on de ton caddie « Ma liste » ?
                </div>
                <button onClick={()=>choisirActionCaddie('vider')}
                  style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:C.green, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                  🧹 Vider le caddie
                </button>
                {prog.introuvables > 0 && (
                  <button onClick={()=>choisirActionCaddie('garder_introuvables')}
                    style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#111", cursor:"pointer", marginBottom:8 }}>
                    🚫 Garder seulement les introuvables ({prog.introuvables})
                  </button>
                )}
                <button onClick={()=>choisirActionCaddie('garder')}
                  style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:"#4A90D9", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                  🛒 Garder le caddie tel quel
                </button>
                <button onClick={()=>setClotureCourses(null)}
                  style={{ width:"100%", padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#333", cursor:"pointer" }}>
                  Annuler
                </button>
              </div>
            </div>
          );
        })()}

        {/* Chantier 88 Lot 2 — étape 3 : des articles prévus mais non achetés
            allaient être supprimés par le vidage choisi. Un seul dialogue,
            jamais bloquant : « Garder pour plus tard » (défaut), « Tout
            supprimer » (comportement d'avant), ou « Choisir » article par
            article (coché = gardé). Annuler ramène au choix du caddie —
            rien n'est clos tant qu'un des trois choix n'est pas fait. */}
        {plusTardCourses && sessionCoursesActive && (() => {
          const { actionCaddie, articles, mode, selection } = plusTardCourses;
          const nbChoisis = articles.filter(a => selection[a.cle]).length;
          const F2 = "'Nunito',sans-serif";
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }}>
              <div style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%", maxHeight:"80vh", overflowY:"auto" }}>
                <div style={{ fontFamily:F2, fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:6 }}>
                  ⏳ {articles.length} article{articles.length > 1 ? "s" : ""} non acheté{articles.length > 1 ? "s" : ""}
                </div>
                <div style={{ fontFamily:F2, fontSize:13, color:"#888", marginBottom:16 }}>
                  Tu ne les as pas pris cette fois. Veux-tu les garder pour tes prochaines courses ?
                </div>
                {mode === 'simple' && (
                  <>
                    <button onClick={()=>executerClotureCourses(actionCaddie, { reporteIds: articles.map(a => a.cle) })}
                      style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:C.green, fontFamily:F2, fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                      ⏳ Garder pour plus tard
                    </button>
                    <button onClick={()=>executerClotureCourses(actionCaddie, { reporteIds: [] })}
                      style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:"#fff", fontFamily:F2, fontWeight:800, fontSize:14, color:"#CC0000", cursor:"pointer", marginBottom:8, borderStyle:"solid", borderWidth:1.5, borderColor:"rgba(204,0,0,0.3)" }}>
                      🧹 Tout supprimer
                    </button>
                    <button onClick={()=>setPlusTardCourses({ ...plusTardCourses, mode:'choisir' })}
                      style={{ width:"100%", padding:"13px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:F2, fontWeight:800, fontSize:14, color:"#333", cursor:"pointer", marginBottom:8 }}>
                      ☑️ Choisir…
                    </button>
                  </>
                )}
                {mode === 'choisir' && (
                  <>
                    <div style={{ fontFamily:F2, fontSize:12, color:"#888", marginBottom:8 }}>
                      Coche les articles à garder — les autres seront supprimés.
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
                      {articles.map(a => {
                        const coche = !!selection[a.cle];
                        return (
                          <button key={a.cle}
                            onClick={()=>setPlusTardCourses(prev => prev ? { ...prev, selection: { ...prev.selection, [a.cle]: !prev.selection[a.cle] } } : prev)}
                            style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:`1.5px solid ${coche ? C.green : "#eee"}`, background: coche ? "#F3FAF5" : "#fff", cursor:"pointer" }}>
                            <span style={{ width:22, height:22, borderRadius:6, border:`2px solid ${coche ? C.green : "#bbb"}`, background: coche ? C.green : "#fff", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0 }}>
                              {coche ? "✓" : ""}
                            </span>
                            <span style={{ fontFamily:F2, fontWeight:800, fontSize:13, color:"#1a1a1a", flex:1, minWidth:0 }}>
                              {a.nom_affiche ?? a.nom_reference ?? "Article"}{Number(a.quantite) > 1 ? ` ×${Number(a.quantite)}` : ""}
                            </span>
                            {a.etat === 'introuvable' && <span style={{ fontFamily:F2, fontSize:11, fontWeight:800, color:"#7A6000" }}>🚫</span>}
                          </button>
                        );
                      })}
                    </div>
                    <button onClick={()=>executerClotureCourses(actionCaddie, { reporteIds: articles.filter(a => selection[a.cle]).map(a => a.cle) })}
                      style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:C.green, fontFamily:F2, fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                      Valider ({nbChoisis} gardé{nbChoisis > 1 ? "s" : ""})
                    </button>
                  </>
                )}
                <button onClick={()=>{ setPlusTardCourses(null); setClotureCourses('choixCaddie'); }}
                  style={{ width:"100%", padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:F2, fontWeight:800, fontSize:14, color:"#333", cursor:"pointer" }}>
                  Annuler
                </button>
              </div>
            </div>
          );
        })()}

        {/* Chantier 95 Lot 11 — carte discrète de sollicitation après un
            cochage : jamais bloquante (le cochage est déjà fait), une seule
            par produit et par session. Au-dessus du snackbar Lot 7. */}
        {tab === "courses" && sollicitationPrix && sessionCoursesActive && (
          <div style={{ position:"fixed", bottom:150, left:"50%", transform:"translateX(-50%)", width:"calc(100% - 32px)", maxWidth:398, background:"#fff", border:"1.5px solid #F0DFA8", borderRadius:14, padding:"12px 14px", zIndex:60, boxShadow:"0 6px 20px rgba(0,0,0,0.18)", animation:"slideIn 0.25s ease" }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:"#7A6000", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:3 }}>💡 Aide PrixMalin</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#1a1a1a", marginBottom:10 }}>
              Relève le prix de {sollicitationPrix.nom} ici ?
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>ouvrirSaisieSollicitation(sollicitationPrix.cle, 'carte')}
                style={{ flex:1, padding:"10px", border:"none", borderRadius:10, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:"#111", cursor:"pointer" }}>
                Relever
              </button>
              <button onClick={()=>deciderSollicitationPrix(sollicitationPrix.cle, 'plus_tard')}
                style={{ flex:1, padding:"10px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#333", cursor:"pointer" }}>
                Plus tard
              </button>
              <button onClick={()=>deciderSollicitationPrix(sollicitationPrix.cle, 'ignoree')}
                style={{ padding:"10px 12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#999", cursor:"pointer" }}>
                Ignorer
              </button>
            </div>
          </div>
        )}

        {/* Chantier 95 Lot 11 — file « À compléter » : rappel avant la caisse,
            accès aux prix restants (relever / ignorer / continuer). Ne bloque
            JAMAIS le passage en caisse. */}
        {fileACompleterVisible && sessionCoursesActive && (() => {
          const file = fileACompleter(sessionCoursesActive);
          const F7 = "'Nunito',sans-serif";
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:150, padding:24 }} onClick={()=>setFileACompleterVisible(false)}>
              <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%", maxHeight:"80vh", overflowY:"auto" }}>
                <div style={{ fontFamily:F7, fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:6 }}>📋 Prix à relever</div>
                {file.length === 0 ? (
                  <div style={{ fontFamily:F7, fontSize:13, color:"#888", marginBottom:14 }}>Tout est réglé — plus rien à relever. 🎉</div>
                ) : (
                  <>
                    <div style={{ fontFamily:F7, fontSize:13, color:"#888", marginBottom:14 }}>
                      {file.length} prix peu{file.length > 1 ? "vent" : "t"} encore être relevé{file.length > 1 ? "s" : ""} avant de passer en caisse — rien d'obligatoire.
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
                      {file.map(a => (
                        <div key={a.cle} style={{ display:"flex", alignItems:"center", gap:8, border:"1.5px solid #eee", borderRadius:10, padding:"9px 10px" }}>
                          <span style={{ fontFamily:F7, fontWeight:800, fontSize:13, color:"#1a1a1a", flex:1, minWidth:0 }}>
                            {a.nom_affiche ?? a.nom_reference ?? "Article"}
                          </span>
                          <button onClick={()=>ouvrirSaisieSollicitation(a.cle, 'file')}
                            style={{ padding:"8px 12px", border:"none", borderRadius:8, background:C.orange, fontFamily:F7, fontWeight:900, fontSize:12, color:"#111", cursor:"pointer" }}>
                            Relever
                          </button>
                          <button onClick={()=>deciderSollicitationPrix(a.cle, 'ignoree')}
                            style={{ padding:"8px 10px", border:"1.5px solid #eee", borderRadius:8, background:"#fff", fontFamily:F7, fontWeight:800, fontSize:12, color:"#999", cursor:"pointer" }}>
                            Ignorer
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <button onClick={()=>setFileACompleterVisible(false)}
                  style={{ width:"100%", padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:F7, fontWeight:800, fontSize:14, color:"#333", cursor:"pointer" }}>
                  Continuer
                </button>
              </div>
            </div>
          );
        })()}

        {/* Chantier 95 Lot 11 — saisie de prix EXISTANTE, préremplie, magasin
            de la session verrouillé (jamais redemandé). L'écriture Core est
            faite dans le sheet ; un échec réseau n'altère ni la session ni le
            cochage (best effort de bout en bout). */}
        {sollicitationSaisie && sessionCoursesActive && (
          <PriceEntrySheet
            onClose={()=>{ const orig = sollicitationSaisie?.origine; setSollicitationSaisie(null); if (orig === 'file') setFileACompleterVisible(true); }}
            onSave={enregistrerPrixSollicitation}
            prefill={{
              product: sollicitationSaisie.article.nom_reference || sollicitationSaisie.article.nom_affiche || "",
              brand: sollicitationSaisie.article.nom_marque || "",
            }}
            magasinVerrouille={{
              nom: sessionCoursesActive.magasin?.nom ?? "Magasin",
              enseigne: sessionCoursesActive.magasin?.enseigne ?? null,
              storeLegacyId: null,
              adresse: [sessionCoursesActive.magasin?.adresse, [sessionCoursesActive.magasin?.code_postal, sessionCoursesActive.magasin?.ville].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
            }}
          />
        )}

        {/* Chantier 90 Lot 4 — confirmation du magasin avant le scan « Je
            passe en caisse » : le magasin de la session est proposé par
            défaut, « Changer de magasin » retombe sur la résolution existante
            du sheet. Annuler ne quitte pas les courses. */}
        {caisseCourses && sessionCoursesActive && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }} onClick={()=>setCaisseCourses(false)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:6 }}>
                🧾 Ticket effectué chez {sessionCoursesActive.magasin?.nom ?? "ce magasin"} ?
              </div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#888", marginBottom:16 }}>
                Le ticket sera rattaché à tes courses en cours.
              </div>
              {/* Chantier 95 Lot 11 — rappel NON bloquant : des prix restent à
                  relever. Le passage en caisse reste possible tel quel. */}
              {(() => { const file = fileACompleter(sessionCoursesActive); return file.length > 0 && (
                <button onClick={()=>{ setCaisseCourses(false); setFileACompleterVisible(true); }}
                  style={{ width:"100%", padding:"12px", border:"1.5px solid #F0DFA8", borderRadius:10, background:"#FFF8E6", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#7A6000", cursor:"pointer", marginBottom:8 }}>
                  📋 {file.length} prix peu{file.length > 1 ? "vent" : "t"} encore être relevé{file.length > 1 ? "s" : ""} — voir la liste
                </button>
              ); })()}
              <button onClick={()=>lancerScanCaisse(sessionCoursesActive.magasin ?? null)}
                style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:C.green, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                ✅ Oui, chez {sessionCoursesActive.magasin?.nom ?? "ce magasin"}
              </button>
              <button onClick={()=>lancerScanCaisse(null)}
                style={{ width:"100%", padding:"13px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#333", cursor:"pointer", marginBottom:8 }}>
                🔁 Changer de magasin
              </button>
              <button onClick={()=>setCaisseCourses(false)}
                style={{ width:"100%", padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:"#333", cursor:"pointer" }}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Chantier 91 Lot 5 — garde-fou ticket illisible : message seulement,
            RIEN n'est classé (jamais « tout non acheté » sur un OCR raté). */}
        {rapprochementCourses?.sansLignes && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }} onClick={()=>setRapprochementCourses(null)}>
            <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:6 }}>🧾 Ticket rattaché, mais illisible</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"#888", marginBottom:16 }}>
                Aucune ligne exploitable n'a été trouvée sur ce ticket. Tes courses restent exactement comme tu les as cochées — rien n'a été classé automatiquement.
              </div>
              <button onClick={()=>setRapprochementCourses(null)}
                style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:"#4A90D9", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer" }}>
                Compris, je garde mes cochages
              </button>
            </div>
          </div>
        )}

        {/* Chantier 91 Lot 5 — récap du rapprochement ticket <-> courses.
            Informative et non bloquante ; la file « à vérifier » s'ouvre
            après fermeture. Lignes non reconnues : compteur + accès aux
            outils de réconciliation existants (Historique), aucun nouvel
            écran. */}
        {rapprochementCourses?.compteurs && (() => {
          const c = rapprochementCourses.compteurs;
          const F4 = "'Nunito',sans-serif";
          const LigneRecap = ({ emoji, texte, fond, bord }) => (
            <div style={{ fontFamily:F4, fontWeight:800, fontSize:14, color:"#333", background:fond, border:`1px solid ${bord}`, borderRadius:10, padding:"9px 12px" }}>
              {emoji} {texte}
            </div>
          );
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }}>
              <div style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%", maxHeight:"80vh", overflowY:"auto" }}>
                <div style={{ fontFamily:F4, fontWeight:900, fontSize:16, color:"#1a1a1a", marginBottom:4 }}>🧾 Ticket comparé à tes courses</div>
                {rapprochementCourses.totalReel != null && (
                  <div style={{ fontFamily:F4, fontSize:13, color:"#555", marginBottom:12 }}>
                    Total du ticket : <strong>{Number(rapprochementCourses.totalReel).toFixed(2)} €</strong>
                  </div>
                )}
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14, marginTop:rapprochementCourses.totalReel != null ? 0 : 12 }}>
                  <LigneRecap emoji="✅" texte={`${c.confirmes} achat${c.confirmes > 1 ? "s" : ""} confirmé${c.confirmes > 1 ? "s" : ""}`} fond="#F3FAF5" bord="#C8E6C9" />
                  {c.non_achetes > 0 && <LigneRecap emoji="🚫" texte={`${c.non_achetes} non acheté${c.non_achetes > 1 ? "s" : ""}`} fond="#F7F7F7" bord="#eee" />}
                  {c.a_verifier > 0 && <LigneRecap emoji="❓" texte={`${c.a_verifier} à vérifier — on regarde ensemble juste après`} fond="#FFF8E6" bord="#F0DFA8" />}
                  {c.hors_liste > 0 && <LigneRecap emoji="➕" texte={`${c.hors_liste} achat${c.hors_liste > 1 ? "s" : ""} imprévu${c.hors_liste > 1 ? "s" : ""} (hors liste)`} fond="#EFF5FC" bord="#CFE0F2" />}
                  {c.non_reconnues > 0 && <LigneRecap emoji="❔" texte={`${c.non_reconnues} ligne${c.non_reconnues > 1 ? "s" : ""} du ticket non reconnue${c.non_reconnues > 1 ? "s" : ""}`} fond="#F7F7F7" bord="#eee" />}
                </div>
                {c.non_reconnues > 0 && (
                  <button onClick={()=>{ setRapprochementCourses(null); setTab("archive"); }}
                    style={{ width:"100%", padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:F4, fontWeight:800, fontSize:13, color:"#333", cursor:"pointer", marginBottom:8 }}>
                    🔧 Réconcilier les lignes non reconnues (Historique)
                  </button>
                )}
                <button onClick={()=>setRapprochementCourses(null)}
                  style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:C.green, fontFamily:F4, fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer" }}>
                  {c.a_verifier > 0 ? "Continuer" : "Fermer"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Chantier 91 Lot 5 — mini-dialogue par article 'a_verifier', un par
            un après le récap. Toutes les issues sont réversibles ; « mal
            reconnu » laisse l'achat en 'a_verifier' et renvoie vers l'outil
            de réconciliation existant (Historique). */}
        {!rapprochementCourses && verifCourses.length > 0 && sessionCourses && (() => {
          const cle = verifCourses[0];
          const art = sessionCourses?.articles?.find(a => a.cle === cle);
          const nom = art?.nom_affiche ?? art?.nom_reference ?? "cet article";
          const F5 = "'Nunito',sans-serif";
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }}>
              <div style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%" }}>
                <div style={{ fontFamily:F5, fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:6 }}>❓ {nom}</div>
                <div style={{ fontFamily:F5, fontSize:13, color:"#888", marginBottom:16 }}>
                  Le {nom} a été coché, mais PrixMalin ne le trouve pas sur le ticket.
                </div>
                <button onClick={()=>trancherVerifCourses(cle, 'confirme')}
                  style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:C.green, fontFamily:F5, fontWeight:900, fontSize:14, color:"#fff", cursor:"pointer", marginBottom:8 }}>
                  ✅ Je l'ai acheté
                </button>
                <button onClick={()=>trancherVerifCourses(cle, 'non_achete')}
                  style={{ width:"100%", padding:"13px", border:"1.5px solid rgba(204,0,0,0.3)", borderRadius:10, background:"#fff", fontFamily:F5, fontWeight:800, fontSize:14, color:"#CC0000", cursor:"pointer", marginBottom:8 }}>
                  🚫 Je ne l'ai pas acheté
                </button>
                <button onClick={()=>trancherVerifCourses(cle, null, { versHistorique: true })}
                  style={{ width:"100%", padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:F5, fontWeight:800, fontSize:13, color:"#333", cursor:"pointer" }}>
                  🔧 Article mal reconnu — voir l'Historique
                </button>
              </div>
            </div>
          );
        })()}

        {/* Chantier 92 Lot 6 — proposition de favoris post-ticket : achats
            confirmés récurrents non déjà favoris, sélection multiple, rien
            n'est ajouté sans action explicite. Affichée après le récap et la
            file « à vérifier » du chantier 91. */}
        {!rapprochementCourses && verifCourses.length === 0 && !bilanCourses && propositionFavoris && (() => {
          const p = propositionFavoris;
          const nbChoisis = p.propositions.filter(x => p.selection?.[x.cle]).length;
          const F6 = "'Nunito',sans-serif";
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }}>
              <div style={{ background:"#fff", borderRadius:16, padding:"20px", maxWidth:340, width:"100%", maxHeight:"80vh", overflowY:"auto" }}>
                <div style={{ fontFamily:F6, fontWeight:900, fontSize:15, color:"#1a1a1a", marginBottom:6 }}>❤️ Tes achats réguliers</div>
                <div style={{ fontFamily:F6, fontSize:13, color:"#888", marginBottom:14 }}>
                  Tu achètes ces produits souvent. Les ajouter à tes favoris ?
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
                  {p.propositions.map(prop => {
                    const coche = !!p.selection?.[prop.cle];
                    return (
                      <button key={prop.cle}
                        onClick={()=>setPropositionFavoris(prev => prev ? { ...prev, selection: { ...prev.selection, [prop.cle]: !prev.selection?.[prop.cle] } } : prev)}
                        style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, border:`1.5px solid ${coche ? "#E5181B" : "#eee"}`, background: coche ? "#FFF0F0" : "#fff", cursor:"pointer" }}>
                        <span style={{ width:22, height:22, borderRadius:6, border:`2px solid ${coche ? "#E5181B" : "#bbb"}`, background: coche ? "#E5181B" : "#fff", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0 }}>
                          {coche ? "✓" : ""}
                        </span>
                        <span style={{ fontFamily:F6, fontWeight:800, fontSize:13, color:"#1a1a1a", flex:1, minWidth:0 }}>{prop.nom_affiche}</span>
                        <span style={{ fontFamily:F6, fontSize:11, fontWeight:800, color:"#999", whiteSpace:"nowrap" }}>×{prop.nb_tickets} tickets</span>
                      </button>
                    );
                  })}
                </div>
                <button onClick={validerPropositionFavoris} disabled={nbChoisis === 0}
                  style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background: nbChoisis > 0 ? "#E5181B" : "#eee", fontFamily:F6, fontWeight:900, fontSize:14, color: nbChoisis > 0 ? "#fff" : "#999", cursor: nbChoisis > 0 ? "pointer" : "default", marginBottom:8 }}>
                  ❤️ Ajouter les sélectionnés ({nbChoisis})
                </button>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>setPropositionFavoris(null)}
                    style={{ flex:1, padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:F6, fontWeight:800, fontSize:13, color:"#333", cursor:"pointer" }}>
                    Non merci
                  </button>
                  <button onClick={()=>setPropositionFavoris(null)}
                    style={{ flex:1, padding:"12px", border:"1.5px solid #eee", borderRadius:10, background:"#fff", fontFamily:F6, fontWeight:800, fontSize:13, color:"#333", cursor:"pointer" }}>
                    Plus tard
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Chantier 89 Lot 3 — écran-bilan de fin de courses, dernière étape
            de la clôture (remplace l'ancien toast). Affiché par-dessus
            l'accueil depuis l'état local : la session est déjà close, le
            fermer ne détruit rien et « À acheter plus tard » est conservée.
            Total = ESTIMATION (prix du comparateur), jamais présenté comme le
            montant payé ; articles sans prix signalés, pas de faux précis. */}
        {bilanCourses && (() => {
          const b = bilanCourses;
          const F3 = "'Nunito',sans-serif";
          const totalAffiche = b.nb_achetes === 0
            ? null
            : (b.total_estime > 0
              ? `~${Number(b.total_estime).toFixed(2)} €${b.total_incomplet ? " + articles sans prix" : ""}`
              : (b.total_incomplet ? "articles sans prix" : "0.00 €"));
          return (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:24 }} onClick={()=>setBilanCourses(null)}>
              <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:"24px 20px", maxWidth:340, width:"100%", textAlign:"center" }}>
                <div style={{ fontSize:44, marginBottom:8 }}>🎉</div>
                <div style={{ fontFamily:F3, fontWeight:900, fontSize:18, color:"#1a1a1a", marginBottom:14 }}>Courses terminées</div>
                <div style={{ textAlign:"left", display:"flex", flexDirection:"column", gap:8, marginBottom:6 }}>
                  <div style={{ display:"flex", alignItems:"baseline", gap:8, background:"#F3FAF5", border:"1px solid #C8E6C9", borderRadius:10, padding:"10px 12px" }}>
                    <span style={{ fontFamily:F3, fontWeight:800, fontSize:14, color:"#1a1a1a", flex:1 }}>
                      🛒 {b.nb_achetes} article{b.nb_achetes > 1 ? "s" : ""} acheté{b.nb_achetes > 1 ? "s" : ""}
                    </span>
                    {totalAffiche && <span style={{ fontFamily:F3, fontWeight:900, fontSize:14, color:C.green, whiteSpace:"nowrap" }}>{totalAffiche}</span>}
                  </div>
                  {b.nb_reporte > 0 && (
                    <div style={{ fontFamily:F3, fontWeight:800, fontSize:14, color:"#6B6152", background:"#FAF7F0", border:"1px dashed #D8CFBB", borderRadius:10, padding:"10px 12px" }}>
                      ⏳ {b.nb_reporte} gardé{b.nb_reporte > 1 ? "s" : ""} pour plus tard — dans « Ma liste »
                    </div>
                  )}
                  {b.nb_non_achetes > 0 && (
                    <div style={{ fontFamily:F3, fontWeight:800, fontSize:14, color:"#888", background:"#F7F7F7", border:"1px solid #eee", borderRadius:10, padding:"10px 12px" }}>
                      🚫 {b.nb_non_achetes} non pris
                    </div>
                  )}
                </div>
                {b.nb_achetes > 0 && (
                  <div style={{ fontFamily:F3, fontSize:11, color:"#999", marginBottom:14 }}>
                    Total estimé d'après les prix du comparateur — pas le ticket de caisse.
                  </div>
                )}
                <button onClick={()=>setBilanCourses(null)}
                  style={{ width:"100%", padding:"13px", border:"none", borderRadius:10, background:C.green, fontFamily:F3, fontWeight:900, fontSize:15, color:"#fff", cursor:"pointer", marginTop: b.nb_achetes > 0 ? 0 : 12 }}>
                  Fermer
                </button>
              </div>
            </div>
          );
        })()}

        {showSuccess && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, animation:"fadeIn 0.2s ease", padding:"20px", overflowY:"auto" }}>
            <div style={{ background:C.white, borderRadius:20, padding:"32px 24px", textAlign:"center", maxWidth:340, width:"100%", animation:"popIn 0.35s ease", boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
              <div style={{ fontSize:56, marginBottom:12 }}>🎉</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:"#CC0000", marginBottom:8 }}>Bonne course !</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, color:C.textLight, lineHeight:1.6, marginBottom: showSuccess.potentials.details.length > 0 ? 20 : 0 }}>
                Liste archivée.<br/>Direction <strong style={{ color:"#CC0000" }}>{showSuccess.store.name}</strong> {showSuccess.store.logo} !
              </div>
              {showSuccess.potentials.details.length > 0 && (
                <div style={{ background:"#FFFBEA", borderRadius:14, padding:"14px", textAlign:"left", border:`2px solid ${C.orange}` }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>💡 Économies potentielles</div>
                  <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:26, color:C.orange, lineHeight:1 }}>
                      {showSuccess.potentials.totalSaving > 0.01 ? `+${showSuccess.potentials.totalSaving.toFixed(2)} €` : "Déjà au mieux !"}
                    </div>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>potentiels</div>
                  </div>
                  {showSuccess.potentials.details.map(({item, opts, saving, best, worst}, i) => (
                    <div key={i} style={{ background:C.white, borderRadius:10, padding:"8px 10px", marginBottom:4, display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:12, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {item.brand?`${item.brand} · `:""}{item.product} <span style={{ color:C.gray, fontWeight:600 }}>{item.format}</span>
                        </div>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight, marginTop:1 }}>
                          <span style={{ color:C.green, fontWeight:800 }}>{best?.logo} {opts[0].price.toFixed(2)} €</span>
                          {" vs "}
                          <span style={{ color:"#CC3300" }}>{worst?.logo} {opts[opts.length-1].price.toFixed(2)} €</span>
                        </div>
                      </div>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.orange, flexShrink:0 }}>
                        {saving > 0.005 ? `+${saving.toFixed(2)} €` : "≈ égal"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
