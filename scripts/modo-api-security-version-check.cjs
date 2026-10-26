const assert = require('node:assert/strict');
const manifest = require('../apps/api/package.json');
for (const name of ['remotion', '@remotion/bundler', '@remotion/renderer']) {
  assert.equal(manifest.dependencies[name], '4.0.538', name + ' manifest drift');
  const resolved = require(require.resolve(name + '/package.json', { paths: [require('node:path').resolve('apps/api')] }));
  assert.equal(resolved.version, '4.0.538', name + ' installed version drift');
}
assert.equal(manifest.dependencies.zod, '4.6.7');
const zod = require(require.resolve('zod/package.json', { paths: [require('node:path').resolve('apps/api')] }));
assert.equal(zod.version, '4.6.7');
console.log('Pinned Remotion 4.0.538 and Zod 4.6.7 verified in API runtime');
