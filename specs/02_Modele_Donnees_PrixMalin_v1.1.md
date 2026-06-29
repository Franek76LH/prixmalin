# Modèle de données PrixMalin

## Version : 1.1

**Date : 29 juin 2026**
**Statut : document fondateur — PrixMalin Core**
**Périmètre : tables Supabase, colonnes, relations, slugs stables, sécurité et stratégie de transition**

---

## 0. Objet du document

Ce document définit le modèle de données cible officiel de PrixMalin.

Il a six objectifs :

1. décrire les tables Supabase qui constituent le cœur de l'application ;
2. fixer les relations entre ces tables ;
3. valider les slugs techniques stables avant tout déploiement ;
4. organiser l'apprentissage des libellés abrégés présents sur les tickets ;
5. garantir la compatibilité avec les tables et paramètres existants ;
6. documenter une stratégie de transition progressive, testable et réversible.

Ce document est complémentaire du **Référentiel Produit PrixMalin — document 01**.

Toute modification ultérieure de ce modèle devra être :

* documentée ;
* versionnée ;
* associée à une migration Supabase ;
* testée avant son application en production.

---

# 1. Principes fondateurs du modèle

## 1.1. Séparation des responsabilités

Chaque table possède une responsabilité unique.

| Table              | Responsabilité                                |
| ------------------ | --------------------------------------------- |
| `categories`       | Catégories principales visibles ou techniques |
| `subcategories`    | Sous-catégories rattachées aux catégories     |
| `generic_products` | Produits génériques comparables               |
| `products`         | Références commerciales exactes               |
| `product_aliases`  | Dictionnaire de reconnaissance des tickets    |
| `stores`           | Référentiel des magasins existants            |
| `receipts`         | Tickets scannés                               |
| `receipt_lines`    | Lignes brutes et interprétées des tickets     |
| `prices`           | Observations de prix datées                   |

La structure métier cible est :

```text
Catégorie
→ Sous-catégorie
→ Produit générique
→ Produit de référence
→ Alias de ticket
→ Ligne de ticket
→ Observation de prix
```

---

## 1.2. Le prix n'est jamais une propriété permanente du produit

Un produit ne possède pas un prix unique.

Un prix correspond toujours à une observation contextualisée :

```text
produit
+ magasin
+ date
+ montant
+ source
+ niveau de confiance
```

Deux observations portant sur le même produit doivent pouvoir coexister lorsqu'elles proviennent :

* de dates différentes ;
* de magasins différents ;
* de tickets différents ;
* de sources différentes.

---

## 1.3. Le libellé brut du ticket ne disparaît jamais

Le texte original imprimé sur le ticket doit être conservé dans :

```text
receipt_lines.raw_label
```

Exemple :

```text
LOTUS CONF 12RLX
```

Ce texte ne doit jamais être remplacé par :

```text
Papier toilette Lotus Confort 12 rouleaux
```

Les deux informations sont complémentaires :

| Information       | Exemple                       |
| ----------------- | ----------------------------- |
| Libellé brut      | `LOTUS CONF 12RLX`            |
| Nom interprété    | Papier toilette Lotus Confort |
| Produit reconnu   | Lotus Confort 12 rouleaux     |
| Produit générique | Papier toilette 12 rouleaux   |

La normalisation doit produire une nouvelle valeur sans modifier la donnée brute.

---

## 1.4. Compatibilité avec l'existant

La première mise en œuvre du nouveau modèle est strictement additive.

Il est interdit, pendant la phase initiale, de :

* supprimer une table existante ;
* supprimer une colonne existante ;
* renommer une table existante ;
* renommer une colonne existante ;
* changer le type d'une colonne existante ;
* modifier une contrainte existante sans audit ;
* rendre `price_db` inaccessible à l'application actuelle ;
* remplacer directement `produits_ref`.

Les nouvelles tables sont créées à côté de la structure actuelle.

---

## 1.5. Traçabilité des corrections

Une nouvelle observation ne doit jamais effacer silencieusement une ancienne observation.

Lorsqu'un prix ou un rattachement est corrigé :

* la donnée d'origine reste identifiable ;
* la raison de la correction est conservée ;
* l'auteur de la correction est conservé ;
* la nouvelle valeur référence l'ancienne lorsque nécessaire.

Les valeurs financières historiques ne sont pas écrasées sans traçabilité.

---

## 1.6. Sécurité avant automatisation

Une association incertaine reste une proposition.

PrixMalin doit distinguer :

* les données reconnues avec une confiance élevée ;
* les données nécessitant une confirmation ;
* les données non identifiées ;
* les données contestées.

Une donnée classée dans `non_classe` est préférable à une donnée précisément classée au mauvais endroit.

---

# 2. Slugs techniques stables

Les slugs sont les identifiants techniques permanents des catégories, sous-catégories et produits génériques.

## 2.1. Règles générales

Les slugs doivent être :

* écrits en minuscules ;
* sans accents ;
* au format `snake_case` ;
* uniques dans leur table ;
* indépendants du libellé visible ;
* jamais réutilisés pour une autre entrée ;
* considérés comme définitifs après déploiement.

Le libellé visible peut évoluer.

Le slug ne peut évoluer qu'au moyen d'une migration explicite.

Une suppression logique doit être réalisée au moyen d'un statut ou d'un champ de visibilité. Un slug supprimé ne doit jamais être réattribué à un autre élément.

---

## 2.2. Catégories

