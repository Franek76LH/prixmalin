# Règles métier PrixMalin
## Version : 1.2
**Date : 30 juin 2026**  
**Statut : document fondateur — PrixMalin Core**  
**Périmètre : comparaison, économies, fraîcheur des prix, anomalies et doublons**

---

## 0. Objet du document

Ce document définit les règles métier communes au comparateur, aux recommandations et au contrôle qualité des prix.

Il est aligné avec le modèle de données v1.4. Les noms techniques utilisés ici sont ceux des tables `prices`, `receipts`, `receipt_lines` et `recommendation_snapshots`.

---

## 1. Calcul des économies

### 1.1 Principe

PrixMalin cherche la solution viable permettant de payer un panier moins cher, sans présenter une économie théorique comme une garantie.

### 1.2 Zone de référence

La zone maximale d’analyse est fixée à **50 km** par défaut.

Le rayon choisi dans l’interface peut être plus faible. Le moteur ne doit pas recommander un déplacement disproportionné pour une économie faible.

### 1.3 Un ou deux magasins

Le moteur peut comparer :

- une solution dans un seul magasin ;
- une solution répartie dans deux magasins au maximum.

Dans un snapshot :

- `recommendation_snapshots.best_store_id` contient le magasin principal ;
- les magasins réellement affectés aux articles sont déduits des valeurs distinctes de `recommendation_snapshot_items.best_store_id` ;
- un résultat initial ne doit pas dépasser deux magasins.

Seuil provisoire :

```text
gain supplémentaire du deuxième magasin < 5 €
→ conserver la solution à un seul magasin
```

### 1.4 Couverture du panier

Une recommandation doit indiquer :

- `available_item_count` ;
- `missing_item_count` ;
- les produits sans prix récent.

Une solution moins chère mais couvrant trop peu d’articles ne doit pas être présentée comme meilleure sans avertissement.

### 1.5 Économie potentielle

```text
coût de référence du panier
− coût de la solution recommandée
= économie potentielle
```

La formulation utilisateur doit rester :

```text
Jusqu’à X € d’économies potentielles.
```

`total_potential_saving` ne peut pas être négatif.

### 1.6 Économie réalisée

La formulation « économie réalisée » nécessite :

1. une recommandation conservée ;
2. un panier de référence conservé ;
3. un ticket ultérieur validé ;
4. un rapprochement fiable entre les articles recommandés et achetés.

Le modèle v1.4 ne relie pas encore explicitement un snapshot, une liste et un ticket. Cette fonction reste donc **inactive dans la première version**, même si la règle de calcul est définie.

### 1.7 Prix moyen et médiane

Deux références différentes sont utilisées :

- `avg_market_price` dans les snapshots : moyenne des observations admissibles utilisées pour l’affichage de l’économie par article ;
- médiane récente : référence robuste utilisée pour détecter les anomalies.

```text
saving_vs_avg = avg_market_price - best_price
```

Une valeur positive représente une économie.

---

## 2. Fraîcheur des prix

### 2.1 Principe

Un prix expiré reste dans l’historique mais n’est plus utilisé par `comparable_prices`.

La date de fin d’utilisation est enregistrée dans `prices.valid_until`.

### 2.2 Classes du modèle

| `freshness_class` | Validité recommandée | Exemples |
|---|---:|---|
| `fresh` | 7 jours | fruits, légumes, viandes, poissons, produits frais |
| `ambient` | 90 jours | épicerie, boissons, entretien, hygiène |
| `frozen` | 180 jours | surgelés |
| `any` | 30 jours | sous-catégories mixtes ou indéterminées |

La valeur réellement appliquée est `subcategories.default_price_validity_days`.

### 2.3 Priorité de calcul de `valid_until`

1. `promotion_end_date`, lorsqu’elle est connue ;
2. `observed_at + 14 jours` pour une `promo` sans date de fin ;
3. durée de la sous-catégorie ;
4. 30 jours par défaut.

La valeur est figée lors de la création du prix.

### 2.4 Manque de données

PrixMalin ne prolonge pas artificiellement un prix expiré.

Il peut :

1. élargir la zone jusqu’à 50 km ;
2. proposer une comparaison générique autorisée ;
3. afficher qu’aucun prix récent n’est disponible.

---

## 3. Types de prix

Les valeurs autorisées sont :

| Valeur | Signification |
|---|---|
| `normal` | prix courant |
| `promo` | promotion publique |
| `loyalty_card` | prix conditionné à une carte |
| `batch` | prix de lot ou offre multi-achat |

`promotion_end_date` peut être utilisée pour `promo`, `loyalty_card` et `batch`.

Les mécanismes combinés détaillés sont reportés à une version ultérieure.

---

## 4. Détection des prix aberrants

### 4.1 Vérification interne

Le moteur vérifie d’abord :

```text
net_amount = gross_amount - discount_amount
```

et, lorsque les informations existent :

```text
quantity × unit_price ≈ price
```

Une tolérance d’arrondi est admise.

### 4.2 Référence statistique

L’anomalie est mesurée sur le prix normalisé, en priorité :

1. même variante exacte ;
2. même magasin ;
3. même variante dans la zone ;
4. même produit générique avec format comparable.

