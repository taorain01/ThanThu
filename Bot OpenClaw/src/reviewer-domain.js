'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);
const INTERNAL_DIRECTORIES = new Set([
  '_masters',
  '_metadata',
  '_rejected',
  '_reviewer-trash',
  '_work',
  '_working',
]);

class ReviewerDomainError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ReviewerDomainError';
    this.code = code;
    this.details = details;
  }
}

function normalizedPath(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInsideRoot(candidate, root) {
  const resolvedCandidate = normalizedPath(candidate);
  const resolvedRoot = normalizedPath(root);
  return resolvedCandidate === resolvedRoot
    || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function assertInsideRoot(candidate, root, label = 'Đường dẫn') {
  if (!isInsideRoot(candidate, root)) {
    throw new ReviewerDomainError('path_outside_root', `${label} nằm ngoài thư mục được phép.`);
  }
  return path.resolve(candidate);
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeVariant(value) {
  const clean = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/^background(?:\s+final)?$/.test(clean)) return 'background';
  if (/^playlist(?:\s+final)?$/.test(clean)) return 'playlist';
  if (/^background\s+master$/.test(clean)) return 'background-master';
  if (/^playlist\s+master$/.test(clean)) return 'playlist-master';
  if (/thumbnail/.test(clean)) return 'thumbnail';
  if (/cover/.test(clean)) return 'cover';
  return clean || 'image';
}

function parseMediaFilename(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    return null;
  }
  const stem = fileName.slice(0, -extension.length);
  const match = stem.match(/^(\d{1,8})\s*[—–-]\s*(.+?)\s*\(([^)]+)\)$/u);
  if (!match) {
    return {
      numbered: false,
      id: null,
      order: null,
      title: stem.trim(),
      variant: 'image',
      variantLabel: '',
      extension,
    };
  }
  return {
    numbered: true,
    id: match[1],
    order: Number.parseInt(match[1], 10),
    title: match[2].trim(),
    variant: normalizeVariant(match[3]),
    variantLabel: match[3].trim(),
    extension,
  };
}

function metadataIdFromName(fileName) {
  return fileName.match(/^(\d{1,8})\s*[—–-]/u)?.[1] || null;
}

function formatId(order, width = 4) {
  const number = Number(order);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ReviewerDomainError('invalid_order', 'Số thứ tự không hợp lệ.');
  }
  return String(number).padStart(Math.max(1, width), '0');
}

function variantPriority(variant) {
  return {
    background: 0,
    playlist: 1,
    thumbnail: 2,
    cover: 3,
    image: 4,
    'background-master': 8,
    'playlist-master': 9,
  }[variant] ?? 5;
}

function deliveryState(metadata) {
  const delivery = metadata?.delivery;
  if (
    metadata?.delivered === true
    || delivery?.status === 'delivered'
    || delivery?.messageId
    || (delivery?.background?.messageId && delivery?.playlist?.messageId)
    || (delivery?.backgroundMessageId && delivery?.playlistMessageId)
  ) {
    return 'delivered';
  }
  if (delivery || metadata?.deliveryId) {
    return 'pending';
  }
  return 'unknown';
}

