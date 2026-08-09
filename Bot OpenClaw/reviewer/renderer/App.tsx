import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView, keymap } from '@codemirror/view';
import { diffLines } from 'diff';
import ReactMarkdown from 'react-markdown';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  Album,
  Channel,
  MediaItem,
  OperationPlan,
  ReviewerJob,
  SkillDocument,
  SkillSection,
} from './types';

type InspectorTab = 'inspect' | 'skill' | 'command';
type OperationKind = 'move' | 'renumber' | 'trash';

interface OperationDialogState {
  kind: OperationKind;
  targetAlbumId: string;
  itemKeys: string[];
}

function formatBytes(value: number) {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatTime(value: number) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(value);
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: 'Đang chờ',
    running: 'Đang chạy',
    background: 'Worker nền',
    recovering: 'Đang khôi phục',
    stopping: 'Đang dừng',
    completed: 'Hoàn tất',
    failed: 'Lỗi',
    stopped: 'Đã dừng',
    completed_with_blocker: 'Có blocker',
  };
  return labels[status] || status;
}

function useFreshData(activeAlbumId: string | null, onError: (message: string) => void) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [jobs, setJobs] = useState<ReviewerJob[]>([]);
  const activeAlbumRef = useRef(activeAlbumId);

  useEffect(() => {
    activeAlbumRef.current = activeAlbumId;
  }, [activeAlbumId]);

  const reload = async () => {
    try {
      const result = await window.reviewer.refresh();
      setAlbums(result.albums);
      setChannels(result.channels);
      if (activeAlbumRef.current) setItems(await window.reviewer.items(activeAlbumRef.current));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không tải được dữ liệu album.');
    }
  };

  useEffect(() => {
    let alive = true;
    const start = async () => {
      try {
        const result = await window.reviewer.bootstrap();
        if (!alive) return;
        setAlbums(result.albums);
        setChannels(result.channels);
        if (result.albums[0]) setItems(await window.reviewer.items(activeAlbumId || result.albums[0].id));
        const jobResult = await window.reviewer.jobs().catch(() => ({ jobs: [] }));
        if (alive) setJobs(jobResult.jobs);
      } catch (error) {
        if (alive) onError(error instanceof Error ? error.message : 'Không khởi động được Reviewer.');
      }
    };
    start();
    const unsubscribeChanged = window.reviewer.onChanged(() => { void reload(); });
    const unsubscribeJob = window.reviewer.onJob((job) => {
      setJobs((current) => {
        const remaining = current.filter((candidate) => candidate.id !== job.id);
        return [job, ...remaining].slice(0, 50);
      });
    });
    const timer = window.setInterval(async () => {
      const result = await window.reviewer.jobs().catch(() => null);
      if (alive && result) setJobs(result.jobs);
    }, 3000);
    return () => {
      alive = false;
      unsubscribeChanged();
      unsubscribeJob();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!activeAlbumId) return;
    window.reviewer.items(activeAlbumId).then(setItems).catch((error) => onError(error.message));
  }, [activeAlbumId]);

  return { albums, setAlbums, channels, setChannels, items, setItems, jobs, setJobs, reload };
}

