import { useState, useEffect, useMemo } from "react";

const C = {
  blue:      "#CC0000",   blueLight:  "#FFF0F0",
  orange:     "#FFD000",   orangeLight: "#FFFBEA",
  white:      "#FFFFFF",   bg:          "#F8F8F8",
  gray:       "#999999",   grayLight:   "#EFEFEF",
  text:       "#111111",   textLight:   "#555555",
  green:      "#00B341",   red:         "#CC0000",   yellow: "#FFD000",
};

const STORES = [
  { id:"leclerc",     name:"E.Leclerc",  logo:"🔵" },
  { id:"carrefour",  name:"Carrefour",   logo:"🔴" },
  { id:"auchan",     name:"Auchan",      logo:"🟠" },
  { id:"lidl",       name:"Lidl",        logo:"🟡" },
  { id:"intermarche",name:"Intermarché", logo:"🟢" },
  { id:"monoprix",   name:"Monoprix",    logo:"🟣" },
  { id:"autre",      name:"Autre",       logo:"🏪" },
];

// Exemples de suggestions produit + format
const PRODUCT_SUGGESTIONS = [
  { name:"Lait demi-écrémé", format:"1L" },
  { name:"Pâtes spaghetti",  format:"500g" },
  { name:"Beurre doux",      format:"250g" },
  { name:"Oeufs",            format:"x6" },
  { name:"Cola Zéro",        format:"1L" },
  { name:"Riz long grain",   format:"1kg" },
  { name:"Jambon",           format:"4 tranches" },
  { name:"Yaourt nature",    format:"x4" },
  { name:"Farine T55",       format:"1kg" },
  { name:"Sucre en poudre",  format:"1kg" },
];


