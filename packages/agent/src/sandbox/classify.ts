import type { Risk } from '../types.js';
import { MAX_DEPTH, parseShell, type Segment } from './parse.js';
import { escapesRoot, isProtectedPath, resolvePath, type PathCtx } from './protected.js';

export interface CommandFacts { writes: boolean; deletes: boolean; network: boolean; escapesRoot: boolean; isTest: boolean; destructive: boolean }
/** `reasons` are rule ids only: never command text, paths or arguments. */
export interface CommandRisk { risk: Risk; reasons: string[]; facts: CommandFacts; autoAllowable: boolean }
export type ClassifyCtx = PathCtx;
const RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 };

class Acc {
  risk: Risk = 'low'; reasons = new Set<string>(); facts: CommandFacts = { writes: false, deletes: false, network: false, escapesRoot: false, isTest: false, destructive: false };
  up(r: Risk, why: string) { if (RANK[r] > RANK[this.risk]) this.risk = r; this.reasons.add(why); return this; }
  merge(o: Acc) { if (RANK[o.risk] > RANK[this.risk]) this.risk = o.risk; for (const r of o.reasons) this.reasons.add(r); for (const k of Object.keys(this.facts) as (keyof CommandFacts)[]) this.facts[k] ||= o.facts[k]; }
  out(): CommandRisk { const reasons = [...this.reasons]; if (this.risk === 'low' && !reasons.length) reasons.push('read_only'); return { risk: this.risk, reasons, facts: { ...this.facts }, autoAllowable: !this.facts.destructive && this.risk !== 'high' }; }
}
const high = (why: string): CommandRisk => new Acc().up('high', why).out();

const LOW = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'echo', 'printf', 'true', 'false', ':', 'date', 'whoami', 'id', 'uname', 'which', 'type', 'basename', 'dirname', 'realpath', 'readlink', 'stat', 'file', 'du', 'df', 'tree', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp', 'md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'shasum', 'md5', 'base64', 'jq', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'fd', 'fdfind', 'less', 'more', 'nl', 'tac', 'rev', 'column', 'fold', 'expand', 'seq', 'sleep', 'test', '[', '[[', 'tty', 'nproc', 'free', 'uptime', 'ps', 'pgrep', 'hostname', 'arch', 'cal', 'man', 'help', 'whereis', 'jobs', 'cd', 'pushd', 'popd', 'export', 'unset', 'alias', 'set', 'umask', 'ulimit', 'wait', 'comm', 'paste', 'join', 'od', 'xxd', 'hexdump', 'strings', 'nm', 'ldd', 'otool', 'lsb_release', 'getconf', 'locale', 'groups', 'who', 'w', 'lscpu', 'lsblk', 'sw_vers', 'tput', 'clear', 'yes', 'cksum', 'sum', 'ts', 'bat', 'exa', 'eza', 'lsd', 'delta', 'tokei', 'cloc', 'shellcheck', 'hadolint', 'actionlint', 'tsc', 'eslint', 'prettier']);
// tools that can run or write something through their arguments are not "low" by name alone
const READ_NEEDS_CHECK = new Set(['eslint', 'prettier', 'tsc']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'ash']); const INTERP = new Set(['python', 'python3', 'py', 'node', 'nodejs', 'deno', 'bun', 'ruby', 'perl', 'php', 'lua', 'Rscript', 'ts-node', 'tsx', 'osascript']);
const TEST_RUNNERS = new Set(['vitest', 'jest', 'mocha', 'pytest', 'py.test', 'tox', 'nosetests', 'rspec', 'phpunit', 'ctest', 'playwright', 'cypress', 'ava', 'tap', 'karma', 'bats']);
const WRAPPERS_PLAIN = new Set(['command', 'builtin', 'nohup', 'time', 'nice', 'ionice', 'stdbuf', 'setsid', 'exec', 'caffeinate', 'chronic', 'unbuffer']);
const PRIV = new Set(['sudo', 'doas', 'su', 'pkexec', 'runuser', 'run0']);
const SYSTEM_HIGH = new Set(['shutdown', 'reboot', 'halt', 'poweroff', 'init', 'telinit', 'crontab', 'at', 'batch', 'passwd', 'chpasswd', 'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel', 'adduser', 'deluser', 'iptables', 'ip6tables', 'nft', 'ufw', 'firewall-cmd', 'modprobe', 'insmod', 'rmmod', 'sysctl', 'chattr', 'visudo', 'mkswap', 'swapon', 'swapoff', 'mount', 'umount', 'losetup', 'cryptsetup', 'lvremove', 'vgremove', 'pvremove', 'ssh', 'telnet', 'nc', 'ncat', 'netcat', 'socat', 'mosh', 'ftp', 'sftp', 'gpg', 'gpg2', 'ssh-keygen', 'ssh-add', 'ssh-agent', 'security', 'launchctl', 'diskutil', 'defaults', 'dscl', 'spctl', 'csrutil', 'nvram', 'setenforce', 'service', 'systemctl', 'apt', 'apt-get', 'aptitude', 'dpkg', 'dnf', 'yum', 'rpm', 'pacman', 'apk', 'zypper', 'snap', 'flatpak', 'emerge', 'nix-env', 'xdg-open', 'open', 'shred', 'wipefs', 'blkdiscard', 'hdparm', 'fsck', 'e2fsck', 'resize2fs', 'tune2fs', 'sgdisk', 'gdisk', 'cfdisk', 'parted', 'fdisk', 'dd', 'mkfs', 'format', 'diskpart', 'killall', 'pkill', 'chroot', 'unshare', 'nsenter', 'setcap', 'capsh']);
const DB = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'mongosh', 'mongo', 'redis-cli', 'cqlsh', 'clickhouse-client', 'duckdb']); const CLOUD = new Set(['kubectl', 'helm', 'terraform', 'tofu', 'aws', 'gcloud', 'az', 'doctl', 'flyctl', 'fly', 'heroku', 'vercel', 'netlify', 'wrangler', 'firebase', 'pulumi', 'ansible', 'ansible-playbook', 'oc', 'gh', 'glab']);
const CLOUD_MUTATE = /^(apply|delete|destroy|create|terminate|rm|remove|put|update|deploy|sync|run|install|upgrade|uninstall|rollout|patch|replace|scale|drain|cordon|taint|label|annotate|edit|exec|cp|push|publish|release|merge|close|reopen|transfer|archive|rename|set|add|attach|detach|import|state|taint|untaint|force-unlock|workspace|secret|auth|login|logout|api)$/;
const CLOUD_READ = /^(get|describe|list|ls|show|plan|version|logs|status|validate|view|diff|top|explain|config|whoami|completion|help|--version|-v|fmt|init|search|browse|checks|check)$/;
const SQL_DANGER = /\b(drop|truncate|delete\s+from|flushall|flushdb|alter\s+table|update\s+\w+\s+set|insert\s+into)\b/i; const SQL_DESTRUCTIVE = /\b(drop|truncate|delete\s+from|flushall|flushdb)\b/i;

