# Product Intelligence Engine — PrixMalin
## Version : 1.1
**Date : 30 juin 2026**  
**Statut : document fondateur — PrixMalin Core**  
**Périmètre : reconnaissance des lignes de tickets, rapprochement générique et exact, validation et apprentissage contrôlé**

---

## 0. Objet du document

Le Product Intelligence Engine transforme le texte brut d’une ligne de ticket en une correspondance avec le référentiel PrixMalin.

Exemple :

```text
JAMB SUP RANOU 4X80G
→ produit générique : Jambon supérieur
→ produit exact : Ranou Jambon supérieur 4 × 80 g
```

Le présent document utilise les noms techniques du modèle de données :

| Concept | Élément technique |
|---|---|
| Texte OCR | `receipt_lines.raw_text` |
| Produit générique | `products` / `receipt_lines.product_id` |
| Produit exact | `product_variants` / `receipt_lines.product_variant_id` |
| Alias | `product_aliases` |
| Score générique | `generic_confidence_score` |
| Score exact | `exact_confidence_score` |

---

## 1. Principe central

> **Reconnaître largement au niveau générique, mais rester exigeant au niveau exact.**

Une ligne peut donc être validée au niveau générique sans être validée au niveau exact.

Exemple :

```text
PENNE BAR 500G
→ produit générique Penne : validé
→ variante Barilla 500 g : en attente si le format ou la marque restent ambigus
```

---

## 2. Informations conservées

### 2.1 Texte brut

Le texte OCR est conservé sans modification dans :

```text
receipt_lines.raw_text
```

Il ne doit jamais être remplacé par une version corrigée ou normalisée.

### 2.2 Texte normalisé

Une représentation normalisée est calculée pour la recherche :

- suppression des accents ;
- passage en majuscules ;
- séparation des chiffres et unités ;
- normalisation des espaces ;
- suppression de la ponctuation non significative ;
- normalisation de `×`, `*` et `X`.

Cette représentation est persistée dans `product_aliases.normalized_alias` lorsqu’un alias est créé. Pour une ligne de ticket seule, elle peut rester une valeur de traitement transitoire.

### 2.3 Composants extraits

Le moteur peut extraire temporairement :

- marque probable ;
- nom produit probable ;
- quantité ;
- unité ;
- nombre d’unités ;
- format total.

Ces composants servent au calcul et aux garde-fous. Ils ne deviennent pas automatiquement de nouvelles colonnes de `receipt_lines` dans la version initiale.

---

## 3. Les deux scores de confiance

### 3.1 Score générique

`generic_confidence_score` estime la probabilité que la ligne corresponde au bon produit générique.

### 3.2 Score exact

`exact_confidence_score` estime la probabilité que la ligne corresponde à la bonne variante exacte.

### 3.3 Cohérence obligatoire

Lorsque les deux scores existent :

```text
exact_confidence_score ≤ generic_confidence_score
```

La reconnaissance exacte suppose que le produit générique soit lui-même cohérent.

---

## 4. Zones de décision

### 4.1 Validation générique automatique

```text
generic_confidence_score ≥ 0,95
ET aucun garde-fou violé
→ generic_validation_status = validated
→ generic_validation_method = automatic
→ generic_validated_by = NULL
```

La date est enregistrée dans `generic_validated_at`.

### 4.2 Validation exacte automatique

```text
generic_validation_status = validated
ET exact_confidence_score ≥ 0,95
ET product_variants.validation_status = validated
ET aucun garde-fou exact violé
→ exact_validation_status = validated
→ exact_validation_method = automatic
→ exact_validated_by = NULL
```

### 4.3 Suggestion utilisateur

```text
0,80 ≤ score < 0,95
→ statut pending
→ suggestion pré-sélectionnée
```

L’utilisateur peut confirmer ou choisir une autre proposition.

En cas de confirmation :

```text
validation_method = user
validated_by = utilisateur
validated_at = date de confirmation
```

### 4.4 Non classé temporaire

```text
generic_confidence_score < 0,80
ou informations insuffisantes
→ product_id = NULL
→ generic_validation_status = pending
```

`Non classé` n’est ni une catégorie ni un produit générique. C’est un état temporaire de la ligne.

---

## 5. Ordre de recherche

Le moteur utilise l’ordre suivant :

```text
1. alias validé pour la même enseigne (`retailer_id`)
2. alias validé global (`retailer_id IS NULL`)
3. recherche approximative sur `normalized_alias`
4. recherche par composants et référentiel
5. proposition à l’utilisateur
```

La version initiale ne possède pas d’alias spécifique à un magasin. Une portée magasin pourra être ajoutée ultérieurement si les données démontrent sa nécessité.

---

## 6. Garde-fous

Un score élevé ne suffit pas si une incohérence est détectée.

| Garde-fou | Exemple |
|---|---|
| Enseigne | Alias connu uniquement pour une autre enseigne |
| Marque | Marque détectée différente de `product_variants.brand_id` |
| Format | 6 unités détectées pour une variante de 12 unités |
| Quantité | Quantité totale incompatible |
| Produit générique | Variante rattachée à un autre `product_id` |
| Prix | Prix normalisé très éloigné de la médiane fiable |

Un garde-fou générique empêche la validation générique. Un garde-fou exact peut laisser le générique validé tout en maintenant la variante en attente.

---

## 7. Utilisation du dictionnaire d’alias

### 7.1 Statuts