|  # | Libellé visible                  | Slug technique            | Visible |
| -: | -------------------------------- | ------------------------- | ------- |
|  1 | Fruits & légumes                 | `fruits_legumes`          | Oui     |
|  2 | Viandes & charcuterie            | `viandes_charcuterie`     | Oui     |
|  3 | Poissons & fruits de mer         | `poissons_fruits_mer`     | Oui     |
|  4 | Produits laitiers & œufs         | `produits_laitiers_oeufs` | Oui     |
|  5 | Épicerie salée                   | `epicerie_salee`          | Oui     |
|  6 | Épicerie sucrée & petit déjeuner | `epicerie_sucree_pdj`     | Oui     |
|  7 | Plats préparés & traiteur        | `plats_prepares_traiteur` | Oui     |
|  8 | Boissons non alcoolisées         | `boissons_non_alco`       | Oui     |
|  9 | Boissons alcoolisées             | `boissons_alco`           | Oui     |
| 10 | Surgelés                         | `surgeles`                | Oui     |
| 11 | Entretien & nettoyage            | `entretien_nettoyage`     | Oui     |
| 12 | Hygiène & beauté                 | `hygiene_beaute`          | Oui     |
| 13 | Bébé                             | `bebe`                    | Oui     |
| 14 | Animalerie                       | `animalerie`              | Oui     |
|  — | Non classé                       | `non_classe`              | Non     |

`non_classe` est une catégorie technique interne.

Elle ne doit jamais apparaître comme une catégorie normale dans l'interface utilisateur.

---

## 2.3. Sous-catégories

| Catégorie                 | Libellé visible                            | Slug technique                 | Visible |
| ------------------------- | ------------------------------------------ | ------------------------------ | ------- |
| `fruits_legumes`          | Fruits frais                               | `fruits_frais`                 | Oui     |
| `fruits_legumes`          | Légumes frais                              | `legumes_frais`                | Oui     |
| `fruits_legumes`          | Salades & herbes                           | `salades_herbes`               | Oui     |
| `fruits_legumes`          | Légumes prêts à l'emploi                   | `legumes_prets_emploi`         | Oui     |
| `viandes_charcuterie`     | Bœuf                                       | `boeuf`                        | Oui     |
| `viandes_charcuterie`     | Porc                                       | `porc`                         | Oui     |
| `viandes_charcuterie`     | Volaille                                   | `volaille`                     | Oui     |
| `viandes_charcuterie`     | Charcuterie                                | `charcuterie`                  | Oui     |
| `viandes_charcuterie`     | Autres viandes                             | `autres_viandes`               | Oui     |
| `poissons_fruits_mer`     | Poisson frais                              | `poisson_frais`                | Oui     |
| `poissons_fruits_mer`     | Fruits de mer & coquillages                | `fruits_mer_coquillages`       | Oui     |
| `poissons_fruits_mer`     | Poisson pané & transformé                  | `poisson_pane_transforme`      | Oui     |
| `produits_laitiers_oeufs` | Lait                                       | `lait`                         | Oui     |
| `produits_laitiers_oeufs` | Beurre & crème                             | `beurre_creme`                 | Oui     |
| `produits_laitiers_oeufs` | Yaourts & desserts lactés                  | `yaourts_desserts_lactes`      | Oui     |
| `produits_laitiers_oeufs` | Fromages                                   | `fromages`                     | Oui     |
| `produits_laitiers_oeufs` | Œufs                                       | `oeufs`                        | Oui     |
| `epicerie_salee`          | Pâtes                                      | `pates`                        | Oui     |
| `epicerie_salee`          | Riz, semoules & céréales                   | `riz_semoules_cereales`        | Oui     |
| `epicerie_salee`          | Sauces & condiments                        | `sauces_condiments`            | Oui     |
| `epicerie_salee`          | Conserves                                  | `conserves`                    | Oui     |
| `epicerie_salee`          | Apéritif salé                              | `aperitif_sale`                | Oui     |
| `epicerie_salee`          | Huiles, vinaigres & assaisonnements        | `huiles_vinaigres`             | Oui     |
| `epicerie_salee`          | Farines & aides culinaires                 | `farines_aides_culinaires`     | Oui     |
| `epicerie_sucree_pdj`     | Petit déjeuner & pains emballés            | `petit_dejeuner_pains`         | Oui     |
| `epicerie_sucree_pdj`     | Biscuits & gâteaux                         | `biscuits_gateaux`             | Oui     |
| `epicerie_sucree_pdj`     | Chocolat & confiserie                      | `chocolat_confiserie`          | Oui     |
| `epicerie_sucree_pdj`     | Compotes, confitures & miel                | `compotes_confitures_miel`     | Oui     |
| `epicerie_sucree_pdj`     | Sucre & aides pâtisserie                   | `sucre_patisserie`             | Oui     |
| `plats_prepares_traiteur` | Pizzas & tartes salées                     | `pizzas_tartes_salees`         | Oui     |
| `plats_prepares_traiteur` | Pâtes & plats frais                        | `pates_plats_frais`            | Oui     |
| `plats_prepares_traiteur` | Salades & traiteur                         | `salades_traiteur`             | Oui     |
| `plats_prepares_traiteur` | Desserts frais                             | `desserts_frais`               | Oui     |
| `boissons_non_alco`       | Eaux                                       | `eaux`                         | Oui     |
| `boissons_non_alco`       | Sodas & colas                              | `sodas_colas`                  | Oui     |
| `boissons_non_alco`       | Jus & nectars                              | `jus_nectars`                  | Oui     |
| `boissons_non_alco`       | Café, thé & boissons chaudes               | `cafe_the_chaud`               | Oui     |
| `boissons_non_alco`       | Sirops & boissons fonctionnelles           | `sirops_boissons_fonct`        | Oui     |
| `boissons_alco`           | Bières                                     | `bieres`                       | Oui     |
| `boissons_alco`           | Vins                                       | `vins`                         | Oui     |
| `boissons_alco`           | Champagnes & effervescents                 | `champagnes_effervescents`     | Oui     |
| `boissons_alco`           | Spiritueux & apéritifs                     | `spiritueux_aperitifs`         | Oui     |
| `surgeles`                | Légumes & frites surgelés                  | `legumes_frites_surgeles`      | Oui     |
| `surgeles`                | Plats cuisinés surgelés                    | `plats_cuisines_surgeles`      | Oui     |
| `surgeles`                | Viandes, poissons & fruits de mer surgelés | `viandes_poissons_surgeles`    | Oui     |
| `surgeles`                | Glaces & desserts glacés                   | `glaces_desserts_glaces`       | Oui     |
| `surgeles`                | Pains & viennoiseries surgelés             | `pains_viennoiseries_surgeles` | Oui     |
| `entretien_nettoyage`     | Vaisselle                                  | `vaisselle`                    | Oui     |
| `entretien_nettoyage`     | Sols & surfaces                            | `sols_surfaces`                | Oui     |
| `entretien_nettoyage`     | Linge & lessive                            | `linge_lessive`                | Oui     |
| `entretien_nettoyage`     | Papiers & consommables ménagers            | `papiers_consommables`         | Oui     |
| `entretien_nettoyage`     | Accessoires ménagers                       | `accessoires_menagers`         | Oui     |
| `hygiene_beaute`          | Hygiène corps & cheveux                    | `hygiene_corps_cheveux`        | Oui     |
| `hygiene_beaute`          | Soins dentaires                            | `soins_dentaires`              | Oui     |
| `hygiene_beaute`          | Papier & coton                             | `papier_coton`                 | Oui     |
| `hygiene_beaute`          | Soins visage & beauté                      | `soins_visage_beaute`          | Oui     |
| `hygiene_beaute`          | Rasage & épilation                         | `rasage_epilation`             | Oui     |
| `bebe`                    | Couches & lingettes                        | `couches_lingettes`            | Oui     |
| `bebe`                    | Alimentation bébé                          | `alimentation_bebe`            | Oui     |
| `bebe`                    | Soins & toilette bébé                      | `soins_toilette_bebe`          | Oui     |
| `animalerie`              | Alimentation                               | `alimentation_animaux`         | Oui     |
| `animalerie`              | Hygiène & litière                          | `hygiene_litiere`              | Oui     |
| `animalerie`              | Accessoires                                | `accessoires_animaux`          | Oui     |
| `non_classe`              | Non classé                                 | `non_classe`                   | Non     |

