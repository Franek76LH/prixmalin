# Règles métier PrixMalin
## Version : 1.1
**Date : 29 juin 2026**
**Statut : document fondateur — PrixMalin Core**
**Périmètre : calcul des économies, fraîcheur des prix, détection des anomalies, gestion des doublons**

---

## 0. Objet du document

Ce document définit les règles métier qui gouvernent le comportement de PrixMalin.

Il a quatre objectifs :

1. définir comment les économies sont calculées et présentées à l'utilisateur ;
2. définir la durée de vie d'un prix selon la nature du produit ;
3. définir comment les prix aberrants sont détectés et traités ;
4. définir comment les doublons sont identifiés et neutralisés.

Ce document est complémentaire du Référentiel Produit (document 01), du Modèle de données (document 02) et du Product Intelligence Engine (document 03).

### Note de version

La version 1.1 corrige quatre points d'alignement par rapport à la version 1.0 :

1. liste des statuts de `prices` unifiée avec le document 02 ;
2. nouveaux champs introduits par ce document listés explicitement pour mise à jour du document 02 ;
3. seuils de détection des prix aberrants reformulés en ratios non ambigus ;
4. clé de regroupement comparateur et empreinte ticket sécurisées.

---

## 1. Calcul des économies

### 1.1. Principe central

L'indicateur principal de PrixMalin est l'**économie potentielle**, calculée par comparaison entre le panier de l'utilisateur et la meilleure solution viable trouvée dans une zone de référence.

PrixMalin répond à une seule question :

> Où puis-je réellement payer mes courses moins cher ?

### 1.2. Zone de référence

La zone d'analyse des prix est fixée à **50 km** par défaut.

Ce rayon est indépendant du rayon de recherche habituel choisi par l'utilisateur dans le comparateur (10 km ou 100 km).

Il représente la zone maximale d'analyse, pas une recommandation de déplacement systématique.

Avantages du rayon de 50 km :

- dispose de davantage de données ;
- offre une référence de prix plus robuste ;
- détecte des enseignes que l'utilisateur ne consulte pas habituellement ;
- permet d'identifier des économies significatives hors habitudes.

### 1.3. Modes de comparaison

PrixMalin propose deux modes.

**Mode par défaut : jusqu'à deux supermarchés**

```text
Économies maximales — jusqu'à deux supermarchés
```

Le mot « jusqu'à » est essentiel : le moteur peut recommander un seul magasin lorsqu'un deuxième déplacement n'apporte pas une économie suffisante.

**Mode simplifié : un seul supermarché**

```text
Voir l'option avec un seul magasin
```

Exemple d'affichage :

```text
Option 1 — Jusqu'à deux magasins
Lidl : 39,60 €
E.Leclerc : 33,30 €
Total : 72,90 €

Option 2 — Un seul magasin
Carrefour : 79,40 €
```

### 1.4. Notion de solution viable

La solution mathématiquement la moins chère n'est pas toujours la plus pertinente.

Le moteur recherche la meilleure combinaison en tenant compte de :

- l'économie totale obtenue ;
- la distance supplémentaire ;
- le détour nécessaire ;
- le nombre de magasins ;
- la part du panier couverte par les données disponibles.

Exemple de solution non viable :

```text
Meilleur magasin à 8 km : panier à 78 €
Magasin à 47 km : panier à 76,50 €
→ déplacement non justifié pour 1,50 € d'économie
```

### 1.5. Seuil de pertinence pour deux magasins

Le moteur ne recommande pas deux magasins pour une économie négligeable.

**Seuil provisoire initial : 5 €**

```text
Gain supplémentaire du deuxième magasin < 5 €
→ recommander un seul magasin

Gain supplémentaire ≥ 5 €
→ recommander la combinaison de deux magasins
```

Ce seuil est provisoire. Il doit être ajusté après analyse des premiers retours utilisateurs.

### 1.6. Distinction économie potentielle / économie réalisée

**Avant l'achat ou sans preuve d'achat :**

```text
Jusqu'à 13,50 € d'économies potentielles sur ce panier.
```

Calcul :
```text
montant du panier actuel
− meilleure solution viable proposée par PrixMalin
= économie potentielle
```

Le terme « potentielle » est obligatoire car PrixMalin ne peut pas garantir :

- que tous les produits étaient disponibles ;
- que les prix n'avaient pas changé ;
- que l'utilisateur aurait effectué le déplacement ;
- qu'il aurait suivi la recommandation.

**Après rapprochement avec un achat réel :**

```text
13,50 € réellement économisés.
```

Cette formulation n'est autorisée que lorsque :

