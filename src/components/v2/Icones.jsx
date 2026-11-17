// Chantier 123 — pictogrammes au trait (pas d'emoji dans la navigation : ils
// changent d'aspect d'un téléphone à l'autre et brouillent la lecture).
const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const IconeAccueil = (p) => (<svg {...base} {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></svg>);
export const IconeListe = (p) => (<svg {...base} {...p}><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" /></svg>);
export const IconeScanner = (p) => (<svg {...base} {...p}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M8 9h8M8 12h8M8 15h5" /></svg>);
export const IconeComparer = (p) => (<svg {...base} {...p}><path d="M12 4v16M6 20h12" /><path d="M5 8h14" /><path d="m5 8-2.5 6a2.7 2.7 0 0 0 5 0L5 8ZM19 8l-2.5 6a2.7 2.7 0 0 0 5 0L19 8Z" /></svg>);
export const IconeMoi = (p) => (<svg {...base} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>);
export const IconeLoupe = (p) => (<svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>);
export const IconeChevron = (p) => (<svg {...base} {...p}><path d="m9 6 6 6-6 6" /></svg>);
export const IconeMicro = (p) => (<svg {...base} {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>);
export const IconeRetour = (p) => (<svg {...base} {...p}><path d="m15 6-6 6 6 6" /></svg>);
export const IconePlus = (p) => (<svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>);
export const IconeCroix = (p) => (<svg {...base} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>);
export const IconeCrayon = (p) => (<svg {...base} {...p}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>);
export const IconeCoche = (p) => (<svg {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>);