// ── CATALOGUE PAR CATÉGORIE ───────────────────────────────────────────────────
const CATALOGUE = [
  {
    id:"epicerie-salee", name:"Épicerie Salée", emoji:"🍝", color:"#FF6B35",
    products:[
      { name:"Pâtes spaghetti",   formats:["500g","1kg"],        brands:["Barilla","Panzani","Lustucru","MDD"] },
      { name:"Riz long grain",    formats:["1kg","2kg","5kg"],   brands:["Oncle Ben's","Taureau Ailé","MDD"] },
      { name:"Farine T55",        formats:["1kg","2kg"],         brands:["Francine","MDD"] },
      { name:"Huile d'olive",     formats:["50cl","75cl","1L"],  brands:["Puget","Lesieur","MDD"] },
      { name:"Thon en boîte",     formats:["140g","3x140g"],     brands:["Petit Navire","MDD"] },
      { name:"Soupe tomate",      formats:["330ml","1L"],        brands:["Liebig","Knorr","MDD"] },
    ]
  },
  {
    id:"epicerie-sucree", name:"Épicerie Sucrée", emoji:"🍫", color:"#8B4513",
    products:[
      { name:"Nutella",           formats:["200g","400g","750g"], brands:["Nutella"] },
      { name:"Confiture fraise",  formats:["370g","750g"],        brands:["Bonne Maman","MDD"] },
      { name:"Sucre en poudre",   formats:["1kg","2kg"],          brands:["Béghin Say","MDD"] },
      { name:"Chocolat noir",     formats:["100g","200g"],        brands:["Lindt","Milka","MDD"] },
      { name:"Céréales",          formats:["375g","500g","750g"], brands:["Kellogg's","Jordans","MDD"] },
      { name:"Biscuits",          formats:["150g","200g","300g"], brands:["Lu","BN","Oreo","MDD"] },
    ]
  },
  {
    id:"produits-laitiers", name:"Produits Laitiers", emoji:"🥛", color:"#4A90D9",
    products:[
      { name:"Lait demi-écrémé",  formats:["1L","6x1L"],         brands:["Lactel","Candia","MDD"] },
      { name:"Beurre doux",       formats:["125g","250g","500g"], brands:["Président","Elle & Vire","MDD"] },
      { name:"Yaourt nature",     formats:["x4","x8","x12"],      brands:["Danone","Yoplait","MDD"] },
      { name:"Fromage râpé",      formats:["100g","200g","400g"], brands:["Président","Entremont","MDD"] },
      { name:"Crème fraîche",     formats:["20cl","33cl"],        brands:["Président","Elle & Vire","MDD"] },
      { name:"Fromage blanc",     formats:["500g","1kg"],         brands:["Danone","MDD"] },
    ]
  },
  {
    id:"boissons", name:"Boissons", emoji:"🥤", color:"#E8001E",
    products:[
      { name:"Cola Zéro",         formats:["1L","1,5L","6x33cl"], brands:["Coca-Cola","Pepsi","Look","MDD"] },
      { name:"Cola",              formats:["1L","1,5L","6x33cl"], brands:["Coca-Cola","Pepsi","MDD"] },
      { name:"Eau plate",         formats:["1,5L","6x1,5L"],      brands:["Evian","Volvic","MDD"] },
      { name:"Jus d'orange",      formats:["1L","2L"],            brands:["Tropicana","Innocent","MDD"] },
      { name:"Café moulu",        formats:["250g","500g"],         brands:["Lavazza","Grand'Mère","MDD"] },
      { name:"Thé noir",          formats:["x20","x50"],          brands:["Lipton","Elephant","MDD"] },
    ]
  },
  {
    id:"fruits-legumes", name:"Fruits & Légumes", emoji:"🥦", color:"#27AE60",
    products:[
      { name:"Pommes",            formats:["1kg","1,5kg","2kg"],  brands:["Vrac"] },
      { name:"Bananes",           formats:["1kg","1,5kg"],        brands:["Chiquita","Vrac"] },
      { name:"Tomates",           formats:["500g","1kg"],         brands:["Vrac"] },
      { name:"Carottes",          formats:["1kg","2kg"],          brands:["Vrac","MDD"] },
      { name:"Salade verte",      formats:["x1","sachet"],        brands:["Florette","Vrac"] },
      { name:"Pommes de terre",   formats:["1,5kg","2,5kg","5kg"],brands:["Vrac","MDD"] },
    ]
  },
  {
    id:"viandes-poissons", name:"Viandes & Poissons", emoji:"🥩", color:"#C0392B",
    products:[
      { name:"Poulet entier",     formats:["1kg","1,5kg","2kg"],  brands:["Label Rouge","MDD"] },
      { name:"Jambon cuit",       formats:["4 tranches","6 tranches","8 tranches"], brands:["Fleury Michon","Herta","MDD"] },
      { name:"Steak haché",       formats:["2x100g","4x100g"],    brands:["Charal","MDD"] },
      { name:"Saumon fumé",       formats:["2 tranches","4 tranches"], brands:["Labeyrie","MDD"] },
      { name:"Filets de cabillaud",formats:["200g","400g"],       brands:["Findus","MDD"] },
    ]
  },
  {
    id:"hygiene-maison", name:"Hygiène & Maison", emoji:"🧴", color:"#8E44AD",
    products:[
      { name:"Papier toilette",   formats:["x6","x12","x24"],     brands:["Lotus","Le Trefle","MDD"] },
      { name:"Lessive liquide",   formats:["1,5L","2,5L","3L"],   brands:["Ariel","Skip","MDD"] },
      { name:"Liquide vaisselle", formats:["500ml","750ml","1L"],  brands:["Fairy","Sun","MDD"] },
      { name:"Shampooing",        formats:["250ml","400ml"],       brands:["Head&Shoulders","Elseve","MDD"] },
      { name:"Dentifrice",        formats:["75ml","100ml"],        brands:["Signal","Colgate","MDD"] },
    ]
  },
  {
    id:"surgeles", name:"Surgelés", emoji:"🧊", color:"#2980B9",
    products:[
      { name:"Haricots verts",    formats:["600g","1kg"],         brands:["Bonduelle","MDD"] },
      { name:"Pizza Margherita",  formats:["400g","550g"],        brands:["Dr. Oetker","Buitoni","MDD"] },
      { name:"Frites",            formats:["600g","1kg","2kg"],   brands:["McCain","MDD"] },
      { name:"Glace vanille",     formats:["500ml","1L","2L"],    brands:["Häagen-Dazs","Ben&Jerry's","MDD"] },
      { name:"Poisson pané",      formats:["200g","400g"],        brands:["Findus","MDD"] },
    ]
  },
];
const STALE_DAYS = 30;
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

