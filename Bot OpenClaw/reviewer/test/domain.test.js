'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ReviewerDomainError,
  assertInsideRoot,
  executeOperation,
  parseMediaFilename,
  parseSkillSections,
  planMove,
  planRenumber,
  planTrash,
  readSkillDocument,
  saveSkillDocument,
  scanAlbum,
  undoOperation,
} = require('../../src/reviewer-domain');

test('từ chối path traversal khỏi root được cấp phép', async (t) => {
  const root = await fixture(t);
  assert.throws(
    () => assertInsideRoot(path.join(root, '..', 'ngoài-root.txt'), root),
    (error) => error instanceof ReviewerDomainError && error.code === 'path_outside_root',
  );
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-reviewer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function writeImage(filePath, marker = 'image') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(marker));
}

async function writeItem(album, id, title, variants = ['background', 'playlist']) {
  for (const variant of variants) {
    await writeImage(path.join(album, `${id} — ${title} (${variant}).png`), `${id}-${variant}`);
  }
  const metadataPath = path.join(album, '_metadata', `${id} — ${title} (item).json`);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, `${JSON.stringify({
    id,
    title,
    channel: path.basename(album),
    delivery: { status: 'delivered', messageId: `message-${id}` },
  }, null, 2)}\n`, 'utf8');
}

test('parseMediaFilename giữ Unicode và nhận đúng variant', () => {
  assert.deepEqual(parseMediaFilename('0012 — Gió Qua Thành Phố (background).png'), {
    numbered: true,
    id: '0012',
    order: 12,
    title: 'Gió Qua Thành Phố',
    variant: 'background',
    variantLabel: 'background',
    extension: '.png',
  });
  assert.equal(parseMediaFilename('ảnh chưa đặt số.webp').numbered, false);
});

test('scanAlbum nhóm bundle, metadata và phát hiện thiếu cặp', async (t) => {
  const root = await fixture(t);
  const album = path.join(root, 'SeoraChill');
  await fs.mkdir(album);
  await writeItem(album, '0001', 'Ngày Xanh');
  await writeItem(album, '0002', 'Nắng Nhẹ', ['background']);
  await writeImage(path.join(album, 'ảnh rời.png'));

  const result = await scanAlbum(album, { expectedVariants: ['background', 'playlist'] });
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].variants.length, 2);
  assert.equal(result.items[0].deliveryState, 'delivered');
  assert.deepEqual(result.items[1].missingVariants, ['playlist']);
  assert.equal(result.health.loose, 1);
});

test('parseSkillSections chia frontmatter và các heading', () => {
  const sections = parseSkillSections([
    '---',
    'name: "demo"',
    '---',
    '',
    '# Kênh Demo',
    '',
    'Mở đầu.',
    '',
    '## Art direction',
    '',
    'Nội dung.',
  ].join('\n'));
  assert.deepEqual(sections.map((section) => section.title), [
    'Frontmatter',
    'Kênh Demo',
    'Art direction',
  ]);
  assert.match(sections[2].content, /Nội dung/);
});

test('saveSkillDocument tạo backup và chặn ghi đè phiên bản mới', async (t) => {
  const root = await fixture(t);
  const skillsRoot = path.join(root, 'skills');
  const skillPath = path.join(skillsRoot, 'tao-anh-demo', 'SKILL.md');
  const backupsRoot = path.join(root, 'backups');
  await fs.mkdir(path.dirname(skillPath), { recursive: true });
  await fs.writeFile(skillPath, '---\nname: demo\n---\n\n# Demo\nNội dung cũ.\n', 'utf8');
  const current = await readSkillDocument(skillPath, skillsRoot);
  const saved = await saveSkillDocument({
    skillPath,
    skillsRoot,
    backupsRoot,
    expectedSha256: current.sha256,
    content: current.content.replace('cũ', 'mới'),
  });
  assert.match(saved.content, /Nội dung mới/);
  assert.match(await fs.readFile(saved.backupPath, 'utf8'), /Nội dung cũ/);
  await assert.rejects(
    saveSkillDocument({
      skillPath,
      skillsRoot,
      backupsRoot,
      expectedSha256: current.sha256,
      content: saved.content,
    }),
    (error) => error instanceof ReviewerDomainError && error.code === 'skill_changed',
  );
});

