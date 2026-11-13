const assert = require('node:assert/strict');
const test = require('node:test');
const { getHero, isValidHero } = require('../config/heroes');

test('getHero only resolves configured hero IDs', () => {
  assert.equal(getHero('ice').id, 'ice');

  for (const id of ['__proto__', 'constructor', 'toString', 'missing']) {
    assert.equal(isValidHero(id), false);
    assert.equal(getHero(id), null);
  }
});
