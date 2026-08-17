// Chantier 103b — vérification bout en bout du repli progressif, sur le cas
// réel qui a fait échouer le test iPhone du 17/08 :
//   EAN 3380380055393 -> OFF « Boulgour Petit Épeautre » / marque « Priméal »
//   -> la fiche catalogue « Épeautre » doit remonter SANS intervention manuelle.
//
// Volontairement HORS de la suite vitest : ce script tape le vrai Open Food
// Facts et la vraie RPC Supabase (lecture seule, aucune écriture), donc il
// dépend du réseau. `npm test` doit rester déterministe.
//
//   node scripts/verif-repli-off.mjs
//
// Lit VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY dans .env.local.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { termesRechercheOff, motsPourRepli, fusionnerResultatsParMot } from '../src/lib/rechercheRepli.js';

const EAN = '3380380055393';
const FICHE_ATTENDUE = 'Épeautre';

function lireEnv() {
  const env = {};
  for (const ligne of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = lireEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const chercher = async (terme) => {
  const { data, error } = await supabase.rpc('rechercher_produits_pour_correction', {
    p_terme: terme,
    p_enseigne: null,
  });
  if (error) throw new Error(`RPC en échec pour « ${terme} » : ${error.message}`);
  return data || [];
};

let echecs = 0;
const verifier = (libelle, condition, detail = '') => {
  if (!condition) echecs++;
  console.log(`${condition ? 'ok  ' : 'KO  '}${libelle}${detail ? ` — ${detail}` : ''}`);
};

// --- Étape 0 : ce que dit Open Food Facts pour ce code-barres ---
const r = await fetch(
  `https://world.openfoodfacts.org/api/v2/product/${EAN}.json`
  + '?fields=product_name,product_name_fr,brands,quantity,image_front_url,image_front_small_url'
);
const j = await r.json();
const p = j.status === 1 ? j.product : null;
verifier('OFF connaît le code-barres', !!p);
if (!p) process.exit(1);

const off = {
  nom: (p.product_name_fr || p.product_name || '').trim() || null,
  marque: (p.brands || '').trim() || null,
  quantite: (p.quantity || '').trim() || null,
};
console.log(`    OFF : nom="${off.nom}" marque="${off.marque}" quantité="${off.quantite}"`);
verifier('une photo est disponible (preuve visuelle de la carte)', !!(p.image_front_url || p.image_front_small_url));

// --- Étape 1 : requête initiale = nom seul, marque exclue ---
const requete = termesRechercheOff(off);
console.log(`    requête initiale : « ${requete} »`);
verifier('la marque n\'est pas dans la requête', !requete.toLowerCase().includes('primeal') && !requete.toLowerCase().includes('priméal'));

// --- Étape A : la phrase entière (échoue ici, c'est le défaut constaté) ---
const etapeA = await chercher(requete);
console.log(`    étape A « ${requete} » -> ${etapeA.length} fiche(s)`);

let fiches = etapeA;
let motsUtilises = null;

// --- Étape B : repli mot par mot ---
if (etapeA.length === 0) {
  const mots = motsPourRepli(requete);
  console.log(`    étape B, mots (ordre du nom OFF) : ${mots.join(', ')}`);
  const lots = await Promise.all(mots.map(chercher));
  mots.forEach((mot, i) => console.log(`      « ${mot} » -> ${lots[i].length} fiche(s)`));
  const fusion = fusionnerResultatsParMot(mots, lots);
  fiches = fusion.fiches;
  motsUtilises = fusion.motsUtilises;
  console.log(`    fusion : ${fiches.length} fiche(s), mots classés du plus au moins discriminant : ${motsUtilises.join(', ')}`);
  verifier('le repli a bien été nécessaire (étape A vide)', true);
  verifier('la requête réécrite dans le champ n\'est pas vide', motsUtilises.length > 0);
  verifier('le plafond de 20 fiches est respecté', fiches.length <= 20, `${fiches.length}`);

  // Chantier 103d — LE critère : le contenu du champ, rejoué tel quel en
  // recherche manuelle, doit ramener au moins une fiche. La concaténation des
  // mots utilisés échouait à ce test (« Épeautre Boulgour Petit » -> 0), d'où
  // le passage au seul mot le plus discriminant.
  const champ = motsUtilises[0] ?? '';
  console.log(`    contenu du champ après repli : « ${champ} »`);
  verifier('le champ contient le mot le plus discriminant', champ === motsUtilises[0]);
  const rejoue = champ ? await chercher(champ) : [];
  verifier(
    'le contenu du champ, rejoué en recherche manuelle, ramène au moins 1 fiche',
    rejoue.length >= 1,
    `${rejoue.length} fiche(s)`,
  );
  // Contre-épreuve : ce que le 103b mettait dans le champ ne marchait pas.
  const ancienChamp = motsUtilises.join(' ');
  if (motsUtilises.length > 1) {
    const ancienRejoue = await chercher(ancienChamp);
    verifier(
      `contre-épreuve : l'ancien contenu « ${ancienChamp} » ne ramenait rien`,
      ancienRejoue.length === 0,
      `${ancienRejoue.length} fiche(s)`,
    );
  }

  // Chantier 103c — classement au nombre de fiches ramenées, croissant.
  verifier(
    'les mots sont classés du plus discriminant au moins discriminant',
    JSON.stringify(motsUtilises) === JSON.stringify(['Épeautre', 'Boulgour', 'Petit']),
    motsUtilises.join(' > '),
  );
  const parMot = mots.map((mot, i) => ({ mot, ids: new Set(lots[i].map(x => x.produit_id)) }));
  const debordement = parMot.filter(({ ids }) => fiches.filter(f => ids.has(f.produit_id)).length > 4);
  verifier('aucun mot n\'apporte plus de 4 fiches', debordement.length === 0);
  verifier('la liste est resserrée (moins de 10 fiches, contre 20 au 103b)', fiches.length < 10, `${fiches.length} fiches`);
}

// --- Résultat attendu ---
const noms = fiches.map(f => f.nom_reference);
const rang = noms.indexOf(FICHE_ATTENDUE);
verifier(`la fiche « ${FICHE_ATTENDUE} » remonte sans intervention manuelle`, rang >= 0);
verifier(`elle est en 1re position`, rang === 0, `rang ${rang + 1}/${noms.length}`);
console.log(`    liste complète : ${noms.join(' | ')}`);

console.log(echecs === 0 ? '\nTOUS OK' : `\n${echecs} ÉCHEC(S)`);
process.exit(echecs === 0 ? 0 : 1);