---

## 2.4. Produit générique technique

La sous-catégorie technique `non_classe` doit contenir un produit générique technique :

| Sous-catégorie | Libellé            | Slug                 | Visible |
| -------------- | ------------------ | -------------------- | ------- |
| `non_classe`   | Produit non classé | `produit_non_classe` | Non     |

Ce produit est utilisé temporairement lorsqu'aucun rattachement fiable n'est possible.

Il ne doit jamais être proposé comme un produit normal dans le catalogue utilisateur.

---

# 3. Vue d'ensemble du modèle

```text
categories
    ↓
subcategories
    ↓
generic_products
    ↓
products
    ↑
product_aliases
    ↑
receipt_lines
    ↑
receipts

receipt_lines
    ↓
prices
    ↑
stores
```

Vue fonctionnelle :

```text
Ticket scanné
    ↓
receipts
    ↓
receipt_lines.raw_label
    ↓
product_aliases
    ↓
products ou generic_products
    ↓
prices
```

---

# 4. Schéma des tables

## 4.1. Table `categories`

Classification de niveau 1.

| Colonne      | Type        | Contrainte                      | Description                     |
| ------------ | ----------- | ------------------------------- | ------------------------------- |
| `id`         | uuid        | PK, default `gen_random_uuid()` | Identifiant interne             |
| `slug`       | text        | UNIQUE, NOT NULL                | Identifiant technique stable    |
| `label`      | text        | NOT NULL                        | Libellé visible                 |
| `position`   | smallint    | NOT NULL, supérieur ou égal à 0 | Ordre d'affichage               |
| `is_visible` | boolean     | default true                    | False pour les états techniques |
| `is_active`  | boolean     | default true                    | Désactivation sans suppression  |
| `created_at` | timestamptz | default now()                   | Date de création                |
| `updated_at` | timestamptz | default now()                   | Date de dernière modification   |

### Règles

* Un slug n'est jamais réutilisé.
* Une catégorie utilisée ne doit pas être supprimée physiquement.
* `non_classe` possède `is_visible = false`.
* Une modification du label ne modifie jamais le slug.

---

## 4.2. Table `subcategories`

Classification de niveau 2.

| Colonne       | Type        | Contrainte                      | Description             |
| ------------- | ----------- | ------------------------------- | ----------------------- |
| `id`          | uuid        | PK, default `gen_random_uuid()` |                         |
| `category_id` | uuid        | FK → `categories(id)`, NOT NULL | Catégorie parente       |
| `slug`        | text        | UNIQUE, NOT NULL                | Identifiant stable      |
| `label`       | text        | NOT NULL                        | Libellé visible         |
| `position`    | smallint    | NOT NULL, supérieur ou égal à 0 | Ordre dans la catégorie |
| `is_visible`  | boolean     | default true                    | False pour `non_classe` |
| `is_active`   | boolean     | default true                    | Désactivation logique   |
| `created_at`  | timestamptz | default now()                   |                         |
| `updated_at`  | timestamptz | default now()                   |                         |

### Règles

* Une sous-catégorie ne peut appartenir qu'à une seule catégorie.
* Une sous-catégorie utilisée ne doit pas être supprimée physiquement.
* La sous-catégorie technique `non_classe` appartient à la catégorie technique `non_classe`.

---

## 4.3. Table `generic_products`

Niveau 3 du référentiel.

Un produit générique représente un besoin ou un type de produit comparable.

Exemples :

```text
Penne
Jambon blanc
Camembert
Cola sans sucre
Papier toilette 12 rouleaux
```

