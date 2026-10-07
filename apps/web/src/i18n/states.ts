import { STATE_NAMES } from '@centcom/states';
import { t, type MessageKey } from './index.js';
export const STATE_COUNT = STATE_NAMES.length;
/** One plain sentence for what Cento is doing, for screen readers and text-only views. An unknown state is "Cento is working". */
export function stateText(state: string, params: Record<string, string | number> = { count: 1 }): string { return (STATE_NAMES as readonly string[]).includes(state) ? t(`state.${state}` as MessageKey, params) : t('state.unknown'); }
