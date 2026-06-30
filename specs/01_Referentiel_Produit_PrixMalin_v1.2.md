# Référentiel Produit PrixMalin

**Version : 1.2**  
**Date : 30 juin 2026**  
**Statut : document fondateur — PrixMalin Core**  
**Périmètre : classification des produits, règles de rattachement et gouvernance du référentiel**

---

## 0. Objet du document

Le présent document définit le référentiel produit officiel de PrixMalin.

Il a quatre objectifs :

1. fournir une arborescence simple et stable pour classer les produits ;
2. permettre à l’utilisateur de retrouver naturellement un produit ;
3. relier les libellés abrégés des tickets de caisse aux produits réellement vendus ;
4. fournir une base commune aux scans de tickets, au comparateur, aux listes de courses, aux favoris, aux imports Drive et aux futures fonctions d’intelligence produit.

Ce document décrit la logique métier. Il ne doit pas être utilisé comme une table de données directement lue par l’application. La version déployée du référentiel devra être conservée dans une source structurée et versionnée, par exemple un fichier YAML, JSON ou un script SQL de peuplement utilisant des identifiants stables.

---

# 1. Vision

PrixMalin ne cherche pas à reproduire l’organisation interne propre à chaque enseigne.

Le référentiel vise à représenter la logique de recherche naturelle des consommateurs français, tout en restant compatible avec l’organisation la plus fréquente des rayons de supermarché.

Lorsqu’un arbitrage est nécessaire :

> **L’expérience utilisateur prime sur la logique informatique, la marque ou la composition nutritionnelle du produit.**

Le référentiel doit rester :

- compréhensible au premier regard ;
- suffisamment précis pour permettre la comparaison ;
- stable dans le temps ;
- compatible avec plusieurs sources de données ;
- améliorable sans casser les données existantes.

---

# 2. Principe fondamental

> **Un produit est classé selon le rayon dans lequel le consommateur s’attend naturellement à le trouver en magasin, et non selon sa composition nutritionnelle, sa marque ou le libellé utilisé sur le ticket de caisse.**

Cette règle constitue le principal juge de paix du référentiel.

Exemples :

- une crevette surgelée est classée dans **Surgelés**, et non dans **Poissons & fruits de mer** ;
- un tiramisu du rayon traiteur frais est classé dans **Plats préparés & traiteur** ;
- un yaourt au citron reste classé dans **Produits laitiers & œufs** ;
- un libellé imprécis ne doit jamais être forcé dans une catégorie : il reste temporairement **Non classé**.

Le « rayon » désigne ici le rayon le plus courant et le plus intuitif à l’échelle nationale. L’emplacement particulier d’un produit dans un magasin ne doit pas modifier sa classification officielle.

---

# 3. Règles fondatrices

## 3.1. Règle des 80 %

Un rayon présent dans la majorité des supermarchés français peut devenir une sous-catégorie PrixMalin.

La création d’une sous-catégorie ne dépend donc pas uniquement du nombre de produits actuellement présents dans la base.

Cette règle permet :

- de conserver les repères habituels des consommateurs ;
- de classer plus facilement les nouveaux produits ;
- de faciliter les rapprochements avec les catalogues Drive ;
- d’éviter une classification conçue uniquement à partir d’un petit échantillon initial.

## 3.2. Cible de couverture à 95 %

Le référentiel doit permettre de classer naturellement environ 95 % des produits de grande consommation.

Les produits rares, ambigus, nouveaux ou mal reconnus ne doivent pas entraîner la création immédiate d’une nouvelle catégorie. Ils sont placés dans l’état interne **Non classé** jusqu’à leur résolution.

## 3.3. Juge de paix UX

Une sous-catégorie est valide lorsqu’un utilisateur peut raisonnablement répondre « oui » à la question suivante :

> **Est-ce là que j’irais spontanément chercher ce produit ?**

Une classification techniquement exacte mais difficile à comprendre pour l’utilisateur doit être rejetée.

## 3.4. Aussi peu que possible, autant que nécessaire

Une catégorie ne doit pas être limitée artificiellement à un nombre fixe de sous-catégories.

La cible habituelle se situe entre cinq et huit sous-catégories, mais une famille simple peut en avoir moins.

