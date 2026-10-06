import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../../src/sandbox/index.js';
import { ctx } from './ctx.js';

describe('acceptance 4: destructive commands are never auto-allowable', () => {
  const cmds = ['rm -rf build', 'rm -r build', 'git push --force', 'git push -f origin x', 'git reset --hard', 'git clean -fd', 'dd if=a of=b', 'mkfs.ext4 /dev/x', 'psql -c "drop table x"', 'find . -delete', 'chmod -R 777 .', 'git checkout -- .', 'docker rm x'];
  it.each(cmds)('%s', (cmd) => { for (const root of ['/work/proj', '/']) for (const cwd of [root, '/work/proj/src']) for (const platform of ['posix', 'win32'] as const) { const r = classifyCommand(cmd, { root, cwd, home: '/home/me', platform }); expect(r.facts.destructive, `${cmd} ${root} ${cwd} ${platform}`).toBe(true); expect(r.autoAllowable).toBe(false); } });
  it('in-root rm -rf is medium but still destructive', () => { const r = classifyCommand('rm -rf build', ctx); expect(r.risk).toBe('medium'); expect(r.facts.destructive).toBe(true); expect(r.autoAllowable).toBe(false); });
  it('high is never auto-allowable and a plain read is', () => { expect(classifyCommand('sudo ls', ctx).autoAllowable).toBe(false); expect(classifyCommand('ls', ctx).autoAllowable).toBe(true); });
});
