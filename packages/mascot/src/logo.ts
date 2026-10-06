import { textRows } from './font.js';
/** The CENTCOM wordmark in the 3x5 pixel font, drawn with the violet body colour. */
export function logoRows(text = 'CENTCOM', color = 'B'): string[] { return textRows(text, color); }
