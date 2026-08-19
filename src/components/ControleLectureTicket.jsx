// Chantier 108 — les trois écrans du contrôle de cohérence d'un ticket lu.
//
// Le cas réel : ticket Netto de 45,33 € et 20 articles ; l'OCR a rendu 31
// lignes pour 115,45 €, avec des libellés hallucinés et une date de 2009 lue
// sur le numéro de téléphone du magasin. Tout est passé sans un mot, et 31
// lignes fausses ont atterri dans la file de validation.
//
// Trois réactions, graduées, et toutes fondées sur des chiffres MESURÉS :
//   - EcranLectureRefusee     : au-delà de 10 % d'écart, on n'importe pas.
//   - BandeauLectureIncomplete: entre 2 % et 10 %, on prévient, on n'empêche rien.
//   - ConfirmationDateTicket  : une date future ou vieille de plus de 90 jours
//                               ne s'enregistre jamais en silence.
import {
  formatEuros,
  MOTIF_MONTANT,
  MOTIF_ARTICLES,
  DATE_FUTURE,
} from '../lib/coherenceTicket';

const F = "'Nunito',sans-serif";

// Les deux chiffres côte à côte. C'est la confrontation qui convainc : « lignes
// lues : 115,45 € » contre « ticket : 45,33 € » se comprend sans explication.
function DeuxChiffres({ etiquetteGauche, valeurGauche, etiquetteDroite, valeurDroite }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: 0, padding: 12, background: '#FFF3F3', borderRadius: 10 }}>
        <div style={{ fontFamily: F, fontSize: 10, fontWeight: 800, color: '#666', letterSpacing: 0.3 }}>{etiquetteGauche}</div>
        <div style={{ fontFamily: F, fontSize: 18, fontWeight: 900, color: '#CC0000', marginTop: 4 }}>{valeurGauche}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: 12, background: '#F5F6F8', borderRadius: 10 }}>
        <div style={{ fontFamily: F, fontSize: 10, fontWeight: 800, color: '#666', letterSpacing: 0.3 }}>{etiquetteDroite}</div>
        <div style={{ fontFamily: F, fontSize: 18, fontWeight: 900, color: '#1a1a1a', marginTop: 4 }}>{valeurDroite}</div>
      </div>
    </div>
  );
}

