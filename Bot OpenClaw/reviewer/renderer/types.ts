export type VariantKind = string;

export interface FileVariant {
  kind: VariantKind;
  label: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  mtimeMs: number;
  url?: string;
}

export interface MediaItem {
  key: string;
  id: string | null;
  order: number | null;
  title: string;
  numbered: boolean;
  variants: FileVariant[];
  coverPath: string | null;
  coverUrl?: string | null;
  metadataPath: string | null;
  metadataName: string | null;
  metadata?: Record<string, unknown> | null;
  metadataError?: string | null;
  metadataRaw?: string | null;
  deliveryState: 'delivered' | 'pending' | 'unknown';
  missingVariants: string[];
  latestMtimeMs: number;
  size: number;
}

export interface AlbumHealth {
  total: number;
  numbered: number;
  loose: number;
  missing: number;
  metadataErrors: number;
  pendingDelivery: number;
  newCount: number;
}

export interface Album {
  id: string;
  name: string;
  path: string;
  expectedVariants: string[];
  health: AlbumHealth;
  coverPath: string | null;
  coverUrl?: string | null;
  maxOrder: number;
  idWidth: number;
  latestMtimeMs: number;
  skillId: string | null;
  skillName: string | null;
  skillPath: string | null;
  skillDescription: string;
  controlChannelId: string | null;
  deliveryChannelId: string | null;
  deliveryChannelName: string | null;
  configured: boolean;
  scanError?: string;
}

export interface Channel {
  id: string;
  name: string;
  parentId: string | null;
}

export interface SkillSection {
  id: string;
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  content: string;
}

export interface SkillDocument {
  path: string;
  content: string;
  sections: SkillSection[];
  mtimeMs: number;
  sha256: string;
  backupPath?: string;
}

export interface OperationMove {
  sourcePath: string;
  destinationPath: string;
  isMetadata: boolean;
  itemKey: string;
  oldId: string | null;
  newId: string | null;
}

export interface OperationPlan {
  id: string;
  kind: 'renumber' | 'move' | 'trash';
  createdAt: string;
  sourceAlbum: Pick<Album, 'id' | 'name' | 'path'>;
  targetAlbum: Pick<Album, 'id' | 'name' | 'path'>;
  assignments: Array<{ key: string; title: string; oldId: string | null; newId: string | null; newOrder?: number }>;
  moves: OperationMove[];
  metadataUpdates: Array<{ originalPath: string; destinationPath: string; originalContent: string | null; newContent: string | null }>;
  conflicts: Array<{ type: string; path: string }>;
  completedAt?: string;
  journalPath?: string | null;
  status?: string;
}

export interface ReviewerJob {
  id: string;
  channelId: string;
  status: string;
  backendModel?: string | null;
  createdAt: string;
  startedAt?: number | null;
  updatedAt: string;
  lastActivityAt?: string;
  lastEvent?: string;
  terminalReason?: string;
  responseSent?: boolean;
  responseText?: string;
  streamPreview?: string;
  tasks: Array<{ taskId?: string; label?: string; status?: string; progressSummary?: string }>;
  artifacts: Array<{ id?: string; label?: string; status?: string; order?: number; extension?: string; size?: number }>;
}

export interface ReviewerApi {
  bootstrap: () => Promise<{ settings: Record<string, unknown>; albums: Album[]; channels: Channel[] }>;
  refresh: () => Promise<{ albums: Album[]; channels: Channel[] }>;
  items: (albumId: string) => Promise<MediaItem[]>;
  readSkill: (albumId: string) => Promise<SkillDocument | null>;
  skillHistory: (albumId: string) => Promise<Array<{ path: string; name: string; mtimeMs: number; size: number }>>;
  saveSkill: (payload: { albumId: string; content: string; expectedSha256: string }) => Promise<SkillDocument>;
  previewOperation: (payload: Record<string, unknown>) => Promise<OperationPlan>;
  executeOperation: (plan: OperationPlan) => Promise<OperationPlan>;
  undoOperation: (journalPath: string) => Promise<OperationPlan>;
  updateSettings: (patch: Record<string, unknown>) => Promise<{ settings: Record<string, unknown>; albums: Album[] }>;
  channels: () => Promise<Channel[]>;
  jobs: () => Promise<{ jobs: ReviewerJob[] }>;
  submitCommand: (payload: Record<string, unknown>) => Promise<{ job: ReviewerJob }>;
  stopJob: (jobId: string) => Promise<{ job: ReviewerJob }>;
  resumeJob: (jobId: string) => Promise<{ job: ReviewerJob }>;
  openPath: (filePath: string) => Promise<string>;
  revealPath: (filePath: string) => Promise<string>;
  copyPath: (filePath: string) => Promise<string>;
  chooseRoot: () => Promise<string | null>;
  onChanged: (callback: (payload: unknown) => void) => () => void;
  onJob: (callback: (payload: ReviewerJob) => void) => () => void;
}

declare global {
  interface Window {
    reviewer: ReviewerApi;
  }
}
