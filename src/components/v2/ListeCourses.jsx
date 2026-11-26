// Chantier 125 — écran « Ma liste », aux couleurs de la nouvelle interface.
// Présentation seule : toutes les actions (cocher, modifier, supprimer,
// préférence de marque, favoris) restent celles de ListTab, passées en props.
// Chantier 160 — « Dicter mes courses » à côté de « Ajouter des produits », en
// haut de la liste (et non plus en petit rond flottant). Le bandeau « Où c'est
// le moins cher ? » est retiré : l'onglet Comparer de la barre ouvre le même
// écran (CompareTab), avec la même liste, les mêmes quantités et préférences.
import { useState, useEffect } from 'react';
import { T } from './theme';
import { IconePlus, IconeCroix, IconeCrayon, IconeCoche, IconeMicro } from './Icones';

function Section({ titre, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 12, color: T.texteLeger, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 4px 8px' }}>{titre}</div>
      <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function BoutonRond({ onClick, label, children, fond = T.fond, couleur = T.texteDoux }) {
  return (
    <button onClick={onClick} aria-label={label} style={{ border: 'none', background: fond, color: couleur, width: 32, height: 32, borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {children}
    </button>
  );
}

function Ligne({ item, fait, dernier, vignette, onCocher, onModifier, onSupprimer, onMarque, propositions = null, onRelier }) {
  const pref = item.marque_pref === 'mdd' ? 'mdd' : 'nationale';
  const sousTitre = [item.formatDisplay ?? item.format, item.qty > 1 ? `× ${item.qty}` : null].filter(Boolean).join(' · ');
  return (
    <div style={{ padding: '12px 8px 12px 12px', borderBottom: dernier ? 'none' : `1px solid ${T.trait}`, background: fait ? '#FAFBFA' : 'transparent' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={onCocher} aria-label={fait ? `Remettre ${item.product} à acheter` : `Cocher ${item.product}`} aria-pressed={fait} style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', padding: 0,
        border: `2px solid ${fait ? T.vert : '#C9CDD4'}`, background: fait ? T.vert : '#fff', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {fait && <IconeCoche width={16} height={16} strokeWidth={3} />}
      </button>
      {vignette && <div style={{ width: 40, height: 40, flexShrink: 0, opacity: fait ? 0.6 : 1 }}>{vignette(item)}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 15, color: fait ? T.texteLeger : T.texte, textDecoration: fait ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.brand ? `${item.brand} · ` : ''}{item.product}
        </div>
        {sousTitre && <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteLeger, marginTop: 1 }}>{sousTitre}</div>}
      </div>
      {!fait && onModifier && <BoutonRond onClick={onModifier} label={`Modifier ${item.product}`}><IconeCrayon width={16} height={16} /></BoutonRond>}
      <BoutonRond onClick={onSupprimer} label={`Retirer ${item.product}`} fond="transparent" couleur={T.texteLeger}><IconeCroix width={16} height={16} /></BoutonRond>
    </div>
        {/* Chantier 126 — produit écrit en texte libre : fiches proposées. */}
        {!fait && propositions?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8, marginLeft: vignette ? 84 : 36 }}>
            <span style={{ fontFamily: T.police, fontWeight: 800, fontSize: 11.5, color: T.texteLeger }}>Tu veux dire :</span>
            {propositions.map(p => (
              <button key={p.produit_id} onClick={() => onRelier?.(item, p)} style={{ border: `1px solid ${T.bleu}`, background: '#fff', color: T.bleu, borderRadius: 99, padding: '4px 10px', fontFamily: T.police, fontWeight: 800, fontSize: 11.5, cursor: 'pointer' }}>{p.produit_nom}{p.memorise ? ' · comme d\'habitude' : p.dejaAchete ? ' · déjà acheté' : ''}</button>
            ))}
          </div>
        )}
        {/* Préférence de marque de CETTE ligne (liste_courses.marque_pref) :
            « Grandes marques » écarte les marques de magasin (sauf produit qui
            n'existe qu'ainsi), « Toutes marques » les inclut. */}
        {!fait && onMarque && (
          <div role="group" aria-label="Marques à comparer" style={{ display: 'inline-flex', marginTop: 8, marginLeft: vignette ? 84 : 36, borderRadius: 9, background: T.fond, padding: 2 }}>
            {[['nationale', 'Grandes marques'], ['mdd', 'Toutes marques']].map(([val, libelle]) => (
              <button key={val} onClick={() => onMarque(item.id, val)} aria-pressed={pref === val} style={{
                border: 'none', cursor: 'pointer', borderRadius: 7, padding: '4px 7px', fontFamily: T.police, fontWeight: 800, fontSize: 10.5, whiteSpace: 'nowrap',
                background: pref === val ? '#fff' : 'transparent', color: pref === val ? T.texte : T.texteLeger,
                boxShadow: pref === val ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
              }}>{libelle}</button>
            ))}
          </div>
        )}
    </div>
  );
}

export default function ListeCourses({
  items = [], itemsReportes = [], nbFavoris = 0, vignette = null,
  onCocher, onModifier, onSupprimer, onMarque, onReactiverReporte, onSupprimerReporte,
  onAjouter, onFavoris, propositions = {}, onRelier, onDicter = null, onRetirerPris = null, onComparer = null,
  encartAAcheter = null,
}) {
  // Chantier 184 — « Retirer les articles pris » en deux appuis (le second
  // confirme, pendant 4 s) : on ne vide pas une section par erreur.
  const [confirmerRetrait, setConfirmerRetrait] = useState(false);
  useEffect(() => {
    if (!confirmerRetrait) return;
    const t = setTimeout(() => setConfirmerRetrait(false), 4000);
    return () => clearTimeout(t);
  }, [confirmerRetrait]);
  const aAcheter = items.filter(i => !i.checked);
  const pris = items.filter(i => i.checked);

  if (items.length === 0 && itemsReportes.length === 0) {
    return (
      <div style={{ padding: '24px 16px 110px' }}>
        <div style={{ background: T.carte, borderRadius: T.rayon, boxShadow: T.ombre, padding: '32px 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>🛒</div>
          <div style={{ fontFamily: T.police, fontWeight: 900, fontSize: 19, color: T.texte, marginBottom: 6 }}>Ta liste est vide</div>
          <div style={{ fontFamily: T.police, fontSize: 14, color: T.texteDoux, marginBottom: 20 }}>Ajoute ce qu'il te faut, la communauté te dira où ta liste coûte le moins cher.</div>
          <button onClick={onAjouter} style={{ width: '100%', border: 'none', background: T.rouge, color: '#fff', borderRadius: 14, padding: '14px', fontFamily: T.police, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}>
            Ajouter des produits
          </button>
          {onDicter && (
            <button onClick={onDicter} style={{ width: '100%', marginTop: 10, border: `1.5px solid ${T.trait}`, background: '#fff', color: T.texte, borderRadius: 14, padding: '13px', fontFamily: T.police, fontWeight: 900, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <IconeMicro width={20} height={20} /> Dicter mes courses
            </button>
          )}
          {nbFavoris > 0 && (
            <button onClick={onFavoris} style={{ width: '100%', marginTop: 10, border: `1.5px solid ${T.trait}`, background: '#fff', color: T.texte, borderRadius: 14, padding: '13px', fontFamily: T.police, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
              ⭐ Reprendre mes courses habituelles
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: `16px 16px ${onComparer && aAcheter.length > 0 ? 180 : 110}px` }}>
      {/* Chantier 186 (proposition 9 de l'audit, décision de François du
          25/11) — la suite naturelle de la liste, toujours sous le pouce :
          « Où c'est le moins cher ? », au-dessus de la barre du bas. */}
      {onComparer && aAcheter.length > 0 && (
        <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))', width: 'calc(100% - 24px)', maxWidth: 406, zIndex: 45 }}>
          <button onClick={onComparer} style={{
            width: '100%', border: 'none', background: T.rouge, color: '#fff', borderRadius: 16, padding: '14px 16px', minHeight: 52,
            fontFamily: T.police, fontWeight: 900, fontSize: 15.5, cursor: 'pointer', boxShadow: '0 6px 18px rgba(204,0,0,0.3)',
          }}>
            Où c'est le moins cher ? <span style={{ fontWeight: 700, opacity: 0.85 }}>({aAcheter.length} article{aAcheter.length > 1 ? 's' : ''})</span>
          </button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={onAjouter} style={{
          flex: 1, minWidth: 0, border: 'none', background: T.texte, color: '#fff', borderRadius: 14, padding: '12px 10px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: T.police, fontWeight: 900, fontSize: 14,
        }}>
          <IconePlus width={18} height={18} /> Ajouter des produits
        </button>
        {onDicter && (
          <button onClick={onDicter} style={{
            flex: 1, minWidth: 0, border: `1.5px solid ${T.trait}`, background: '#fff', color: T.rouge, borderRadius: 14, padding: '12px 10px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: T.police, fontWeight: 900, fontSize: 14,
          }}>
            <IconeMicro width={18} height={18} /> Dicter mes courses
          </button>
        )}
      </div>
      {aAcheter.length > 0 && (
        <Section titre={`À acheter (${aAcheter.length})`}>
          {aAcheter.map((item, i) => (
            <Ligne key={item.id} item={item} fait={false} dernier={i === aAcheter.length - 1} vignette={vignette}
              onCocher={() => onCocher(item.id)} onModifier={() => onModifier(item)} onSupprimer={() => onSupprimer(item.id)} onMarque={onMarque}
              propositions={propositions[item.id]} onRelier={onRelier} />
          ))}
        </Section>
      )}
      {/* Chantier 194 — « Même prix, meilleure note », juste sous ce qu'il reste à acheter. */}
      {aAcheter.length > 0 && encartAAcheter}
      {pris.length > 0 && (
        <Section titre={`Déjà pris (${pris.length})`}>
          {pris.map((item, i) => (
            <Ligne key={item.id} item={item} fait dernier={i === pris.length - 1} vignette={vignette}
              onCocher={() => onCocher(item.id)} onSupprimer={() => onSupprimer(item.id)} />
          ))}
        </Section>
      )}
      {pris.length > 0 && onRetirerPris && (
        <button onClick={() => { if (confirmerRetrait) { setConfirmerRetrait(false); onRetirerPris(); } else setConfirmerRetrait(true); }}
          style={{ display: 'block', margin: '-8px 4px 16px auto', border: 'none', background: confirmerRetrait ? T.rougePale : 'none', color: T.rouge, borderRadius: 10, padding: '8px 10px', minHeight: 40, fontFamily: T.police, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
          {confirmerRetrait ? `Confirmer : retirer ${pris.length} article${pris.length > 1 ? 's' : ''}` : `Retirer les articles pris (${pris.length})`}
        </button>
      )}
      {itemsReportes.length > 0 && (
        <Section titre={`Pour plus tard (${itemsReportes.length})`}>
          {itemsReportes.map((item, i) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 12px 14px', borderBottom: i === itemsReportes.length - 1 ? 'none' : `1px solid ${T.trait}` }}>
              {vignette && <div style={{ width: 40, height: 40, flexShrink: 0, opacity: 0.7 }}>{vignette(item)}</div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.police, fontWeight: 800, fontSize: 15, color: T.texteDoux, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.product}</div>
                <div style={{ fontFamily: T.police, fontSize: 12.5, color: T.texteLeger, marginTop: 1 }}>
                  {[item.formatDisplay ?? item.format, item.qty > 1 ? `× ${item.qty}` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button onClick={() => onReactiverReporte?.(item.id)} style={{ border: 'none', background: T.fond, color: T.texte, borderRadius: 10, padding: '7px 11px', fontFamily: T.police, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', flexShrink: 0 }}>
                Remettre
              </button>
              <BoutonRond onClick={() => onSupprimerReporte?.(item.id)} label={`Supprimer ${item.product}`} fond="transparent" couleur={T.texteLeger}><IconeCroix width={16} height={16} /></BoutonRond>
            </div>
          ))}
        </Section>
      )}

      <button onClick={onFavoris} style={{ width: '100%', border: 'none', background: 'none', color: T.texteDoux, padding: '6px', fontFamily: T.police, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
        ⭐ {nbFavoris > 0 ? 'Mes courses habituelles et favoris' : 'Courses habituelles et favoris'}
      </button>

    </div>
  );
}