test('renumber dùng kế hoạch an toàn và Undo khôi phục file lẫn metadata', async (t) => {
  const root = await fixture(t);
  const albumPath = path.join(root, 'Album');
  await fs.mkdir(albumPath);
  await writeItem(albumPath, '0001', 'Một');
  await writeItem(albumPath, '0003', 'Ba');
  await writeItem(albumPath, '0004', 'Bốn');
  const album = await scanAlbum(albumPath, { expectedVariants: ['background', 'playlist'] });
  const selected = album.items.filter((item) => ['0003', '0004'].includes(item.id));
  const plan = planRenumber({
    album,
    itemKeys: selected.map((item) => item.key),
    mode: 'compact',
    startAt: 2,
  });
  assert.equal(plan.conflicts.length, 0);
  const journal = await executeOperation(plan, {
    allowedRoot: root,
    journalDirectory: path.join(root, 'journal'),
  });
  assert.equal(await fs.readFile(path.join(albumPath, '0002 — Ba (background).png'), 'utf8'), '0003-background');
  const metadata = JSON.parse(await fs.readFile(
    path.join(albumPath, '_metadata', '0002 — Ba (item).json'),
    'utf8',
  ));
  assert.equal(metadata.id, '0002');

  await undoOperation(journal, { allowedRoot: root });
  assert.equal(await fs.readFile(path.join(albumPath, '0003 — Ba (background).png'), 'utf8'), '0003-background');
  const restored = JSON.parse(await fs.readFile(
    path.join(albumPath, '_metadata', '0003 — Ba (item).json'),
    'utf8',
  ));
  assert.equal(restored.id, '0003');
});

test('move bundle sang album khác tự nối số và reset delivery có provenance', async (t) => {
  const root = await fixture(t);
  const sourcePath = path.join(root, 'Nguồn');
  const targetPath = path.join(root, 'Đích');
  await fs.mkdir(sourcePath);
  await fs.mkdir(targetPath);
  await writeItem(sourcePath, '0007', 'Bảy');
  await writeItem(targetPath, '0010', 'Mười', ['playlist']);
  const source = await scanAlbum(sourcePath, { expectedVariants: ['background', 'playlist'] });
  const target = await scanAlbum(targetPath, { expectedVariants: ['image'] });
  const plan = planMove({
    sourceAlbum: source,
    targetAlbum: target,
    itemKeys: [source.items[0].key],
    mode: 'append',
  });
  assert.equal(plan.assignments[0].newId, '0011');
  const journal = await executeOperation(plan, { allowedRoot: root });
  const metadata = JSON.parse(await fs.readFile(
    path.join(targetPath, '_metadata', '0011 — Bảy (item).json'),
    'utf8',
  ));
  assert.equal(metadata.channel, 'Đích');
  assert.equal(metadata.delivery.status, 'pending');
  assert.equal(metadata.previousDelivery.messageId, 'message-0007');
  await undoOperation(journal, { allowedRoot: root });
  assert.equal((await scanAlbum(sourcePath)).items[0].id, '0007');
});

test('trash giữ bundle để hoàn tác', async (t) => {
  const root = await fixture(t);
  const albumPath = path.join(root, 'Album');
  await fs.mkdir(albumPath);
  await writeItem(albumPath, '0001', 'Một');
  const album = await scanAlbum(albumPath);
  const plan = planTrash({ album, itemKeys: [album.items[0].key] });
  const journal = await executeOperation(plan, { allowedRoot: root });
  assert.equal((await scanAlbum(albumPath)).items.length, 0);
  await undoOperation(journal, { allowedRoot: root });
  assert.equal((await scanAlbum(albumPath)).items.length, 1);
});
