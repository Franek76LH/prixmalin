// Chantier 164 — « Scanner un code-barres » pour retrouver un produit.
// Lecture seule : codes_barres_variante (lisible par tout compte connecté,
// code UNIQUE → au plus une variante) puis la variante active et sa fiche.
// Même règle de rattrapage que la feuille de correction des tickets.

// Codes à essayer : le code tel quel (espaces retirés, zéros initiaux gardés)
// + l'équivalent UPC-A (12 chiffres) <-> EAN-13 (13 chiffres, préfixe 0).
export function candidatsCodeBarres(codeBrut) {
  const code = String(codeBrut || '').replace(/\s+/g, '');
  if (!code) return [];
  const candidats = [code];
  if (/^\d{12}$/.test(code)) candidats.push('0' + code);
  if (/^0\d{12}$/.test(code)) candidats.push(code.slice(1));
  return candidats;
}

// → { statut: 'trouve', code, variante: { id, produit_id, libelle, produits: { nom_reference } } }
//   | { statut: 'inconnu', code } | { statut: 'erreur', code }
export async function chercherProduitParCodeBarres(client, codeBrut) {
  const candidats = candidatsCodeBarres(codeBrut);
  const code = candidats[0] || '';
  if (!code) return { statut: 'inconnu', code };
  try {
    const { data: cbv, error } = await client
      .from('codes_barres_variante')
      .select('variante_produit_id, code_barres')
      .in('code_barres', candidats)
      .limit(1);
    if (error) return { statut: 'erreur', code };
    const trouve = cbv && cbv[0];
    if (!trouve) return { statut: 'inconnu', code };
    const { data: variante, error: errV } = await client
      .from('variantes_produit')
      .select('id, produit_id, libelle, produits(nom_reference)')
      .eq('id', trouve.variante_produit_id)
      .eq('actif', true)
      .maybeSingle();
    if (errV) return { statut: 'erreur', code };
    if (!variante || !variante.produit_id) return { statut: 'inconnu', code };
    return { statut: 'trouve', code, variante };
  } catch {
    return { statut: 'erreur', code };
  }
}
