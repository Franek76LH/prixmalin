# Architecture fonctionnelle PrixMalin
## Version : 1.1
**Date : 30 juin 2026**  
**Statut : document fondateur — PrixMalin Core**  
**Périmètre : modules, flux, tables, sécurité et transition vers l’architecture cible**

---

## 0. Objet du document

Ce document décrit l’architecture fonctionnelle cible de PrixMalin et les responsabilités de chaque module.

Il utilise exclusivement les tables et champs du modèle de données v1.4.

---

## 1. Vue d’ensemble

PrixMalin repose sur sept modules :

1. Scan de ticket ;
2. Saisie manuelle de prix ;
3. Liste de courses ;
4. Product Intelligence Engine ;
5. Comparateur ;
6. Recommandations et économies ;
7. Communauté et gouvernance.

```text
Photos / saisie manuelle
        ↓
Tickets et lignes
        ↓
Product Intelligence Engine
        ↓
Prix validés
        ↓
Vue comparable_prices
        ↓
Comparateur
        ↓
Snapshots et recommandations
```

---

## 2. Modules

### Module 1 — Scan de ticket

**Rôle :** transformer une ou plusieurs images en un ticket structuré.

**Entrées :**
- `client_scan_id` ;
- une ou plusieurs images ;
- utilisateur authentifié.

**Écritures :**
- `receipts` ;
- `receipt_images` ;
- `receipt_lines`.

**Flux :**

1. génération du `client_scan_id` ;
2. création du ticket avec `processing_status = uploaded` ;
3. enregistrement des chemins Storage dans `receipt_images` ;
4. OCR côté serveur ;
5. extraction du magasin, de la date, du total et des lignes ;
6. calcul de `receipt_fingerprint` ;
7. détection des doublons ;
8. création ordonnée des `receipt_lines` ;
9. transmission des lignes produit au Product Intelligence Engine ;
10. passage à `validated`, `review_required` ou `failed`.

**Règles :**
- une nouvelle tentative avec le même `client_scan_id` retourne le ticket existant ;
- `raw_text` n’est jamais réécrit ;
- les lignes de remise, total, paiement et information sont conservées avec leur `line_type` ;
- un doublon exact ne produit ni ligne ni prix ;
- les images restent privées.

---

### Module 2 — Saisie manuelle de prix

**Rôle :** enregistrer un prix sans ticket.

**Lectures :**
- `products` ;
- `product_variants` validées ;
- `stores` ;
- `retailers`.

**Écritures côté serveur :**
- `prices` ;
- éventuellement `stores` avec `status = unverified`.

Le navigateur ne possède pas de droit direct d’insertion dans `prices`. La saisie passe par une Edge Function ou une RPC métier validant le produit, le magasin, la date et la fraîcheur.

**Valeurs principales :**

```text
receipt_line_id = NULL
source_type = manual
user_id = utilisateur
product_id obligatoire
store_id obligatoire
```

Le prix manuel est validé uniquement après les contrôles de format, date et cohérence.

---

### Module 3 — Liste de courses

**Rôle :** gérer la liste active de l’utilisateur et lancer une comparaison de panier.

**Table :**
- `shopping_list`.

Chaque article conserve toujours `raw_label`, même lorsqu’il est rattaché à un produit.

Le module transmet au comparateur :

- `product_id` ;
- `product_variant_id` éventuel ;
- quantité et unité ;
- localisation et filtres.

---

### Module 4 — Product Intelligence Engine

**Rôle :** identifier le produit générique et, si possible, la variante exacte.

**Lectures :**
- `product_aliases` validés ;
- `products` ;
- `product_variants` ;
- `brands` ;
- `retailers` ;
- `stores`.

**Écritures :**
- champs de résolution de `receipt_lines` ;
- `product_aliases` en `pending` ;
- `product_variants` en `pending`.

Le module ne crée jamais automatiquement une ligne validée dans `products`.

Les seuils sont :

- ≥ 0,95 : validation automatique si aucun garde-fou n’est violé ;
- 0,80 à 0,95 : suggestion ;
- < 0,80 : non classé temporaire.

---

### Module 5 — Comparateur

**Rôle :** comparer les prix admissibles par produit, magasin et panier.

**Source principale :**
- `comparable_prices`, interrogée côté serveur.

**Autres lectures :**
- `stores` ;
- `products` ;
- `product_variants` ;
- `subcategories` ;
- `shopping_list`.

