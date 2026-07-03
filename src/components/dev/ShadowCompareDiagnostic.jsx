import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { STALE_DAYS, STORES } from '../../constants';
import {
  chargerPrixComparables,
  construireCiblesComparaison,
  faireCorrespondrePrix,
  regrouperParMagasin,
  calculerTotauxMagasins,
  classerMagasins,
  comparerResultatsLegacyEtCore,
} from '../../lib/comparateurCore';

// PANNEAU DE DIAGNOSTIC DEV UNIQUEMENT — aucune logique métier ici.
// Ne monte JAMAIS ce composant hors de import.meta.env.DEV (voir App.jsx).
// Recalcule le résultat legacy de façon indépendante, en lecture seule, pour
// le comparer au moteur Core (#56.1/#56.2). N'affecte jamais l'affichage,
// le classement, les économies ou la validation vus par l'utilisateur.

// Copies locales et pures de la logique legacy — App.jsx ne les exporte pas,
// on ne les modifie pas, on les reproduit à l'identique pour un calcul
// vraiment indépendant (voir App.jsx lignes 40-50, 228, 3693).
function normName(s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}
function normFormat(s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/,/g, '.').replace(/\s+/g, '');
}
function itemMatchesPrice(item, price) {
  const sameProduct = normName(price.product) === normName(item.product);
  const formatOk = !item.format || !price.format || normFormat(price.format) === normFormat(item.format);
  const brandOk = !item.brand || normName(item.brand) === normName(price.brand || '');
  return sameProduct && formatOk && brandOk;
}
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Reproduit exactement l'algorithme ranked/best de CompareTab (App.jsx),
// pour une comparaison legacy vs Core équitable.
function calculerLegacyIndependant(items, priceDB, storesGeo, userPos, searchRadius) {
  const cutoffMs = Date.now() - STALE_DAYS * 86400000;

  const analysis = items.map(item => {
    const matches = priceDB.filter(p => itemMatchesPrice(item, p));
    const byStore = {};
    matches.forEach(p => {
      if (new Date(p.date).getTime() < cutoffMs) return;
      if (userPos && p.store_id) {
        const geo = storesGeo.find(s => s.id === p.store_id);
        if (geo?.latitude && geo?.longitude && distanceKm(userPos.lat, userPos.lng, geo.latitude, geo.longitude) > searchRadius) return;
      }
      if (!byStore[p.storeId] || p.price < byStore[p.storeId].price) byStore[p.storeId] = p;
    });
    return { item, byStore };
  });

  const storesInRange = userPos
    ? storesGeo.filter(s => !s.latitude || !s.longitude || distanceKm(userPos.lat, userPos.lng, s.latitude, s.longitude) <= searchRadius)
    : storesGeo;
  const activeStores = storesGeo.length === 0
    ? STORES
    : STORES.filter(s => storesInRange.some(sg => sg.enseigne === s.id || sg.enseigne === s.id.replace('superu', 'systemu')));

  const storeTotals = {};
  activeStores.forEach(s => { storeTotals[s.id] = { total: 0, found: 0 }; });
  analysis.forEach(({ item, byStore }) => {
    activeStores.forEach(s => {
      if (byStore[s.id]) {
        storeTotals[s.id].total += byStore[s.id].price * item.qty;
        storeTotals[s.id].found += 1;
      }
    });
  });

  const ranked = STORES.map(s => ({ ...s, ...storeTotals[s.id] }))
    .filter(s => s.found > 0)
    .sort((a, b) => (b.found !== a.found ? b.found - a.found : a.total - b.total));

  const best = ranked[0] ?? null;
  return { best: best ? { id: best.id, name: best.name, total: best.total, found: best.found } : null };
}

function Row({ label, value }) {
  return (
    <tr>
      <td style={{ padding: '2px 8px 2px 0', opacity: 0.7 }}>{label}</td>
      <td style={{ padding: '2px 0', fontWeight: 700 }}>{value}</td>
    </tr>
  );
}

