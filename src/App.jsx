import { useState, useEffect, useMemo, useRef } from "react";
import { scanTicketWithClaude } from "./scanTicket";
import { STORES, CATEGORY_META, PRODUCT_SUGGESTIONS, STALE_DAYS } from "./constants";
import { supabase } from "./lib/supabase";

const C = {
  blue:      "#CC0000",   blueLight:  "#FFF0F0",
  orange:     "#FFD000",   orangeLight: "#FFFBEA",
  white:      "#FFFFFF",   bg:          "#F8F8F8",
  gray:       "#999999",   grayLight:   "#EFEFEF",
  text:       "#111111",   textLight:   "#555555",
  green:      "#00B341",   red:         "#CC0000",   yellow: "#FFD000",
};


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

// Clé unique d'un article de prix : marque+produit+format+magasin
function priceKey(p){ return `${normName(p.brand)}_${normName(p.product)}_${normFormat(p.format)}_${p.storeId}`; }
const MOIS=['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
function formatMonth(yyyymm){ if(!yyyymm) return ''; const [y,m]=yyyymm.split('-'); return `${MOIS[parseInt(m)-1]} ${y}`; }

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

const PURE_STORES = new Set(['auchan','carrefour','casino','intermarche','leclerc','e.leclerc','monoprix','lidl','u']);
function filterMDD(brands) {
  return brands.filter(m => {
    const n = m.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
    return !PURE_STORES.has(n);
  });
}

// Clé de matching pour la liste : produit+format+(marque si précisée)
function itemMatchesPrice(item, price) {
  const sameProduct = normName(price.product) === normName(item.product);
  const sameFormat  = normFormat(price.format) === normFormat(item.format);
  const brandOk     = !item.brand || normName(item.brand) === normName(price.brand||"");
  return sameProduct && sameFormat && brandOk;
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function Header({ tab, itemCount }) {
  const titles = { list:"Ma liste", catalog:"Catalogue", compare:"Comparer", prices:"Mes prix", archive:"Historique", economies:"Mes économies" };
  // petit indicateur visuel sauvegarde auto
  return (
    <div style={{ background:C.blue, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", boxShadow:"0 4px 20px rgba(204,0,0,0.4)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:"#FFFFFF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}>🛒</div>
        <div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.white, lineHeight:1 }}>PrixMalin</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:"rgba(255,255,255,0.7)", marginTop:1 }}>{titles[tab]}</div>
        </div>
      </div>
      {tab==="list" && itemCount>0 && (
        <div style={{ background:C.orange, borderRadius:99, padding:"6px 14px", fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:C.white }}>
          🧾 {itemCount} article{itemCount>1?"s":""}
        </div>
      )}
    </div>
  );
}

// ── TAB BAR ───────────────────────────────────────────────────────────────────
function TabBar({ tab, setTab }) {
  const tabs = [
    { id:"list",      icon:"📋", label:"Liste"     },
    { id:"catalog",   icon:"🛍️", label:"Catalogue" },
    { id:"compare",   icon:"🏪", label:"Comparer"  },
    { id:"prices",    icon:"🏷️", label:"Mes prix"  },
    { id:"archive",   icon:"📦", label:"Historique"},
    { id:"economies", icon:"💰", label:"Économies" },
  ];
  return (
    <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, background:C.white, borderTop:`3px solid #CC0000`, display:"flex", zIndex:50 }}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, border:"none", background:tab===t.id?C.blueLight:C.white, padding:"8px 2px 10px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:2, borderTop:tab===t.id?`3px solid ${C.orange}`:"3px solid transparent", marginTop:-3 }}>
          <span style={{ fontSize:18, filter:tab===t.id?"none":"grayscale(1) opacity(0.4)" }}>{t.icon}</span>
          <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:tab===t.id?C.blue:C.gray, textTransform:"uppercase", letterSpacing:"0.02em" }}>{t.label}</span>
        </button>
      ))}
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