Une sous-catégorie doit être créée seulement si elle :

- correspond à un repère de rayon clair ;
- contient ou pourra contenir un nombre significatif de produits ;
- évite une liste trop longue ou trop hétérogène ;
- ne recouvre pas une sous-catégorie existante.

## 3.5. Pas de classement forcé

En cas d’incertitude, PrixMalin conserve le produit dans l’état **Non classé**.

Un produit mal classé dégrade :

- la recherche ;
- les comparaisons ;
- les statistiques ;
- l’apprentissage du moteur de reconnaissance.

Une donnée incomplète mais honnête est préférable à une donnée précise mais fausse.

## 3.6. Indépendance vis-à-vis de la source

La classification officielle ne dépend pas de la source ayant permis de découvrir le produit.

Un même produit peut provenir :

- d’un ticket de caisse ;
- d’un catalogue Drive ;
- d’un code-barres ;
- d’Open Food Facts ou d’une autre base autorisée ;
- d’une saisie manuelle ;
- d’une photographie ponctuelle ;
- d’une correction communautaire.

Toutes ces sources doivent converger vers le même produit de référence.

## 3.7. Structure versionnée

Toute évolution du référentiel est versionnée.

Les libellés visibles peuvent évoluer, mais les identifiants techniques stables ne doivent jamais être réutilisés pour une autre catégorie ou sous-catégorie.

Une suppression métier doit être réalisée par désactivation ou remplacement, jamais par réaffectation silencieuse d’un identifiant.

---

# 4. Modèle conceptuel du produit

Le référentiel distingue les niveaux métier suivants.

```text
Catégorie
   ↓
Sous-catégorie
   ↓
Produit générique
   ↓
Produit de référence
   ↓
Alias de ticket
   ↓
Observations de prix
```

**Correspondance avec le modèle de données :**

| Concept métier | Élément technique |
|---|---|
| Catégorie | `categories` |
| Sous-catégorie | `subcategories` |
| Produit générique | `products` |
| Produit de référence | `product_variants` |
| Alias de ticket | `product_aliases` |
| Observation de prix | `prices` |

## 4.1. Catégorie

La catégorie est le niveau principal de navigation.

PrixMalin comporte **14 catégories visibles par l’utilisateur**.

L’état **Non classé** est un état technique de résolution. Il ne constitue pas une ligne de la table `categories`. Dans le modèle de données, il correspond à une ligne de ticket dont `product_id` est nul et dont la validation générique reste en attente.

## 4.2. Sous-catégorie

La sous-catégorie correspond à un rayon ou à un regroupement immédiatement compréhensible.

## 4.3. Produit générique

Le produit générique représente le besoin ou le type de produit comparable.

Exemples :

- Penne
- Jambon blanc
- Camembert
- Liquide vaisselle
- Cola sans sucre

Il sert notamment à comparer des produits différents mais équivalents par usage.

## 4.4. Produit de référence

Le produit de référence correspond à une référence commerciale précise.

Il peut être identifié par :

- une marque ;
- un nom commercial ;
- une variante ;
- une quantité ou un format ;
- un conditionnement ;
- un code EAN lorsqu’il est disponible.

Exemple :

```text
Barilla — Penne Rigate n°73 — 500 g — EAN 8076802085738
```

Un produit de référence appartient à un seul produit générique principal.

## 4.5. Alias de ticket

Un alias est une forme rencontrée dans une source, notamment un ticket de caisse.

Exemples :

```text
PENNE RIG
BAR PENNE 500
PEN RIG BAR
PATES BARILLA
```

Un alias ne remplace jamais le nom officiel du produit. Il sert uniquement à reconnaître et à rattacher une observation au bon produit de référence.

Lorsque le libellé est trop imprécis pour identifier une référence commerciale exacte, il peut être temporairement rattaché au produit générique avec un statut provisoire.

## 4.6. Observation de prix

Le prix n’est pas une propriété permanente du produit.

Une observation de prix correspond à un événement daté :

```text
Produit de référence
+ magasin
+ date
+ prix
+ source
+ niveau de confiance
```

---

# 5. Niveaux de comparaison dans PrixMalin