export default function App() {
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [tab, setTab] = useState<InspectorTab>('inspect');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('order');
  const [tileSize, setTileSize] = useState(220);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemKey: string } | null>(null);
  const [operationDialog, setOperationDialog] = useState<OperationDialogState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; action?: () => void } | null>(null);
  const [error, setError] = useState('');
  const [lastJournal, setLastJournal] = useState<string | null>(null);

  const data = useFreshData(activeAlbumId, setError);
  const activeAlbum = data.albums.find((album) => album.id === activeAlbumId) || data.albums[0] || null;
  const activeItem = data.items.find((item) => item.key === activeItemKey) || data.items.find((item) => selectedKeys.includes(item.key)) || null;

  useEffect(() => {
    if (!activeAlbumId && data.albums[0]) setActiveAlbumId(data.albums[0].id);
    if (activeAlbumId && !data.albums.some((album) => album.id === activeAlbumId)) setActiveAlbumId(data.albums[0]?.id || null);
  }, [data.albums, activeAlbumId]);

  useEffect(() => {
    if (data.items.length && !activeItemKey) setActiveItemKey(data.items[0].key);
    if (activeItemKey && !data.items.some((item) => item.key === activeItemKey)) setActiveItemKey(data.items[0]?.key || null);
  }, [data.items, activeItemKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const result = data.items.filter((item) => {
      if (needle && ![item.id, item.title, ...item.variants.map((variant) => variant.kind), JSON.stringify(item.metadata || {})]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)) return false;
      if (filter === 'new' && item.latestMtimeMs < Date.now() - 24 * 60 * 60 * 1000) return false;
      if (filter === 'missing' && item.missingVariants.length === 0) return false;
      if (filter === 'pending' && item.deliveryState !== 'pending') return false;
      if (filter === 'loose' && item.numbered) return false;
      return true;
    });
    return result.sort((left, right) => {
      if (sort === 'latest') return right.latestMtimeMs - left.latestMtimeMs;
      if (sort === 'size') return right.size - left.size;
      if (sort === 'title') return left.title.localeCompare(right.title, 'vi');
      return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
    });
  }, [data.items, search, filter, sort]);

  const selectItem = (item: MediaItem, event: React.MouseEvent) => {
    const index = visibleItems.findIndex((candidate) => candidate.key === item.key);
    if (event.shiftKey && activeItemKey) {
      const anchor = visibleItems.findIndex((candidate) => candidate.key === activeItemKey);
      const [start, end] = [Math.min(anchor, index), Math.max(anchor, index)];
      setSelectedKeys(visibleItems.slice(start, end + 1).map((candidate) => candidate.key));
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedKeys((current) => current.includes(item.key) ? current.filter((key) => key !== item.key) : [...current, item.key]);
    } else {
      setSelectedKeys([item.key]);
    }
    setActiveItemKey(item.key);
    setContextMenu(null);
  };

  const openOperation = (kind: OperationKind, itemKeys = selectedKeys, targetAlbumId = activeAlbum?.id || '') => {
    if (!itemKeys.length) {
      setToast({ message: 'Hãy chọn ít nhất một item trước.' });
      return;
    }
    setOperationDialog({ kind, targetAlbumId, itemKeys });
    setContextMenu(null);
  };

  const onOperationDone = async (journal: OperationPlan, compactAfter: boolean) => {
    setLastJournal(journal.journalPath || null);
    setSelectedKeys([]);
    setActiveItemKey(null);
    await data.reload();
    if (compactAfter && activeAlbum) {
      const refreshed = await window.reviewer.items(activeAlbum.id);
      const keys = refreshed.filter((item) => item.numbered).map((item) => item.key);
      const compactPlan = await window.reviewer.previewOperation({ kind: 'renumber', albumId: activeAlbum.id, itemKeys: keys, mode: 'compact', startAt: 1 });
      if (!compactPlan.conflicts.length && compactPlan.moves.length) {
        await window.reviewer.executeOperation(compactPlan);
        await data.reload();
      }
    }
    setToast({
      message: journal.kind === 'trash' ? 'Đã đưa bundle vào thùng rác.' : 'Đã áp dụng thay đổi an toàn.',
      action: journal.journalPath ? async () => {
        await window.reviewer.undoOperation(journal.journalPath!);
        await data.reload();
        setToast({ message: 'Đã hoàn tác.' });
      } : undefined,
    });
    setOperationDialog(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.closest('.cm-editor, input, textarea, [contenteditable="true"]'));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !editing) {
        event.preventDefault();
        setSelectedKeys(visibleItems.map((item) => item.key));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape') {
        setContextMenu(null);
        setPaletteOpen(false);
        if (operationDialog) setOperationDialog(null);
        else setToast(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visibleItems, operationDialog]);

  if (!window.reviewer) {
    return <div className="fatal-screen"><div className="fatal-card"><span className="eyebrow">DESKTOP SHELL</span><h1>Mở app bằng Electron</h1><p>Renderer này cần chạy trong OpenClaw Gallery Studio, không mở trực tiếp bằng trình duyệt.</p></div></div>;
  }

  return (
    <main className="app-shell" onContextMenu={(event) => event.preventDefault()}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">OC</div>
          <div><span className="eyebrow">OPENCLAW / STUDIO</span><h1>Gallery desk</h1></div>
        </div>
        <div className="topbar-center">
          <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm ID, title, variant, metadata…" /><kbd>Ctrl K</kbd></div>
          <div className="connection-pill"><i className="status-dot" /> local workspace <span>•</span> {activeAlbum?.name || 'đang tải'}</div>
        </div>
        <div className="top-actions"><button className="icon-button" title="Làm mới" onClick={() => data.reload()}>↻</button><button className="avatar-button">{initials('Gallery')}</button></div>
      </header>

      <section className="workspace">
        <AlbumRail albums={data.albums} activeAlbumId={activeAlbum?.id || null} jobs={data.jobs} onSelect={(id) => { setActiveAlbumId(id); setSelectedKeys([]); setActiveItemKey(null); setTab('inspect'); }} onDrop={(itemKeys, targetAlbumId) => openOperation('move', itemKeys, targetAlbumId)} onChooseRoot={async () => { await window.reviewer.chooseRoot(); await data.reload(); }} />
        <section className="gallery-column">
          <GalleryToolbar album={activeAlbum} count={visibleItems.length} total={data.items.length} filter={filter} sort={sort} tileSize={tileSize} selectedCount={selectedKeys.length} onFilter={setFilter} onSort={setSort} onTileSize={setTileSize} onAction={(kind) => openOperation(kind)} />
          {activeAlbum && visibleItems.length ? <Gallery items={visibleItems} tileSize={tileSize} selectedKeys={selectedKeys} activeKey={activeItemKey} onSelect={selectItem} onOpen={(item) => { setActiveItemKey(item.key); setTab('inspect'); }} onContext={(item, event) => { event.preventDefault(); setActiveItemKey(item.key); if (!selectedKeys.includes(item.key)) setSelectedKeys([item.key]); setContextMenu({ x: event.clientX, y: event.clientY, itemKey: item.key }); }} onDragStart={(item, event) => { const keys = selectedKeys.includes(item.key) ? selectedKeys : [item.key]; event.dataTransfer.setData('application/x-openclaw-items', JSON.stringify(keys)); event.dataTransfer.effectAllowed = 'move'; }} /> : <EmptyState album={activeAlbum} onCommand={() => setTab('command')} />}
          {error && <div className="error-strip"><strong>Không thể cập nhật:</strong> {error}<button onClick={() => setError('')}>Đóng</button></div>}
        </section>
        <Inspector album={activeAlbum} item={activeItem} tab={tab} onTab={setTab} channels={data.channels} jobs={data.jobs} onSelectChannel={async (channelId) => { if (!activeAlbum) return; const result = await window.reviewer.updateSettings({ channelMap: { [activeAlbum.id]: { controlChannelId: channelId } } }); data.setAlbums(result.albums); }} onAction={(kind) => openOperation(kind)} onReload={() => data.reload()} />
      </section>

      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} onMove={() => openOperation('move', selectedKeys)} onNumber={() => openOperation('renumber', selectedKeys)} onTrash={() => openOperation('trash', selectedKeys)} onReveal={() => { const item = data.items.find((candidate) => candidate.key === contextMenu.itemKey); if (item?.coverPath) void window.reviewer.revealPath(item.coverPath); setContextMenu(null); }} onCopy={() => { const item = data.items.find((candidate) => candidate.key === contextMenu.itemKey); if (item?.coverPath) void window.reviewer.copyPath(item.coverPath); setContextMenu(null); }} />}
      {operationDialog && <OperationDialog state={operationDialog} albums={data.albums} currentAlbum={activeAlbum} onClose={() => setOperationDialog(null)} onDone={onOperationDone} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onAction={(action) => { setPaletteOpen(false); if (action === 'move') openOperation('move'); if (action === 'number') openOperation('renumber'); if (action === 'trash') openOperation('trash'); if (action === 'command') setTab('command'); if (action === 'skill') setTab('skill'); }} />}
      {toast && <div className="toast"><span>{toast.message}</span>{toast.action && <button onClick={() => { void toast.action?.(); setToast(null); }}>Hoàn tác</button>}</div>}
      {lastJournal && <span className="sr-only">Last operation {lastJournal}</span>}
    </main>
  );
}

