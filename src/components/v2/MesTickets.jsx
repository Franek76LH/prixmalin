// Chantier 130 — « Mes tickets » : la liste des tickets, mois par mois, comme
// un relevé. Avant, l'écran s'ouvrait sur ~500 libellés de caisse en vrac.
// Un appui sur un ticket l'ouvre : ses articles, leur prix, et les mêmes
// gestes qu'avant (corriger le produit, remettre dans la liste, supprimer).
// Cet écran n'écrit rien lui-même : il appelle les fonctions reçues.
import { useState } from 'react';
import { T } from './theme';
import { IconeChevron, IconeLoupe, IconeCroix, IconePlus, IconeCoche } from './Icones';
import { ticketsParMois, bilanTickets, totalTicket, totalLigne, euros } from '../../lib/ticketsCore';
import { nomDuMois } from '../../lib/economiesCore';

const jourLisible = (date) =>
  new Date(date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });

export default function MesTickets({
  archives = [],
  nomAffiche = (item) => item.product,
  aConfirmer = () => 0,
  onCorriger,
  onAjouter,
  onSupprimer,
  onScanner,
}) {
  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState(null);
  const [aSupprimer, setASupprimer] = useState(null);
  const [ajoutes, setAjoutes] = useState(() => new Set());

  if (archives.length === 0) {
    return (
      <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, padding: '32px 22px', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>🧾</div>
        <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 19, color: T.texte, marginBottom: 6 }}>Pas encore de ticket</div>
        <div style={{ fontFamily: T.police, fontSize: 14, color: T.texteDoux, marginBottom: onScanner ? 20 : 0 }}>
          Scanne ton ticket de caisse après tes courses : il apparaîtra ici.
        </div>
        {onScanner && (
          <button onClick={onScanner} style={{ width: '100%', border: 'none', background: T.rouge, color: '#fff', borderRadius: 14, padding: 14, fontFamily: T.police, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}>
            Scanner un ticket
          </button>
        )}
      </div>
    );
  }

  const bilan = bilanTickets(archives);
  const mois = ticketsParMois(archives, recherche);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        {[{ titre: 'Tickets', valeur: String(bilan.nb) }, { titre: 'Total dépensé', valeur: euros(Math.round(bilan.total)).replace(',00', '') }].map(c => (
          <div key={c.titre} style={{ flex: 1, background: T.carte, borderRadius: 16, padding: '12px 14px', boxShadow: T.ombre }}>
            <div style={{ fontFamily: T.police, fontSize: 12, fontWeight: 800, color: T.texteLeger }}>{c.titre}</div>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 24, color: T.texte }}>{c.valeur}</div>
          </div>
        ))}
      </div>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <IconeLoupe width={18} height={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: T.texteLeger }} />
        <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Chercher un produit ou un magasin…" aria-label="Chercher dans mes tickets"
          style={{ width: '100%', boxSizing: 'border-box', padding: '12px 44px 12px 40px', borderRadius: 14, border: `1.5px solid ${recherche ? T.rouge : T.trait}`, background: T.carte, fontFamily: T.police, fontSize: 15, fontWeight: 700, color: T.texte, outline: 'none' }} />
        {recherche && (
          <button onClick={() => setRecherche('')} aria-label="Effacer la recherche" style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, border: 'none', background: 'none', cursor: 'pointer', color: T.texteLeger, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconeCroix width={18} height={18} />
          </button>
        )}
      </div>

      {mois.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: T.police, fontSize: 14, color: T.texteDoux }}>
          Aucun ticket ne contient « {recherche.trim()} ».
        </div>
      )}

      {mois.map(m => (
        <div key={m.mois} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 4px 8px' }}>
            <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 16, color: T.texte }}>{nomDuMois(m.mois)}</div>
            <div style={{ fontFamily: T.police, fontWeight: 700, fontSize: 12.5, color: T.texteLeger }}>
              {m.nb} ticket{m.nb > 1 ? 's' : ''} · {euros(m.total)}
            </div>
          </div>
          <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>
            {m.tickets.map((arc, i) => {
              const estOuvert = ouvert === arc.id;
              const nbAConfirmer = aConfirmer(arc) || 0;
              const articles = arc.items || [];
              return (
                <div key={arc.id ?? i} style={{ borderBottom: i === m.tickets.length - 1 ? 'none' : `1px solid ${T.trait}` }}>
                  <button onClick={() => { setOuvert(estOuvert ? null : arc.id); setASupprimer(null); }} aria-expanded={estOuvert}
                    style={{ width: '100%', border: 'none', background: estOuvert ? '#FAFAF8' : 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px' }}>
                    <span style={{ width: 40, height: 40, borderRadius: 12, background: T.fond, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{arc.store?.logo || '🏪'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontFamily: T.police, fontWeight: 800, fontSize: 15, color: T.texte, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{arc.store?.name || 'Magasin'}</span>
                      <span style={{ display: 'block', fontFamily: T.police, fontSize: 12.5, color: T.texteLeger, marginTop: 1 }}>
                        {jourLisible(arc.date)} · {articles.length} article{articles.length > 1 ? 's' : ''}
                      </span>
                      {nbAConfirmer > 0 && (
                        <span style={{ display: 'inline-block', marginTop: 5, background: T.bleuPale, color: T.bleu, borderRadius: 99, padding: '2px 9px', fontFamily: T.police, fontWeight: 800, fontSize: 11 }}>
                          {nbAConfirmer} produit{nbAConfirmer > 1 ? 's' : ''} à confirmer
                        </span>
                      )}
                    </span>
                    <span style={{ fontFamily: T.police, fontWeight: 900, fontSize: 16, color: T.texte, flexShrink: 0 }}>{euros(totalTicket(arc))}</span>
                    <IconeChevron width={18} height={18} style={{ color: T.texteLeger, flexShrink: 0, transform: estOuvert ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }} />
                  </button>

                  {estOuvert && (
                    <div style={{ padding: '2px 14px 14px', background: '#FAFAF8' }}>
                      {articles.map((item, j) => {
                        const cle = `${arc.id}_${j}`;
                        const fait = ajoutes.has(cle);
                        const total = totalLigne(item);
                        const qte = Number(item.qty) || 1;
                        return (
                          <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${T.trait}` }}>
                            <button onClick={() => onCorriger?.(arc, item, j)} title="Corriger le produit"
                              style={{ flex: 1, minWidth: 0, border: 'none', background: 'none', padding: 0, cursor: onCorriger ? 'pointer' : 'default', textAlign: 'left' }}>
                              <span style={{ display: 'block', fontFamily: T.police, fontWeight: 700, fontSize: 13.5, color: T.texte }}>
                                {item.brand ? `${item.brand} · ` : ''}{nomAffiche(item)}
                              </span>
                              <span style={{ display: 'block', fontFamily: T.police, fontSize: 12, color: T.texteLeger, marginTop: 1 }}>
                                {[item.format, qte > 1 ? `× ${qte}` : null].filter(Boolean).join(' · ') || ' '}
                              </span>
                            </button>
                            <span style={{ fontFamily: T.police, fontWeight: 800, fontSize: 13.5, color: T.texte, flexShrink: 0 }}>{total != null ? euros(total) : '—'}</span>
                            {onAjouter && (
                              <button onClick={() => { if (!fait) { onAjouter(item); setAjoutes(prev => new Set(prev).add(cle)); } }}
                                aria-label={fait ? 'Ajouté à ma liste' : 'Ajouter à ma liste'} title={fait ? 'Ajouté à ma liste' : 'Ajouter à ma liste'}
                                style={{ width: 32, height: 32, borderRadius: 99, border: 'none', flexShrink: 0, cursor: fait ? 'default' : 'pointer', background: fait ? T.vert : T.trait, color: fait ? '#fff' : T.texteDoux, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {fait ? <IconeCoche width={16} height={16} /> : <IconePlus width={16} height={16} />}
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {onSupprimer && (
                        <div style={{ borderTop: `1px solid ${T.trait}`, paddingTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          {aSupprimer === arc.id ? (
                            <>
                              <span style={{ fontFamily: T.police, fontSize: 12.5, fontWeight: 700, color: T.texteDoux, marginRight: 'auto' }}>Supprimer ce ticket ?</span>
                              <button onClick={() => setASupprimer(null)} style={{ border: 'none', background: T.trait, borderRadius: 10, padding: '7px 14px', fontFamily: T.police, fontWeight: 800, fontSize: 12.5, color: T.texte, cursor: 'pointer' }}>Non</button>
                              <button onClick={() => { onSupprimer(arc); setASupprimer(null); setOuvert(null); }} style={{ border: 'none', background: T.rouge, borderRadius: 10, padding: '7px 14px', fontFamily: T.police, fontWeight: 800, fontSize: 12.5, color: '#fff', cursor: 'pointer' }}>Oui, supprimer</button>
                            </>
                          ) : (
                            <button onClick={() => setASupprimer(arc.id)} style={{ border: 'none', background: 'none', padding: '4px 0', fontFamily: T.police, fontWeight: 700, fontSize: 12.5, color: T.texteLeger, cursor: 'pointer', textDecoration: 'underline' }}>Supprimer ce ticket</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