1. l'utilisateur a consulté une recommandation PrixMalin ;
2. le prix du panier de référence a été enregistré ;
3. l'utilisateur a ensuite scanné son ticket ;
4. les produits réellement achetés ont été rapprochés de la recommandation.

Calcul :
```text
prix du panier de référence enregistré
− prix réellement payé
= économie réalisée
```

Sans cette preuve, PrixMalin affiche obligatoirement :

```text
Jusqu'à 23 € d'économies potentielles identifiées ce mois-ci.
```

et jamais :

```text
Vous avez économisé 23 €.
```

### 1.7. Indicateurs complémentaires

**Prix habituellement constaté dans la zone**

Calculé à partir de la **médiane** des observations récentes et fiables situées dans la zone de 50 km.

La médiane est préférée à la moyenne car elle est moins sensible aux erreurs OCR, aux promotions extrêmes et aux mauvaises associations produits.

Exemple d'affichage :

```text
Prix habituellement constaté dans la zone : 2,35 €
```

**Comparaison avec le magasin habituel**

Disponible uniquement lorsque PrixMalin dispose de suffisamment de données.

Exemple :

```text
Par rapport à ton magasin habituel, cette combinaison te permettrait d'économiser 8,40 €.
```

Non obligatoire — certains utilisateurs n'ont pas de magasin habituel identifiable.

---

## 2. Fraîcheur des prix

### 2.1. Principe

Un prix n'est jamais supprimé. Il est conservé dans l'historique mais peut être exclu du comparateur lorsqu'il est trop ancien.

```text
Prix actif   → utilisé dans le comparateur et le calcul des économies
Prix expiré  → conservé dans l'historique, exclu des recommandations actives
```

Exemple d'affichage pour un prix expiré :

```text
Dernier prix connu : 12,90 €, observé il y a 43 jours.
```

Ce prix ne doit pas être présenté comme un prix actuellement disponible.

### 2.2. Classes de fraîcheur

La durée de vie d'un prix dépend de la volatilité de sa sous-catégorie.

| Classe (`freshness_class`) | Durée utile | Sous-catégories concernées |
|---|---|---|
| `volatile` | 7 jours | Fruits frais, légumes frais, poisson frais, salades & herbes, produits saisonniers |
| `fresh` | 14 jours | Viande fraîche, charcuterie, produits laitiers, yaourts, plats frais, traiteur |
| `standard` | 30 jours | Épicerie, boissons, surgelés, conserves, bébé, animalerie |
| `stable` | 60 jours | Lessive, entretien, hygiène, papier, accessoires ménagers |

La classe `standard` (30 jours) correspond à la valeur déjà présente dans le code. Elle reste la valeur par défaut.

Chaque sous-catégorie reçoit un champ `freshness_class` dans la table `subcategories` *(voir section 6 — Champs à ajouter au document 02)*.

### 2.3. Application aux promotions

Une promotion doit avoir une durée de vie spécifique.

| Situation | Durée |
|---|---|
| Date de fin connue (`promotion_end_date`) | Le prix expire à cette date |
| Date de fin inconnue | 7 jours maximum |

Une promotion ancienne ne doit jamais rester le meilleur prix actif pendant 30 ou 60 jours.

### 2.4. Comportement en cas de manque de données

PrixMalin ne prolonge pas artificiellement la durée de vie d'un prix pour remplir le comparateur.

En cas de données insuffisantes, le moteur :

1. élargit la zone de recherche jusqu'à 50 km ;
2. utilise un produit générique comparable si la règle métier l'autorise ;
3. affiche un message honnête si aucune donnée récente n'est disponible.

```text
Aucun prix récent suffisamment fiable n'est disponible pour ce produit.
```

---

## 3. Détection des prix aberrants

### 3.1. Principe

Un prix suspect n'est jamais supprimé automatiquement.

Il est :

- conservé dans l'historique ;
- marqué avec le statut `suspect` ;
- exclu temporairement du comparateur.

### 3.2. Étape 1 — Vérification de cohérence du ticket

Avant toute comparaison avec l'historique, le moteur vérifie la cohérence interne du ticket.

Règle fondamentale :
```text
quantité × prix unitaire = total de ligne
```

Le moteur détecte les confusions fréquentes entre :

- prix unitaire ;
- total de la ligne ;
- prix du lot ;
- prix au kilo ou au litre.

Exemple :

```text
12 bouteilles à 4 €
Total ligne : 48 €
→ 48 € ne doit pas être enregistré comme prix unitaire.
```

### 3.3. Étape 2 — Comparaison avec la médiane récente

La comparaison utilise la **médiane** des prix récents et fiables du même produit.

