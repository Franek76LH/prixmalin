// Chantier 123 — espace « Moi » : tout ce qui n'est pas « faire ses courses »
// est rangé ici (économies, tickets, prix, favoris, cercle, statistiques,
// profil, aide). Avant, ces entrées étaient éparpillées entre un menu caché
// derrière le pseudo et des pastilles flottantes.
import { T } from './theme';
import { IconeChevron } from './Icones';
import { economiesConfirmees, economiesEstimees } from '../../lib/accueilCore';

const euros = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

function Ligne({ pastille, libelle, detail, onClick, pastilleRouge = 0, danger = false, dernier = false }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', border: 'none', background: 'none', padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: 12, borderBottom: dernier ? 'none' : `1px solid ${T.trait}`,
    }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, background: danger ? T.rougePale : T.fond, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{pastille}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: T.police, fontWeight: 800, fontSize: 15, color: danger ? T.rouge : T.texte }}>{libelle}</span>
        {detail && <span style={{ display: 'block', fontFamily: T.police, fontSize: 12.5, color: T.texteLeger, marginTop: 1 }}>{detail}</span>}
      </span>
      {pastilleRouge > 0 && (
        <span style={{ background: T.rouge, color: '#fff', borderRadius: 99, minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', fontFamily: T.police, fontWeight: 900, fontSize: 11, lineHeight: '20px', textAlign: 'center' }}>{pastilleRouge}</span>
      )}
      {!danger && <IconeChevron width={18} height={18} style={{ color: T.texteLeger, flexShrink: 0 }} />}
    </button>
  );
}

function Groupe({ titre, children }) {
  return (
    <div>
      {titre && <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 12, color: T.texteLeger, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 4px 8px' }}>{titre}</div>}
      <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

export default function EcranMoi({
  pseudo, email, archives = [], setTab, version,
  onProfil = null, onCercle, invitationsEnAttente = 0, onStats, onMesPrix, onFavoris, onAide, onDeconnexion,
  estAdmin = false,
}) {
  const confirmees = economiesConfirmees(archives);
  const estimees = economiesEstimees(archives);
  const nom = (pseudo || '').trim() || (email || '').split('@')[0] || 'Moi';

  return (
    <div style={{ background: T.fond, minHeight: '100vh', padding: '16px 16px 110px', display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Qui je suis + mes économies, en un coup d'œil */}
      <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <span style={{ width: 48, height: 48, borderRadius: '50%', background: T.rouge, color: '#fff', fontFamily: T.police, fontWeight: 900, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {nom.charAt(0).toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 18, color: T.texte, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nom}</div>
            {email && <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteLeger, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>}
          </div>
        </div>
        <button onClick={() => setTab('economies')} style={{ width: '100%', border: 'none', cursor: 'pointer', background: T.vertPale, borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontFamily: T.police, fontWeight: 800, fontSize: 12.5, color: T.vert }}>Économies confirmées par tes tickets</span>
            <span style={{ display: 'block', fontFamily: T.police, fontWeight: 900, fontSize: 24, color: T.vert }}>{euros(confirmees)}</span>
            {estimees > 0 && <span style={{ display: 'block', fontFamily: T.police, fontSize: 12, color: T.texteDoux, marginTop: 1 }}>{euros(estimees)} estimées en choisissant le bon magasin</span>}
          </span>
          <IconeChevron width={20} height={20} style={{ color: T.vert }} />
        </button>
      </div>

      <Groupe titre="Mes courses">
        <Ligne pastille="🧾" libelle="Mes tickets" detail="Tous tes tickets scannés" onClick={() => setTab('archive')} />
        <Ligne pastille="🏷️" libelle="Mes prix" detail="Les prix que tu as relevés" onClick={onMesPrix} />
        <Ligne pastille="❤️" libelle="Mes favoris" onClick={onFavoris} dernier />
      </Groupe>

      <Groupe titre="Mon compte">
        {onProfil && <Ligne pastille="🏅" libelle="Mon profil et mes badges" onClick={onProfil} />}
        <Ligne pastille="👥" libelle="Mon cercle" detail="Partage tes prix avec tes proches" onClick={onCercle} pastilleRouge={invitationsEnAttente} />
        <Ligne pastille="📊" libelle="Mes statistiques" onClick={onStats} />
        <Ligne pastille="💬" libelle="Nous contacter" onClick={onAide} dernier />
      </Groupe>

      {estAdmin && (
        <Groupe titre="Administration">
          <Ligne pastille="🛠️" libelle="Rejets" detail="Lignes de tickets à traiter" onClick={() => setTab('rejets')} dernier />
        </Groupe>
      )}

      <Groupe>
        <Ligne pastille="↩️" libelle="Se déconnecter" onClick={onDeconnexion} danger dernier />
      </Groupe>

      {version && <div style={{ textAlign: 'center', fontFamily: T.police, fontSize: 11, color: T.texteLeger }}>PrixMalin v{version}</div>}
    </div>
  );
}
