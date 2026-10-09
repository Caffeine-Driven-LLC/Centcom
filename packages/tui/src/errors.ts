/** What a person reads when the agent fails: what happened, in plain words, and the one thing to do next. */
export interface ErrorGuide { title: string; /** Plain-language reason and the next step. */ help: string }

const SETUP: Record<string, { install: string; login: string }> = {
  'Claude Code': { install: 'Install it from https://docs.claude.com/en/docs/claude-code, then start Centcom again.', login: 'Run `claude` in another terminal and sign in, then send your message again.' },
  Codex: { install: 'Install it from https://github.com/openai/codex, then start Centcom again.', login: 'Run `codex login` in another terminal, then send your message again.' },
};

export function errorGuide(code: string, engineLabel = 'The agent'): ErrorGuide {
  const e = SETUP[engineLabel] ?? { install: `Install ${engineLabel}, then start Centcom again.`, login: `Sign in to ${engineLabel} in another terminal, then send your message again.` };
  switch (code) {
    case 'provider_not_installed': return { title: `${engineLabel} is not installed`, help: `Centcom drives your own copy of ${engineLabel} and could not find it. ${e.install}` };
    case 'provider_not_signed_in': return { title: `You are not signed in to ${engineLabel}`, help: `${engineLabel} needs you to sign in first. ${e.login}` };
    case 'provider_method_disabled': return { title: 'This way of signing in is turned off', help: 'Centcom does not use that sign-in method. Use the sign-in of the agent itself, or run `centcom doctor` to see what is set up.' };
    case 'provider_policy_blocked': return { title: 'Blocked by your account or policy', help: 'This action is not allowed for the account or workspace you are using. Switch to another account or ask whoever manages the workspace.' };
    case 'provider_cap_reached': return { title: 'Usage limit reached', help: `${engineLabel} says you have used up your plan for now. Wait for it to reset (the status line shows when), or pick a lighter model with /model.` };
    case 'provider_rate_limited': return { title: 'The service is busy', help: 'Too many requests at once. Centcom retries on its own; if it keeps happening, wait a minute and send again.' };
    case 'provider_version_unsupported': return { title: `This version of ${engineLabel} is not supported`, help: `Update ${engineLabel} to its latest version, then start Centcom again. \`centcom doctor\` shows the version it found.` };
    case 'provider_protocol_error': return { title: `${engineLabel} sent something Centcom could not read`, help: 'Send your message again. If it keeps happening, update both tools and run `centcom doctor`.' };
    case 'provider_capability_missing': return { title: `${engineLabel} cannot do that`, help: 'The installed version does not support this. Updating it usually fixes it.' };
    default: return { title: 'Something went wrong', help: 'Send your message again. If it keeps happening, run `centcom doctor`, or `centcom crash` to see what was recorded.' };
  }
}
