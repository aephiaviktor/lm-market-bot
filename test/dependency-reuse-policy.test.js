'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canReuseInstalledDependencies } = require('../electron/dependency-reuse-policy');

function lock(version, overrides = {}) {
  return {
    name: 'lm-market-bot',
    version,
    packages: {
      '': {
        name: 'lm-market-bot',
        version,
        hasInstallScript: version === '0.2.89',
        dependencies: { electron: '^42.1.0', rpc_limiter: 'https://example/rpc.tar.gz' },
        devDependencies: { typescript: '^5.9.3' },
      },
      'node_modules/electron': { version: '42.1.0', resolved: 'https://registry/electron.tgz', integrity: 'electron-integrity' },
      'node_modules/rpc_limiter': { version: '0.2.0', resolved: 'https://example/rpc.tar.gz', integrity: 'rpc-integrity' },
      'node_modules/typescript': { version: '5.9.3', resolved: 'https://registry/typescript.tgz', integrity: 'ts-integrity' },
      ...overrides,
    },
  };
}

test('dependency reuse ignores app version and root install-script metadata', () => {
  assert.equal(canReuseInstalledDependencies(lock('0.2.88'), lock('0.2.89')), true);
});

test('dependency reuse ignores npm-added libc metadata when package identity is unchanged', () => {
  const current = lock('0.2.93', {
    'node_modules/@rollup/rollup-linux-x64-gnu': {
      version: '4.46.2',
      resolved: 'https://registry/rollup-linux-x64-gnu.tgz',
      integrity: 'rollup-integrity',
      optional: true,
      cpu: ['x64'],
      os: ['linux'],
    },
  });
  const staged = structuredClone(current);
  staged.version = '0.2.94';
  staged.packages[''].version = '0.2.94';
  staged.packages['node_modules/@rollup/rollup-linux-x64-gnu'].libc = ['glibc'];

  assert.equal(canReuseInstalledDependencies(current, staged), true);
});

test('dependency reuse rejects direct or transitive dependency changes', () => {
  const directChange = lock('0.2.90');
  directChange.packages[''].dependencies.electron = '^43.0.0';
  assert.equal(canReuseInstalledDependencies(lock('0.2.89'), directChange), false);

  const transitiveChange = lock('0.2.90', {
    'node_modules/electron': { version: '43.0.0', resolved: 'https://registry/electron-43.tgz', integrity: 'new' },
  });
  assert.equal(canReuseInstalledDependencies(lock('0.2.89'), transitiveChange), false);

  const sourceChange = lock('0.2.90');
  sourceChange.packages['node_modules/rpc_limiter'].resolved = 'https://example/new-rpc.tar.gz';
  assert.equal(canReuseInstalledDependencies(lock('0.2.89'), sourceChange), false);

  const integrityChange = lock('0.2.90');
  integrityChange.packages['node_modules/typescript'].integrity = 'different-integrity';
  assert.equal(canReuseInstalledDependencies(lock('0.2.89'), integrityChange), false);

  const dependencyEdgeChange = lock('0.2.90');
  dependencyEdgeChange.packages['node_modules/electron'].dependencies = { extract: '^3.0.0' };
  assert.equal(canReuseInstalledDependencies(lock('0.2.89'), dependencyEdgeChange), false);
});

test('dependency reuse rejects missing or malformed lockfiles', () => {
  assert.equal(canReuseInstalledDependencies({}, lock('0.2.90')), false);
  assert.equal(canReuseInstalledDependencies(lock('0.2.89'), { packages: [] }), false);
  assert.equal(canReuseInstalledDependencies(null, null), false);
});
