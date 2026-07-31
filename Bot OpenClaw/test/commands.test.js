'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('../src/commands');

test('nhận diện lệnh bind và các subcommand', () => {
  assert.deepEqual(parseCommand('> openclaw', '>'), { action: 'bind' });
  assert.deepEqual(parseCommand('>openclaw STATUS', '>'), { action: 'status' });
  assert.deepEqual(parseCommand('> openclaw reset', '>'), { action: 'reset' });
  assert.deepEqual(parseCommand('> openclaw stop', '>'), { action: 'stop' });
  assert.deepEqual(parseCommand('> openclaw model local', '>'), { action: 'model', args: ['local'] });
  assert.deepEqual(parseCommand('> openclaw model 9router', '>'), { action: 'model', args: ['9router'] });
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

test('nhận diện alias o để xem status và dừng job trực tiếp', () => {
  assert.deepEqual(parseCommand('> o', '>'), { action: 'status' });
  assert.deepEqual(parseCommand('>o', '>'), { action: 'status' });
  assert.deepEqual(parseCommand('> o status', '>'), { action: 'status' });
  assert.deepEqual(parseCommand('> o s', '>'), { action: 'stop' });
  assert.deepEqual(parseCommand('> o s all', '>'), { action: 'stop', args: ['all'] });
  assert.deepEqual(parseCommand('> o stop', '>'), { action: 'stop' });
  assert.deepEqual(parseCommand('> o stop abc123', '>'), { action: 'stop', args: ['abc123'] });
});

test('nhận diện alias model và để nội dung khác đi vào chat trực tiếp', () => {
  assert.deepEqual(parseCommand('> o m', '>'), { action: 'model' });
  assert.deepEqual(parseCommand('> o m local', '>'), { action: 'model', args: ['local'] });
  assert.deepEqual(parseCommand('> o m 9router', '>'), { action: 'model', args: ['9router'] });
  assert.deepEqual(parseCommand('> o model local', '>'), { action: 'model', args: ['local'] });
  assert.equal(parseCommand('> o x', '>'), null);
});