Ordre de priorité pour trouver la médiane de référence :

1. même référence exacte (`product_id`)
2. même enseigne ou même magasin
3. même produit exact dans la zone de 50 km
4. même produit générique et même format comparable

La comparaison porte sur le **prix normalisé** (prix au kg, au litre, à la pièce, au rouleau) et non sur le prix brut.

### 3.4. Étape 3 — Seuils de détection

Applicable uniquement lorsqu'au moins **5 observations fiables récentes** sont disponibles.

Le ratio est défini comme :

```text
ratio = prix observé / prix médian
```

| Ratio | Traitement |
|---|---|
| 0,50 ≤ ratio ≤ 2,00 | Accepté |
| 0,25 ≤ ratio < 0,50 | Suspect |
| 2,00 < ratio ≤ 3,00 | Suspect |
| ratio < 0,25 ou ratio > 3,00 | Neutralisé automatiquement |
| ratio < 0,10 ou ratio > 5,00 | Erreur très probable |

Exemple avec une médiane à 4,00 € :

| Prix observé | Ratio | Résultat |
|---|---|---|
| 3,50 € | 0,875 | Accepté |
| 1,70 € | 0,425 | Suspect — promotion possible |
| 0,12 € | 0,030 | Neutralisé |
| 9,50 € | 2,375 | Suspect |
| 48,00 € | 12,00 | Neutralisé |

Ces seuils sont configurables et doivent être ajustés après analyse de vrais tickets.

### 3.5. Étape 4 — Détection des promotions

Un prix très bas n'est pas forcément une erreur.

Le moteur recherche des indices de promotion dans le libellé du ticket :

```text
PROMO / REMISE / AVANTAGE CARTE / 2+1 GRATUIT / PRIX CLUB
```

Lorsqu'un prix bas est accompagné d'un indice de promotion :

```text
price_type = promotion
promotion_end_date = date de fin si connue
validation_status = needs_confirmation
```

Ce prix reçoit une durée de vie courte (7 jours maximum si `promotion_end_date` est inconnue).

### 3.6. Étape 5 — Confirmation communautaire

Un prix suspect peut être réhabilité par plusieurs observations indépendantes.

Conditions de réhabilitation :

| Condition | Valeur |
|---|---|
| Utilisateurs distincts | ≥ 2 |
| Tickets distincts | ≥ 3 |
| Même magasin | Oui |
| Période | ≤ 7 jours |

Lorsque ces conditions sont réunies : statut → `confirmed_promotion`.

### 3.7. Statuts unifiés des observations de prix

Liste commune aux documents 02 et 04 :

| Statut | Utilisation dans le comparateur | Description |
|---|---|---|
| `active` | Oui | Prix valide et récent |
| `suspect` | Non | Conservé, exclu automatiquement |
| `confirmed_promotion` | Oui (pendant sa durée) | Promotion confirmée par la communauté |
| `contested` | Non | Contesté, validation suspendue |
| `rejected` | Non | Erreur confirmée |
| `expired` | Non | Prix trop ancien |
| `superseded` | Non | Remplacé par une correction |

Le comparateur n'utilise par défaut que les statuts `active` et `confirmed_promotion` encore valides.

---

## 4. Gestion des doublons

### 4.1. Principe fondamental

> **PrixMalin conserve les preuves indépendantes, mais neutralise les répétitions techniques.**

### 4.2. Cas 1 — Deux utilisateurs différents, même prix

Les deux observations sont conservées séparément dans `prices`. Ce sont deux preuves indépendantes.

Pour l'affichage comparateur, elles sont regroupées selon la clé :

```text
COALESCE(product_id, generic_product_id)
+ format normalisé (quantite + unite + conditionnement)
+ store_id
+ date
+ price
```

Affichage résultant :

```text
Leclerc : 5,49 €
Confirmé par 2 tickets récents
```

Le regroupement conserve :

- le nombre de tickets distincts (`distinct_receipt_count`) ;
- le nombre d'utilisateurs distincts (`distinct_user_count`) ;
- la première et la dernière observation ;
- le niveau de confiance.

### 4.3. Poids des observations dans la confiance communautaire

PrixMalin suit séparément :

```text
observation_count         → nombre total d'observations
distinct_receipt_count    → nombre de tickets distincts
distinct_user_count       → nombre d'utilisateurs distincts
```

Règle : une seule confirmation principale par utilisateur, produit, magasin et journée est comptée dans le score communautaire.

### 4.4. Cas 2 — Même ticket envoyé plusieurs fois

**Premier niveau : `client_scan_id`**

Identifiant unique généré par l'application avant chaque envoi.

