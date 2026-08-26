// Chantier 114 — le bloc « D'après le ticket », en haut de la liste de
// l'écran de correction.
//
// Ce qu'il est : une AIDE À LA RECHERCHE. Il montre ce que la base trouve à
// partir du vrai texte de caisse (« 4x1KG PENNE RIGATE B »), pendant que la
// recherche habituelle continue de fonctionner en dessous, inchangée.
//
// Ce qu'il n'est PAS : une suggestion de l'app. Rien n'est coché, rien n'est
// pré-rempli, rien n'est validé d'avance. C'est la leçon du chantier 110 : un
// choix pré-rempli finit par être confirmé sans être lu. Taper une ligne d'ici
// mène exactement où mène une ligne de la liste du bas — la résolution de
// variante puis le récapitulatif du 110, garde-fou compris.
//
// Et quand la base ne trouve rien, ce composant ne rend RIEN : ni encart vide,
// ni « aucune suggestion ». Sur une ligne comme « sac cabas om », l'absence de
// bloc est la bonne réponse, pas une panne à signaler.

import { formaterFormats, formatPrixIndicatif } from '../lib/rechercheCatalogue';
import { doitAfficherBlocTicket } from '../lib/candidatsTicket';

const F = "'Nunito',sans-serif";

// Chantier 114c — lisibilité sur iPhone.
//
// Une fiche générique ramène facilement huit marques et cinq formats. Affichée
// en entier, la ligne grise prenait TROIS lignes à elle seule et noyait le nom
// de la fiche, qui est pourtant la seule chose à lire. On n'en montre donc que
// les trois premiers, suivis du compte de ce qui reste : « +5 ».
//
// Le « +5 » n'est pas de la décoration. Sans lui, une liste tronquée se lirait
// comme une liste complète, et une marque absente de l'écran passerait pour une
// marque absente de la fiche.
const MAX_ELEMENTS_LISTE = 3;

// On coupe sur « virgule SUIVIE D'UNE ESPACE », qui est exactement le
// séparateur posé par la base et par formaterFormats. Une virgule décimale
// française — « 1,5 L » — n'est jamais suivie d'une espace : elle survit donc
// intacte, là où un découpage sur la simple virgule aurait affiché « 1 » et
// « 5 L » comme deux formats.
function resumerListe(texte, max = MAX_ELEMENTS_LISTE) {
  const brut = typeof texte === 'string' ? texte.trim() : '';
  if (!brut) return null;

  const morceaux = brut.split(/,\s+/).map(m => m.trim()).filter(Boolean);
  if (morceaux.length === 0) return null;
  if (morceaux.length <= max) return morceaux.join(', ');
  return `${morceaux.slice(0, max).join(', ')} +${morceaux.length - max}`;
}

// Même contenu que sousTitreResultat (marques · formats, null si les deux
// manquent), mais chaque moitié abrégée séparément. On ne touche PAS à
// sousTitreResultat : il sert aussi à l'écran de recherche du catalogue, qui
// n'a pas ce problème de place.
function sousTitreCondense(candidat) {
  const marques = resumerListe(candidat?.marques);
  const formats = resumerListe(formaterFormats(candidat?.formats));

  if (marques && formats) return `${marques} · ${formats}`;
  return marques || formats || null;
}

export default function BlocCandidatsTicket({ candidats = [], libelleTicket = null, desactive = false, onChoisir }) {
  if (!doitAfficherBlocTicket(candidats)) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontFamily: F, fontWeight: 900, fontSize: 13, color: '#1a1a1a' }}>
          D&apos;après le ticket
        </span>
        {/* Le texte de caisse est affiché tel quel, en chasse fixe : c'est la
            seule version que l'OCR n'a pas réinterprétée, donc la seule contre
            laquelle on peut juger ce qui est proposé. */}
        {libelleTicket && (
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: '#777', wordBreak: 'break-word' }}>
            {libelleTicket}
          </span>
        )}
      </div>

      {/* L'ordre est celui que la base a renvoyé — elle trie déjà par nombre de
          mots retrouvés. On ne retrie JAMAIS ici : un tri par-dessus ferait
          redescendre « Penne rigate » sous « Conchiglie rigate ». */}
      <div style={{ border: '1px solid #CFE0F0', background: '#F7FBFF', borderRadius: 12, overflow: 'hidden' }}>
        {candidats.map((c, i) => {
          const sousTitre = sousTitreCondense(c);
          const prix = formatPrixIndicatif(c.dernier_prix);
          return (
            <div
              key={c.produit_id}
              onClick={() => { if (!desactive) onChoisir?.(c); }}
              style={{
                padding: '11px 12px',
                borderTop: i === 0 ? 'none' : '1px solid #E4EEF8',
                cursor: desactive ? 'default' : 'pointer',
                opacity: desactive ? 0.6 : 1,
                minWidth: 0,
              }}
            >
              <span style={{ display: 'block', fontFamily: F, fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
                {c.nom_reference}
              </span>
              {/* Le prix est passé À GAUCHE, sous le nom, avec les badges.
                  Collé au bord droit, il tombait pile sous les boutons ronds
                  flottants de l'app et devenait illisible sur un écran
                  d'iPhone. Ici rien ne passe par-dessus. */}
              {(prix || sousTitre || c.mots_correspondants || c.deja_vu_dans_enseigne) && (
                <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3, minWidth: 0 }}>
                  {prix && (
                    <span style={{ fontFamily: F, fontSize: 11, fontWeight: 800, color: '#555', background: '#EFF1F4', borderRadius: 99, padding: '2px 7px', whiteSpace: 'nowrap', lineHeight: 1.4, flexShrink: 0 }}>
                      {prix}
                    </span>
                  )}
                  {sousTitre && (
                    <span
                      style={{
                        fontFamily: F, fontSize: 12, fontWeight: 600, color: '#999', lineHeight: 1.35,
                        // Filet de sécurité : même abrégée, la ligne
                        // marques/formats ne dépasse jamais deux lignes. Au-delà,
                        // c'est le CSS qui coupe, avec des points de suspension.
                        display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
                        overflow: 'hidden', minWidth: 0, maxWidth: '100%', wordBreak: 'break-word',
                      }}
                    >
                      {sousTitre}
                    </span>
                  )}
                  {/* Les mots du ticket réellement retrouvés : c'est ce qui
                      permet de comprendre POURQUOI la fiche est là, et donc
                      de repérer un rapprochement bancal d'un coup d'œil. */}
                  {c.mots_correspondants && (
                    <span style={{ fontFamily: F, fontSize: 10, fontWeight: 800, color: '#0B5FA5', background: '#E6F0FA', borderRadius: 99, padding: '2px 7px', lineHeight: 1.4 }}>
                      {c.mots_correspondants}
                    </span>
                  )}
                  {c.deja_vu_dans_enseigne && (
                    <span style={{ fontFamily: F, fontSize: 10, fontWeight: 800, color: '#00833A', background: '#E6F7EE', borderRadius: 99, padding: '2px 7px', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
                      déjà vu ici
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Dit explicitement que rien n'est décidé. Sans cette phrase, une liste
          en tête d'écran se lit comme un choix de l'app. */}
      <div style={{ fontFamily: F, fontSize: 11, color: '#8A8F98', marginTop: 6, lineHeight: 1.4 }}>
        Rien n&apos;est sélectionné — touche une fiche pour la vérifier, ou cherche ci-dessous.
      </div>
    </div>
  );
}