## 5.1. Comparaison exacte

Comparaison entre le même produit de référence, idéalement confirmé par l’EAN.

## 5.2. Comparaison par équivalence d’usage

Comparaison entre plusieurs produits rattachés au même produit générique, avec normalisation du poids, du volume ou du nombre d’unités.

Cette comparaison doit préserver les informations permettant à l’utilisateur de distinguer :

- la marque ;
- la marque de distributeur ;
- le bio ou non bio ;
- le format ;
- la composition ou les caractéristiques importantes ;
- le prix au kilogramme, au litre ou à l’unité.

---

# 6. Arborescence officielle — version 1.1

## 6.1. Fruits & légumes

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Fruits frais | Pomme, banane, melon, abricot, pêche, raisin |
| Légumes frais | Courgette, aubergine, poivron, tomate, carotte |
| Salades & herbes | Laitue, mâche, roquette, iceberg, persil |
| Fruits & légumes prêts à l’emploi | Carottes râpées, légumes découpés, salade verte en sachet |

**Règle particulière :** une salade contenant un repas complet, de la viande, du poisson ou une préparation traiteur appartient à **Plats préparés & traiteur**.

## 6.2. Viandes & charcuterie

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Bœuf | Steak haché, entrecôte, côte de bœuf, brochette de bœuf |
| Porc | Côte de porc, rôti de porc, échine |
| Volaille | Filet de poulet, escalope de dinde, pilon, nuggets |
| Charcuterie | Jambon blanc, jambon cru, lardons, chorizo, saucisson, knack, rillettes |
| Autres viandes | Agneau, veau, lapin, canard, gibier |

## 6.3. Poissons & fruits de mer

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Poissons frais | Pavé de saumon, filet de cabillaud, truite |
| Fruits de mer & coquillages | Moules, crevettes, poulpe, noix de Saint-Jacques |
| Poissons panés & transformés | Poisson pané, brandade, rillettes de poisson, tarama |

## 6.4. Produits laitiers & œufs

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Lait | Lait demi-écrémé, lait entier, lait sans lactose |
| Beurre & crème | Beurre doux, beurre salé, crème entière, crème légère |
| Yaourts & desserts lactés | Yaourt nature, yaourt aux fruits, fromage blanc, liégeois, flan, riz au lait |
| Fromages | Camembert, emmental râpé, mozzarella, feta, chèvre, mimolette |
| Œufs | Œufs plein air, œufs bio, œufs de poules élevées au sol |

## 6.5. Épicerie salée

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Pâtes | Penne, spaghetti, tagliatelle, fusilli, coquillettes, farfalle |
| Riz, semoules & céréales | Riz basmati, riz long grain, semoule, quinoa, boulgour |
| Sauces & condiments | Ketchup, moutarde, mayonnaise, sauce tomate, pesto |
| Conserves | Haricots verts, pulpe de tomates, sardines, thon, maïs |
| Apéritif salé | Chips, cacahuètes, crackers, biscuits apéritifs |
| Huiles, vinaigres & assaisonnements | Huile d’olive, huile de tournesol, vinaigre, sel, poivre, épices |
| Farines & aides culinaires | Farine, levure, chapelure, bouillon, fond de sauce |

## 6.6. Épicerie sucrée & petit déjeuner

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Petit déjeuner & pains emballés | Pain de mie, biscottes, brioche, pain grillé |
| Biscuits & gâteaux | Madeleines, petit-beurre, sablés, gâteaux secs |
| Chocolat & confiserie | Tablette de chocolat, chocolat dessert, bonbons, caramels |
| Compotes, confitures & miel | Compote, confiture, miel, pâte à tartiner |
| Sucre & aides pâtisserie | Sucre en poudre, sucre glace, vanille, levure chimique |

## 6.7. Plats préparés & traiteur

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Pizzas & tartes salées | Pizza, focaccia, quiche, feuilleté salé |
| Pâtes & plats frais | Raviolis frais, gnocchis, cappelletti, plats cuisinés frais |
| Salades & traiteur | Salade poulet, salade surimi, taboulé, salade César |
| Desserts frais | Tiramisu, crème brûlée, panna cotta, mousse au chocolat |

