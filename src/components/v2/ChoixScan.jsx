// Chantier 129 — « Comment veux-tu ajouter ton ticket ? » : une seule feuille,
// une ligne par façon de faire. Avant, deux gros pavés colorés (« Ticket
// court » / « Grand ticket ») puis une deuxième feuille « Autres options ».
// Les actions sont exactement celles d'avant, passées en props.
import { T } from './theme';
import { IconeChevron, IconeCroix } from './Icones';

function Option({ pastille, titre, detail, onClick, principal = false, dernier = false }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', border: 'none', background: principal ? T.rougePale : 'none', cursor: 'pointer', textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderBottom: dernier ? 'none' : `1px solid ${T.trait}`,
    }}>
      <span style={{ width: 44, height: 44, borderRadius: 13, background: principal ? T.rouge : T.fond, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, flexShrink: 0 }}>{pastille}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: T.police, fontWeight: 900, fontSize: 15.5, color: T.texte }}>{titre}</span>
        <span style={{ display: 'block', fontFamily: T.police, fontSize: 12.5, color: T.texteDoux, marginTop: 1 }}>{detail}</span>
      </span>
      <IconeChevron width={18} height={18} style={{ color: T.texteLeger, flexShrink: 0 }} />
    </button>
  );
}

export default function ChoixScan({ onClose, onUnePhoto, onPlusieursPhotos, onImporterFichier = null, onPhotoPellicule, onSaisieManuelle }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 200, animation: 'fadeIn 0.2s ease' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Ajouter un ticket" style={{ background: T.fond, borderRadius: '22px 22px 0 0', width: '100%', maxWidth: 430, margin: '0 auto', animation: 'slideUp 0.3s ease', padding: '16px 16px calc(24px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 19, color: T.texte }}>Ajouter un ticket</div>
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: T.trait, color: T.texteDoux, width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconeCroix width={16} height={16} />
          </button>
        </div>
        <div style={{ fontFamily: T.police, fontSize: 13, color: T.texteDoux, marginBottom: 14 }}>
          Prends le ticket bien à plat, en commençant par le haut : le nom et l'adresse du magasin doivent se voir.
        </div>

        <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden', marginBottom: 12 }}>
          <Option principal pastille="📷" titre="Prendre le ticket en photo" detail="Il tient en une seule photo" onClick={onUnePhoto} />
          <Option pastille="🧾" titre="Ticket long" detail="On le prend en plusieurs photos" onClick={onPlusieursPhotos} dernier={!onImporterFichier} />
          {onImporterFichier && (
            <Option pastille="📄" titre="Importer un ticket" detail="PDF ou captures d'écran (Lidl Plus, drive…)" onClick={onImporterFichier} dernier />
          )}
        </div>

        <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>
          <Option pastille="🖼️" titre="Choisir une photo" detail="Un ticket déjà dans ta pellicule" onClick={onPhotoPellicule} />
          <Option pastille="✏️" titre="Saisir un prix à la main" detail="Sans ticket, tu tapes le prix" onClick={onSaisieManuelle} dernier />
        </div>
      </div>
    </div>
  );
}
