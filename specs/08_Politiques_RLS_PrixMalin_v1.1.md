# Politiques RLS PrixMalin
## Version : 1.1
**Date : 30 juin 2026**  
**Statut : document fondateur — PrixMalin Core**  
**Périmètre : politiques Row Level Security, fonctions d’autorisation, canaux d’écriture sécurisés, droits SQL et Storage**

---

## 0. Objet du document

Ce document définit les politiques de sécurité à déployer avant la bascule de PrixMalin vers le modèle cible.

Il précise :

1. comment un administrateur est identifié ;
2. quelles données peuvent être lues directement depuis le client ;
3. quelles écritures peuvent être réalisées directement ;
4. quelles écritures doivent passer par une Edge Function, une fonction RPC contrôlée ou le `service_role` ;
5. comment éviter les récursions RLS dans les cercles ;
6. comment protéger les photos de tickets ;
7. quels tests sont bloquants avant la production.

Le déploiement et la validation de ce document constituent un **prérequis bloquant** du document 06.

---

## 1. Principes de sécurité

### 1.1 RLS et privilèges SQL

Une politique RLS ne suffit pas à elle seule. Une opération n’est autorisée que si :

- le rôle possède le privilège SQL nécessaire (`GRANT`) ;
- une politique RLS permet la ligne concernée ;
- les contraintes et triggers du modèle sont respectés.

Toutes les nouvelles tables exposées dans `public` doivent avoir RLS activée dès leur création.

### 1.2 Données sensibles écrites côté serveur

Les tables suivantes sont lisibles par leur propriétaire, mais ne sont pas modifiables directement depuis le navigateur :

- `receipts` ;
- `receipt_images` ;
- `receipt_lines` ;
- `prices` ;
- `recommendation_snapshots` ;
- `recommendation_snapshot_items`.

Leur écriture passe par :

- une Edge Function ;
- une fonction RPC `SECURITY DEFINER` limitée à une opération précise ;
- ou un service serveur utilisant le `service_role`.

Cette règle empêche un utilisateur de fabriquer lui-même :

- un score OCR ;
- une validation automatique ou administrateur ;
- un prix déclaré validé ;
- une économie potentielle ;
- un snapshot de recommandation.

### 1.3 `service_role`

Le `service_role` :

- reste exclusivement côté serveur ;
- n’est jamais intégré au frontend ;
- contourne la RLS uniquement dans un contexte serveur de confiance ;
- doit toujours effectuer ses propres validations métier avant écriture.

### 1.4 Suppressions physiques

Les tables de référence, variantes, alias, magasins, tickets et prix ne sont pas supprimés directement par les utilisateurs.

Les suppressions ou nettoyages administratifs passent par une opération serveur contrôlée et respectent les comportements `ON DELETE` du document 02.

---

## 2. Identification de l’administrateur

### 2.1 Claim retenu

L’administrateur est identifié dans les métadonnées applicatives du JWT :

```json
{
  "role": "admin"
}
```

Le test porte sur :

```text
app_metadata.role
```

et jamais sur `user_metadata`, qui peut être modifié par l’utilisateur.

Le claim est positionné uniquement depuis un environnement administrateur de confiance : tableau de bord Supabase, Admin API ou procédure serveur équivalente.

### 2.2 Actualisation du JWT

Une modification de `app_metadata` n’est visible dans `auth.jwt()` qu’après actualisation du token.

Après ajout ou retrait du rôle administrateur, il faut :

- renouveler la session ;
- ou déconnecter puis reconnecter le compte ;
- puis vérifier le nouveau JWT avant toute opération sensible.

### 2.3 Schéma privé

```sql
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
```

Le schéma `private` ne doit pas être ajouté à la liste des schémas exposés par le Data API.

### 2.4 Fonction `private.is_admin()`

Cette fonction ne lit aucune table et n’a pas besoin de contourner la RLS.

```sql
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.coalesce(
    ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;
```

Les politiques destinées à `anon` ne doivent pas appeler cette fonction.

---

## 3. Fonctions auxiliaires RLS

Les fonctions suivantes évitent les sous-requêtes récursives, notamment sur `circle_members`.

Elles doivent :