```text
Premier envoi → ticket créé
Même client_scan_id → retour du ticket existant, aucune création
```

**Deuxième niveau : `receipt_fingerprint`**

Empreinte calculée sur le contenu normalisé et trié :

```text
user_id
+ store_id ou enseigne
+ date du ticket
+ total du ticket
+ lignes normalisées TRIÉES (libellé normalisé + prix)
```

Le tri canonique avant calcul permet de reconnaître le même ticket même si l'OCR a inversé l'ordre de deux lignes.

L'empreinte d'image seule ne suffit pas : le même ticket peut être photographié sous des angles différents.

**Traitement selon le niveau de certitude :**

| Situation | Traitement |
|---|---|
| Même `client_scan_id` | Doublon certain — retourner le ticket existant |
| Même `receipt_fingerprint` | Doublon certain — retourner le ticket existant |
| Empreintes très proches (≥ 95 % des lignes identiques) | Doublon probable — `duplicate_status = suspected`, demander confirmation |
| Ticket différent | Nouvel achat — créer normalement |

Message affiché pour un doublon probable :

```text
Ce ticket ressemble fortement à un ticket déjà enregistré.
S'agit-il du même achat ?

[Oui, utiliser le ticket existant]   [Non, conserver comme nouvel achat]
```

### 4.5. Doublons dans un ticket multi-photos

Une ligne présente sur deux photos du même scan ne constitue jamais deux observations indépendantes.

Le moteur fusionne les lignes en doublon avant enregistrement, en utilisant :

- le libellé normalisé ;
- le prix ;
- la quantité ;
- la position approximative ;
- les lignes voisines ;
- la zone de chevauchement estimée entre les images.

---

## 5. Règles transversales

### 5.1. Aucune suppression automatique

PrixMalin ne supprime jamais automatiquement une observation de prix, un alias, un ticket ou une ligne de ticket.

La désactivation, l'expiration ou le marquage `rejected` sont les seules actions automatiques autorisées.

### 5.2. Traçabilité obligatoire

Toute modification d'une observation existante conserve :

- l'auteur de la modification ;
- la date ;
- la raison ;
- la valeur d'origine.

### 5.3. Seuils configurables

| Seuil | Valeur initiale | À ajuster après |
|---|---|---|
| Gain minimum pour recommander 2 magasins | 5 € | Premiers retours utilisateurs |
| Ratio minimum acceptable | 0,50 | Analyse de vrais tickets |
| Ratio maximum acceptable | 2,00 | Analyse de vrais tickets |
| Ratio de neutralisation bas | 0,25 | Analyse de vrais tickets |
| Ratio de neutralisation haut | 3,00 | Analyse de vrais tickets |
| Nombre min. d'observations pour la médiane | 5 | Croissance de la base |
| Durée d'une promotion sans date de fin | 7 jours | Retours utilisateurs |
| Seuil doublon probable | 95 % de lignes identiques | Retours utilisateurs |

---

## 6. Champs à ajouter au document 02 (Modèle de données)

Les champs suivants sont introduits par ce document et devront être intégrés dans la version 1.2 du document 02 avant toute création de tables Supabase.

| Table | Champ | Type | Description |
|---|---|---|---|
| `subcategories` | `freshness_class` | text | `volatile`, `fresh`, `standard`, `stable` |
| `prices` | `price_type` | text | `standard`, `promotion` |
| `prices` | `promotion_end_date` | date | Date de fin de promotion si connue |
| `receipts` | `receipt_fingerprint` | text | Empreinte canonique du contenu du ticket |
| `receipts` | `duplicate_status` | text | `none`, `suspected`, `confirmed` |

Le document 02 v1.1 reste valide pour tout le reste. Ces cinq champs s'ajoutent à la structure existante sans modifier aucune contrainte ni aucune relation.

---

## 7. Versionnage

| Version | Date | Nature |
|---|---|---|
| 1.0 | 29 juin 2026 | Version fondatrice |
| 1.1 | 29 juin 2026 | Alignement statuts, ratios sans ambiguïté, clé regroupement sécurisée, champs manquants documentés |

---

## 8. Documents liés au PrixMalin Core

1. **Référentiel Produit PrixMalin** — document 01
2. **Modèle de données Supabase** — document 02 *(mise à jour v1.2 requise avant déploiement)*
3. **Product Intelligence Engine** — document 03
4. **Règles métier PrixMalin** — présent document
5. **Architecture fonctionnelle** — interactions entre modules
6. **Plan de migration Supabase** — scripts, tests et retour arrière

---

*Document fondateur PrixMalin — toute évolution du comparateur, du calcul des économies ou du traitement des prix doit respecter ces règles métier.*
