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

import { sousTitreResultat, formatPrixIndicatif } from '../lib/rechercheCatalogue';
import { doitAfficherBlocTicket } from '../lib/candidatsTicket';

const F = "'Nunito',sans-serif";

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
          const sousTitre = sousTitreResultat(c);
          const prix = formatPrixIndicatif(c.dernier_prix);
          return (
            <div
              key={c.produit_id}
              onClick={() => { if (!desactive) onChoisir?.(c); }}
              style={{
                padding: '11px 12px',
                borderTop: i === 0 ? 'none' : '1px solid #E4EEF8',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                cursor: desactive ? 'default' : 'pointer',
                opacity: desactive ? 0.6 : 1,
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: F, fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
                  {c.nom_reference}
                </span>
                {(sousTitre || c.mots_correspondants || c.deja_vu_dans_enseigne) && (
                  <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
                    {sousTitre && (
                      <span style={{ fontFamily: F, fontSize: 12, fontWeight: 600, color: '#999', lineHeight: 1.35 }}>
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
              </span>
              {prix && (
                <span style={{ fontFamily: F, fontSize: 12, fontWeight: 700, color: '#999', flexShrink: 0 }}>
                  {prix}
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