| Colonne          | Type        | Contrainte                         | Description                     |
| ---------------- | ----------- | ---------------------------------- | ------------------------------- |
| `id`             | uuid        | PK, default `gen_random_uuid()`    |                                 |
| `subcategory_id` | uuid        | FK → `subcategories(id)`, NOT NULL | Sous-catégorie parente          |
| `slug`           | text        | UNIQUE, NOT NULL                   | Identifiant technique stable    |
| `label`          | text        | NOT NULL                           | Nom officiel                    |
| `is_visible`     | boolean     | default true                       | False pour le produit technique |
| `is_active`      | boolean     | default true                       | Désactivation logique           |
| `created_at`     | timestamptz | default now()                      |                                 |
| `updated_at`     | timestamptz | default now()                      |                                 |

### Règles

* Un produit générique appartient à une seule sous-catégorie.
* Le produit `produit_non_classe` est invisible.
* Un produit générique utilisé dans un historique ne doit pas être supprimé physiquement.

---

## 4.4. Table `products`

Références commerciales exactes.

Exemple :

```text
Barilla Penne Rigate n°73 — 500 g — EAN 8076802085738
```

| Colonne              | Type        | Contrainte                            | Description                                  |
| -------------------- | ----------- | ------------------------------------- | -------------------------------------------- |
| `id`                 | uuid        | PK, default `gen_random_uuid()`       |                                              |
| `generic_product_id` | uuid        | FK → `generic_products(id)`, NOT NULL | Produit générique parent                     |
| `brand`              | text        |                                       | Marque commerciale                           |
| `product_name`       | text        | NOT NULL                              | Nom officiel complet                         |
| `quantity`           | numeric     | supérieur à 0 si renseigné            | Quantité d'une unité                         |
| `unit`               | text        |                                       | g, kg, ml, cl, l, pièce, rouleau…            |
| `packaging`          | smallint    | default 1, supérieur ou égal à 1      | Nombre d'unités                              |
| `ean`                | text        | UNIQUE si renseigné                   | Code EAN ou GTIN                             |
| `image_url`          | text        |                                       | Image produit                                |
| `nutriscore`         | char(1)     | A, B, C, D ou E                       | Nutri-Score                                  |
| `source`             | text        | Valeur contrôlée                      | scan, drive, open_food_facts, manuel, import |
| `confidence_score`   | numeric     | entre 0 et 1                          | Fiabilité de la référence                    |
| `status`             | text        | default `active`                      | active, inactive, duplicate, contested       |
| `created_at`         | timestamptz | default now()                         |                                              |
| `updated_at`         | timestamptz | default now()                         |                                              |

### Règles

* Un EAN renseigné doit être unique.
* Un produit exact appartient à un seul produit générique.
* Un produit en doublon n'est pas supprimé : son statut devient `duplicate`.
* Un produit historique ne doit pas être supprimé physiquement.

---

## 4.5. Table `product_aliases`

Dictionnaire de reconnaissance des libellés de tickets.

Cette table permet à PrixMalin d'apprendre que plusieurs libellés correspondent au même produit.

Exemple :

| Enseigne    | Alias                |
| ----------- | -------------------- |
| Carrefour   | `LOTUS CONF 12RLX`   |
| E.Leclerc   | `P WC LOTUS CFT X12` |
| Intermarché | `PQ LOTUS CONF 12R`  |

Ces alias peuvent tous pointer vers :

```text
Papier toilette Lotus Confort 12 rouleaux
```

### Colonnes

| Colonne              | Type        | Contrainte                            | Description                                       |
| -------------------- | ----------- | ------------------------------------- | ------------------------------------------------- |
| `id`                 | uuid        | PK, default `gen_random_uuid()`       |                                                   |
| `alias_text`         | text        | NOT NULL                              | Texte brut exact observé                          |
| `normalized_alias`   | text        | NOT NULL                              | Texte normalisé pour la recherche                 |
| `product_id`         | uuid        | FK → `products(id)`, nullable         | Produit exact si identifié                        |
| `generic_product_id` | uuid        | FK → `generic_products(id)`, NOT NULL | Produit générique reconnu                         |
| `store_brand`        | text        | nullable                              | Enseigne concernée                                |
| `store_id`           | uuid        | FK → `stores(id)`, nullable           | Magasin précis si nécessaire                      |
| `source`             | text        | Valeur contrôlée                      | ticket, manuel, import, intelligence_artificielle |
| `confidence_score`   | numeric     | entre 0 et 1                          | Niveau de confiance                               |
| `status`             | text        | default `candidate`                   | candidate, validated, contested, disabled         |
| `times_seen`         | integer     | default 1, supérieur ou égal à 1      | Nombre d'occurrences                              |
| `last_seen_at`       | timestamptz | default now()                         | Dernière observation                              |
| `validated_by`       | uuid        | FK → `profiles(id)`, nullable         | Validateur                                        |
| `validated_at`       | timestamptz | nullable                              | Date de validation                                |
| `created_at`         | timestamptz | default now()                         |                                                   |
| `updated_at`         | timestamptz | default now()                         |                                                   |

### Règles de cohérence

1. `generic_product_id` est toujours renseigné.
2. Si le produit n'est pas identifiable, l'alias pointe temporairement vers `produit_non_classe`.
3. Si `product_id` est renseigné, son `generic_product_id` doit correspondre au `generic_product_id` de l'alias.
4. Un alias validé ne peut pas pointer vers une destination vide.
5. Un alias désactivé n'est pas utilisé pour la reconnaissance automatique.
6. Un alias spécifique à un magasin est prioritaire sur un alias d'enseigne.
7. Un alias d'enseigne est prioritaire sur un alias global.

### Portée de reconnaissance

Ordre de recherche :

