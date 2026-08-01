'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateCpuPercent,
  cpuSnapshot,
  parseNvidiaSmi,
} = require('../src/system-metrics');

test('tính CPU usage từ chênh lệch thời gian idle và tổng', () => {
  const before = cpuSnapshot([
    { times: { user: 50, nice: 0, sys: 25, idle: 100, irq: 25 } },
  ]);
  const after = cpuSnapshot([
    { times: { user: 80, nice: 0, sys: 35, idle: 150, irq: 35 } },
  ]);
  assert.equal(calculateCpuPercent(before, after), 50);
});

test('đọc NVIDIA SMI thành phần trăm, VRAM và nhiệt độ', () => {
  assert.deepEqual(parseNvidiaSmi(
    '0, NVIDIA GeForce RTX 4060, 23, 1754, 8188, 42\n',
  ), [{
    index: 0,
    name: 'NVIDIA GeForce RTX 4060',
    utilizationPercent: 23,
    memoryUsedBytes: 1754 * 1024 * 1024,
    memoryTotalBytes: 8188 * 1024 * 1024,
    temperatureC: 42,
  }]);
});
