const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// open apps compare their VERSION with version.json and reload when the website is newer
test('version.json matches the VERSION in game.js', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const v = game.match(/const VERSION = '([^']+)'/)[1];
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));
  assert.equal(json.v, v);
});
