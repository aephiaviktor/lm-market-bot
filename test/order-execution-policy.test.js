'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getRuleExecutionPolicy } = require('../dist/bot');

test('disabled rules cancel every existing order and forbid replacement', () => {
  assert.deepEqual(getRuleExecutionPolicy({ enabled: false }, [{ id: 'a' }, { id: 'b' }]), {
    cancelOrderIds: ['a', 'b'],
    shouldPlaceOrder: false,
  });
});

test('enabled rules preserve normal order processing', () => {
  assert.deepEqual(getRuleExecutionPolicy({ enabled: true }, [{ id: 'a' }]), {
    cancelOrderIds: [],
    shouldPlaceOrder: true,
  });
});