async function readJsonSafe(filePath) {
  try {
    const raw = (await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
    return { raw, value: JSON.parse(raw), error: null };
  } catch (error) {
    return { raw: null, value: null, error: error.message };
  }
}

async function statMedia(filePath, parsed) {
  const stat = await fs.stat(filePath);
  return {
    kind: parsed.variant,
    label: parsed.variantLabel || parsed.variant,
    path: filePath,
    name: path.basename(filePath),
    extension: parsed.extension,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function expectedVariantsFor(items) {
  const numbered = items.filter((item) => item.order !== null);
  if (!numbered.length) return ['image'];
  const paired = numbered.filter((item) => (
    item.variants.some((variant) => variant.kind === 'background')
    && item.variants.some((variant) => variant.kind === 'playlist')
  )).length;
  return paired / numbered.length >= 0.35 ? ['background', 'playlist'] : ['image'];
}

async function scanAlbum(albumPath, options = {}) {
  const resolvedAlbum = path.resolve(albumPath);
  const albumName = options.name || path.basename(resolvedAlbum);
  const entries = await fs.readdir(resolvedAlbum, { withFileTypes: true });
  const imageEntries = entries.filter((entry) => (
    entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
  ));
  const metadataRoot = path.join(resolvedAlbum, '_metadata');
  let metadataEntries = [];
  try {
    metadataEntries = (await fs.readdir(metadataRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const metadataById = new Map();
  await Promise.all(metadataEntries.map(async (entry) => {
    const filePath = path.join(metadataRoot, entry.name);
    const result = await readJsonSafe(filePath);
    const id = String(result.value?.id || metadataIdFromName(entry.name) || '').trim();
    if (!id) return;
    const current = metadataById.get(id);
    if (!current || entry.name.includes('(item)')) {
      metadataById.set(id, {
        path: filePath,
        name: entry.name,
        raw: result.raw,
        value: result.value,
        error: result.error,
      });
    }
  }));

  const groups = new Map();
  for (const entry of imageEntries) {
    const parsed = parseMediaFilename(entry.name);
    const filePath = path.join(resolvedAlbum, entry.name);
    const key = parsed.numbered ? `id:${parsed.id}` : `loose:${entry.name}`;
    const current = groups.get(key) || {
      key,
      id: parsed.id,
      order: parsed.order,
      title: parsed.title,
      numbered: parsed.numbered,
      variants: [],
    };
    current.variants.push(await statMedia(filePath, parsed));
    groups.set(key, current);
  }

  const items = [...groups.values()].map((group) => {
    group.variants.sort((left, right) => (
      variantPriority(left.kind) - variantPriority(right.kind)
      || left.name.localeCompare(right.name, 'vi')
    ));
    const metadata = group.id ? metadataById.get(group.id) || null : null;
    const metadataTitle = String(metadata?.value?.title || '').trim();
    const latestMtimeMs = Math.max(...group.variants.map((variant) => variant.mtimeMs));
    return {
      key: group.key,
      id: group.id,
      order: group.order,
      title: metadataTitle || group.title,
      numbered: group.numbered,
      variants: group.variants,
      coverPath: group.variants[0]?.path || null,
      metadataPath: metadata?.path || null,
      metadataName: metadata?.name || null,
      metadata: metadata?.value || null,
      metadataRaw: metadata?.raw || null,
      metadataError: metadata?.error || null,
      deliveryState: deliveryState(metadata?.value),
      latestMtimeMs,
      size: group.variants.reduce((sum, variant) => sum + variant.size, 0),
    };
  });

  items.sort((left, right) => {
    if (left.order === null && right.order !== null) return 1;
    if (left.order !== null && right.order === null) return -1;
    return (left.order ?? 0) - (right.order ?? 0)
      || left.title.localeCompare(right.title, 'vi');
  });

  const expectedVariants = options.expectedVariants || expectedVariantsFor(items);
  for (const item of items) {
    if (expectedVariants.includes('image')) {
      item.missingVariants = [];
    } else {
      item.missingVariants = expectedVariants.filter((kind) => (
        !item.variants.some((variant) => variant.kind === kind)
      ));
    }
  }

  const latestMtimeMs = items.length
    ? Math.max(...items.map((item) => item.latestMtimeMs))
    : 0;
  const newThreshold = Date.now() - (options.newWithinMs || 24 * 60 * 60 * 1000);
  const health = {
    total: items.length,
    numbered: items.filter((item) => item.numbered).length,
    loose: items.filter((item) => !item.numbered).length,
    missing: items.filter((item) => item.missingVariants.length > 0).length,
    metadataErrors: items.filter((item) => item.metadataError).length,
    pendingDelivery: items.filter((item) => item.deliveryState === 'pending').length,
    newCount: items.filter((item) => item.latestMtimeMs >= newThreshold).length,
  };

  return {
    id: slugify(albumName) || crypto.createHash('sha1').update(resolvedAlbum).digest('hex').slice(0, 12),
    name: albumName,
    path: resolvedAlbum,
    expectedVariants,
    items,
    health,
    coverPath: items.find((item) => item.coverPath)?.coverPath || null,
    latestMtimeMs,
    maxOrder: items.reduce((max, item) => Math.max(max, item.order || 0), 0),
    idWidth: Math.max(4, ...items.filter((item) => item.id).map((item) => item.id.length)),
  };
}

async function scanAlbums(rootPath, options = {}) {
  const resolvedRoot = path.resolve(rootPath);
  const entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => (
    entry.isDirectory()
    && !INTERNAL_DIRECTORIES.has(entry.name.toLowerCase())
    && !options.excludedNames?.includes(entry.name)
  ));
  const albums = [];
  for (const entry of directories) {
    try {
      albums.push(await scanAlbum(path.join(resolvedRoot, entry.name), { name: entry.name }));
    } catch (error) {
      albums.push({
        id: slugify(entry.name),
        name: entry.name,
        path: path.join(resolvedRoot, entry.name),
        items: [],
        expectedVariants: ['image'],
        health: { total: 0, numbered: 0, loose: 0, missing: 0, metadataErrors: 1, pendingDelivery: 0, newCount: 0 },
        coverPath: null,
        latestMtimeMs: 0,
        maxOrder: 0,
        idWidth: 4,
        scanError: error.message,
      });
    }
  }
  return albums.sort((left, right) => (
    right.latestMtimeMs - left.latestMtimeMs || left.name.localeCompare(right.name, 'vi')
  ));
}

function parseSkillSections(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const starts = [];
  if (lines[0]?.trim() === '---') {
    const end = lines.slice(1).findIndex((line) => line.trim() === '---');
    if (end >= 0) {
      starts.push({ title: 'Frontmatter', level: 0, startLine: 1, headingLine: 1 + end + 1 });
    }
  }
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (match) {
      starts.push({ title: match[2].trim(), level: match[1].length, startLine: index + 1 });
    }
  });
  const unique = starts.filter((section, index) => (
    index === 0 || section.startLine !== starts[index - 1].startLine
  ));
  return unique.map((section, index) => {
    const endLine = (unique[index + 1]?.startLine || lines.length + 1) - 1;
    return {
      id: `${section.level}-${section.startLine}-${slugify(section.title) || 'section'}`,
      title: section.title,
      level: section.level,
      startLine: section.startLine,
      endLine,
      content: lines.slice(section.startLine - 1, endLine).join('\n'),
    };
  });
}

async function readSkillDocument(skillPath, skillsRoot) {
  const resolvedPath = assertInsideRoot(skillPath, skillsRoot, 'Skill');
  if (path.basename(resolvedPath).toLowerCase() !== 'skill.md') {
    throw new ReviewerDomainError('invalid_skill_file', 'Chỉ được chỉnh file SKILL.md đang hoạt động.');
  }
  const content = (await fs.readFile(resolvedPath, 'utf8')).replace(/^\uFEFF/, '');
  const stat = await fs.stat(resolvedPath);
  return {
    path: resolvedPath,
    content,
    sections: parseSkillSections(content),
    mtimeMs: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
  };
}

async function writeFileAtomic(filePath, content) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function saveSkillDocument({ skillPath, skillsRoot, backupsRoot, content, expectedSha256 = null }) {
  const current = await readSkillDocument(skillPath, skillsRoot);
  if (expectedSha256 && current.sha256 !== expectedSha256) {
    throw new ReviewerDomainError(
      'skill_changed',
      'File skill đã thay đổi bên ngoài app. Hãy tải lại và so sánh trước khi lưu.',
    );
  }
  const cleanContent = String(content || '').replace(/\r\n/g, '\n');
  if (!cleanContent.trim()) {
    throw new ReviewerDomainError('empty_skill', 'Không thể lưu skill rỗng.');
  }
  const skillDirectory = path.basename(path.dirname(current.path));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsRoot, skillDirectory, `${timestamp}.SKILL.md`);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, current.content, 'utf8');
  await writeFileAtomic(current.path, `${cleanContent.replace(/\s+$/g, '')}\n`);
  return {
    ...(await readSkillDocument(current.path, skillsRoot)),
    backupPath,
  };
}

async function listSkillHistory(skillPath, skillsRoot, backupsRoot) {
  const resolved = assertInsideRoot(skillPath, skillsRoot, 'Skill');
  const skillDirectory = path.basename(path.dirname(resolved));
  const directory = path.join(backupsRoot, skillDirectory);
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const history = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.SKILL.md'))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stat = await fs.stat(filePath);
        return { path: filePath, name: entry.name, mtimeMs: stat.mtimeMs, size: stat.size };
      }));
    return history.sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function replaceLeadingId(fileName, newId) {
  return fileName.replace(/^\d{1,8}(?=\s*[—–-])/u, newId);
}

