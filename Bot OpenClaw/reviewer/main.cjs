'use strict';

// Một số launcher (đặc biệt khi chạy qua môi trường phát triển) đặt biến này,
// khiến Electron khởi động như Node và không cung cấp app/protocol. Tự khởi
// động lại bằng binary Electron thật để `reviewer:start` luôn chạy đúng.
const electronModule = require('electron');
if (typeof electronModule === 'string') {
  const { spawn } = require('node:child_process');
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronModule, [__filename, ...process.argv.slice(2)], {
    env: childEnv,
    stdio: 'inherit',
    windowsHide: false,
  });
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
  return;
}

const { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, shell } = electronModule;
const dotenv = require('dotenv');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  assertInsideRoot,
  executeOperation,
  listSkillHistory,
  planMove,
  planRenumber,
  planTrash,
  readOperationJournal,
  readSkillDocument,
  saveSkillDocument,
  scanAlbum,
  scanAlbums,
  slugify,
  undoOperation,
  writeFileAtomic,
} = require('../src/reviewer-domain');

const BOT_ROOT = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
dotenv.config({ path: path.join(BOT_ROOT, '.env'), quiet: true });

const DEFAULT_MEDIA_ROOT = 'F:\\Hình Ảnh\\anhYoutube';
const DEFAULT_SKILLS_ROOT = path.join(OPENCLAW_HOME, 'workspace', 'skills');
const DEFAULT_CHANNEL_ASSETS = path.join(
  OPENCLAW_HOME,
  'workspace',
  'assets',
  'channels',
  'channel-assets.json',
);
const DEFAULT_BOT_BRIDGE_PORT = Number(process.env.OPENCLAW_REVIEWER_PORT || 18792);
const IMAGE_MIME = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

let mainWindow = null;
let watcher = null;
let watcherTimer = null;
let bridgeEventsAbort = null;
let settings = null;
let albumsCache = [];
let channelsCache = [];

protocol.registerSchemesAsPrivileged([{
  scheme: 'openclaw-media',
  privileges: { secure: true, supportFetchAPI: true, stream: true },
}]);

function reviewerDataRoot() {
  return path.join(app.getPath('userData'), 'reviewer');
}

function defaultSettings() {
  const configuredRoots = String(process.env.OPENCLAW_MEDIA_SOURCE_ROOTS || '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    mediaRoot: configuredRoots[0] || DEFAULT_MEDIA_ROOT,
    skillsRoot: process.env.OPENCLAW_SKILLS_ROOT || DEFAULT_SKILLS_ROOT,
    channelMap: {},
    expectedVariants: {},
    tileSize: 220,
    theme: 'editorial',
  };
}

async function loadSettings() {
  const filePath = path.join(reviewerDataRoot(), 'settings.json');
  try {
    const value = JSON.parse((await fsp.readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''));
    settings = { ...defaultSettings(), ...value, channelMap: { ...(value.channelMap || {}) } };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    settings = defaultSettings();
    await saveSettings();
  }
  return settings;
}

async function saveSettings() {
  const filePath = path.join(reviewerDataRoot(), 'settings.json');
  await writeFileAtomic(filePath, `${JSON.stringify(settings, null, 2)}\n`);
}

function normalizeName(value) {
  return slugify(value).replace(/-/g, '');
}

async function readChannelAssets() {
  try {
    return JSON.parse((await fsp.readFile(DEFAULT_CHANNEL_ASSETS, 'utf8')).replace(/^\uFEFF/, ''))?.channels || {};
  } catch {
    return {};
  }
}

async function readSkillCatalog() {
  const entries = await fsp.readdir(settings.skillsRoot, { withFileTypes: true }).catch(() => []);
  const catalog = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(settings.skillsRoot, entry.name, 'SKILL.md');
    try {
      const content = await fsp.readFile(skillPath, 'utf8');
      const frontmatter = {};
      const block = content.match(/^---\n([\s\S]*?)\n---/);
      for (const line of block?.[1]?.split(/\r?\n/) || []) {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*["']?(.+?)["']?\s*$/);
        if (match) frontmatter[match[1]] = match[2];
      }
      catalog.push({
        id: entry.name,
        name: frontmatter.name || entry.name,
        description: frontmatter.description || '',
        path: skillPath,
        slug: normalizeName(entry.name),
      });
    } catch {
      // Bỏ qua thư mục skill thiếu SKILL.md.
    }
  }
  return catalog;
}

