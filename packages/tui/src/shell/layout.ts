/** Where everything goes: header and footer one row each, a prompt of 3 to 12 rows, an optional toast row and a 28-column rail from 100 columns. */
export type LayoutClass = 'ok' | 'narrow' | 'short' | 'tiny';
export interface Layout { cols: number; rows: number; cls: LayoutClass; railVisible: boolean; railWidth: number; transcriptCols: number; transcriptRows: number; promptRows: number }
export const RAIL_WIDTH = 28; export const RAIL_MIN_COLS = 100; export const MIN_COLS = 80; export const MIN_ROWS = 24; export const TOO_SMALL = `Terminal too small. Need ${MIN_COLS}x${MIN_ROWS}.`;
export function layoutClass(cols: number, rows: number): LayoutClass { if (cols < 40 || rows < 10) return 'tiny'; if (cols < MIN_COLS) return 'narrow'; if (rows < MIN_ROWS) return 'short'; return 'ok'; }
export function computeLayout(o: { cols: number; rows: number; promptRows?: number; toast?: boolean; rail?: boolean }): Layout {
  const cols = Math.max(1, o.cols); const rows = Math.max(1, o.rows); const prompt = Math.min(12, Math.max(3, o.promptRows ?? 3)); const cls = layoutClass(cols, rows); const railVisible = !!o.rail && cols >= RAIL_MIN_COLS && cls !== 'tiny';
  const fixed = 2 + prompt + (o.toast ? 1 : 0); return { cols, rows, cls, railVisible, railWidth: railVisible ? RAIL_WIDTH : 0, transcriptCols: railVisible ? cols - RAIL_WIDTH - 1 : cols, transcriptRows: Math.max(0, rows - fixed), promptRows: prompt };
}
