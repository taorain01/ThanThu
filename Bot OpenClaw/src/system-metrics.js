'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MIB = 1024 * 1024;

const CPU_TEMPERATURE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$pattern = 'CPU Package|CPU \\(Tctl/Tdie\\)|CPU Die|Core Max|Package'
foreach ($namespace in @('root\\LibreHardwareMonitor', 'root\\OpenHardwareMonitor')) {
  try {
    $sensor = Get-CimInstance -Namespace $namespace -ClassName Sensor |
      Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match $pattern } |
      Sort-Object Value -Descending |
      Select-Object -First 1
    if ($sensor) {
      [pscustomobject]@{
        name = [string]$sensor.Name
        celsius = [double]$sensor.Value
        source = $namespace
      } | ConvertTo-Json -Compress
      exit 0
    }
  } catch {}
}
`.trim();

function clampPercent(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function cpuSnapshot(cpus) {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus || []) {
    idle += Number(cpu?.times?.idle) || 0;
    total += Object.values(cpu?.times || {}).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0,
    );
  }
  return { idle, total };
}

function calculateCpuPercent(before, after) {
  const totalDelta = Number(after?.total) - Number(before?.total);
  const idleDelta = Number(after?.idle) - Number(before?.idle);
  if (!Number.isFinite(totalDelta) || totalDelta <= 0 || !Number.isFinite(idleDelta)) {
    return null;
  }
  return clampPercent((1 - (idleDelta / totalDelta)) * 100);
}

function nullableNumber(value) {
  const text = String(value || '').trim();
  if (!text || /^(?:N\/A|\[N\/A\])$/i.test(text)) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNvidiaSmi(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [index, name, utilization, memoryUsed, memoryTotal, temperature] = line
        .split(',')
        .map((value) => value.trim());
      const memoryUsedMiB = nullableNumber(memoryUsed);
      const memoryTotalMiB = nullableNumber(memoryTotal);
      return {
        index: nullableNumber(index),
        name: name || 'NVIDIA GPU',
        utilizationPercent: nullableNumber(utilization),
        memoryUsedBytes: memoryUsedMiB === null ? null : memoryUsedMiB * MIB,
        memoryTotalBytes: memoryTotalMiB === null ? null : memoryTotalMiB * MIB,
        temperatureC: nullableNumber(temperature),
      };
    });
}

async function readGpuMetrics(options = {}) {
  const exec = options.execFileImpl || execFileAsync;
  const candidates = options.nvidiaSmiCandidates || [
    'nvidia-smi.exe',
    'C:\\Windows\\System32\\nvidia-smi.exe',
    'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
  ];
  const args = [
    '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
    '--format=csv,noheader,nounits',
  ];

  for (const executable of candidates) {
    try {
      const result = await exec(executable, args, {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return parseNvidiaSmi(result.stdout);
    } catch {
      // Try the next standard NVIDIA SMI location.
    }
  }
  return [];
}

async function readCpuTemperature(options = {}) {
  const exec = options.execFileImpl || execFileAsync;
  try {
    const result = await exec('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      CPU_TEMPERATURE_SCRIPT,
    ], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const text = String(result.stdout || '').trim();
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(text);
    const celsius = nullableNumber(parsed.celsius);
    return celsius === null ? null : {
      name: String(parsed.name || 'CPU'),
      celsius,
      source: String(parsed.source || ''),
    };
  } catch {
    return null;
  }
}

async function readDiskUsage(options = {}) {
  const statfs = options.statfsImpl || fs.statfs;
  const root = options.diskRoot || path.parse(process.cwd()).root;
  try {
    const stats = await statfs(root);
    const blockSize = Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * blockSize;
    const freeBytes = Number(stats.bavail) * blockSize;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes)) {
      return null;
    }
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      root,
      usedBytes,
      freeBytes,
      totalBytes,
      usedPercent: clampPercent((usedBytes / totalBytes) * 100),
    };
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectSystemMetrics(options = {}) {
  const osModule = options.osModule || os;
  const delayImpl = options.delayImpl || delay;
  const sampleMs = Math.max(100, Number(options.sampleMs) || 500);
  const initialCpus = osModule.cpus();
  const before = cpuSnapshot(initialCpus);
  const totalMemoryBytes = Number(osModule.totalmem());
  const freeMemoryBytes = Number(osModule.freemem());
  const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);

  const cpuPromise = (async () => {
    await delayImpl(sampleMs);
    return calculateCpuPercent(before, cpuSnapshot(osModule.cpus()));
  })();
  const gpuPromise = (options.readGpuMetricsImpl || readGpuMetrics)(options);
  const temperaturePromise = (options.readCpuTemperatureImpl || readCpuTemperature)(options);
  const diskPromise = (options.readDiskUsageImpl || readDiskUsage)(options);
  const [cpuPercent, gpus, cpuTemperature, disk] = await Promise.all([
    cpuPromise.catch(() => null),
    gpuPromise.catch(() => []),
    temperaturePromise.catch(() => null),
    diskPromise.catch(() => null),
  ]);

  return {
    timestamp: new Date().toISOString(),
    hostname: osModule.hostname(),
    uptimeSeconds: Number(osModule.uptime()) || 0,
    cpu: {
      model: String(initialCpus[0]?.model || 'CPU').replace(/\s+/g, ' ').trim(),
      logicalCores: initialCpus.length,
      utilizationPercent: cpuPercent,
    },
    cpuTemperature,
    memory: {
      usedBytes: usedMemoryBytes,
      freeBytes: freeMemoryBytes,
      totalBytes: totalMemoryBytes,
      usedPercent: totalMemoryBytes > 0
        ? clampPercent((usedMemoryBytes / totalMemoryBytes) * 100)
        : null,
    },
    gpus,
    disk,
  };
}

module.exports = {
  calculateCpuPercent,
  collectSystemMetrics,
  cpuSnapshot,
  parseNvidiaSmi,
  readCpuTemperature,
  readDiskUsage,
  readGpuMetrics,
};