function planAssignments({ items, occupiedOrders, mode, startAt, width }) {
  const selected = [...items].sort((left, right) => (
    (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
  ));
  const occupied = new Set([...occupiedOrders].filter((value) => Number.isSafeInteger(value)));
  const assignments = [];
  let cursor;
  if (mode === 'append') {
    cursor = Math.max(0, ...occupied) + 1;
  } else {
    cursor = Math.max(1, Number.parseInt(startAt || '1', 10) || 1);
  }
  for (const item of selected) {
    if (mode === 'fill' || mode === 'compact') {
      while (occupied.has(cursor)) cursor += 1;
    }
    const newOrder = cursor;
    occupied.add(newOrder);
    assignments.push({ item, oldId: item.id, newOrder, newId: formatId(newOrder, width) });
    cursor += 1;
  }
  return assignments;
}

function bundlePaths(item) {
  const paths = item.variants
    .filter((variant) => !variant.kind.endsWith('-master'))
    .map((variant) => variant.path);
  if (item.metadataPath) paths.push(item.metadataPath);
  return paths;
}

function rewriteMetadata(raw, options) {
  if (!raw) return null;
  const value = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const now = new Date().toISOString();
  value.id = options.newId;
  if (options.targetAlbumName) {
    value.channel = options.targetAlbumName;
    if (value.delivery || value.delivered || value.deliveryId) {
      value.previousDelivery = value.delivery || {
        delivered: value.delivered === true,
        deliveryId: value.deliveryId || null,
      };
    }
    value.delivery = { status: 'pending', movedAt: now };
    value.delivered = false;
    delete value.deliveryId;
  }
  const history = Array.isArray(value.reviewerHistory) ? value.reviewerHistory : [];
  history.push({
    action: options.kind,
    at: now,
    fromId: options.oldId,
    toId: options.newId,
    ...(options.sourceAlbumName ? { fromAlbum: options.sourceAlbumName } : {}),
    ...(options.targetAlbumName ? { toAlbum: options.targetAlbumName } : {}),
  });
  value.reviewerHistory = history.slice(-50);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildMoveEntries(assignments, sourceAlbum, targetAlbum) {
  const entries = [];
  const metadataUpdates = [];
  for (const assignment of assignments) {
    const files = bundlePaths(assignment.item);
    for (const sourcePath of files) {
      const isMetadata = assignment.item.metadataPath === sourcePath;
      const destinationRoot = isMetadata
        ? path.join(targetAlbum.path, '_metadata')
        : targetAlbum.path;
      const destinationName = replaceLeadingId(path.basename(sourcePath), assignment.newId);
      const destinationPath = path.join(destinationRoot, destinationName);
      entries.push({
        sourcePath,
        destinationPath,
        isMetadata,
        itemKey: assignment.item.key,
        oldId: assignment.oldId,
        newId: assignment.newId,
      });
      if (isMetadata) {
        metadataUpdates.push({
          originalPath: sourcePath,
          destinationPath,
          originalContent: assignment.item.metadataRaw || null,
          newContent: rewriteMetadata(
            assignment.item.metadataRaw,
            {
              kind: sourceAlbum.path === targetAlbum.path ? 'renumber' : 'move',
              oldId: assignment.oldId,
              newId: assignment.newId,
              sourceAlbumName: sourceAlbum.name,
              targetAlbumName: sourceAlbum.path === targetAlbum.path ? null : targetAlbum.name,
            },
          ),
        });
      }
    }
  }
  return { entries, metadataUpdates };
}

function detectConflicts(entries) {
  const sourceKeys = new Set(entries.map((entry) => normalizedPath(entry.sourcePath)));
  const destinations = new Set();
  const conflicts = [];
  for (const entry of entries) {
    const destinationKey = normalizedPath(entry.destinationPath);
    if (destinations.has(destinationKey)) {
      conflicts.push({ type: 'duplicate_destination', path: entry.destinationPath });
    }
    destinations.add(destinationKey);
    if (fsSync.existsSync(entry.destinationPath) && !sourceKeys.has(destinationKey)) {
      conflicts.push({ type: 'destination_exists', path: entry.destinationPath });
    }
  }
  return conflicts;
}

function createOperationPlan({ kind, sourceAlbum, targetAlbum, assignments, entries, metadataUpdates }) {
  const operationId = crypto.randomUUID();
  return {
    id: operationId,
    kind,
    createdAt: new Date().toISOString(),
    sourceAlbum: { id: sourceAlbum.id, name: sourceAlbum.name, path: sourceAlbum.path },
    targetAlbum: { id: targetAlbum.id, name: targetAlbum.name, path: targetAlbum.path },
    assignments: assignments.map(({ item, ...assignment }) => ({
      ...assignment,
      key: item.key,
      title: item.title,
    })),
    moves: entries,
    metadataUpdates,
    conflicts: detectConflicts(entries),
  };
}

function planRenumber({ album, itemKeys, mode = 'compact', startAt = 1 }) {
  const selectedSet = new Set(itemKeys || []);
  const selected = album.items.filter((item) => selectedSet.has(item.key) && item.numbered);
  if (!selected.length) {
    throw new ReviewerDomainError('empty_selection', 'Chưa chọn item có số thứ tự để đổi số.');
  }
  const occupied = album.items
    .filter((item) => item.numbered && !selectedSet.has(item.key))
    .map((item) => item.order);
  const assignments = planAssignments({
    items: selected,
    occupiedOrders: occupied,
    mode,
    startAt,
    width: album.idWidth || 4,
  });
  const { entries, metadataUpdates } = buildMoveEntries(assignments, album, album);
  return createOperationPlan({
    kind: 'renumber',
    sourceAlbum: album,
    targetAlbum: album,
    assignments,
    entries: entries.filter((entry) => normalizedPath(entry.sourcePath) !== normalizedPath(entry.destinationPath)),
    metadataUpdates: metadataUpdates.filter((entry) => normalizedPath(entry.originalPath) !== normalizedPath(entry.destinationPath)),
  });
}

function planMove({ sourceAlbum, targetAlbum, itemKeys, mode = 'append', startAt = 1 }) {
  if (normalizedPath(sourceAlbum.path) === normalizedPath(targetAlbum.path)) {
    return planRenumber({ album: sourceAlbum, itemKeys, mode, startAt });
  }
  const selectedSet = new Set(itemKeys || []);
  const selected = sourceAlbum.items.filter((item) => selectedSet.has(item.key) && item.numbered);
  if (!selected.length) {
    throw new ReviewerDomainError('empty_selection', 'Chưa chọn item có số thứ tự để chuyển album.');
  }
  const assignments = planAssignments({
    items: selected,
    occupiedOrders: targetAlbum.items.filter((item) => item.numbered).map((item) => item.order),
    mode,
    startAt,
    width: targetAlbum.idWidth || 4,
  });
  const { entries, metadataUpdates } = buildMoveEntries(assignments, sourceAlbum, targetAlbum);
  return createOperationPlan({
    kind: 'move',
    sourceAlbum,
    targetAlbum,
    assignments,
    entries,
    metadataUpdates,
  });
}

function planTrash({ album, itemKeys }) {
  const selectedSet = new Set(itemKeys || []);
  const selected = album.items.filter((item) => selectedSet.has(item.key));
  if (!selected.length) {
    throw new ReviewerDomainError('empty_selection', 'Chưa chọn item để đưa vào thùng rác.');
  }
  const operationId = crypto.randomUUID();
  const trashRoot = path.join(album.path, '_reviewer-trash', operationId);
  const moves = [];
  for (const item of selected) {
    for (const sourcePath of bundlePaths(item)) {
      const isMetadata = sourcePath === item.metadataPath;
      moves.push({
        sourcePath,
        destinationPath: path.join(trashRoot, isMetadata ? '_metadata' : '', path.basename(sourcePath)),
        isMetadata,
        itemKey: item.key,
        oldId: item.id,
        newId: item.id,
      });
    }
  }
  return {
    id: operationId,
    kind: 'trash',
    createdAt: new Date().toISOString(),
    sourceAlbum: { id: album.id, name: album.name, path: album.path },
    targetAlbum: { id: album.id, name: album.name, path: trashRoot },
    assignments: selected.map((item) => ({ key: item.key, title: item.title, oldId: item.id, newId: item.id })),
    moves,
    metadataUpdates: [],
    conflicts: detectConflicts(moves),
  };
}

async function moveFile(sourcePath, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.copyFile(sourcePath, destinationPath, fsSync.constants.COPYFILE_EXCL);
    const [sourceStat, destinationStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(destinationPath),
    ]);
    if (sourceStat.size !== destinationStat.size) {
      await fs.rm(destinationPath, { force: true });
      throw new ReviewerDomainError('copy_verification_failed', 'File copy khác kích thước nguồn.');
    }
    await fs.unlink(sourcePath);
  }
}

