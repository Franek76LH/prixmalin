// ── BARCODE SCANNER SHEET (Chantier "Scan code-barres", bout 1) ────────────
// Caméra arrière + décodage EAN-13/EAN-8/UPC-A via @zxing/browser
// (BarcodeDetector natif absent d'iOS Safari — cette lib décode en JS pur à
// partir du flux vidéo, éprouvée sur iOS). Ferme la caméra dès qu'un code est
// lu ou à la fermeture manuelle ; ne laisse jamais un flux caméra ouvert.
//
// Chantier 101 — composant SORTI de App.jsx tel quel (même config : formats
// EAN-13/EAN-8/UPC-A/UPC-E, autofocus continu, TRY_HARDER) pour être partagé
// entre CorrigerProduitSheet (App.jsx) et l'écran admin « À valider »
// (AValiderSheet). Aucun changement de comportement.

import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export default function BarcodeScannerSheet({ onDetected, onClose }) {
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