- être créées par le rôle de migration de confiance ;
- utiliser `SECURITY DEFINER` ;
- fixer un `search_path` vide ;
- qualifier explicitement toutes les tables ;
- retourner uniquement un booléen ;
- ne jamais accepter de SQL dynamique.

### 3.1 Membre actif d’un cercle

```sql
CREATE OR REPLACE FUNCTION private.is_active_circle_member(p_circle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id
      AND cm.user_id = (SELECT auth.uid())
      AND cm.status = 'active'
  );
$$;
```

### 3.2 Appartenance ou invitation personnelle

Cette fonction permet à un utilisateur invité de voir le cercle associé à sa propre invitation.

```sql
CREATE OR REPLACE FUNCTION private.has_circle_access(p_circle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id
      AND cm.user_id = (SELECT auth.uid())
      AND cm.status IN ('pending', 'active')
  );
$$;
```

### 3.3 Créateur d’un cercle

```sql
CREATE OR REPLACE FUNCTION private.is_circle_creator(p_circle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.circles c
    WHERE c.id = p_circle_id
      AND c.created_by = (SELECT auth.uid())
  );
$$;
```

### 3.4 Propriétaire d’un ticket

```sql
CREATE OR REPLACE FUNCTION private.is_receipt_owner(p_receipt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.receipts r
    WHERE r.id = p_receipt_id
      AND r.user_id = (SELECT auth.uid())
  );
$$;
```

### 3.5 Propriétaire d’un snapshot

```sql
CREATE OR REPLACE FUNCTION private.is_snapshot_owner(p_snapshot_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recommendation_snapshots s
    WHERE s.id = p_snapshot_id
      AND s.user_id = (SELECT auth.uid())
  );
$$;
```

### 3.6 Propriétaire d’un ticket à partir d’un chemin Storage

```sql
CREATE OR REPLACE FUNCTION private.is_receipt_owner_text(p_receipt_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.receipts r
    WHERE r.id::text = p_receipt_id
      AND r.user_id = (SELECT auth.uid())
  );
$$;
```

### 3.7 Droits d’exécution

```sql
REVOKE ALL ON FUNCTION private.is_active_circle_member(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.has_circle_access(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_circle_creator(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_receipt_owner(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_snapshot_owner(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_receipt_owner_text(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.is_active_circle_member(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_circle_access(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_circle_creator(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_receipt_owner(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_snapshot_owner(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_receipt_owner_text(text)
  TO authenticated;
```

---

## 4. Matrice des canaux d’accès

| Table | Lecture client | Écriture client directe | Écriture contrôlée |
|---|---|---|---|
| `retailers`, `brands`, `categories`, `subcategories`, `products` | publique | admin authentifié | migrations / admin |
| `product_variants`, `product_aliases` | selon statut | création `pending` | validation admin |
| `stores` | publique | création `unverified` | modification via serveur ; validation admin |
| `receipts` | propriétaire | non | serveur |
| `receipt_images` | propriétaire | non pour la table | serveur |
| `receipt_lines` | propriétaire | non | serveur / RPC de confirmation |
| `prices` | propriétaire ou cercle | non | serveur / RPC métier |
| `recommendation_snapshots` | propriétaire | non | serveur |
| `recommendation_snapshot_items` | propriétaire | non | serveur |
| `circles` | membre ou invité concerné | création ; modification limitée du nom/code | serveur pour suppression |
| `circle_members` | membre ou invité concerné | non | RPC dédiées |
| `favorites`, `shopping_list` | propriétaire | oui | — |

---

## 5. Politiques des tables de référence

Tables concernées :

- `retailers` ;
- `brands` ;
- `categories` ;
- `subcategories` ;
- `products`.

Pour chacune :

```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<table>_read_public"
ON public.<table>
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "<table>_insert_admin"
ON public.<table>
FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.is_admin()));

CREATE POLICY "<table>_update_admin"
ON public.<table>
FOR UPDATE
TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));
```

Aucune politique `DELETE` cliente n’est créée.

---

## 6. Référentiel enrichi

### 6.1 `product_variants`