async function saveJournal(journalDirectory, journal) {
  await fs.mkdir(journalDirectory, { recursive: true });
  const journalPath = path.join(journalDirectory, `${journal.id}.json`);
  await writeFileAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return journalPath;
}

async function executeOperation(plan, options = {}) {
  if (plan.conflicts?.length) {
    throw new ReviewerDomainError('operation_conflict', 'Kế hoạch còn xung đột, chưa thể thực hiện.', plan.conflicts);
  }
  const allowedRoot = options.allowedRoot;
  if (allowedRoot) {
    for (const move of plan.moves) {
      assertInsideRoot(move.sourcePath, allowedRoot, 'File nguồn');
      assertInsideRoot(move.destinationPath, allowedRoot, 'File đích');
    }
  }
  const states = plan.moves.map((move, index) => ({
    ...move,
    temporaryPath: path.join(
      path.dirname(move.sourcePath),
      `.__openclaw_reviewer_${plan.id}_${String(index).padStart(4, '0')}${path.extname(move.sourcePath)}`,
    ),
    state: 'source',
  }));
  try {
    for (const state of states) {
      await moveFile(state.sourcePath, state.temporaryPath);
      state.state = 'temporary';
    }
    for (const state of states) {
      await moveFile(state.temporaryPath, state.destinationPath);
      state.state = 'destination';
    }
    for (const update of plan.metadataUpdates || []) {
      if (update.newContent) {
        await writeFileAtomic(update.destinationPath, update.newContent);
      }
    }
  } catch (error) {
    for (const state of [...states].reverse()) {
      try {
        if (state.state === 'destination' && fsSync.existsSync(state.destinationPath)) {
          await moveFile(state.destinationPath, state.sourcePath);
        } else if (state.state === 'temporary' && fsSync.existsSync(state.temporaryPath)) {
          await moveFile(state.temporaryPath, state.sourcePath);
        }
      } catch {
        // Giữ lỗi gốc; journal lỗi sẽ giúp kiểm tra thủ công nếu rollback không trọn vẹn.
      }
    }
    // Metadata được ghi sau khi rename; nếu bước này lỗi, khôi phục nội dung
    // cũ cùng lúc với tên file để operation không để lại trạng thái nửa chừng.
    for (const update of plan.metadataUpdates || []) {
      if (update.originalContent && fsSync.existsSync(update.originalPath)) {
        await writeFileAtomic(update.originalPath, update.originalContent).catch(() => {});
      }
    }
    throw error;
  }

  const journal = {
    ...plan,
    completedAt: new Date().toISOString(),
    status: 'completed',
  };
  journal.journalPath = options.journalDirectory
    ? await saveJournal(options.journalDirectory, journal)
    : null;
  return journal;
}

