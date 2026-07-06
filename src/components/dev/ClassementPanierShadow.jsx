// #58.2.B étape 2 — rendu shadow du classement panier (principal + appoint),
// visible uniquement derrière l'interrupteur dev de CompareTab (App.jsx),
// lui-même gardé par import.meta.env.DEV. N'affecte jamais l'écran actuel
// (best/secondBest) : ce composant n'est monté que quand l'utilisateur dev
// bascule explicitement sur "Nouvelle vue".
//
// Purement présentationnel : toute la donnée (agrégats, lignes par article,
// URL Maps) est déjà calculée par CompareTab (voir shadowPanier). Aucune
// logique de matching, de fraîcheur, de distance ou de calcul de ratio ici.

const F = "'Nunito',sans-serif";

function LigneArticle({ ligne, dernier }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"10px 18px", borderBottom: dernier ? "none" : "1px solid rgba(255,255,255,0.15)" }}>
      <div style={{ flex:1, minWidth:0, fontFamily:F, fontWeight:700, fontSize:13, color:"rgba(255,255,255,0.92)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {ligne.libelle}
      </div>
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:14, color:"#fff" }}>
          {ligne.total != null ? `${ligne.total.toFixed(2)} €` : "—"}
        </div>
        {ligne.ratioLabel && (
          <div style={{ fontFamily:F, fontSize:10, color:"rgba(255,255,255,0.55)", marginTop:1 }}>{ligne.ratioLabel}</div>
        )}
      </div>
    </div>
  );
}

function CarteMagasin({ badge, background, magasin, compteurLabel }) {
  if (!magasin) return null;

  return (
    <div style={{ background, borderRadius:18, overflow:"hidden", marginBottom:16, boxShadow:"0 8px 24px rgba(0,0,0,0.22)" }}>
      <div style={{ padding:"16px 18px 0", display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
        <div style={{ background:"rgba(255,255,255,0.25)", borderRadius:8, padding:"4px 12px", fontFamily:F, fontWeight:900, fontSize:11, color:"#fff", letterSpacing:"0.04em" }}>
          {badge}
        </div>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:28, color:"#fff" }}>{magasin.total.toFixed(2)} €</div>
      </div>

      <div style={{ padding:"8px 18px 14px" }}>
        <div style={{ fontFamily:F, fontWeight:900, fontSize:18, color:"#fff" }}>{magasin.magasinNom}</div>
        <div style={{ fontFamily:F, fontSize:12, color:"rgba(255,255,255,0.75)", marginTop:2 }}>{compteurLabel}</div>
      </div>

      <div style={{ background:"rgba(0,0,0,0.15)" }}>
        {magasin.lignes.map((ligne, i) => (
          <LigneArticle key={ligne.articleId} ligne={ligne} dernier={i === magasin.lignes.length - 1} />
        ))}
      </div>

      <div style={{ padding:"12px 18px 16px" }}>
        <a
          href={magasin.mapsUrl} target="_blank" rel="noopener noreferrer"
          style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:"#fff", borderRadius:20, padding:"10px 18px", fontFamily:F, fontWeight:700, fontSize:14, color:"#111", textDecoration:"none", boxShadow:"0 2px 6px rgba(0,0,0,0.15)" }}
        >
          📍 Y aller
        </a>
      </div>
    </div>
  );
}

export default function ClassementPanierShadow({ resultat }) {
  const { principal, appoint, nonTrouves, totalArticles } = resultat;

  return (
    <div>
      <div style={{ fontFamily:F, fontSize:11, fontWeight:800, color:"#999", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 }}>
        🧪 Vue shadow #58.2.B — classement par magasin physique (dev uniquement)
      </div>

      {!principal && (
        <div style={{ background:"#FFF8E6", borderRadius:14, padding:"24px 20px", textAlign:"center", fontFamily:F, fontSize:13, color:"#7A6000" }}>
          Aucun magasin physique ne couvre au moins un article du panier.
        </div>
      )}

      <CarteMagasin
        badge="🥇 MEILLEUR PANIER"
        background="linear-gradient(145deg,#00963A,#00D14F)"
        magasin={principal}
        compteurLabel={principal ? `${principal.nbTrouves} article${principal.nbTrouves > 1 ? "s" : ""} sur ${totalArticles}` : ""}
      />

      <CarteMagasin
        badge="➕ COMPLÉMENT"
        background="linear-gradient(145deg,#125EA8,#1E88E5)"
        magasin={appoint}
        compteurLabel={appoint ? `${appoint.nbTrouves} article${appoint.nbTrouves > 1 ? "s" : ""} apporté${appoint.nbTrouves > 1 ? "s" : ""}` : ""}
      />

      {nonTrouves.length > 0 && (
        <div style={{ background:"#F5F5F5", borderRadius:12, padding:"12px 16px", marginTop:4 }}>
          <div style={{ fontFamily:F, fontWeight:800, fontSize:12, color:"#777", marginBottom:6 }}>Prix non enregistré :</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {nonTrouves.map(article => (
              <span key={article.articleId} style={{ fontFamily:F, fontSize:12, color:"#555", background:"#fff", borderRadius:99, padding:"4px 10px", border:"1px solid #ddd" }}>
                {article.libelle}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
