#!/usr/bin/env node
// ============================================================================
// #66 — Import en masse de prix Drive (CSV → Core)
// Script autonome, exécuté localement par François via terminal. N'est JAMAIS
// appelé depuis l'app cliente. Utilise la clé service_role (contourne RLS,
// nécessaire car `prix` n'a aucune policy INSERT pour authenticated — seules
// les RPC #56.3a écrivent dedans, et elles ne savent pas créer un nouveau
// produit).
//
// Deux modes :
//   node scripts/import-drive-csv.js <fichier.csv>              → aperçu, AUCUNE écriture
//   node scripts/import-drive-csv.js <fichier.csv> --confirmer  → écriture réelle
//
// Configuration : scripts/.env (jamais commité, voir scripts/.env.example)
//   SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { resoudreFamilleEtCoefficient } from '../src/lib/unitesCore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// Constantes métier (#66 — décisions tranchées avec François)
// ----------------------------------------------------------------------------
const MAGASIN_ID_LECLERC_SORMIOU = 'a1000007-0000-0000-0000-000000000007';
const IDENTIFIANT_MAGASIN_ATTENDU = '031301';
const SOURCE_PRIX = 'import';                 // prix.source (contrainte : ticket|manuel|communaute|import)
const ORIGINE_ALIAS = 'import_drive';         // alias_produits.origine — nécessite la migration SQL fournie séparément
const CATEGORIE_IMPORT_SLUG = 'import-drive';
const CATEGORIE_IMPORT_NOM = 'Import Drive';
const SOUS_CATEGORIE_IMPORT_SLUG = 'import-drive-a-reclasser';
const SOUS_CATEGORIE_IMPORT_NOM = 'À reclasser (import Drive)';
const SEUIL_SIMILARITE_DOUBLON = 0.82;        // au-delà, on signale une paire suspecte

// ----------------------------------------------------------------------------
// Chargement minimal de scripts/.env (pas de dépendance dotenv)
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
// Parsing CSV — séparateur ';', gère le BOM UTF-8 et les champs entre guillemets
// ----------------------------------------------------------------------------
function retirerBOM(texte) {
  return texte.charCodeAt(0) === 0xFEFF ? texte.slice(1) : texte;
}

function parserLigneCsv(ligne) {
  const champs = [];
  let champ = '';
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (ligne[i + 1] === '"') { champ += '"'; i++; }
        else dansGuillemets = false;
      } else {
        champ += c;
      }
    } else if (c === '"') {
      dansGuillemets = true;
    } else if (c === ';') {
      champs.push(champ);
      champ = '';
    } else {
      champ += c;
    }
  }
  champs.push(champ);
  return champs;
}

export function parserCsv(contenuBrut) {
  const contenu = retirerBOM(contenuBrut).replace(/\r\n/g, '\n');
  const lignesBrutes = contenu.split('\n').filter(l => l.length > 0);
  if (lignesBrutes.length === 0) return [];
  const entetes = parserLigneCsv(lignesBrutes[0]).map(h => h.trim());
  return lignesBrutes.slice(1).map(ligneBrute => {
    const valeurs = parserLigneCsv(ligneBrute);
    const objet = {};
    entetes.forEach((entete, i) => { objet[entete] = valeurs[i] !== undefined ? valeurs[i] : ''; });
    return objet;
  });
}

// ----------------------------------------------------------------------------
// Utilitaires de valeur — jamais de supposition silencieuse
// ----------------------------------------------------------------------------
export function estDisponible(valeur) {
  return String(valeur).trim() === 'True';
}

export function parserPrixEuros(valeur) {
  const texte = String(valeur).trim();
  if (texte === '') return null; // Number('') vaut 0 en JS — jamais un prix valide ici
  const n = Number(texte);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parserDateReleve(valeur) {
  const v = String(valeur).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normaliserTexte(texte) {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export function genererSlug(texte) {
  return normaliserTexte(texte)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'produit';
}

// Distance de Levenshtein classique (programmation dynamique, O(n*m)).
export function distanceLevenshtein(a, b) {
  const s = normaliserTexte(a), t = normaliserTexte(b);
  const m = s.length, n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cout = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cout);
    }
  }
  return dp[m][n];
}

export function similariteTexte(a, b) {
  const maxLen = Math.max(normaliserTexte(a).length, normaliserTexte(b).length);
  if (maxLen === 0) return 1;
  return 1 - distanceLevenshtein(a, b) / maxLen;
}