```sql
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_variants_read_validated"
ON public.product_variants
FOR SELECT
TO anon, authenticated
USING (validation_status = 'validated');

CREATE POLICY "product_variants_read_own_candidate"
ON public.product_variants
FOR SELECT
TO authenticated
USING (
  created_by = (SELECT auth.uid())
  AND validation_status IN ('pending', 'rejected')
);

CREATE POLICY "product_variants_read_admin"
ON public.product_variants
FOR SELECT
TO authenticated
USING ((SELECT private.is_admin()));

CREATE POLICY "product_variants_insert_pending"
ON public.product_variants
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND validation_status = 'pending'
  AND validated_by IS NULL
  AND validated_at IS NULL
);

CREATE POLICY "product_variants_update_admin"
ON public.product_variants
FOR UPDATE
TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));
```

Aucune suppression directe n’est accordée.

### 6.2 `product_aliases`

```sql
ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_aliases_read_validated"
ON public.product_aliases
FOR SELECT
TO anon, authenticated
USING (validation_status = 'validated');

CREATE POLICY "product_aliases_read_own_candidate"
ON public.product_aliases
FOR SELECT
TO authenticated
USING (
  created_by = (SELECT auth.uid())
  AND validation_status IN ('pending', 'rejected')
);

CREATE POLICY "product_aliases_read_admin"
ON public.product_aliases
FOR SELECT
TO authenticated
USING ((SELECT private.is_admin()));

CREATE POLICY "product_aliases_insert_pending"
ON public.product_aliases
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())
  AND validation_status = 'pending'
  AND validated_by IS NULL
  AND validated_at IS NULL
);

CREATE POLICY "product_aliases_update_admin"
ON public.product_aliases
FOR UPDATE
TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));
```

---

## 7. Magasins

### 7.1 Lecture et création

```sql
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stores_read_public"
ON public.stores
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "stores_insert_unverified"
ON public.stores
FOR INSERT
TO authenticated
WITH CHECK (
  status = 'unverified'
  AND created_by = (SELECT auth.uid())
  AND merged_into_store_id IS NULL
);
```

### 7.2 Modification

Aucun `UPDATE` direct n’est accordé au rôle `authenticated`.

- le créateur peut corriger sa proposition `unverified` via une Edge Function ou une RPC qui préserve `id`, `created_by`, `created_at` et `status` ;
- l’administrateur valide, ferme ou fusionne un magasin via un service serveur ;
- aucune suppression directe n’est autorisée.

Cette règle évite qu’un utilisateur modifie des colonnes techniques non prévues par le formulaire.

---

## 8. Tickets, images et lignes

### 8.1 `receipts`

```sql
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipts_read_owner"
ON public.receipts
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "receipts_read_admin"
ON public.receipts
FOR SELECT
TO authenticated
USING ((SELECT private.is_admin()));
```

Aucune politique cliente `INSERT`, `UPDATE` ou `DELETE` n’est créée.

### 8.2 `receipt_images`

```sql
ALTER TABLE public.receipt_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipt_images_read_owner"
ON public.receipt_images
FOR SELECT
TO authenticated
USING ((SELECT private.is_receipt_owner(receipt_id)));

CREATE POLICY "receipt_images_read_admin"
ON public.receipt_images
FOR SELECT
TO authenticated
USING ((SELECT private.is_admin()));
```

### 8.3 `receipt_lines`

```sql
ALTER TABLE public.receipt_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipt_lines_read_owner"
ON public.receipt_lines
FOR SELECT
TO authenticated
USING ((SELECT private.is_receipt_owner(receipt_id)));

CREATE POLICY "receipt_lines_read_admin"
ON public.receipt_lines
FOR SELECT
TO authenticated
USING ((SELECT private.is_admin()));
```

La confirmation utilisateur d’une suggestion doit passer par une opération serveur qui :

- vérifie la propriété du ticket ;
- interdit `validation_method = 'admin'` ou `'automatic'` ;
- fixe `validation_method = 'user'` ;
- fixe `validated_by = auth.uid()` ;
- limite les colonnes modifiables ;
- vérifie la cohérence `product_id` / `product_variant_id`.

---

## 9. Prix