// Clé unique d'un article de prix : marque+produit+format+magasin
function priceKey(p){ return `${(p.brand||"").toLowerCase()}_${p.product.toLowerCase()}_${(p.format||"").toLowerCase()}_${p.storeId}`; }

// Clé de matching pour la liste : produit+format+(marque si précisée)
function itemMatchesPrice(item, price) {
  const sameProduct = price.product.toLowerCase().trim() === item.product.toLowerCase().trim();
  const sameFormat  = price.format.toLowerCase().trim() === item.format.toLowerCase().trim();
  const brandOk     = !item.brand || item.brand.toLowerCase().trim() === (price.brand||"").toLowerCase().trim();
  return sameProduct && sameFormat && brandOk;
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function Header({ tab, itemCount }) {
  const titles = { list:"Ma liste", catalog:"Catalogue", compare:"Comparer", prices:"Mes prix", archive:"Historique" };
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
    { id:"list",    icon:"📋", label:"Liste"     },
    { id:"catalog", icon:"🛍️", label:"Catalogue" },
    { id:"compare", icon:"🏪", label:"Comparer"  },
    { id:"prices",  icon:"💰", label:"Mes prix"  },
    { id:"archive", icon:"📦", label:"Historique"},
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
      setError("");
      setStatus("preview");
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
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:"rgba(255,255,255,0.75)" }}>Envoie la photo à Claude → colle le JSON ici</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:99, width:28, height:28, color:C.white, fontSize:14, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ overflowY:"auto", flex:1, padding:"20px 20px 44px" }}>
          {status==="idle" && (
            <>
              <div style={{ background:C.blueLight, borderRadius:14, padding:"16px", marginBottom:16 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.blue, marginBottom:10 }}>Comment ça marche :</div>
                {[
                  {n:"1",t:"Envoie une photo de ton ticket à Claude dans le chat"},
                  {n:"2",t:"Claude répond avec un JSON (marque + produit + format + prix)"},
                  {n:"3",t:"Copie le JSON et colle-le ici"},
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

              <div style={{ marginBottom:16 }}>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Magasin : <span style={{ color:C.blue }}>{result.store}</span></div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {STORES.map(s=>(
                    <button key={s.id} onClick={()=>setSelectedStore(s.id)} style={{ padding:"6px 12px", background:selectedStore===s.id?C.blue:C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:12, color:selectedStore===s.id?C.white:C.text, cursor:"pointer" }}>
                      {s.logo} {s.name}
                    </button>
                  ))}
                </div>
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
  const [price,   setPrice]   = useState(existingPrice?.price?.toString()||"");
  const canSubmit = product&&format&&storeId&&price&&!isNaN(parseFloat(price));

  const submit = () => {
    if(!canSubmit) return;
    onSave({ brand:brand.trim(), product:product.trim(), format:format.trim(), storeId, price:parseFloat(price), date:new Date().toISOString() });
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
function ProductPickerSheet({ category, onClose, onAdd, items }) {
  const [selected, setSelected] = useState(null); // produit sélectionné
  const [format,   setFormat]   = useState("");
  const [brand,    setBrand]    = useState("");
  const [brandFixed, setBrandFixed] = useState(false);
  const [qty,      setQty]      = useState(1);
  const [added,    setAdded]    = useState([]);

  const submit = () => {
    if(!selected || !format) return;
    const item = { id:Date.now()+Math.random(), product:selected.name, format, brand:brandFixed?brand:"", qty, checked:false };
    onAdd(item);
    setAdded(prev=>[...prev,item]);
    setSelected(null); setFormat(""); setBrand(""); setQty(1); setBrandFixed(false);
  };

  const alreadyIn = (name) => items.some(i=>i.product===name);

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
                {category.products.map((p,i)=>{
                  const inList = alreadyIn(p.name);
                  return (
                    <button key={i} onClick={()=>{ setSelected(p); setFormat(p.formats[0]); setBrand(""); }} style={{
                      padding:"14px 12px", background:inList?"#F0FFF5":C.white,
                      border:`2px solid ${inList?C.green:C.grayLight}`,
                      borderRadius:14, cursor:"pointer", textAlign:"left",
                      boxShadow:"0 2px 8px rgba(0,0,0,0.06)",
                      position:"relative",
                    }}>
                      {inList && <span style={{ position:"absolute", top:6, right:8, fontSize:12 }}>✓</span>}
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, marginBottom:4 }}>{p.name}</div>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.gray }}>{p.formats.join(" · ")}</div>
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

              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:C.text, marginBottom:4 }}>{selected.name}</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.gray, marginBottom:20 }}>{category.name}</div>

              {/* Format */}
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Format</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:18 }}>
                {selected.formats.map(f=>(
                  <button key={f} onClick={()=>setFormat(f)} style={{ padding:"9px 16px", background:format===f?"#CC0000":C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:format===f?C.white:C.text, cursor:"pointer" }}>{f}</button>
                ))}
              </div>

              {/* Marque */}
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Marque</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:18 }}>
                <button onClick={()=>{setBrandFixed(false);setBrand("");}} style={{ padding:"9px 16px", background:!brandFixed?C.orange:C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:!brandFixed?"#111111":C.text, cursor:"pointer" }}>
                  Peu importe
                </button>
                {selected.brands.map(b=>(
                  <button key={b} onClick={()=>{setBrandFixed(true);setBrand(b==="MDD"?"":b);}} style={{ padding:"9px 16px", background:(brandFixed&&brand===(b==="MDD"?"":b))?"#CC0000":C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:(brandFixed&&brand===(b==="MDD"?"":b))?C.white:C.text, cursor:"pointer" }}>
                    {b==="MDD"?"Marque Distrib.":b}
                  </button>
                ))}
              </div>

              {/* Quantité */}
              <div style={{ display:"flex", alignItems:"center", background:C.grayLight, borderRadius:12, padding:"10px 16px", marginBottom:20 }}>
                <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, flex:1 }}>Quantité</span>
                <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                  <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{ width:32, height:32, borderRadius:99, border:"2px solid #CC0000", background:C.white, cursor:"pointer", color:"#CC0000", fontWeight:900, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
                  <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:"#CC0000", minWidth:24, textAlign:"center" }}>{qty}</span>
                  <button onClick={()=>setQty(q=>q+1)} style={{ width:32, height:32, borderRadius:99, border:"none", background:"#CC0000", cursor:"pointer", color:C.white, fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
                </div>
              </div>

              <button onClick={submit} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:"#111111", cursor:"pointer", boxShadow:"0 6px 16px rgba(200,160,0,0.4)" }}>
                + Ajouter à ma liste
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CatalogTab({ items, setItems, setTab }) {
  const [selectedCat, setSelectedCat] = useState(null);
  const totalInList = items.filter(i=>!i.checked).length;

  const addItem = item => setItems([...items, item]);

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
        {CATALOGUE.map((cat,i)=>{
          const count = items.filter(item=>cat.products.some(p=>p.name===item.product)).length;
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
                  {cat.products.length} produits
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedCat && (
        <ProductPickerSheet
          category={selectedCat}
          onClose={()=>setSelectedCat(null)}
          onAdd={addItem}
          items={items}
        />
      )}
    </div>
  );
}

// ── LIST TAB ──────────────────────────────────────────────────────────────────
function ListTab({ items, setItems, setTab, favorites, saveFavorites }) {
  const [showAdd,      setShowAdd]      = useState(false);
  const [showFavModal, setShowFavModal] = useState(false);

  const addItem     = item => setItems([...items, item]);
  const toggleCheck = id  => setItems(items.map(i=>i.id===id?{...i,checked:!i.checked}:i));
  const removeItem  = id  => setItems(items.filter(i=>i.id!==id));
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
                      <span key={i} style={{ background:C.white, borderRadius:99, padding:"4px 12px", fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:700, color:C.text, border:`1px solid ${C.grayLight}` }}>
                        {f.brand?`${f.brand} · `:""}{f.product} <span style={{ color:C.gray }}>{f.format}</span> ×{f.qty}
                      </span>
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

// ── PRICES TAB ────────────────────────────────────────────────────────────────
function PricesTab({ priceDB, setPriceDB }) {
  const [showImport, setShowImport] = useState(false);
  const [showEntry,  setShowEntry]  = useState(false);
  const [editPrice,  setEditPrice]  = useState(null);
  const [filterStore,setFilterStore]= useState("all");

  const savePrice = entry => {
    const updated=[...priceDB.filter(p=>priceKey(p)!==priceKey(entry)),{...entry,id:Date.now()}];
    setPriceDB(updated);
  };
  const importPrices = entries => {
    let updated=[...priceDB];
    entries.forEach(e=>{ updated=[...updated.filter(p=>priceKey(p)!==priceKey(e)),e]; });
    setPriceDB(updated);
  };
  const deletePrice = id => setPriceDB(priceDB.filter(p=>p.id!==id));

  const grouped = useMemo(()=>{
    const filtered=filterStore==="all"?priceDB:priceDB.filter(p=>p.storeId===filterStore);
    return filtered.reduce((acc,p)=>{
      const key=`${p.brand||""}_${p.product}_${p.format}`.toLowerCase();
      if(!acc[key]) acc[key]={brand:p.brand, product:p.product, format:p.format, entries:[]};
      acc[key].entries.push(p);
      return acc;
    },{});
  },[priceDB,filterStore]);

  return (
    <div style={{ padding:"16px 16px 110px" }}>
      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        <div style={{ flex:1, background:C.blue, borderRadius:12, padding:"12px 14px" }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)", textTransform:"uppercase", letterSpacing:"0.06em" }}>Prix enregistrés</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.white }}>{priceDB.length}</div>
        </div>
        <div style={{ flex:1, background:C.green, borderRadius:12, padding:"12px 14px" }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.65)", textTransform:"uppercase", letterSpacing:"0.06em" }}>Produits distincts</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:24, color:C.white }}>{Object.keys(grouped).length}</div>
        </div>
      </div>

      <button onClick={()=>setShowImport(true)} style={{ width:"100%", padding:"18px", marginBottom:12, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, boxShadow:"0 6px 24px rgba(204,0,0,0.45)" }}>
        <span style={{ fontSize:22 }}>🧾</span> Importer un ticket de caisse
      </button>

      {priceDB.length>0 && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
          <button onClick={()=>setFilterStore("all")} style={{ padding:"6px 12px", background:filterStore==="all"?C.blue:C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:12, color:filterStore==="all"?C.white:C.text, cursor:"pointer" }}>Tous</button>
          {STORES.filter(s=>priceDB.some(p=>p.storeId===s.id)).map(s=>(
            <button key={s.id} onClick={()=>setFilterStore(s.id)} style={{ padding:"6px 12px", background:filterStore===s.id?C.blue:C.grayLight, border:"none", borderRadius:99, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:12, color:filterStore===s.id?C.white:C.text, cursor:"pointer" }}>
              {s.logo} {s.name}
            </button>
          ))}
        </div>
      )}

      {priceDB.length===0 && (
        <div style={{ background:C.orangeLight, borderRadius:16, padding:"28px 24px", textAlign:"center", marginBottom:16, border:`2px dashed ${C.orange}` }}>
          <div style={{ fontSize:44, marginBottom:10 }}>🧾</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.orange, marginBottom:6 }}>Aucun prix encore</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, lineHeight:1.5 }}>Envoie une photo de ton ticket à Claude → importe le JSON ici !</div>
        </div>
      )}

      {Object.values(grouped).map(group=>{
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
                  <button onClick={()=>deletePrice(entry.id)} style={{ background:"none", border:"none", fontSize:14, cursor:"pointer", color:C.gray }}>✕</button>
                </div>
              );
            })}
          </div>
        );
      })}

      <button onClick={()=>{setEditPrice(null);setShowEntry(true);}} style={{ position:"fixed", bottom:72, right:16, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:99, padding:"13px 18px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", gap:6, boxShadow:"0 6px 20px rgba(180,0,0,0.45)", zIndex:40 }}>
        ✏️ Saisie manuelle
      </button>

      {showImport && <ImportTicketSheet onClose={()=>setShowImport(false)} onImport={importPrices}/>}
      {showEntry  && <PriceEntrySheet  onClose={()=>{setShowEntry(false);setEditPrice(null);}} onSave={savePrice} existingPrice={editPrice}/>}
    </div>
  );
}