## 6.8. Boissons non alcoolisées

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Eaux | Eau plate, eau gazeuse, eau de source |
| Sodas & colas | Cola, cola sans sucre, limonade, orangeade |
| Jus & nectars | Jus d’orange, jus de pomme, nectar |
| Café, thé & boissons chaudes | Dosettes de café, café moulu, thé, infusion, chocolat en poudre |
| Sirops & boissons fonctionnelles | Sirop, boisson énergisante, boisson isotonique |

## 6.9. Boissons alcoolisées

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Bières | Bière blonde, bière blanche, bière IPA, bière brune |
| Vins | Vin rouge, vin blanc, vin rosé |
| Champagnes & effervescents | Champagne, crémant, prosecco |
| Spiritueux & apéritifs | Whisky, rhum, pastis, porto |

## 6.10. Surgelés

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Légumes & frites surgelés | Frites, épinards, petits pois, haricots verts |
| Plats cuisinés surgelés | Lasagnes, hachis parmentier, pizza surgelée |
| Viandes, poissons & fruits de mer surgelés | Steak, crevettes, moules, filets de poisson |
| Glaces & desserts glacés | Glace, sorbet, bâtonnet glacé |
| Pains & viennoiseries surgelés | Baguette, croissant, pain au chocolat |

## 6.11. Entretien & nettoyage

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Vaisselle | Liquide vaisselle, éponge, boule inox, tablette lave-vaisselle |
| Sols & surfaces | Nettoyant multi-usages, désinfectant, produit WC |
| Linge & lessive | Lessive liquide, lessive en poudre, adoucissant |
| Papiers & consommables ménagers | Essuie-tout, sac poubelle, film alimentaire, papier aluminium |
| Accessoires ménagers | Gants, brosse, serpillière |

## 6.12. Hygiène & beauté

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Hygiène corps & cheveux | Gel douche, savon, shampoing, déodorant |
| Soins dentaires | Dentifrice, brosse à dents, bain de bouche |
| Papier & coton | Papier toilette, mouchoirs, cotons-tiges, cotons démaquillants |
| Soins visage & beauté | Crème hydratante, démaquillant, masque, maquillage |
| Rasage & épilation | Rasoir, mousse à raser, crème épilatoire |

## 6.13. Bébé

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Couches & lingettes | Couches, lingettes bébé, couches de bain |
| Alimentation bébé | Petit pot, lait infantile, purée bébé, biscuit bébé |
| Soins & toilette bébé | Shampoing bébé, crème de change, sérum physiologique |

## 6.14. Animalerie

| Sous-catégorie | Exemples de produits génériques |
|---|---|
| Alimentation | Croquettes, pâtée, friandise, alimentation oiseaux ou rongeurs |
| Hygiène & litière | Litière, shampooing animal, sac ramasse-crottes |
| Accessoires | Jouet, laisse, gamelle |

## 6.15. Non classé — état interne

**Non classé** n’est pas une catégorie proposée à l’utilisateur.

Il s’agit d’un état temporaire utilisé lorsque :

- le produit n’est pas suffisamment identifié ;
- plusieurs classifications restent possibles ;
- le libellé du ticket est trop court ;
- une nouvelle famille de produits doit être étudiée ;
- le niveau de confiance est inférieur au seuil de validation.

---

# 7. Règles relatives aux alias

## 7.1. Conservation du texte brut

Le libellé original du ticket ne doit jamais être remplacé ni écrasé.

## 7.2. Contexte d’un alias

Un alias peut dépendre de l’enseigne.

Le moteur de reconnaissance doit pouvoir tenir compte de :

- l’enseigne ;
- le magasin ;
- la catégorie probable ;
- le prix observé ;
- le format ;
- les autres lignes du ticket ;
- les validations précédentes.

## 7.3. Cycle de vie d’un alias

Le modèle initial utilise trois statuts persistés :

```text
pending
→ validated
ou
→ rejected
```

- `pending` : alias observé ou proposé, non utilisable pour une résolution automatique à forte confiance ;
- `validated` : alias contrôlé et utilisable dans sa portée ;
- `rejected` : correspondance refusée.