async function resolveAlbums() {
  const [albums, skills, channelAssets] = await Promise.all([
    scanAlbums(settings.mediaRoot),
    readSkillCatalog(),
    readChannelAssets(),
  ]);
  albumsCache = albums.map((album) => {
    const albumSlug = normalizeName(album.name);
    const skill = skills.find((candidate) => (
      candidate.slug.includes(albumSlug) || albumSlug.includes(candidate.slug.replace('taoanhchokenh', ''))
    ));
    const asset = channelAssets[album.name] || {};
    const configured = settings.channelMap[album.id] || {};
    const channelId = configured.controlChannelId || null;
    const deliveryChannelId = configured.deliveryChannelId || asset.discordChannelId || null;
    return {
      ...album,
      skillId: skill?.id || null,
      skillName: skill?.name || null,
      skillPath: skill?.path || null,
      skillDescription: skill?.description || '',
      controlChannelId: channelId,
      deliveryChannelId,
      deliveryChannelName: asset.discordChannelName || null,
      configured: Boolean(configured.controlChannelId),
    };
  });
  return albumsCache;
}

function getAlbumById(albumId) {
  const album = albumsCache.find((candidate) => candidate.id === albumId);
  if (!album) throw new Error(`Không tìm thấy album ${albumId}.`);
  return album;
}

function mediaUrl(filePath) {
  return `openclaw-media://asset/${encodeURIComponent(path.resolve(filePath))}`;
}

