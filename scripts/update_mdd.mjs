import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://yqlloujowsbaulcwbyxz.supabase.co',
  'sb_publishable_CQlvPvDzDpjT3BUCn5jMXg_sXPnkdCO'
);

const updates = [
  { id: 1,  marques_distributeurs: 'Carrefour Bio; Marque Repère Bio Village; Auchan Bio' },
  { id: 2,  marques_distributeurs: 'Carrefour Bio; Auchan Bio' },
  { id: 3,  marques_distributeurs: 'Carrefour Bio; Nos Régions ont du Talent' },
  { id: 4,  marques_distributeurs: 'Carrefour Bio; Monoprix Bio' },
  { id: 5,  marques_distributeurs: 'Carrefour Bio; Nos Régions ont du Talent' },
  { id: 6,  marques_distributeurs: 'Carrefour Bio; Marque Repère' },
  { id: 7,  marques_distributeurs: 'Carrefour Bio; Marque Repère' },
  { id: 8,  marques_distributeurs: 'Filière Qualité Carrefour; Marque Repère; Jean Stalaven' },
  { id: 9,  marques_distributeurs: 'Filière Qualité Carrefour; Nos Régions ont du Talent' },
  { id: 10, marques_distributeurs: 'Marque Repère; Jean Stalaven; U' },
  { id: 11, marques_distributeurs: 'Marque Repère; Jean Stalaven; Carrefour Sensation' },
  { id: 12, marques_distributeurs: 'Carrefour Pêche Responsable; Picard' },
  { id: 13, marques_distributeurs: 'Picard; Carrefour Pêche Responsable' },
  { id: 14, marques_distributeurs: 'Picard; Marque Repère' },
  { id: 15, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 16, marques_distributeurs: 'Marque Repère; U; Auchan' },
  { id: 17, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 18, marques_distributeurs: 'Marque Repère; Auchan; Monoprix Gourmet' },
  { id: 19, marques_distributeurs: 'Marque Repère; Auchan Bio; Monoprix Bio' },
  { id: 20, marques_distributeurs: null },
  { id: 21, marques_distributeurs: 'Monoprix Gourmet; Auchan; U' },
  { id: 22, marques_distributeurs: 'Marque Repère; U; Auchan' },
  { id: 23, marques_distributeurs: 'Carrefour Traiteur; Monoprix Gourmet' },
  { id: 24, marques_distributeurs: 'Casino Saveur; Carrefour Traiteur' },
  { id: 25, marques_distributeurs: 'Carrefour Traiteur; Monoprix Gourmet' },
  { id: 26, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 27, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 28, marques_distributeurs: 'Marque Repère; Auchan; U Bio' },
  { id: 29, marques_distributeurs: 'Marque Repère; Casino Saveur; U' },
  { id: 30, marques_distributeurs: 'Marque Repère; Nos Régions ont du Talent; U' },
  { id: 31, marques_distributeurs: 'Marque Repère; Monoprix Gourmet; U Bio' },
  { id: 32, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 33, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 34, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 35, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 36, marques_distributeurs: 'Marque Repère; Auchan; Monoprix Gourmet' },
  { id: 37, marques_distributeurs: 'Marque Repère; Auchan; Monoprix Gourmet' },
  { id: 38, marques_distributeurs: 'Marque Repère; Auchan; Casino Saveur' },
  { id: 39, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 40, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 41, marques_distributeurs: 'Marque Repère; Monoprix Gourmet; Auchan' },
  { id: 42, marques_distributeurs: 'Marque Repère; Monoprix Bio; U Bio' },
  { id: 43, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 44, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 45, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 46, marques_distributeurs: "Carrefour Saveurs d'Ailleurs; Monoprix Gourmet" },
  { id: 47, marques_distributeurs: "Carrefour Saveurs d'Ailleurs; Auchan" },
  { id: 48, marques_distributeurs: 'Carrefour Bio; Auchan Bio' },
  { id: 49, marques_distributeurs: 'Carrefour Bio; Auchan Bio' },
  { id: 50, marques_distributeurs: 'Carrefour Bio; Auchan Bio' },
  { id: 51, marques_distributeurs: 'Picard; Marque Repère; Auchan' },
  { id: 52, marques_distributeurs: 'Picard; Marque Repère; Auchan' },
  { id: 53, marques_distributeurs: 'Picard; Carrefour Traiteur; Monoprix Gourmet' },
  { id: 54, marques_distributeurs: 'Picard; Auchan; Marque Repère' },
  { id: 55, marques_distributeurs: 'Picard; Auchan; Marque Repère' },
  { id: 56, marques_distributeurs: 'Picard; Marque Repère; Auchan' },
  { id: 57, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 58, marques_distributeurs: 'Auchan; U' },
  { id: 59, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 60, marques_distributeurs: 'Marque Repère; Auchan; U' },
  { id: 61, marques_distributeurs: null },
  { id: 62, marques_distributeurs: 'Marque Repère; U' },
  { id: 63, marques_distributeurs: null },
];

let ok = 0, fail = 0;
for (const { id, marques_distributeurs } of updates) {
  const { error } = await supabase
    .from('produits_ref')
    .update({ marques_distributeurs })
    .eq('id', id);
  if (error) { console.error(`id ${id}:`, error.message); fail++; }
  else ok++;
}
console.log(`Done: ${ok} updated, ${fail} failed`);