// ----------------------------------------------------------------------------
// Bootstrap idempotent de la sous-catégorie fourre-tout (décision #66)
// ----------------------------------------------------------------------------
async function assurerSousCategorieImport(supabase, { ecrire }) {
  const { data: sousCatExistante } = await supabase
    .from('sous_categories').select('id').eq('slug', SOUS_CATEGORIE_IMPORT_SLUG).maybeSingle();
  if (sousCatExistante) return sousCatExistante.id;

  if (!ecrire) return null; // aperçu : ne rien créer, juste signaler l'absence

  let { data: categorie } = await supabase
    .from('categories').select('id').eq('slug', CATEGORIE_IMPORT_SLUG).maybeSingle();
  if (!categorie) {
    const { data: nouvelleCategorie, error } = await supabase
      .from('categories').insert({ nom: CATEGORIE_IMPORT_NOM, slug: CATEGORIE_IMPORT_SLUG }).select('id').single();
    if (error) throw new Error(`Création catégorie import impossible : ${error.message}`);
    categorie = nouvelleCategorie;
  }

  const { data: nouvelleSousCat, error: erreurSousCat } = await supabase
    .from('sous_categories')
    .insert({ categorie_id: categorie.id, nom: SOUS_CATEGORIE_IMPORT_NOM, slug: SOUS_CATEGORIE_IMPORT_SLUG })
    .select('id').single();
  if (erreurSousCat) throw new Error(`Création sous-catégorie import impossible : ${erreurSousCat.message}`);
  return nouvelleSousCat.id;
}

// ----------------------------------------------------------------------------
// Résolution d'une ligne (partagée aperçu/confirmer) — ne fait AUCUNE écriture
// elle-même ; retourne une description de ce qui devrait/doit se passer.
// ----------------------------------------------------------------------------
async function resoudreLigne(supabase, ligne) {
  if (!estDisponible(ligne.disponible)) {
    return { statut: 'exclue_indisponible' };
  }

  const identifiantMagasin = String(ligne.identifiant_magasin || '').trim();
  if (identifiantMagasin !== IDENTIFIANT_MAGASIN_ATTENDU) {
    return { statut: 'rejetee', motif: `identifiant_magasin inattendu (${identifiantMagasin}), mapping en dur pour ${IDENTIFIANT_MAGASIN_ATTENDU} uniquement — signalé, pas deviné` };
  }

  const prixEuros = parserPrixEuros(ligne.prix_euros);
  if (prixEuros === null) {
    return { statut: 'rejetee', motif: `prix_euros invalide ("${ligne.prix_euros}")` };
  }

  const dateObservation = parserDateReleve(ligne.date_releve);
  if (!dateObservation) {
    return { statut: 'rejetee', motif: `date_releve invalide ("${ligne.date_releve}")` };
  }

  const nomProduit = String(ligne.nom_produit || '').trim();
  if (!nomProduit) {
    return { statut: 'rejetee', motif: 'nom_produit vide' };
  }

  // Réutilise resoudre_alias_core (PHASE_12_c) — aucune logique de matching
  // parallèle. Nécessite le GRANT EXECUTE proposé séparément si ceci échoue
  // avec une erreur de permission.
  const { data: correspondances, error: erreurAlias } = await supabase
    .rpc('resoudre_alias_core', { p_libelle: nomProduit });
  if (erreurAlias) {
    throw new Error(`resoudre_alias_core a échoué pour "${nomProduit}" : ${erreurAlias.message} (vérifie le GRANT EXECUTE, voir étape 0)`);
  }

  if (correspondances && correspondances.length === 1) {
    return {
      statut: 'match_existant',
      produitId: correspondances[0].produit_id,
      varianteProduitId: correspondances[0].variante_produit_id,
      prixEuros, dateObservation, nomProduit,
      urlProduit: ligne.url_produit || null,
    };
  }

  const uniteMesureTotale = String(ligne.unite_mesure_totale || '').trim();
  const resolutionUnite = resoudreFamilleEtCoefficient(uniteMesureTotale);
  if (resolutionUnite.exclusion) {
    return { statut: 'rejetee', motif: `unite_mesure_totale inconnue ("${uniteMesureTotale}")` };
  }

  const quantiteNette = parserPrixEuros(ligne.contenance_totale); // même validation numérique
  if (quantiteNette === null) {
    return { statut: 'rejetee', motif: `contenance_totale invalide ("${ligne.contenance_totale}")` };
  }

  return {
    statut: 'nouveau_produit',
    nomProduit,
    format: ligne.format || null,
    typeUnite: resolutionUnite.famille,
    uniteBase: uniteMesureTotale.toLowerCase(),
    quantiteNette,
    uniteQuantite: uniteMesureTotale.toLowerCase(),
    prixEuros, dateObservation,
    urlProduit: ligne.url_produit || null,
  };
}

