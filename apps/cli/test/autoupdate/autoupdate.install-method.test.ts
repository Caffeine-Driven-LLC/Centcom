import { describe, expect, it } from 'vitest';
import { UPDATE_COMMANDS, autoDefault, detectInstallMethod, packageManagerCommand } from '../../src/autoupdate/index.js';

describe('install method', () => {
  it('standalone, npm, brew and unknown from the program path', () => {
    expect(detectInstallMethod('/home/me/.local/bin/centcom', {})).toBe('standalone'); expect(detectInstallMethod('C:\\Users\\me\\AppData\\Local\\Centcom\\centcom.exe', {})).toBe('standalone');
    expect(detectInstallMethod('/usr/lib/node_modules/@centcom/cli-linux-x64/bin/centcom', {})).toBe('npm');
    expect(detectInstallMethod('/opt/homebrew/Cellar/centcom/1.4.2/bin/centcom', {})).toBe('brew'); expect(detectInstallMethod('/home/linuxbrew/.linuxbrew/bin/centcom', {})).toBe('brew');
    expect(detectInstallMethod('/usr/bin/node', {})).toBe('unknown'); expect(detectInstallMethod('', {})).toBe('unknown'); expect(detectInstallMethod('/work/centcom-repo/node_modules/.bin/tsx', {})).toBe('npm');
  });
  it('the build-time flag wins when it is one of the four words, and is ignored otherwise', () => {
    expect(detectInstallMethod('/usr/bin/node', { CENTCOM_INSTALL_METHOD: 'standalone' })).toBe('standalone'); expect(detectInstallMethod('/home/me/centcom', { CENTCOM_INSTALL_METHOD: 'brew' })).toBe('brew');
    expect(detectInstallMethod('/home/me/centcom', { CENTCOM_INSTALL_METHOD: 'rm -rf' })).toBe('standalone'); expect(detectInstallMethod('/usr/bin/node', { CENTCOM_INSTALL_METHOD: '' })).toBe('unknown');
  });
  it('npm and brew show the exact command from the card; others show none; only standalone updates by default', () => {
    expect(packageManagerCommand('npm')).toBe('npm i -g @centcom/cli@latest'); expect(packageManagerCommand('brew')).toBe('brew upgrade centcom'); expect(UPDATE_COMMANDS).toEqual({ npm: 'npm i -g @centcom/cli@latest', brew: 'brew upgrade centcom' });
    expect(packageManagerCommand('standalone')).toBeUndefined(); expect(packageManagerCommand('unknown')).toBeUndefined();
    expect(['standalone', 'npm', 'brew', 'unknown'].map((m) => autoDefault(m as never))).toEqual([true, false, false, false]);
  });
});