```text
1. normalized_alias + store_id
2. normalized_alias + store_brand
3. normalized_alias global
4. recherche intelligente
5. validation utilisateur
```

### Unicité logique

Un alias actif ou validé ne doit pas être dupliqué dans une même portée.

Exemples de clés logiques :

```text
normalized_alias + store_id
```

ou, lorsque `store_id` est vide :

```text
normalized_alias + store_brand
```

---

## 4.6. Table `stores`

`stores` est une table existante.

Elle ne doit pas être supprimée, renommée ou reconstruite pendant la première phase.

Les colonnes actuellement utilisées par le code doivent être conservées :

| Colonne observée | Description                       |
| ---------------- | --------------------------------- |
| `id`             | Identifiant du magasin            |
| `enseigne`       | Identifiant ou slug de l'enseigne |
| `name`           | Nom du magasin                    |
| `address`        | Adresse                           |
| `latitude`       | Latitude                          |
| `longitude`      | Longitude                         |

Toute autre colonne déjà présente dans Supabase doit également être conservée.

### Règle impérative

Avant toute évolution de `stores`, un audit du schéma réel Supabase doit être réalisé.

Le présent document ne demande :

* aucun renommage de `enseigne` vers `brand` ;
* aucune suppression de colonne ;
* aucune modification de type ;
* aucune migration immédiate de cette table.

Des colonnes complémentaires comme `city` ou `postal_code` pourront être ajoutées ultérieurement, uniquement après validation.

---

## 4.7. Table `receipts`

Un ticket scanné correspond à une entrée dans cette table.

| Colonne             | Type        | Contrainte                       | Description                                         |
| ------------------- | ----------- | -------------------------------- | --------------------------------------------------- |
| `id`                | uuid        | PK, default `gen_random_uuid()`  |                                                     |
| `client_scan_id`    | uuid        | UNIQUE, nullable                 | Identifiant anti-doublon généré par l'application   |
| `user_id`           | uuid        | FK → `profiles(id)`, NOT NULL    | Utilisateur ayant scanné                            |
| `store_id`          | uuid        | FK → `stores(id)`, nullable      | Magasin exact                                       |
| `store_brand`       | text        | nullable                         | Enseigne reconnue                                   |
| `store_name_raw`    | text        | nullable                         | Nom brut lu sur le ticket                           |
| `store_address_raw` | text        | nullable                         | Adresse brute lue                                   |
| `receipt_date`      | date        | nullable                         | Date du ticket                                      |
| `total_amount`      | numeric     | supérieur ou égal à 0            | Total du ticket si lisible                          |
| `scan_source`       | text        | Valeur contrôlée                 | ocr_photo, ocr_multi_photo, manuel, import          |
| `image_count`       | smallint    | default 1, supérieur ou égal à 1 | Nombre d'images                                     |
| `ocr_raw_text`      | text        | nullable                         | Texte brut complet si disponible                    |
| `status`            | text        | default `pending`                | pending, processing, processed, needs_review, error |
| `processing_error`  | text        | nullable                         | Erreur technique éventuelle                         |
| `created_at`        | timestamptz | default now()                    |                                                     |
| `processed_at`      | timestamptz | nullable                         | Fin du traitement                                   |

### Règles

* `client_scan_id` évite de créer deux fois le même ticket lors d'un nouvel envoi.
* Une erreur de traitement ne provoque pas la suppression du ticket.
* Les données brutes du magasin sont conservées même après rattachement à `stores`.

---

## 4.8. Table `receipt_lines`

Chaque ligne produit d'un ticket correspond à une entrée dans cette table.

Cette table conserve à la fois :

* la donnée brute ;
* l'interprétation de l'intelligence artificielle ;
* les corrections utilisateur ;
* le rattachement final.

### Colonnes

| Colonne                   | Type        | Contrainte                            | Description                                |
| ------------------------- | ----------- | ------------------------------------- | ------------------------------------------ |
| `id`                      | uuid        | PK, default `gen_random_uuid()`       |                                            |
| `receipt_id`              | uuid        | FK → `receipts(id)`, NOT NULL         | Ticket parent                              |
| `line_position`           | integer     | supérieur ou égal à 1                 | Position sur le ticket                     |
| `raw_label`               | text        | NOT NULL                              | Libellé exact du ticket                    |
| `normalized_label`        | text        | nullable                              | Version normalisée                         |
| `detected_brand`          | text        | nullable                              | Marque détectée par l'IA                   |
| `detected_name`           | text        | nullable                              | Nom interprété par l'IA                    |
| `detected_format`         | text        | nullable                              | Format interprété                          |
| `assigned_subcategory_id` | uuid        | FK → `subcategories(id)`, nullable    | Classement retenu                          |
| `quantity`                | numeric     | default 1, supérieur à 0              | Quantité achetée                           |
| `unit_price`              | numeric     | supérieur ou égal à 0                 | Prix d'un article ou conditionnement       |
| `total_price`             | numeric     | supérieur ou égal à 0                 | Total de la ligne                          |
| `matched_product_id`      | uuid        | FK → `products(id)`, nullable         | Produit exact reconnu                      |
| `matched_generic_id`      | uuid        | FK → `generic_products(id)`, nullable | Produit générique reconnu                  |
| `matched_alias_id`        | uuid        | FK → `product_aliases(id)`, nullable  | Alias utilisé                              |
| `confidence_score`        | numeric     | entre 0 et 1                          | Niveau de confiance                        |
| `validation_status`       | text        | default `pending`                     | pending, validated, rejected, needs_review |
| `validated_by`            | uuid        | FK → `profiles(id)`, nullable         | Validateur                                 |
| `validated_at`            | timestamptz | nullable                              | Date de validation                         |
| `created_at`              | timestamptz | default now()                         |                                            |
| `updated_at`              | timestamptz | default now()                         |                                            |

