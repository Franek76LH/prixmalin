// Chantier 110 — la relecture avant d'appliquer une correction d'association.
//
// Pourquoi un écran et pas un simple bouton « Valider » : une correction
// manuelle écrit methode='humaine', crée une correspondance qui se
// réappliquera toute seule aux tickets suivants, et propose un alias global.
// C'est le geste le plus lourd de conséquences de l'application, et c'était
// jusqu'ici le plus rapide à faire — un seul tap sur un résultat de recherche.
//
// L'écran met les deux identités face à face, en toutes lettres. Rien à
// déduire, rien à deviner : le texte imprimé sur le ticket d'un côté, le
// produit choisi de l'autre.

const F = "'Nunito',sans-serif";

export default function RecapitulatifAssociation({ recapitulatif, enCours = false, onConfirmer, onAnnuler }) {
  if (!recapitulatif) return null;
  const {
    libelleTicket,
    libelleAffiche,
    libelleTicketDisponible,
    nomProduit,
    marque,
    format,
    divergent,
  } = recapitulatif;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, minHeight: 0, paddingBottom: 8 }}>

      {/* Garde-fou de mots communs. Bandeau ambre, JAMAIS un blocage : le
          libellé d'une caisse est abrégé et parfois trompeur (« DC-ELABORES
          SAUCISSE » pour une saucisse à cuire), donc les fausses alertes sont
          attendues et normales. On attire l'œil, on ne décide pas à la place
          de l'utilisateur — le bouton de confirmation reste actif. */}
      {divergent && (
        <div style={{ background: '#FFF8E1', border: '1px solid #F0DFA0', borderRadius: 12, padding: '12px 14px', fontFamily: F, fontSize: 13, color: '#7A6000', lineHeight: 1.5 }}>
          ⚠️ Ce produit ne ressemble pas à la ligne du ticket. Vérifie avant de confirmer.
        </div>
      )}

      {/* Côté ticket — le texte BRUT imprimé. C'est la seule version que l'OCR
          n'a pas réinterprétée, donc la seule qui puisse contredire une
          mauvaise lecture. */}
      <div>
        <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#999', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
          Ligne du ticket
        </div>
        <div style={{ background: '#F4F6F8', borderRadius: 10, padding: '11px 13px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, color: '#333', wordBreak: 'break-word' }}>
          {libelleTicketDisponible ? libelleTicket : (libelleAffiche || '(libellé indisponible)')}
        </div>
        {/* Point 4 — anciennes lignes sans texte brut : on le DIT plutôt que de
            faire passer le libellé normalisé pour l'imprimé. */}
        {!libelleTicketDisponible && (
          <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 4, lineHeight: 1.4 }}>
            Texte brut du ticket indisponible pour cette ligne — vérification automatique impossible.
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center', fontSize: 18, color: '#CCC', lineHeight: 1 }}>↓</div>

      {/* Côté produit choisi — nom, marque, format. */}
      <div>
        <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#999', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
          Produit choisi
        </div>
        <div style={{ background: '#F4F6F8', borderRadius: 10, padding: '11px 13px' }}>
          <div style={{ fontFamily: F, fontSize: 15, fontWeight: 800, color: '#333' }}>
            {nomProduit || '(produit sans nom)'}
          </div>
          {(marque || format) && (
            <div style={{ fontFamily: F, fontSize: 12, color: '#777', marginTop: 3 }}>
              {[marque, format].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 2 }}>
        <button
          onClick={onAnnuler}
          disabled={enCours}
          style={{ padding: '13px 16px', border: 'none', borderRadius: 12, fontFamily: F, fontWeight: 800, fontSize: 14, color: '#333', background: '#EFEFEF', cursor: enCours ? 'default' : 'pointer', opacity: enCours ? 0.6 : 1 }}
        >
          Annuler
        </button>
        <button
          onClick={onConfirmer}
          disabled={enCours}
          style={{ padding: '13px 16px', border: 'none', borderRadius: 12, fontFamily: F, fontWeight: 900, fontSize: 14, color: '#FFF', background: enCours ? '#CCC' : '#4A90D9', cursor: enCours ? 'default' : 'pointer' }}
        >
          {enCours ? 'Association...' : "Confirmer l'association"}
        </button>
      </div>
    </div>
  );
}
