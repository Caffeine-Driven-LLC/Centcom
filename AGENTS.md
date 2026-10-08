# Agents working on Centcom

The rules live in [`CLAUDE.md`](CLAUDE.md) (read it first: the lane loop, the protected paths, the PR pipeline) and in `plan/START_HERE.md`, `plan/GUIDELINES.md` and the lane card you are building (`plan/lanes/client/C###.json`). Contracts in `contracts/` win over cards. Run `tools/ci/gates.sh` before every push (do not pipe it). Never edit a protected path, never merge or approve, never comment on your own PRs.