function AlbumRail({ albums, activeAlbumId, jobs, onSelect, onDrop, onChooseRoot }: { albums: Album[]; activeAlbumId: string | null; jobs: ReviewerJob[]; onSelect: (id: string) => void; onDrop: (keys: string[], targetAlbumId: string) => void; onChooseRoot: () => void }) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  return <aside className="album-rail"><div className="rail-heading"><span className="eyebrow">ALBUMS</span><span className="count-badge">{albums.length}</span></div><div className="rail-scroll">{albums.map((album) => { const activeJob = jobs.find((job) => job.channelId === album.controlChannelId && !['completed', 'failed', 'stopped'].includes(job.status)); return <button key={album.id} className={`album-row ${activeAlbumId === album.id ? 'is-active' : ''} ${dragOver === album.id ? 'is-drop-target' : ''}`} onClick={() => onSelect(album.id)} onDragOver={(event) => { event.preventDefault(); setDragOver(album.id); }} onDragLeave={() => setDragOver(null)} onDrop={(event) => { event.preventDefault(); setDragOver(null); try { onDrop(JSON.parse(event.dataTransfer.getData('application/x-openclaw-items')), album.id); } catch { /* ignore */ } }}><span className="album-cover">{album.coverUrl ? <img src={album.coverUrl} alt="" /> : <span>{initials(album.name)}</span>}{album.health.newCount > 0 && <i className="new-dot" />}</span><span className="album-copy"><strong>{album.name}</strong><small>{album.health.total} item · {album.skillName || 'chưa gắn skill'}</small></span><span className="album-health"><b>{album.health.missing || album.health.metadataErrors ? '!' : album.health.newCount || '·'}</b>{activeJob && <i className="job-spinner" />}</span></button>; })}</div><div className="rail-footer"><button className="text-button" onClick={onChooseRoot}>＋ Chọn thư mục khác</button><div className="shortcut-note"><kbd>Ctrl K</kbd><span>command palette</span></div></div></aside>;
}