```sql
ALTER TABLE public.prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prices_read_owner_circle_admin"
ON public.prices
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (
    shared_with_circle = true
    AND circle_id IS NOT NULL
    AND (SELECT private.is_active_circle_member(circle_id))
  )
  OR (SELECT private.is_admin())
);
```

Aucune écriture directe n’est accordée au client.

Les opérations suivantes passent par le serveur :

- création d’un prix de ticket ;
- création d’un prix manuel ;
- import ;
- validation ou archivage ;
- partage ou retrait du partage avec un cercle.

Lors d’un partage, le serveur doit vérifier que :

- le prix appartient à l’utilisateur ;
- `circle_id` correspond à son cercle actif ;
- l’utilisateur est membre actif de ce cercle.

---

## 10. Snapshots du comparateur

### 10.1 `recommendation_snapshots`

```sql
ALTER TABLE public.recommendation_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_read_owner"
ON public.recommendation_snapshots
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "snapshots_read_admin"
ON public.recommendation_snapshots
FOR SELECT
TO authenticated
USING ((SELECT private.is_admin()));
```

### 10.2 `recommendation_snapshot_items`

```sql
ALTER TABLE public.recommendation_snapshot_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshot_items_read_owner"
ON public.recommendation_snapshot_items
FOR SELECT
TO authenticated
USING ((SELECT private.is_snapshot_owner(snapshot_id)));

CREATE POLICY "snapshot_items_read_admin"
ON public.recommendation_snapshot_items
FOR SELECT
TO authenticated
USING ((SELECT private.is_admin()));
```

Les snapshots sont calculés et écrits exclusivement côté serveur.

---

## 11. Cercles

### 11.1 Création automatique du propriétaire

La fonction déclenchée après création du cercle doit contourner la RLS de façon contrôlée.

```sql
CREATE OR REPLACE FUNCTION private.create_circle_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.circle_members (
    circle_id,
    user_id,
    role,
    status,
    joined_at
  )
  VALUES (
    NEW.id,
    NEW.created_by,
    'owner',
    'active',
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.create_circle_owner()
FROM PUBLIC, anon, authenticated;
```

Le trigger est créé par la migration :

```sql
CREATE TRIGGER circles_create_owner
AFTER INSERT ON public.circles
FOR EACH ROW
EXECUTE FUNCTION private.create_circle_owner();
```

### 11.2 `circles`

```sql
ALTER TABLE public.circles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "circles_read_member_or_invited"
ON public.circles
FOR SELECT
TO authenticated
USING (
  (SELECT private.has_circle_access(id))
  OR (SELECT private.is_admin())
);

CREATE POLICY "circles_insert_authenticated"
ON public.circles
FOR INSERT
TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()));

CREATE POLICY "circles_update_creator"
ON public.circles
FOR UPDATE
TO authenticated
USING (created_by = (SELECT auth.uid()))
WITH CHECK (created_by = (SELECT auth.uid()));
```

Le droit SQL `UPDATE` est limité aux colonnes `name` et `invite_code`.

Aucune suppression directe n’est accordée.

### 11.3 `circle_members` — lecture sans récursion

```sql
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "circle_members_read_own_row"
ON public.circle_members
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY "circle_members_read_active_circle"
ON public.circle_members
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_circle_member(circle_id)));

CREATE POLICY "circle_members_read_admin"
ON public.circle_members
FOR SELECT
TO authenticated
USING ((SELECT private.is_admin()));
```

Aucune politique directe `INSERT`, `UPDATE` ou `DELETE` n’est créée.

---

## 12. RPC sécurisées pour les membres des cercles

Les fonctions RPC sont créées dans `public` afin d’être appelables via l’API. Elles utilisent `SECURITY DEFINER`, un `search_path` vide et des contrôles explicites.

### 12.1 Inviter un membre

```sql
CREATE OR REPLACE FUNCTION public.invite_circle_member(
  p_circle_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF NOT private.is_circle_creator(p_circle_id) THEN
    RAISE EXCEPTION 'not circle creator';
  END IF;

  IF p_user_id = (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'owner is already a member';
  END IF;

  INSERT INTO public.circle_members AS cm (
    circle_id, user_id, role, status, joined_at
  )
  VALUES (
    p_circle_id, p_user_id, 'member', 'pending', NULL
  )
  ON CONFLICT (circle_id, user_id)
  DO UPDATE SET
    role = 'member',
    status = 'pending',
    joined_at = NULL
  WHERE cm.status IN ('declined', 'removed')
  RETURNING id INTO v_membership_id;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'membership already pending or active';
  END IF;

  RETURN v_membership_id;
END;
$$;
```