// ----------------------------------------------------------------------------
// Écriture réelle (mode --confirmer uniquement)
// ----------------------------------------------------------------------------
// Deux nom_produit distincts (ex. avec/sans apostrophe) peuvent produire le
// même slug après normalisation — collision réelle rencontrée en production
// (#66, "Sauce tomate bio Jardin Bio" vs "...Jardin Bio'"). En cas de
// violation de la contrainte unique sur slug (jamais une autre erreur), on
// retente avec un suffixe numérique croissant plutôt que de planter tout
// l'import en cours.
export async function ecrireNouveauProduit(supabase, resolution, sousCategorieId) {
  const slugBase = genererSlug(resolution.nomProduit);
  let slug = slugBase;
  let tentative = 1;
  let produit = null;

  while (!produit) {
    const { data, error } = await supabase
      .from('produits')
      .insert({
        sous_categorie_id: sousCategorieId,
        nom_reference: resolution.nomProduit,
        slug,
        type_unite: resolution.typeUnite,
        unite_base: resolution.uniteBase,
      })
      .select('id').single();

    if (!error) { produit = data; break; }

    const estCollisionSlug = error.code === '23505' && /produits_slug_key/.test(error.message || '');
    if (!estCollisionSlug) throw new Error(`Création produit "${resolution.nomProduit}" échouée : ${error.message}`);

    tentative += 1;
    if (tentative > 20) throw new Error(`Impossible de générer un slug unique pour "${resolution.nomProduit}" après 20 tentatives.`);
    slug = `${slugBase}-${tentative}`;
  }

  const { data: variante, error: erreurVariante } = await supabase
    .from('variantes_produit')
    .insert({
      produit_id: produit.id,
      quantite_nette: resolution.quantiteNette,
      unite_quantite: resolution.uniteQuantite,
      nombre_unites: 1,
      libelle: resolution.format,
    })
    .select('id').single();
  if (erreurVariante) throw new Error(`Création variante pour "${resolution.nomProduit}" échouée : ${erreurVariante.message}`);

  const { error: erreurAlias } = await supabase
    .from('alias_produits')
    .insert({
      libelle_alias: resolution.nomProduit,
      produit_id: produit.id,
      variante_produit_id: variante.id,
      origine: ORIGINE_ALIAS,
      statut: 'actif',
    });
  if (erreurAlias) throw new Error(`Création alias pour "${resolution.nomProduit}" échouée : ${erreurAlias.message}`);

  return { produitId: produit.id, varianteProduitId: variante.id };
}

// Protection anti-doublon : un prix "identique" = même produit_id +
// variante_produit_id (nul ou non) + magasin_id + observe_le + prix_total +
// source. Permet de relancer --confirmer sans risque sur un fichier déjà
// importé. Comparaison sur prix.observe_le (il n'existe pas de colonne
// date_ticket sur prix — voir étape 0).
export async function prixDejaImporte(supabase, { produitId, varianteProduitId, prixEuros, dateObservation }) {
  let requete = supabase.from('prix').select('id')
    .eq('produit_id', produitId)
    .eq('magasin_id', MAGASIN_ID_LECLERC_SORMIOU)
    .eq('prix_total', prixEuros)
    .eq('observe_le', dateObservation)
    .eq('source', SOURCE_PRIX);
  requete = varianteProduitId == null
    ? requete.is('variante_produit_id', null)
    : requete.eq('variante_produit_id', varianteProduitId);

  const { data, error } = await requete.maybeSingle();
  if (error) throw new Error(`Vérification anti-doublon échouée : ${error.message}`);
  return !!data;
}

async function ecrirePrix(supabase, { produitId, varianteProduitId, prixEuros, dateObservation, urlProduit }) {
  if (await prixDejaImporte(supabase, { produitId, varianteProduitId, prixEuros, dateObservation })) {
    return { insere: false };
  }
  const { error } = await supabase.from('prix').insert({
    produit_id: produitId,
    variante_produit_id: varianteProduitId,
    magasin_id: MAGASIN_ID_LECLERC_SORMIOU,
    prix_total: prixEuros,
    source: SOURCE_PRIX,
    statut_validation: 'en_attente',
    observe_le: dateObservation,
    url_produit: urlProduit,
  });
  if (error) throw new Error(`Insertion prix échouée : ${error.message}`);
  return { insere: true };
}