function GalleryToolbar({ album, count, total, filter, sort, tileSize, selectedCount, onFilter, onSort, onTileSize, onAction }: { album: Album | null; count: number; total: number; filter: string; sort: string; tileSize: number; selectedCount: number; onFilter: (value: string) => void; onSort: (value: string) => void; onTileSize: (value: number) => void; onAction: (kind: OperationKind) => void }) {
  return <div className="gallery-toolbar"><div className="toolbar-title"><span className="eyebrow">{album?.skillName ? `SKILL / ${album.skillName}` : 'LOCAL ALBUM'}</span><h2>{album?.name || 'Chưa chọn album'} <span>{count}/{total}</span></h2></div><div className="toolbar-controls"><div className="select-wrap"><span>Lọc</span><select value={filter} onChange={(event) => onFilter(event.target.value)}><option value="all">Tất cả</option><option value="new">Mới 24h</option><option value="missing">Thiếu cặp</option><option value="pending">Chưa gửi</option><option value="loose">Chưa đánh số</option></select></div><div className="select-wrap"><span>Sắp xếp</span><select value={sort} onChange={(event) => onSort(event.target.value)}><option value="order">Số thứ tự</option><option value="latest">Mới nhất</option><option value="title">Title A–Z</option><option value="size">Dung lượng</option></select></div><label className="range-control"><span>◐</span><input type="range" min="150" max="340" step="10" value={tileSize} onChange={(event) => onTileSize(Number(event.target.value))} /></label>{selectedCount > 0 && <div className="selection-actions"><span>{selectedCount} chọn</span><button onClick={() => onAction('move')}>Chuyển</button><button onClick={() => onAction('renumber')}>Đổi số</button><button className="danger-text" onClick={() => onAction('trash')}>Xóa</button></div>}</div></div>;
}

