// Chantier 106 — cartes PARTAGÉES du parcours « code-barres inconnu ».
//
// Ces trois composants viennent TELS QUELS de AValiderSheet (chantiers 103 et
// 105) : ils ont été SORTIS de ce fichier, pas réécrits. Le module de
// contribution (106) rejoue exactement le même parcours depuis l'accueil —
// « Ce produit ? » puis, en cas de désaccord, la confrontation côte à côte —
// et deux copies divergentes de cet écran seraient le meilleur moyen de
// perdre le garde-fou d'un côté sans s'en apercevoir.
//
// Tous les textes qui parlaient de « la ligne du ticket » sont devenus des
// props AVEC LA VALEUR D'ORIGINE PAR DÉFAUT : AValiderSheet n'en passe aucune
// et affiche donc, mot pour mot, ce qu'il affichait avant.
import { useState } from 'react';
import { cloudinaryFetch } from '../lib/photosProduits';
import { SIGNAL_AUCUN_MOT_COMMUN, SIGNAL_QUANTITE_DIVERGENTE, texteQuantiteFiche, divergenceAvecLigneTicket } from '../lib/coherenceCodeBarres';

const F = "'Nunito',sans-serif";

// Chantier 103 — la carte « Ce produit ? ». La PHOTO est le point de
// vérification : elle est affichée AVANT toute écriture, et rien n'est écrit
// tant que l'utilisateur n'a pas reconnu l'article qu'il tient en main.
// Cloudinary indisponible -> repli sur l'URL OFF brute -> repli sur un carré
// vide : à aucun moment un échec d'image ne bloque l'écran.
//
// Chantier 106 — `off` peut désormais être null (OFF ne connaît pas le code,
// ou n'a pas répondu). On ne montre alors PAS de bloc d'identité vide : on
// affiche `noteOff`, qui dit franchement que personne ne peut vérifier à la
// place de l'utilisateur. Le parcours continue quand même.
//
// Chantier 107 — bandeau ambre quand ce que dit OFF n'a AUCUN mot en commun
// avec la ligne du ticket. Calculé ici à partir de `assistant`, qui porte déjà
// tout le nécessaire : aucun appelant n'a de prop à passer, et le module de
// contribution (aucune ligne de ticket) n'affiche donc rien, sans le savoir.
export function AssistantOffCard({
  assistant,
  enCours,
  onOuiChoisir,
  onCeNestPasCa,
  onFermer,
  sousTitre = null,
  noteOff = null,
  libelleOui = '✓ Oui — choisir la fiche du catalogue',
  libelleNon = "Ce n'est pas ça / je ne trouve pas",
  noteBas = "« Ce n'est pas ça » reprend le comportement habituel : la ligne part en file de validation. Fermer (✕) ne change rien.",
}) {
  const { off, libelle, libelleTicket, code } = assistant;
  const sourceOff = off ? (off.imageLarge || off.imageSmall || null) : null;
  const [srcImage, setSrcImage] = useState(() => cloudinaryFetch(sourceOff, 'large'));
  const identite = off ? [off.marque, off.nom, off.quantite].filter(Boolean).join(' · ') : '';
  // Chantier 107 — `assistant` porte off, statutOff, libelle et libelleTicket :
  // la règle lit exactement ce dont elle a besoin et rend false dès qu'il
  // manque un des deux côtés à comparer (OFF muet, pas de ligne de ticket).
  const divergenceLigne = divergenceAvecLigneTicket(assistant);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 560, display: 'flex', alignItems: 'flex-end' }} onClick={onFermer}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontFamily: F, fontWeight: 900, fontSize: 18, color: '#1a1a1a' }}>Ce produit ?</div>
            <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 2 }}>
              {sousTitre || `Code inconnu de notre base · ${code} · fiche Open Food Facts`}
            </div>
          </div>
          <button onClick={onFermer} style={{ flexShrink: 0, background: '#F5F6F8', border: 'none', borderRadius: 99, width: 28, height: 28, color: '#999', fontSize: 14, cursor: 'pointer' }}>✕</button>
        </div>

        {off ? (
          <div style={{ marginTop: 14, padding: 12, background: '#F5F6F8', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 96, height: 96, borderRadius: 10, background: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {srcImage ? (
                <img
                  src={srcImage}
                  alt=""
                  loading="lazy"
                  onError={() => setSrcImage(prev => (prev !== sourceOff ? sourceOff : null))}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <span style={{ fontSize: 26 }}>📦</span>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#666' }}>OPEN FOOD FACTS DIT</div>
              <div style={{ fontFamily: F, fontSize: 15, fontWeight: 900, color: '#1a1a1a', marginTop: 3, lineHeight: 1.3 }}>
                {identite || '(fiche sans nom)'}
              </div>
            </div>
          </div>
        ) : noteOff ? (
          <div style={{ marginTop: 14, padding: 12, background: '#F5F6F8', borderRadius: 12, fontFamily: F, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
            {noteOff}
          </div>
        ) : null}

        {libelle != null && (
          <div style={{ marginTop: 10, padding: 12, background: '#F5F6F8', borderRadius: 12 }}>
            <div style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#666' }}>LIGNE DU TICKET</div>
            <div style={{ fontFamily: F, fontSize: 14, fontWeight: 800, color: '#1a1a1a', marginTop: 3 }}>
              « {libelle || '(libellé vide)'} »
            </div>
            {libelleTicket && libelleTicket !== libelle && (
              <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: '#666', marginTop: 5 }}>
                Texte imprimé : {libelleTicket}
              </div>
            )}
          </div>
        )}

        {/* Chantier 107 — placé sous la confrontation, avant la question :
            l'œil lit « OFF dit X », « le ticket dit Y », puis l'alerte. Ton
            ambre et non rouge, volontairement : on compare ici à un libellé de
            caisse, souvent abrégé ou trompeur, donc les fausses alertes sont
            attendues. Aucun bouton n'est modifié, aucun parcours n'est bloqué. */}
        {divergenceLigne && (
          <div style={{ marginTop: 10, padding: 12, background: '#FFF8E1', border: '1px solid #F0DFA0', borderRadius: 12, fontFamily: F, fontSize: 12, color: '#7A6000', lineHeight: 1.5 }}>
            ⚠️ Ce produit ne ressemble pas à la ligne du ticket — vérifie que c'est bien celui que tu tiens.
          </div>
        )}

        <div style={{ fontFamily: F, fontSize: 14, fontWeight: 900, color: '#1a1a1a', marginTop: 14, lineHeight: 1.4 }}>
          C'est bien le produit que tu tiens en main ?
        </div>
        <div style={{ fontFamily: F, fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.4 }}>
          Aucune fiche n'est créée automatiquement : tu choisis toi-même la fiche du catalogue.
        </div>

        <button
          onClick={onOuiChoisir}
          disabled={enCours}
          style={{ width: '100%', marginTop: 14, padding: 14, border: 'none', borderRadius: 12, background: enCours ? '#ccc' : '#00B341', color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 15, cursor: enCours ? 'default' : 'pointer' }}
        >
          {libelleOui}
        </button>
        <button
          onClick={onCeNestPasCa}
          disabled={enCours}
          style={{ width: '100%', marginTop: 8, padding: 12, border: '1px solid #ddd', borderRadius: 12, background: 'transparent', color: '#333', fontFamily: F, fontWeight: 800, fontSize: 14, cursor: enCours ? 'default' : 'pointer' }}
        >
          {libelleNon}
        </button>
        <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 8, textAlign: 'center', lineHeight: 1.4 }}>
          {noteBas}
        </div>
      </div>
    </div>
  );
}

