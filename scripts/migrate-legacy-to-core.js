#!/usr/bin/env node
// ============================================================================
// CHANTIER — Migration des prix legacy (price_db / community_prices) vers le
// Core. Script autonome, exécuté localement par François via terminal.
// N'est JAMAIS appelé depuis l'app cliente. Utilise la clé service_role
// (contourne RLS — nécessaire, voir import-drive-csv.js pour le même
// raisonnement).
//
// Trois modes :
//   node scripts/migrate-legacy-to-core.js                → aperçu, AUCUNE écriture
//   node scripts/migrate-legacy-to-core.js --confirmer     → écriture réelle (transaction, garde-fou)
//   node scripts/migrate-legacy-to-core.js --confirmer --valider  → écriture + passage en 'valide'
//
// Configuration : scripts/.env (voir scripts/.env.example)
//
// PRÉALABLE BLOQUANT (vérifié en lecture seule le 2026-07-16) : les
// contraintes CHECK prix_source_check et alias_produits_origine_check
// n'autorisent PAS la valeur 'migration_legacy'. Une migration SQL séparée
// (élargissement des deux contraintes) doit être appliquée AVANT tout
// --confirmer, sinon chaque insertion échouera proprement (jamais de
// corruption silencieuse, juste une erreur). Voir prepare-constraints.sql.
// ============================================================================

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { resoudreFamilleEtCoefficient, calculerPrixReference } from '../src/lib/unitesCore.js';
import { genererSlug, similariteTexte } from './import-drive-csv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// Constantes métier (décisions tranchées avec François, 2026-07-16)
// ----------------------------------------------------------------------------
const SOURCE_PRIX = 'migration_legacy';           // prix.source — nécessite l'élargissement de contrainte
const ORIGINE_ALIAS = 'migration_legacy';         // alias_produits.origine — idem
const SOURCE_MAGASIN = 'migration';               // magasins.source — déjà autorisé, aucun changement requis
const SOUS_CATEGORIE_A_RECLASSER_ID = 'cba4251f-28b5-4f0d-bfb6-70af5c802205'; // "À reclasser (import Drive)", déjà existante — réutilisée telle quelle
const SEUIL_SIMILARITE_DOUBLON = 0.82;

// Seuils prix aberrant (mêmes bornes que le diagnostic ÉTAPE 1)
const PRIX_UNITAIRE_MAX = 50;   // €/kg ou €/L
const PRIX_UNITAIRE_MIN = 0.05;
const PRIX_TOTAL_MAX = 200;     // garde-fou absolu, toutes lignes
const PRIX_TOTAL_MIN = 0.01;

// Dates non fiables (diagnostic ÉTAPE 1 : 2018/2019 et 2067 alors que l'app
// n'existe que depuis 2026) → date de repli = date de migration (aujourd'hui),
// décision validée avec François plutôt que d'exclure ces lignes.
const DATE_MIN_PLAUSIBLE = new Date('2020-01-01T00:00:00Z');
const DATE_MAX_PLAUSIBLE = new Date('2026-12-31T23:59:59Z');
const DATE_REPLI_ABERRANTE = new Date().toISOString();

// ----------------------------------------------------------------------------
// Pont stores (legacy) → magasins (Core), construit à partir du diagnostic
// exhaustif ÉTAPE 1 (tous les store_id distincts vus dans price_db et
// community_prices ont été revus manuellement — jamais de correspondance
// devinée automatiquement). Un store_id absent des DEUX tables ci-dessous
// est explicitement rejeté (motif 'magasin_non_reconnu'), jamais deviné.
// ----------------------------------------------------------------------------
const STORE_ID_VERS_MAGASIN = {
  'c9dcd7a0-7b02-461c-9dc3-eeb36c5c41b3': 'a1000004-0000-0000-0000-000000000004', // Carrefour, 112 Av. de Hambourg
  '20dca58a-91fe-4902-a8ad-746042f8e240': 'a1000007-0000-0000-0000-000000000007', // Leclerc Sormiou
  'e4350c1b-39ce-41d3-a4c6-edccc244ffe1': 'a1000007-0000-0000-0000-000000000007', // idem, variante d'adresse
  'e39c2e17-f9fa-4b0d-81e9-2fb6a2ad8ec0': 'a1000007-0000-0000-0000-000000000007', // idem
  'ba832612-96dd-4fe0-b3ae-ac06688134af': 'a1000007-0000-0000-0000-000000000007', // idem
  'f412c7ce-90c6-4e8d-a47c-92ef996207d3': 'a1000008-0000-0000-0000-000000000008', // Leclerc Les Sablettes
  'e648f3f4-97a5-486f-bec7-b245b3764cb0': 'a1000009-0000-0000-0000-000000000009', // Lidl, Pointe Rouge
  'c42e3f20-ce8a-4937-90f6-02a6bd1489c8': 'a1000002-0000-0000-0000-000000000002', // Carrefour, 633 Av. de Mazargues
  '21edf731-4478-49ab-80e0-b38ac2816002': 'a1000012-0000-0000-0000-000000000012', // U Express, Chutes Lavie
  'b4be9033-7dc1-48ea-a2bc-48858a195a5e': 'a1000012-0000-0000-0000-000000000012', // idem, doublon interne à `stores`
  '022d11dd-d26c-46bf-8828-bf6acaa88872': 'a1000012-0000-0000-0000-000000000012', // idem
  'e0b872cf-2e71-49c0-986c-3c219899b1fe': 'a1000012-0000-0000-0000-000000000012', // idem
  '30b52223-a50f-4f7f-aeff-dd7dd7f08e42': 'a1000012-0000-0000-0000-000000000012', // idem
  '3c7ed9f1-112b-47d8-8cbf-c4dbfbaee955': 'a1000006-0000-0000-0000-000000000006', // Intermarché, Bd Marcel Delprat
  '544e7918-d5a0-4123-9e3c-2fd34fa819c0': 'a1000011-0000-0000-0000-000000000011', // Netto, Nouveau Parc Sévigné
  '35709add-6c53-4f23-a8cc-9351a80b0b87': 'a1000001-0000-0000-0000-000000000001', // Utile, Sanary (5 rue Giboin)
  'cf7b4fce-443d-4d9d-96dd-9e1d8cca6f98': 'a1000001-0000-0000-0000-000000000001', // idem, enseigne='autre' en legacy
  'c7a8fd25-06e7-49f2-80dc-e5e11547d7f3': 'a1000001-0000-0000-0000-000000000001', // idem
  '9e463f6f-fef4-42c2-b5c5-12d4dc0d74a1': 'a1000001-0000-0000-0000-000000000001', // même adresse, mal étiqueté "U Express" en legacy
  'd4942b77-6c78-4c74-9b90-3edd41c56a1d': 'a1000001-0000-0000-0000-000000000001', // même adresse, mal étiqueté "Lidl" en legacy
  '4d69efb3-68f5-4ad5-a5fd-f40fde2bc86d': 'a1000014-0000-0000-0000-000000000014', // Vival, 76 Traverse Tiboulen
  '75e3c649-ca58-4b21-8a4f-61c4f2f73a2b': 'a1000005-0000-0000-0000-000000000005', // Franprix, 110 Bd de Paris
  '8ad91c3c-7021-432f-9e10-49da964f3dec': 'a1000010-0000-0000-0000-000000000010', // Lidl, 595 Av. du Prado
  'fcec5b71-b78b-47fe-81de-ed123fe47c2d': 'a1000003-0000-0000-0000-000000000003', // Carrefour Express, 8 Pl. Claude Bernard
};