const base = (w: string) => w.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
const isOpt = (w: string) => w.startsWith('-') && w.length > 1; const hasFlag = (args: string[], ...fl: string[]) => args.some((a) => fl.includes(a) || (/^-[A-Za-z]+$/.test(a) && fl.some((f) => /^-[A-Za-z]$/.test(f) && a.includes(f[1]!))));
const looksPath = (w: string) => w.startsWith('/') || w.startsWith('~') || w.startsWith('.') || w.includes('/') || w.includes('\\') || /^[A-Za-z]:/.test(w);

function pathFact(a: Acc, p: string, c: ClassifyCtx, kind: 'read' | 'write' | 'delete') {
  if (p === '' || p === '-' || p === '/dev/null' || p === '/dev/stdout' || p === '/dev/stderr' || p === '/dev/tty') return;
  if (p.includes('$')) { a.up(kind === 'read' ? 'medium' : 'high', 'dynamic_path'); if (kind !== 'read') { a.facts.writes = true; a.facts.escapesRoot = true; } return; } // an expansion: nobody knows where this points
  const out = escapesRoot(p, c); if (out) a.facts.escapesRoot = true; if (kind !== 'read') { a.facts.writes = true; if (kind === 'delete') a.facts.deletes = true; }
  if (isProtectedPath(p, c, { write: kind !== 'read' })) a.up('high', kind === 'read' ? 'credential_read' : 'protected_path');
  else if (out && kind !== 'read') a.up('high', 'writes_outside_root'); else if (kind !== 'read') a.up('medium', kind === 'delete' ? 'deletes_in_root' : 'writes_in_root');
}
const targets = (args: string[]) => args.filter((x) => !isOpt(x));

