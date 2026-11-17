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

// Chantier 138 — les grandes enseignes NATIONALES, pas seulement celles déjà
// scannées dans l'app : la page de garde parle à tout le monde, partout en France.
const ENSEIGNES = [
  'E.Leclerc', 'Carrefour', 'Intermarché', 'Super U', 'Auchan', 'Lidl', 'Aldi', 'Netto', 'Casino',
  'Monoprix', 'Franprix', 'Carrefour Market', 'Carrefour City', 'Hyper U', 'U Express', 'Picard',
  'Biocoop', 'Grand Frais', 'Naturalia', 'La Vie Claire', 'Match', 'Colruyt', 'Spar', 'G20',
  'Costco', 'Leader Price', 'Vival',
];
const PRODUITS = ['Lait 1L', 'Pâtes 500g', 'Beurre', 'Emmental', 'Riz 1kg', 'Café', 'Yaourts x12', 'Bananes', 'Jambon', 'Œufs x6', 'Huile 1L', 'Farine', 'Tomates', 'Chocolat', 'Eau 6x1L'];
const DUREES = [34, 25, 40]; // secondes pour un tour complet, par colonne

const prix = (n) => n.toFixed(2).replace('.', ',');

// Tirage toujours identique (pas de hasard à l'affichage).
function fabriquerColonnes(nbColonnes = 3, ticketsParColonne = 9) {
  let graine = 7;
  const alea = () => { graine = (graine * 9301 + 49297) % 233280; return graine / 233280; };
  // Les enseignes sont mélangées puis distribuées une à une : chacune apparaît
  // (27 enseignes pour 27 tickets), au lieu d'en tirer au sort avec des redites.
  const melange = [...ENSEIGNES];
  for (let i = melange.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [melange[i], melange[j]] = [melange[j], melange[i]];
  }
  let rang = 0;
  const colonnes = [];
  for (let c = 0; c < nbColonnes; c++) {
    const tickets = [];
    for (let k = 0; k < ticketsParColonne; k++) {
      const nb = 3 + Math.floor(alea() * 4);
      const enseigne = melange[rang++ % melange.length];
      const bonPrix = Math.floor(alea() * nb);
      const lignes = [];
      let total = 0;
      for (let i = 0; i < nb; i++) {
        const montant = Math.round((0.6 + alea() * 4.2) * 100) / 100;
        total += montant;
        // Jamais deux fois le même produit sur un ticket.
        let nom = PRODUITS[Math.floor(alea() * PRODUITS.length)];
        while (lignes.some(l => l.nom === nom)) nom = PRODUITS[(PRODUITS.indexOf(nom) + 1) % PRODUITS.length];
        lignes.push({ nom, montant, bonPrix: i === bonPrix });
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

// Deux usages :
// - pas connecté : « Commencer » (créer un compte) + « J'ai déjà un compte » ;
// - connecté, à chaque ouverture de l'app (chantier 136) : un seul bouton, et
//   la barre du bas reste visible par-dessus (`avecBarreDuBas`).
export default function PageDeGarde({ onCommencer, onDejaUnCompte = null, libelleBouton = 'Commencer', avecBarreDuBas = false }) {
  // Chantier 136 bis — sur iPhone, les icônes du bas ne répondaient pas tant
  // que la page de garde était là. La page est donc enfermée dans sa propre
  // couche, SOUS la barre du bas (`isolation` + `zIndex: 0`), et tout ce qui
  // n'est pas un bouton laisse passer les appuis (`pointerEvents: 'none'`).
  return (
    <div style={{ position: 'relative', zIndex: 0, isolation: 'isolate', minHeight: '100dvh', maxWidth: 430, margin: '0 auto', overflow: 'hidden', background: '#14060A' }}>
      <style>{`
        @keyframes pmChuteTickets { from { transform: translateY(-50%); } to { transform: translateY(0); } }
        .pm-colonne-tickets { animation: pmChuteTickets linear infinite; will-change: transform; }
        @media (prefers-reduced-motion: reduce) { .pm-colonne-tickets { animation: none; } }
      `}</style>

      {/* Le décor : purement décoratif, invisible pour un lecteur d'écran. */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', gap: 10, padding: '0 10px', pointerEvents: 'none' }}>
        {COLONNES.map((tickets, c) => (
          <div key={c} style={{ flex: 1, minWidth: 0 }}>
            <div className="pm-colonne-tickets" style={{ display: 'flex', flexDirection: 'column', gap: 14, animationDuration: `${DUREES[c % DUREES.length]}s` }}>
              {/* La liste est affichée deux fois de suite : la boucle est sans couture. */}
              {[...tickets, ...tickets].map((t, i) => <Ticket key={i} ticket={t} />)}
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(20,6,10,0.66)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: avecBarreDuBas ? '0 28px 96px' : '0 28px', textAlign: 'center', boxSizing: 'border-box', pointerEvents: 'none' }}>
        {/* Un fond plus sombre juste derrière le texte : il reste lisible
            quel que soit le ticket qui passe dessous. */}
        <div style={{ width: '100%', background: 'rgba(20,6,10,0.82)', borderRadius: 26, padding: '30px 20px 12px', boxSizing: 'border-box', pointerEvents: 'auto' }}>
          <h1 style={{ margin: 0, fontFamily: T.police, fontWeight: 900, fontSize: 46, color: '#fff', letterSpacing: '-1.5px', lineHeight: 1 }}>
            Prix<span style={{ color: T.jaune }}>Malin</span>
          </h1>
{/* Chantier 137 — l'ancien message (« Tes tickets de caisse te disent
              où ta liste coûte le moins cher ») laissait croire qu'il fallait
              déjà avoir ses propres tickets. Choix de François (17/11) : le
              message COMMUNAUTAIRE, un des piliers de communication de l'app. */}
          <p style={{ fontFamily: T.police, fontWeight: 800, fontSize: 19, color: '#fff', margin: '16px 0 8px', lineHeight: 1.4 }}>
            Ensemble, on trouve<br />le magasin le moins cher.
          </p>
          <p style={{ fontFamily: T.police, fontWeight: 700, fontSize: 14, color: '#D3D1C7', margin: '0 0 26px', lineHeight: 1.45 }}>
            Chaque ticket scanné aide tout le monde<br />à faire des économies.
          </p>
          <button onClick={onCommencer} style={{ width: '100%', border: 'none', background: T.rouge, color: '#fff', borderRadius: 16, padding: 16, fontFamily: T.police, fontWeight: 900, fontSize: 17, cursor: 'pointer' }}>
            {libelleBouton}
          </button>
{onDejaUnCompte ? (
            <button onClick={onDejaUnCompte} style={{ border: 'none', background: 'none', color: '#fff', padding: '16px 12px', fontFamily: T.police, fontWeight: 800, fontSize: 15, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 4 }}>
              J'ai déjà un compte
            </button>
          ) : <div style={{ height: 18 }} />}
        </div>
      </div>
    </div>
  );
}
