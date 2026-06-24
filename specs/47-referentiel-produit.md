# #47 — Référentiel produit normalisé + validation communautaire

## Problème
L'OCR lit les noms des produits tels qu'ils apparaissent sur les tickets de caisse.
Chaque enseigne a sa propre façon de nommer les produits :
- "Eau de source CRISTALLINE" (Utile)
- "Eau Source Cristalline" (Vival)
- "Eau source cristalline" (Leclerc)
→ C'est le même produit mais 3 noms différents dans price_db.

## Solution : référentiel produit + validation communautaire

### Nouvelle table Supabase : `products_ref`
| colonne | type | description |
|---|---|---|
| id | uuid | clé primaire |
| nom_normalise | text | nom officiel du produit (ex: "Eau source plate") |
| marque | text | marque normalisée (ex: "Cristalline") |
| categorie | text | catégorie normalisée |
| alias | text[] | liste des noms bruts connus (ex: ["Eau de source CRISTALLINE", "Eau Source Cristalline"]) |

### Nouvelle colonne dans `price_db`
- `normalise` (boolean, défaut false) — indique si le nom du produit a été validé

### Flux complet

1. **Scan OCR** → produit écrit dans `price_db` avec `normalise = false`
   - Badge coloré (orange/rouge) visible dans l'app sur les produits non normalisés

2. **L'utilisateur** voit le badge et peut proposer un nom normalisé en 2 secondes
   - Champ simple : "Ce produit s'appelle comment ?"

3. **Validation communautaire (mini-jeu)**
   - Les autres utilisateurs voient la proposition : "Ce produit s'appelle bien X ?"
   - Ils valident ou proposent autre chose
   - Quand 3 votes identiques → statut passe à `normalise = en attente de validation`

4. **Validation admin (François + Claude)**
   - Interface admin pour voir les produits en attente de validation
   - On valide définitivement → le nom entre dans `products_ref`
   - Tous les enregistrements existants avec les alias connus sont mis à jour automatiquement

### Sous-étapes roadmap
- #47.1 — Table `products_ref` + colonne `normalise` dans `price_db`
- #47.2 — Badge couleur dans l'app sur les produits non normalisés
- #47.3 — Système de proposition + vote communautaire (mini-jeu)
- #47.4 — Interface admin validation (François + Claude)

### Rôle de Claude
À chaque nouveau nom inconnu qui arrive, Claude aide à décider :
- Est-ce un alias d'un produit existant dans `products_ref` ?
- Ou un nouveau produit à créer ?
On enrichit `products_ref` ensemble au fur et à mesure.

## Priorité
À attaquer après #45 et #46.
