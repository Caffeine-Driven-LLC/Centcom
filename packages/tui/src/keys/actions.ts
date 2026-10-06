/** Every shortcut is a named action. Ids are part of what people put in keybindings.json: never rename one. */
export type KeyContext = 'global' | 'prompt' | 'overlay' | 'transcript' | 'permission' | 'palette' | 'toast';
export const CONTEXTS: readonly KeyContext[] = ['global', 'prompt', 'overlay', 'transcript', 'permission', 'palette', 'toast'];
export interface ActionDef { id: string; group: string; description: string; defaults: { key: string; context: KeyContext }[] }
/** Actions that must always keep a key: the app can always be left and help can always be opened. */
export const PROTECTED = ['app.quit', 'help.open'];
const registry = new Map<string, ActionDef>();
export function registerAction(a: ActionDef): void { if (registry.has(a.id)) throw new Error(`action ${a.id} is already registered`); registry.set(a.id, a); }
export const actions = (): ActionDef[] => [...registry.values()];
const def = (id: string, group: string, description: string, ...defaults: [string, KeyContext][]) => registerAction({ id, group, description, defaults: defaults.map(([key, context]) => ({ key, context })) });
// DESIGN §22.2
def('help.open', 'General', 'Show keys and commands', ['?', 'prompt'], ['f1', 'global']);
def('app.quit', 'General', 'Quit (when the prompt is empty)', ['ctrl+d', 'prompt']);
def('palette.open', 'General', 'Open the command palette', ['ctrl+k', 'global']);
def('models.open', 'General', 'Choose the model', ['ctrl+o', 'global']);
def('mode.cycle', 'General', 'Cycle permission mode', ['shift+tab', 'global']);
def('agent.interrupt', 'Agent', 'Stop the agent / clear (twice: rewind)', ['esc', 'prompt']);
def('tasks.toggle', 'Panels', 'Show or hide the task list', ['ctrl+t', 'global']);
def('fleet.toggle', 'Panels', 'Show or hide the fleet', ['ctrl+b', 'global']);
def('transcript.bottom', 'Transcript', 'Jump to the newest message', ['ctrl+l', 'global'], ['ctrl+end', 'global']);
def('transcript.top', 'Transcript', 'Jump to the start', ['ctrl+home', 'global']);
def('transcript.page_up', 'Transcript', 'Scroll up a page', ['pageup', 'global']);
def('transcript.page_down', 'Transcript', 'Scroll down a page', ['pagedown', 'global']);
def('transcript.line_up', 'Transcript', 'Scroll up three lines', ['shift+up', 'global']);
def('transcript.line_down', 'Transcript', 'Scroll down three lines', ['shift+down', 'global']);
def('approval.approve', 'Approvals', 'Approve this once', ['y', 'permission']);
def('approval.deny', 'Approvals', 'Deny', ['n', 'permission'], ['esc', 'permission']);
def('approval.always', 'Approvals', 'Always allow (this project)', ['a', 'permission']);
def('overlay.close', 'General', 'Close the open screen', ['esc', 'overlay'], ['q', 'overlay']);
