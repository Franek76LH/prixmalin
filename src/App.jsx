import { useState, useEffect, useMemo, useRef } from "react";
import { scanTicketWithClaude, imageFileToJpegBase64 } from "./scanTicket";
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

// Clé unique d'un article de prix : marque+produit+format+magasin
function priceKey(p){ return `${normName(p.brand)}_${normName(p.product)}_${normFormat(p.format)}_${p.storeId}`; }

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

const PURE_STORES = new Set(['auchan','carrefour','casino','intermarche','leclerc','e.leclerc','monoprix','lidl','u','vival','spar','netto','franprix','superu','super u','simply','simply market','biocbon','bio c bon']);
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

// ── PSEUDO MODAL ─────────────────────────────────────────────────────────────
function PseudoModal({ onSave }) {
  const F = "'Nunito',sans-serif";
  const [value,   setValue]   = useState('');
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!value.trim()) return;
    setLoading(true);
    await onSave(value.trim());
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
          style={{ width:"100%", padding:"14px 16px", borderRadius:12, border:`2px solid ${value.trim()?C.blue:C.grayLight}`, fontFamily:F, fontSize:16, color:C.text, boxSizing:"border-box", marginBottom:16, textAlign:"center" }}
        />
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

  const switchMode = (m) => { setMode(m); setError(''); setSuccess(''); setConfirm(''); setShowPwd(false); setShowConf(false); };

  const handle = async () => {
    if (!email.trim() || !password.trim()) { setError("Remplis tous les champs"); return; }
    if (mode === 'register' && password !== confirm) { setError("Les mots de passe ne correspondent pas"); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      const { error } = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });
      if (error) throw error;
      if (mode === 'register') { setSuccess('Compte créé ! Confirme ton email puis connecte-toi.'); switchMode('login'); }
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
function ProfilSheet({ circles, userId, userEmail, profileMap, pseudo, archives, onClose, onInvite, onUpdateStatus, onLogout }) {
  const F = "'Nunito',sans-serif";
  const [inviteEmail,   setInviteEmail]   = useState('');
  const [inviteError,   setInviteError]   = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [sharedCount,   setSharedCount]   = useState(null);
  const inviteRef = useRef(null);
  const avatarColors = ["#E5181B","#F5C200","#00B341","#4A90D9","#8E44AD","#FF6B35"];

  useEffect(() => {
    supabase.from('community_prices')
      .select('id', { count:'exact', head:true })
      .eq('user_id', userId)
      .then(({ count }) => setSharedCount(count ?? 0));
  }, [userId]);

  const isMe = c => c.recipient_id === userId || c.recipient_email?.toLowerCase() === userEmail?.toLowerCase();
  const received = circles.filter(c => isMe(c) && c.status === 'pending');
  const accepted = circles.filter(c => c.status === 'accepted' && (c.requester_id === userId || isMe(c)));
  const sent     = circles.filter(c => c.requester_id === userId && c.status === 'pending');
  const otherDisplay = c => {
    const otherId = c.requester_id === userId ? c.recipient_id : c.requester_id;
    const email   = c.requester_id === userId ? c.recipient_email : c.requester_email;
    return (otherId && profileMap[otherId]) || email || '?';
  };
  const initial = s => (s || '?')[0].toUpperCase();

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteLoading(true); setInviteError('');
    const { error } = await onInvite(inviteEmail);
    if (error) setInviteError(error); else setInviteEmail('');
    setInviteLoading(false);
  };

  const ringR = 56;
  const ringMembers = accepted.slice(0, 6);

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
        <div style={{ padding:"20px 20px 0", display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexShrink:0 }}>
          <div>
            <div style={{ fontFamily:F, fontWeight:900, fontSize:24, color:C.text }}>Profil</div>
            <div style={{ fontFamily:F, fontSize:14, color:C.textLight, fontWeight:600, marginTop:2 }}>@{pseudo || 'Moi'}</div>
          </div>
          <button onClick={onClose} style={{ background:C.bg, border:"none", borderRadius:99, width:32, height:32, fontSize:15, cursor:"pointer", color:C.gray, marginTop:4 }}>✕</button>
        </div>

        {/* Avatar ring + savings */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", paddingTop:20, paddingBottom:4, flexShrink:0 }}>
          <div style={{ position:"relative", width:168, height:168 }}>
            <svg width="168" height="168" style={{ position:"absolute", inset:0 }}>
              <circle cx="84" cy="84" r={ringR} fill="none" stroke={C.grayLight} strokeWidth="2"/>
            </svg>
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
              <div style={{ fontFamily:F, fontWeight:900, fontSize:28, color:C.text, lineHeight:1 }}>{cagnotteTotal >= 0 ? "+" : ""}{cagnotteTotal.toFixed(2)} €</div>
              <div style={{ fontFamily:F, fontSize:11, color:C.green, fontWeight:700, marginTop:3 }}>{thisMonthSaving >= 0 ? "+" : ""}{thisMonthSaving.toFixed(2)} € ce mois-ci</div>
            </div>
            {ringMembers.length === 0 ? (
              <div style={{ position:"absolute", left:84+ringR-14, top:84-14, width:28, height:28, borderRadius:"50%", background:C.grayLight, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:C.gray, border:"2px solid white" }}>+</div>
            ) : ringMembers.map((c, i) => {
              const angle = (2 * Math.PI * i / ringMembers.length) - Math.PI / 2;
              const x = 84 + ringR * Math.cos(angle) - 14;
              const y = 84 + ringR * Math.sin(angle) - 14;
              return (
                <div key={c.id} style={{ position:"absolute", left:x, top:y, width:28, height:28, borderRadius:"50%", background:avatarColors[i%avatarColors.length], display:"flex", alignItems:"center", justifyContent:"center", fontFamily:F, fontWeight:900, fontSize:12, color:"#fff", border:"2px solid white", boxShadow:"0 2px 6px rgba(0,0,0,0.15)" }}>
                  {initial(otherDisplay(c))}
                </div>
              );
            })}
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
                  <div style={{ fontFamily:F, fontWeight:800, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{(c.requester_id && profileMap[c.requester_id]) || c.requester_email}</div>
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
                  <div style={{ fontFamily:F, fontWeight:700, fontSize:13, color:C.textLight, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.recipient_email}</div>
                  <div style={{ fontFamily:F, fontSize:11, color:"#FFD000", fontWeight:700 }}>⏳ En attente</div>
                </div>
                <button onClick={()=>onUpdateStatus(c.id,'revoked')} style={{ padding:"4px 10px", border:`1px solid ${C.grayLight}`, borderRadius:8, background:"#fff", fontFamily:F, fontSize:11, color:C.gray, cursor:"pointer" }}>Annuler</button>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
            {[
              { label:"Prix partagés", value: sharedCount === null ? "…" : String(sharedCount) },
              { label:"Tickets",        value: String(archives.length) },
              { label:"Rang",           value: "#1" },
            ].map(s => (
              <div key={s.label} style={{ background:C.bg, borderRadius:14, padding:"14px 8px", textAlign:"center" }}>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:22, color:C.text }}>{s.value}</div>
                <div style={{ fontFamily:F, fontSize:11, color:C.textLight, fontWeight:600, marginTop:3 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Invite form */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:C.gray, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Inviter par email</div>
            <div style={{ display:"flex", gap:8 }}>
              <input ref={inviteRef} type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&handleInvite()}
                placeholder="ami@email.com"
                style={{ flex:1, padding:"12px 14px", borderRadius:10, border:`2px solid ${inviteEmail?C.blue:C.grayLight}`, fontFamily:F, fontSize:14, color:C.text, outline:"none" }}
              />
              <button onClick={handleInvite} disabled={inviteLoading||!inviteEmail.trim()}
                style={{ padding:"12px 16px", border:"none", borderRadius:10, background:inviteLoading||!inviteEmail.trim()?C.grayLight:C.blue, fontFamily:F, fontWeight:900, fontSize:14, color:inviteLoading||!inviteEmail.trim()?C.gray:"#fff", cursor:inviteLoading||!inviteEmail.trim()?"default":"pointer", flexShrink:0 }}>
                {inviteLoading ? "…" : "Inviter"}
              </button>
            </div>
            {inviteError && <div style={{ fontFamily:F, fontSize:12, color:"#CC0000", fontWeight:700, marginTop:8 }}>⚠️ {inviteError}</div>}
          </div>

          {/* Se déconnecter */}
          <button onClick={()=>{ onClose(); onLogout(); }}
            style={{ width:"100%", padding:"14px", border:`1.5px solid ${C.grayLight}`, borderRadius:14, background:"#fff", fontFamily:F, fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function Header({ tab, itemCount, userEmail, displayName, onLogout, pendingCount, onCircle }) {
  const F = "'Nunito',sans-serif";
  const titles = { list:"Ma liste", catalog:"Catalogue", compare:"Comparer", prices:"Mes prix", archive:"Historique", economies:"Mes économies" };
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
          <div style={{ fontFamily:F, fontWeight:900, fontSize:18, color:C.white, lineHeight:1 }}>PrixMalin</div>
          <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.7)", marginTop:1 }}>{titles[tab]}</div>
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
function TabBar({ tab, setTab }) {
  const tabs = [
    { id:"home",      icon:"🏠", label:"Accueil"   },
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
function ImportTicketSheet({ onClose, onImport, refProducts = [], directCamera = false }) {
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
  const fileInputRef    = useRef(null);
  const galleryInputRef = useRef(null);
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

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
      setEditableProducts(parsed.products.map((p,i)=>({...p,id:i,keep:true,share:true})));
      setStoreNameEdit(parsed.store||"");
      setStoreLocation(parsed.address||"");
      setError("");
      setStatus("store");
    } catch(e) { setError("JSON invalide : "+e.message); }
  };

  const [shareChecked, setShareChecked] = useState(new Set());

  const loadExample = () => { setJsonText(EXAMPLE); parseAndPreview(EXAMPLE); };
  const toggleProduct = id => setEditableProducts(prev=>prev.map(p=>p.id===id?{...p,keep:!p.keep}:p));
  const updatePrice = (id,val) => setEditableProducts(prev=>prev.map(p=>p.id===id?{...p,price:parseFloat(val)||0}:p));

  const confirm = (idsToShare) => {
    if (saving) return;
    setSaving(true);
    const toImport=editableProducts.filter(p=>p.keep&&p.name&&p.price>0).map(p=>({
      id:Date.now()+p.id,
      brand:  p.brand||"",
      product:p.name,
      format: p.format||"",
      qty:    p.qty||1,
      storeId:selectedStore||"autre",
      store_name: storeNameEdit.trim() || result?.store || "",
      store_address: storeLocation.trim(),
      price:  p.price,
      date:   result?.date?new Date(result.date).toISOString():new Date().toISOString(),
      share:  idsToShare.has(p.id),
    }));
    onImport(toImport);
    onClose();
  };

  const goToShare = () => {
    const ids = new Set(editableProducts.filter(p=>p.keep&&p.name&&p.price>0).map(p=>p.id));
    setShareChecked(ids);
    setStatus("share");
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", zIndex:200, animation:"fadeIn 0.2s ease" }} onClick={(status==="idle"||status==="camera")?onClose:undefined}>
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
                  {n:"2",t:"L'IA lit le ticket et extrait produits, prix et magasin"},
                  {n:"3",t:"Vérifie et importe dans Mes prix !"},
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
<input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={async (e) => {
                const file = e.target.files[0];
                if(!file) return;
                setScanning(true); setError("");
                try {
                  const base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
                  const parsed = await scanTicketWithClaude(base64, apiKey, refProducts);
                  setResult(parsed); setSelectedStore(storeIdFromName(parsed.store));
                  setEditableProducts(parsed.products.map((p,i) => ({...p, id:i, keep:true})));
                  setStoreNameEdit(parsed.store||"");
                  setStoreLocation(parsed.address||"");
                  if (parsed.store && parsed.address) { setStatus("preview"); } else { setStatus("store"); }
                } catch(e) { setError("Erreur scan : " + e.message); }
                setScanning(false);
              }} style={{ display:"none" }} />
              <button onClick={()=>fileInputRef.current?.click()} disabled={scanning||galleryScanning} style={{ width:"100%", padding:"15px", marginTop:10, border:"none", borderRadius:12, background:scanning?"#999":"#00B341", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"white", cursor:scanning?"default":"pointer" }}>
                {scanning ? "⏳ Analyse en cours..." : "📷 Scanner un ticket"}
              </button>

              {/* Galerie */}
              <input ref={galleryInputRef} type="file" accept="image/*" onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                setGalleryScanning(true); setError("");
                try {
                  const base64 = await imageFileToJpegBase64(file);
                  const parsed = await scanTicketWithClaude(base64, apiKey, refProducts);
                  setResult(parsed); setSelectedStore(storeIdFromName(parsed.store));
                  setEditableProducts(parsed.products.map((p,i) => ({...p, id:i, keep:true, share:true})));
                  setStoreNameEdit(parsed.store || "");
                  setStoreLocation(parsed.address || "");
                  if (parsed.store && parsed.address) { setStatus("preview"); } else { setStatus("store"); }
                } catch(e) { setError("Erreur scan : " + e.message); }
                setGalleryScanning(false);
                e.target.value = "";
              }} style={{ display:"none" }} />
              <button onClick={()=>galleryInputRef.current?.click()} disabled={scanning||galleryScanning}
                style={{ width:"100%", padding:"15px", marginTop:10, border:"none", borderRadius:12, background:galleryScanning?"#999":"#4A90D9", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:"white", cursor:galleryScanning?"default":"pointer" }}>
                {galleryScanning ? "⏳ Analyse en cours..." : "🖼️ Importer une photo"}
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
                  const base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(file); });
                  const parsed = await scanTicketWithClaude(base64, apiKey, refProducts);
                  setResult(parsed); setSelectedStore(storeIdFromName(parsed.store));
                  setEditableProducts(parsed.products.map((p,i) => ({...p, id:i, keep:true})));
                  setStoreNameEdit(parsed.store||"");
                  setStoreLocation(parsed.address||"");
                  if (parsed.store && parsed.address) { setStatus("preview"); } else { setStatus("store"); }
                } catch(e) { setError("Erreur scan : " + e.message); }
                setScanning(false);
              }} style={{ display:"none" }} />
              {error && <div style={{ background:"#FEE", borderRadius:10, padding:"10px 14px", marginBottom:16, fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.red, fontWeight:700 }}>⚠️ {error}</div>}
              <button onClick={()=>fileInputRef.current?.click()} disabled={scanning} style={{ width:"100%", padding:"28px 20px", border:"none", borderRadius:16, background:scanning?"#999":"#00B341", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:20, color:"white", cursor:scanning?"default":"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:48 }}>📷</span>
                {scanning ? "⏳ Analyse en cours..." : "Ouvrir la caméra"}
              </button>
              <button onClick={()=>setStatus("idle")} style={{ width:"100%", padding:"14px", marginTop:12, border:`2px solid ${C.grayLight}`, borderRadius:12, background:C.white, fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.textLight, cursor:"pointer" }}>
                Autres options
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
                  <div key={p.id} style={{ background:p.keep?C.white:C.grayLight, borderRadius:12, border:`1px solid ${p.keep?C.blue:C.grayLight}`, opacity:p.keep?1:0.5, overflow:"hidden" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px" }}>
                      <button onClick={()=>toggleProduct(p.id)} style={{ width:24, height:24, borderRadius:6, flexShrink:0, cursor:"pointer", border:`2px solid ${p.keep?C.blue:C.gray}`, background:p.keep?C.blue:C.white, color:C.white, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center" }}>{p.keep?"✓":""}</button>
                      <div style={{ flex:1 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text }}>{p.brand?`${p.brand} · `:""}{p.name}</div>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>{p.format}</div>
                      </div>
                      <input type="number" step="0.01" min="0" value={p.price} onChange={e=>updatePrice(p.id,e.target.value)}
                        style={{ width:68, padding:"6px 8px", textAlign:"right", borderRadius:8, border:`2px solid ${C.orange}`, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.orange, outline:"none" }} />
                      <span style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.orange }}>€</span>
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={goToShare} style={{ width:"100%", padding:"16px", border:"none", borderRadius:12, background:C.orange, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, color:C.white, cursor:"pointer", marginBottom:10, boxShadow:"0 6px 20px rgba(204,0,0,0.35)" }}>
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
                {editableProducts.filter(p=>p.keep&&p.name&&p.price>0).map(p => {
                  const checked = shareChecked.has(p.id);
                  const toggle = () => setShareChecked(prev => {
                    const next = new Set(prev);
                    checked ? next.delete(p.id) : next.add(p.id);
                    return next;
                  });
                  return (
                    <div key={p.id} onClick={toggle} style={{ display:"flex", alignItems:"center", gap:12, background:checked?"#F0FFF5":C.white, borderRadius:12, padding:"12px 14px", border:`1.5px solid ${checked?C.green:C.grayLight}`, cursor:"pointer" }}>
                      <div style={{ width:24, height:24, borderRadius:6, flexShrink:0, border:`2px solid ${checked?C.green:C.gray}`, background:checked?C.green:C.white, display:"flex", alignItems:"center", justifyContent:"center", color:C.white, fontSize:13 }}>
                        {checked ? "✓" : ""}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:800, fontSize:14, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {p.brand ? `${p.brand} · ` : ""}{p.name}
                        </div>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight }}>{p.format}</div>
                      </div>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:14, color:C.orange, flexShrink:0 }}>
                        {p.price.toFixed(2)} €
                      </div>
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
function EconomiesTab({ priceDB, archives, items, setTab }) {
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

  // ── Section 2 : Cagnotte réalisées — archives avec ticket scanné
  const scannedArchives = useMemo(() =>
    archives.filter(a => a.ticket_scanned && a.realized_saving != null),
    [archives]
  );

  const cagnotte = useMemo(() => ({
    total: scannedArchives.reduce((a, arc) => a + (arc.realized_saving || 0), 0),
  }), [scannedArchives]);

  // ── Section 3 : Récapitulatif mensuel réalisées
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
      .slice(0,6)
      .map(([m,d]) => ({ month:m, label:formatMonth(m), ...d }));
  }, [scannedArchives]);

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

      {scannedArchives.length === 0 ? (
        <div style={{ background:"#F0FFF5", borderRadius:14, padding:"20px 16px", textAlign:"center", marginBottom:24, border:`2px dashed ${C.green}` }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🧾</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, color:C.textLight, lineHeight:1.6 }}>
            Valide une liste, fais tes courses, scanne le ticket — tes économies vs le magasin alternatif s'accumuleront ici.
          </div>
        </div>
      ) : (
        <>
          {/* Cagnotte totale */}
          <div style={{ background:"linear-gradient(135deg,#00B341,#00C850)", borderRadius:14, padding:"18px 20px", marginBottom:16 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, fontWeight:800, color:"rgba(255,255,255,0.7)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Cagnotte · vs prix moyen marché</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:36, color:C.white, lineHeight:1 }}>
              {cagnotte.total >= 0 ? "+" : ""}{cagnotte.total.toFixed(2)} €
            </div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:11, color:"rgba(255,255,255,0.7)", marginTop:6 }}>
              {scannedArchives.length} course{scannedArchives.length>1?"s":""} analysée{scannedArchives.length>1?"s":""}
            </div>
          </div>

          {/* Dernières courses scannées */}
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
            {[...scannedArchives].reverse().slice(0,8).map((arc,i) => {
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
                      {new Date(arc.date).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}
                      {" · "}
                      {arc.items?.length || 0} produit{(arc.items?.length||0)>1?"s":""}
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
                    {m.count} course{m.count>1?"s":""}
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:m.total>=0?C.green:"#CC3300" }}>
                    {m.total>=0?"+":""}{m.total.toFixed(2)} €
                  </div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:10, color:C.textLight }}>vs prix moyen</div>
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
function PricesTab({ priceDB, setPriceDB, archives, updateArchive, onTicketValidated, onCreateArchive, userId, produitsRef = [], autoOpenCamera = false, onAutoOpenConsumed }) {
  const [showImport,    setShowImport]    = useState(false);

  useEffect(() => {
    if (autoOpenCamera) setShowImport(true);
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
  const importPrices = entries => {
    // Trouve la dernière archive sans ticket scanné
    const openArchive = [...archives].reverse().find(a => !a.ticket_scanned);

    let realizedSaving = null;
    if (openArchive) {
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
        const alts = priceDB.filter(p => {
          const pKey = `${normName(p.brand||'')}_${normName(p.product)}_${normFormat(p.format||'')}`;
          return pKey === eKey && p.storeId !== e.storeId;
        });
        if (alts.length > 0) {
          const avgMarket = alts.reduce((s, p) => s + p.price, 0) / alts.length;
          realizedSaving += (avgMarket - e.price) * qty;
        }
      });
      realizedSaving = Math.round(realizedSaving * 100) / 100;
      updateArchive(openArchive.id, { ticket_scanned: true, realized_saving: realizedSaving });
      onTicketValidated?.(openArchive.id, openArchive.store);
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

      <button onClick={()=>{setEditPrice(null);setShowEntry(true);}} style={{ position:"fixed", bottom:72, right:16, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:99, padding:"13px 18px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", gap:6, boxShadow:"0 6px 20px rgba(180,0,0,0.45)", zIndex:40 }}>
        ✏️ Saisie manuelle
      </button>

      {showImport    && <ImportTicketSheet onClose={()=>{setShowImport(false);onAutoOpenConsumed?.();}} onImport={importPrices} refProducts={produitsRef.map(p=>({ nom: p.produit_generique, categorie: p.sous_categorie }))} directCamera={autoOpenCamera}/>}
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

  const bestStoreEntry = best ? priceDB.find(p => p.storeId === best.id && p.store_address?.trim()) : null;
  const mapsQuery      = best ? `${best.name}${bestStoreEntry ? ' ' + bestStoreEntry.store_address : ''}` : '';
  const mapsUrl        = best ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : '#';
  const maxSavings   = best ? worstTotal - best.total : 0;
  const totalItems   = items.reduce((a,i)=>a+i.qty,0);
  const missingGlobal= items.filter(item=>!priceDB.some(p=>itemMatchesPrice(item,p)));

  const [lastVerified, setLastVerified] = useState(null);
  useEffect(() => {
    if (!best) { setLastVerified(null); return; }
    let mostRecent = null;
    analysis.forEach(({ byStore }) => {
      const p = byStore[best.id];
      if (p && (!mostRecent || new Date(p.date) > new Date(mostRecent.date))) mostRecent = p;
    });
    if (!mostRecent?.user_id) { setLastVerified(null); return; }
    supabase.from('profiles').select('pseudo').eq('id', mostRecent.user_id).maybeSingle()
      .then(({ data }) => {
        const days = Math.floor((Date.now() - new Date(mostRecent.date)) / 86400000);
        const dateLabel = days === 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`;
        setLastVerified({ dateLabel, pseudo: data?.pseudo || 'un utilisateur' });
      });
  }, [best?.id]);

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
                🥇 {best.missing.length > 0 ? "MEILLEUR PRIX PARTIEL" : "MEILLEUR PRIX"}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:F, fontWeight:900, fontSize:34, color:C.white, lineHeight:1 }}>{best.total.toFixed(2)} €</div>
                {best.missing.length > 0 && (
                  <div style={{ fontFamily:F, fontSize:11, color:"#FFD700", fontWeight:700, marginTop:4 }}>
                    Prix pour {best.found} article{best.found>1?"s":""} sur {items.length} — panier incomplet
                  </div>
                )}
                {maxSavings>0.05 && <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.6)", marginTop:2 }}>−{maxSavings.toFixed(2)} € vs le + cher</div>}
              </div>
            </div>

            {/* Nom magasin */}
            <div style={{ padding:"10px 18px 14px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                <span style={{ fontSize:26 }}>{best.logo}</span>
                <div>
                  <div style={{ fontFamily:F, fontWeight:900, fontSize:20, color:C.white }}>{best.name}</div>
                  <div style={{ fontFamily:F, fontSize:12, color:"rgba(255,255,255,0.6)" }}>
                    {best.found}/{items.length} produit{items.length>1?"s":""} trouvé{best.found>1?"s":""}
                    {best.missing.length>0 && <span style={{ color:"#FFD700" }}> · {best.missing.length} manquant{best.missing.length>1?"s":""}</span>}
                  </div>
                  {lastVerified && (
                    <div style={{ fontFamily:F, fontSize:11, color:"rgba(255,255,255,0.85)", fontWeight:500, marginTop:3 }}>
                      Dernier prix vérifié {lastVerified.dateLabel} par {lastVerified.pseudo}
                    </div>
                  )}
                </div>
              </div>
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:"#fff", border:"2px solid #D32F2F", borderRadius:20, padding:"10px 18px", fontFamily:F, fontWeight:700, fontSize:14, color:"#D32F2F", textDecoration:"none", boxShadow:"0 2px 6px rgba(0,0,0,0.15)" }}>
                📍 Y aller
              </a>
            </div>

            {/* Liste des articles */}
            <div style={{ background:"rgba(0,0,0,0.18)", marginBottom:12 }}>
              {analysis.map(({item,byStore})=>{
                const p     = byStore[best.id];
                const total = p ? p.price*item.qty : null;
                return (
                  <div key={item.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 18px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
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
              <button onClick={()=>onValidate(best, maxSavings)} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:C.orange, fontFamily:F, fontWeight:900, fontSize:16, color:"#111", cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.25)" }}>
                ✅ Je fais mes courses chez {best.name}
              </button>

            </div>

            {/* Suggestions pour produits manquants — après le bouton */}
            {analysis.some(({byStore})=>!byStore[best.id]&&Object.keys(byStore).length>0) && (
              <div style={{ padding:"0 12px 16px", display:"flex", flexDirection:"column", gap:6 }}>
                {analysis
                  .filter(({byStore})=>!byStore[best.id]&&Object.keys(byStore).length>0)
                  .map(({item,byStore})=>{
                    const alt = Object.entries(byStore)
                      .map(([sid,pr])=>({ store:STORES.find(s=>s.id===sid), pr }))
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
    </div>
  );
}

// ── ARCHIVE TAB ───────────────────────────────────────────────────────────────
function ArchiveTab({ archives, onDelete, onAddToList, priceDB, onImport, onSavePrice, produitsRef = [] }) {
  const [pendingDeleteArc, setPendingDeleteArc] = useState(null);
  const [added, setAdded] = useState(new Set());
  const [sort, setSort] = useState("date");
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterPeriod, setFilterPeriod] = useState("all");
  const [showImport, setShowImport] = useState(false);
  const [showEntry, setShowEntry] = useState(false);

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
  return (
    <div style={{ padding:"16px 16px 110px" }}>
      <button onClick={()=>setShowImport(true)} style={{ width:"100%", padding:"16px", marginBottom:12, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:14, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 6px 20px rgba(180,0,0,0.35)" }}>
        <span style={{ fontSize:20 }}>🧾</span> Importer un ticket
      </button>
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
                      <div onClick={()=>setExpandedProduct(isOpen?null:key)} style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:C.text, cursor:"pointer", flex:1 }}>{item.brand?`${item.brand} · `:""}{item.product}{item.format?` ${item.format}`:""} <span style={{ fontSize:10, color:C.textLight }}>{isOpen?"▲":"▼"}</span></div>
                      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0, marginLeft:12 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:900, color:C.blue }}>{item.unitPrice!=null?`${item.unitPrice.toFixed(2)} €`:"—"}</div>
                        <button onClick={()=>{ if(!done){ onAddToList(item); setAdded(prev=>new Set(prev).add(key)); } }} style={{ background:done?C.green:C.red, border:"none", borderRadius:99, width:22, height:22, display:"inline-flex", alignItems:"center", justifyContent:"center", cursor:done?"default":"pointer", color:C.white, fontSize:13, fontWeight:900, padding:0, flexShrink:0 }}>{done?"✓":"+"}</button>
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
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:15, color:C.blue }}>{arc.store?.logo} {arc.store?.name}</div>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:12, color:C.textLight, marginTop:1 }}>{new Date(arc.date).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>
                      {arc.store_rating && <div style={{ fontSize:11, marginTop:2, letterSpacing:1 }}>{[1,2,3,4,5].map(n=><span key={n} style={{ color:n<=arc.store_rating?"#F5C200":"#D0D0D0" }}>★</span>)}</div>}
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
                        {(()=>{ const up=item.unit_price??item.price??null; const qty=item.qty||1; const tot=up!=null?up*qty:null; return `${item.brand?item.brand+' · ':""}${item.product} ${item.format} | ×${qty} | ${up!=null?Number(up).toFixed(2).replace('.',','):"—"} € | = ${tot!=null?Number(tot).toFixed(2).replace('.',','):"—"} €`; })()}
                        {(()=>{ const key=`${arc.id}_${j}`; const done=added.has(key); return (
                          <button onClick={()=>{ if(!done){ onAddToList(item); setAdded(prev=>new Set(prev).add(key)); } }} style={{ background:done?C.green:C.blue, border:"none", borderRadius:99, width:18, height:18, display:"inline-flex", alignItems:"center", justifyContent:"center", cursor:done?"default":"pointer", color:C.white, fontSize:11, fontWeight:900, padding:0, flexShrink:0 }}>{done?"✓":"+"}</button>
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
      <button onClick={()=>setShowEntry(true)} style={{ position:"fixed", bottom:72, right:16, background:"linear-gradient(135deg,#CC0000,#FF1A1A)", border:"none", borderRadius:99, padding:"13px 18px", fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, color:C.white, cursor:"pointer", display:"flex", alignItems:"center", gap:6, boxShadow:"0 6px 20px rgba(180,0,0,0.45)", zIndex:40 }}>
        ✏️ Saisie manuelle
      </button>
      {showImport && <ImportTicketSheet onClose={()=>setShowImport(false)} onImport={onImport} refProducts={produitsRef.map(p=>({ nom: p.produit_generique, categorie: p.sous_categorie }))}/>}
      {showEntry  && <PriceEntrySheet  onClose={()=>setShowEntry(false)} onSave={onSavePrice}/>}
    </div>
  );
}

// ── HOME TAB ─────────────────────────────────────────────────────────────────
function HomeTab({ items, circles, profileMap, userId, setTab, onCircle, onFlash }) {
  const F = "'Nunito',sans-serif";
  const unchecked = items.filter(i => !i.checked).length;
  const members   = circles.filter(c => c.status === 'accepted');
  const avatarBg  = ["#E5181B","#F5C200","#00B341","#4A90D9","#8E44AD"];

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
      <img
        src="/illustration-home.png" alt=""
        style={{ position:"absolute", bottom:64, left:0, width:"100%", pointerEvents:"none", zIndex:1 }}
        onError={e => { e.target.style.display = "none"; }}
      />

      {/* ── Barre du haut ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 20px 0", position:"relative", zIndex:10 }}>

        {/* Logo PM */}
        <div style={{ background:"#E5181B", borderRadius:12, width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:F, fontWeight:900, fontSize:17, color:"#fff", boxShadow:"0 3px 12px rgba(229,24,27,0.45)", letterSpacing:"-0.5px" }}>
          PM
        </div>

        {/* Avatar Moi */}
        <div onClick={onCircle} style={{ background:"#E5181B", borderRadius:99, width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:F, fontWeight:900, fontSize:12, color:"#fff", boxShadow:"0 3px 12px rgba(229,24,27,0.45)", cursor:"pointer" }}>
          Moi
        </div>
      </div>

      {/* ── Navigation circulaire ── */}
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", zIndex:10, paddingBottom:20 }}>
        <div style={{ position:"relative", width:300, height:290 }}>

          {/* Ma liste — haut centre */}
          <div style={{ position:"absolute", top:0, left:"50%", transform:"translateX(-50%)" }}>
            <button onClick={() => setTab("list")} style={{
              background:"#fff", border:"none", borderRadius:16,
              padding:"11px 18px",
              fontFamily:F, fontWeight:900, fontSize:14, color:"#111",
              cursor:"pointer", boxShadow:"0 4px 20px rgba(0,0,0,0.13)",
              display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap",
            }}>
              <span style={{ fontSize:16 }}>📋</span>
              Ma liste
              {unchecked > 0 && (
                <span style={{ background:"#E5181B", color:"#fff", borderRadius:99, padding:"2px 8px", fontSize:11, fontWeight:900 }}>
                  {unchecked}
                </span>
              )}
            </button>
          </div>

          {/* Catalogue — bas gauche */}
          <div style={{ position:"absolute", bottom:0, left:0 }}>
            <NavBtn label="Catalogue" icon="🛍️" target="catalog" />
          </div>

          {/* Comparer — bas droite */}
          <div style={{ position:"absolute", bottom:0, right:0 }}>
            <NavBtn label="Comparer" icon="🏪" target="compare" />
          </div>

          {/* Bouton Flasher — centre */}
          <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%, -46%)", display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
            <button onClick={() => onFlash()} style={{
              width:118, height:118,
              borderRadius:"50%",
              background:"#E5181B",
              border:"5px solid #fff",
              cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:5,
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
            </button>
            <div style={{ fontFamily:F, fontSize:13, color:"rgba(0,0,0,0.55)", fontWeight:700, textAlign:"center" }}>
              un ticket de caisse
            </div>
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

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [session,   setSession]   = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab]           = useState("home");
  const [items, setItems]       = useState([]);
  const [priceDB, setPriceDB]     = useState([]);
  const [archives, setArchives]   = useState([]);
  const [showSuccess, setShowSuccess] = useState(null);
  const [showRating,  setShowRating]  = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [loaded, setLoaded]       = useState(false);
  const [produitsRef, setProduitsRef] = useState([]);
  const [circles,    setCircles]    = useState([]);
  const [autoOpenCamera, setAutoOpenCamera] = useState(false);
  const handleFlash = () => { setAutoOpenCamera(true); setTab("prices"); };
  const [showCircle, setShowCircle] = useState(false);
  const [pseudo,     setPseudo]     = useState(null);
  const [profileMap, setProfileMap] = useState({});
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
        setPseudo(null); setProfileMap({});
        setLoaded(false); listRowId.current = null; favRowId.current = null;
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Chargement données — uniquement si session active
  useEffect(()=>{
    if (!session) return;
    setLoaded(false);
    (async ()=>{
      try {
        const [list, prices, arcs, favs, refs, circs, prof] = await Promise.all([
          supabase.from('shopping_list').select('id, items').order('id').limit(1),
          supabase.from('price_db').select('*'),
          supabase.from('archives').select('*').order('date'),
          supabase.from('favorites').select('id, items').order('id').limit(1),
          supabase.from('produits_ref').select('produit_generique, sous_categorie, formats_courants, marques_nationales, marques_distributeurs').order('id'),
          supabase.from('circles').select('*'),
          supabase.from('profiles').select('pseudo').eq('id', session.user.id).maybeSingle(),
        ]);
        if (refs.data)  setProduitsRef(refs.data);
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
      } catch(e){ console.log("Supabase load:", e); }
      setLoaded(true);
    })();
  },[session]);

  const saveItems = async (v) => {
    setItems(v);
    try {
      if (listRowId.current) {
        const { error } = await supabase.from('shopping_list').update({items:v}).eq('id', listRowId.current);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('shopping_list').insert({items:v, user_id: session?.user?.id}).select('id').single();
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
      user_id: session?.user?.id,
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

  const handleValidate = (store, potentialSaving = 0) => {
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
    saveItems([]);
    setShowSuccess(store);
    setTimeout(()=>{setShowSuccess(null);setTab("archive");},2800);
  };

  const inviteToCircle = async (email) => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed === session.user.email.toLowerCase()) return { error: "Tu ne peux pas t'inviter toi-même" };
    const existing = circles.find(c =>
      (c.requester_id === session.user.id && c.recipient_email?.toLowerCase() === trimmed) ||
      (c.recipient_id === session.user.id && c.requester_email?.toLowerCase() === trimmed)
    );
    if (existing && existing.status !== 'revoked' && existing.status !== 'declined') {
      return { error: "Invitation déjà envoyée ou cercle déjà actif" };
    }
    const { data, error } = await supabase.from('circles').insert({
      requester_id: session.user.id,
      requester_email: session.user.email,
      recipient_email: trimmed,
    }).select().single();
    if (error) return { error: error.message };
    setCircles(prev => [...prev, data]);
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
    const { error } = await supabase.from('profiles').upsert({ id: session.user.id, pseudo: value });
    if (!error) setPseudo(value);
  };

  const handleImportPrices = entries => {
    const openArchive = [...archives].reverse().find(a => !a.ticket_scanned);
    let realizedSaving = null;
    if (openArchive) {
      realizedSaving = 0;
      entries.forEach(e => {
        const archiveItem = openArchive.items.find(item =>
          normName(item.product) === normName(e.product) &&
          normFormat(item.format || '') === normFormat(e.format || '')
        );
        if (!archiveItem) return;
        const qty = archiveItem.qty || 1;
        const eKey = `${normName(e.brand||'')}_${normName(e.product)}_${normFormat(e.format||'')}`;
        const alts = priceDB.filter(p => {
          const pKey = `${normName(p.brand||'')}_${normName(p.product)}_${normFormat(p.format||'')}`;
          return pKey === eKey && p.storeId !== e.storeId;
        });
        if (alts.length > 0) {
          const avgMarket = alts.reduce((s, p) => s + p.price, 0) / alts.length;
          realizedSaving += (avgMarket - e.price) * qty;
        }
      });
      realizedSaving = Math.round(realizedSaving * 100) / 100;
      updateArchive(openArchive.id, { ticket_scanned: true, realized_saving: realizedSaving });
      setShowRating({ id: openArchive.id, store: openArchive.store });
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

  return (
    <>
      {globalStyle}
      <div style={{ minHeight:"100vh", background:C.bg, maxWidth:430, margin:"0 auto" }}>
        {tab !== "home" && (
          <Header tab={tab} itemCount={items.length} userEmail={session.user.email} displayName={pseudo} onLogout={handleLogout}
            pendingCount={circles.filter(c=>(c.recipient_id===session.user.id||c.recipient_email?.toLowerCase()===session.user.email?.toLowerCase())&&c.status==='pending').length}
            onCircle={()=>setShowCircle(true)}/>
        )}
        <div style={{ paddingTop: tab === "home" ? 0 : 4 }}>
          {!loaded && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:200, gap:16 }}>
              <div style={{ width:40, height:40, border:"4px solid #EFEFEF", borderTopColor:"#CC0000", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, color:"#999" }}>Chargement...</div>
            </div>
          )}
          {loaded && tab==="home"      && <HomeTab      items={items} circles={circles} profileMap={profileMap} userId={session?.user?.id} setTab={setTab} onCircle={()=>setShowCircle(true)} onFlash={handleFlash}/>}
          {loaded && tab==="list"      && <ListTab      items={items} setItems={saveItems} setTab={setTab} favorites={favorites} saveFavorites={saveFavorites}/>}
          {loaded && tab==="catalog"   && <CatalogTab   items={items} setItems={saveItems} setTab={setTab} catalog={catalog} priceDB={priceDB}/>}
          {loaded && tab==="compare"   && <CompareTab   items={items} priceDB={priceDB} onValidate={handleValidate}/>}
          {loaded && tab==="prices"    && <PricesTab    priceDB={priceDB} setPriceDB={savePriceDB} archives={archives} updateArchive={updateArchive} autoOpenCamera={autoOpenCamera} onAutoOpenConsumed={()=>setAutoOpenCamera(false)} onTicketValidated={(id,store)=>setShowRating({id,store})} onCreateArchive={async newArc=>{
            const {id:_id,...rest}=newArc;
            const {data,error}=await supabase.from('archives').insert({...rest,user_id:session?.user?.id}).select('id').single();
            if(error){ console.error("Erreur création archive ticket :",error); showAppToast("⚠️ Archive non sauvegardée, vérifie ta connexion",false); }
            else {
              const {data:all}=await supabase.from('archives').select('*').order('date');
              if(all) setArchives(all);
              setShowRating({id:data.id,store:newArc.store});
            }
          }} userId={session?.user?.id} produitsRef={produitsRef}/>}
          {loaded && tab==="archive"   && <ArchiveTab   archives={archives} onDelete={deleteArchive} priceDB={priceDB} onImport={handleImportPrices} onSavePrice={handleSavePrice} produitsRef={produitsRef} onAddToList={arcItem=>{
            const newItem={id:Date.now()+Math.random(),product:arcItem.product,format:arcItem.format||"",brand:arcItem.brand||"",qty:arcItem.qty||1,checked:false};
            saveItems([...items,newItem]);
            showAppToast(`✓ ${arcItem.product} ajouté à ta liste`);
          }}/>}
          {loaded && tab==="economies" && <EconomiesTab priceDB={priceDB} archives={archives} items={items} setTab={setTab}/>}
        </div>
        <TabBar tab={tab} setTab={setTab}/>
        {appToast && <Toast msg={appToast.msg} ok={appToast.ok}/>}
        {showCircle && <ProfilSheet circles={circles} userId={session.user.id} userEmail={session.user.email} profileMap={profileMap} pseudo={pseudo} archives={archives} onClose={()=>setShowCircle(false)} onInvite={inviteToCircle} onUpdateStatus={updateCircleStatus} onLogout={handleLogout}/>}
        {loaded && pseudo === null && <PseudoModal onSave={savePseudo}/>}
        {showRating && (
          <StoreRatingScreen
            store={showRating.store}
            onSave={async rating=>{ const {error}=await updateArchive(showRating.id,{store_rating:rating}); if(error) showAppToast("⚠️ Note non sauvegardée, vérifie ta connexion",false); setShowRating(null); setTab("home"); }}
            onSkip={()=>{ setShowRating(null); setTab("home"); }}
          />
        )}
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
