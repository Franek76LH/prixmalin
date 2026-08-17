// Chantier 101 — recherche produit réutilisable pour les écrans admin.
// Même moteur que CorrigerProduitSheet (App.jsx) : RPC
// rechercher_produits_pour_correction (recherche tolérante côté serveur,
// debounce 280 ms, réponses obsolètes ignorées), puis même résolution de
// variante — 0 variante active -> null légitime (vrac/frais), 1 -> automatique,
// plusieurs -> écran de choix explicite, jamais de repli silencieux.
//
// Volontairement autonome (pas d'extraction de CorrigerProduitSheet, dont le
// flux de rattachement/apprentissage reste inchangé) : ici on ne fait que
// REMONTER le couple (produit, variante) choisi, l'appelant décide quoi en faire.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatEtiquetteVariante } from '../../lib/nomProduit';
import { motsPourRepli, fusionnerResultatsParMot } from '../../lib/rechercheRepli';

const F = "'Nunito',sans-serif";

// Chantier 103 — requeteInitiale : termes de départ (le nom produit venu
// d'OpenFoodFacts) pour que la bonne fiche apparaisse déjà en tête. Optionnel :
// sans lui, le comportement est strictement celui d'avant (champ vide).
//
// Chantier 103b — repliProgressif : n'a de sens QUE pour cette recherche
// automatique. Si la phrase entière ne donne rien, on retente mot par mot et on
// fusionne (voir lib/rechercheRepli). Une seule fois, et jamais sur la saisie
// manuelle : le parcours « Assigner le produit » de ValidationScanSheet, qui
// n'active pas ce drapeau, garde exactement le comportement du chantier 101.
export default function RechercheProduitSheet({ titre = 'Choisir le bon produit', sousTitre = null, requeteInitiale = '', repliProgressif = false, onClose, onChoisir }) {
  const [query, setQuery] = useState(requeteInitiale);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resolvingVariante, setResolvingVariante] = useState(false);
  const [produitEnAttente, setProduitEnAttente] = useState(null);
  const [variantesAChoisir, setVariantesAChoisir] = useState(null);
  const [varianteChoisie, setVarianteChoisie] = useState(null);
  const seq = useRef(0);
  const selectionFaite = useRef(false);
  const champRef = useRef(null); // Chantier 104c — refocus après effacement
  // Chantier 103b — le repli n'est armé que pour la recherche automatique de
  // départ, et se désarme dès qu'il a servi (ou dès que l'utilisateur tape).
  const repliArme = useRef(Boolean(repliProgressif && requeteInitiale.trim()));
  // Le repli réécrit le champ avec les mots qui ont marché ; sans ce garde-fou,
  // cette réécriture relancerait aussitôt une recherche « tous les mots » qui
  // effacerait les résultats qu'on vient d'obtenir.
  const ignorerProchaineRecherche = useRef(false);
  // { requeteEchouee, mots } — ce qu'on dit à l'écran quand les résultats
  // affichés ne viennent PAS de la requête demandée.
  const [noteRepli, setNoteRepli] = useState(null);
  const [aucuneCorrespondance, setAucuneCorrespondance] = useState(false);

  useEffect(() => {
    if (ignorerProchaineRecherche.current) { ignorerProchaineRecherche.current = false; return; }
    if (query.trim().length < 2) { setResults([]); setError(null); setNoteRepli(null); setAucuneCorrespondance(false); return; }
    const mySeq = ++seq.current;
    setSearching(true); setError(null);
    const chercher = (terme) => supabase.rpc('rechercher_produits_pour_correction', {
      p_terme: terme,
      p_enseigne: null,
    });
    const timer = setTimeout(async () => {
      try {
        // Étape A — la requête telle quelle. C'est le seul chemin possible pour
        // la saisie manuelle.
        const { data, error: err } = await chercher(query.trim());
        if (mySeq !== seq.current) return; // réponse obsolète, ignorée
        if (err) { setError('Recherche impossible.'); setSearching(false); return; }
        const trouves = data || [];
        if (trouves.length > 0 || !repliArme.current) {
          setResults(trouves);
          setNoteRepli(null);
          setAucuneCorrespondance(false);
          setSearching(false);
          return;
        }

        // Étape B — 0 résultat sur la phrase entière : on retente mot par mot.
        repliArme.current = false; // une seule fois, quoi qu'il arrive ensuite
        const requeteEchouee = query.trim();
        const mots = motsPourRepli(requeteEchouee);
        if (mots.length === 0) {
          setResults([]); setNoteRepli(null); setAucuneCorrespondance(true); setSearching(false);
          return;
        }
        const lots = await Promise.all(mots.map(async (mot) => {
          try {
            const { data: d, error: e2 } = await chercher(mot);
            return e2 ? [] : (d || []);
          } catch (e2) {
            console.error('[RechercheProduitSheet] repli sur le mot', mot, ':', e2);
            return [];
          }
        }));
        if (mySeq !== seq.current) return;
        const { fiches, motsUtilises } = fusionnerResultatsParMot(mots, lots);

        // Étape C — toujours rien : on laisse le champ intact et on le dit.
        if (fiches.length === 0) {
          setResults([]); setNoteRepli(null); setAucuneCorrespondance(true); setSearching(false);
          return;
        }

        setResults(fiches);
        setNoteRepli({ requeteEchouee, mots: motsUtilises });
        setAucuneCorrespondance(false);
        setSearching(false);
        // Chantier 103d — le champ reçoit LE MOT LE PLUS DISCRIMINANT, pas la
        // concaténation des mots utilisés.
        //
        // La liste vient de plusieurs recherches SÉPARÉES : aucune requête
        // unique ne l'a produite, et recoller les mots donnerait un texte qui
        // ramène 0 fiche (la RPC exige tous les mots dans le même
        // nom_reference). Le champ mentirait, et la première frappe de
        // correction viderait l'écran. motsUtilises[0] est le mot qui a ramené
        // le moins de fiches : rejoué seul, il redonne des résultats. Le
        // bandeau, lui, continue de porter la liste complète des mots.
        //
        // La comparaison évite d'armer le garde-fou pour un setQuery sans effet
        // (React court-circuiterait le rendu et le drapeau resterait coincé sur
        // la frappe suivante).
        const motPrincipal = motsUtilises[0];
        if (motPrincipal && motPrincipal !== query) {
          ignorerProchaineRecherche.current = true;
          setQuery(motPrincipal);
        }
      } catch (e) {
        if (mySeq !== seq.current) return;
        console.error('[RechercheProduitSheet] recherche :', e);
        setError('Recherche impossible.');
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [query]);

  // Chantier 105 — on transmet EN PLUS la variante choisie (objet complet :
  // libellé, marque, quantité), parce que le garde-fou code-barres a besoin de
  // savoir à quoi ressemble la fiche retenue pour la comparer à OpenFoodFacts.
  // Champ additionnel : les appelants qui l'ignorent ne changent pas de
  // comportement. null quand le produit n'a aucune variante active (vrac, frais).
  const finaliser = async (produit, varianteId, variante = null) => {
    setSaving(true);
    setError(null);
    try {
      const res = await onChoisir({ produitId: produit.produit_id, varianteId, nomProduit: produit.nom_reference, variante });
      if (res && res.ok === false) { setError(res.message || 'Action impossible, réessaie.'); return; }
      onClose?.();
    } catch (e) {
      console.error('[RechercheProduitSheet] validation :', e);
      setError('Action impossible, réessaie.');
    } finally {
      setSaving(false);
    }
  };

  const choisir = async (produit) => {
    if (saving || resolvingVariante) return;
    setError(null);
    setResolvingVariante(true);
    const { data, error: errVar } = await supabase
      .from('variantes_produit')
      .select('id, libelle, quantite_nette, unite_quantite, nombre_unites, marque_id, marques(nom)')
      .eq('produit_id', produit.produit_id)
      .eq('actif', true);
    setResolvingVariante(false);

    if (errVar) { setError('Impossible de vérifier les variantes de ce produit, réessaie.'); return; }

    const liste = data || [];
    // Chantier 101 — plus de sélection AUTOMATIQUE quand une seule variante
    // active existe : c'est exactement ce qui a fait assigner « Panzani 0,5 kg »
    // et « générique 1 kg » sans que personne ne voie passer le format. Dès
    // qu'il y a au moins une variante, on la MONTRE (pré-cochée s'il n'y en a
    // qu'une, donc un seul geste de plus) et l'utilisateur confirme.
    // Zéro variante active reste un cas légitime (vrac, frais) -> null assumé.
    if (liste.length === 0) { await finaliser(produit, null); return; }

    setProduitEnAttente(produit);
    setVariantesAChoisir([...liste].sort((a, b) => formatEtiquetteVariante(a).localeCompare(formatEtiquetteVariante(b), 'fr')));
    setVarianteChoisie(liste.length === 1 ? liste[0].id : null);
  };

  const annulerChoixVariante = () => {
    setProduitEnAttente(null);
    setVariantesAChoisir(null);
    setVarianteChoisie(null);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 500 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: F, fontWeight: 900, fontSize: 16, color: '#1a1a1a' }}>
              {variantesAChoisir ? 'Quelle quantité ?' : titre}
            </div>
            {(variantesAChoisir ? produitEnAttente?.nom_reference : sousTitre) && (
              <div style={{ fontFamily: F, fontSize: 12, color: '#999', marginTop: 2 }}>
                {variantesAChoisir ? produitEnAttente?.nom_reference : sousTitre}
              </div>
            )}
          </div>
          <button onClick={variantesAChoisir ? annulerChoixVariante : onClose} style={{ background: '#F5F6F8', border: 'none', borderRadius: 99, width: 28, height: 28, color: '#999', fontSize: 14, cursor: 'pointer' }}>
            {variantesAChoisir ? '←' : '✕'}
          </button>
        </div>

        {variantesAChoisir ? (
          <>
            {error && <div style={{ fontFamily: F, fontSize: 13, color: '#CC0000', marginBottom: 8 }}>⚠️ {error}</div>}
            <div style={{ fontFamily: F, fontSize: 12, color: '#B8860B', background: '#FFF8E1', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.4 }}>
              {variantesAChoisir.length === 1
                ? "⚠️ Un seul format connu pour cette fiche — vérifie qu'il correspond bien à l'article scanné avant de valider."
                : 'Choisis le format qui correspond à l\'article scanné.'}
            </div>
            <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, minHeight: 0, paddingBottom: 24 }}>
              {variantesAChoisir.map(v => (
                <div key={v.id} onClick={() => setVarianteChoisie(v.id)} style={{ padding: '12px 10px', borderBottom: '1px solid #F5F6F8', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <div style={{ width: 20, height: 20, borderRadius: 99, border: `2px solid ${varianteChoisie === v.id ? '#0066FF' : '#F5F6F8'}`, background: varianteChoisie === v.id ? '#0066FF' : 'transparent', flexShrink: 0 }} />
                  <span style={{ fontFamily: F, fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{formatEtiquetteVariante(v)}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { if (varianteChoisie && produitEnAttente) finaliser(produitEnAttente, varianteChoisie, variantesAChoisir.find(v => v.id === varianteChoisie) ?? null); }}
              disabled={!varianteChoisie || saving}
              style={{ marginTop: 12, width: '100%', padding: 13, border: 'none', borderRadius: 12, fontFamily: F, fontWeight: 900, fontSize: 14, color: '#fff', background: (!varianteChoisie || saving) ? '#ccc' : '#0066FF', cursor: (!varianteChoisie || saving) ? 'default' : 'pointer' }}
            >
              {saving ? '...' : 'Valider'}
            </button>
          </>
        ) : (
          <>
            {/* Chantier 104c — la croix sert surtout ici : le champ arrive
                prérempli d'un nom OpenFoodFacts à rallonge, et l'effacer au
                pouce était pénible. Comme une frappe, l'effacement DÉSARME le
                repli progressif : la recherche suivante est celle que
                l'utilisateur tape, pas une recherche automatique relancée. */}
            <div style={{ position:'relative', marginBottom:12 }}>
            <input
              ref={champRef}
              autoFocus
              value={query}
              // Termes préremplis : sélectionnés au premier focus, pour qu'une
              // reformulation ne demande pas d'effacer caractère par caractère
              // sur un iPhone.
              onFocus={e => { if (requeteInitiale && !selectionFaite.current) { selectionFaite.current = true; e.target.select(); } }}
              // Dès que l'utilisateur tape, le repli automatique est désarmé :
              // sa saisie est cherchée telle quelle, comme au chantier 101.
              onChange={e => { repliArme.current = false; setQuery(e.target.value); }}
              placeholder="🔍 Chercher un produit du catalogue..."
              style={{ width: '100%', padding: '11px 14px', paddingRight: 44, borderRadius: 10, border: `2px solid ${query ? '#0066FF' : '#F5F6F8'}`, background: '#fff', fontFamily: F, fontSize: 14, fontWeight: 700, color: '#1a1a1a', outline: 'none', boxSizing: 'border-box' }}
            />
            {query.length > 0 && (
              <button
                type="button"
                aria-label="Effacer la recherche"
                onMouseDown={e => e.preventDefault()}
                onTouchStart={e => e.preventDefault()}
                onClick={() => { repliArme.current = false; setQuery(''); champRef.current?.focus(); }}
                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#9AA0A6', fontSize: 15, lineHeight: 1 }}
              >
                ✕
              </button>
            )}
            </div>
            {error && <div style={{ fontFamily: F, fontSize: 13, color: '#CC0000', marginBottom: 8 }}>⚠️ {error}</div>}
            <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1, minHeight: 0, paddingBottom: 24 }}>
              {query.trim().length < 2 && (
                <div style={{ textAlign: 'center', padding: '20px 0', fontFamily: F, fontSize: 13, color: '#999' }}>Tape au moins 2 caractères pour chercher</div>
              )}
              {(searching || resolvingVariante || saving) && (
                <div style={{ textAlign: 'center', padding: '12px 0', fontFamily: F, fontSize: 13, color: '#999' }}>
                  {saving ? 'Enregistrement...' : resolvingVariante ? 'Vérification...' : 'Recherche...'}
                </div>
              )}
              {/* Chantier 103b — on ne fait jamais semblant : quand la liste ne
                  répond pas à ce qui a été demandé, on dit ce qui a échoué et
                  ce qui a réellement été cherché.
                  103c — les mots sont énumérés du plus discriminant au moins
                  discriminant (l'ordre que fusionnerResultatsParMot leur donne),
                  donc l'ordre lu ici est celui de la liste en dessous. */}
              {!searching && noteRepli && results.length > 0 && (
                <div style={{ fontFamily: F, fontSize: 12, color: '#B8860B', background: '#FFF8E1', borderRadius: 8, padding: '8px 10px', marginBottom: 8, lineHeight: 1.4 }}>
                  Rien pour « {noteRepli.requeteEchouee} » — résultats élargis pour : {noteRepli.mots.join(', ')}
                  {noteRepli.mots.length > 1 ? ' (cherchés séparément)' : ''}
                </div>
              )}
              {!searching && query.trim().length >= 2 && results.length === 0 && !error && (
                <div style={{ textAlign: 'center', padding: '20px 0', fontFamily: F, fontSize: 13, color: '#999', lineHeight: 1.4 }}>
                  {aucuneCorrespondance
                    ? 'Aucune fiche du catalogue ne correspond — modifie la recherche ou crée une nouvelle fiche'
                    : 'Aucun produit trouvé'}
                </div>
              )}
              {results.map(p => (
                <div key={p.produit_id} onClick={() => choisir(p)} style={{ padding: '12px 10px', borderBottom: '1px solid #F5F6F8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, cursor: (saving || resolvingVariante) ? 'default' : 'pointer', opacity: (saving || resolvingVariante) ? 0.6 : 1 }}>
                  <span style={{ fontFamily: F, fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{p.nom_reference}</span>
                  {p.dernier_prix != null && (
                    <span style={{ fontFamily: F, fontSize: 12, fontWeight: 700, color: '#999', flexShrink: 0 }}>
                      {Number(p.dernier_prix).toFixed(2).replace('.', ',')} €
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