### 12.2 Répondre à sa propre invitation

```sql
CREATE OR REPLACE FUNCTION public.respond_circle_invitation(
  p_membership_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership public.circle_members;
BEGIN
  SELECT *
  INTO v_membership
  FROM public.circle_members
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_membership.user_id <> (SELECT auth.uid())
     OR v_membership.role <> 'member'
     OR v_membership.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid invitation';
  END IF;

  UPDATE public.circle_members
  SET
    status = CASE WHEN p_accept THEN 'active' ELSE 'declined' END,
    joined_at = CASE WHEN p_accept THEN now() ELSE NULL END
  WHERE id = p_membership_id;
END;
$$;
```

L’index unique sur un cercle actif par utilisateur bloque automatiquement l’acceptation si l’utilisateur appartient déjà à un autre cercle actif.

### 12.3 Retirer un membre

```sql
CREATE OR REPLACE FUNCTION public.remove_circle_member(
  p_membership_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership public.circle_members;
BEGIN
  SELECT *
  INTO v_membership
  FROM public.circle_members
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_membership.role = 'owner'
     OR NOT private.is_circle_creator(v_membership.circle_id) THEN
    RAISE EXCEPTION 'operation not allowed';
  END IF;

  UPDATE public.circle_members
  SET status = 'removed'
  WHERE id = p_membership_id;
END;
$$;
```

### 12.4 Quitter un cercle

```sql
CREATE OR REPLACE FUNCTION public.leave_circle(p_circle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.circle_members
  SET status = 'removed'
  WHERE circle_id = p_circle_id
    AND user_id = (SELECT auth.uid())
    AND role = 'member'
    AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active membership not found';
  END IF;
END;
$$;
```

### 12.5 Droits RPC

```sql
REVOKE ALL ON FUNCTION public.invite_circle_member(uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.respond_circle_invitation(uuid, boolean)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_circle_member(uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leave_circle(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.invite_circle_member(uuid, uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_circle_invitation(uuid, boolean)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_circle_member(uuid)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_circle(uuid)
TO authenticated;
```

---

## 13. Favoris et liste de courses

### 13.1 `favorites`

```sql
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_owner"
ON public.favorites
FOR ALL
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));
```

### 13.2 `shopping_list`

```sql
ALTER TABLE public.shopping_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shopping_list_owner"
ON public.shopping_list
FOR ALL
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));
```

---

## 14. Vue `comparable_prices`

La vue doit avoir été créée avec :

```sql
WITH (security_invoker = true)
```

Elle n’est jamais appelée directement depuis le client :

```sql
REVOKE ALL ON public.comparable_prices
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.comparable_prices
TO service_role;
```

Le service serveur doit limiter la réponse aux données nécessaires au comparateur.

---

## 15. Storage des tickets

### 15.1 Bucket privé

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('tickets', 'tickets', false)
ON CONFLICT (id)
DO UPDATE SET public = false;
```

Convention :

```text
{user_id}/{receipt_id}/{display_order}.jpg
```

Le nom du bucket n’est pas répété dans la clé d’objet.

### 15.2 Lecture

```sql
CREATE POLICY "tickets_storage_read_owner"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'tickets'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND (SELECT private.is_receipt_owner_text(
    (storage.foldername(name))[2]
  ))
);
```

### 15.3 Import

```sql
CREATE POLICY "tickets_storage_insert_owner"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'tickets'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND (SELECT private.is_receipt_owner_text(
    (storage.foldername(name))[2]
  ))
);
```

Aucun droit client `UPDATE` ou `DELETE` n’est accordé.

- l’application n’utilise pas `upsert` pour les photos ;
- un remplacement ou nettoyage passe par le serveur ;
- le `service_role` assure les suppressions cohérentes avec `receipt_images`.

---

## 16. Tables transverses existantes

Les tables `profiles` et `feedback` sont conservées hors du cœur du modèle.

Leur schéma réel et leurs politiques existantes doivent être inventoriés avant la bascule.

Tant que cet audit n’est pas terminé :

```sql
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.feedback FROM anon, authenticated;
```

La bascule reste bloquée si l’application dépend de l’une de ces tables sans politique validée.

Aucune politique n’est inventée dans ce document sans connaître leurs colonnes réelles.

---

## 17. GRANT minimaux

Les droits suivants sont appliqués après création des politiques.

### 17.1 Tables de référence

```sql
GRANT SELECT ON
  public.retailers,
  public.brands,
  public.categories,
  public.subcategories,
  public.products
