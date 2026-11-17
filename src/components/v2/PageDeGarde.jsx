// Chantier 135 — page de garde (idée de François, 17/11) : des tickets de
// caisse glissent en colonnes, façon « Matrix », derrière le nom de l'app.
// C'est la première chose que voit quelqu'un qui n'est pas connecté.
//
// Choix assumés :
// - le nom des enseignes est écrit en toutes lettres, SANS leurs logos
//   (marques déposées) ;
// - sur chaque ticket, une ligne est surlignée en jaune : le bon prix repéré,
//   donc ce que fait l'app ;
// - les tickets sont fabriqués une fois pour toutes (toujours les mêmes), et
//   l'animation s'arrête si le téléphone demande « moins d'animations ».
import { T } from './theme';

const ENSEIGNES = ['Leclerc', 'Carrefour', 'Lidl', 'Intermarché', 'Netto', 'Auchan', 'Super U', 'Monoprix', 'Aldi', 'Casino'];
const PRODUITS = ['Lait 1L', 'Pâtes 500g', 'Beurre', 'Emmental', 'Riz 1kg', 'Café', 'Yaourts x12', 'Bananes', 'Jambon', 'Œufs x6', 'Huile 1L', 'Farine', 'Tomates', 'Chocolat', 'Eau 6x1L'];
const DUREES = [26, 19, 31]; // secondes pour un tour complet, par colonne

const prix = (n) => n.toFixed(2).replace('.', ',');

// Tirage toujours identique (pas de hasard à l'affichage).
function fabriquerColonnes(nbColonnes = 3, ticketsParColonne = 7) {
  let graine = 7;
  const alea = () => { graine = (graine * 9301 + 49297) % 233280; return graine / 233280; };
  const colonnes = [];
  for (let c = 0; c < nbColonnes; c++) {
    const tickets = [];
    for (let k = 0; k < ticketsParColonne; k++) {
      const nb = 3 + Math.floor(alea() * 4);
      const enseigne = ENSEIGNES[Math.floor(alea() * ENSEIGNES.length)];
      const bonPrix = Math.floor(alea() * nb);
      const lignes = [];
      let total = 0;
      for (let i = 0; i < nb; i++) {
        const montant = Math.round((0.6 + alea() * 4.2) * 100) / 100;
        total += montant;
        lignes.push({ nom: PRODUITS[Math.floor(alea() * PRODUITS.length)], montant, bonPrix: i === bonPrix });
      }
      tickets.push({ enseigne, lignes, total: Math.round(total * 100) / 100 });
    }
    colonnes.push(tickets);
  }
  return colonnes;
}

const COLONNES = fabriquerColonnes();

function Ticket({ ticket }) {
  return (
    <div style={{ background: '#FFFDF6', borderRadius: 3, padding: '8px 7px 10px', fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize: 10.5, lineHeight: 1.4, color: '#2C2C2A' }}>
      <div style={{ textAlign: 'center', fontWeight: 700, borderBottom: '1px dashed #B4B2A9', paddingBottom: 3, marginBottom: 3 }}>{ticket.enseigne}</div>
      {ticket.lignes.map((l, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 4, background: l.bonPrix ? T.jaune : 'transparent', borderRadius: 2 }}>
          <span style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>{l.nom}</span><span>{prix(l.montant)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #B4B2A9', marginTop: 3, paddingTop: 3, fontWeight: 700 }}>
        <span>Total</span><span>{prix(ticket.total)}</span>
      </div>
    </div>
  );
}

export default function PageDeGarde({ onCommencer, onDejaUnCompte }) {
  return (
    <div style={{ position: 'relative', minHeight: '100dvh', maxWidth: 430, margin: '0 auto', overflow: 'hidden', background: '#14060A' }}>
      <style>{`
        @keyframes pmChuteTickets { from { transform: translateY(-50%); } to { transform: translateY(0); } }
        .pm-colonne-tickets { animation: pmChuteTickets linear infinite; will-change: transform; }
        @media (prefers-reduced-motion: reduce) { .pm-colonne-tickets { animation: none; } }
      `}</style>

      {/* Le décor : purement décoratif, invisible pour un lecteur d'écran. */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', gap: 10, padding: '0 10px' }}>
        {COLONNES.map((tickets, c) => (
          <div key={c} style={{ flex: 1, minWidth: 0 }}>
            <div className="pm-colonne-tickets" style={{ display: 'flex', flexDirection: 'column', gap: 14, animationDuration: `${DUREES[c % DUREES.length]}s` }}>
              {/* La liste est affichée deux fois de suite : la boucle est sans couture. */}
              {[...tickets, ...tickets].map((t, i) => <Ticket key={i} ticket={t} />)}
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(20,6,10,0.66)' }} />

      <div style={{ position: 'relative', minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px', textAlign: 'center', boxSizing: 'border-box' }}>
        {/* Un fond plus sombre juste derrière le texte : il reste lisible
            quel que soit le ticket qui passe dessous. */}
        <div style={{ width: '100%', background: 'rgba(20,6,10,0.82)', borderRadius: 26, padding: '30px 20px 12px', boxSizing: 'border-box' }}>
          <h1 style={{ margin: 0, fontFamily: T.police, fontWeight: 900, fontSize: 46, color: '#fff', letterSpacing: '-1.5px', lineHeight: 1 }}>
            Prix<span style={{ color: T.jaune }}>Malin</span>
          </h1>
          <p style={{ fontFamily: T.police, fontWeight: 700, fontSize: 17, color: '#F1EFE8', margin: '14px 0 30px', lineHeight: 1.45 }}>
            Tes tickets de caisse te disent où ta liste coûte le moins cher.
          </p>
          <button onClick={onCommencer} style={{ width: '100%', border: 'none', background: T.rouge, color: '#fff', borderRadius: 16, padding: 16, fontFamily: T.police, fontWeight: 900, fontSize: 17, cursor: 'pointer' }}>
            Commencer
          </button>
          <button onClick={onDejaUnCompte} style={{ border: 'none', background: 'none', color: '#fff', padding: '16px 12px', fontFamily: T.police, fontWeight: 800, fontSize: 15, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 4 }}>
            J'ai déjà un compte
          </button>
        </div>
      </div>
    </div>
  );
}
