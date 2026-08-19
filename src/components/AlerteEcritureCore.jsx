// Chantier 109 — l'écran qui dit que le comparateur n'a PAS reçu les prix.
//
// Il existe parce que le 18/08 l'app a affiché « partagé » alors que la base
// venait de répondre {"statut":"rejet"} : ni ticket, ni ligne, ni prix côté
// Core. Un toast de deux secondes ne suffit pas pour ça — un échec silencieux
// remplacé par un message qu'on peut rater n'est qu'un échec plus discret.
//
// Ce qu'il ne fait PAS : dramatiser. Le circuit historique a bien enregistré
// les prix dans l'historique personnel et le partage communauté ; c'est le
// comparateur qui n'a rien reçu. On le dit exactement comme ça.
const F = "'Nunito',sans-serif";

export default function AlerteEcritureCore({ resultat, onFermer }) {
  if (!resultat) return null;
  const { titre, detail, messageTechnique } = resultat;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 640, display: 'flex', alignItems: 'flex-end' }} onClick={onFermer}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <div style={{ fontFamily: F, fontWeight: 900, fontSize: 17, color: '#CC0000', lineHeight: 1.35 }}>
          ⚠️ {titre}
        </div>
        {detail && (
          <div style={{ fontFamily: F, fontSize: 13, color: '#666', marginTop: 8, lineHeight: 1.5 }}>
            {detail}
          </div>
        )}

        <div style={{ marginTop: 12, padding: 12, background: '#F5F6F8', borderRadius: 10, fontFamily: F, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
          Ce qui a bien été enregistré : tes prix dans ton historique personnel, et le partage avec la communauté. Ce qui manque : la remontée vers le comparateur de prix.
        </div>

        {/* Message brut du serveur, volontairement petit et en monospace : il
            ne s'adresse pas à l'utilisateur mais au diagnostic. Le cacher
            obligerait à retourner lire la base, ce qu'on cherche à éviter. */}
        {messageTechnique && (
          <div style={{ marginTop: 10, padding: 10, background: '#FFF8E1', border: '1px solid #F0DFA0', borderRadius: 8, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10, color: '#7A6000', lineHeight: 1.45, wordBreak: 'break-word' }}>
            {messageTechnique}
          </div>
        )}

        <button
          onClick={onFermer}
          style={{ width: '100%', marginTop: 16, padding: 14, border: 'none', borderRadius: 12, background: '#00B341', color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}
        >
          J'ai compris
        </button>
      </div>
    </div>
  );
}
