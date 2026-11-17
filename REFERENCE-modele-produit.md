# 📘 PrixMalin — Modèle de référence d'un produit (document maître)

_Document de référence unique. Décrit COMMENT un produit doit être structuré et fonctionner dans PrixMalin, pour que **tous les produits marchent de la même façon** : regroupement, marque, code-barres, photo, prix au kilo/litre, comparaison. À appliquer à tout produit, tout rayon, tout import._

_Créé le 08/08/2026. Sources détaillées citées à la fin. En cas de doute, ce document fait foi ; les docs cités donnent le détail._

---

## 0. Le principe fondateur — LOGIQUE DRIVE (non négociable)
PrixMalin suit **la même logique qu'un drive** (réf. Leclerc Drive). Deux portes d'entrée, deux logiques :
- **Recherche** = raccourci direct par l'intention (souvent la **marque** : « Coca », « Nutella », « Lay's »). L'app doit sortir directement la marque cherchée et ses déclinaisons.
- **Navigation par rayons** = arborescence du drive : Catégorie → Sous-catégorie → produits par déclinaison/variété.
- **Marques distributeurs** : toujours proposées, **regroupées en un seul bloc « Marques distributeurs »**, jamais nommées une par une.

Détail : `claude/principe-ux-logique-drive.md`.

---