Au moins cinq observations fiables et récentes sont nécessaires.

### 4.3 Seuils initiaux

```text
ratio = prix observé / médiane
```

| Ratio | Traitement initial |
|---|---|
| 0,50 à 2,00 | admissible |
| 0,25 à moins de 0,50 | revue requise |
| plus de 2,00 à 3,00 | revue requise |
| moins de 0,25 ou plus de 3,00 | neutralisé avant publication |

### 4.4 Représentation dans le modèle initial

Le modèle v1.4 n’introduit pas une liste détaillée de statuts d’anomalie.

- prix admissible : `is_validated = true` ;
- prix suspect ou en revue : `is_validated = false` ;
- prix rejeté, remplacé ou purement historique : `is_archived = true` et `archived_at` renseigné ;
- prix expiré : `valid_until < CURRENT_DATE`.

La vue `comparable_prices` ne retourne que les prix validés, non archivés et non expirés.

### 4.5 Promotions anormalement basses

Un prix bas accompagné d’un indice de promotion peut être enregistré avec le `price_type` approprié, mais reste non validé tant que l’association produit, format et remise n’est pas fiable.

La confirmation communautaire automatique d’un prix suspect est reportée à une évolution ultérieure.

---

## 5. Gestion des doublons de tickets

### 5.1 Idempotence technique

L’application génère `client_scan_id` avant l’envoi.

```text
même client_scan_id
→ retourner le ticket existant
→ ne pas relancer une insertion complète
```

### 5.2 Empreinte métier

`receipt_fingerprint` utilise une représentation canonique comprenant notamment :

- utilisateur ;
- magasin ou enseigne ;
- date et heure disponibles ;
- total ;
- lignes normalisées triées ;
- prix des lignes.

`fingerprint_version` permet de faire évoluer l’algorithme.

### 5.3 Statuts

| `duplicate_status` | Traitement |
|---|---|
| `original` | traitement complet |
| `duplicate` | ligne minimale dans `receipts`, aucune ligne ni prix |
| `suspected_duplicate` | revue utilisateur, aucun prix publié avant décision |

`duplicate_of_receipt_id` est obligatoire pour les deux derniers statuts.

### 5.4 Multi-photos

Une ligne apparaissant dans la zone de chevauchement de deux photos du même ticket ne constitue qu’une ligne de ticket et une seule observation de prix.

---

## 6. Regroupement des observations

Deux tickets différents restent deux preuves différentes dans `prices`.

Pour l’affichage, les observations peuvent être regroupées selon :

```text
product_id
+ product_variant_id éventuel
+ unité et quantité normalisées
+ store_id
+ date
+ prix
```

La version initiale ne stocke pas encore les compteurs communautaires agrégés dans une table dédiée. Ils sont calculés côté serveur lorsque nécessaire.

---

## 7. Règles transversales

### 7.1 Aucune suppression automatique

Les tickets, lignes et prix ne sont pas supprimés automatiquement pour une anomalie métier.

Ils sont neutralisés, archivés ou expirés selon les champs du modèle.

### 7.2 Traçabilité

Les validations des produits sont tracées dans `receipt_lines`, `product_aliases` et `product_variants`.

Une journalisation détaillée des changements de prix pourra être ajoutée ultérieurement si la gouvernance le nécessite.

### 7.3 Seuils configurables

| Seuil | Valeur initiale |
|---|---:|
| Gain minimal du deuxième magasin | 5 € |
| Score générique automatique | 0,95 |
| Score de suggestion | 0,80 |
| Observations minimales pour médiane | 5 |
| Promotion sans date | 14 jours |
| Doublon probable | 95 % de lignes concordantes |

Ces valeurs ne doivent pas être codées à plusieurs endroits sans source de configuration commune.

---

## 8. Correspondance avec le modèle

| Règle | Élément du modèle |
|---|---|
| Fraîcheur | `subcategories.default_price_validity_days`, `prices.valid_until` |
| Type de prix | `prices.price_type` |
| Promotion | `prices.promotion_end_date` |
| Qualité active | `prices.is_validated`, `prices.is_archived` |
| Idempotence | `receipts.client_scan_id` |
| Doublons | `receipt_fingerprint`, `duplicate_status`, `duplicate_of_receipt_id` |
| Économie globale | `recommendation_snapshots.total_potential_saving` |
| Économie article | `recommendation_snapshot_items.saving_vs_avg` |

---

## 9. Versionnage

| Version | Date | Nature |
|---|---|---|
| 1.0 | 29 juin 2026 | Version fondatrice |
| 1.1 | 29 juin 2026 | Première harmonisation des règles |
| 1.2 | 30 juin 2026 | Alignement complet avec le modèle v1.4 : fraîcheur, types de prix, doublons, anomalies et portée initiale des économies |

---

## 10. Documents liés

1. Document 01 v1.2 — Référentiel Produit  
2. Document 02 v1.4 — Modèle de données  
3. Document 03 v1.1 — Product Intelligence Engine  
4. Document 04 v1.2 — présent document  
5. Document 05 v1.1 — Architecture fonctionnelle  
6. Document 06 v1.2 — Plan de migration  

---

*PrixMalin doit préférer une information incomplète mais honnête à une économie calculée sur des données anciennes ou incertaines.*