### Règles

1. `raw_label` ne doit jamais être modifié.
2. Une correction utilisateur modifie les champs interprétés ou les rattachements, jamais le texte brut.
3. Lorsqu'une ligne est validée, `matched_generic_id` doit être renseigné.
4. Si le produit reste inconnu, `matched_generic_id` pointe vers `produit_non_classe`.
5. Si `matched_product_id` est renseigné, son produit générique doit correspondre à `matched_generic_id`.
6. Si `assigned_subcategory_id` est renseigné et qu'un produit générique est sélectionné, leurs sous-catégories doivent être cohérentes.
7. Une ligne rejetée ne produit pas automatiquement d'observation de prix.

---

## 4.9. Table `prices`

Historique des observations de prix.

Une observation représente un fait daté.

### Définition des prix

| Champ            | Signification                                               |
| ---------------- | ----------------------------------------------------------- |
| `unit_price`     | Prix d'un article ou d'un conditionnement extrait du ticket |
| `price`          | Prix validé utilisé par le comparateur                      |
| `line_total`     | Montant total de la ligne après application de la quantité  |
| `price_per_unit` | Prix normalisé au kg, litre, pièce, rouleau ou autre unité  |

### Exemple

Ticket :

```text
2 paquets de 500 g à 3,50 € chacun
```

| Champ            |    Valeur |
| ---------------- | --------: |
| `line_quantity`  |         2 |
| `unit_price`     |    3,50 € |
| `price`          |    3,50 € |
| `line_total`     |    7,00 € |
| `price_per_unit` | 7,00 €/kg |

### Colonnes

| Colonne               | Type        | Contrainte                            | Description                             |
| --------------------- | ----------- | ------------------------------------- | --------------------------------------- |
| `id`                  | uuid        | PK, default `gen_random_uuid()`       |                                         |
| `product_id`          | uuid        | FK → `products(id)`, nullable         | Produit exact                           |
| `generic_product_id`  | uuid        | FK → `generic_products(id)`, NOT NULL | Produit générique                       |
| `store_id`            | uuid        | FK → `stores(id)`, nullable           | Magasin exact                           |
| `receipt_line_id`     | uuid        | FK → `receipt_lines(id)`, nullable    | Ligne source                            |
| `user_id`             | uuid        | FK → `profiles(id)`, NOT NULL         | Auteur de l'observation                 |
| `unit_price`          | numeric     | supérieur à 0                         | Prix extrait pour une unité achetée     |
| `price`               | numeric     | NOT NULL, supérieur à 0               | Prix validé utilisé dans PrixMalin      |
| `line_quantity`       | numeric     | default 1, supérieur à 0              | Quantité achetée                        |
| `line_total`          | numeric     | supérieur à 0                         | Total de la ligne                       |
| `price_per_unit`      | numeric     | supérieur à 0 si renseigné            | Prix au kg, litre, pièce…               |
| `quantite`            | numeric     | supérieur à 0 si renseigné            | Contenu d'une unité                     |
| `unite`               | text        | nullable                              | g, kg, ml, cl, l, pièce, rouleau…       |
| `conditionnement`     | smallint    | default 1, supérieur ou égal à 1      | Nombre d'unités dans le paquet          |
| `observed_at`         | date        | NOT NULL                              | Date de l'observation                   |
| `source`              | text        | Valeur contrôlée                      | ticket, manuel, import, drive           |
| `confidence_score`    | numeric     | entre 0 et 1                          | Fiabilité                               |
| `status`              | text        | default `active`                      | active, superseded, contested, rejected |
| `supersedes_price_id` | uuid        | FK → `prices(id)`, nullable           | Observation corrigée                    |
| `correction_reason`   | text        | nullable                              | Justification                           |
| `created_at`          | timestamptz | default now()                         |                                         |
| `created_by`          | uuid        | FK → `profiles(id)`, NOT NULL         | Auteur technique ou utilisateur         |

### Règles

1. `generic_product_id` est toujours renseigné.
2. `product_id` peut être vide lorsque seule l'équivalence générique est connue.
3. `receipt_line_id` peut être vide pour une saisie manuelle ou un import.
4. Une ligne de ticket ne doit produire qu'une observation active principale.
5. Une nouvelle observation ne remplace jamais automatiquement une observation plus ancienne.
6. Une correction crée une nouvelle ligne avec `supersedes_price_id`.
7. L'ancienne ligne peut passer au statut `superseded`, mais ses montants d'origine ne sont pas écrasés.
8. Une observation rejetée ou contestée n'est pas utilisée dans le comparateur par défaut.
9. Les prix doivent être strictement positifs.
10. Les dates futures doivent être refusées ou envoyées en validation manuelle.

---

# 5. Contraintes de cohérence

## 5.1. Scores de confiance

Tous les champs `confidence_score` doivent respecter :

```text
0 ≤ confidence_score ≤ 1
```

Exemples :

|       Score | Interprétation indicative |
| ----------: | ------------------------- |
|    0 à 0,49 | Faible                    |
| 0,50 à 0,79 | Moyen                     |
| 0,80 à 0,94 | Élevé                     |
|    0,95 à 1 | Très élevé ou validé      |

Les seuils métier définitifs seront précisés dans le document 04.

---

## 5.2. Statuts contrôlés

Les valeurs de statut doivent être limitées aux listes définies dans ce document.

Une valeur libre comme :

```text
ok
bonjour
terminé
```

ne doit pas être acceptée dans un champ de statut.

Les contraintes peuvent être réalisées au moyen :

* de contraintes `CHECK` ;
* de types enum PostgreSQL ;
* ou de tables de référence.

Les contraintes `CHECK` sont privilégiées pour la première version afin de simplifier les migrations futures.

---

## 5.3. Valeurs numériques

Les règles suivantes doivent être appliquées :

