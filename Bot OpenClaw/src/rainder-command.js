'use strict';

const { RainderClientError } = require('./rainder-client');

function inline(value, limit = 120) {
  return String(value || '')
    .replace(/[`@\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function progressLine(progress = {}) {
  const running = Boolean(progress.running);
  const pct = Math.max(0, Math.min(100, Number(progress.pct) || 0));
  const count = Number(progress.total) > 0 ? ` ${Number(progress.done) || 0}/${Number(progress.total)}` : '';
  const current = inline(progress.current || progress.message, 100);
  const runId = inline(progress.run_id, 80);
  return `${running ? 'Dang upload' : 'Khong upload'}${count} - ${pct}%${current ? ` - ${current}` : ''}${runId ? ` - run ${runId}` : ''}`;
}

function formatQueue(payload, limit = 10) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const lines = [`Rainder online. ${progressLine(payload?.progress)}`];
  if (!items.length) {
    lines.push('Hang doi upload dang trong.');
    return lines.join('\n');
  }
  for (const item of items.slice(0, limit)) {
    const schedule = item.schedule_label ? ` - ${inline(item.schedule_label, 60)}` : '';
    const error = item.error ? ` - loi: ${inline(item.error, 100)}` : '';
    lines.push(`- ${inline(item.id, 80)} | ${inline(item.channel, 60)} | ${inline(item.status, 40)} | ${inline(item.title, 120)}${schedule}${error}`);
  }
  if (items.length > limit) lines.push(`... va ${items.length - limit} muc khac.`);
  return lines.join('\n');
}

function friendlyRainderError(error) {
  if (!(error instanceof RainderClientError)) {
    return 'Bot gap loi khi goi Rainder. Chi tiet da duoc ghi trong log cuc bo.';
  }
  if (error.code === 'offline') {
    return 'Rainder dang tat hoac bridge chua san sang. Hay mo Rainder Playlist roi thu lai.';
  }
  if (error.code === 'timeout') {
    return 'Rainder dang online nhung phan hoi qua cham. Lenh khong duoc tu dong gui lai de tranh upload trung.';
  }
  if (error.code === 'auth') {
    return 'Rainder bridge tu choi token phien. Hay khoi dong lai Rainder roi thu lai.';
  }
  if (error.code === 'conflict') {
    const progress = error.payload?.progress;
    return `Rainder dang co mot upload khac. ${progressLine(progress)}`;
  }
  return `Rainder tu choi lenh: ${inline(error.message, 300)}`;
}

async function executeRainderUploadCommand(client, args = [], options = {}) {
  const parts = [...args];
  const action = String(parts.shift() || 'status').toLowerCase();
  try {
    if (action === 'status') {
      return formatQueue(await client.listUploads(), 5);
    }
    if (action === 'list') {
      return formatQueue(await client.listUploads(), 10);
    }
    if (action === 'start') {
      const result = await client.startUploads(parts, {
        source: 'discord',
        requestId: options.requestId,
        idempotencyKey: options.requestId,
      });
      const prefix = result.already_running ? 'Upload nay da chay san.' : 'Da bat dau upload.';
      return `${prefix} ${progressLine(result.progress)}`;
    }
    if (action === 'stop') {
      const result = await client.stopUpload(parts[0] || '');
      return `Da gui lenh dung upload. ${progressLine(result.progress)}`;
    }
    return 'Lenh: . o upload [status|list|start [item-id...]|stop [run-id]]';
  } catch (error) {
    return friendlyRainderError(error);
  }
}

module.exports = {
  executeRainderUploadCommand,
  formatQueue,
  friendlyRainderError,
  progressLine,
};
