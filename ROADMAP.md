# PrixMalin — Roadmap

## ✅ Fait

### Authentification & profil
- [x] Inscription / connexion par email + mot de passe (Supabase Auth)
- [x] Déconnexion
- [x] Choix d'un pseudo au premier login
- [x] Menu profil avec pseudo et email
- [x] Fermeture du menu profil au clic extérieur

### Liste de courses
- [x] Ajout de produits (nom, format, marque optionnelle, quantité)
- [x] Suggestions de produits rapides
- [x] Cochage des articles ("dans le panier")
- [x] Modification et suppression d'articles
- [x] Sauvegarde et rechargement des "courses habituelles" (favoris)
- [x] Ajout des habituelles à la liste existante sans effacer

### Catalogue
- [x] Navigation par catégories avec emojis et compteurs
- [x] Recherche de produits par nom
- [x] Sélection de marque (nationale / MDD) avec avertissement cross-magasin
- [x] Formats pré-remplis depuis les prix déjà enregistrés
- [x] Catalogue enrichi automatiquement depuis `produits_ref` + prix existants

### Mes prix
- [x] Import de ticket par **photo caméra** (IA via Claude)
- [x] Import depuis la **galerie** (conversion en JPEG avant envoi)
- [x] Import depuis un **ticket PDF** (pdfjs-dist + Claude)
- [x] Saisie **manuelle** d'un prix (produit, format, marque, magasin, prix)
- [x] Prévisualisation et édition des produits avant import
- [x] Choix du partage par produit (🌍 public / 🔒 privé)
- [x] Affichage du **prix à l'unité** (€/kg ou €/L)
- [x] Indicateur de fraîcheur (prix périmés après N jours)
- [x] Filtres : magasin, catégorie, période
- [x] Tri : date, prix croissant/décroissant, nom
- [x] Recherche avec suggestions auto-complétées
- [x] Modification et suppression avec confirmation
- [x] Envoi anonyme dans `community_prices` (Supabase)

### Comparateur
- [x] Comparatif des totaux par magasin pour les articles de la liste
- [x] Mise en avant du magasin le moins cher (podium)
- [x] Calcul de l'écart d'économies potentielles
- [x] Suggestions de magasins alternatifs pour les produits manquants
- [x] Affichage du prix à l'unité dans le comparatif
- [x] Bouton "Je fais mes courses ici" → archive la liste

### Historique
- [x] Historique des courses validées (magasin, date, total, articles)
- [x] Suppression d'une archive avec confirmation
- [x] Compteur total de courses et total dépensé

### Économies
- [x] Calcul des économies **potentielles** depuis la liste en cours
- [x] Cagnotte des économies **réalisées** (confirmées au scan de ticket)
- [x] Récapitulatif mensuel des économies réalisées

### Cercle privé
- [x] Invitation par email
- [x] Acceptation / refus d'une invitation reçue
- [x] Révocation d'un membre ou d'une invitation envoyée
- [x] Badge de notification pour invitations en attente
- [x] Affichage des pseudos dans le cercle

### Technique
- [x] Persistance complète dans Supabase (liste, prix, archives, favoris, profils, cercles)
- [x] Gestion des erreurs de sauvegarde avec toast
- [x] Déduplication des prix par clé (marque + produit + format + magasin)
- [x] Catégorisation automatique des produits par mots-clés

---

## 🔜 À faire

### Cercle privé — suite
- [ ] Afficher les prix des membres du cercle dans le comparateur
- [ ] Distinguer visuellement "mes prix" vs "prix du cercle" dans Mes prix
- [ ] Notifications push lors d'une invitation reçue

### Import de tickets
- [ ] Scanner un code-barres pour identifier automatiquement un produit
- [ ] Correction manuelle du nom d'un produit détecté par l'IA
- [ ] Historique des imports (savoir quels tickets ont déjà été scannés)

### Comparateur
- [ ] Comparatif avec les prix de la communauté (pas seulement ses propres prix)
- [ ] Filtrer le comparateur par fraîcheur des prix (ignorer les prix trop anciens)
- [ ] Mode "panier optimisé" : répartir les achats entre 2 magasins pour maximiser les économies

### Mes prix
- [ ] Graphique d'évolution d'un prix dans le temps
- [ ] Alerte de hausse de prix (si un prix enregistré dépasse un seuil)
- [ ] Export CSV de la base de prix

### Liste de courses
- [ ] Partager une liste avec un membre du cercle en temps réel
- [ ] Plusieurs listes sauvegardées (pas seulement les "courses habituelles")
- [ ] Réorganisation des articles par glisser-déposer

### Catalogue
- [ ] Badge "meilleur prix connu" sur chaque produit du catalogue
- [ ] Filtrer le catalogue par produits avec prix enregistrés

### Général
- [ ] Mode hors ligne / PWA (service worker + cache)
- [ ] Localisation du magasin par géolocalisation
- [ ] Page de paramètres (seuil de fraîcheur des prix, magasins favoris, suppression du compte)
- [ ] Onboarding guidé pour les nouveaux utilisateurs