// ── COMPARE TAB ───────────────────────────────────────────────────────────────
function CompareTab({ items, priceDB, onValidate }) {
  if(items.length===0) return (
    <div style={{ padding:"40px 20px 100px", textAlign:"center" }}>
      <div style={{ fontSize:60, marginBottom:14 }}>🏪</div>
      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:17, color:"#CC0000", marginBottom:6 }}>Ta liste est vide</div>
      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>Ajoute des produits dans "Liste" pour comparer</div>
    </div>
  );

  // Pour chaque item de la liste, trouver les prix correspondants dans priceDB
  // matching : même produit + même format + (même marque si marque fixée)
  const analysis = useMemo(()=>{
    return items.map(item=>{
      const matches = priceDB.filter(p=>itemMatchesPrice(item,p));
      // grouper par magasin (garder le plus récent si doublon)
      const byStore = {};
      matches.forEach(p=>{
        if(!byStore[p.storeId]||new Date(p.date)>new Date(byStore[p.storeId].date)) byStore[p.storeId]=p;
      });
      return { item, byStore };
    });
  },[items,priceDB]);

  // Totaux par magasin
  const storeTotals = useMemo(()=>{
    const totals={};
    STORES.forEach(s=>{ totals[s.id]={total:0,found:0,missing:[]}; });
    analysis.forEach(({item,byStore})=>{
      STORES.forEach(s=>{
        if(byStore[s.id]){
          totals[s.id].total += byStore[s.id].price * item.qty;
          totals[s.id].found += 1;
        } else {
          totals[s.id].missing.push(item.product);
        }
      });
    });
    return totals;
  },[analysis]);

  const ranked = STORES.map(s=>({...s,...storeTotals[s.id]})).filter(s=>s.found>0).sort((a,b)=>b.found!==a.found?b.found-a.found:a.total-b.total);
  const best   = ranked[0];
  const savings= ranked.length>1?ranked[ranked.length-1].total-best.total:0;
  const totalItems=items.reduce((a,i)=>a+i.qty,0);
  const missingItems=items.filter(item=>!priceDB.some(p=>itemMatchesPrice(item,p)));

  return (
    <div style={{ padding:"16px 16px 110px" }}>
      <div style={{ background:C.blue, borderRadius:16, padding:"16px 20px", marginBottom:16, display:"flex", alignItems:"center", gap:14 }}>
        <div style={{ fontSize:34 }}>🛒</div>
        <div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.white }}>{items.length} produit{items.length>1?"s":""} · {totalItems} article{totalItems>1?"s":""}</div>
          {savings>0.05 && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:"rgba(255,255,255,0.75)", marginTop:2 }}>Jusqu'à <strong style={{ color:"#FFD700" }}>{savings.toFixed(2)} €</strong> d'économies</div>}
        </div>
      </div>

      {ranked.length===0 && (
        <div style={{ background:C.orangeLight, borderRadius:14, padding:"24px 20px", textAlign:"center", border:`2px dashed ${C.orange}`, marginBottom:16 }}>
          <div style={{ fontSize:40, marginBottom:10 }}>💰</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.orange, marginBottom:6 }}>Aucun prix correspondant</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight }}>Les produits de ta liste doivent avoir le même <strong>nom + format + marque</strong> que ceux dans "Mes prix"</div>
        </div>
      )}

      {missingItems.length>0 && ranked.length>0 && (
        <div style={{ background:"#FFF8E6", borderRadius:12, padding:"12px 14px", marginBottom:14, border:`1px solid ${C.yellow}` }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:"#7A6000", marginBottom:6 }}>⚠️ Pas de prix pour :</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {missingItems.map(item=>(
              <span key={item.id} style={{ background:C.yellow, borderRadius:99, padding:"3px 10px", fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:700, color:C.text }}>
                {item.brand?`${item.brand} · `:""}{item.product} {item.format}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Détail par produit — marque libre : affiche toutes les options */}
      {analysis.filter(({item})=>!item.brand && Object.keys(analysis.find(a=>a.item.id===item.id)?.byStore||{}).length>0).map(({item,byStore})=>{
        const options=Object.values(byStore).sort((a,b)=>a.price-b.price);
        if(options.length<=1) return null;
        return (
          <div key={item.id} style={{ background:C.white, borderRadius:14, border:`1px solid ${C.grayLight}`, overflow:"hidden", marginBottom:10, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <div style={{ background:C.blueLight, padding:"10px 14px" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.blue }}>{item.product} {item.format} <span style={{ fontSize:11, color:C.orange, fontWeight:700 }}>· toutes marques</span></div>
            </div>
            {options.map((p,i)=>{
              const store=STORES.find(s=>s.id===p.storeId);
              return (
                <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 14px", borderBottom:`1px solid ${C.grayLight}` }}>
                  <span>{store?.logo}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:13, color:C.text }}>{p.brand||"Sans marque"} · {store?.name}</div>
                  </div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:i===0?C.green:C.text }}>{p.price.toFixed(2)} €</div>
                  {i===0 && <span style={{ fontSize:10, background:C.green, color:C.white, borderRadius:99, padding:"2px 7px", fontFamily:"'Nunito',sans-serif", fontWeight:800 }}>MOINS CHER</span>}
                </div>
              );
            })}
          </div>
        );
      })}

      {ranked.length>0 && (
        <>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, fontWeight:800, color:C.gray, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:10 }}>Classement global · tes prix réels</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
            {ranked.map((store,i)=>{
              const isBest=i===0;
              const diff=store.total-best.total;
              // Détail des articles pour ce magasin
              const storeDetails = analysis.map(({item,byStore})=>{
                const p=byStore[store.id];
                return { item, price:p, total:p?p.price*item.qty:null };
              });
              return (
                <div key={store.id} style={{ background:isBest?"linear-gradient(135deg,#CC0000,#E80000)":C.white, border:isBest?"none":`1px solid ${C.grayLight}`, borderRadius:14, overflow:"hidden", boxShadow:isBest?"0 6px 20px rgba(0,82,165,0.3)":"0 1px 4px rgba(0,0,0,0.06)", animation:`slideIn 0.25s ease ${i*0.07}s both` }}>
                  {/* Ligne principale */}
                  <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px" }}>
                    <div style={{ width:30, height:30, borderRadius:99, background:isBest?C.orange:C.grayLight, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:isBest?C.white:C.gray, flexShrink:0 }}>{i+1}</div>
                    <span style={{ fontSize:20 }}>{store.logo}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:isBest?C.white:C.text }}>{store.name}</span>
                        {isBest && <span style={{ fontSize:10, background:C.orange, color:C.white, borderRadius:99, padding:"2px 7px", fontFamily:"'Nunito',sans-serif", fontWeight:800 }}>MEILLEUR</span>}
                      </div>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:isBest?"rgba(255,255,255,0.6)":C.gray, marginTop:2 }}>
                        {store.found}/{items.length} produit{items.length>1?"s":""} trouvé{store.found>1?"s":""}
                        {store.missing.length>0 && <span style={{ color:isBest?"#FFD700":C.orange }}> · {store.missing.length} manquant{store.missing.length>1?"s":""}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:isBest?C.orange:C.red }}>{store.total.toFixed(2)} €</div>
                      {!isBest && diff>0.01 && <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:C.red, fontWeight:700 }}>+{diff.toFixed(2)} €</div>}
                    </div>
                  </div>
                  {/* Détail des articles */}
                  <div style={{ borderTop:`1px solid ${isBest?"rgba(255,255,255,0.12)":C.grayLight}` }}>
                    {storeDetails.map(({item,price,total})=>(
                      <div key={item.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 16px", borderBottom:`1px solid ${isBest?"rgba(255,255,255,0.08)":C.grayLight}` }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:13, color:isBest?"rgba(255,255,255,0.9)":C.text }}>
                            {item.brand?`${item.brand} · `:""}{item.product}
                          </div>
                          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:isBest?"rgba(255,255,255,0.5)":C.gray, marginTop:1 }}>
                            {item.format} × {item.qty}
                          </div>
                        </div>
                        {price ? (
                          <div style={{ textAlign:"right" }}>
                            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:isBest?"#FFD700":C.blue }}>
                              {total.toFixed(2)} €
                            </div>
                            {item.qty>1 && (
                              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:isBest?"rgba(255,255,255,0.5)":C.gray }}>
                                {price.price.toFixed(2)} € / unité
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, fontWeight:700, color:isBest?"#FFD700":C.orange }}>
                            ⚠️ manquant
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={()=>onValidate(best)} style={{ width:"100%", padding:"16px", border:"none", borderRadius:14, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:"#111111", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 6px 20px rgba(200,160,0,0.5)" }}>
            ✅ Je fais mes courses chez {best.name}
          </button>
        </>
      )}
    </div>
  );
}