// store_id (legacy) qui n'ont AUCUNE correspondance dans magasins — un seul
// nouveau magasin physique en résulte (les 3 store_id ci-dessous désignent
// tous la même adresse "Marseille B. Bienvenue", jamais géocodée précisément
// dans les données legacy). Créé une seule fois, réutilisé pour les 3.
const NOUVEAU_MAGASIN_BIENVENUE = {
  cle: 'carrefour_bienvenue',
  enseigneNom: 'Carrefour',
  nom: 'Carrefour',
  adresse: 'Marseille B. Bienvenue (adresse précise à confirmer)',
  ville: 'Marseille',
};
const STORE_ID_VERS_NOUVEAU_MAGASIN = {
  'a121f7de-fdb9-47dd-bef7-40a4cebf502f': NOUVEAU_MAGASIN_BIENVENUE,
  '52602bf7-3279-4d9d-b436-4ee9ed6cb5b7': NOUVEAU_MAGASIN_BIENVENUE,
  'a8c46c48-b195-44c9-afd0-1708a143da6b': NOUVEAU_MAGASIN_BIENVENUE,
};

// store_id vus dans le diagnostic mais volontairement EXCLUS de tout mapping
// (adresses suspectes, jamais recoupées ailleurs, ou hors zone Marseille) —
// rejetés explicitement plutôt que rattachés par supposition.
const STORE_ID_A_VERIFIER = new Set([
  'b2918e2c-b1cf-44fc-91ab-6bb817f7f209', // "25 Avenue du Général Louis Grout" — rue introuvable, jamais vue ailleurs
  'b1d2f036-6893-4dc1-b9e6-42322aa727d0', // "26 Avenue des Chênes Libres" — idem
  '46e0d037-d922-4249-aabb-c6160cb13fdd', // Houilles (78800) — hors zone Marseille
]);

// Ancres d'adresse (texte normalisé) pour les lignes SANS store_id exploitable
// (community_prices : store_id NULL ou orphelin). Une ancre = une sous-chaîne
// suffisamment spécifique pour identifier un magasin sans ambiguïté. Toute
// adresse ne contenant aucune ancre connue est rejetée (motif
// 'adresse_non_reconnue'), jamais devinée par proximité floue.
const ANCRES_ADRESSE = [
  { ancre: 'BAOU DE SORMIOU', magasinId: 'a1000007-0000-0000-0000-000000000007' },
  { ancre: 'SABLETTES', magasinId: 'a1000008-0000-0000-0000-000000000008' },
  { ancre: 'POINTE ROUGE', magasinId: 'a1000009-0000-0000-0000-000000000009' },
  { ancre: 'AVENUE DU PRADO', magasinId: 'a1000010-0000-0000-0000-000000000010' },
  { ancre: 'MAZARGUES', magasinId: 'a1000002-0000-0000-0000-000000000002' },
  { ancre: 'HAMBOURG', magasinId: 'a1000004-0000-0000-0000-000000000004' },
  { ancre: 'CLAUDE BERNARD', magasinId: 'a1000003-0000-0000-0000-000000000003' },
  { ancre: 'CHUTES LAVIE', magasinId: 'a1000012-0000-0000-0000-000000000012' },
  { ancre: 'MARCEL DELPRAT', magasinId: 'a1000006-0000-0000-0000-000000000006' },
  { ancre: 'SEVIGNE', magasinId: 'a1000011-0000-0000-0000-000000000011' }, // unaccent() appliqué avant comparaison
  { ancre: 'GIBOIN', magasinId: 'a1000001-0000-0000-0000-000000000001' },  // couvre aussi "Gibboin" (double b) via inclusion
  { ancre: 'TIBOULEN', magasinId: 'a1000014-0000-0000-0000-000000000014' }, // couvre aussi "Tiroulen" (coquille OCR) — voir normaliserAdresse
  { ancre: 'BD DE PARIS', magasinId: 'a1000005-0000-0000-0000-000000000005' },
  { ancre: 'BIENVENUE', magasinId: null, nouveauMagasin: NOUVEAU_MAGASIN_BIENVENUE }, // nouveau magasin
  // "Marseille B" tronqué (OCR) — vu 28 fois en community_prices, jamais associé
  // à autre chose que Carrefour Bienvenue dans le diagnostic exhaustif ÉTAPE 1 ;
  // vérifié qu'aucune autre adresse connue ne contient "MARSEILLE B" en substring.
  { ancre: 'MARSEILLE B', magasinId: null, nouveauMagasin: NOUVEAU_MAGASIN_BIENVENUE },
];