function gitClassify(args: string[], a: Acc, c: ClassifyCtx) {
  let i = 0; const g = [...args];
  while (i < g.length && isOpt(g[i]!)) { const o = g[i]!; if (o === '-C' || o === '-c' || o === '--git-dir' || o === '--work-tree' || o === '--namespace') { if (o === '-c' && /alias|core\.(sshcommand|pager|editor|fsmonitor|hookspath|gitproxy)|credential\.helper|protocol|filter\./i.test(g[i + 1] ?? '')) a.up('high', 'git_config_exec'); if (o === '-C' && g[i + 1]) pathFact(a, g[i + 1]!, c, 'read'); i += 2; continue; } if (/^--(git-dir|work-tree|namespace|exec-path)=/.test(o)) { if (/^--exec-path/.test(o)) a.up('high', 'git_config_exec'); i++; continue; } i++; }
  const sub = g[i] ?? ''; const rest = g.slice(i + 1); const flags = rest.filter(isOpt); const pos = targets(rest);
  const lowSubs = new Set(['status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'describe', 'shortlog', 'grep', 'cat-file', 'show-ref', 'whatchanged', 'merge-base', 'name-rev', 'for-each-ref', 'count-objects', 'fsck', 'diff-tree', 'diff-files', 'diff-index', 'range-diff', 'check-ignore', 'check-attr', 'var', 'version', 'help', 'verify-commit', 'verify-tag', 'ls-remote', 'archive', 'bundle', 'difftool']);
  if (sub === '' || /^(--version|-v|--help|-h)$/.test(sub)) return; if (lowSubs.has(sub)) { if (sub === 'ls-remote') a.facts.network = true; if (sub === 'archive' && flags.some((f) => /^(-o|--output)/.test(f))) a.up('medium', 'writes_in_root'); return; }
  if (sub === 'push') { a.facts.network = true; if (flags.some((f) => /^(-f|--force|--force-with-lease|--force-if-includes|--delete|-d|--mirror|--prune)/.test(f)) || pos.some((p) => p.startsWith(':') || p.startsWith('+'))) { a.facts.destructive = true; a.up('high', 'git_force_push'); } else a.up('medium', 'git_push'); return; }
  if (sub === 'reset') { if (flags.some((f) => f === '--hard' || f === '--merge' || f === '--keep')) { a.facts.destructive = true; a.up('high', 'git_reset_hard'); } else a.up('medium', 'git_reset'); return; }
  if (sub === 'clean') { if (flags.some((f) => /^-[a-zA-Z]*[fdxX]/.test(f) || f === '--force') || true) { a.facts.destructive = true; a.facts.deletes = true; a.up('high', 'git_clean'); } return; }
  if (sub === 'checkout' || sub === 'restore' || sub === 'switch') { const wipes = rest.includes('--') || rest.includes('.') || flags.some((f) => f === '-f' || f === '--force' || f === '-B' || f === '--discard-changes' || f === '--worktree' || f === '-W') || sub === 'restore'; if (wipes) { a.facts.destructive = true; a.facts.writes = true; } a.up('medium', 'git_checkout'); return; }
  if (sub === 'branch') { const list = !pos.length || flags.some((f) => /^(-a|-r|-v|-vv|--list|-l|--show-current|--contains|--merged|--no-merged|--all|--remotes|--verbose)$/.test(f)); if (list && !flags.some((f) => /^(-d|-D|-m|-M|-c|-C|--delete|--move|--copy|-f|--force)$/.test(f))) return; if (flags.some((f) => f === '-D' || f === '--delete' || f === '-d')) a.facts.destructive = true; a.up('medium', 'git_branch'); return; }
  if (sub === 'tag') { if (!pos.length && !flags.some((f) => /^(-d|--delete|-a|-s|-f|-m)$/.test(f))) return; if (flags.some((f) => f === '-d' || f === '--delete')) a.facts.destructive = true; a.up('medium', 'git_tag'); return; }
  if (sub === 'remote') { if (!pos.length || pos[0] === 'show' || pos[0] === 'get-url' || flags.includes('-v')) { if (!pos.length || flags.includes('-v') || pos[0] !== 'show') return; a.facts.network = true; return; } a.up('medium', 'git_remote'); return; }
  if (sub === 'stash') { const op = pos[0] ?? 'push'; if (op === 'list' || op === 'show') return; if (op === 'drop' || op === 'clear') a.facts.destructive = true; a.up('medium', 'git_stash'); return; }
  if (sub === 'config') { if (flags.some((f) => /^(--get|--get-all|--list|-l|--get-regexp|--show-origin)$/.test(f)) || (!flags.length && pos.length === 1)) return; if (/alias|core\.(sshcommand|pager|editor|hookspath)|credential|protocol/i.test(pos[0] ?? '')) a.up('high', 'git_config_exec'); else a.up('medium', 'git_config'); return; }
  if (sub === 'reflog') { if (!pos.length || pos[0] === 'show' || pos[0] === 'exists') return; a.facts.destructive = true; a.up('high', 'git_reflog_expire'); return; }
  if (sub === 'gc' || sub === 'prune' || sub === 'filter-branch' || sub === 'filter-repo' || sub === 'update-ref' || sub === 'replace' || sub === 'repack') { if (sub === 'gc' && !flags.some((f) => /prune=now|--aggressive/.test(f))) { a.up('medium', 'git_gc'); return; } a.facts.destructive = true; a.up('high', 'git_rewrite_history'); return; }
  if (sub === 'worktree') { if (pos[0] === 'list') return; a.up('medium', 'git_worktree'); if (pos[0] === 'remove' || pos[0] === 'prune') a.facts.destructive = true; return; }
  if (sub === 'submodule') { if (pos[0] === 'status' || !pos.length) return; a.facts.network = true; a.up('medium', 'git_submodule'); return; }
  if (['fetch', 'pull', 'clone'].includes(sub)) { a.facts.network = true; a.facts.writes = true; a.up('medium', sub === 'clone' ? 'git_clone' : 'git_fetch'); return; }
  if (['add', 'commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'init', 'mv', 'rm', 'apply', 'am', 'bisect', 'notes', 'sparse-checkout', 'maintenance', 'lfs'].includes(sub)) { if (sub === 'rm') { a.facts.deletes = true; a.facts.writes = true; } a.up('medium', 'git_' + sub.replace('-', '_')); return; }
  if (sub.startsWith('!') || sub === 'daemon' || sub === 'http-backend' || sub === 'receive-pack' || sub === 'upload-pack') { a.up('high', 'git_config_exec'); return; }
  a.up('medium', 'git_other');
}

function pkgClassify(tool: string, args: string[], a: Acc) {
  const sub = args.find((x) => !isOpt(x)) ?? ''; const rest = args.slice(args.indexOf(sub) + 1);
  const isNpmLike = ['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx'].includes(tool);
  if (['npx', 'pnpx', 'bunx'].includes(tool) || ['dlx', 'x', 'create', 'init', 'exec'].includes(sub)) { a.facts.network = true; a.up('medium', 'remote_code'); if (/^(vitest|jest|mocha|playwright|cypress)$/.test(sub)) a.facts.isTest = true; return; }
  if (/^(publish|unpublish|deprecate|dist-tag|owner|access|token|login|logout|adduser|whoami-set|team|org|hook|star|profile)$/.test(sub) && sub !== 'whoami') { a.facts.network = true; a.up('high', 'publishes'); return; }
  if (/^(test|t|tst|cit|it)$/.test(sub) || (sub === 'run' && /^(test|tests|t|spec|e2e|check)/.test(rest.find((x) => !isOpt(x)) ?? ''))) { a.facts.isTest = true; a.up('medium', 'test_runner'); return; }
  if (/^(install|i|add|ci|update|up|upgrade|remove|rm|uninstall|un|link|unlink|dedupe|prune|rebuild|import|patch|set|sync|fetch)$/.test(sub)) { a.facts.network = true; a.facts.writes = true; a.up('medium', 'installs'); return; }
  if (/^(run|run-script|start|dev|build|lint|format|exec|serve|watch|preview|storybook|typecheck|check|rr|rum)$/.test(sub) || (isNpmLike && sub !== '' && !/^(ls|list|ll|la|view|info|show|outdated|audit|why|root|bin|prefix|help|version|-v|config|get|explain|search|docs|bugs|repo|home|pack|licenses|doctor|ping|cache|completion|fund|query|diff)$/.test(sub))) { a.up('medium', 'runs_scripts'); return; }
  if (sub === 'audit' && rest.includes('fix')) { a.facts.writes = true; a.up('medium', 'installs'); return; } if (sub === 'cache') { a.up('medium', 'cache'); return; } if (sub === 'config' && /^(set|delete|edit)$/.test(rest[0] ?? '')) { a.up('medium', 'config_write'); return; }
  if (['view', 'info', 'search', 'outdated', 'audit', 'ping', 'doctor'].includes(sub)) a.facts.network = true;
}
function otherPkg(tool: string, args: string[], a: Acc): boolean {
  const sub = args.find((x) => !isOpt(x)) ?? '';
  if (tool === 'uv' && sub === 'pip') return otherPkg('pip', args.slice(args.indexOf('pip') + 1), a);
  if (['pip', 'pip3', 'pipx', 'uv', 'poetry', 'conda', 'mamba', 'pipenv', 'pdm', 'hatch', 'rye'].includes(tool)) { if (/^(publish|upload)$/.test(sub)) { a.up('high', 'publishes'); return true; } if (/^(install|uninstall|add|remove|sync|lock|update|upgrade|create|env|self|tool|venv|build|init|download|wheel|cache)$/.test(sub)) { a.facts.network = true; a.facts.writes = true; a.up('medium', 'installs'); return true; } if (['run', 'shell', 'exec'].includes(sub)) { a.up('medium', 'runs_scripts'); return true; } return true; }
  if (tool === 'twine' || tool === 'gem' && sub === 'push' || tool === 'cargo' && /^(publish|yank|owner|login|logout)$/.test(sub)) { a.up('high', 'publishes'); return true; }
  if (tool === 'cargo') { if (/^(test|bench|nextest)$/.test(sub)) { a.facts.isTest = true; a.up('medium', 'test_runner'); } else if (/^(metadata|tree|version|--version|-V|search|locate-project|pkgid|help|doc)$/.test(sub) || sub === '') { /* read-only */ } else { a.facts.writes = sub !== 'run'; a.up('medium', sub === 'install' || sub === 'add' || sub === 'update' || sub === 'fetch' ? 'installs' : 'runs_scripts'); if (sub === 'install' || sub === 'add' || sub === 'fetch' || sub === 'update') a.facts.network = true; if (sub === 'clean') a.facts.destructive = false; } return true; }
  if (tool === 'go') { if (sub === 'test') { a.facts.isTest = true; a.up('medium', 'test_runner'); } else if (/^(version|env|list|doc|help|vet)$/.test(sub) || sub === '') { /* read-only */ } else { a.facts.network = /^(get|install|mod|work)$/.test(sub); a.facts.writes = true; a.up('medium', 'runs_scripts'); } return true; }
  if (['make', 'gmake', 'cmake', 'ninja', 'gradle', 'gradlew', 'mvn', 'mvnw', 'bazel', 'bazelisk', 'ant', 'rake', 'just', 'task', 'sbt', 'dotnet', 'msbuild', 'xcodebuild', 'swift', 'meson', 'scons', 'bundle', 'composer', 'mix', 'stack', 'cabal', 'lein', 'nuget', 'flutter', 'dart', 'tuist'].includes(tool)) { a.up('medium', 'runs_scripts'); a.facts.writes = true; if (/^(test|check|tests|spec|verify)$/.test(sub) || (tool === 'dotnet' && sub === 'test') || (tool === 'swift' && sub === 'test') || (tool === 'bazel' && sub === 'test') || (tool === 'mvn' && sub === 'test') || (tool === 'gradle' && sub === 'test') || (tool === 'gradlew' && sub === 'test') || (tool === 'rake' && sub === 'spec') || (tool === 'bundle' && args.includes('rspec'))) a.facts.isTest = true; if (/publish|deploy|upload/.test(sub)) a.up('high', 'publishes'); return true; }
  return false;
}

function containerClassify(tool: string, args: string[], a: Acc) {
  const sub = args.find((x) => !isOpt(x)) ?? ''; const rest = args.slice(args.indexOf(sub) + 1); const sub2 = rest.find((x) => !isOpt(x)) ?? '';
  const eff = sub === 'compose' || sub === 'container' || sub === 'image' || sub === 'system' || sub === 'volume' || sub === 'network' ? `${sub} ${sub2}` : sub;
  if (/^(ps|images|inspect|logs|version|info|stats|top|port|history|events|diff|search|--version|-v|container ls|container ps|container inspect|image ls|image inspect|image history|volume ls|volume inspect|network ls|network inspect|compose ps|compose logs|compose config|compose ls|compose version)$/.test(eff) || eff === '') return;
  if (/(rm|rmi|prune|kill|stop|down|volume rm|network rm|system prune)$/.test(eff) || /prune/.test(eff)) { a.facts.destructive = true; a.facts.deletes = true; a.up('high', 'container_remove'); return; }
  if (/^(push|login|logout|compose push|image push|save|export)$/.test(eff)) { a.facts.network = true; a.up('high', 'publishes'); return; }
  if (/^(build|pull|compose build|compose pull|image pull|buildx|tag|image tag|load|import|commit)$/.test(eff)) { a.facts.network = true; a.facts.writes = true; a.up('medium', 'container_build'); return; }
  a.up('high', 'container_run'); // run, exec, create, start, compose up: a container can reach the whole machine
}
function dbClassify(tool: string, args: string[], a: Acc) {
  const text = args.join(' '); if (SQL_DESTRUCTIVE.test(text)) { a.facts.destructive = true; a.facts.deletes = true; a.up('high', 'sql_destructive'); return; } if (SQL_DANGER.test(text) || tool === 'redis-cli' || tool === 'mongosh' || tool === 'mongo') { a.facts.writes = true; a.up(tool === 'sqlite3' ? 'medium' : 'high', 'database'); return; } a.facts.network ||= tool !== 'sqlite3' && tool !== 'duckdb'; a.up('medium', 'database');
}

function classifySegment(seg: Segment, c: ClassifyCtx, depth: number, a: Acc) {
  for (const r of seg.redirects) { if (/^(>|>>|>\||&>|&>>|<>)$/.test(r.op)) pathFact(a, r.target, c, 'write'); else if (r.op === '<') pathFact(a, r.target, c, 'read'); }
  for (const s of seg.subs) a.merge(classifyDepth(s, c, depth + 1)); if (seg.dynamicCommand) { a.up('high', 'dynamic_command'); return; }
  let w = [...seg.words]; if (!w.length) return; classifyWords(w, seg, c, depth, a);
}
function classifyWords(words: string[], seg: Segment | undefined, c: ClassifyCtx, depth: number, a: Acc): void {
  let w = [...words]; const win = c.platform === 'win32';
  for (let guard = 0; guard < 8 && w.length; guard++) { // peel wrappers
    const cmd = base(w[0]!); const lc = win ? cmd.toLowerCase() : cmd;
    if (PRIV.has(lc)) { a.up('high', 'privilege_escalation'); w = w.slice(1); while (w.length && isOpt(w[0]!)) w.shift(); continue; }
    if (lc === 'env') { w = w.slice(1); while (w.length && (isOpt(w[0]!) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]!))) w.shift(); a.up('medium', 'wrapper'); continue; }
    if (lc === 'timeout') { w = w.slice(1); while (w.length && isOpt(w[0]!)) w.shift(); w.shift(); continue; }
    if (lc === 'xargs') { w = w.slice(1); while (w.length && isOpt(w[0]!)) { const o = w.shift()!; if (/^-[nIPdLsEaln]$/.test(o)) w.shift(); } if (!w.length) { a.up('medium', 'xargs'); return; } a.up('medium', 'xargs'); continue; }
    if (WRAPPERS_PLAIN.has(lc)) { w = w.slice(1); while (w.length && isOpt(w[0]!) && lc !== 'exec') w.shift(); continue; }
    if (lc === 'watch') { w = w.slice(1); while (w.length && isOpt(w[0]!)) { const o = w.shift()!; if (/^-n$/.test(o)) w.shift(); } continue; }
    break;
  }
  if (!w.length) return; const cmd0 = base(w[0]!); const cmd = win ? cmd0.toLowerCase() : cmd0; const args = w.slice(1);
  const piped = !!seg?.pipedFrom;
  if (SHELLS.has(cmd) || /^(powershell|pwsh)$/i.test(cmd) || (win && cmd === 'cmd')) {
    if (args.some((x) => /^-e(nc|ncodedcommand)?$/i.test(x))) { a.up('high', 'encoded_command'); return; }
    const ci = args.findIndex((x) => x === '-c' || x === '/c' || x === '/k' || x === '-command' || x === '-Command' || /^-[a-z]*c$/.test(x)); if (ci >= 0 && args[ci + 1] !== undefined) { if (depth + 1 > MAX_DEPTH) { a.up('high', 'too_deep'); return; } if (/^-e(nc|ncodedcommand)?$/i.test(args[ci] ?? '')) { a.up('high', 'encoded_command'); return; } a.merge(classifyDepth(args.slice(ci + 1).join(' '), c, depth + 1)); return; }
    if (args.some((x) => /^-e(nc|ncodedcommand)$/i.test(x))) { a.up('high', 'encoded_command'); return; } if (piped || seg?.heredoc || !targets(args).length || args.includes('-s')) { a.up('high', piped ? 'pipe_to_shell' : 'shell_from_input'); return; }
    const script = targets(args)[0]!; pathFact(a, script, c, 'read'); a.up(escapesRoot(script, c) ? 'high' : 'medium', escapesRoot(script, c) ? 'runs_outside_script' : 'runs_script'); return;
  }
  if (cmd === 'eval') { a.up('medium', 'eval'); const code = args.join(' '); if (code.includes('$') || !code) { a.up('high', 'eval_dynamic'); return; } if (depth + 1 > MAX_DEPTH) { a.up('high', 'too_deep'); return; } a.merge(classifyDepth(code, c, depth + 1)); return; }
  if (cmd === 'source' || cmd === '.') { const f = args[0]; if (!f) { a.up('high', 'shell_from_input'); return; } pathFact(a, f, c, 'read'); a.up(escapesRoot(f, c) ? 'high' : 'medium', 'source'); return; }
  if (INTERP.has(cmd) || /^python\d/.test(cmd) || /^node\d*$/.test(cmd)) {
    if (piped && !targets(args).length) { a.up('high', 'pipe_to_interpreter'); return; } if (args.some((x) => /^(--version|-V|-v|--help|-h)$/.test(x))) return;
    const mi = args.indexOf('-m'); if (mi >= 0) { const m = args[mi + 1] ?? ''; if (/^(pytest|unittest|nose|nose2|tox|doctest)/.test(m)) { a.facts.isTest = true; a.up('medium', 'test_runner'); return; } if (m === 'pip') { otherPkg('pip', args.slice(mi + 2), a); return; } if (m === 'http.server') { a.up('medium', 'serves'); return; } a.up('medium', 'runs_scripts'); return; }
    if (args.some((x) => /^(-c|-e|-p|--eval|--print|-r|-E|-x)$/.test(x)) || args.some((x) => /^-[a-zA-Z]*[ce]$/.test(x))) { a.up('medium', 'inline_code'); if (args.some((x) => /rm\s+-rf|rmtree|unlink|os\.remove|fs\.rm|child_process|subprocess|os\.system|exec\(/.test(x))) a.up('high', 'inline_code_dangerous'); return; }
    if (args.includes('--test')) { a.facts.isTest = true; a.up('medium', 'test_runner'); return; } const script = targets(args)[0]; if (!script) { a.up('high', 'shell_from_input'); return; } pathFact(a, script, c, 'read'); a.up(escapesRoot(script, c) ? 'high' : 'medium', escapesRoot(script, c) ? 'runs_outside_script' : 'runs_script'); if (/(^|[\\/._-])(test|tests|spec)([._-]|$)/i.test(script)) a.facts.isTest = true; return;
  }
  if (TEST_RUNNERS.has(cmd)) { a.facts.isTest = true; a.up('medium', 'test_runner'); return; }
  if (cmd === 'git') { gitClassify(args, a, c); return; }
  if (['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx'].includes(cmd)) { pkgClassify(cmd, args, a); return; } if (otherPkg(cmd, args, a)) return;
  if (['docker', 'podman', 'nerdctl', 'docker-compose', 'podman-compose', 'buildah', 'skopeo', 'crictl'].includes(cmd)) { containerClassify(cmd, args, a); return; }
  if (DB.has(cmd)) { dbClassify(cmd, args, a); return; }
  if (CLOUD.has(cmd)) { const sub = (['aws', 'gcloud', 'az'].includes(cmd) ? args.filter((x) => !isOpt(x)).find((x) => CLOUD_MUTATE.test(x)) : undefined) ?? args.find((x) => !isOpt(x)) ?? ''; a.facts.network = true; if (CLOUD_MUTATE.test(sub)) { a.facts.destructive = /^(delete|destroy|terminate|rm|remove|uninstall|drain)$/.test(sub); a.up('high', 'cloud_mutate'); } else a.up('medium', CLOUD_READ.test(sub) || sub === '' ? 'cloud_read' : 'cloud_unknown'); if (cmd === 'gh' && args.length && /^(auth|secret|ssh-key|gpg-key|repo|release|workflow|run|pr|issue|gist|api|codespace|extension|alias)$/.test(sub) && !/^(view|list|status|diff|checks|checkout|ls|--help)$/.test(args.find((x, i) => i > 0 && !isOpt(x)) ?? '')) a.up('high', 'cloud_mutate'); return; }
  if (cmd === 'rm' || cmd === 'rmdir' || cmd === 'unlink' || cmd === 'del' || cmd === 'erase' || cmd === 'rd' || cmd === 'remove-item' || cmd === 'ri') {
    const flags = args.filter(isOpt); const tg = targets(args); const recursive = flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive' || /^\/s$/i.test(f) || /^-recurse$/i.test(f)) || cmd === 'rmdir' && flags.includes('-p'); const force = flags.some((f) => /^-[a-zA-Z]*f/.test(f) || f === '--force' || /^\/q$/i.test(f) || /^-force$/i.test(f));
    a.facts.deletes = true; a.facts.writes = true; if (recursive) a.facts.destructive = true; if (!tg.length) { if (recursive) a.up('high', 'rm_recursive_wide'); else a.up('medium', 'deletes_in_root'); return; }
    for (const t of tg) { if (t.includes('$')) { a.up('high', 'dynamic_path'); a.facts.escapesRoot = true; continue; } const rp = resolvePath(t, c); const atRoot = rp === resolvePath('.', { ...c, cwd: c.root }) || /^(\/|~|\.\.?|\*|\/\*|~\/\*|\.\/\*|\.\*)$/.test(t) || /^[A-Za-z]:[\\/]?$/.test(t) || (/\*/.test(t) && /^(\/|~)/.test(t)); pathFact(a, t, c, 'delete'); if (recursive && (atRoot || escapesRoot(t, c))) a.up('high', 'rm_recursive_wide'); else if (recursive) a.up('medium', 'rm_recursive'); }
    if (recursive && force && tg.some((t) => /^(\/|~|\*|\.\.?)(\/?\*?)$/.test(t))) a.up('high', 'rm_recursive_wide'); return;
  }
  if (cmd === 'find' || cmd === 'fd' && args.some((x) => x === '-x' || x === '--exec' || x === '-X' || x === '--exec-batch')) {
    for (const t of targets(args).slice(0, 1)) if (looksPath(t)) pathFact(a, t, c, 'read'); const ei = args.findIndex((x) => /^(-exec|-execdir|-ok|-okdir|--exec|-x|-X|--exec-batch)$/.test(x)); if (args.includes('-delete')) { a.facts.destructive = true; a.facts.deletes = true; a.facts.writes = true; a.up('high', 'find_delete'); } if (ei >= 0) { a.up('medium', 'find_exec'); const inner = args.slice(ei + 1).filter((x) => x !== ';' && x !== '+' && x !== '{}'); if (inner.length) { const sub = new Acc(); classifyWords(inner, undefined, c, depth + 1, sub); a.merge(sub); } } if (args.some((x) => /^-(fprint0?|fls|fprintf)$/.test(x))) a.up('medium', 'writes_in_root'); return;
  }
  if (cmd === 'sed') { const inplace = args.some((x) => x === '-i' || /^-i/.test(x) || x === '--in-place' || /^-[a-zA-Z]*i/.test(x) && !/^--/.test(x)); const script = args.filter((x) => !isOpt(x)).join(' '); if (inplace) { a.facts.writes = true; for (const t of targets(args).slice(1)) pathFact(a, t, c, 'write'); a.up('medium', 'writes_in_root'); } else if (/(^|[;{\s])[we]\s|\/[we]\s/.test(script) || /\bs\/.*\/.*\/[a-z]*[we]/.test(script)) a.up('medium', 'inline_code'); for (const t of targets(args).slice(1)) if (!inplace && looksPath(t)) pathFact(a, t, c, 'read'); return; }
  if (['awk', 'gawk', 'mawk', 'nawk', 'perl', 'ruby'].includes(cmd) && !INTERP.has(cmd)) { a.up('medium', 'inline_code'); return; }
  if (cmd === 'curl' || cmd === 'wget' || cmd === 'http' || cmd === 'https' || cmd === 'xh' || cmd === 'aria2c' || cmd === 'fetch') {
    a.facts.network = true; const url = args.find((x) => /^[a-z]+:\/\//i.test(x) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(x) || /^(localhost|127\.|\[::1\])/.test(x)) ?? ''; const local = /^(https?:\/\/)?(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(url);
    const upload = args.some((x) => /^(-d|--data|--data-.+|-F|--form|--form-string|-T|--upload-file|--json|--post-data|--post-file|--body-data|--body-file)$/.test(x) || /^-d./.test(x)) || args.some((x, i) => /^(-X|--request|--method)$/.test(x) && /^(POST|PUT|DELETE|PATCH)$/i.test(args[i + 1] ?? ''));
    const oi = args.findIndex((x) => x === '-o' || x === '--output' || x === '-O' || x === '--remote-name' || x === '-P' || x === '--directory-prefix' || x === '--output-document'); if (cmd === 'wget' && !args.some((x) => x === '-O' || x === '--output-document' || x === '-q' && false)) { a.facts.writes = true; a.up('medium', 'downloads'); } if (oi >= 0) { const t = args[oi + 1]; if (t && !isOpt(t)) pathFact(a, t, c, 'write'); else { a.facts.writes = true; a.up('medium', 'downloads'); } } if (args.some((x) => /^(-O|--remote-name)$/.test(x)) || args.some((x) => /^-[a-zA-Z]*O/.test(x) && !x.startsWith('--'))) { a.facts.writes = true; a.up('medium', 'downloads'); }
    if (upload && !local) a.up('high', 'network_upload'); else if (upload) a.up('medium', 'network_local_write'); else a.up('medium', local ? 'network_local' : 'network_fetch'); return;
  }
  if (cmd === 'scp' || cmd === 'rsync' || cmd === 'rclone' || cmd === 'sftp') { a.facts.network = true; const remote = args.some((x) => /^[^/\s:@]+(@[^/\s:]+)?:/.test(x) && !/^[A-Za-z]:[\\/]/.test(x)) || cmd === 'rclone' || args.some((x) => /^rsync:\/\//.test(x)); if (remote) { a.up('high', 'remote_transfer'); return; } for (const t of targets(args)) pathFact(a, t, c, 'write'); a.up('medium', 'writes_in_root'); return; }
  if (['cp', 'mv', 'install', 'ln', 'rename', 'copy', 'move', 'copy-item', 'move-item', 'cpi', 'mi', 'xcopy', 'robocopy'].includes(cmd)) { const t = targets(args); a.facts.writes = true; if ((cmd === 'mv' || cmd === 'move' || cmd === 'move-item') && t.length) { a.facts.deletes = true; for (const s of t.slice(0, -1)) pathFact(a, s, c, 'delete'); } for (const p of t) pathFact(a, p, c, cmd === 'cp' || cmd === 'copy' || cmd === 'install' || cmd === 'ln' ? 'write' : 'write'); for (const p of t.slice(0, -1)) if (isProtectedPath(p, c, { write: false })) a.up('high', 'credential_read'); a.up('medium', 'writes_in_root'); return; }
  if (['touch', 'mkdir', 'mktemp', 'tee', 'md', 'new-item', 'ni', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'truncate', 'mkfifo'].includes(cmd)) { a.facts.writes = true; for (const p of targets(args)) pathFact(a, p, c, 'write'); a.up('medium', 'writes_in_root'); return; }
  if (['chmod', 'chown', 'chgrp', 'icacls', 'attrib', 'setfacl', 'xattr'].includes(cmd)) { const rec = args.some((x) => /^-[a-zA-Z]*R/.test(x) || x === '--recursive' || /^\/t$/i.test(x)); a.facts.writes = true; for (const p of targets(args).slice(1)) pathFact(a, p, c, 'write'); if (rec) { a.facts.destructive = true; a.up('high', 'chmod_recursive'); } else a.up('medium', 'writes_in_root'); return; }
  if (cmd === 'tar' || cmd === 'zip' || cmd === 'unzip' || cmd === 'gzip' || cmd === 'gunzip' || cmd === 'bzip2' || cmd === 'xz' || cmd === '7z' || cmd === '7za' || cmd === 'unrar' || cmd === 'zcat' || cmd === 'bunzip2') {
    const list = (cmd === 'tar' && args.some((x) => /^-[a-zA-Z]*t/.test(x) || x === '--list')) || (cmd === 'unzip' && args.includes('-l')) || cmd === 'zcat'; if (list) { for (const t of targets(args)) if (looksPath(t)) pathFact(a, t, c, 'read'); return; }
    const ci = args.findIndex((x) => x === '-C' || x === '--directory' || x === '-d' || x === '-o'); if (ci >= 0 && args[ci + 1]) pathFact(a, args[ci + 1]!, c, 'write'); for (const t of targets(args)) if (looksPath(t) && t !== args[ci + 1]) pathFact(a, t, c, cmd === 'tar' && args.some((x) => /^-[a-zA-Z]*c/.test(x)) ? 'read' : 'read'); a.facts.writes = true; a.up('medium', 'archive'); return;
  }
  if (cmd === 'kill') { a.up(args.some((x) => x === '-1' || x === '1' || x === '-9' && args.includes('-1')) ? 'high' : 'medium', 'kill'); return; }
  if (cmd === 'openssl') { a.up(args.some((x) => /^(genrsa|genpkey|rsa|pkcs12|enc|req|ca|x509)$/.test(x)) ? 'medium' : 'medium', 'crypto'); return; }
  if (['vim', 'vi', 'nvim', 'nano', 'emacs', 'code', 'subl', 'atom', 'ed', 'pico', 'micro', 'helix', 'hx', 'notepad', 'idea'].includes(cmd)) { a.facts.writes = true; for (const p of targets(args)) pathFact(a, p, c, 'write'); a.up('medium', 'editor'); return; }
  if (['brew', 'port', 'nix', 'asdf', 'mise', 'volta', 'nvm', 'fnm', 'rustup', 'sdk', 'choco', 'winget', 'scoop'].includes(cmd)) { const sub = args.find((x) => !isOpt(x)) ?? ''; if (/^(list|ls|info|search|outdated|--version|-v|doctor|which|current|show|home|deps|uses|config|--prefix|--cellar|--repository|env)$/.test(sub) || sub === '') { a.facts.network ||= sub === 'search' || sub === 'info'; return; } a.facts.network = true; a.facts.writes = true; a.up(cmd === 'choco' || cmd === 'winget' ? 'high' : 'medium', 'installs'); return; }
  if (cmd === 'rsync' || cmd === 'ssh') { a.up('high', 'remote_access'); return; }
  if (cmd === 'sleep' || LOW.has(cmd) && !READ_NEEDS_CHECK.has(cmd)) { for (const t of args.filter((x) => !isOpt(x))) if (looksPath(t) && !t.includes('$SUB')) pathFact(a, t, c, 'read'); if (cmd === 'echo' || cmd === 'printf') { /* only the redirections matter */ } return; }
  if (READ_NEEDS_CHECK.has(cmd)) { if (args.some((x) => x === '--fix' || x === '--write' || x === '-w' || x === '--outDir' || x === '--emit' || x === '-b' || x === '--build')) { a.facts.writes = true; a.up('medium', 'writes_in_root'); } for (const t of targets(args)) if (looksPath(t)) pathFact(a, t, c, 'read'); return; }
  if (SYSTEM_HIGH.has(cmd) || /^mkfs(\.|$)/.test(cmd) || /^(fsck|mke2fs)\./.test(cmd)) { const dest = ['dd', 'mkfs', 'shred', 'wipefs', 'format', 'diskpart', 'fdisk', 'parted', 'sgdisk', 'gdisk', 'cfdisk', 'blkdiscard', 'mkswap', 'cryptsetup', 'lvremove', 'vgremove', 'pvremove'].includes(cmd) || /^mkfs/.test(cmd); if (dest) { a.facts.destructive = true; a.facts.writes = true; } a.up('high', dest ? 'destroys_data' : 'system_command'); return; }
  if (win && /^(stop-computer|restart-computer|invoke-expression|iex|start-process|set-executionpolicy|reg|regedit|net|sc|schtasks|taskkill|wmic|bcdedit|cipher|vssadmin)$/.test(cmd)) { a.up('high', 'system_command'); return; }
  if (win && /^(get-childitem|dir|type|get-content|gc|where|findstr|select-string|sls|get-location|gl|get-item|gi|get-process|gps|get-date|write-output|write-host|measure-object|sort-object|format-table|ft|get-help|ver|vol|tree)$/.test(cmd)) { for (const t of targets(args)) if (looksPath(t)) pathFact(a, t, c, 'read'); return; }
  if (looksPath(cmd0)) { pathFact(a, cmd0, c, 'read'); a.up(escapesRoot(cmd0, c) ? 'high' : 'medium', escapesRoot(cmd0, c) ? 'program_outside_root' : 'runs_program'); return; }
  a.up('medium', 'unknown_command');
}

function classifyDepth(cmd: string, c: ClassifyCtx, depth: number): Acc {
  const a = new Acc(); const p = parseShell(c.platform === 'win32' ? cmd.replace(/\\/g, '/') : cmd, depth); if (!p.ok) return a.up('high', p.reason ?? 'unparseable');
  for (const seg of p.segments) { const sa = new Acc(); classifySegment(seg, c, depth, sa); a.merge(sa); }
  return a;
}
/** Never throws, never runs anything. Whatever cannot be read, or is too long or too deep, is `high`. */
export function classifyCommand(cmd: string, ctx: ClassifyCtx): CommandRisk {
  try { return classifyDepth(cmd, ctx, 0).out(); } catch { return high('unparseable'); }
}
