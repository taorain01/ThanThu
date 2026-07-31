'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('../src/commands');

test('nhận diện lệnh bind và các subcommand', () => {
  assert.deepEqual(parseCommand('> openclaw', '>'), { action: 'bind' });
  assert.deepEqual(parseCommand('>openclaw STATUS', '>'), { action: 'status' });
  assert.deepEqual(parseCommand('> openclaw reset', '>'), { action: 'reset' });
  assert.deepEqual(parseCommand('> openclaw stop', '>'), { action: 'stop' });
  assert.deepEqual(parseCommand('> openclaw off', '>'), { action: 'off' });
});

test('trả help cho subcommand lạ và bỏ qua tin nhắn thường', () => {
  assert.deepEqual(parseCommand('> openclaw abc', '>'), { action: 'help' });
  assert.equal(parseCommand('hãy mở notepad', '>'), null);
  assert.equal(parseCommand('prefix > openclaw', '>'), null);
});

test('escape prefix có ký tự regex', () => {
  assert.deepEqual(parseCommand('+ openclaw', '+'), { action: 'bind' });
  assert.equal(parseCommand('x openclaw', '+'), null);
});
