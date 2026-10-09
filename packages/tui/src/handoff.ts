/** The two prompts of a handoff: one asks the agent for the document, the other opens the fresh session. */
export const HANDOFF_PROMPT = `This session is running out of context, and a new session will take over from here with none of this conversation. Write a handoff document for it.

Reply with ONLY the document, in Markdown, as your answer. Do not use any tools, do not create or edit any file, and add nothing before or after it. Start with a "# Handoff" heading, then these sections, concrete and short (real file paths, real commands, real names; no filler):

## Goal
What the person is trying to achieve, in their terms, and what "done" looks like.

## Where things stand
What is finished, what is half-done (and in which state), what has not been started.

## Next step
The single next thing to do, specific enough to start at once.

## Decisions and why
Choices made, approaches tried and dropped, and the reasons, so they are not argued again.

## Files and code that matter
The files changed or central to the work, one line each on what they hold or what changed. Mention the branch and uncommitted changes if there are any.

## How to run and check
Commands to build, test and run, and what a good result looks like. Include anything that is currently failing.

## Gotchas and open questions
Traps, odd behaviour, things that are unverified, and questions the person still has to answer.

## Rules to keep following
Instructions and preferences the person gave that must carry on (style, things not to touch, how they want to work).`;

export const readPrompt = (path: string): string =>
  `You are taking over work from an earlier session whose context ran full. Everything you need to know is in the handoff document ${path}. Read it completely first, then say in two or three sentences what the goal and the next step are, and carry on with that next step. If something in the document looks out of date, check the files before relying on it.`;