## 1. La règle d'or du modèle de fiche
> **Une fiche = un produit comparable. La marque ET le format descendent en variantes. On ne sépare les fiches que sur le SOUS-TYPE** (nature ≠ aromatisé, au naturel ≠ à l'huile, plate ≠ gazeuse, cola ≠ cola zéro…).

Conséquences :
- « Chips aromatisées » = **une** fiche ; Lay's 120g, Vico 135g, MDD 200g… = **des variantes** de cette fiche.
- Le €/kg (porté par la quantité de chaque variante) rend la comparaison possible entre marques et formats → **c'est le cœur du comparateur**.
- On NE crée PAS une fiche par marque ni par format.

Détail : `claude/programme-rationalisation.md`, `claude/chantier-modele-produit.md`.

---

## 2. Le modèle de données (Core Supabase)
Chaîne : **catégorie → sous-catégorie → produit (fiche) → variante → prix**, + marques, codes-barres, magasins, enseignes.

### `produits` (la fiche)
- `nom_reference` : nom **générique**, SANS marque ni quantité (ex. « Chips aromatisées », pas « Chips Lay's 120g »).
- `sous_categorie_id` : rattachement rayon (obligatoire, 100 % rempli).
- `famille` / `sous_famille` : **regroupement d'affichage** (« mode Chips »), champs texte libres. Voir §3.
- `type_unite` (poids / volume / pièce) + `unite_base` : famille d'unité du produit.
- `actif` : une fiche masquée = `actif=false`.

### `variantes_produit` (marque + format)
- `produit_id` → la fiche.
- `marque_id` → `marques` : **c'est d'ici que vient la marque affichée** (voir §4).
- `quantite_nette` + `unite_quantite` (g, kg, ml, cl, L…) + `nombre_unites` (multipack, ex. 6×30g → nombre_unites=6) : **c'est ce qui donne le prix au kilo/litre** (voir §6).
- `libelle` : format lisible (« 6×33cl », « 250g »). Le poids/volume va dans `quantite_nette`, **JAMAIS dans le nom**.
- `actif` : une variante masquée = `actif=false` (⚠️ le comparateur ignore les variantes inactives).
- Règle d'unicité : **une variante unique par (produit + marque + format)** — index anti-doublon `uq_variantes_produit_actives_sans_doublon`.

### `marques`
- `nom` (ex. « Lay's », « Pepsi », « Pom'Lisse »).
- `est_mdd` (bool) : marque distributeur ? Si oui → regroupée sous « Marques distributeurs » à l'affichage.
- Contrainte : **une MDD doit avoir une enseigne** (`marques_mdd_coherente`).

### `codes_barres_variante` (voir §5)
- `variante_produit_id`, `code_barres` (UNIQUE global), `est_principal`, `source`. **Plusieurs codes par variante** possibles.

### `prix` (le relevé)
- `produit_id` + `variante_produit_id` (doivent être cohérents : la variante appartient au produit).
- `prix_total` : **le prix du paquet observé** (le prix payé). Le €/kg est **calculé**, pas stocké (voir §6).
- `source` : `ticket` | `manuel` | `communaute` | `import`.
- `observe_le` (date), `magasin_id`, `statut_validation` (`valide`…), `archive` (bool).

### `magasins` / `enseignes`
- Magasins peuvent être fusionnés (`statut='fusionne'`, `fusionne_vers_id`) ; la vue résout le magasin canonique.

### La vue `prix_comparables` (ce que lit le comparateur)
Assemble tout : `prix` → `produits` → `variantes_produit` → `marques` → `magasins` (canonique) → `enseignes`.
- `nom_marque = marques.nom` **via la variante** (`variantes_produit.marque_id`). ⚠️ Pas de variante avec marque → « Sans marque ».
- Filtres : `statut_validation='valide'`, `archive=false`, validité non expirée, `produits.actif`, `sous_categories.actif`, `categories.visible`, magasin actif, **variante active**, marque active.
- ⚠️ Conséquence clé : **une variante `actif=false` disparaît totalement du comparateur.**

Détail : `claude/chantier-modele-produit.md`, `claude/chantier-codes-barres-multiples.md`.

---

## 3. Regroupement d'affichage — « mode Chips » (famille / sous_famille)
Pour qu'un nom parent se déroule sur ses sous-types (Tomate → Grappe / Cœur de bœuf ; Chips → Nature / Aromatisé) :
- `produits.famille` = le **parent affiché**. `produits.sous_famille` = le **sous-type**. Champs texte libres.
- **Recherche** : les fiches de même `famille` se regroupent en un accordéon (générique, `resultatsGroupes` dans `src/App.jsx`).
- **Rayons** : même regroupement au niveau 3 des catégories (chantier 86).
- Règle : ne regrouper que les **vrais mêmes produits**. Pas de marque en dur.
- Fiches sans `famille` → affichées à plat (comportement normal).

Détail : `claude/chantier-regroupement-familles.md`.

---

## 4. La MARQUE — d'où elle vient, comment la remplir
- **Affichée depuis** `variantes_produit.marque_id → marques.nom` (via la vue). **Pas** depuis OpenFoodFacts, **pas** depuis le nom du produit.
- **MDD** (`est_mdd=true`) : fusionnées à l'affichage sous **un seul bloc « Marques distributeurs »**, jamais nommées (règle drive).
- **Comment remplir la marque d'une variante :**
  1. **Au scan de code-barres** (source de vérité pour l'avenir).
  2. **En rattrapage OpenFoodFacts** : OFF renvoie le champ `brands` pour un code-barres → on peut écrire `marque_id` (même circuit que les photos, voir §7).
  3. **À la main** via le MCP Supabase (petits volumes).
- Sans marque légitime (fruits/légumes frais, vrac) → `marque_id` nul, c'est normal (affiché « Sans marque » / entrée par variété).

---

## 5. Les CODES-BARRES
- Stockés dans `codes_barres_variante` (**plusieurs codes par variante** ; migré depuis l'ancien champ `variantes_produit.code_barres`, retiré).
- `code_barres` **UNIQUE au niveau global** (un code = une seule variante). `est_principal` = le code de référence (utilisé en priorité pour la photo).
- Écriture **réservée admin** (`est_administrateur()`), via scan ou import.
- Le code-barres est **une clé d'entrée** (retrouver la variante), pas une carte d'identité. Deux portes : ticket (libellé + enseigne) et scan produit (par le code).
- Lecture caméra : @zxing/browser, EAN-13/UPC-A/UPC-E, autofocus continu, `TRY_HARDER`.

Détail : `claude/chantier-codes-barres-multiples.md`, `claude/chantier-scan-code-barres.md`.

---

## 6. PRIX AU KILO / LITRE / GRAMME (la normalisation)
Le comparateur compare au **prix de référence** (€/kg ou €/L). Il n'est **pas stocké** : il est **calculé** à l'affichage.

**Formule (helper `calculerPrixReferenceParUnite` / `src/lib/unitesCore.js`) :**
```
prix_reference = prix_total / (quantite_nette convertie en kg ou L  ×  nombre_unites)
```
- `quantite_nette` + `unite_quantite` : g/kg → ramenés au **kg** ; ml/cl/L → ramenés au **L** (`resoudreFamilleEtCoefficient`).
- `nombre_unites` : multiplie la quantité pour les multipacks (6×30g → 0,18 kg).
- **Pièce / unité inconnue** → pas de €/kg (exclu du comparatif prix au kilo).
- **Donc :** pour qu'un produit ait un prix au kilo juste, sa variante DOIT avoir `quantite_nette` + `unite_quantite` corrects (et `nombre_unites` pour un lot). `prix_total` reste le **prix du paquet**.

**Règle de modélisation :** le poids/volume va dans `quantite_nette`+`unite_quantite`, **jamais** dans `nom_reference`. La marque va dans `marque_id`, jamais dans le nom.

Détail : `claude/chantier-prix-sans-variante.md`, `claude/chantier-75-ticket-fidele-prix-unitaire.md`.

---

## 7. Les PHOTOS (circuit code-barres → OpenFoodFacts → Cloudinary)
La photo n'est **pas** stockée en base : elle est résolue à l'affichage, à partir du **code-barres** de la variante.

**Circuit (`src/lib/photosProduits.js`) :**
1. Code-barres (EAN) de la variante (`codes_barres_variante`, le principal en priorité).
2. **OpenFoodFacts API v2** (gratuit, CORS OK) :
   `https://world.openfoodfacts.org/api/v2/product/{EAN}.json?fields=image_front_small_url,image_front_url`
   (`status:1` = trouvé ; le n° de version de l'URL est imprévisible → **toujours passer par l'API, ne jamais deviner l'URL**).
3. **Cloudinary mode « fetch »** (optimisation/redimensionnement, aucun upload, aucun secret) :
   `https://res.cloudinary.com/dur9hgqr/image/fetch/f_auto,q_auto,w_600,c_pad,b_white/<url_off>`
   - Vignette : `w_160,h_160,c_pad,b_white` (depuis `image_front_small_url`).
   - Fiche : `w_600,c_pad,b_white` (depuis `image_front_url`).
   - Agrandi : `c_limit,w_1000` (pleine résolution `.full.jpg`).
- **Cloud name public : `dur9hgqr`** (ok en dur, aucun secret côté client).
- **Fallback obligatoire** : pas de code-barres / pas de photo OFF / erreur réseau → garder l'icône de sous-catégorie. **Ne jamais casser l'affichage.**
- Perf : cache mémoire par EAN + `loading="lazy"`.
- ⚠️ Pas de code-barres → pas de photo (et pas d'enrichissement marque OFF). C'est pour ça que le code-barres est central.

Détail : `claude/chantier-cloudinary.md`.

---

## 8. Le COMPARATEUR (affichage des prix)
Composant `FamilleDepliee` (`src/App.jsx`), utilisé **à l'identique en recherche et en rayon**.
- Arbre : **sorte** (`sous_famille`) → **marque** → **formats** (variantes).
- MDD (`est_mdd=true`) **fusionnées** sous « Marques distributeurs ».
- **Tri : le moins cher en tête** (marques triées par meilleur €/kg ; formats du moins cher au plus cher). Pas d'ordre figé.
- En rayon (`modeRayon`) : les fiches **sans relevé** restent visibles en repli « Pas encore de prix » (jamais masquées).
- Fourchette de prix = min/max des relevés ; fraîcheur = date du relevé le plus ancien.

Détail : `claude/chantier-84-85-rayon-comparateur.md`, `claude/comparateur-segmentation-mdd-vs-nationales.md`.

---

## 9. Les SOURCES de prix (comment un prix entre)
| Source | Comment | Remplit |
|---|---|---|
| `ticket` | Scan OCR du ticket → rapprochement libellé→produit (mémoire d'enseigne) | prix + lien variante |
| `import` | Script CSV Drive (voir §10) | fiche + variante + prix en masse |
| `manuel` | Saisie / MCP Supabase | ponctuel |
| `communaute` | Relevés partagés (cercle) | prix communautaires |

⚠️ Un prix appartient à **(variante, magasin, date)**, pas à l'EAN. Le rapprochement mémorise le lien libellé→produit pour reconnaître les prochains scans.

Détail : `claude/chantier-76-memoire-texte-ticket.md`, `claude/strategie-fiabilisation-rapprochement.md`, `claude/chantier-noms-produits.md`.

---

## 10. IMPORT EN MASSE (CSV Drive)
Script local `scripts/import-drive-csv.js` (Node, exécuté par François au terminal ; jamais depuis l'app ; clé `service_role` en local, jamais commitée).
- Deux modes : `node scripts/import-drive-csv.js <fichier.csv>` (aperçu, **aucune écriture**) ; `… --confirmer` (écriture réelle).
- CSV séparateur `;`, BOM géré. Colonnes utiles : `nom_produit`, `prix_euros`, `date_releve`, `format`, `contenance_totale`, `unite_mesure_totale`, `url_produit`, `identifiant_magasin`, `marque_principale_estimee`/`marques_source`/`mdd_source` (souvent vides → marque dans le nom), `identifiant_produit_leclerc`, `url_image`.
- Logique : `resoudre_alias_core(nom_produit)` → si 1 match, rattache le prix ; sinon crée fiche + variante (⚠️ **sans marque_id** — la marque est ajoutée après, au rattrapage). Anti-doublon sur (produit, variante, magasin, date, prix).

Détail : script `scripts/import-drive-csv.js`, `claude/chantier-modele-produit.md`.

---

## 11. QUALITÉ & DOUBLONS
- **Une variante unique** par (produit + marque + format) — index anti-doublon actif.
- Fusion de fiches doublons via **une procédure qui re-pointe TOUT** vers la survivante (variantes, alias, prix, lignes_ticket, listes/favoris), archive les prix strictement en double, désactive les fiches vidées.
- ⚠️ **Toujours créer une table de sauvegarde AVANT une fusion / opération de masse** (voir §13).

Détail : `claude/audit-variantes-doublons.md`, `claude/programme-rationalisation.md`.

---

## 12. RÉPARATION / RECONSTRUCTION de données (méthode validée le 08/08)
Quand des prix se retrouvent « Sans marque » (variantes de marque désactivées, prix re-pointés sur du générique) — cf. incident du 07/08 :
1. **Sauvegarde d'abord** : `CREATE TABLE _sauv_… AS SELECT` de l'état des prix + variantes concernés.
2. **Appariement EXACT** depuis le CSV d'origine : prix actuel ↔ ligne CSV de **même €/kg unique**, puis variante de marque de la **bonne taille sous le même produit** (`abs(quantite_nette − contenance) ≤ 0,02`).
3. **Garde-fou anti-collision** : abandon si un `prix_id` est réclamé 2×.
4. Écritures : `prix.prix_total` = vrai prix paquet, `prix.variante_produit_id` = variante de marque, `variantes_produit.actif = true`.
5. **Fail-safe** : pas de variante marque/taille → le prix reste « Sans marque » (jamais mal rangé).

Détail complet + chiffres : `claude/incident-fusion-07-08-marques-perdues.md`.

---

## 13. RÈGLES DE PROCESS (non négociables)
1. **Décisions en conversation d'abord**, avant tout code.
2. **Aucune opération de masse en base sans table de sauvegarde AVANT.** (Leçon de l'incident du 07/08.)
3. **Appariement de données = exact + garde-fou anti-collision + fail-safe.** Jamais « à la louche » (tolérance = collisions).
4. **Code = mode SHADOW** : additif, ne rien retirer, jamais planter si un service externe (OFF/Cloudinary) est indisponible. Pas de push sans **test iPhone + feu vert écrit** de François. Un push sur `main` = déploiement prod.
5. **Montrer avant d'appliquer**, une étape à la fois.
6. **Sauvegardes Supabase** : la base est en offre gratuite (aucun backup automatique). Envisager le forfait Pro (≈25 $/mois, 1 backup/jour) pour ne plus être sans filet.
7. Rien de sensible (clé `service_role`) dans l'app ni dans un commit.

---

## 14. CHECKLIST — « un produit qui fonctionne à 100 % »
Pour qu'un produit se comporte comme tous les autres (regroupé, avec marque, photo, prix au kilo, comparable) :

**Fiche (`produits`)**
- [ ] `nom_reference` générique (sans marque ni quantité)
- [ ] `sous_categorie_id` correct (bon rayon)
- [ ] `famille` + `sous_famille` remplis si regroupement voulu (§3)
- [ ] `type_unite` cohérent (poids/volume/pièce)

**Variante(s) (`variantes_produit`)**
- [ ] `marque_id` renseigné (ou nul si pas de marque légitime) (§4)
- [ ] `quantite_nette` + `unite_quantite` corrects, `nombre_unites` pour un lot (§6)
- [ ] `actif = true`
- [ ] au moins un **code-barres** dans `codes_barres_variante` → débloque photo + rattrapage marque (§5, §7)

**Prix (`prix`)**
- [ ] `prix_total` = prix paquet, `variante_produit_id` cohérent, `source`, `magasin_id`, `observe_le`, `statut_validation='valide'`

→ Si ces cases sont cochées : le produit se **regroupe** (famille), affiche sa **marque** (variante→marque), sa **photo** (code-barres→OFF→Cloudinary), son **prix au kilo/litre** (quantité), et entre proprement dans le **comparateur**.

---

## 15. REPÈRES TECHNIQUES
- **Prod** : `prixmalin-three.vercel.app` (un push sur `main` = déploiement auto).
- **GitHub** : `Franek76LH/prixmalin` — tout dans `src/App.jsx` ; helpers dans `src/lib/` (`comparateurCore.js`, `photosProduits.js`, `unitesCore.js`, `catalogueCore.js`) ; scripts dans `scripts/`.
- **Supabase** : projet `yqlloujowsbaulcwbyxz`. Vue clé : `prix_comparables`. Travail base direct = **MCP Supabase** (jamais via l'app).
- **Cloudinary** : cloud name public `dur9hgqr`, mode fetch (pas de secret).
- **Outils de travail** : MCP Supabase (données), Claude Code (code, mode shadow), skill `spec-chantier` (générer les messages « envoie ça à Claude Code »), scan @zxing, import CSV local.
- **Stack** : React + Vite, Supabase, Vercel. PWA (`registerType:'prompt'` → tester en **navigation privée** pour éviter le cache).

---

## 16. DOCS SOURCES (le détail de chaque sujet)
- Principe UX : `claude/principe-ux-logique-drive.md`, `claude/principe-ux-reference-ecran-chips.md`, `claude/insights-ux-habitudes-courses.md`
- Modèle / fusions : `claude/programme-rationalisation.md`, `claude/chantier-modele-produit.md`, `claude/audit-variantes-doublons.md`, `claude/chantier-codes-barres-multiples.md`
- Regroupement : `claude/chantier-regroupement-familles.md`, `claude/modele-categories-choix-rayon.md`, `claude/chantier-regroupement-familles.md`
- Prix / unités : `claude/chantier-prix-sans-variante.md`, `claude/chantier-75-ticket-fidele-prix-unitaire.md`
- Photos : `claude/chantier-cloudinary.md`
- Scan / codes-barres : `claude/chantier-scan-code-barres.md`, `claude/chantier-codes-barres-multiples.md`
- Comparateur : `claude/chantier-84-85-rayon-comparateur.md`, `claude/comparateur-segmentation-mdd-vs-nationales.md`, `claude/chantier-geoloc-comparateur.md`
- Rapprochement tickets : `claude/chantier-76-memoire-texte-ticket.md`, `claude/strategie-fiabilisation-rapprochement.md`, `claude/chantier-noms-produits.md`
- Incident & réparation : `claude/incident-fusion-07-08-marques-perdues.md`, `claude/diagnostic-marques-comparateur.md`

_Fin du document de référence._
