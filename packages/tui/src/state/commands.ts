export interface SlashCommand { name: string; args?: string; desc: string }
export const COMMANDS: SlashCommand[] = [
  { name: 'help', desc: 'Show keys and commands' },
  { name: 'clear', desc: 'Clear the transcript' },
  { name: 'agents', desc: 'Show or hide the fleet panel' },
  { name: 'mode', args: '[default|edits|plan|bypass]', desc: 'Set how permissions are asked (bypass = dangerously skip permissions)' },
  { name: 'mascot', args: '[large|small|off|auto]', desc: 'Change how big Cento is' },
  { name: 'color', args: '[violet|red|yellow|green|brown]', desc: 'Change Cento\'s colour' },
  { name: 'theme', args: '[dark|light]', desc: 'Switch Graphite / Paper' },
  { name: 'motion', args: '[full|reduced]', desc: 'Turn mascot animation on or off' },
  { name: 'cento', args: '[animation]', desc: 'Browse all 319 Cento animations' },
  { name: 'demo', args: '[fix|search|delete|compact|ask|error|limit]', desc: 'Run a scripted demo story' },
  { name: 'model', args: '[name]', desc: 'Pick the model (ctrl+o)' },
  { name: 'auto', args: '[on|off]', desc: 'Auto skills: apply matching skills and commands to your prompts' },
  { name: 'skills', args: '[filter | enable <id> | disable <id>]', desc: 'List, enable or disable the skills Centcom can auto-apply' },
  { name: 'interrupt', desc: 'Stop the running agent' },
  { name: 'quit', desc: 'Leave Centcom' },
];