// ----------------------------------------------------------------------------
// Chargement minimal de scripts/.env (identique à import-drive-csv.js)
// ----------------------------------------------------------------------------
function chargerEnvLocal() {
  const cheminEnv = join(__dirname, '.env');
  if (!existsSync(cheminEnv)) {
    console.error(`Fichier introuvable : ${cheminEnv}\nCopie scripts/.env.example vers scripts/.env et renseigne tes clés.`);
    process.exit(1);
  }
  const contenu = readFileSync(cheminEnv, 'utf8');
  for (const ligne of contenu.split('\n')) {
    const l = ligne.trim();
    if (!l || l.startsWith('#')) continue;
    const idx = l.indexOf('=');
    if (idx === -1) continue;
    const cle = l.slice(0, idx).trim();
    const valeur = l.slice(idx + 1).trim();
    if (!(cle in process.env)) process.env[cle] = valeur;
  }
}

// ----------------------------------------------------------------------------
// Normalisation adresse (pour le matching par ancres)
// ----------------------------------------------------------------------------
export function normaliserAdresse(texte) {
  return String(texte || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // unaccent
    .replace(/TIROULEN/g, 'TIBOULEN') // coquille OCR récurrente, vue en diagnostic
    .replace(/ROVDIS/g, 'ROYDIS')     // idem
    .replace(/GIBBOIN/g, 'GIBOIN')    // idem
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ----------------------------------------------------------------------------
// Résolution du magasin pour une ligne (price_db ou community_prices)
// Retourne { statut: 'existant', magasinId } | { statut: 'nouveau', ... } |
// { statut: 'non_reconnu', motif }
// ----------------------------------------------------------------------------
export function resoudreMagasinLegacy(ligne, storesParId) {
  const storeId = ligne.store_id ? String(ligne.store_id) : null;

  if (storeId) {
    if (STORE_ID_A_VERIFIER.has(storeId)) {
      return { statut: 'non_reconnu', motif: `store_id "${storeId}" en zone d'incertitude (adresse jamais recoupée) — à vérifier manuellement` };
    }
    if (STORE_ID_VERS_MAGASIN[storeId]) {
      return { statut: 'existant', magasinId: STORE_ID_VERS_MAGASIN[storeId] };
    }
    if (STORE_ID_VERS_NOUVEAU_MAGASIN[storeId]) {
      return { statut: 'nouveau', nouveauMagasin: STORE_ID_VERS_NOUVEAU_MAGASIN[storeId] };
    }
    // store_id présent mais absent de `stores` (orphelin) ou absent de nos
    // deux tables de correspondance : on retente par adresse texte ci-dessous
    // plutôt que de rejeter tout de suite, `stores` peut quand même avoir
    // l'adresse utile pour l'ancrage.
    const storeLegacy = storesParId.get(storeId);
    if (storeLegacy?.address) {
      const parAncre = resoudreParAncre(storeLegacy.address);
      if (parAncre) return parAncre;
    }
  }

  const adresseBrute = ligne.store_address || '';
  if (adresseBrute) {
    const parAncre = resoudreParAncre(adresseBrute);
    if (parAncre) return parAncre;
  }

  return { statut: 'non_reconnu', motif: `aucune ancre d'adresse reconnue (store_id="${storeId || ''}", adresse="${adresseBrute}")` };
}

function resoudreParAncre(adresseBrute) {
  const normalisee = normaliserAdresse(adresseBrute);
  for (const { ancre, magasinId, nouveauMagasin } of ANCRES_ADRESSE) {
    if (normalisee.includes(ancre)) {
      return nouveauMagasin ? { statut: 'nouveau', nouveauMagasin } : { statut: 'existant', magasinId };
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Construction du nom_produit (parade taille) + résolution format/quantité
// ----------------------------------------------------------------------------
export function construireNomProduit(product, format) {
  const p = String(product || '').trim();
  const f = String(format || '').trim();
  if (!f) return p;
  // Évite les doublons de mention si le format est déjà inclus dans product
  // (arrive dans certains lots où nom_produit embarque déjà la taille).
  if (normaliserAdresse(p).includes(normaliserAdresse(f))) return p;
  return `${p} ${f}`.trim();
}

// price_db a déjà quantite/unite/conditionnement structurés — pas de parsing
// libre nécessaire, on réutilise resoudreFamilleEtCoefficient comme le script
// CSV Drive.
export function resoudreFormatPriceDb(ligne) {
  const unite = String(ligne.unite || '').trim();
  const resolution = resoudreFamilleEtCoefficient(unite);
  if (resolution.exclusion) return { exclusion: `unite_inconnue ("${unite}")` };
  const quantiteNette = Number(ligne.quantite);
  const nombreUnites = Number(ligne.conditionnement) || 1;
  if (!Number.isFinite(quantiteNette) || quantiteNette <= 0) return { exclusion: 'quantite_invalide' };
  return {
    typeUnite: resolution.famille,
    uniteBase: unite.toLowerCase(),
    quantiteNette,
    uniteQuantite: unite.toLowerCase(),
    nombreUnites,
  };
}

// community_prices n'a que `format` en texte libre. Parsing conservateur :
// un seul nombre + une seule unité reconnue, multipack "N x" ou "x N" simple.
// Tout le reste (formats composites, pourcentages, codes internes) est
// explicitement rejeté — jamais deviné.
export function analyserFormatCommunaute(format) {
  const texte = String(format || '').trim().toLowerCase().replace(',', '.');
  if (!texte) return { exclusion: 'format_vide' };

  const multipack = texte.match(/^(\d+)\s*x\s*(.+)$/) || texte.match(/^(.+?)\s*x\s*(\d+)$/);
  let nombreUnites = 1;
  let reste = texte;
  if (multipack) {
    const [, a, b] = multipack;
    if (/^\d+$/.test(a)) { nombreUnites = Number(a); reste = b; }
    else { nombreUnites = Number(b); reste = a; }
  }

  const m = reste.trim().match(/^(\d+(?:\.\d+)?)\s*(kg|g|l|cl|ml)$/);
  if (!m) return { exclusion: `format_non_parsable ("${format}")` };

  const [, quantiteTexte, unite] = m;
  const resolution = resoudreFamilleEtCoefficient(unite);
  if (resolution.exclusion) return { exclusion: `unite_inconnue ("${unite}")` };

  return {
    typeUnite: resolution.famille,
    uniteBase: unite,
    quantiteNette: Number(quantiteTexte),
    uniteQuantite: unite,
    nombreUnites,
  };
}

// ----------------------------------------------------------------------------
// Résolution d'une ligne (partagée aperçu/confirmer), aucune écriture ici.
// ----------------------------------------------------------------------------
async function resoudreLigne(supabase, ligne, { source, storesParId }) {
  const prixTotal = Number(ligne.price ?? ligne.prix_total);
  if (!Number.isFinite(prixTotal) || prixTotal < PRIX_TOTAL_MIN || prixTotal > PRIX_TOTAL_MAX) {
    return { statut: 'rejetee', motif: `prix_total hors bornes (${prixTotal})` };
  }

  // Prix aberrant €/kg-L : uniquement vérifiable directement sur price_db
  // (colonne prix_unitaire déjà calculée en amont).
  if (source === 'price_db') {
    const pu = ligne.prix_unitaire == null ? null : Number(ligne.prix_unitaire);
    if (pu != null && Number.isFinite(pu) && (pu > PRIX_UNITAIRE_MAX || pu < PRIX_UNITAIRE_MIN)) {
      return { statut: 'rejetee', motif: `prix_unitaire aberrant (${pu} €/kg ou €/L)` };
    }
  }

  const dateBrute = ligne.date_observation; // déjà résolue par l'appelant (date ou created_at)
  const d = new Date(dateBrute);
  const dateHorsBornes = Number.isNaN(d.getTime()) || d < DATE_MIN_PLAUSIBLE || d > DATE_MAX_PLAUSIBLE;
  const dateObservation = dateHorsBornes ? DATE_REPLI_ABERRANTE : d.toISOString();

  const resolutionMagasin = resoudreMagasinLegacy(ligne, storesParId);
  if (resolutionMagasin.statut === 'non_reconnu') {
    return { statut: 'rejetee', motif: `magasin_non_reconnu : ${resolutionMagasin.motif}` };
  }

  const nomProduit = construireNomProduit(ligne.product, ligne.format);
  if (!nomProduit) return { statut: 'rejetee', motif: 'product vide' };

  const { data: correspondances, error: erreurAlias } = await supabase
    .rpc('resoudre_alias_core', { p_libelle: nomProduit });
  if (erreurAlias) {
    throw new Error(`resoudre_alias_core a échoué pour "${nomProduit}" : ${erreurAlias.message}`);
  }

  const base = { prixTotal, dateObservation, dateEtaitAberrante: dateHorsBornes, resolutionMagasin, nomProduit, source, ligneId: ligne.id };

  if (correspondances && correspondances.length === 1) {
    return {
      ...base, statut: 'match_existant',
      produitId: correspondances[0].produit_id,
      varianteProduitId: correspondances[0].variante_produit_id,
    };
  }

  const resolutionFormat = source === 'price_db'
    ? resoudreFormatPriceDb(ligne)
    : analyserFormatCommunaute(ligne.format);
  if (resolutionFormat.exclusion) {
    return { statut: 'rejetee', motif: `nouveau produit impossible : ${resolutionFormat.exclusion}` };
  }

  // Garde-fou prix aberrant pour un NOUVEAU produit communauté (pas de
  // prix_unitaire précalculé, on le dérive du format qu'on vient de parser).
  if (source === 'community_prices') {
    const ref = calculerPrixReference({
      prix_total: prixTotal,
      quantite_nette: resolutionFormat.quantiteNette,
      unite_quantite: resolutionFormat.uniteQuantite,
      nombre_unites: resolutionFormat.nombreUnites,
      type_unite: resolutionFormat.typeUnite,
    });
    if (!ref.exclusion && ref.famille !== 'piece' && (ref.prix_reference > PRIX_UNITAIRE_MAX || ref.prix_reference < PRIX_UNITAIRE_MIN)) {
      return { statut: 'rejetee', motif: `prix_reference aberrant (${ref.prix_reference.toFixed(2)} €/${ref.unite})` };
    }
  }

  return { ...base, statut: 'nouveau_produit', resolutionFormat };
}

// ----------------------------------------------------------------------------
// Anti-doublon (dedup interne aux deux tables + vs prix déjà migrés)
// ----------------------------------------------------------------------------
function cleDedupInterne(ligne, source) {
  const magasinCle = ligne.store_id || ligne.store_address || '';
  if (source === 'price_db') {
    return ['price_db', ligne.product, ligne.format, magasinCle, ligne.price, ligne.date].join('|');
  }
  return ['community_prices', ligne.product, ligne.brand, ligne.format, magasinCle, ligne.price, ligne.date].join('|');
}

async function prixMigrationDejaPresent(supabase, { produitId, varianteProduitId, magasinId, prixTotal, dateObservation }) {
  let requete = supabase.from('prix').select('id')
    .eq('produit_id', produitId)
    .eq('magasin_id', magasinId)
    .eq('prix_total', prixTotal)
    .eq('observe_le', dateObservation)
    .eq('source', SOURCE_PRIX);
  requete = varianteProduitId == null ? requete.is('variante_produit_id', null) : requete.eq('variante_produit_id', varianteProduitId);
  const { data, error } = await requete.maybeSingle();
  if (error) throw new Error(`Vérification anti-doublon échouée : ${error.message}`);
  return !!data;
}

// ----------------------------------------------------------------------------
// Écriture réelle (mode --confirmer). Pas de vraie transaction Postgres
// disponible (le script ne dispose que de la clé service_role via l'API REST,
// pas d'un accès Postgres direct) : la garantie « transaction + garde-fou »
// est obtenue autrement — chaque id créé est journalisé dans `creations`, et
// si le compte final de prix insérés ne correspond pas à celui attendu (une
// passe de résolution à blanc juste avant écriture), TOUT ce qui a été créé
// dans cette exécution est supprimé avant de rendre la main (voir
// `supprimerCreations`). Rien n'est donc jamais laissé dans un état
// intermédiaire incohérent, même sans BEGIN/COMMIT réel.
// ----------------------------------------------------------------------------
async function assurerMagasinBienvenue(supabase, nouveauMagasin, creations) {
  const { data: enseigne, error: eErr } = await supabase
    .from('enseignes').select('id').eq('nom', nouveauMagasin.enseigneNom).maybeSingle();
  if (eErr) throw new Error(`Lecture enseigne "${nouveauMagasin.enseigneNom}" échouée : ${eErr.message}`);
  if (!enseigne) throw new Error(`Enseigne "${nouveauMagasin.enseigneNom}" introuvable — ne peut pas créer le magasin`);

  const { data: existant, error: exErr } = await supabase
    .from('magasins').select('id').eq('enseigne_id', enseigne.id).eq('adresse', nouveauMagasin.adresse).maybeSingle();
  if (exErr) throw new Error(`Vérification magasin existant échouée : ${exErr.message}`);
  if (existant) return existant.id; // idempotent : relance après un run partiel

  const { data, error } = await supabase.from('magasins').insert({
    enseigne_id: enseigne.id, nom: nouveauMagasin.nom, adresse: nouveauMagasin.adresse,
    ville: nouveauMagasin.ville, statut: 'actif', source: SOURCE_MAGASIN,
  }).select('id').single();
  if (error) throw new Error(`Création magasin "${nouveauMagasin.nom}" échouée : ${error.message}`);
  creations.magasins.push(data.id);
  return data.id;
}

async function ecrireNouveauProduitMigration(supabase, { nomProduit, resolutionFormat }, creations) {
  const slugBase = genererSlug(nomProduit);
  let slug = slugBase, tentative = 1, produit = null;
  while (!produit) {
    const { data, error } = await supabase.from('produits').insert({
      sous_categorie_id: SOUS_CATEGORIE_A_RECLASSER_ID,
      nom_reference: nomProduit, slug,
      type_unite: resolutionFormat.typeUnite, unite_base: resolutionFormat.uniteBase,
    }).select('id').single();
    if (!error) { produit = data; break; }
    const collisionSlug = error.code === '23505' && /produits_slug_key/.test(error.message || '');
    if (!collisionSlug) throw new Error(`Création produit "${nomProduit}" échouée : ${error.message}`);
    tentative += 1;
    if (tentative > 20) throw new Error(`Slug unique introuvable pour "${nomProduit}" après 20 tentatives.`);
    slug = `${slugBase}-${tentative}`;
  }
  creations.produits.push(produit.id);

  const { data: variante, error: eVar } = await supabase.from('variantes_produit').insert({
    produit_id: produit.id, quantite_nette: resolutionFormat.quantiteNette,
    unite_quantite: resolutionFormat.uniteQuantite, nombre_unites: resolutionFormat.nombreUnites, libelle: null,
  }).select('id').single();
  if (eVar) throw new Error(`Création variante pour "${nomProduit}" échouée : ${eVar.message}`);
  creations.variantes.push(variante.id);

  const { data: alias, error: eAlias } = await supabase.from('alias_produits').insert({
    libelle_alias: nomProduit, produit_id: produit.id, variante_produit_id: variante.id,
    origine: ORIGINE_ALIAS, statut: 'actif',
  }).select('id').single();
  if (eAlias) throw new Error(`Création alias pour "${nomProduit}" échouée : ${eAlias.message}`);
  creations.alias.push(alias.id);

  return { produitId: produit.id, varianteProduitId: variante.id };
}

async function ecrirePrixMigration(supabase, { produitId, varianteProduitId, magasinId, prixTotal, dateObservation }, creations) {
  const { data, error } = await supabase.from('prix').insert({
    produit_id: produitId, variante_produit_id: varianteProduitId, magasin_id: magasinId,
    prix_total: prixTotal, source: SOURCE_PRIX, statut_validation: 'en_attente', observe_le: dateObservation,
  }).select('id').single();
  if (error) throw new Error(`Insertion prix échouée : ${error.message}`);
  creations.prix.push(data.id);
  return data.id;
}

// Incident du 2026-07-16 : un .delete().in('id', [...1239 ids...]) en un seul
// appel a dépassé une limite de taille d'URL côté API REST et a échoué
// SILENCIEUSEMENT (le code ne vérifiait pas l'erreur de retour) — rollback
// partiel, nettoyage manuel nécessaire ensuite. Corrigé : lots de taille
// bornée + vérification systématique de l'erreur de chaque appel.
const TAILLE_LOT_SUPPRESSION = 150;

async function supprimerParLots(supabase, table, ids, colonne = 'id') {
  let supprimes = 0;
  for (let i = 0; i < ids.length; i += TAILLE_LOT_SUPPRESSION) {
    const lot = ids.slice(i, i + TAILLE_LOT_SUPPRESSION);
    const { error, count } = await supabase.from(table).delete({ count: 'exact' }).in(colonne, lot);
    if (error) throw new Error(`Suppression ${table} (lot ${i}-${i + lot.length}) échouée : ${error.message}`);
    supprimes += count ?? lot.length;
  }
  return supprimes;
}

async function supprimerCreations(supabase, creations) {
  console.log('\n🔴 ROLLBACK — suppression de tout ce qui a été créé dans cette exécution...');
  // prix d'abord : scopé par source (pas de liste d'ID → aucune limite de
  // taille possible), et lève les verrous de clé étrangère pour la suite.
  const { error: eSource, count: nPrix } = await supabase.from('prix').delete({ count: 'exact' }).eq('source', SOURCE_PRIX);
  if (eSource) throw new Error(`Suppression prix (source=${SOURCE_PRIX}) échouée : ${eSource.message}`);

  const nAlias = creations.alias.length ? await supprimerParLots(supabase, 'alias_produits', creations.alias) : 0;
  const nVariantes = creations.variantes.length ? await supprimerParLots(supabase, 'variantes_produit', creations.variantes) : 0;
  const nProduits = creations.produits.length ? await supprimerParLots(supabase, 'produits', creations.produits) : 0;
  const nMagasins = creations.magasins.length ? await supprimerParLots(supabase, 'magasins', creations.magasins) : 0;

  console.log(`   Supprimés : ${nPrix ?? 0} prix, ${nAlias} alias, ${nVariantes} variantes, ${nProduits} produits, ${nMagasins} magasins.`);

  if (nAlias !== creations.alias.length || nVariantes !== creations.variantes.length || nProduits !== creations.produits.length || nMagasins !== creations.magasins.length) {
    throw new Error('ROLLBACK INCOMPLET : le nombre de lignes supprimées ne correspond pas au nombre créé — vérifier manuellement avant de relancer.');
  }
}

// ----------------------------------------------------------------------------
// Boucle unifiée aperçu/confirmer — en mode confirmer, re-résout l'alias juste
// avant écriture (capte les alias créés plus tôt DANS la même exécution :
// deux lignes identiques du lot n'engendrent qu'un seul produit).
// ----------------------------------------------------------------------------
async function traiterToutesLesLignes(supabase, toutesLesLignes, { ecrire, produitsExistants }) {
  const compteurs = {
    lignesTotales: 0, dejaVuesInterne: 0, rejetees: 0, matchExistant: 0,
    nouveauxProduits: 0, nouveauxMagasins: new Set(), datesAberrantesCorrigees: 0, prixInseres: 0,
  };
  const motifsRejet = {};
  const nouveauxCandidats = [];
  const cleDejaVues = new Set();
  const erreurs = [];
  const creations = { magasins: [], produits: [], variantes: [], alias: [], prix: [] };

  for (const { ligne, source, storesParId } of toutesLesLignes) {
    compteurs.lignesTotales++;

    const cle = cleDedupInterne(ligne, source);
    if (cleDejaVues.has(cle)) { compteurs.dejaVuesInterne++; continue; }
    cleDejaVues.add(cle);

    let resolution;
    try {
      resolution = await resoudreLigne(supabase, ligne, { source, storesParId });
    } catch (e) {
      erreurs.push(`[${source}#${ligne.id}] ${e.message}`);
      continue;
    }

    if (resolution.statut === 'rejetee') {
      compteurs.rejetees++;
      const cleMotif = resolution.motif.split(' (')[0].split(' :')[0];
      motifsRejet[cleMotif] = (motifsRejet[cleMotif] || 0) + 1;
      continue;
    }

    if (resolution.dateEtaitAberrante) compteurs.datesAberrantesCorrigees++;

    try {
      let magasinId = null;
      if (resolution.resolutionMagasin.statut === 'existant') {
        magasinId = resolution.resolutionMagasin.magasinId;
      } else {
        compteurs.nouveauxMagasins.add(resolution.resolutionMagasin.nouveauMagasin.cle);
        if (ecrire) magasinId = await assurerMagasinBienvenue(supabase, resolution.resolutionMagasin.nouveauMagasin, creations);
      }

      let produitId, varianteProduitId;
      if (resolution.statut === 'match_existant') {
        produitId = resolution.produitId; varianteProduitId = resolution.varianteProduitId;
        compteurs.matchExistant++;
      } else {
        // Nouveau produit — en écriture, retente resoudre_alias_core juste
        // avant de créer (un doublon interne au lot déjà traité plus tôt dans
        // cette exécution converge ici vers match_existant, au lieu de créer
        // deux fois le même produit pour deux lignes identiques du lot).
        nouveauxCandidats.push(resolution.nomProduit);
        if (!ecrire) {
          compteurs.nouveauxProduits++; // aperçu : pas de convergence possible sans écrire
        } else {
          const { data: recheck, error: eRecheck } = await supabase.rpc('resoudre_alias_core', { p_libelle: resolution.nomProduit });
          if (eRecheck) throw new Error(`resoudre_alias_core (retente) a échoué : ${eRecheck.message}`);
          if (recheck && recheck.length === 1) {
            produitId = recheck[0].produit_id; varianteProduitId = recheck[0].variante_produit_id;
            compteurs.matchExistant++;
          } else {
            const cree = await ecrireNouveauProduitMigration(supabase, resolution, creations);
            produitId = cree.produitId; varianteProduitId = cree.varianteProduitId;
            compteurs.nouveauxProduits++;
          }
        }
      }

      if (ecrire && magasinId && produitId) {
        const dejaLa = await prixMigrationDejaPresent(supabase, { produitId, varianteProduitId, magasinId, prixTotal: resolution.prixTotal, dateObservation: resolution.dateObservation });
        if (dejaLa) { compteurs.dejaVuesInterne++; continue; }
        await ecrirePrixMigration(supabase, { produitId, varianteProduitId, magasinId, prixTotal: resolution.prixTotal, dateObservation: resolution.dateObservation }, creations);
        compteurs.prixInseres++;
      } else if (!ecrire) {
        compteurs.prixInseres++; // décompte prévisionnel en aperçu
      }
    } catch (e) {
      erreurs.push(`[${source}#${ligne.id}] ${e.message}`);
      if (ecrire) { await supprimerCreations(supabase, creations); throw new Error(`Écriture interrompue par une erreur, rollback effectué : ${e.message}`); }
    }
  }

  const paireSuspectes = [];
  for (const candidat of new Set(nouveauxCandidats)) {
    for (const existant of produitsExistants || []) {
      const score = similariteTexte(candidat, existant.nom_reference);
      if (score >= SEUIL_SIMILARITE_DOUBLON) paireSuspectes.push({ candidat, existant: existant.nom_reference, score: score.toFixed(2) });
    }
  }

  return { compteurs, motifsRejet, paireSuspectes, erreurs, creations };
}

// ----------------------------------------------------------------------------
// Chargement des lignes source
// ----------------------------------------------------------------------------
// PostgREST limite chaque requête à 1000 lignes par défaut — indispensable de
// paginer, sans quoi price_db/community_prices/produits (1297 lignes) sont
// silencieusement tronqués (bug rencontré et corrigé lors de l'aperçu du
// 2026-07-16 : total lu 1730 au lieu de 1927 attendu).
async function chargerTout(supabase, table, colonnes = '*') {
  const TAILLE_PAGE = 1000;
  let toutes = [];
  let depart = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select(colonnes).range(depart, depart + TAILLE_PAGE - 1);
    if (error) throw new Error(`Lecture ${table} échouée : ${error.message}`);
    toutes = toutes.concat(data || []);
    if (!data || data.length < TAILLE_PAGE) break;
    depart += TAILLE_PAGE;
  }
  return toutes;
}

async function chargerToutesLesLignes(supabase) {
  const lignesPriceDb = await chargerTout(supabase, 'price_db');
  const lignesCommunaute = await chargerTout(supabase, 'community_prices');
  const stores = await chargerTout(supabase, 'stores', 'id, enseigne, address, name');
  const storesParId = new Map((stores || []).map(s => [String(s.id), s]));

  const priceDbNormalisees = (lignesPriceDb || []).map(l => ({ ...l, date_observation: l.date }));
  const communauteNormalisees = (lignesCommunaute || []).map(l => ({ ...l, date_observation: l.created_at }));

  return { priceDbNormalisees, communauteNormalisees, storesParId };
}

function afficherRapport(titre, resultat) {
  const { compteurs, motifsRejet, paireSuspectes, erreurs } = resultat;
  console.log(`--- ${titre} ---`);
  console.log(`Lignes lues (price_db + community_prices)     : ${compteurs.lignesTotales}`);
  console.log(`Doublons internes ignorés                     : ${compteurs.dejaVuesInterne}`);
  console.log(`Lignes rejetées                                : ${compteurs.rejetees}`);
  for (const [motif, n] of Object.entries(motifsRejet).sort((a, b) => b[1] - a[1])) console.log(`  - ${motif} : ${n}`);
  console.log(`Correspondances via alias Core existant        : ${compteurs.matchExistant}`);
  console.log(`Nouveaux produits ${titre.includes('RÉEL') ? 'créés' : 'à créer'}                : ${compteurs.nouveauxProduits}`);
  console.log(`Nouveaux magasins ${titre.includes('RÉEL') ? 'créés' : 'à créer'}                : ${compteurs.nouveauxMagasins.size} (${[...compteurs.nouveauxMagasins].join(', ') || '—'})`);
  console.log(`Dates aberrantes corrigées (repli migration)   : ${compteurs.datesAberrantesCorrigees}`);
  console.log(`Prix ${titre.includes('RÉEL') ? 'insérés' : 'prévus'}                             : ${compteurs.prixInseres}`);
  console.log(`\nDoublons potentiels vs Core existant (similarité >= ${SEUIL_SIMILARITE_DOUBLON}) : ${paireSuspectes.length}`);
  for (const p of paireSuspectes.slice(0, 50)) console.log(`  - [${p.score}] "${p.candidat}"  ~  "${p.existant}"`);
  if (erreurs.length) {
    console.log(`\n⚠️  ${erreurs.length} erreurs rencontrées :`);
    for (const e of erreurs.slice(0, 20)) console.log(`  - ${e}`);
  }
}

// ----------------------------------------------------------------------------
// Programme principal
// ----------------------------------------------------------------------------
async function main() {
  chargerEnvLocal();

  const argv = process.argv.slice(2);
  const ecrire = argv.includes('--confirmer');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être renseignés dans scripts/.env');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  console.log(`\n${ecrire ? '=== MODE ÉCRITURE RÉELLE ===' : '=== MODE APERÇU (aucune écriture) ==='}`);

  const { priceDbNormalisees, communauteNormalisees, storesParId } = await chargerToutesLesLignes(supabase);
  const produitsExistants = await chargerTout(supabase, 'produits', 'id, nom_reference');

  const toutesLesLignes = [
    ...priceDbNormalisees.map(l => ({ ligne: l, source: 'price_db', storesParId })),
    ...communauteNormalisees.map(l => ({ ligne: l, source: 'community_prices', storesParId })),
  ];

  if (ecrire) {
    // Sauvegarde préalable hors dépôt (immuable : simple snapshot des tables
    // source, jamais modifiées par ce script) avant toute écriture.
    const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(__dirname, 'imports', `sauvegarde_avant_migration_${horodatage}.json`), JSON.stringify({
      price_db: priceDbNormalisees, community_prices: communauteNormalisees,
    }, null, 2));
    console.log(`Sauvegarde écrite : scripts/imports/sauvegarde_avant_migration_${horodatage}.json`);

    console.log('\nÉcriture réelle en cours...');
    let reel;
    try {
      reel = await traiterToutesLesLignes(supabase, toutesLesLignes, { ecrire: true, produitsExistants });
    } catch (e) {
      console.error(`\n❌ ${e.message}`);
      process.exit(1);
    }

    afficherRapport('RÉEL (après écriture)', reel);

    // Garde-fou : cohérence INTERNE du run réel lui-même (pas de comparaison
    // à un aperçu à froid — un aperçu ne peut pas voir la convergence des
    // doublons internes au lot qui se résout au fil de l'écriture, donc les
    // deux ne peuvent structurellement pas coïncider : ce n'est pas un signal
    // de problème. Le vrai invariant : chaque ligne lue dans CE run a atterri
    // dans exactement une case — rejetée, déjà présente (doublon brut ou déjà
    // en base), ou insérée. Rien ne doit manquer à l'appel.
    const c = reel.compteurs;
    const comptePasseAilleurs = c.rejetees + c.dejaVuesInterne + c.prixInseres;
    const coherent = comptePasseAilleurs === c.lignesTotales;

    if (reel.erreurs.length > 0 || !coherent) {
      console.log(`\n⚠️  Incohérence interne détectée : ${c.lignesTotales} lignes lues mais ${comptePasseAilleurs} comptabilisées (rejetées+déjà présentes+insérées), ou erreurs rencontrées.`);
      await supprimerCreations(supabase, reel.creations);
      console.log('\n❌ ROLLBACK effectué. Rien de cette migration n\'est resté en base. Préviens François avant de relancer.');
      process.exit(1);
    }
    console.log(`\n✓ Garde-fou interne OK : ${c.lignesTotales} lignes = ${c.rejetees} rejetées + ${c.dejaVuesInterne} déjà présentes + ${c.prixInseres} insérées.`);

    const horodatageJournal = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(__dirname, 'imports', `creations_migration_legacy_${horodatageJournal}.json`), JSON.stringify(reel.creations, null, 2));
    console.log(`\n✅ Migration écrite avec succès. Journal des créations : scripts/imports/creations_migration_legacy_${horodatageJournal}.json`);
    console.log(`   Rappel : statut_validation = 'en_attente' pour tous les prix insérés — invisibles tant qu'un GO VALIDATION séparé ne les passe pas en 'valide'.`);
    return;
  }

  const resultat = await traiterToutesLesLignes(supabase, toutesLesLignes, { ecrire: false, produitsExistants });
  afficherRapport('RAPPORT APERÇU', resultat);
  console.log('\nAucune donnée écrite (mode aperçu).');

  writeFileSync(join(__dirname, 'imports', `apercu_migration_legacy_${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({
    compteurs: { ...resultat.compteurs, nouveauxMagasins: [...resultat.compteurs.nouveauxMagasins] },
    motifsRejet: resultat.motifsRejet, paireSuspectes: resultat.paireSuspectes, erreurs: resultat.erreurs,
  }, null, 2));
}

const appeleDirectement = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (appeleDirectement) {
  main().catch(e => { console.error(e); process.exit(1); });
}