function Gallery({ items, tileSize, selectedKeys, activeKey, onSelect, onOpen, onContext, onDragStart }: { items: MediaItem[]; tileSize: number; selectedKeys: string[]; activeKey: string | null; onSelect: (item: MediaItem, event: React.MouseEvent) => void; onOpen: (item: MediaItem) => void; onContext: (item: MediaItem, event: React.MouseEvent) => void; onDragStart: (item: MediaItem, event: React.DragEvent) => void }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => { if (!parentRef.current) return; const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width)); observer.observe(parentRef.current); return () => observer.disconnect(); }, []);
  const columns = Math.max(1, Math.floor((width - 24) / (tileSize + 16)));
  const rows = Math.ceil(items.length / columns);
  const rowVirtualizer = useVirtualizer({ count: rows, getScrollElement: () => parentRef.current, estimateSize: () => tileSize * 0.76 + 116, overscan: 4 });
  return <div ref={parentRef} className="gallery-scroll"><div className="virtual-space" style={{ height: rowVirtualizer.getTotalSize() }}>{rowVirtualizer.getVirtualItems().map((row) => <div key={row.key} className="gallery-row" style={{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{items.slice(row.index * columns, row.index * columns + columns).map((item) => <MediaCard key={item.key} item={item} tileSize={tileSize} selected={selectedKeys.includes(item.key)} active={activeKey === item.key} onSelect={onSelect} onOpen={onOpen} onContext={onContext} onDragStart={onDragStart} />)}</div>)}</div></div>;
}

function MediaCard({ item, tileSize, selected, active, onSelect, onOpen, onContext, onDragStart }: { item: MediaItem; tileSize: number; selected: boolean; active: boolean; onSelect: (item: MediaItem, event: React.MouseEvent) => void; onOpen: (item: MediaItem) => void; onContext: (item: MediaItem, event: React.MouseEvent) => void; onDragStart: (item: MediaItem, event: React.DragEvent) => void }) {
  const cover = item.variants.find((variant) => variant.kind === 'background') || item.variants.find((variant) => variant.kind === 'playlist') || item.variants[0];
  return <article draggable className={`media-card ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''}`} style={{ '--tile': `${tileSize}px` } as React.CSSProperties} onDragStart={(event) => onDragStart(item, event)} onClick={(event) => onSelect(item, event)} onDoubleClick={() => onOpen(item)} onContextMenu={(event) => onContext(item, event)}><div className="card-image">{cover?.url ? <img loading="lazy" src={cover.url} alt={item.title} draggable={false} /> : <div className="image-placeholder">{initials(item.title)}</div>}<span className="index-chip">{item.id || '—'}</span><span className={`delivery-chip ${item.deliveryState}`}>{item.deliveryState === 'delivered' ? '✓' : item.deliveryState === 'pending' ? '◷' : '·'}</span>{item.missingVariants.length > 0 && <span className="missing-chip">thiếu {item.missingVariants.join(' + ')}</span>}<span className="drag-grip">⠿</span></div><div className="card-meta"><div><strong>{item.title || 'Chưa có title'}</strong><small>{item.variants.map((variant) => variant.kind).join(' · ')} <span>•</span> {formatBytes(item.size)}</small></div><button className="card-open" onClick={(event) => { event.stopPropagation(); onOpen(item); }}>↗</button></div></article>;
}

function Inspector({ album, item, tab, onTab, channels, jobs, onSelectChannel, onAction, onReload }: { album: Album | null; item: MediaItem | null; tab: InspectorTab; onTab: (tab: InspectorTab) => void; channels: Channel[]; jobs: ReviewerJob[]; onSelectChannel: (id: string) => void; onAction: (kind: OperationKind) => void; onReload: () => void }) {
  return <aside className="inspector"><div className="inspector-tabs"><button className={tab === 'inspect' ? 'active' : ''} onClick={() => onTab('inspect')}>Chi tiết</button><button className={tab === 'skill' ? 'active' : ''} onClick={() => onTab('skill')}>Skill <span>⌘</span></button><button className={tab === 'command' ? 'active' : ''} onClick={() => onTab('command')}>Ra lệnh <span>↗</span></button></div>{tab === 'inspect' && <InspectPanel album={album} item={item} channels={channels} jobs={jobs} onSelectChannel={onSelectChannel} onAction={onAction} />}{tab === 'skill' && <SkillEditor album={album} />}{tab === 'command' && <CommandDeck album={album} channels={channels} jobs={jobs} onReload={onReload} />}</aside>;
}

function InspectPanel({ album, item, channels, jobs, onSelectChannel, onAction }: { album: Album | null; item: MediaItem | null; channels: Channel[]; jobs: ReviewerJob[]; onSelectChannel: (id: string) => void; onAction: (kind: OperationKind) => void }) {
  const [variant, setVariant] = useState('');
  useEffect(() => setVariant(item?.variants[0]?.kind || ''), [item?.key]);
  const selectedVariant = item?.variants.find((candidate) => candidate.kind === variant) || item?.variants[0];
  const activeJob = jobs.find((job) => job.channelId === album?.controlChannelId && !['completed', 'failed', 'stopped'].includes(job.status));
  return <div className="inspector-scroll"><div className="inspect-hero">{selectedVariant?.url ? <img src={selectedVariant.url} alt="" /> : <div className="hero-empty">Chọn một ảnh</div>}<div className="hero-overlay"><span>{selectedVariant?.kind || 'preview'}</span><button onClick={() => selectedVariant?.path && void window.reviewer.openPath(selectedVariant.path)}>⛶</button></div></div>{item ? <><div className="inspector-title"><span className="eyebrow">ITEM / {item.id || 'LOOSE'}</span><h2>{item.title}</h2><p>{item.variants.length} variant <span>•</span> cập nhật {formatTime(item.latestMtimeMs)}</p></div><div className="variant-pills">{item.variants.map((candidate) => <button key={candidate.kind} className={candidate.kind === selectedVariant?.kind ? 'active' : ''} onClick={() => setVariant(candidate.kind)}>{candidate.kind}</button>)}</div><div className="inspect-actions"><button onClick={() => onAction('move')}>Chuyển album</button><button onClick={() => onAction('renumber')}>Đổi số</button><button className="subtle-danger" onClick={() => onAction('trash')}>Đưa vào rác</button></div><section className="info-section"><div className="section-label">METADATA</div>{item.metadataError ? <div className="warning-card">{item.metadataError}</div> : <pre className="metadata-preview">{JSON.stringify(item.metadata || {}, null, 2)}</pre>}</section><section className="info-section"><div className="section-label">FILES</div>{item.variants.map((candidate) => <button className="file-row" key={candidate.path} onClick={() => void window.reviewer.revealPath(candidate.path)}><span className="file-kind">{candidate.kind}</span><span className="file-name">{candidate.name}</span><span className="file-size">{formatBytes(candidate.size)}</span></button>)}</section></> : <EmptyInspector />}{album && <section className="info-section channel-section"><div className="section-label">CONTROL CHANNEL</div><select value={album.controlChannelId || ''} onChange={(event) => onSelectChannel(event.target.value)}><option value="">Chọn channel để ra lệnh…</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select><small>{activeJob ? `Job ${statusLabel(activeJob.status)} · ${activeJob.id}` : album.skillName || 'Chưa liên kết skill'}</small></section>}</div>;
}

function SkillEditor({ album }: { album: Album | null }) {
  const [document, setDocument] = useState<SkillDocument | null>(null);
  const [content, setContent] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [mode, setMode] = useState<'sections' | 'file' | 'preview'>('sections');
  const [saving, setSaving] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [history, setHistory] = useState<Array<{ path: string; name: string; mtimeMs: number; size: number }>>([]);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => {
    let alive = true;
    if (!album) return undefined;
    window.reviewer.readSkill(album.id).then((value) => {
      if (!alive || !value) return;
      setDocument(value);
      setContent(value.content);
      setSelectedSectionId(value.sections.find((section) => section.level === 2)?.id || value.sections[0]?.id || null);
    }).catch(() => {});
    window.reviewer.skillHistory(album.id).then((value) => {
      if (alive) setHistory(value);
    }).catch(() => {});
    return () => { alive = false; };
  }, [album?.id]);

  const dirty = Boolean(document && content !== document.content);
  const sections = document?.sections || [];
  const selectedSection = sections.find((section) => section.id === selectedSectionId) || null;
  const editorShortcuts = useMemo(() => keymap.of([{
    key: 'Mod-s',
    preventDefault: true,
    run: () => {
      if (dirty) setDiffOpen(true);
      return true;
    },
  }]), [dirty]);

  const focusSection = (section: SkillSection) => {
    setSelectedSectionId(section.id);
    setMode('sections');
    window.requestAnimationFrame(() => {
      const view = editorRef.current?.view;
      if (!view) return;
      const line = view.state.doc.line(Math.min(section.startLine, view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
    });
  };

  useEffect(() => {
    if (!diffOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDiffOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [diffOpen]);

  const save = async () => {
    if (!album || !document || !dirty) return;
    setSaving(true);
    try {
      const result = await window.reviewer.saveSkill({
        albumId: album.id,
        content,
        expectedSha256: document.sha256,
      });
      setDocument(result);
      setContent(result.content);
      setHistory(await window.reviewer.skillHistory(album.id));
      setDiffOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Không lưu được skill.');
    } finally {
      setSaving(false);
    }
  };

  if (!album?.skillPath) {
    return <div className="panel-empty"><span className="empty-glyph">⌘</span><h3>Chưa có skill</h3><p>Album này chưa được liên kết với thư mục skill hoạt động.</p></div>;
  }

  return <div className="skill-panel">
    <div className="skill-heading"><div><span className="eyebrow">SKILL / ACTIVE FILE</span><h2>{album.skillName || album.name}</h2><small>{album.skillPath}</small></div><span className={`dirty-pill ${dirty ? 'dirty' : ''}`}>{dirty ? 'Chưa lưu' : 'Đã đồng bộ'}</span></div>
    <div className="skill-tabs"><button className={mode === 'sections' ? 'active' : ''} onClick={() => setMode('sections')}>Sections</button><button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>Toàn file</button><button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>Preview</button><button className="save-skill" disabled={!dirty || saving} onClick={() => setDiffOpen(true)}>{saving ? 'Đang lưu…' : 'Lưu skill'}</button></div>
    {mode === 'preview' ? <div className="markdown-preview"><ReactMarkdown>{content}</ReactMarkdown></div> : <div className="skill-editor-layout">
      {mode === 'sections' && <nav className="section-outline">{sections.map((section) => <button key={section.id} className={`${selectedSectionId === section.id ? 'active' : ''} level-${section.level}`} onClick={() => focusSection(section)}><span>{String(section.startLine).padStart(3, '0')}</span>{section.title}</button>)}<div className="history-mini"><div className="section-label">BACKUP HISTORY</div>{history.slice(0, 4).map((entry) => <small key={entry.path}>{entry.name.replace('.SKILL.md', '')}</small>)}</div></nav>}
      <div className="skill-code"><div className="editor-caption"><span>{mode === 'sections' ? selectedSection?.title || 'Chọn một section' : 'SKILL.md'}</span><span>{content.split('\n').length} dòng · UTF-8</span></div><CodeMirror ref={editorRef} value={content} height="calc(100vh - 250px)" extensions={[markdown(), EditorView.lineWrapping, editorShortcuts]} onChange={(value) => setContent(value)} theme="dark" basicSetup={{ lineNumbers: true, foldGutter: true, searchKeymap: true }} /></div>
    </div>}
    {diffOpen && <DiffModal original={document?.content || ''} next={content} onClose={() => setDiffOpen(false)} onConfirm={save} />}
  </div>;
}

function DiffModal({ original, next, onClose, onConfirm }: { original: string; next: string; onClose: () => void; onConfirm: () => void }) {
  const parts = diffLines(original, next);
  return <div className="modal-scrim" role="presentation"><div className="modal-card diff-modal"><div className="modal-header"><div><span className="eyebrow">REVIEW CHANGES</span><h2>Diff trước khi lưu</h2></div><button className="close-button" onClick={onClose}>×</button></div><div className="diff-view">{parts.map((part, index) => <pre key={`${index}-${part.value.slice(0, 10)}`} className={part.added ? 'added' : part.removed ? 'removed' : ''}>{part.value}</pre>)}</div><div className="modal-actions"><button className="ghost-button" onClick={onClose}>Tiếp tục sửa</button><button className="primary-button" onClick={onConfirm}>Lưu bản backup + áp dụng</button></div></div></div>;
}

function CommandDeck({ album, channels, jobs, onReload }: { album: Album | null; channels: Channel[]; jobs: ReviewerJob[]; onReload: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [channelId, setChannelId] = useState(album?.controlChannelId || '');
  const [sending, setSending] = useState(false);
  useEffect(() => setChannelId(album?.controlChannelId || ''), [album?.id, album?.controlChannelId]);
  const albumJobs = jobs.filter((job) => job.channelId === (channelId || album?.controlChannelId));
  const submit = async () => {
    if (!album || !prompt.trim() || !channelId || sending) return;
    setSending(true);
    try {
      await window.reviewer.submitCommand({ albumId: album.id, channelId, text: prompt });
      setPrompt('');
      onReload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Không gửi được lệnh.');
    } finally {
      setSending(false);
    }
  };
  const templates = [
    ['Tạo tiếp', `Tạo tiếp 1 item mới cho ${album?.name || 'album này'}, bắt đầu từ số tiếp theo còn thiếu. Chạy đủ generate, QC, metadata và delivery; chỉ báo hoàn tất khi file final đã xuất hiện.`],
    ['Bổ sung cặp', `Kiểm tra album ${album?.name || ''} và tạo các variant còn thiếu cho những ID đã có. Giữ nguyên title, checkpoint và không tạo lại file đã PASS.`],
    ['Tiếp checkpoint', `Đọc checkpoint và metadata gần nhất của ${album?.name || ''}, tiếp tục job dang dở an toàn từ bước cuối đã xác minh. Không chạy lại artifact đã hoàn tất.`],
  ];
  return <div className="command-panel">
    <div className="command-heading"><span className="eyebrow">COMMAND DECK</span><h2>Ra lệnh cho {album?.name || 'album'}</h2><p>Prompt sẽ đi qua session OpenClaw của control channel đã chọn.</p></div>
    <div className="command-channel"><label>Control channel<select value={channelId} onChange={(event) => setChannelId(event.target.value)}><option value="">Chọn channel…</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label><span className="channel-state">{channelId ? 'SESSION LINKED' : 'CẦN CHỌN'}</span></div>
    <div className="template-row">{templates.map(([label, value]) => <button key={label} onClick={() => setPrompt(value)}>{label}<span>↗</span></button>)}</div>
    <div className="prompt-editor"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit(); } }} placeholder="Viết lệnh tự do cho OpenClaw…" spellCheck={false} /><div className="prompt-footer"><span><kbd>Ctrl ↵</kbd> gửi lệnh</span><button className="primary-button" disabled={!prompt.trim() || !channelId || sending} onClick={() => void submit()}>{sending ? 'Đang xếp job…' : 'Gửi vào session  ↗'}</button></div></div>
    <section className="job-section"><div className="section-label">JOB GẦN ĐÂY / {album?.name || ''}</div>{albumJobs.length ? albumJobs.slice(0, 6).map((job) => <JobRow key={job.id} job={job} />) : <div className="job-empty">Chưa có job nào từ Gallery Studio.</div>}</section>
  </div>;
}

function JobRow({ job }: { job: ReviewerJob }) {
  const [busy, setBusy] = useState(false);
  const active = !['completed', 'failed', 'stopped', 'completed_with_blocker'].includes(job.status);
  const resumeable = ['failed', 'stopped', 'completed_with_blocker'].includes(job.status);
  const action = async () => {
    setBusy(true);
    try {
      if (active) await window.reviewer.stopJob(job.id);
      else if (resumeable) await window.reviewer.resumeJob(job.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Không cập nhật được job.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="job-row"><span className={`job-status ${active ? 'active' : job.status === 'failed' ? 'error' : 'done'}`}>{active ? '◌' : job.status === 'failed' ? '!' : '✓'}</span><div><strong>{statusLabel(job.status)}</strong><small>{job.streamPreview || job.lastEvent || job.responseText || job.id}</small></div><span className="job-time">{formatTime(Date.parse(job.updatedAt))}</span>{(active || resumeable) && <button className="job-action" disabled={busy} onClick={() => void action()}>{busy ? '…' : active ? 'Dừng' : 'Tiếp tục'}</button>}</div>;
}

function ContextMenu({ x, y, onMove, onNumber, onTrash, onReveal, onCopy }: { x: number; y: number; onMove: () => void; onNumber: () => void; onTrash: () => void; onReveal: () => void; onCopy: () => void }) {
  return <div className="context-menu" style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 300) }}><button onClick={onMove}><span>⇥</span> Chuyển sang album…</button><button onClick={onNumber}><span>↯</span> Đổi số thứ tự</button><div className="menu-divider" /><button onClick={onReveal}><span>⌁</span> Mở trong Explorer</button><button onClick={onCopy}><span>⧉</span> Sao chép đường dẫn</button><div className="menu-divider" /><button className="danger-text" onClick={onTrash}><span>⌫</span> Đưa vào thùng rác</button></div>;
}

function OperationDialog({ state, albums, currentAlbum, onClose, onDone }: { state: OperationDialogState; albums: Album[]; currentAlbum: Album | null; onClose: () => void; onDone: (journal: OperationPlan, compactAfter: boolean) => void }) {
  const [targetAlbumId, setTargetAlbumId] = useState(state.targetAlbumId || albums[0]?.id || '');
  const [mode, setMode] = useState(state.kind === 'move' ? 'append' : 'compact');
  const [startAt, setStartAt] = useState('1');
  const [compactAfter, setCompactAfter] = useState(false);
  const [plan, setPlan] = useState<OperationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const target = albums.find((album) => album.id === targetAlbumId) || currentAlbum;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.reviewer.previewOperation({ kind: state.kind, albumId: currentAlbum?.id, targetAlbumId, itemKeys: state.itemKeys, mode, startAt: Number(startAt) || 1 }).then((value) => { if (alive) setPlan(value); }).catch((error) => { if (alive) setPlan({ id: '', kind: state.kind, createdAt: '', sourceAlbum: { id: '', name: '', path: '' }, targetAlbum: { id: '', name: '', path: '' }, assignments: [], moves: [], metadataUpdates: [], conflicts: [{ type: 'error', path: error.message }] }); }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [state.kind, state.itemKeys.join('|'), currentAlbum?.id, targetAlbumId, mode, startAt]);
  const isTrash = state.kind === 'trash';
  const confirm = async () => {
    if (!plan || plan.conflicts.length || loading) return;
    setLoading(true);
    try { const journal = await window.reviewer.executeOperation(plan); onDone(journal, compactAfter); }
    catch (error) { window.alert(error instanceof Error ? error.message : 'Không thực hiện được thao tác.'); setLoading(false); }
  };
  return <div className="modal-scrim operation-scrim" role="presentation"><div className="modal-card operation-modal"><div className="modal-header"><div><span className="eyebrow">{isTrash ? 'SAFE DELETE' : 'BATCH OPERATION'}</span><h2>{isTrash ? 'Đưa bundle vào thùng rác' : state.kind === 'move' ? 'Chuyển sang album khác' : 'Đổi số thứ tự'}</h2><p>{state.itemKeys.length} item được chọn · xem trước trước khi ghi file</p></div><button className="close-button" onClick={onClose}>×</button></div>{!isTrash && <div className="operation-options">{state.kind === 'move' && <label>Album đích<select value={targetAlbumId} onChange={(event) => setTargetAlbumId(event.target.value)}>{albums.map((album) => <option key={album.id} value={album.id}>{album.name}</option>)}</select></label>}<label>Chiến lược đánh số<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="append">Nối tiếp sau số lớn nhất</option><option value="fill">Điền số trống</option><option value="compact">Lấp khoảng trống từ đầu</option><option value="start">Bắt đầu từ số chỉ định</option></select></label>{mode === 'start' && <label>Số bắt đầu<input type="number" min="1" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>}</div>}{isTrash && <label className="check-row"><input type="checkbox" checked={compactAfter} onChange={(event) => setCompactAfter(event.target.checked)} /> Sau khi xóa, tự lấp khoảng trống toàn album</label>}<div className="operation-preview"><div className="preview-caption"><span>PREVIEW MAPPING</span><span>{loading ? 'Đang tính…' : `${plan?.moves.length || 0} file sẽ thay đổi`}</span></div>{plan?.conflicts.length ? <div className="conflict-card"><strong>Chưa thể thực hiện</strong>{plan.conflicts.map((conflict) => <div key={`${conflict.type}-${conflict.path}`}>{conflict.type}: {conflict.path}</div>)}</div> : <div className="mapping-list">{plan?.assignments.map((assignment) => <div key={assignment.key}><span>{assignment.oldId || '—'} <i>→</i> {assignment.newId || '—'}</span><strong>{assignment.title}</strong></div>)}</div>}</div><div className="modal-actions"><button className="ghost-button" onClick={onClose}>Hủy</button><button className={isTrash ? 'danger-button' : 'primary-button'} disabled={!plan || Boolean(plan.conflicts.length) || loading} onClick={confirm}>{loading ? 'Đang áp dụng…' : isTrash ? 'Đưa vào rác' : 'Xác nhận thay đổi'}</button></div></div></div>;
}

function CommandPalette({ onClose, onAction }: { onClose: () => void; onAction: (action: string) => void }) {
  const actions = [['move', 'Chuyển item đã chọn', '⇥'], ['number', 'Đổi số thứ tự', '↯'], ['trash', 'Đưa vào thùng rác', '⌫'], ['skill', 'Mở skill editor', '⌘'], ['command', 'Mở command deck', '↗']];
  return <div className="modal-scrim palette-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="palette-card"><div className="palette-search">⌕ <input autoFocus placeholder="Gõ để tìm thao tác…" /></div>{actions.map(([id, label, icon]) => <button key={id} onClick={() => onAction(id)}><span>{icon}</span><strong>{label}</strong><kbd>↵</kbd></button>)}</div></div>;
}

function EmptyState({ album, onCommand }: { album: Album | null; onCommand: () => void }) {
  return <div className="empty-state"><div className="empty-orbit"><span>OC</span></div><span className="eyebrow">NO FRAMES YET</span><h2>{album?.name || 'Chọn một album'}</h2><p>Thư mục này chưa có ảnh đúng quy ước. Bạn có thể ra lệnh cho OpenClaw tạo batch đầu tiên.</p><button className="primary-button" onClick={onCommand}>Mở command deck ↗</button></div>;
}

function EmptyInspector() {
  return <div className="panel-empty"><span className="empty-glyph">＋</span><h3>Chọn một item</h3><p>Click một card để xem preview, metadata và các thao tác nhanh.</p></div>;
}