// Chantier 105 — LE garde-fou. Montre les deux identités CÔTE À CÔTE : ce que
// dit OpenFoodFacts du code scanné, et la fiche qu'on s'apprête à lui associer.
// C'est la confrontation visuelle qui manquait le 17/08, quand un code de
// boulgour est parti sur une fiche de cônes glacés sans un mot.
//
// Hiérarchie assumée des deux boutons : « Je vérifie l'emballage » est LE geste
// mis en avant (c'est la seule vérification qui tranche vraiment) ; « apprendre
// quand même » est volontairement discret, parce qu'on avertit sans interdire —
// OFF se trompe parfois, et certains produits n'y sont pas du tout.
// Une des deux colonnes de la confrontation. Hors du composant parent : défini
// à l'intérieur, il serait recréé à chaque rendu (react-hooks/static-components).
// Chantier 106 — `photoUrl` est un ajout facultatif pour l'écran admin des
// propositions (la photo OFF est la preuve visuelle la plus rapide à lire).
// Absent par défaut : l'avertissement du 105 est rendu à l'identique.
export function ColonneIdentite({ etiquette, nom, marque, quantiteTexte, fond, photoUrl = null }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: 12, background: fond, borderRadius: 10 }}>
      <div style={{ fontFamily: F, fontSize: 10, fontWeight: 800, color: '#666', letterSpacing: 0.3 }}>{etiquette}</div>
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: 90, objectFit: 'contain', background: '#fff', borderRadius: 8, marginTop: 6, display: 'block' }}
        />
      )}
      <div style={{ fontFamily: F, fontSize: 14, fontWeight: 900, color: '#1a1a1a', marginTop: 4, lineHeight: 1.3, wordBreak: 'break-word' }}>
        {nom || '(sans nom)'}
      </div>
      {marque && (
        <div style={{ fontFamily: F, fontSize: 12, color: '#666', marginTop: 3 }}>{marque}</div>
      )}
      <div style={{ fontFamily: F, fontSize: 12, fontWeight: 800, color: quantiteTexte ? '#1a1a1a' : '#999', marginTop: 5 }}>
        {quantiteTexte || 'quantité inconnue'}
      </div>
    </div>
  );
}