TO anon, authenticated;

GRANT INSERT, UPDATE ON
  public.retailers,
  public.brands,
  public.categories,
  public.subcategories,
  public.products
TO authenticated;
```

### 17.2 Variantes et alias

```sql
GRANT SELECT ON
  public.product_variants,
  public.product_aliases
TO anon, authenticated;

GRANT INSERT, UPDATE ON
  public.product_variants,
  public.product_aliases
TO authenticated;
```

### 17.3 Magasins

```sql
GRANT SELECT ON public.stores TO anon, authenticated;
GRANT INSERT ON public.stores TO authenticated;
```

### 17.4 Données sensibles en lecture seule côté client

```sql
GRANT SELECT ON
  public.receipts,
  public.receipt_images,
  public.receipt_lines,
  public.prices,
  public.recommendation_snapshots,
  public.recommendation_snapshot_items
TO authenticated;
```

### 17.5 Cercles

```sql
GRANT SELECT, INSERT ON public.circles TO authenticated;
GRANT UPDATE (name, invite_code) ON public.circles TO authenticated;
GRANT SELECT ON public.circle_members TO authenticated;
```

### 17.6 Données personnelles modifiables

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.favorites,
  public.shopping_list
TO authenticated;
```

### 17.7 Serveur

```sql
GRANT USAGE ON SCHEMA public, private TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, private TO service_role;
```

---

## 18. Index nécessaires aux politiques

Les index suivants complètent ceux du document 02 :

```sql
CREATE INDEX IF NOT EXISTS product_variants_creator_status_idx
ON public.product_variants (created_by, validation_status);

CREATE INDEX IF NOT EXISTS product_aliases_creator_status_idx
ON public.product_aliases (created_by, validation_status);

CREATE INDEX IF NOT EXISTS stores_creator_status_idx
ON public.stores (created_by, status);

CREATE INDEX IF NOT EXISTS prices_circle_idx
ON public.prices (circle_id)
WHERE shared_with_circle = true;

CREATE INDEX IF NOT EXISTS circles_created_by_idx
ON public.circles (created_by);

CREATE INDEX IF NOT EXISTS shopping_list_user_idx
ON public.shopping_list (user_id);
```

Les index déjà prévus sur `receipts.user_id`, `prices.user_id`, `recommendation_snapshots.user_id` et `circle_members` sont conservés.

---

## 19. Ordre de déploiement

1. auditer les politiques existantes et les dépendances de `profiles` et `feedback` ;
2. créer ou vérifier le schéma `private` ;
3. créer `private.is_admin()` ;
4. créer les fonctions auxiliaires RLS ;
5. créer les RPC des cercles ;
6. sécuriser le trigger de création du propriétaire ;
7. activer RLS sur toutes les tables ;
8. déployer les politiques de lecture ;
9. déployer les politiques de création contrôlée ;
10. appliquer les `REVOKE` et `GRANT` ;
11. créer les index RLS ;
12. créer le bucket privé et ses politiques ;
13. vérifier `comparable_prices` ;
14. actualiser le JWT administrateur ;
15. exécuter tous les tests en staging ;
16. autoriser la bascule uniquement après validation complète.

---

## 20. Tests de sécurité obligatoires

Les tests utilisent au minimum :

- un contexte `anon` ;
- un utilisateur A ;
- un utilisateur B ;
- un administrateur ;
- un contexte serveur `service_role`.

### 20.1 Lecture