async function undoOperation(journal, options = {}) {
  if (!journal || journal.status === 'undone') {
    throw new ReviewerDomainError('invalid_journal', 'Operation không còn khả dụng để hoàn tác.');
  }
  const allowedRoot = options.allowedRoot;
  const reverse = [...journal.moves].reverse();
  for (const move of reverse) {
    if (allowedRoot) {
      assertInsideRoot(move.sourcePath, allowedRoot, 'File khôi phục');
      assertInsideRoot(move.destinationPath, allowedRoot, 'File hiện tại');
    }
    if (!fsSync.existsSync(move.destinationPath)) {
      throw new ReviewerDomainError('undo_source_missing', `Không còn file để hoàn tác: ${move.destinationPath}`);
    }
    if (fsSync.existsSync(move.sourcePath)) {
      throw new ReviewerDomainError('undo_conflict', `File cũ đã tồn tại lại: ${move.sourcePath}`);
    }
  }
  for (const move of reverse) {
    await moveFile(move.destinationPath, move.sourcePath);
  }
  for (const update of journal.metadataUpdates || []) {
    if (update.originalContent) {
      await writeFileAtomic(update.originalPath, update.originalContent);
    }
  }
  const undone = { ...journal, status: 'undone', undoneAt: new Date().toISOString() };
  if (journal.journalPath) {
    await writeFileAtomic(journal.journalPath, `${JSON.stringify(undone, null, 2)}\n`);
  }
  return undone;
}

async function readOperationJournal(journalPath, journalRoot) {
  const resolved = assertInsideRoot(journalPath, journalRoot, 'Journal');
  return JSON.parse((await fs.readFile(resolved, 'utf8')).replace(/^\uFEFF/, ''));
}

module.exports = {
  IMAGE_EXTENSIONS,
  INTERNAL_DIRECTORIES,
  ReviewerDomainError,
  assertInsideRoot,
  deliveryState,
  executeOperation,
  formatId,
  isInsideRoot,
  listSkillHistory,
  normalizeVariant,
  parseMediaFilename,
  parseSkillSections,
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
};