export function AvertissementCoherenceCard({
  avertissement,
  enCours,
  onVerifier,
  onApprendreQuandMeme,
  peutPasserOutre,
  consequence = "Si tu apprends ce code ici, il rattachera automatiquement cet article à cette fiche à chaque scan suivant. Une erreur se propage.",
  libelleVerifier = "Je vérifie l'emballage",
  noteVerifier = "Rien n'est écrit : la ligne reste dans la liste, tu pourras rescanner.",
  libellePasserOutre = "C'est bien ça, apprendre quand même",
  notePasserOutreInterdit = "En cas de désaccord, ta proposition part en file de validation : rien n'est écrit directement.",
}) {
  const { verdict, nomProduit, code } = avertissement;
  const { off, fiche, signaux, quantite } = verdict;

  const quantiteFiche = texteQuantiteFiche(fiche);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 570, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }}>
        <div style={{ fontFamily: F, fontWeight: 900, fontSize: 18, color: '#CC0000' }}>
          ⚠️ Ce code-barres ne semble pas être celui de ce produit
        </div>
        <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 3 }}>Code lu : {code}</div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'stretch' }}>
          <ColonneIdentite
            etiquette="LE CODE DÉSIGNE (OFF)"
            nom={off?.nom}
            marque={off?.marque}
            quantiteTexte={off?.quantite}
            fond="#FFF3F3"
          />
          <ColonneIdentite
            etiquette="LA FICHE CHOISIE"
            nom={nomProduit || fiche?.nomProduit}
            marque={fiche?.marque}
            quantiteTexte={quantiteFiche}
            fond="#F5F6F8"
          />
        </div>

        <div style={{ marginTop: 12, padding: 12, background: '#FFF3F3', border: '1px solid #F3C5C5', borderRadius: 10 }}>
          <div style={{ fontFamily: F, fontSize: 12, fontWeight: 800, color: '#CC0000', lineHeight: 1.5 }}>
            {signaux.includes(SIGNAL_AUCUN_MOT_COMMUN) && (
              <div>• Les deux noms n'ont aucun mot en commun.</div>
            )}
            {signaux.includes(SIGNAL_QUANTITE_DIVERGENTE) && quantite?.comparable && (
              <div>• Les quantités diffèrent de {Math.round(quantite.ecart * 100)} %.</div>
            )}
          </div>
          <div style={{ fontFamily: F, fontSize: 12, color: '#666', marginTop: 8, lineHeight: 1.5 }}>
            {consequence}
          </div>
        </div>

        <button
          onClick={onVerifier}
          disabled={enCours}
          style={{ width: '100%', marginTop: 14, padding: 14, border: 'none', borderRadius: 12, background: enCours ? '#ccc' : '#00B341', color: '#fff', fontFamily: F, fontWeight: 900, fontSize: 15, cursor: enCours ? 'default' : 'pointer' }}
        >
          {libelleVerifier}
        </button>
        <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 8, textAlign: 'center', lineHeight: 1.4 }}>
          {noteVerifier}
        </div>

        {/* La décision « apprendre quand même » est isolée derrière
            passerOutreAutorise : le jour où le scan s'ouvre à tous, ce bloc
            disparaît pour les non-administrateurs sans réécriture, et le
            désaccord partira en file de propositions au lieu d'écrire. */}
        {peutPasserOutre ? (
          <button
            onClick={onApprendreQuandMeme}
            disabled={enCours}
            style={{ width: '100%', marginTop: 12, padding: 10, border: 'none', borderRadius: 10, background: 'transparent', color: '#999', fontFamily: F, fontWeight: 700, fontSize: 12, textDecoration: 'underline', cursor: enCours ? 'default' : 'pointer' }}
          >
            {enCours ? '...' : libellePasserOutre}
          </button>
        ) : (
          <div style={{ fontFamily: F, fontSize: 11, color: '#999', marginTop: 12, textAlign: 'center', lineHeight: 1.4 }}>
            {notePasserOutreInterdit}
          </div>
        )}
      </div>
    </div>
  );
}
