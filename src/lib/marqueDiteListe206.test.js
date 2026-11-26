// Chantier 206 — mots tapés dans Ma liste, sur les vraies variantes du rayon
// « bières » (relevées en base le 26/11/2026).
import { describe, it, expect } from "vitest";
import { choisirVarianteDite } from "./marqueDite";

const BIERE = { produit_id: "biere", produit_nom: "Bière" };
const V = [
  { id: "biere-sans", libelle: null, quantite_nette: 1, unite_quantite: "pièce", produit_id: "biere", produit_nom: "Bière", marque: null, marque_id: null, est_mdd: null },
  { id: "86-original", libelle: "Original blonde intense 8,6%", quantite_nette: 500, unite_quantite: "ml", produit_id: "biere", produit_nom: "Bière", marque: "8.6", marque_id: "m86", est_mdd: false },
  { id: "86-extreme", libelle: "Extreme 50 cl", quantite_nette: 0.5, unite_quantite: "l", produit_id: "biere", produit_nom: "Bière", marque: "8.6", marque_id: "m86", est_mdd: false },
  { id: "leffe", libelle: "Rituel 9°", quantite_nette: 50, unite_quantite: "cl", produit_id: "blonde", produit_nom: "Bière blonde", marque: "Leffe", marque_id: "mleffe", est_mdd: false },
  { id: "blonde-25", libelle: null, quantite_nette: 25, unite_quantite: "cl", produit_id: "blonde", produit_nom: "Bière blonde", marque: null, marque_id: null, est_mdd: null },
];

describe("chantier 206 — marque d'un mot tapé", () => {
  it("« bière 8.6 » relié à Bière : cette marque, tous formats", () => {
    const r = choisirVarianteDite("bière 8.6", BIERE, V);
    expect(r).toMatchObject({ variante: null, marque_id: "m86", produit_id: "biere", tousFormats: true });
  });
  it("« bière 8.6 extreme » : le format précis", () => {
    expect(choisirVarianteDite("bière 8.6 extreme", BIERE, V)?.variante?.id).toBe("86-extreme");
  });
  it("« bière leffe » : la variante rangée sous la fiche voisine", () => {
    const r = choisirVarianteDite("bière leffe", BIERE, V);
    expect(r).toMatchObject({ produit_id: "blonde", autreFiche: true });
    expect(r.variante.id).toBe("leffe");
  });
  it("« bière » seul : rien ne change", () => {
    expect(choisirVarianteDite("bière", BIERE, V)).toBeNull();
  });
});