// ── ADD ITEM SHEET ────────────────────────────────────────────────────────────
function AddItemSheet({ onClose, onAdd }) {
  const [product, setProduct] = useState("");
  const [format,  setFormat]  = useState("");
  const [brand,   setBrand]   = useState("");
  const [qty,     setQty]     = useState(1);
  const [brandFixed, setBrandFixed] = useState(false);
  const [added,   setAdded]   = useState([]);

  const canSubmit = product.trim() && format.trim();

  const submit = () => {
    if(!canSubmit) return;
    const item = { id:Date.now(), product:product.trim(), format:format.trim(), brand:brandFixed?brand.trim():"", qty, checked:false };
    onAdd(item);
    setAdded(prev=>[...prev, item]);
    setProduct(""); setFormat(""); setBrand(""); setQty(1); setBrandFixed(false);
  };

  const pickSuggestion = s => { setProduct(s.name); setFormat(s.format); };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"90vh", overflowY:"auto", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:"linear-gradient(135deg,#CC0000,#FF1A1A)", padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:10 }}>
          <div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:C.white }}>Ajouter des produits</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:"rgba(255,255,255,0.75)" }}>
              {added.length===0 ? "La sheet reste ouverte entre chaque ajout" : `✓ ${added.length} produit${added.length>1?"s":""} ajouté${added.length>1?"s":""}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:28, height:28, color:C.white, fontSize:14, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:"20px 20px 44px" }}>

          {/* Récap */}
          {added.length>0 && (
            <div style={{ background:"#F0FFF5", borderRadius:12, padding:"12px 14px", marginBottom:18, border:`1px solid ${C.green}` }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>✓ Dans ta liste</div>
              {added.map((a,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <div style={{ width:6, height:6, borderRadius:99, background:C.green, flexShrink:0 }}/>
                  <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:C.text }}>
                    {a.brand?`${a.brand} · `:""}{a.product} <span style={{ color:C.gray }}>{a.format}</span> ×{a.qty}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Suggestions */}
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Suggestions</div>
          <div style={{ display:"flex", gap:7, flexWrap:"wrap", marginBottom:18 }}>
            {PRODUCT_SUGGESTIONS.map((s,i)=>(
              <button key={i} onClick={()=>pickSuggestion(s)} style={{ padding:"6px 12px", background:(product===s.name&&format===s.format)?C.blue:C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:12, color:(product===s.name&&format===s.format)?C.white:C.text, cursor:"pointer" }}>
                {s.name} {s.format}
              </button>
            ))}
          </div>

          {/* Produit */}
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Produit *</div>
          <input value={product} onChange={e=>setProduct(e.target.value)} placeholder="Ex : Cola Zéro, Lait, Pâtes..." style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${product?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:15, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:14 }} />

          {/* Format */}
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Format / Volume *</div>
          <input value={format} onChange={e=>setFormat(e.target.value)} placeholder="Ex : 1L, 1,5L, 500g, 1kg, x6..." style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${format?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:15, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:14 }} />

          {/* Marque optionnelle */}
          <div style={{ background:C.grayLight, borderRadius:12, padding:"12px 16px", marginBottom:18 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: brandFixed?12:0 }}>
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
              <input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="Ex : Look, Coca-Cola, Président..." style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`2px solid ${brand?C.orange:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
            )}
          </div>

          {/* Quantité */}
          <div style={{ display:"flex", alignItems:"center", background:C.grayLight, borderRadius:12, padding:"10px 16px", marginBottom:18 }}>
            <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, flex:1 }}>Quantité</span>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{ width:32, height:32, borderRadius:99, border:`2px solid ${C.blue}`, background:C.white, cursor:"pointer", color:C.blue, fontWeight:900, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
              <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:C.blue, minWidth:24, textAlign:"center" }}>{qty}</span>
              <button onClick={()=>setQty(q=>q+1)} style={{ width:32, height:32, borderRadius:99, border:"none", background:C.blue, cursor:"pointer", color:C.white, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
            </div>
          </div>

          <button onClick={submit} disabled={!canSubmit} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:canSubmit?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:canSubmit?"#111111":C.gray, cursor:canSubmit?"pointer":"default", marginBottom:10 }}>
            + Ajouter ce produit
          </button>
          <button onClick={onClose} style={{ width:"100%", padding:"13px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
            {added.length>0 ? `✓ Terminer (${added.length} produit${added.length>1?"s":""} ajouté${added.length>1?"s":""})` : "Annuler"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── IMPORT TICKET SHEET ───────────────────────────────────────────────────────
function ImportTicketSheet({ onClose, onImport }) {
  const [jsonText, setJsonText] = useState("");
  const [status,   setStatus]   = useState("idle");
  const [error,    setError]    = useState("");
  const [result,   setResult]   = useState(null);
  const [selectedStore, setSelectedStore] = useState("");
  const [editableProducts, setEditableProducts] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [storeNameEdit, setStoreNameEdit] = useState("");
  const [storeLocation, setStoreLocation] = useState("");
  const fileInputRef = useRef(null);
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

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

  const parseAndPreview = (text) => {
    try {
      const clean=(text||"").replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(clean);
      if(!parsed.products||!Array.isArray(parsed.products)) throw new Error("Champ 'products' manquant");
      setResult(parsed);
      setSelectedStore(storeIdFromName(parsed.store));
      setEditableProducts(parsed.products.map((p,i)=>({...p,id:i,keep:true})));
      setStoreNameEdit(parsed.store||"");
      setStoreLocation(parsed.address||"");
      setError("");
      setStatus("store");
    } catch(e) { setError("JSON invalide : "+e.message); }
  };

  const loadExample = () => { setJsonText(EXAMPLE); parseAndPreview(EXAMPLE); };
  const toggleProduct = id => setEditableProducts(prev=>prev.map(p=>p.id===id?{...p,keep:!p.keep}:p));
  const updatePrice = (id,val) => setEditableProducts(prev=>prev.map(p=>p.id===id?{...p,price:parseFloat(val)||0}:p));

  const confirm = () => {
    const toImport=editableProducts.filter(p=>p.keep&&p.name&&p.price>0).map(p=>({
      id:Date.now()+p.id,
      brand:  p.brand||"",
      product:p.name,
      format: p.format||"",
      storeId:selectedStore||"autre",
      store_name: storeNameEdit.trim() || result?.store || "",
      store_address: storeLocation.trim(),
      price:  p.price,
      date:   result?.date?new Date(result.date).toISOString():new Date().toISOString(),
    }));
    onImport(toImport);
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={status==="idle"?onClose:undefined}>
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
                  {n:"1",t:"📷 Appuie sur Scanner un ticket"},
                  {n:"2",t:"Prends une photo de ton ticket de caisse"},
                  {n:"3",t:"Les produits s'importent automatiquement !"},
                ].map(s=>(
                  <div key={s.n} style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:8 }}>
                    <div style={{ width:24, height:24, borderRadius:99, background:C.orange, color:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{s.n}</div>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, lineHeight:1.5 }}>{s.t}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Colle le JSON ici</div>
              <textarea value={jsonText} onChange={e=>setJsonText(e.target.value)}
                placeholder={'{\n  "store": "Intermarché",\n  "date": "2026-04-11",\n  "products": [\n    { "brand": "Look", "name": "Cola Zéro", "format": "1L", "price": 0.49 }\n  ]\n}'}
                style={{ width:"100%", height:160, padding:"12px", borderRadius:12, border:`2px solid ${jsonText?C.orange:C.grayLight}`, fontFamily:"monospace", fontSize:12, color:C.text, outline:"none", resize:"none", boxSizing:"border-box", marginBottom:12, lineHeight:1.5 }}
              />
              {error && <div style={{ background:"#FEE", borderRadius:10, padding:"10px 14px", marginBottom:12, fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red, fontWeight:700 }}>⚠️ {error}</div>}
              <button onClick={()=>parseAndPreview(jsonText)} disabled={!jsonText.trim()} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:jsonText.trim()?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:jsonText.trim()?C.white:C.gray, cursor:jsonText.trim()?"pointer":"default", marginBottom:10 }}>
                Analyser →
              </button>
              <button onClick={loadExample} style={{ width:"100%", padding:"13px", border:`2px solid ${C.blue}`, borderRadius:12, background:C.blueLight, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.blue, cursor:"pointer" }}>
                🧪 Tester avec ticket Intermarché
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={async (e) => {
                const file = e.target.files[0];
                if(!file) return;
                setScanning(true); setError("");
                try {
                  const base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
                  const parsed = await scanTicketWithClaude(base64, apiKey);
                  setResult(parsed); setSelectedStore(storeIdFromName(parsed.store));
                  setEditableProducts(parsed.products.map((p,i) => ({...p, id:i, keep:true})));
                  setStoreNameEdit(parsed.store||"");
                  setStoreLocation(parsed.address||"");
                  setStatus("store");
                } catch(e) { setError("Erreur scan : " + e.message); }
                setScanning(false);
              }} style={{ display:"none" }} />
              <button onClick={()=>fileInputRef.current?.click()} disabled={scanning} style={{ width:"100%", padding:"15px", marginTop:10, border:"none", borderRadius:12, background:scanning?"#999":"#00B341", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"white", cursor:scanning?"default":"pointer" }}>
                {scanning ? "⏳ Analyse en cours..." : "📷 Scanner un ticket"}
              </button>
            </>
          )}

          {status==="store" && result && (
            <>
              <div style={{ background:C.blueLight, borderRadius:12, padding:"12px 16px", marginBottom:20 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:C.blue, marginBottom:4 }}>
                  ✅ {editableProducts.length} produit{editableProducts.length>1?"s":""} détecté{editableProducts.length>1?"s":""}
                </div>
                {result.date && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>📅 {new Date(result.date).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}</div>}
              </div>

              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Nom du magasin *</div>
              <input
                value={storeNameEdit}
                onChange={e=>setStoreNameEdit(e.target.value)}
                placeholder="Ex : Intermarché, Lidl..."
                style={{ width:"100%", padding:"13px 14px", borderRadius:12, border:`2px solid ${storeNameEdit.trim()?C.orange:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:15, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:14 }}
              />

              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Adresse (optionnel)</div>
              <input
                value={storeLocation}
                onChange={e=>setStoreLocation(e.target.value)}
                placeholder="Ex : 12 Rue de la Paix, 75001 Paris"
                style={{ width:"100%", padding:"13px 14px", borderRadius:12, border:`2px solid ${storeLocation.trim()?C.blue:C.grayLight}`, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:15, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:20 }}
              />

              <div style={{ marginBottom:20 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Enseigne</div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {STORES.map(s=>(
                    <button key={s.id} onClick={()=>setSelectedStore(s.id)} style={{ padding:"6px 12px", background:selectedStore===s.id?C.blue:C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:12, color:selectedStore===s.id?C.white:C.text, cursor:"pointer" }}>
                      {s.logo} {s.name}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={()=>setStatus("preview")} disabled={!storeNameEdit.trim()} style={{ width:"100%", padding:"16px", border:"none", borderRadius:12, background:storeNameEdit.trim()?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:storeNameEdit.trim()?C.white:C.gray, cursor:storeNameEdit.trim()?"pointer":"default", marginBottom:10, boxShadow:storeNameEdit.trim()?"0 6px 20px rgba(204,0,0,0.35)":"none" }}>
                Continuer →
              </button>
              <button onClick={()=>setStatus("idle")} style={{ width:"100%", padding:"13px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
                ← Retour
              </button>
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
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, background:p.keep?C.white:C.grayLight, borderRadius:12, padding:"10px 14px", border:`1px solid ${p.keep?C.blue:C.grayLight}`, opacity:p.keep?1:0.5 }}>
                    <button onClick={()=>toggleProduct(p.id)} style={{ width:24, height:24, borderRadius:6, flexShrink:0, cursor:"pointer", border:`2px solid ${p.keep?C.blue:C.gray}`, background:p.keep?C.blue:C.white, color:C.white, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>{p.keep?"✓":""}</button>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{p.brand?`${p.brand} · `:""}{p.name}</div>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>{p.format}</div>
                    </div>
                    <input type="number" step="0.01" min="0" value={p.price} onChange={e=>updatePrice(p.id,e.target.value)}
                      style={{ width:68, padding:"6px 8px", textAlign:"right", borderRadius:8, border:`2px solid ${C.orange}`, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.orange, outline:"none" }} />
                    <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.orange }}>€</span>
                  </div>
                ))}
              </div>

              <button onClick={confirm} style={{ width:"100%", padding:"16px", border:"none", borderRadius:12, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.white, cursor:"pointer", marginBottom:10, boxShadow:"0 6px 20px rgba(204,0,0,0.35)" }}>
                💾 Importer {editableProducts.filter(p=>p.keep).length} prix
              </button>
              <button onClick={()=>setStatus("idle")} style={{ width:"100%", padding:"13px", border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
                ← Coller un autre JSON
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── PRICE ENTRY SHEET (saisie manuelle) ───────────────────────────────────────
function PriceEntrySheet({ onClose, onSave, existingPrice }) {
  const [brand,   setBrand]   = useState(existingPrice?.brand||"");
  const [product, setProduct] = useState(existingPrice?.product||"");
  const [format,  setFormat]  = useState(existingPrice?.format||"");
  const [storeId, setStoreId] = useState(existingPrice?.storeId||"");
  const [storeName, setStoreName] = useState(existingPrice?.store_name || "");
  const [storeAddress, setStoreAddress] = useState(existingPrice?.store_address || "");
  const [price,   setPrice]   = useState(existingPrice?.price?.toString()||"");
  const canSubmit = product&&format&&storeId&&price&&!isNaN(parseFloat(price));

  const submit = () => {
    if(!canSubmit) return;
    onSave({ brand:brand.trim(), product:product.trim(), format:format.trim(), storeId, store_name: storeName.trim(), store_address: storeAddress.trim(), price:parseFloat(price), date:new Date().toISOString() });
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"90vh", overflowY:"auto", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:C.orange, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:C.white }}>{existingPrice?"Modifier":"Saisir un prix"}</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:28, height:28, color:C.white, fontSize:14, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:"20px 20px 44px" }}>
          {[
            {label:"Marque (optionnel)", val:brand, set:setBrand, ph:"Ex : Look, Coca-Cola, Président...", required:false},
            {label:"Produit *",          val:product,set:setProduct,ph:"Ex : Cola Zéro, Lait, Pâtes...",    required:true},
            {label:"Format *",           val:format, set:setFormat, ph:"Ex : 1L, 1,5L, 500g, 1kg, x6...",  required:true},
          ].map(f=>(
            <div key={f.label} style={{ marginBottom:14 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>{f.label}</div>
              <input value={f.val} onChange={e=>f.set(e.target.value)} placeholder={f.ph}
                style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${f.val?(f.required?C.orange:C.blue):C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
            </div>
          ))}
<div style={{ marginBottom:14 }}>
  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>
    Nom précis du magasin
  </div>
  <input
    value={storeName}
    onChange={e=>setStoreName(e.target.value)}
    placeholder="Ex : Carrefour Marseille B."
    style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${storeName?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }}
  />
</div>
<div style={{ marginBottom:14 }}>
  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>
    Adresse / quartier (optionnel)
  </div>
  <input
    value={storeAddress}
    onChange={e=>setStoreAddress(e.target.value)}
    placeholder="Ex : Rue de la Paix, Centre-ville..."
    style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${storeAddress?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }}
  />
</div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Magasin *</div>
            <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
              {STORES.map(s=>(
                <button key={s.id} onClick={()=>setStoreId(s.id)} style={{ padding:"7px 12px", background:storeId===s.id?C.blue:C.grayLight, border:"none", borderRadius:10, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:12, color:storeId===s.id?C.white:C.text, cursor:"pointer" }}>
                  {s.logo} {s.name}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:22 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Prix *</div>
            <div style={{ position:"relative" }}>
              <input type="number" step="0.01" min="0" value={price} onChange={e=>setPrice(e.target.value)} placeholder="0.00"
                style={{ width:"100%", padding:"16px 50px 16px 16px", borderRadius:12, border:`2px solid ${price?C.orange:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:24, fontWeight:900, color:C.text, outline:"none", boxSizing:"border-box" }} />
              <span style={{ position:"absolute", right:16, top:"50%", transform:"translateY(-50%)", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.orange }}>€</span>
            </div>
          </div>
          <button onClick={submit} disabled={!canSubmit} style={{ width:"100%", padding:"16px", border:"none", borderRadius:12, background:canSubmit?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:canSubmit?C.white:C.gray, cursor:canSubmit?"pointer":"default" }}>
            💾 Enregistrer ce prix
          </button>
        </div>
      </div>
    </div>
  );
}


// ── CATALOG TAB ───────────────────────────────────────────────────────────────
function ProductPickerSheet({ category, onClose, onAdd, items, catalog = [], openProduct = null, priceDB = [] }) {
  const [selected,      setSelected]      = useState(openProduct);
  const [format,        setFormat]        = useState("");
  const [brand,         setBrand]         = useState("");
  const [brandFixed,    setBrandFixed]    = useState(false);
  const [showMddPicker, setShowMddPicker] = useState(false);
  const [qty,           setQty]           = useState(1);
  const [added,         setAdded]         = useState([]);

  const knownFormats = useMemo(()=>{
    if(!selected||!priceDB.length) return [];
    const name = normName(selected.product_name);
    return [...new Set(priceDB.filter(p=>normName(p.product)===name).map(p=>p.format).filter(Boolean))];
  },[selected,priceDB]);

  useEffect(()=>{
    if(knownFormats.length===1) setFormat(knownFormats[0]);
    else setFormat("");
  },[knownFormats]);

  const submit = () => {
    if(!selected || !format.trim()) return;
    const item = { id:Date.now()+Math.random(), product:selected.product_name, format:format.trim(), brand:brandFixed?brand:"", qty, checked:false };
    onAdd(item);
    setAdded(prev=>[...prev,item]);
    setSelected(null); setFormat(""); setBrand(""); setQty(1); setBrandFixed(false); setShowMddPicker(false);
  };

  const alreadyIn = (name) => items.some(i => i.product.toLowerCase().trim() === name.toLowerCase().trim());

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:300, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"90vh", display:"flex", flexDirection:"column", animation:"slideUp 0.3s ease", overflow:"hidden" }}>

        {/* Header catégorie */}
        <div style={{ background:`linear-gradient(135deg, ${category.color}, ${category.color}CC)`, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:28 }}>{category.emoji}</span>
            <div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.white }}>{category.name}</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:"rgba(255,255,255,0.7)" }}>
                {added.length>0 ? `✓ ${added.length} ajouté${added.length>1?"s":""}` : "Sélectionne un produit"}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:32, height:32, color:C.white, fontSize:16, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ overflowY:"auto", flex:1, padding:"16px 16px 40px" }}>

          {/* Grille produits */}
          {!selected && (
            <>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:12 }}>
                Choisis un produit
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                {catalog.filter(p => p.category === category?.name).map((p,i)=>{
                  const inList = alreadyIn(p.product_name);
                  return (
                    <button key={i} onClick={()=>{ setSelected(p); setFormat(""); setBrand(""); }} style={{
                      padding:"14px 12px", background:inList?"#F0FFF5":C.white,
                      border:`2px solid ${inList?C.green:C.grayLight}`,
                      borderRadius:14, cursor:"pointer", textAlign:"left",
                      boxShadow:"0 2px 8px rgba(0,0,0,0.06)",
                      position:"relative",
                    }}>
                      {inList && <span style={{ position:"absolute", top:6, right:8, fontSize:12 }}>✓</span>}
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, marginBottom:4 }}>{p.product_name}</div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Détail produit sélectionné */}
          {selected && (
            <>
              <button onClick={()=>setSelected(null)} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", marginBottom:16, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:14, color:C.gray }}>
                ← Retour
              </button>

              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.text, marginBottom:2 }}>{selected.product_name}</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.gray, marginBottom:14 }}>{category.name}</div>

              {/* Marque */}
              {(selected.marques_nationales?.length > 0 || filterMDD(selected.marques_distributeurs||[]).length > 0) && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
                    Marque <span style={{ fontWeight:600, textTransform:"none", color:C.gray }}>· optionnel</span>
                  </div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                    {selected.marques_nationales?.map((m,i) => (
                      <button key={i} onClick={()=>{ brandFixed&&brand===m?(setBrand(""),setBrandFixed(false)):(setBrand(m),setBrandFixed(true)); setShowMddPicker(false); }}
                        style={{ padding:"10px 16px", background:brandFixed&&brand===m?C.orange:C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:brandFixed&&brand===m?"#111":C.text, cursor:"pointer" }}>
                        {m}
                      </button>
                    ))}
                    {filterMDD(selected.marques_distributeurs||[]).length > 0 && (
                      <button onClick={()=>{ const on=!(brandFixed&&brand==="MDD"); if(on){setBrand("MDD");setBrandFixed(true);}else{setBrand("");setBrandFixed(false);setShowMddPicker(false);} }}
                        style={{ padding:"10px 16px", background:brandFixed&&brand==="MDD"?C.blue:C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:brandFixed&&brand==="MDD"?C.white:C.text, cursor:"pointer" }}>
                        MDD
                      </button>
                    )}
                  </div>
                  {brandFixed && (brand==="MDD" || filterMDD(selected.marques_distributeurs||[]).includes(brand)) && filterMDD(selected.marques_distributeurs||[]).length > 0 && (
                    !showMddPicker ? (
                      <button onClick={()=>setShowMddPicker(true)}
                        style={{ background:"none", border:"none", padding:0, fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:700, color:C.blue, cursor:"pointer", textDecoration:"underline" }}>
                        Préciser une MDD spécifique
                      </button>
                    ) : (
                      <div>
                        <div style={{ background:"#FFF8E1", border:"1px solid #FFD54F", borderRadius:10, padding:"10px 12px", marginBottom:8, fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:600, color:"#7B5800", lineHeight:1.5 }}>
                          ⚠️ En choisissant une MDD spécifique, le comparateur ne pourra pas comparer les prix entre magasins, car cette marque n'est vendue que dans son enseigne.
                        </div>
                        <select
                          value={filterMDD(selected.marques_distributeurs||[]).includes(brand) ? brand : ""}
                          onChange={e=>{ if(e.target.value) setBrand(e.target.value); else setBrand("MDD"); }}
                          style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`2px solid ${C.blue}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", cursor:"pointer" }}
                        >
                          <option value="">— Aucune préférence (MDD)</option>
                          {filterMDD(selected.marques_distributeurs).map((m,i) => (
                            <option key={i} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Format */}
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Format / Volume *</div>

              {knownFormats.length > 0 && (
                <div style={{ background:"#F0FFF5", borderRadius:12, padding:"10px 12px", marginBottom:10, border:`1.5px solid ${C.green}` }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.green, marginBottom:8 }}>
                    {knownFormats.length===1 ? "✓ Format pré-rempli depuis tes prix" : "✓ Formats déjà dans tes prix"}
                  </div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {knownFormats.map((f,i)=>(
                      <button key={i} onClick={()=>setFormat(f)} style={{ padding:"9px 16px", background:format===f?C.green:"#fff", border:`2px solid ${C.green}`, borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:format===f?C.white:C.green, cursor:"pointer" }}>{f}</button>
                    ))}
                  </div>
                </div>
              )}

              {selected.formats?.filter(f=>!knownFormats.includes(f)).length > 0 && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                  {selected.formats.filter(f=>!knownFormats.includes(f)).map((f,i) => (
                    <button key={i} onClick={()=>setFormat(f)} style={{
                      padding:"9px 16px", background:format===f?C.blue:C.grayLight,
                      border:"none", borderRadius:99,
                      fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14,
                      color:format===f?C.white:C.text, cursor:"pointer",
                    }}>{f}</button>
                  ))}
                </div>
              )}

              <input value={format} onChange={e=>setFormat(e.target.value)} placeholder="Ex : 1L, 500g, 1kg, x6..."
                style={{ width:"100%", padding:"12px 16px", borderRadius:10, border:`2px solid ${format?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:15, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:14 }} />

              {/* Quantité */}
              <div style={{ display:"flex", alignItems:"center", background:C.grayLight, borderRadius:12, padding:"10px 16px", marginBottom:14 }}>
                <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, flex:1 }}>Quantité</span>
                <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                  <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{ width:32, height:32, borderRadius:99, border:"2px solid #CC0000", background:C.white, cursor:"pointer", color:"#CC0000", fontWeight:900, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
                  <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:"#CC0000", minWidth:24, textAlign:"center" }}>{qty}</span>
                  <button onClick={()=>setQty(q=>q+1)} style={{ width:32, height:32, borderRadius:99, border:"none", background:"#CC0000", cursor:"pointer", color:C.white, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
                </div>
              </div>

              <button onClick={submit} disabled={!format.trim()} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:format.trim()?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:format.trim()?"#111111":C.gray, cursor:format.trim()?"pointer":"default", boxShadow:format.trim()?"0 6px 16px rgba(200,160,0,0.4)":"none" }}>
                + Ajouter à ma liste
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CatalogTab({ items, setItems, setTab, catalog, priceDB }) {
  const [selectedCat,  setSelectedCat]  = useState(null);
  const [openProduct,  setOpenProduct]  = useState(null);
  const [searchQuery,  setSearchQuery]  = useState("");
  const totalInList = items.filter(i=>!i.checked).length;

  const addItem = item => setItems([...items, item]);

  const searchResults = searchQuery.trim()
    ? catalog.filter(p => p.product_name?.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

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
      <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="🔍 Chercher un produit..."
        style={{ width:"100%", padding:"12px 16px", borderRadius:12, border:`2px solid ${searchQuery?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:14, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box", marginBottom:16 }} />

      {/* Résultats de recherche */}
      {searchResults.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
          {searchResults.map((p,i) => {
            const cat = CATEGORY_META.find(c => c.name === p.category);
            return (
              <button key={i} onClick={()=>{ setSelectedCat(cat||CATEGORY_META[0]); setOpenProduct(p); setSearchQuery(""); }}
                style={{ display:"flex", alignItems:"center", gap:12, background:C.white, border:`1px solid ${C.grayLight}`, borderRadius:12, padding:"12px 14px", cursor:"pointer", textAlign:"left", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <span style={{ fontSize:22 }}>{cat?.emoji||"🛍️"}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{p.product_name}</div>
                  {cat && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:cat.color, fontWeight:700, marginTop:2 }}>{cat.name}</div>}
                </div>
                <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:20, color:C.blue }}>+</span>
              </button>
            );
          })}
        </div>
      )}
      {searchQuery.trim() && searchResults.length === 0 && (
        <div style={{ background:C.grayLight, borderRadius:12, padding:"16px", textAlign:"center", marginBottom:16 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray }}>Aucun produit trouvé pour « {searchQuery} »</div>
        </div>
      )}

      {/* Bouton voir liste si articles en cours */}
      {totalInList>0 && (
        <button onClick={()=>setTab("list")} style={{
          width:"100%", padding:"15px", marginBottom:20,
          background:"linear-gradient(135deg,#CC0000,#FF1A1A)",
          border:"none", borderRadius:14,
          fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15,
          color:C.white, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          boxShadow:"0 6px 16px rgba(180,0,0,0.4)",
          animation:"pulse 2s infinite",
        }}>
          🛒 Voir ma liste ({totalInList} article{totalInList>1?"s":""})
        </button>
      )}

      {/* Grille catégories */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
       {CATEGORY_META.map((cat,i)=>{
          const count = catalog.filter(p => p.category === cat.name).length;
          return (
            <button key={cat.id} onClick={()=>setSelectedCat(cat)} style={{
              padding:0, background:C.white,
              border:`2px solid ${count>0?cat.color:C.grayLight}`,
              borderRadius:20, cursor:"pointer", overflow:"hidden",
              boxShadow: count>0 ? `0 6px 20px ${cat.color}40` : "0 2px 10px rgba(0,0,0,0.08)",
              animation: `slideIn 0.3s ease ${i*0.05}s both`,
              position:"relative",
              aspectRatio:"1",
            }}>
              {/* Badge compteur */}
              {count>0 && (
                <div style={{ position:"absolute", top:10, right:10, width:24, height:24, borderRadius:99, background:cat.color, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:12, color:C.white, zIndex:2, boxShadow:"0 2px 6px rgba(0,0,0,0.2)" }}>
                  {count}
                </div>
              )}
              {/* Fond dégradé plein + emoji géant */}
              <div style={{
                background:`linear-gradient(145deg, ${cat.color}22, ${cat.color}55)`,
                width:"100%", height:"68%",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                <span style={{ fontSize:60, lineHeight:1, filter:"drop-shadow(0 4px 8px rgba(0,0,0,0.15))" }}>{cat.emoji}</span>
              </div>
              {/* Label en bas */}
              <div style={{ padding:"8px 10px 10px", textAlign:"center", background:C.white }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.text, lineHeight:1.2 }}>{cat.name}</div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, color:cat.color, marginTop:2, fontWeight:700 }}>
                  {count} produits
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedCat && (
        <ProductPickerSheet
          category={selectedCat}
          onClose={()=>{ setSelectedCat(null); setOpenProduct(null); }}
          onAdd={addItem}
          items={items}
          catalog={catalog}
          openProduct={openProduct}
          priceDB={priceDB}
        />
      )}
    </div>
  );
}

// ── EDIT ITEM SHEET ───────────────────────────────────────────────────────────
function EditItemSheet({ item, onClose, onSave }) {
  const [product,    setProduct]    = useState(item.product);
  const [format,     setFormat]     = useState(item.format);
  const [brand,      setBrand]      = useState(item.brand || "");
  const [brandFixed, setBrandFixed] = useState(!!item.brand);
  const [qty,        setQty]        = useState(item.qty);
  const canSubmit = product.trim() && format.trim();

  const submit = () => {
    if (!canSubmit) return;
    onSave({ ...item, product:product.trim(), format:format.trim(), brand:brandFixed?brand.trim():"", qty });
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white, borderRadius:"20px 20px 0 0", width:"100%", maxHeight:"90vh", overflowY:"auto", animation:"slideUp 0.3s ease" }}>
        <div style={{ background:"linear-gradient(135deg,#CC0000,#FF1A1A)", padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:C.white }}>Modifier l'article</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:28, height:28, color:C.white, fontSize:14, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:"20px 20px 44px" }}>
          {[
            {label:"Produit *", val:product, set:setProduct, ph:"Ex : Cola Zéro, Lait..."},
            {label:"Format *",  val:format,  set:setFormat,  ph:"Ex : 1L, 500g, x6..."},
          ].map(f=>(
            <div key={f.label} style={{ marginBottom:14 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>{f.label}</div>
              <input value={f.val} onChange={e=>f.set(e.target.value)} placeholder={f.ph}
                style={{ width:"100%", padding:"13px 16px", borderRadius:10, border:`2px solid ${f.val?C.blue:C.grayLight}`, background:C.white, fontFamily:"'Nunito',sans-serif", fontSize:15, fontWeight:700, color:C.text, outline:"none", boxSizing:"border-box" }} />
            </div>
          ))}
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
          <div style={{ display:"flex", alignItems:"center", background:C.grayLight, borderRadius:12, padding:"10px 16px", marginBottom:22 }}>
            <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, flex:1 }}>Quantité</span>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{ width:32, height:32, borderRadius:99, border:`2px solid ${C.blue}`, background:C.white, cursor:"pointer", color:C.blue, fontWeight:900, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
              <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:C.blue, minWidth:24, textAlign:"center" }}>{qty}</span>
              <button onClick={()=>setQty(q=>q+1)} style={{ width:32, height:32, borderRadius:99, border:"none", background:C.blue, cursor:"pointer", color:C.white, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
            </div>
          </div>
          <button onClick={submit} disabled={!canSubmit} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:canSubmit?C.orange:C.grayLight, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:canSubmit?"#111111":C.gray, cursor:canSubmit?"pointer":"default" }}>
            💾 Enregistrer les modifications
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LIST TAB ──────────────────────────────────────────────────────────────────
function ListTab({ items, setItems, setTab, favorites, saveFavorites }) {
  const [showAdd,      setShowAdd]      = useState(false);
  const [showFavModal, setShowFavModal] = useState(false);
  const [editItem,     setEditItem]     = useState(null);
  const [toast,        setToast]        = useState(null);

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),2500); };
  const addItem       = item => { setItems([...items, item]); showToast(`✓ ${item.product} ajouté`); };
  const toggleCheck   = id  => setItems(items.map(i=>i.id===id?{...i,checked:!i.checked}:i));
  const removeItem    = id  => setItems(items.filter(i=>i.id!==id));
  const updateItem    = updated => setItems(items.map(i=>i.id===updated.id?updated:i));
  const removeFavorite = i  => saveFavorites(favorites.filter((_,idx)=>idx!==i));
  const unchecked = items.filter(i=>!i.checked);
  const checked   = items.filter(i=>i.checked);

  // Sauvegarder la liste courante comme favoris
  const saveAsFavorites = () => {
    const favItems = items.map(i=>({ product:i.product, format:i.format, brand:i.brand, qty:i.qty }));
    saveFavorites(favItems);
    setShowFavModal(false);
  };

  // Recharger les favoris dans la liste
  const loadFavorites = () => {
    const newItems = favorites.map(f=>({ ...f, id:Date.now()+Math.random(), checked:false }));
    setItems(newItems);
    setShowFavModal(false);
  };

  // Ajouter les favoris à la liste existante (sans effacer)
  const appendFavorites = () => {
    const newItems = favorites.map(f=>({ ...f, id:Date.now()+Math.random(), checked:false }));
    setItems([...items, ...newItems]);
    setShowFavModal(false);
  };

  const ItemRow = ({item, done}) => (
    <div style={{ display:"flex", alignItems:"center", gap:12, background:done?C.grayLight:C.white, borderRadius:12, padding:"12px 14px", border:`1px solid ${done?C.grayLight:C.grayLight}`, opacity:done?0.65:1, boxShadow:done?"none":"0 1px 4px rgba(0,0,0,0.06)" }}>
      <button onClick={()=>toggleCheck(item.id)} style={{ width:26, height:26, borderRadius:6, border:`2px solid ${done?C.green:C.blue}`, background:done?C.green:C.white, cursor:"pointer", flexShrink:0, color:C.white, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>
        {done?"✓":""}
      </button>
      <div style={{ flex:1 }}>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:done?C.textLight:C.text, textDecoration:done?"line-through":"none" }}>
          {item.brand?`${item.brand} · `:""}{item.product}
        </div>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.gray, marginTop:1 }}>
          {item.format}{item.brand?"":""} {!item.brand&&<span style={{ color:C.orange, fontSize:11 }}>· toutes marques</span>}
        </div>
      </div>
      <div style={{ background:done?C.gray:C.blue, color:C.white, borderRadius:8, padding:"3px 9px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13 }}>×{item.qty}</div>
      {!done && <button onClick={()=>setEditItem(item)} style={{ background:C.grayLight, border:"none", borderRadius:8, padding:"4px 7px", fontSize:12, cursor:"pointer" }}>✏️</button>}
      <button onClick={()=>removeItem(item.id)} style={{ background:"none", border:"none", fontSize:15, cursor:"pointer", color:C.gray }}>✕</button>
    </div>
  );

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

      <button onClick={()=>setShowAdd(true)} style={{ width:"100%", padding:"15px", background:C.orange, border:"none", borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"#111111", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 6px 16px rgba(200,160,0,0.4)" }}>
        + Ajouter un produit
      </button>

      {/* Sauvegarder comme favoris (si liste non vide) */}
      {items.length>0 && (
        <button onClick={()=>setShowFavModal(true)} style={{ width:"100%", padding:"12px", marginTop:10, background:"transparent", border:`2px solid ${C.grayLight}`, borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:13, color:C.gray, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
          ⭐ {favorites.length>0?"Mettre à jour mes courses habituelles":"Sauvegarder comme courses habituelles"}
        </button>
      )}

      {showAdd && <AddItemSheet onClose={()=>setShowAdd(false)} onAdd={addItem}/>}
      {editItem && <EditItemSheet item={editItem} onClose={()=>setEditItem(null)} onSave={updated=>{updateItem(updated);setEditItem(null);}}/>}
      {toast && <Toast msg={toast.msg} ok={toast.ok}/>}

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
function EconomiesTab({ priceDB, savings, items, setTab }) {
  const sLabel = { fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 };

  // ── Section 1 : Économies potentielles (liste de courses en cours)
  const potentials = useMemo(() => {
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
        details.push({
          item, opts, saving,
          best:  STORES.find(s => s.id === opts[0].storeId),
          worst: STORES.find(s => s.id === opts[opts.length-1].storeId),
        });
      }
    });
    return { totalSaving, details };
  }, [items, priceDB]);

  // ── Section 2 : Cagnotte réalisées
  const cagnotte = useMemo(() => ({
    vsAvg: savings.reduce((a,s) => a + (s.saved_vs_avg||0), 0),
    vsMax: savings.reduce((a,s) => a + (s.saved_vs_max||0), 0),
  }), [savings]);

  // ── Section 3 : Récapitulatif mensuel réalisées
  const monthly = useMemo(() => {
    const map = {};
    savings.forEach(s => {
      const m = (s.date||'').substring(0,7);
      if (!m) return;
      if (!map[m]) map[m] = { vsAvg:0, vsMax:0, count:0 };
      map[m].vsAvg  += s.saved_vs_avg || 0;
      map[m].vsMax  += s.saved_vs_max || 0;
      map[m].count  += 1;
    });
    return Object.entries(map)
      .sort((a,b) => b[0].localeCompare(a[0]))
      .slice(0,6)
      .map(([m,d]) => ({ month:m, label:formatMonth(m), ...d }));
  }, [savings]);

  const thisMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;

  return (
    <div style={{ padding:"16px 16px 110px" }}>

      {/* ── SECTION 1 : POTENTIELLES ── */}
      <div style={sLabel}>💡 Économies potentielles</div>
      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight, marginBottom:10, marginTop:-6 }}>
        Calculées depuis ta liste de courses actuelle
      </div>

      {items.length === 0 ? (
        <div style={{ background:"#FFFBEA", borderRadius:14, padding:"20px 16px", textAlign:"center", marginBottom:24, border:`2px dashed ${C.orange}` }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🛒</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, lineHeight:1.6, marginBottom:12 }}>
            Ajoute des produits à ta liste pour voir combien tu pourrais économiser.
          </div>
          <button onClick={()=>setTab("list")} style={{ padding:"10px 20px", background:C.orange, border:"none", borderRadius:10, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#111", cursor:"pointer" }}>
            → Ma liste
          </button>
        </div>
      ) : potentials.details.length === 0 ? (
        <div style={{ background:"#FFFBEA", borderRadius:14, padding:"16px", textAlign:"center", marginBottom:24, border:`2px dashed ${C.orange}` }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, lineHeight:1.5 }}>
            Aucune donnée comparative pour les produits de ta liste. Scanne plus de tickets pour enrichir ta base.
          </div>
        </div>
      ) : (
        <div style={{ background:"#FFFBEA", borderRadius:14, padding:"16px", marginBottom:24, border:`2px solid ${C.orange}` }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:4 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:30, color:C.orange, lineHeight:1 }}>
              {potentials.totalSaving > 0.01 ? `+${potentials.totalSaving.toFixed(2)} €` : "Déjà au mieux !"}
            </div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>potentiels</div>
          </div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight, marginBottom:14 }}>
            {potentials.details.length} produit{potentials.details.length>1?"s":""} avec comparatif · en achetant chaque produit au magasin le moins cher
          </div>
          {potentials.details.map(({item, opts, saving, best, worst}, i) => (
            <div key={i} style={{ background:C.white, borderRadius:10, padding:"10px 12px", marginBottom:6, display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {item.brand?`${item.brand} · `:""}{item.product} <span style={{ color:C.gray, fontWeight:600 }}>{item.format}</span>
                </div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight, marginTop:2 }}>
                  <span style={{ color:C.green, fontWeight:800 }}>{best?.logo} {opts[0].price.toFixed(2)} €</span>
                  {" vs "}
                  <span style={{ color:"#CC3300" }}>{worst?.logo} {opts[opts.length-1].price.toFixed(2)} €</span>
                </div>
              </div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.orange, flexShrink:0 }}>
                {saving > 0.005 ? `+${saving.toFixed(2)} €` : "≈ égal"}
              </div>
            </div>
          ))}
          <button onClick={()=>setTab("compare")} style={{ width:"100%", padding:"12px", marginTop:6, background:C.orange, border:"none", borderRadius:10, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:"#111", cursor:"pointer" }}>
            🏪 Voir le comparatif complet
          </button>
        </div>
      )}

      {/* ── SECTION 2 : RÉALISÉES ── */}
      <div style={sLabel}>💰 Économies réalisées</div>
      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight, marginBottom:10, marginTop:-6 }}>
        Confirmées après chaque scan de ticket de caisse
      </div>

      {savings.length === 0 ? (
        <div style={{ background:"#F0FFF5", borderRadius:14, padding:"20px 16px", textAlign:"center", marginBottom:24, border:`2px dashed ${C.green}` }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🧾</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, lineHeight:1.6 }}>
            Scanne ton prochain ticket de caisse pour voir tes économies réelles s'accumuler ici.
          </div>
        </div>
      ) : (
        <>
          {/* Cagnotte totale */}
          <div style={{ background:"linear-gradient(135deg,#00B341,#00C850)", borderRadius:14, padding:"18px 20px", marginBottom:16, display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Cagnotte · vs prix moyen</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:32, color:C.white, lineHeight:1 }}>
                {cagnotte.vsAvg >= 0 ? "+" : ""}{cagnotte.vsAvg.toFixed(2)} €
              </div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:"rgba(255,255,255,0.7)", marginTop:4 }}>
                {savings.length} ticket{savings.length>1?"s":""} analysé{savings.length>1?"s":""}
              </div>
            </div>
            <div style={{ width:1, background:"rgba(255,255,255,0.25)", alignSelf:"stretch" }}/>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>vs + cher</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:22, color:C.white, lineHeight:1 }}>
                {cagnotte.vsMax >= 0 ? "+" : ""}{cagnotte.vsMax.toFixed(2)} €
              </div>
            </div>
          </div>

          {/* Derniers tickets */}
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
            {[...savings].reverse().slice(0,8).map((s,i) => {
              const store = STORES.find(st => st.id === s.store_id);
              const pos = (s.saved_vs_avg || 0) >= 0;
              return (
                <div key={s.id||i} style={{ background:C.white, borderRadius:12, padding:"12px 14px", border:`1px solid ${C.grayLight}`, display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:20, flexShrink:0 }}>{store?.logo || "🏪"}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {s.store_name || store?.name || "Ticket"}
                    </div>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight }}>
                      {new Date(s.date).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}
                      {" · "}
                      {s.items_compared}/{s.items_total} produit{s.items_total>1?"s":""} comparé{s.items_compared>1?"s":""}
                    </div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:pos?C.green:"#CC3300" }}>
                      {pos?"+":""}{(s.saved_vs_avg||0).toFixed(2)} €
                    </div>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, color:C.textLight }}>vs moy.</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── SECTION 3 : RÉCAP MENSUEL (réalisées uniquement) ── */}
      {monthly.length > 0 && (
        <>
          <div style={sLabel}>📅 Récapitulatif mensuel · réalisé</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {monthly.map(m => (
              <div key={m.month} style={{ display:"flex", alignItems:"center", background:m.month===thisMonthStr?"#F0FFF5":C.white, borderRadius:12, padding:"12px 14px", border:`1.5px solid ${m.month===thisMonthStr?C.green:C.grayLight}` }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{m.label}</div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.textLight, marginTop:2 }}>
                    {m.count} ticket{m.count>1?"s":""}
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:m.vsAvg>=0?C.green:"#CC3300" }}>
                    {m.vsAvg>=0?"+":""}{m.vsAvg.toFixed(2)} €
                  </div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, color:C.textLight }}>vs prix moyen</div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, color:C.textLight }}>
                    {m.vsMax>=0?"+":""}{m.vsMax.toFixed(2)} € vs + cher
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── PRICES TAB ────────────────────────────────────────────────────────────────
function PricesTab({ priceDB, setPriceDB, saveSavings }) {
  const [showImport,    setShowImport]    = useState(false);
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
  const importPrices = entries => {
    // Calcul des économies réalisées AVANT d'ajouter les nouveaux prix
    let savedVsAvg = 0, savedVsMax = 0, itemsCompared = 0;
    entries.forEach(e => {
      const eKey = `${normName(e.brand||'')}_${normName(e.product)}_${normFormat(e.format)}`;
      const others = priceDB.filter(p => {
        const pKey = `${normName(p.brand||'')}_${normName(p.product)}_${normFormat(p.format)}`;
        return pKey === eKey && p.storeId !== e.storeId;
      });
      if (others.length > 0) {
        const prices = others.map(p => p.price);
        const avg = prices.reduce((a,b)=>a+b,0) / prices.length;
        const max = Math.max(...prices);
        savedVsAvg += avg - e.price;
        savedVsMax += max - e.price;
        itemsCompared++;
      }
    });
    if (itemsCompared > 0 && saveSavings) {
      saveSavings({
        date:           entries[0]?.date || new Date().toISOString(),
        store_id:       entries[0]?.storeId || 'autre',
        store_name:     entries[0]?.store_name || '',
        saved_vs_avg:   Math.round(savedVsAvg * 100) / 100,
        saved_vs_max:   Math.round(savedVsMax * 100) / 100,
        items_compared: itemsCompared,
        items_total:    entries.length,
      });
    }
    let updated=[...priceDB];
    entries.forEach(e=>{ updated=[...updated.filter(p=>priceKey(p)!==priceKey(e)),e]; });
    setPriceDB(updated);
    showToast(`✓ ${entries.length} prix importé${entries.length>1?"s":""}`);
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

      <button onClick={()=>setShowImport(true)} style={{ width:"100%", padding:"18px", marginBottom:12, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, boxShadow:"0 6px 24px rgba(204,0,0,0.45)" }}>
        <span style={{ fontSize:22 }}>🧾</span> Importer un ticket de caisse
      </button>

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
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:entry.price===best.price?C.green:C.text }}>{entry.price.toFixed(2)} €</div>
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

      <button onClick={()=>{setEditPrice(null);setShowEntry(true);}} style={{ position:"fixed", bottom:72, right:16, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:99, padding:"13px 18px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", gap:6, boxShadow:"0 6px 20px rgba(180,0,0,0.45)", zIndex:40 }}>
        ✏️ Saisie manuelle
      </button>

      {showImport    && <ImportTicketSheet onClose={()=>setShowImport(false)} onImport={importPrices}/>}
      {showEntry     && <PriceEntrySheet  onClose={()=>{setShowEntry(false);setEditPrice(null);}} onSave={savePrice} existingPrice={editPrice}/>}
      {toast && <Toast msg={toast.msg} ok={toast.ok}/>}
    </div>
  );
}

// ── COMPARE TAB ───────────────────────────────────────────────────────────────
function CompareTab({ items, priceDB, onValidate }) {
  const F = "'Nunito',sans-serif";

  if(items.length===0) return (
    <div style={{ padding:"40px 20px 100px", textAlign:"center" }}>
      <div style={{ fontSize:60, marginBottom:14 }}>🏪</div>
      <div style={{ fontFamily:F, fontWeight:900, fontSize:17, color:"#CC0000", marginBottom:6 }}>Ta liste est vide</div>
      <div style={{ fontFamily:F, fontSize:13, color:C.textLight }}>Ajoute des produits dans "Liste" pour comparer</div>
    </div>
  );

  const analysis = useMemo(()=>{
    return items.map(item=>{
      const matches = priceDB.filter(p=>itemMatchesPrice(item,p));
      const byStore = {};
      matches.forEach(p=>{
        if(!byStore[p.storeId]||new Date(p.date)>new Date(byStore[p.storeId].date)) byStore[p.storeId]=p;
      });
      return { item, byStore };
    });
  },[items,priceDB]);

  const storeTotals = useMemo(()=>{
    const totals={};
    STORES.forEach(s=>{ totals[s.id]={total:0,found:0,missing:[]}; });
    analysis.forEach(({item,byStore})=>{
      STORES.forEach(s=>{
        if(byStore[s.id]){ totals[s.id].total+=byStore[s.id].price*item.qty; totals[s.id].found+=1; }
        else              { totals[s.id].missing.push(item.product); }
      });
    });
    return totals;
  },[analysis]);

  const ranked       = STORES.map(s=>({...s,...storeTotals[s.id]})).filter(s=>s.found>0).sort((a,b)=>b.found!==a.found?b.found-a.found:a.total-b.total);
  const best         = ranked[0];
  const worstTotal   = ranked.length>1 ? ranked[ranked.length-1].total : 0;
  const maxSavings   = best ? worstTotal - best.total : 0;
  const totalItems   = items.reduce((a,i)=>a+i.qty,0);
  const missingGlobal= items.filter(item=>!priceDB.some(p=>itemMatchesPrice(item,p)));


  return (
    <div style={{ padding:"16px 16px 110px" }}>

      {/* Résumé liste */}
      <div style={{ background:C.blue, borderRadius:14, padding:"14px 18px", marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ fontSize:30 }}>🛒</div>
        <div>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:C.white }}>
            {items.length} produit{items.length>1?"s":""} · {totalItems} article{totalItems>1?"s":""}
          </div>
          {maxSavings>0.05 && (
            <div style={{ fontFamily:F, fontSize:12, color:"rgba(255,255,255,0.75)", marginTop:2 }}>
              Jusqu'à <strong style={{ color:"#FFD700" }}>{maxSavings.toFixed(2)} €</strong> d'écart entre magasins
            </div>
          )}
        </div>
      </div>

      {/* Aucun prix */}
      {ranked.length===0 && (
        <div style={{ background:C.orangeLight, borderRadius:14, padding:"24px 20px", textAlign:"center", border:`2px dashed ${C.orange}` }}>
          <div style={{ fontSize:40, marginBottom:10 }}>💰</div>
          <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:C.orange, marginBottom:6 }}>Aucun prix correspondant</div>
          <div style={{ fontFamily:F, fontSize:13, color:C.textLight }}>Vérifie le <strong>nom</strong> et le <strong>format</strong> dans "Mes prix".</div>
        </div>
      )}

      {/* Produits sans aucun prix */}
      {missingGlobal.length>0 && ranked.length>0 && (
        <div style={{ background:"#FFF8E6", borderRadius:12, padding:"12px 14px", marginBottom:14, border:`1px solid ${C.yellow}` }}>
          <div style={{ fontFamily:F, fontWeight:800, fontSize:13, color:"#7A6000", marginBottom:6 }}>⚠️ Aucun prix enregistré pour :</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {missingGlobal.map(item=>(
              <span key={item.id} style={{ background:C.yellow, borderRadius:99, padding:"3px 10px", fontFamily:F, fontSize:12, fontWeight:700, color:C.text }}>
                {item.brand?`${item.brand} · `:""}{item.product} {item.format}
              </span>
            ))}
          </div>
        </div>
      )}

      {ranked.length>0 && (
        <>
          {/* ── MEILLEUR MAGASIN (grand) ── */}
          <div style={{ background:"linear-gradient(145deg,#CC0000,#E00000)", borderRadius:18, overflow:"hidden", marginBottom:16, boxShadow:"0 10px 32px rgba(204,0,0,0.45)", animation:"slideIn 0.3s ease both" }}>

            {/* Badge + Prix total */}
            <div style={{ padding:"18px 18px 0", display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
              <div style={{ background:C.orange, borderRadius:8, padding:"4px 12px", fontFamily:F, fontWeight:900, fontSize:11, color:C.white, letterSpacing:"0.04em" }}>
                🥇 MEILLEUR PRIX
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:34, color:C.white, lineHeight:1 }}>{best.total.toFixed(2)} €</div>
                {maxSavings>0.05 && <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.6)", marginTop:2 }}>−{maxSavings.toFixed(2)} € vs le + cher</div>}
              </div>
            </div>

            {/* Nom magasin */}
            <div style={{ padding:"10px 18px 14px", display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:26 }}>{best.logo}</span>
              <div>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:20, color:C.white }}>{best.name}</div>
                <div style={{ fontFamily:F, fontSize:12, color:"rgba(255,255,255,0.6)" }}>
                  {best.found}/{items.length} produit{items.length>1?"s":""} trouvé{best.found>1?"s":""}
                  {best.missing.length>0 && <span style={{ color:"#FFD700" }}> · {best.missing.length} manquant{best.missing.length>1?"s":""}</span>}
                </div>
              </div>
            </div>

            {/* Liste des articles */}
            <div style={{ background:"rgba(0,0,0,0.18)", marginBottom:12 }}>
              {analysis.map(({item,byStore})=>{
                const p       = byStore[best.id];
                const total   = p ? p.price*item.qty : null;
                // Meilleur magasin alternatif pour ce produit manquant
                const bestAlt = total===null
                  ? Object.entries(byStore)
                      .map(([sid,pr])=>({ store:STORES.find(s=>s.id===sid), pr }))
                      .sort((a,b)=>a.pr.price-b.pr.price)[0]
                  : null;
                return (
                  <div key={item.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 18px" }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:F, fontWeight:700, fontSize:13, color:"rgba(255,255,255,0.92)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {item.brand?`${item.brand} · `:""}{item.product}
                        </div>
                        <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:1 }}>
                          {item.format}{item.qty>1?` × ${item.qty}`:""}
                        </div>
                      </div>
                      {total!==null ? (
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          <div style={{ fontFamily:F, fontWeight:900, fontSize:15, color:"#FFD700" }}>{total.toFixed(2)} €</div>
                          {item.qty>1 && <div style={{ fontFamily:F, fontSize:10, color:"rgba(255,255,255,0.4)" }}>{p.price.toFixed(2)} €/u</div>}
                        </div>
                      ) : (
                        <span style={{ fontFamily:F, fontSize:12, fontWeight:800, color:"#FFD700", flexShrink:0 }}>⚠️ manquant</span>
                      )}
                    </div>
                    {bestAlt && (
                      <div style={{ padding:"0 18px 9px 30px", display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontSize:13 }}>{bestAlt.store?.logo}</span>
                        <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.5)", flex:1 }}>
                          → <span style={{ fontWeight:800, color:"rgba(255,255,255,0.78)" }}>{bestAlt.store?.name}</span>
                        </div>
                        <div style={{ fontFamily:F, fontWeight:800, fontSize:12, color:"rgba(255,255,255,0.7)" }}>
                          {(bestAlt.pr.price*item.qty).toFixed(2)} €
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bouton valider */}
            <div style={{ padding:"0 12px 16px" }}>
              <button onClick={()=>onValidate(best)} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:C.orange, fontFamily:F, fontWeight:900, fontSize:16, color:"#111", cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.25)" }}>
                ✅ Je fais mes courses chez {best.name}
              </button>
            </div>
          </div>

        </>
      )}
    </div>
  );
}

// ── ARCHIVE TAB ───────────────────────────────────────────────────────────────
function ArchiveTab({ archives, onDelete }) {
  const [pendingDeleteArc, setPendingDeleteArc] = useState(null);

  if(archives.length===0) return (
    <div style={{ padding:"40px 20px 100px", textAlign:"center" }}>
      <div style={{ fontSize:60, marginBottom:14 }}>📦</div>
      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:C.blue, marginBottom:6 }}>Pas encore d'historique</div>
      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>Valide ta première liste pour voir l'historique</div>
    </div>
  );
  const totalSpent=archives.reduce((a,arc)=>a+arc.total,0);
  return (
    <div style={{ padding:"16px 16px 110px" }}>
      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        <div style={{ flex:1, background:C.blue, borderRadius:12, padding:"12px 14px" }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)", textTransform:"uppercase", letterSpacing:"0.06em" }}>Courses</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.white }}>{archives.length}</div>
        </div>
        <div style={{ flex:1, background:C.green, borderRadius:12, padding:"12px 14px" }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)", textTransform:"uppercase", letterSpacing:"0.06em" }}>Total dépensé</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.white }}>{totalSpent.toFixed(0)} €</div>
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {[...archives].reverse().map((arc,i)=>(
          <div key={arc.id} style={{ background:C.white, borderRadius:14, border:`1px solid ${C.grayLight}`, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.06)", animation:`slideIn 0.25s ease ${i*0.06}s both` }}>
            <div style={{ background:C.blueLight, padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.blue }}>{arc.store.logo} {arc.store.name}</div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginTop:1 }}>{new Date(arc.date).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ background:C.blue, borderRadius:10, padding:"6px 14px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.white }}>{arc.total.toFixed(2)} €</div>
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
                <span key={j} style={{ background:C.grayLight, borderRadius:99, padding:"4px 12px", fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:700, color:C.textLight }}>
                  {item.brand?`${item.brand} · `:""}{item.product} {item.format} ×{item.qty}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]           = useState("list");
  const [items, setItems]       = useState([]);
  const [priceDB, setPriceDB]     = useState([]);
  const [archives, setArchives]   = useState([]);
  const [showSuccess, setShowSuccess] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [savings,   setSavings]   = useState([]);
  const [loaded, setLoaded]       = useState(false);
  const [produitsRef, setProduitsRef] = useState([]);
  const catalog = useMemo(() => {
    const split = s => s ? s.split(';').map(x => x.trim()).filter(Boolean) : [];
    const refProducts = produitsRef.map(p => ({
      product_name: p.produit_generique,
      category: p.sous_categorie,
      formats: split(p.formats_courants),
      marques_nationales: split(p.marques_nationales),
      marques_distributeurs: split(p.marques_distributeurs),
    }));
    const seen = new Set(refProducts.map(p => p.product_name.toLowerCase()));
    const priceProducts = priceDB
      .filter(p => p.product?.trim() && !seen.has(p.product.trim().toLowerCase()))
      .map(p => ({ product_name: p.product.trim(), category: p.category || guessCategory(p.product) }))
      .filter(p => { const k = p.product_name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    return [...refProducts, ...priceProducts];
  }, [produitsRef, priceDB]);

  const listRowId = useRef(null);
  const favRowId  = useRef(null);
  const [appToast, setAppToast] = useState(null);
  const showAppToast = (msg, ok=true) => { setAppToast({msg,ok}); setTimeout(()=>setAppToast(null),3000); };

  useEffect(()=>{
    (async ()=>{
      try {
        const [list, prices, arcs, favs, refs, savs] = await Promise.all([
          supabase.from('shopping_list').select('id, items').order('id').limit(1),
          supabase.from('price_db').select('*'),
          supabase.from('archives').select('*').order('date'),
          supabase.from('favorites').select('id, items').order('id').limit(1),
          supabase.from('produits_ref').select('produit_generique, sous_categorie, formats_courants, marques_nationales, marques_distributeurs').order('id'),
          supabase.from('savings').select('*').order('date'),
        ]);
        if (refs.data)  setProduitsRef(refs.data);
        if (savs.data)  setSavings(savs.data);
        if (list.data?.[0]) { setItems(list.data[0].items || []); listRowId.current = list.data[0].id; }
        if (prices.data) {
          setPriceDB(prices.data.map(p => ({ ...p, storeId: p.storeId || 'autre', category: p.category || guessCategory(p.product) })));
          const toFix = prices.data.filter(p => !p.category);
          if (toFix.length > 0) {
            supabase.from('price_db').upsert(toFix.map(p => ({ ...p, category: guessCategory(p.product) })));
          }
        }
        if (arcs.data) setArchives(arcs.data);
        if (favs.data?.[0]) { setFavorites(favs.data[0].items || []); favRowId.current = favs.data[0].id; }
      } catch(e){ console.log("Supabase load:", e); }
      setLoaded(true);
    })();
  },[]);

  const saveItems = async (v) => {
    setItems(v);
    try {
      if (listRowId.current) {
        const { error } = await supabase.from('shopping_list').update({items:v}).eq('id', listRowId.current);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('shopping_list').insert({items:v}).select('id').single();
        if (error) throw error;
        if (data) listRowId.current = data.id;
      }
    } catch(e) {
      console.error("Erreur sauvegarde liste :", e);
      showAppToast("⚠️ Sauvegarde échouée, vérifie ta connexion", false);
    }
  };
  const savePriceDB = async (v) => {
    setPriceDB(v);
    const clean = v.map(p => ({
      product: p.product,
      format: p.format,
      brand: p.brand || '',
      storeId: p.storeId || '',
      store_name: p.store_name || '',
      store_address: p.store_address || '',
      price: parseFloat(p.price),
      date: p.date || new Date().toISOString(),
      category: p.category || guessCategory(p.product),
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
      const { error } = await supabase.from('archives').insert(rest);
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
        const { data, error } = await supabase.from('favorites').insert({items:v}).select('id').single();
        if (error) throw error;
        if (data) favRowId.current = data.id;
      }
    } catch(e) {
      console.error("Erreur sauvegarde favoris :", e);
      showAppToast("⚠️ Favoris non sauvegardés, vérifie ta connexion", false);
    }
  };

  const saveSavings = async (entry) => {
    const { data, error } = await supabase.from('savings')
      .insert({
        date:           entry.date,
        store_id:       entry.store_id,
        store_name:     entry.store_name,
        saved_vs_avg:   entry.saved_vs_avg,
        saved_vs_max:   entry.saved_vs_max,
        items_compared: entry.items_compared,
        items_total:    entry.items_total,
      })
      .select('id').single();
    if (!error && data) setSavings(prev => [...prev, { ...entry, id: data.id }]);
    else if (error) console.error("Erreur sauvegarde économies :", error);
  };

  const handleValidate = store => {
    const arc={id:Date.now(),date:new Date().toISOString(),store,total:store.total,items:[...items]};
    saveArchives([...archives,arc]);
    saveItems([]);
    setShowSuccess(store);
    setTimeout(()=>{setShowSuccess(null);setTab("archive");},2800);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#F8F8F8;} ::selection{background:#CC0000;color:white;}
        @keyframes slideIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn {from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes spin   {to{transform:rotate(360deg)}}
        @keyframes popIn  {0%{opacity:0;transform:scale(0.85)}60%{transform:scale(1.04)}100%{opacity:1;transform:scale(1)}}
        input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
        textarea:focus,input:focus{outline:none;}
      `}</style>
      <div style={{ minHeight:"100vh", background:C.bg, maxWidth:430, margin:"0 auto" }}>
        <Header tab={tab} itemCount={items.length}/>
        <div style={{ paddingTop:4 }}>
          {!loaded && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:200, gap:16 }}>
              <div style={{ width:40, height:40, border:"4px solid #EFEFEF", borderTopColor:"#CC0000", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, color:"#999" }}>Chargement...</div>
            </div>
          )}
          {loaded && tab==="list"      && <ListTab      items={items} setItems={saveItems} setTab={setTab} favorites={favorites} saveFavorites={saveFavorites}/>}
          {loaded && tab==="catalog"   && <CatalogTab   items={items} setItems={saveItems} setTab={setTab} catalog={catalog} priceDB={priceDB}/>}
          {loaded && tab==="compare"   && <CompareTab   items={items} priceDB={priceDB} onValidate={handleValidate}/>}
          {loaded && tab==="prices"    && <PricesTab    priceDB={priceDB} setPriceDB={savePriceDB} saveSavings={saveSavings}/>}
          {loaded && tab==="archive"   && <ArchiveTab   archives={archives} onDelete={deleteArchive}/>}
          {loaded && tab==="economies" && <EconomiesTab priceDB={priceDB} savings={savings} items={items} setTab={setTab}/>}
        </div>
        <TabBar tab={tab} setTab={setTab}/>
        {appToast && <Toast msg={appToast.msg} ok={appToast.ok}/>}
        {showSuccess && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, animation:"fadeIn 0.2s ease" }}>
            <div style={{ background:C.white, borderRadius:20, padding:"36px 32px", textAlign:"center", maxWidth:300, width:"90%", animation:"popIn 0.35s ease", boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
              <div style={{ fontSize:56, marginBottom:12 }}>🎉</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:"#CC0000", marginBottom:8 }}>Bonne course !</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, color:C.textLight, lineHeight:1.6 }}>
                Liste archivée.<br/>Direction <strong style={{ color:"#CC0000" }}>{showSuccess.name}</strong> {showSuccess.logo} !
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