Les statuts persistés sont :

- `pending` ;
- `validated` ;
- `rejected`.

Seuls les alias `validated` peuvent déclencher une résolution automatique à forte confiance.

### 7.2 Création

Un alias découvert par OCR n’est créé que lorsqu’une cible générique existe déjà. Il est alors créé avec :

```text
product_id = cible générique proposée
source = ocr
validation_status = pending
created_by = utilisateur à l’origine du scan, si disponible
```

Si aucun produit générique ne peut être proposé, le texte reste uniquement dans `receipt_lines.raw_text` jusqu’à la revue. Un utilisateur ne peut pas rendre lui-même l’alias public et validé par une simple création.

### 7.3 Validation

Dans la version initiale :

- un administrateur peut valider ou rejeter un alias ;
- une confirmation utilisateur valide la correspondance de sa ligne de ticket ;
- elle ne promeut pas automatiquement l’alias global.

L’agrégation communautaire automatique par nombre d’utilisateurs et d’observations est reportée à une évolution ultérieure, car elle nécessite des tables d’événements dédiées.

### 7.4 Contestation

Lorsqu’un alias validé devient ambigu :

1. son automatisation est suspendue ;
2. il revient à `pending` pendant la revue ;
3. les nouvelles occurrences passent en suggestion ;
4. un administrateur le valide à nouveau ou le rejette.

---

## 8. Création de produits

### 8.1 Produit générique inconnu

Les utilisateurs ne créent pas directement de ligne dans `products`.

Une ligne reste non classée et une proposition est transmise à la gouvernance du référentiel.

### 8.2 Produit générique connu, variante exacte inconnue

Une `product_variant` peut être créée avec :

```text
validation_status = pending
created_by = utilisateur ou processus serveur
```

La variante n’est utilisée automatiquement par le comparateur qu’après validation.

### 8.3 Code-barres

Lorsqu’un EAN fiable est disponible, il constitue le meilleur identifiant de variante exacte. L’unicité porte uniquement sur les codes-barres non nuls.

---

## 9. Écriture dans `receipt_lines`

Le moteur renseigne uniquement les champs du modèle :

| Champ | Utilisation |
|---|---|
| `product_id` | produit générique retenu |
| `product_variant_id` | variante exacte retenue, si connue |
| `alias_used` | texte d’alias ayant permis la résolution |
| `generic_confidence_score` | confiance générique |
| `exact_confidence_score` | confiance exacte |
| `generic_validation_status` | `pending`, `validated` ou `rejected` |
| `generic_validation_method` | `automatic`, `user` ou `admin` |
| `generic_validated_by` / `generic_validated_at` | traçabilité |
| `exact_validation_status` | `pending`, `validated` ou `rejected` |
| `exact_validation_method` | `automatic`, `user` ou `admin` |
| `exact_validated_by` / `exact_validated_at` | traçabilité |

Une validation exacte nécessite :

- une validation générique ;
- un `product_variant_id` ;
- une variante appartenant au même `product_id`.

---

## 10. Création d’un prix

Une ligne ne produit un prix que si :

- `line_type = product` ;
- elle n’est pas exclue ;
- le produit générique est validé ;
- le magasin et la date sont connus ;
- le montant net est exploitable.

La création dans `prices` utilise :

```text
receipt_line_id
product_id
product_variant_id éventuel
store_id
user_id
price = net_amount
source_type = receipt
observed_at
valid_until calculé
```

Une seule ligne de ticket peut générer au plus un prix.

---

## 11. Exemple complet

```text
Texte : JAMB SUP RANOU 4X80G
```

Résultat possible :

| Élément | Valeur |
|---|---|
| `product_id` | Jambon supérieur |
| `product_variant_id` | Ranou 4 × 80 g |
| `generic_confidence_score` | 0,98 |
| `exact_confidence_score` | 0,96 |
| Validation générique | automatique |
| Validation exacte | automatique |

Si le format exact était ambigu :

| Élément | Valeur |
|---|---|
| `product_id` | Jambon supérieur |
| `product_variant_id` | NULL |
| `generic_confidence_score` | 0,98 |
| `exact_confidence_score` | 0,62 |
| Validation générique | automatique |
| Validation exacte | pending |

---

## 12. Évolutions ultérieures

Sont explicitement hors du périmètre initial :

- alias spécifiques à un magasin ;
- validation communautaire automatique des alias ;
- stockage détaillé de tous les composants extraits ;
- enrichissement automatique par catalogue Drive ;
- création automatique d’un produit générique ;
- détection de changement de recette ;
- reconnaissance externe par Open Food Facts.

---

## 13. Versionnage

| Version | Date | Nature |
|---|---|---|
| 1.0 | 29 juin 2026 | Version fondatrice |
| 1.1 | 30 juin 2026 | Alignement avec le modèle de données v1.4 : noms de champs, seuils 0,80/0,95, portée enseigne/globale, statuts et règles de création |

---

## 14. Documents liés

1. Référentiel Produit PrixMalin — document 01 v1.2  
2. Modèle de données PrixMalin — document 02 v1.4  
3. Product Intelligence Engine — présent document  
4. Règles métier PrixMalin — document 04 v1.2  
5. Architecture fonctionnelle — document 05 v1.1  
6. Plan de migration Supabase — document 06 v1.2  

---

*Le moteur doit toujours préférer une correspondance générique fiable à une référence exacte incertaine.*