async function registerMediaProtocol() {
  protocol.handle('openclaw-media', async (request) => {
    const url = new URL(request.url);
    const filePath = url.hostname === 'asset'
      ? decodeURIComponent(url.pathname.replace(/^\//, ''))
      : '';
    if (!filePath || !path.isAbsolute(filePath) || !isAllowedMediaPath(filePath)) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const extension = path.extname(filePath).toLowerCase();
      const bytes = await fsp.readFile(filePath);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': IMAGE_MIME[extension] || 'application/octet-stream',
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function isAllowedMediaPath(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved.toLowerCase().startsWith(path.resolve(settings.mediaRoot).toLowerCase() + path.sep.toLowerCase())) {
    return true;
  }
  return false;
}

function publicAlbum(album) {
  return {
    ...album,
    coverUrl: album.coverPath ? mediaUrl(album.coverPath) : null,
    items: undefined,
  };
}

function publicItem(item) {
  return {
    ...item,
    variants: item.variants.map((variant) => ({ ...variant, url: mediaUrl(variant.path) })),
    coverUrl: item.coverPath ? mediaUrl(item.coverPath) : null,
    metadataRaw: undefined,
  };
}

function bridgeBase() {
  return `http://127.0.0.1:${DEFAULT_BOT_BRIDGE_PORT}`;
}

async function readBridgeToken() {
  return String(await fsp.readFile(path.join(BOT_ROOT, 'data', 'reviewer-token.txt'), 'utf8')).trim();
}

async function bridgeRequest(endpoint, options = {}) {
  const token = await readBridgeToken();
  const response = await fetch(`${bridgeBase()}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || 'Bot OpenClaw chưa sẵn sàng.');
    error.code = payload.code || 'bridge_error';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function sendRenderer(event, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(event, payload);
}

function scheduleRefresh() {
  clearTimeout(watcherTimer);
  watcherTimer = setTimeout(async () => {
    await resolveAlbums().catch(() => {});
    sendRenderer('reviewer:changed', { at: Date.now() });
  }, 180);
}

function startWatcher() {
  if (watcher) watcher.close();
  try {
    watcher = fs.watch(settings.mediaRoot, { recursive: true }, scheduleRefresh);
  } catch {
    watcher = null;
  }
}

async function subscribeBridgeEvents() {
  if (bridgeEventsAbort) bridgeEventsAbort.abort();
  bridgeEventsAbort = new AbortController();
  const signal = bridgeEventsAbort.signal;
  const run = async () => {
    try {
      const token = await readBridgeToken();
      const response = await fetch(`${bridgeBase()}/events`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok || !response.body) throw new Error('Bridge events unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!signal.aborted) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
          if (data) {
            try { sendRenderer('reviewer:job', JSON.parse(data)); } catch { /* bỏ qua frame hỏng */ }
          }
          boundary = buffer.indexOf('\n\n');
        }
        if (chunk.done) break;
      }
    } catch {
      if (!signal.aborted) setTimeout(run, 2000).unref?.();
    }
  };
  void run();
}

async function bootstrap() {
  await resolveAlbums();
  startWatcher();
  void subscribeBridgeEvents();
  let channels = [];
  try {
    channels = (await bridgeRequest('/channels')).channels || [];
  } catch {
    channels = [];
  }
  channelsCache = channels;
  for (const album of albumsCache) {
    if (album.controlChannelId) continue;
    const matches = channels.filter((channel) => normalizeName(channel.name) === normalizeName(album.name));
    if (matches.length === 1) album.controlChannelId = matches[0].id;
  }
  return {
    settings,
    albums: albumsCache.map(publicAlbum),
    channels,
    bridge: { port: DEFAULT_BOT_BRIDGE_PORT },
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1640,
    height: 1020,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#11100f',
    title: 'OpenClaw Gallery Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.argv.includes('--dev')) {
    await mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

function registerIpc() {
  ipcMain.handle('reviewer:bootstrap', bootstrap);
  ipcMain.handle('reviewer:refresh', async () => {
    await resolveAlbums();
    return { albums: albumsCache.map(publicAlbum), channels: channelsCache };
  });
  ipcMain.handle('reviewer:items', async (_event, albumId) => {
    const album = getAlbumById(String(albumId));
    const fresh = await scanAlbum(album.path, { name: album.name, expectedVariants: album.expectedVariants });
    return fresh.items.map(publicItem);
  });
  ipcMain.handle('reviewer:skill', async (_event, albumId) => {
    const album = getAlbumById(String(albumId));
    if (!album.skillPath) return null;
    return readSkillDocument(album.skillPath, settings.skillsRoot);
  });
  ipcMain.handle('reviewer:skill-history', async (_event, albumId) => {
    const album = getAlbumById(String(albumId));
    if (!album.skillPath) return [];
    return listSkillHistory(
      album.skillPath,
      settings.skillsRoot,
      path.join(reviewerDataRoot(), 'skill-backups'),
    );
  });
  ipcMain.handle('reviewer:save-skill', async (_event, payload) => {
    const album = getAlbumById(String(payload.albumId));
    if (!album.skillPath) throw new Error('Album chưa được liên kết với skill.');
    return saveSkillDocument({
      skillPath: album.skillPath,
      skillsRoot: settings.skillsRoot,
      backupsRoot: path.join(reviewerDataRoot(), 'skill-backups'),
      content: payload.content,
      expectedSha256: payload.expectedSha256,
    });
  });
  ipcMain.handle('reviewer:preview-operation', async (_event, payload) => {
    const sourceAlbum = getAlbumById(String(payload.albumId));
    const targetAlbum = payload.targetAlbumId ? getAlbumById(String(payload.targetAlbumId)) : sourceAlbum;
    const freshSource = await scanAlbum(sourceAlbum.path, { name: sourceAlbum.name, expectedVariants: sourceAlbum.expectedVariants });
    const freshTarget = targetAlbum.id === sourceAlbum.id
      ? freshSource
      : await scanAlbum(targetAlbum.path, { name: targetAlbum.name, expectedVariants: targetAlbum.expectedVariants });
    if (payload.kind === 'trash') return planTrash({ album: freshSource, itemKeys: payload.itemKeys });
    if (payload.kind === 'renumber') {
      return planRenumber({ album: freshSource, itemKeys: payload.itemKeys, mode: payload.mode, startAt: payload.startAt });
    }
    return planMove({
      sourceAlbum: freshSource,
      targetAlbum: freshTarget,
      itemKeys: payload.itemKeys,
      mode: payload.mode,
      startAt: payload.startAt,
    });
  });
  ipcMain.handle('reviewer:execute-operation', async (_event, plan) => {
    const journal = await executeOperation(plan, {
      allowedRoot: settings.mediaRoot,
      journalDirectory: path.join(reviewerDataRoot(), 'operations'),
    });
    await resolveAlbums();
    sendRenderer('reviewer:changed', { at: Date.now(), operation: journal });
    return journal;
  });
  ipcMain.handle('reviewer:undo-operation', async (_event, journalPath) => {
    const journal = await readOperationJournal(
      journalPath,
      path.join(reviewerDataRoot(), 'operations'),
    );
    const undone = await undoOperation(journal, { allowedRoot: settings.mediaRoot });
    await resolveAlbums();
    sendRenderer('reviewer:changed', { at: Date.now(), operation: undone });
    return undone;
  });
  ipcMain.handle('reviewer:settings', async (_event, patch) => {
    settings = { ...settings, ...patch, channelMap: { ...settings.channelMap, ...(patch.channelMap || {}) } };
    await saveSettings();
    await resolveAlbums();
    startWatcher();
    sendRenderer('reviewer:changed', { at: Date.now() });
    return { settings, albums: albumsCache.map(publicAlbum) };
  });
  ipcMain.handle('reviewer:channels', async () => {
    let result;
    try {
      result = await bridgeRequest('/channels');
    } catch {
      channelsCache = [];
      return channelsCache;
    }
    channelsCache = result.channels || [];
    for (const album of albumsCache) {
      if (album.controlChannelId) continue;
      const matches = channelsCache.filter((channel) => normalizeName(channel.name) === normalizeName(album.name));
      if (matches.length === 1) album.controlChannelId = matches[0].id;
    }
    return channelsCache;
  });
  ipcMain.handle('reviewer:jobs', async () => {
    try {
      return await bridgeRequest('/jobs?limit=50');
    } catch {
      return { jobs: [] };
    }
  });
  ipcMain.handle('reviewer:submit-command', async (_event, payload) => {
    const album = getAlbumById(String(payload.albumId));
    const channelId = String(payload.channelId || album.controlChannelId || '').trim();
    if (!channelId) throw new Error('Album chưa được gán control channel.');
    const skillHint = album.skillName ? `Dùng skill ${album.skillName}.\n` : '';
    const context = [
      skillHint,
      `Album đích: ${album.name}.`,
      `Thư mục output: ${album.path}.`,
      `Delivery channel: ${album.deliveryChannelName || album.deliveryChannelId || 'theo skill'}.`,
      String(payload.text || '').trim(),
    ].filter(Boolean).join('\n');
    return bridgeRequest('/commands', {
      method: 'POST',
      body: { channelId, text: context, albumName: album.name, skillName: album.skillName },
    });
  });
  ipcMain.handle('reviewer:stop-job', async (_event, jobId) => bridgeRequest(`/commands/${encodeURIComponent(jobId)}/stop`, { method: 'POST' }));
  ipcMain.handle('reviewer:resume-job', async (_event, jobId) => bridgeRequest(`/commands/${encodeURIComponent(jobId)}/resume`, { method: 'POST' }));
  ipcMain.handle('reviewer:open-path', async (_event, filePath) => {
    const resolved = assertInsideRoot(filePath, settings.mediaRoot, 'File');
    await shell.openPath(resolved);
    return resolved;
  });
  ipcMain.handle('reviewer:reveal-path', async (_event, filePath) => {
    const resolved = assertInsideRoot(filePath, settings.mediaRoot, 'File');
    shell.showItemInFolder(resolved);
    return resolved;
  });
  ipcMain.handle('reviewer:copy-path', async (_event, filePath) => {
    const resolved = assertInsideRoot(filePath, settings.mediaRoot, 'File');
    clipboard.writeText(resolved);
    return resolved;
  });
  ipcMain.handle('reviewer:choose-root', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    settings.mediaRoot = result.filePaths[0];
    await saveSettings();
    await resolveAlbums();
    startWatcher();
    return settings.mediaRoot;
  });
}

app.whenReady().then(async () => {
  await loadSettings();
  registerIpc();
  await registerMediaProtocol();
  await createWindow();
  if (process.argv.includes('--smoke')) {
    setTimeout(() => app.quit(), 2500).unref?.();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('before-quit', () => {
  clearTimeout(watcherTimer);
  watcher?.close();
  bridgeEventsAbort?.abort();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
