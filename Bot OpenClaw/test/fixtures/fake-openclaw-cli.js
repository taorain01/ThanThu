#!/usr/bin/env node
'use strict';
// CLI OpenClaw giả cho test runConfigPatch.
//   FAKE_CLI_COUNTER  file đếm số lần được gọi
//   FAKE_CLI_FAILS    số lần đầu trả lỗi (mặc định 1)
//   FAKE_CLI_MESSAGE  thông báo lỗi; mặc định là lỗi xung đột optimistic lock
//   FAKE_CLI_OVERLAP  nếu đặt, ghi file này khi phát hiện 2 tiến trình chạy chồng
const fs = require('node:fs');

const counterFile = process.env.FAKE_CLI_COUNTER;
const lockFile = counterFile ? `${counterFile}.lock` : null;
const overlapFile = process.env.FAKE_CLI_OVERLAP || null;

let attempt = 0;
try { attempt = Number(fs.readFileSync(counterFile, 'utf8')) || 0; } catch { /* lần đầu */ }
attempt += 1;
fs.writeFileSync(counterFile, String(attempt));

if (overlapFile) {
  if (fs.existsSync(lockFile)) {
    fs.writeFileSync(overlapFile, 'overlap');
  }
  fs.writeFileSync(lockFile, String(process.pid));
}

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const finish = () => {
    if (overlapFile) {
      try { fs.unlinkSync(lockFile); } catch { /* đã xóa */ }
    }
  };
  const fails = Number(process.env.FAKE_CLI_FAILS ?? '1');
  if (attempt <= fails) {
    finish();
    process.stderr.write(
      `${process.env.FAKE_CLI_MESSAGE || 'ConfigMutationConflictError: config changed since last load'}\n`,
    );
    process.exit(1);
  }
  // Giữ tiến trình sống một nhịp để test chồng lấn phát hiện được nếu chạy song song.
  setTimeout(() => {
    finish();
    process.stdout.write('Applied 1 config update(s).\n');
    process.exit(0);
  }, 40);
});
