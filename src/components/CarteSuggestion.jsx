// Chantier 111 — la carte « On dirait : … » en haut de l'écran de correction.
//
// Elle AFFICHE ce que l'app a deviné. Elle ne remplit rien.
//
// C'est la leçon directe du chantier 110 : un état pré-rempli finit par être
// validé sans être lu. Tant que « Oui, c'est ça » n'a pas été tapé, l'écran
// est exactement dans l'état d'une ligne sans suggestion — champ de recherche
// vide, aucun produit retenu. Et « Oui, c'est ça » n'applique rien non plus :
// il ouvre le récapitulatif du 110, celui qui met le texte de caisse face au
// produit. Une suggestion ne saute jamais cette étape.

const F = "'Nunito',sans-serif";

export default function CarteSuggestion({ carte, onAccepter, onRefuser }) {
  if (!carte) return null;
  const { libelleTicket, libelleTicketDisponible, nomProduit, marque, format, origine } = carte;

  return (
    <div style={{ background: '#F0F6FC', border: '1px solid #CFE0F0', borderRadius: 12, padding: '13px 14px', marginBottom: 14 }}>

      {/* Le texte BRUT du ticket. Le même que dans le récapitulatif du 110, et
          pour la même raison : c'est la seule version que l'OCR n'a pas
          réinterprétée, donc la seule contre laquelle on peut juger. */}
      {libelleTicketDisponible && (
        <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: '#555', marginBottom: 8, wordBreak: 'break-word' }}>
          {libelleTicket}
        </div>
      )}

      <div style={{ fontFamily: F, fontSize: 14, color: '#333', lineHeight: 1.4 }}>
        On dirait : <strong style={{ fontWeight: 900 }}>{nomProduit}</strong>
      </div>
      {(marque || format) && (
        <div style={{ fontFamily: F, fontSize: 12, color: '#777', marginTop: 2 }}>
          {[marque, format].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* La provenance, en français simple : elle aide à juger. « Déjà vu dans
          cette enseigne » est un signal plus fort qu'une ressemblance de
          libellé, et le dire évite d'avoir à connaître le modèle de données. */}
      <div style={{ fontFamily: F, fontSize: 11, color: '#8899AA', marginTop: 4, fontStyle: 'italic' }}>
        {origine}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <button
          onClick={onAccepter}
          style={{ padding: '11px 12px', border: 'none', borderRadius: 10, fontFamily: F, fontWeight: 900, fontSize: 13, color: '#FFF', background: '#4A90D9', cursor: 'pointer' }}
        >
          Oui, c'est ça
        </button>
        <button
          onClick={onRefuser}
          style={{ padding: '11px 12px', border: 'none', borderRadius: 10, fontFamily: F, fontWeight: 800, fontSize: 13, color: '#333', background: '#E7EDF3', cursor: 'pointer' }}
        >
          Non, chercher autre chose
        </button>
      </div>
    </div>
  );
}