// ----------------------------------------------------------------------------
// Programme principal
// ----------------------------------------------------------------------------
async function main() {
  chargerEnvLocal();

  const argv = process.argv.slice(2);
  const ecrire = argv.includes('--confirmer');
  const cheminCsv = argv.find(a => !a.startsWith('--'));

  if (!cheminCsv) {
    console.error('Usage : node scripts/import-drive-csv.js <fichier.csv> [--confirmer]');
    process.exit(1);
  }
  if (!existsSync(cheminCsv)) {
    console.error(`Fichier introuvable : ${cheminCsv}`);
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être renseignés dans scripts/.env');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const lignesCsv = parserCsv(readFileSync(cheminCsv, 'utf8'));

  console.log(`\n${ecrire ? '=== MODE ÉCRITURE RÉELLE ===' : '=== MODE APERÇU (aucune écriture) ==='}`);
  console.log(`Fichier : ${cheminCsv}`);
  console.log(`Lignes lues : ${lignesCsv.length}\n`);

  const { data: produitsExistants } = await supabase.from('produits').select('id, nom_reference');
  const sousCategorieId = await assurerSousCategorieImport(supabase, { ecrire });

  const compteurs = { exclues: 0, rejetees: 0, matchExistant: 0, nouveauxProduits: 0, dejaImportees: 0 };
  const motifsRejet = {};
  const nouveauxCandidats = [];

  for (const ligne of lignesCsv) {
    let resolution;
    try {
      resolution = await resoudreLigne(supabase, ligne);
    } catch (e) {
      console.error(`ERREUR sur la ligne "${ligne.nom_produit}" : ${e.message}`);
      process.exit(1);
    }

    if (resolution.statut === 'exclue_indisponible') { compteurs.exclues++; continue; }
    if (resolution.statut === 'rejetee') {
      compteurs.rejetees++;
      motifsRejet[resolution.motif] = (motifsRejet[resolution.motif] || 0) + 1;
      continue;
    }

    if (resolution.statut === 'match_existant') {
      // Le produit existe déjà (via alias) : la vérification anti-doublon
      // est possible dans les DEUX modes, donc le rapport aperçu est déjà
      // exact sans avoir besoin de --confirmer.
      const dejaLa = await prixDejaImporte(supabase, resolution);
      if (dejaLa) { compteurs.dejaImportees++; continue; }
      compteurs.matchExistant++;
      if (ecrire) await ecrirePrix(supabase, resolution);
      continue;
    }

    // nouveau_produit — en aperçu, le produit n'existe pas encore : la
    // vérification anti-doublon n'a de sens qu'en écriture réelle (utile
    // si --confirmer est relancé après un run partiel).
    compteurs.nouveauxProduits++;
    nouveauxCandidats.push(resolution.nomProduit);
    if (ecrire) {
      if (!sousCategorieId) throw new Error('sous_categorie_id import introuvable en mode écriture (bug).');
      const { produitId, varianteProduitId } = await ecrireNouveauProduit(supabase, resolution, sousCategorieId);
      const { insere } = await ecrirePrix(supabase, { ...resolution, produitId, varianteProduitId });
      if (!insere) { compteurs.nouveauxProduits--; compteurs.dejaImportees++; }
    }
  }

  // Doublons potentiels : nouveaux candidats vs produits déjà en base.
  const paireSuspectes = [];
  for (const candidat of new Set(nouveauxCandidats)) {
    for (const existant of produitsExistants || []) {
      const score = similariteTexte(candidat, existant.nom_reference);
      if (score >= SEUIL_SIMILARITE_DOUBLON) {
        paireSuspectes.push({ candidat, existant: existant.nom_reference, score: score.toFixed(2) });
      }
    }
  }

  console.log('--- RAPPORT ---');
  console.log(`Lignes exclues (disponible=False)        : ${compteurs.exclues}`);
  console.log(`Lignes rejetées                          : ${compteurs.rejetees}`);
  for (const [motif, n] of Object.entries(motifsRejet)) console.log(`  - ${motif} : ${n}`);
  console.log(`Déjà importé (ignoré, anti-doublon)       : ${compteurs.dejaImportees}`);
  console.log(`Correspondances via alias existant        : ${compteurs.matchExistant}`);
  console.log(`Nouveaux produits ${ecrire ? 'créés' : 'à créer'}                : ${compteurs.nouveauxProduits}`);
  if (!sousCategorieId && !ecrire && compteurs.nouveauxProduits > 0) {
    console.log(`  (sous-catégorie "${SOUS_CATEGORIE_IMPORT_NOM}" sera créée au premier --confirmer)`);
  }
  console.log(`\nDoublons potentiels (similarité >= ${SEUIL_SIMILARITE_DOUBLON}) : ${paireSuspectes.length}`);
  for (const p of paireSuspectes) {
    console.log(`  - [${p.score}] "${p.candidat}"  ~  "${p.existant}"`);
  }
  console.log(ecrire ? '\n✅ Écriture terminée.' : '\nAucune donnée écrite (mode aperçu). Relance avec --confirmer pour écrire réellement.');
}

// Ne s'exécute que si le fichier est lancé directement (node scripts/...),
// jamais quand il est importé — notamment par les tests, qui n'importent
// que les fonctions pures ci-dessus.
const appeleDirectement = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (appeleDirectement) {
  main().catch(e => { console.error(e); process.exit(1); });
}