Lorsqu’un alias validé devient ambigu ou contesté, il revient à `pending` pendant la revue. Les notions « contesté » et « désactivé » décrivent donc un comportement métier, pas des valeurs supplémentaires stockées dans `validation_status`.

---

# 8. Cas particuliers

## 8.1. Produits multi-rayons

Un produit ne possède qu’une classification principale dans le référentiel. Des étiquettes secondaires peuvent être utilisées pour la recherche.

## 8.2. Produits saisonniers

Un produit saisonnier conserve sa classification normale.

## 8.3. Lots et multipacks

Le produit de référence doit distinguer le contenu unitaire, le nombre d’unités, la quantité totale et le conditionnement.

## 8.4. Marques de distributeur

Une marque de distributeur reste une marque à part entière.

## 8.5. Changement de recette ou de format

Un changement significatif de grammage, d’EAN, de recette ou de conditionnement peut justifier un nouveau produit de référence.

---

# 9. Gouvernance

## 9.1. Autorité de modification

Les catégories, sous-catégories et produits génériques ne doivent pas être créés directement par les utilisateurs.

Les utilisateurs peuvent :

- signaler une erreur ;
- proposer une correspondance ;
- confirmer ou refuser un produit candidat ;
- enrichir les alias.

## 9.2. Critères de création d’une sous-catégorie

Toute proposition doit préciser :

1. les produits concernés ;
2. le rayon utilisateur correspondant ;
3. la fréquence observée ;
4. la raison pour laquelle les sous-catégories existantes sont insuffisantes ;
5. l’impact sur les produits déjà classés ;
6. la migration envisagée.

## 9.3. Identifiants stables

Chaque catégorie, sous-catégorie et produit générique doit disposer d’un identifiant technique stable.

- `categories.slug` et `subcategories.slug` fournissent des identifiants lisibles et versionnés ;
- `products.id` constitue l’identifiant stable du produit générique ;
- les UUID du référentiel sont fournis par le seed et ne doivent pas être régénérés à chaque environnement.

```text
category_slug = epicerie-salee
subcategory_slug = pates
product_id = UUID stable fourni par le seed
```

## 9.4. Source officielle et déploiement

Le document Markdown est la spécification métier normative.

La base applicative doit être alimentée par une source structurée versionnée :

```text
Référentiel métier Markdown
        +
Fichier structuré YAML / JSON / SQL seed
        ↓
Migration Supabase
        ↓
Application PrixMalin
```

L’application ne doit pas analyser directement le Markdown en production.

---

# 10. Versionnage

| Type de modification | Exemple | Version |
|---|---|---|
| Correction éditoriale | faute, précision d’un exemple | 1.1.1 |
| Ajout compatible | nouvelle sous-catégorie, nouveau produit générique | 1.2 |
| Modification structurelle | fusion ou déplacement important | 2.0 |

## Historique

| Version | Date | Nature des changements |
|---|---|---|
| 1.0 | Juin 2026 | Version fondatrice de l’arborescence |
| 1.1 | 29 juin 2026 | Séparation produit générique / produit de référence, formalisation des alias, observations de prix, gouvernance et clarification des 14 catégories visibles + état Non classé |
| 1.2 | 30 juin 2026 | Alignement avec le modèle de données v1.4 : correspondance des tables, Non classé comme état technique, statuts d’alias unifiés et identifiants stables du seed |

---

# 11. Documents liés du PrixMalin Core

1. **Référentiel Produit PrixMalin** — présent document ;
2. **Modèle de données Supabase** — tables, relations, contraintes et migrations ;
3. **Product Intelligence Engine** — reconnaissance et rapprochement des lignes de tickets ;
4. **Règles métier PrixMalin** — scores de confiance, validation, économies, fusion et contrôle qualité ;
5. **Architecture fonctionnelle** — interactions entre les modules de l’application.

---

# 12. Règle finale

> **Le référentiel PrixMalin doit aider l’utilisateur à trouver et comparer un produit. Il ne doit jamais lui demander de comprendre la structure interne de la base de données.**

---

*Document fondateur PrixMalin — toutes les fonctions de scan, comparaison, liste de courses, favoris, communauté et enrichissement produit doivent respecter ce référentiel.*