* quantité strictement positive ;
* prix strictement positif ;
* conditionnement supérieur ou égal à 1 ;
* position supérieure ou égale à 0 ;
* nombre d'occurrences supérieur ou égal à 1 ;
* Nutri-Score limité à A, B, C, D ou E.

---

## 5.4. Clés étrangères

Principe général :

* aucune suppression en cascade sur les référentiels produits ;
* utilisation de `RESTRICT` pour empêcher les suppressions dangereuses ;
* utilisation de `SET NULL` uniquement pour les liens facultatifs ;
* aucune suppression physique d'un élément déjà utilisé dans un historique.

---

# 6. Sécurité et RLS Supabase

Les nouvelles tables doivent utiliser les politiques RLS de Supabase.

## 6.1. Tables de référentiel

Tables concernées :

```text
categories
subcategories
generic_products
products
product_aliases
```

Règles :

* lecture autorisée aux utilisateurs authentifiés ;
* écriture réservée à un rôle administrateur, une fonction serveur ou un processus validé ;
* un utilisateur normal ne peut pas valider globalement un alias sans règle métier.

---

## 6.2. Données utilisateur

Tables concernées :

```text
receipts
receipt_lines
prices
```

Règles :

* un utilisateur peut consulter ses propres tickets ;
* un utilisateur peut consulter ses propres lignes de tickets ;
* un utilisateur peut créer ses propres observations ;
* les données partagées avec la communauté doivent suivre les règles définies pour `community_prices` ;
* les écritures sensibles doivent passer par une fonction serveur.

---

## 6.3. Clés et secrets

Les clés suivantes ne doivent jamais être exposées dans le navigateur :

```text
SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY
clé privée OCR
```

Les traitements nécessitant ces clés doivent être exécutés :

* dans une Edge Function Supabase ;
* dans une fonction serveur ;
* ou dans un environnement sécurisé.

---

# 7. Traitement transactionnel d'un ticket

La création d'un ticket peut nécessiter plusieurs écritures :

```text
receipts
receipt_lines
product_aliases
prices
price_db
community_prices
```

Ces écritures ne doivent pas être exécutées comme des opérations totalement indépendantes depuis le navigateur.

## 7.1. Principe

Le traitement doit être centralisé dans :

* une fonction PostgreSQL appelée par RPC ;
* ou une fonction serveur capable d'appeler une transaction PostgreSQL.

## 7.2. Objectif

Toutes les écritures critiques réussissent ensemble ou échouent ensemble.

Exemple :

| Étape               | Résultat                     |
| ------------------- | ---------------------------- |
| Création du ticket  | Réussie                      |
| Création des lignes | Réussie                      |
| Création des prix   | Échec                        |
| Résultat global     | Annulation de la transaction |

Cela évite les tickets incomplets ou les prix sans ligne source.

## 7.3. Idempotence

`receipts.client_scan_id` doit permettre d'éviter la création de doublons lorsque :

* le réseau se coupe ;
* l'utilisateur clique deux fois ;
* l'application renvoie la même requête ;
* une fonction est relancée après un délai.

---

# 8. Stratégie de transition

## 8.1. Phase 0 — Audit préalable

Avant toute création ou migration :

1. exporter le schéma réel des tables existantes ;
2. auditer `price_db` ;
3. auditer `produits_ref` ;
4. auditer `stores` ;
5. vérifier les contraintes et politiques RLS ;
6. sauvegarder les données existantes ;
7. documenter un point de retour.

Aucune table existante n'est modifiée pendant cet audit.

---

## 8.2. Phase 1 — Création additive

Les nouvelles tables sont créées :

```text
categories
subcategories
generic_products
products
product_aliases
receipts
receipt_lines
prices
```

Pendant cette phase :

* `price_db` continue de fonctionner comme aujourd'hui ;
* `produits_ref` continue de fonctionner comme aujourd'hui ;
* `stores` continue de fonctionner comme aujourd'hui ;
* le comparateur actuel n'est pas modifié ;
* aucun paramètre existant n'est supprimé ou renommé.

La nouvelle structure est alimentée uniquement avec des données de test contrôlées.

---

## 8.3. Phase 2 — Double écriture contrôlée

Après validation des nouvelles tables, les nouveaux scans écrivent simultanément dans :

```text
receipts
receipt_lines
prices
product_aliases si nécessaire
price_db pour maintenir la compatibilité
```

`price_db` n'est donc pas encore en lecture seule pendant cette phase.

Elle continue à recevoir les données nécessaires au comparateur existant.

La double écriture doit être centralisée dans une transaction ou une fonction serveur.

---

## 8.4. Phase 3 — Validation en production

La nouvelle structure est comparée à `price_db`.

Contrôles obligatoires :

* nombre de tickets ;
* nombre de lignes ;
* prix enregistrés ;
* magasins ;
* catégories ;
* rattachements produits ;
* absence de doublons ;
* cohérence des totaux ;
* comportement du comparateur.

Un échantillon minimum de 50 articles doit être vérifié manuellement.

---

## 8.5. Phase 4 — Migration du comparateur

Le comparateur est progressivement modifié pour lire :

```text
prices
products
generic_products
stores
```

Pendant cette phase, une possibilité de retour à `price_db` doit rester disponible.

Lorsque le fonctionnement est validé :

* les nouvelles lectures deviennent prioritaires ;
* `price_db` reste disponible comme source historique ;
* aucune suppression n'est réalisée.

---

## 8.6. Phase 5 — Passage de `price_db` en lecture seule

`price_db` devient réellement en lecture seule uniquement lorsque :

1. les nouveaux scans fonctionnent dans la nouvelle structure ;
2. le comparateur n'a plus besoin d'écrire dans `price_db` ;
3. les contrôles de cohérence sont validés ;
4. un point de retour est disponible ;
5. la migration des données historiques est prête.