**Fonctions :**
- filtrage géographique ;
- comparaison exacte ou générique ;
- normalisation au kilogramme, litre ou unité ;
- calcul par magasin ;
- solution viable d’un ou deux magasins ;
- contrôle de couverture du panier.

Le client ne lit pas directement l’ensemble de `prices`.

---

### Module 6 — Recommandations et économies

**Rôle :** figer et présenter le résultat du comparateur.

**Écritures :**
- `recommendation_snapshots` ;
- `recommendation_snapshot_items`.

Le snapshot conserve :

- version de l’algorithme ;
- période analysée ;
- date d’expiration ;
- économie potentielle ;
- magasin principal ;
- nombre d’articles disponibles et manquants ;
- détails par produit.

La formulation « économie réalisée » reste inactive tant qu’un lien explicite snapshot–liste–ticket n’est pas ajouté au modèle.

---

### Module 7 — Communauté et gouvernance

**Rôle :**
- gérer les cercles ;
- modérer les magasins, variantes et alias ;
- appliquer les droits d’accès.

**Tables :**
- `circles` ;
- `circle_members` ;
- `prices` ;
- `product_aliases` ;
- `product_variants` ;
- `stores`.

**Règles :**
- un utilisateur appartient à un seul cercle actif ;
- plusieurs invitations en attente sont possibles ;
- l’invitation, l’acceptation, le retrait et la sortie d’un cercle passent par des RPC dédiées ;
- aucune modification directe de `circle_members` n’est accordée au client ;
- un prix peut être partagé avec le cercle actif via une opération serveur ;
- les alias et variantes proposés par un utilisateur restent `pending` ;
- les catégories, sous-catégories et produits génériques sont administrés.

La table legacy `community_prices` n’est plus utilisée après migration.

Les tables existantes `profiles` et `feedback` restent conservées hors du cœur fonctionnel. `profiles` ne doit être utilisée pour les rôles administrateurs qu’après vérification de sa structure réelle.

---

## 3. Flux complet d’un scan

```text
1. Client
   → génère client_scan_id
   → envoie les images

2. Service serveur
   → crée receipts
   → stocke receipt_images
   → appelle le service OCR

3. Extraction
   → crée receipt_lines avec raw_text et line_type
   → calcule receipt_fingerprint
   → traite les doublons

4. Product Intelligence Engine
   → recherche product_aliases
   → renseigne product_id / product_variant_id
   → applique les deux validations

5. Publication
   → crée un prix uniquement pour les lignes produit validées
   → calcule valid_until
   → conserve les lignes non résolues pour revue

6. Comparateur
   → utilise comparable_prices côté serveur
```

---

## 4. Flux de comparaison

```text
Liste ou produit
   ↓
API / Edge Function du comparateur
   ↓
comparable_prices
   ↓
filtrage géographique et normalisation
   ↓
solution viable
   ↓
recommendation_snapshots
   ↓
recommendation_snapshot_items
   ↓
résultat limité renvoyé au client
```

La vue ne contient aucune identité de contributeur ni référence de ticket.

---

## 5. Flux communautaire

```text
Création du cercle
→ création automatique du membre owner actif
→ invitation d’un utilisateur
→ pending
→ acceptation
→ active
```

Un utilisateur invité ne peut modifier que sa propre réponse à une invitation. Il ne peut pas modifier son rôle ou son rattachement.

---

## 6. Sécurité

### 6.1 Principes

- RLS activée sur toutes les tables exposées ;
- secrets et `service_role` exclusivement côté serveur ;
- bucket de tickets privé ;
- aucune donnée personnelle dans `comparable_prices` ;
- fonctions serveur avec `search_path` limité ;
- droits clients révoqués avant la création des politiques finales pendant la migration.

### 6.2 Vue comparateur

`comparable_prices` utilise `security_invoker = true`.

Son accès direct est révoqué pour `anon` et `authenticated`. Une Edge Function ou un service serveur exécute le calcul et renvoie uniquement le résultat nécessaire.

### 6.3 Canaux d’écriture

| Données | Canal |
|---|---|
| Favoris et liste de courses | accès direct propriétaire protégé par RLS |
| Proposition de variante ou alias | insertion directe en `pending` |
| Proposition de magasin | insertion directe en `unverified` |
| Tickets, lignes OCR, prix et snapshots | serveur uniquement |
| Confirmation d’une ligne | RPC ou Edge Function limitée |
| Gestion des membres d’un cercle | RPC dédiées |

### 6.4 Tables personnelles