// ── ARCHIVE TAB ───────────────────────────────────────────────────────────────
function ArchiveTab({ archives }) {
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
              <div style={{ background:C.blue, borderRadius:10, padding:"6px 14px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:18, color:C.white }}>{arc.total.toFixed(2)} €</div>
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
import { supabase } from "./lib/supabase";

export default function App() {
  const [tab, setTab]           = useState("list");
  const [items, setItems]       = useState([]);
  const [priceDB, setPriceDB]   = useState([]);
  const [archives, setArchives] = useState([]);
  const [showSuccess, setShowSuccess] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [loaded, setLoaded]       = useState(false);

  useEffect(()=>{
    (async ()=>{
      try {
        const [list, prices, arcs, favs] = await Promise.all([
          supabase.from('shopping_list').select('items').order('id').limit(1),
          supabase.from('price_db').select('*'),
          supabase.from('archives').select('*').order('date'),
          supabase.from('favorites').select('items').order('id').limit(1),
        ]);
        if(list.data?.[0]) setItems(list.data[0].items || []);
        if(prices.data) setPriceDB(prices.data.map(p=>({...p, storeId: p.storeId || 'autre'})));
        if(arcs.data) setArchives(arcs.data);
        if(favs.data?.[0]) setFavorites(favs.data[0].items || []);
      } catch(e){ console.log("Supabase load:", e); }
      setLoaded(true);
    })();
  },[]);

  const saveItems     = async (v) => { setItems(v); const r=await supabase.from('shopping_list').select('id').order('id').limit(1); if(r.data?.[0]) await supabase.from('shopping_list').update({items:v}).eq('id',r.data[0].id); else await supabase.from('shopping_list').insert({items:v}); };
  const savePriceDB = async (v) => {   setPriceDB(v);    const clean = v.map(p => ({     product: p.product,     format: p.format,     brand: p.brand || '',     storeId: p.storeId || '',     store_name: p.store_name || '',     price: parseFloat(p.price),     date: p.date || new Date().toISOString()   }));    const { error } = await supabase     .from('price_db')     .upsert(clean);    if (error) {     console.error("Erreur insertion Supabase :", error);   } };
  const saveArchives  = async (v) => { setArchives(v); if(v.length>0){ const last=v[v.length-1]; const {id,...rest}=last; await supabase.from('archives').insert(rest); } };
  const saveFavorites = async (v) => { setFavorites(v); const r=await supabase.from('favorites').select('id').order('id').limit(1); if(r.data?.[0]) await supabase.from('favorites').update({items:v}).eq('id',r.data[0].id); else await supabase.from('favorites').insert({items:v}); };

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
          {loaded && tab==="list"    && <ListTab    items={items} setItems={saveItems} setTab={setTab} favorites={favorites} saveFavorites={saveFavorites}/>}
          {loaded && tab==="catalog" && <CatalogTab items={items} setItems={saveItems} setTab={setTab}/>}
          {loaded && tab==="compare" && <CompareTab items={items} priceDB={priceDB} onValidate={handleValidate}/>}
          {loaded && tab==="prices"  && <PricesTab  priceDB={priceDB} setPriceDB={savePriceDB}/>}
          {loaded && tab==="archive" && <ArchiveTab archives={archives}/>}
        </div>
        <TabBar tab={tab} setTab={setTab}/>
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
