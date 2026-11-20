import { ELEMENT_INFO, ELEMENTS } from '../combat/elements';

/** Element colours for UI text (from the element table; 'none' = untyped effect damage). */
export const ELEMENT_COLOR_CSS: Record<string, string> = { none: '#cfe2ea', ...Object.fromEntries(ELEMENTS.map((e) => [e, ELEMENT_INFO[e].css])) };