| Table | Accès |
|---|---|
| `receipts` | propriétaire |
| `receipt_images` | propriétaire via ticket |
| `receipt_lines` | propriétaire via ticket |
| `favorites` | propriétaire |
| `shopping_list` | propriétaire |
| `recommendation_snapshots` | propriétaire |
| `recommendation_snapshot_items` | propriétaire via snapshot |

---

## 7. Transactions et idempotence

### 7.1 Création du ticket

La création initiale du ticket, des métadonnées d’images et de l’état de traitement doit être transactionnelle lorsque possible.

Les appels OCR externes ne doivent pas maintenir une transaction PostgreSQL ouverte.

### 7.2 Publication des lignes et prix

Après OCR, une transaction serveur peut :

```text
mettre à jour receipts
insérer receipt_lines
mettre à jour ou créer les alias pending
insérer les prix validés
terminer processing_status
```

### 7.3 Idempotence

- `client_scan_id` protège les répétitions techniques ;
- `receipt_fingerprint` protège contre le même achat renvoyé avec un nouvel identifiant ;
- `prices.receipt_line_id` empêche deux prix issus de la même ligne ;
- `prices.source_reference` empêche le double import d’une ligne legacy.

---

## 8. Architecture technique cible

| Composant | Technologie cible |
|---|---|
| Frontend | React + Vite, PWA |
| Backend | Supabase PostgreSQL, Auth, Storage, Edge Functions |
| Déploiement | Vercel |
| Versionnement | GitHub |
| OCR | service externe appelé exclusivement côté serveur |

Les noms exacts des fonctions, secrets et fichiers doivent être vérifiés dans le dépôt avant déploiement. Le présent document ne présume pas qu’une Edge Function cible existe déjà.

Fonctions cibles possibles :

| Fonction | Rôle |
|---|---|
| `scan-ticket` | réception et OCR |
| `process-receipt` | extraction, résolution et publication transactionnelle |
| `compare-basket` | accès serveur à la vue et calcul de recommandation |
| `respond-circle-invitation` | acceptation sécurisée d’une invitation |

---

## 9. Transition

La transition suit le document 06.

### Étapes

1. inventaire réel et sauvegarde ;
2. création additive des extensions, fonctions et tables ;
3. peuplement versionné du référentiel ;
4. migration vers staging ;
5. résolution et réconciliation ;
6. activation des politiques RLS ;
7. tests hors production ;
8. dernier delta legacy ;
9. bascule applicative ;
10. conservation des tables legacy en lecture seule ;
11. archivage après stabilisation.

Une double lecture ou double écriture ne doit être utilisée que pendant une fenêtre contrôlée et réconciliée. Elle ne constitue pas l’architecture cible.

---

## 10. Points de vigilance

- `stores` doit être enrichie sans écraser les données existantes ;
- les nouveaux magasins commencent en `unverified` ;
- la géolocalisation doit être appelée dans un contexte sécurisé ; les environnements locaux doivent être testés selon le navigateur utilisé ;
- les anciens champs tels que `"storeId"` restent traités uniquement dans les scripts legacy ;
- les JSONB de `favorites`, `shopping_list` et `archives` doivent être inventoriés avant écriture des scripts d’éclatement ;
- la date du 28 juillet 2026 est une échéance opérationnelle de projet à confirmer, pas une propriété intrinsèque du CLI Supabase ;
- aucune modification du dépôt GitHub n’est réalisée par l’audit documentaire.

---

## 11. Dépendances

| Module | Dépend de |
|---|---|
| Scan | Auth, Storage, OCR, stores |
| Saisie manuelle | products, product_variants, stores |
| Liste | shopping_list, référentiel |
| PIE | product_aliases, référentiel |
| Comparateur | comparable_prices, stores |
| Recommandations | comparateur, snapshots |
| Communauté | circles, circle_members, modération |

---

## 12. Versionnage

| Version | Date | Nature |
|---|---|---|
| 1.0 | 29 juin 2026 | Version fondatrice |
| 1.1 | 30 juin 2026 | Alignement avec le modèle v1.4, les règles v1.2 et le plan de migration v1.2 |

---

## 13. Documents du PrixMalin Core

| # | Document |
|---|---|
| 01 | Référentiel Produit v1.2 |
| 02 | Modèle de données v1.4 |
| 03 | Product Intelligence Engine v1.1 |
| 04 | Règles métier v1.2 |
| 05 | Architecture fonctionnelle v1.1 |
| 06 | Plan de migration Supabase v1.2 |

---

*L’architecture cible doit séparer les preuves brutes, la résolution produit, les prix validés et les résultats du comparateur.*