// Écart supérieur à 10 % : ON N'IMPORTE PAS. Choix assumé — importer trente
// lignes fausses ne rend service à personne, et reprendre une photo coûte peu.
// Deux sorties, aucune n'étant « continuer quand même » : la lecture est
// mauvaise, il n'y a rien à sauver dedans.
export function EcranLectureRefusee({ controle, onReprendrePhoto, onSaisieManuelle }) {
  const { motifs = [], sommeLignes, totalTicket, articlesLus, articlesTicket, nbLignes } = controle || {};

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 620, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <div style={{ fontFamily: F, fontWeight: 900, fontSize: 18, color: '#CC0000' }}>
          La lecture de ce ticket n'est pas fiable
        </div>
        <div style={{ fontFamily: F, fontSize: 13, color: '#666', marginTop: 6, lineHeight: 1.5 }}>
          Ce qui a été lu ne correspond pas à ce qui est imprimé sur le ticket. Rien n'a été importé.
        </div>

        {motifs.includes(MOTIF_MONTANT) && totalTicket != null && (
          <DeuxChiffres
            etiquetteGauche="LIGNES LUES"
            valeurGauche={formatEuros(sommeLignes)}
            etiquetteDroite="TICKET"
            valeurDroite={formatEuros(totalTicket)}
          />
        )}

        {motifs.includes(MOTIF_ARTICLES) && articlesTicket != null && (
          <DeuxChiffres
            etiquetteGauche="ARTICLES LUS"
            valeurGauche={`${articlesLus}${nbLignes != null && nbLignes !== articlesLus ? ` (${nbLignes} lignes)` : ''}`}
            etiquetteDroite="TICKET"
            valeurDroite={`${articlesTicket}`}
          />
        )}

        <div style={{ marginTop: 12, padding: 12, background: '#FFF3F3', border: '1px solid #F3C5C5', borderRadius: 10, fontFamily: F, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
          Un écart de cette taille vient presque toujours d'une photo floue, coupée ou prise de biais : le lecteur invente alors des lignes. Importer ces lignes remplirait la base de produits et de prix qui n'existent pas.
        </div>

        <button
          onClick={onReprendrePhoto}
          style={{ width: '100%', marginTop: 16, padding: 14, border: 'none', borderRadius: 12, background: '#00B341', color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}
        >
          📷 Reprendre la photo
        </button>
        <button
          onClick={onSaisieManuelle}
          style={{ width: '100%', marginTop: 8, padding: 12, border: '1px solid #ddd', borderRadius: 12, background: 'transparent', color: '#333', fontFamily: F, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
        >
          ✏️ Saisie manuelle
        </button>
        <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 8, textAlign: 'center', lineHeight: 1.4 }}>
          Aucune ligne n'a été enregistrée, rien n'est parti en validation.
        </div>
      </div>
    </div>
  );
}

// Entre 2 % et 10 % : on prévient, l'import reste possible. Le ton est ambre et
// non rouge, et aucun bouton ne change : à cette échelle, l'écart vient aussi
// bien d'une remise non lue que d'une ligne manquée.
export function BandeauLectureIncomplete({ controle }) {
  if (!controle) return null;
  const { sommeLignes, totalTicket } = controle;
  return (
    <div style={{ background: '#FFF8E1', border: '1px solid #F0DFA0', borderRadius: 12, padding: '12px 14px', marginBottom: 16, fontFamily: F, fontSize: 12, color: '#7A6000', lineHeight: 1.5 }}>
      ⚠️ La lecture semble incomplète, vérifie les lignes avant d'importer.
      {totalTicket != null && (
        <div style={{ marginTop: 4, fontWeight: 800 }}>
          Lignes lues : {formatEuros(sommeLignes)} · Ticket : {formatEuros(totalTicket)}
        </div>
      )}
    </div>
  );
}

const formatDateFr = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};

// Une date de 2009 ne doit jamais s'enregistrer en silence. Sur le ticket
// Netto elle venait vraisemblablement du numéro de téléphone du magasin
// (04.96.20.32.10 -> 20 avril 2009). La date du jour est proposée par défaut,
// mais on ne l'impose pas : un ticket d'il y a trois mois est légitime.
export function ConfirmationDateTicket({ controleDate, onGarder, onRemplacer }) {
  if (!controleDate?.suspecte) return null;
  const { raison, dateLue, dateProposee } = controleDate;

  return (
    <div style={{ background: '#FFF8E1', border: '1px solid #F0DFA0', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
      <div style={{ fontFamily: F, fontSize: 12, fontWeight: 800, color: '#7A6000', lineHeight: 1.5 }}>
        {raison === DATE_FUTURE
          ? `⚠️ La date lue est dans le futur : ${formatDateFr(dateLue)}.`
          : `⚠️ La date lue est ancienne : ${formatDateFr(dateLue)}.`}
      </div>
      <div style={{ fontFamily: F, fontSize: 12, color: '#7A6000', marginTop: 4, lineHeight: 1.5 }}>
        Elle a peut-être été lue sur un autre nombre du ticket. Quelle date garder ?
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => onRemplacer?.(dateProposee)}
          style={{ flex: 1, minWidth: 140, padding: '10px 12px', border: 'none', borderRadius: 10, background: '#00B341', color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 13, cursor: 'pointer' }}
        >
          Aujourd'hui ({formatDateFr(dateProposee)})
        </button>
        <button
          onClick={() => onGarder?.(dateLue)}
          style={{ padding: '10px 14px', border: '1.5px solid rgba(122,96,0,0.35)', borderRadius: 10, background: 'transparent', color: '#7A6000', fontFamily: F, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
        >
          Garder {formatDateFr(dateLue)}
        </button>
      </div>
    </div>
  );
}