export default function ShadowCompareDiagnostic({ items, priceDB, searchRadius, userPos }) {
  const [storesGeo, setStoresGeo] = useState([]);
  const [rapport, setRapport] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.from('stores').select('id, name, enseigne, latitude, longitude')
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { console.error('[ShadowCompareDiagnostic] lecture stores échouée :', err); return; }
        setStoresGeo(data || []);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const legacy = calculerLegacyIndependant(items, priceDB, storesGeo, userPos, searchRadius);

        const { cibles, exclusions } = construireCiblesComparaison(items);
        const produitIds = [...new Set(cibles.map(c => c.produit_id))];
        const cutoffISO = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();

        const prixBruts = await chargerPrixComparables(produitIds, {});
        if (cancelled) return;

        const correspondancesBrutes = faireCorrespondrePrix(cibles, prixBruts, { userPos, searchRadius });
        const correspondancesFraiches = faireCorrespondrePrix(cibles, prixBruts, { userPos, searchRadius, staleCutoffISO: cutoffISO });

        const regroupement = regrouperParMagasin(correspondancesFraiches);
        const totauxParMagasin = calculerTotauxMagasins(regroupement, cibles);
        const classement = classerMagasins(totauxParMagasin);

        const rapportCalcule = comparerResultatsLegacyEtCore(
          legacy,
          { correspondancesBrutes, correspondancesFraiches, classement },
          exclusions,
          { totalItems: items.length },
        );

        if (!cancelled) setRapport(rapportCalcule);
      } catch (err) {
        console.error('[ShadowCompareDiagnostic] échec du calcul shadow (aucun impact utilisateur) :', err);
        if (!cancelled) { setError(err?.message || 'Erreur inconnue'); setRapport(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [items, priceDB, storesGeo, userPos, searchRadius]);

  return (
    <div style={{ margin: 16, border: '2px dashed #999', borderRadius: 10, background: '#1a1a1a', color: '#0f0', fontFamily: 'monospace', fontSize: 12 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: 'transparent', border: 'none', color: '#0f0', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
      >
        {open ? '▼' : '▶'} 🧪 DIAGNOSTIC DEV — invisible en prod {loading ? '(calcul…)' : ''}
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px' }}>
          {error && <div style={{ color: '#f66' }}>Erreur shadow (sans impact utilisateur) : {error}</div>}
          {!error && !rapport && <div>Pas encore de rapport.</div>}
          {!error && rapport && (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <Row label="Articles (total / éligibles Core / trouvés / manquants)" value={`${rapport.nbArticlesTotal} / ${rapport.nbArticlesEligiblesCore} / ${rapport.nbArticlesTrouves} / ${rapport.nbArticlesManquants}`} />
                  <Row label="Exclus sans produit_id / sans format" value={`${rapport.nbExclusSansProduitId} / ${rapport.nbExclusSansFormat}`} />
                  <Row label="Magasins candidats Core" value={rapport.nbMagasinsCandidatsCore} />
                  <Row label="Meilleur legacy" value={rapport.meilleurLegacy ? `${rapport.meilleurLegacy.enseigne} — ${rapport.meilleurLegacy.total.toFixed(2)} €` : '—'} />
                  <Row label="Meilleur Core" value={rapport.meilleurCore ? `${rapport.meilleurCore.nom ?? rapport.meilleurCore.id} — ${rapport.meilleurCore.total.toFixed(2)} €` : '—'} />
                  <Row label="Total legacy / Core / écart" value={`${rapport.totalLegacy ?? '—'} / ${rapport.totalCore ?? '—'} / ${rapport.differenceTotale ?? '—'}`} />
                </tbody>
              </table>
              <div style={{ marginTop: 8 }}>Raisons : {JSON.stringify(rapport.raisons)}</div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer' }}>JSON complet</summary>
                <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(rapport, null, 2)}</pre>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}