| Scénario | Résultat |
|---|---|
| Catégories sans connexion | autorisé |
| Variante validée sans connexion | autorisé |
| Variante `pending` d’un autre utilisateur | refusé |
| Ticket ou image d’un autre utilisateur | refusé |
| Prix privé d’un autre utilisateur | refusé |
| Prix partagé avec membre actif du cercle | autorisé |
| Prix partagé sans appartenance active | refusé |
| Snapshot d’un autre utilisateur | refusé |
| Accès client direct à `comparable_prices` | refusé |

### 20.2 Écriture sensible

| Scénario | Résultat |
|---|---|
| INSERT direct dans `receipt_lines` | refusé |
| UPDATE direct d’un score ou statut OCR | refusé |
| INSERT direct d’un prix validé | refusé |
| UPDATE direct de `is_validated` ou `is_archived` | refusé |
| INSERT direct d’un snapshot | refusé |
| Création d’une variante déjà `validated` | refusé |
| Validation d’un alias par un non-admin | refusé |
| Création d’un magasin `active` | refusé |
| Modification directe d’un magasin | refusé |

### 20.3 Cercles

| Scénario | Résultat |
|---|---|
| Création d’un cercle | propriétaire actif créé automatiquement |
| Invitation par un non-créateur | refusée |
| Invitation créée directement dans `circle_members` | refusée |
| Lecture de sa propre invitation `pending` | autorisée |
| Acceptation de sa propre invitation via RPC | autorisée |
| Acceptation d’une invitation d’un autre utilisateur | refusée |
| Acceptation alors qu’un autre cercle est actif | refusée |
| Modification directe de son rôle | refusée |
| Suppression ou retrait du propriétaire | refusé |
| Retrait d’un membre par le créateur via RPC | autorisé |

### 20.4 Storage

| Scénario | Résultat |
|---|---|
| Upload dans son dossier et son ticket | autorisé |
| Upload dans le dossier d’un autre utilisateur | refusé |
| Upload vers un ticket qui ne lui appartient pas | refusé |
| Lecture d’une photo d’un autre utilisateur | refusée |
| Upsert client | refusé |
| Suppression client | refusée |
| Nettoyage serveur | autorisé |

### 20.5 Administration

| Scénario | Résultat |
|---|---|
| Claim admin absent | droits admin refusés |
| Claim placé dans `user_metadata` seulement | droits admin refusés |
| Claim placé dans `app_metadata` et JWT renouvelé | droits admin autorisés |
| JWT non renouvelé après changement de rôle | ancien droit encore observé jusqu’au rafraîchissement |

---

## 21. Critères bloquants avant bascule

La bascule est interdite tant que l’un des points suivants subsiste :

- une table publique sans RLS ;
- une table sensible avec écriture directe `authenticated` ;
- une politique récursive sur `circle_members` ;
- une fonction `SECURITY DEFINER` sans `search_path` fixé ;
- une fonction RPC exécutable par `anon` ou `PUBLIC` ;
- un bucket ticket public ;
- un accès client à `comparable_prices` ;
- un test croisé utilisateur A / utilisateur B en échec ;
- une politique inconnue ou non validée sur `profiles` ou `feedback` si l’application les utilise ;
- un rôle admin modifié sans renouvellement du JWT.

---

## 22. Versionnage

| Version | Date | Nature |
|---|---|---|
| 1.0 | 30 juin 2026 | Version fondatrice |
| 1.1 | 30 juin 2026 | Séparation lecture/écriture, correction des fonctions admin, suppression des politiques récursives, RPC sécurisées pour les cercles, protection des données sensibles, couverture Storage et tables transverses |

---

## 23. Documents liés

1. Document 01 v1.2 — Référentiel Produit  
2. Document 02 v1.4 — Modèle de données  
3. Document 03 v1.1 — Product Intelligence Engine  
4. Document 04 v1.2 — Règles métier  
5. Document 05 v1.1 — Architecture fonctionnelle  
6. Document 06 v1.2 — Plan de migration Supabase  
7. Document 08 v1.1 — présent document  

---

*Aucune bascule ne doit avoir lieu tant que les droits SQL, les politiques RLS, les fonctions serveur et les scénarios multi-utilisateurs n’ont pas été validés ensemble.*
