'use strict';

function sortForComparison(value) {
  if (Array.isArray(value)) return value.map(sortForComparison);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForComparison(value[key])]),
  );
}

function normalizeInstalledPackage(packageRecord) {
  if (!packageRecord || typeof packageRecord !== 'object' || Array.isArray(packageRecord)) {
    return packageRecord;
  }
  // npm versions differ in whether they annotate optional native packages
  // with `libc`. That metadata does not change the package identity, source,
  // integrity, or dependency graph used by these Windows installations.
  const { libc: _libc, ...materialFields } = packageRecord;
  return materialFields;
}

function getDependencySnapshot(lockfile) {
  if (!lockfile || typeof lockfile !== 'object' || Array.isArray(lockfile?.packages)) return null;
  const packages = lockfile.packages;
  if (!packages || typeof packages !== 'object' || !packages['']) return null;
  const root = packages[''];
  const installedPackages = Object.fromEntries(
    Object.entries(packages)
      .filter(([packagePath]) => packagePath !== '')
      .map(([packagePath, packageRecord]) => [packagePath, normalizeInstalledPackage(packageRecord)]),
  );
  return sortForComparison({
    dependencies: root.dependencies || {},
    devDependencies: root.devDependencies || {},
    optionalDependencies: root.optionalDependencies || {},
    peerDependencies: root.peerDependencies || {},
    installedPackages,
  });
}

function canReuseInstalledDependencies(currentLockfile, stagedLockfile) {
  const current = getDependencySnapshot(currentLockfile);
  const staged = getDependencySnapshot(stagedLockfile);
  return Boolean(current && staged && JSON.stringify(current) === JSON.stringify(staged));
}

module.exports = {
  canReuseInstalledDependencies,
  getDependencySnapshot,
};