La fin de la double écriture constitue une décision de déploiement distincte.

---

## 8.7. Phase 6 — Migration des données historiques

La migration des 561 articles existants de `price_db` est déclenchée uniquement après :

1. export complet de `price_db` ;
2. sauvegarde horodatée ;
3. audit avec le skill `audit-prixmalin` ;
4. correspondance avec les produits génériques ;
5. test sur un échantillon de 50 articles ;
6. contrôle des magasins ;
7. validation des prix ;
8. documentation du retour arrière.

Les lignes ambiguës restent dans un état technique `non_classe`.

---

## 8.8. Migration de `produits_ref`

`produits_ref` n'est pas remplacée directement.

La migration intervient uniquement après :

1. export complet ;
2. inventaire des colonnes ;
3. inventaire des produits ;
4. comparaison avec `categories`, `subcategories` et `generic_products` ;
5. migration des éléments réutilisables ;
6. validation du code dépendant de `produits_ref`.

Tant que cette validation n'est pas terminée, `produits_ref` reste active et inchangée.

---

# 9. Tables existantes conservées

| Table              | Statut initial | Action                                         |
| ------------------ | -------------- | ---------------------------------------------- |
| `price_db`         | Active         | Double écriture temporaire, puis lecture seule |
| `produits_ref`     | Active         | Audit puis migration progressive               |
| `stores`           | Active         | Structure conservée                            |
| `profiles`         | Active         | Structure conservée                            |
| `shopping_list`    | Active         | Structure conservée                            |
| `favorites`        | Active         | Structure conservée                            |
| `community_prices` | Active         | Compatibilité à maintenir                      |
| `archives`         | Active         | Compatibilité à maintenir                      |
| `circles`          | Active         | Compatibilité à maintenir                      |

Aucune de ces tables ne doit être supprimée par la migration initiale.

---

# 10. Ordre de création des nouvelles tables

Ordre recommandé :

1. `categories`
2. `subcategories`
3. `generic_products`
4. `products`
5. `product_aliases`
6. `receipts`
7. `receipt_lines`
8. `prices`

Après création :

9. insertion du référentiel des catégories ;
10. insertion des sous-catégories ;
11. insertion de `non_classe` ;
12. création des index ;
13. création des contraintes ;
14. activation des politiques RLS ;
15. création de la fonction transactionnelle ;
16. tests hors production ;
17. activation progressive.

---

# 11. Index recommandés

Index minimum :

```text
categories.slug
subcategories.slug
subcategories.category_id
generic_products.slug
generic_products.subcategory_id
products.generic_product_id
products.ean
product_aliases.normalized_alias
product_aliases.store_brand
product_aliases.store_id
product_aliases.product_id
product_aliases.generic_product_id
receipts.user_id
receipts.store_id
receipts.receipt_date
receipt_lines.receipt_id
receipt_lines.normalized_label
receipt_lines.matched_product_id
receipt_lines.matched_generic_id
prices.product_id
prices.generic_product_id
prices.store_id
prices.observed_at
prices.user_id
```

Des index composites pourront être ajoutés selon les requêtes réelles du comparateur.

---

# 12. Vérifications obligatoires avant déploiement

Avant chaque migration :

* sauvegarde de la base ;
* test sur un environnement distinct ;
* vérification du nombre de lignes ;
* vérification des contraintes ;
* vérification des politiques RLS ;
* vérification de la fonction de retour arrière ;
* test du scan une photo ;
* test du scan multi-photo ;
* test de la saisie manuelle ;
* test des magasins connus et inconnus ;
* test d'un produit non classé ;
* test d'un alias connu ;
* test d'un alias ambigu ;
* test de la double écriture ;
* test de l'idempotence ;
* test du comparateur existant.

---

# 13. Versionnage

| Version | Date         | Nature                                                                               |
| ------- | ------------ | ------------------------------------------------------------------------------------ |
| 1.0     | 29 juin 2026 | Première version fondatrice                                                          |
| 1.1     | 29 juin 2026 | Compatibilité renforcée, transition corrigée, alias sécurisés et traçabilité ajoutée |

---

# 14. Modifications apportées en version 1.1

La version 1.1 ajoute ou corrige :

1. la distinction entre création additive, double écriture et lecture seule ;
2. l'interdiction de rendre immédiatement `price_db` en lecture seule ;
3. la conservation stricte des tables existantes ;
4. l'alignement de `stores` sur les colonnes réellement utilisées ;
5. la sous-catégorie technique `non_classe` ;
6. le produit générique technique `produit_non_classe` ;
7. la conservation du libellé brut du ticket ;
8. la conservation des champs détectés par l'IA ;
9. le rattachement d'un alias à une enseigne ou à un magasin précis ;
10. les règles de cohérence des alias ;
11. les champs nécessaires à la saisie manuelle ;
12. la distinction entre prix unitaire, prix validé, total de ligne et prix normalisé ;
13. la traçabilité des corrections de prix ;
14. les contraintes sur les scores, statuts et montants ;
15. les règles RLS ;
16. la transaction de traitement d'un ticket ;
17. l'idempotence des scans ;
18. les index minimums ;
19. les tests obligatoires avant déploiement.

---

# 15. Documents liés au PrixMalin Core

1. **Référentiel Produit PrixMalin** — document 01
2. **Modèle de données Supabase** — présent document
3. **Product Intelligence Engine** — reconnaissance ticket vers produit
4. **Règles métier PrixMalin** — scores, validation et économies
5. **Architecture fonctionnelle** — interactions entre modules
6. **Plan de migration Supabase** — scripts, tests et retour arrière

---

*Document fondateur PrixMalin — toute création ou modification de table Supabase doit respecter ce modèle, la compatibilité avec l'existant et les procédures de migration validées.*
