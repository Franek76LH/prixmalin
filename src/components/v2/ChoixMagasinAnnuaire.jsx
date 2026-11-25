// Chantier 187 — « Je fais mes courses dans un autre magasin » : les
// supermarchés les plus proches, tirés de l'annuaire (chantier 171). Un appui
// démarre les courses dans ce magasin, même s'il n'a encore aucun prix : le
// ticket les apportera. Lecture seule ; rien n'est écrit ici.
import { useEffect, useState } from 'react';
import { T } from './theme';
import { chercherAutour, chercherParNom, motsRecherche, plusProches, texteDistance, libelleAnnuaire, chargerMagasinsConnus, magasinConnuPour } from '../../lib/annuaireMagasins';
import { useFermerParRetour } from '../../lib/retourFeuilles';

const RAYONS = [3000, 8000, 20000];

// Chantier 188 — `prixParMagasin` : Map id du magasin PrixMalin -> nombre de
// prix de la liste connus chez lui (comparaison en cours). Un magasin de
// l'annuaire déjà dans PrixMalin est signalé, et transmis à onChoisir.
export default function ChoixMagasinAnnuaire({ position, onChoisir, onFermer, prixParMagasin = new Map(), nbArticles = 0 }) {
  useFermerParRetour(onFermer); // Chantier 190 — le retour du téléphone ferme la fenêtre
  const [rang, setRang] = useState(0);
  const [connus, setConnus] = useState([]);
  useEffect(() => {
    let annule = false;
    chargerMagasinsConnus().then(r => { if (!annule) setConnus(r); });
    return () => { annule = true; };
  }, []);
  // Résultat rangé avec la recherche qui l'a produit : une autre recherche en
  // cours = « chargement » (null), sans remise à zéro dans l'effet.
  const cle = `${position?.lat}|${position?.lon}|${rang}`;
  const [resultat, setResultat] = useState({ cle: null, lignes: [] });
  const lignes = resultat.cle === cle ? resultat.lignes : null; // null = chargement
  useEffect(() => {
    let annule = false;
    chercherAutour({ slug: null, position, rayonMetres: RAYONS[rang] })
      .then(r => { if (!annule) setResultat({ cle, lignes: plusProches(r, position, 12) }); })
      .catch(() => { if (!annule) setResultat({ cle, lignes: [] }); });
    return () => { annule = true; };
  }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chantier 191 — recherche par nom, enseigne, ville, code postal ou rue.
  // Résultat rangé avec le texte qui l'a produit (même principe qu'au-dessus).
  const [texte, setTexte] = useState('');
  const texteCherche = motsRecherche(texte).join(' ');
  const [trouves, setTrouves] = useState({ cle: null, lignes: [] });
  useEffect(() => {
    if (!texteCherche) return undefined;
    let annule = false;
    const minuterie = setTimeout(() => {
      chercherParNom(texteCherche, position)
        .then(r => { if (!annule) setTrouves({ cle: texteCherche, lignes: r }); })
        .catch(() => { if (!annule) setTrouves({ cle: texteCherche, lignes: [] }); });
    }, 300);
    return () => { annule = true; clearTimeout(minuterie); };
  }, [texteCherche]); // eslint-disable-line react-hooks/exhaustive-deps
  const enRecherche = texteCherche.length > 0;
  // Sans position (refusée ou inconnue) : pas de liste « autour de toi », la
  // recherche par nom suffit.
  const sansPosition = !position || position.lat == null;
  const lignesAffichees = enRecherche ? (trouves.cle === texteCherche ? trouves.lignes : null) : (sansPosition ? [] : lignes);

  return (
    <div onClick={onFermer} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 300 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Choisir mon magasin" style={{
        background: T.fond, borderRadius: '22px 22px 0 0', width: '100%', maxWidth: 430, margin: '0 auto', maxHeight: '85vh', overflowY: 'auto',
        padding: '16px 16px calc(24px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 19, color: T.texte }}>Dans quel magasin vas-tu ?</div>
          <button onClick={onFermer} aria-label="Fermer" style={{ border: 'none', background: T.trait, color: T.texteDoux, width: 32, height: 32, borderRadius: '50%', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontFamily: T.police, fontSize: 13, color: T.texteDoux, marginBottom: 12 }}>
          Tes courses démarrent tout de suite. Les prix encore inconnus viendront de ton ticket : scanne-le à la caisse.
        </div>
        <input type="search" value={texte} onChange={e => setTexte(e.target.value)} placeholder="🔍 Nom ou ville (ex. Lidl Prado)" aria-label="Chercher un magasin par son nom ou sa ville"
          style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: `1.5px solid ${T.trait}`, background: T.carte, fontFamily: T.police, fontSize: 15, color: T.texte, marginBottom: 12, outline: 'none' }} />
        {lignesAffichees === null && <div style={{ fontFamily: T.police, fontSize: 13.5, color: T.texteLeger, padding: '16px 4px' }}>{enRecherche ? 'Recherche…' : 'Recherche des magasins autour de toi…'}</div>}
        {lignesAffichees?.length === 0 && (
          <div style={{ fontFamily: T.police, fontSize: 13.5, color: T.texteDoux, padding: '12px 4px' }}>{enRecherche ? 'Aucun magasin ne correspond. Essaie l\'enseigne et la ville (ex. « Lidl Marseille »).' : (sansPosition ? 'Tape le nom de ton magasin ou sa ville pour le trouver.' : `Aucun supermarché trouvé à moins de ${texteDistance(RAYONS[rang])}.`)}</div>
        )}
        {lignesAffichees?.length > 0 && (
          <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>
            {lignesAffichees.map((l, i) => { const connu = magasinConnuPour(l, connus); const nbPrix = connu ? (prixParMagasin.get(connu.id) || 0) : 0; return (
              <button key={l.osm_id} onClick={() => onChoisir?.(l, connu)} style={{
                width: '100%', border: 'none', borderBottom: i === lignesAffichees.length - 1 ? 'none' : `1px solid ${T.trait}`, background: 'none', cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', minHeight: 56,
              }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: T.police, fontWeight: 900, fontSize: 15, color: T.texte }}>{l.nom || l.enseigne_nom || 'Magasin'}</span>
                  <span style={{ display: 'block', fontFamily: T.police, fontSize: 12, color: T.texteLeger, marginTop: 1 }}>{libelleAnnuaire(l)}</span>
                  {connu && (
                    <span style={{ display: 'inline-block', marginTop: 4, background: T.vertPale, color: T.vert, borderRadius: 99, padding: '2px 8px', fontFamily: T.police, fontWeight: 900, fontSize: 10.5 }}>
                      {nbPrix > 0 ? `Déjà dans PrixMalin · ${nbPrix} prix sur ${nbArticles}` : 'Déjà dans PrixMalin'}
                    </span>
                  )}
                </span>
                <span style={{ fontFamily: T.police, fontWeight: 800, fontSize: 12.5, color: T.texteDoux, flexShrink: 0 }}>{texteDistance(l.distance)}</span>
              </button>
            ); })}
          </div>
        )}
        {!enRecherche && !sansPosition && lignes !== null && rang < RAYONS.length - 1 && (
          <button onClick={() => setRang(r => r + 1)} style={{ display: 'block', margin: '12px auto 0', border: 'none', background: 'none', color: T.bleu, fontFamily: T.police, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', padding: '8px' }}>
            Élargir à {texteDistance(RAYONS[rang + 1])}
          </button>
        )}
        <div style={{ fontFamily: T.police, fontSize: 10.5, color: T.texteLeger, marginTop: 12, textAlign: 'center' }}>Annuaire des magasins © contributeurs OpenStreetMap</div>
      </div>
    </div>
  );
}
