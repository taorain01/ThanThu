'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('reviewer', Object.freeze({
  bootstrap: () => invoke('reviewer:bootstrap'),
  refresh: () => invoke('reviewer:refresh'),
  items: (albumId) => invoke('reviewer:items', albumId),
  readSkill: (albumId) => invoke('reviewer:skill', albumId),
  skillHistory: (albumId) => invoke('reviewer:skill-history', albumId),
  saveSkill: (payload) => invoke('reviewer:save-skill', payload),
  previewOperation: (payload) => invoke('reviewer:preview-operation', payload),
  executeOperation: (plan) => invoke('reviewer:execute-operation', plan),
  undoOperation: (journalPath) => invoke('reviewer:undo-operation', journalPath),
  updateSettings: (patch) => invoke('reviewer:settings', patch),
  channels: () => invoke('reviewer:channels'),
  jobs: () => invoke('reviewer:jobs'),
  submitCommand: (payload) => invoke('reviewer:submit-command', payload),
  stopJob: (jobId) => invoke('reviewer:stop-job', jobId),
  resumeJob: (jobId) => invoke('reviewer:resume-job', jobId),
  openPath: (filePath) => invoke('reviewer:open-path', filePath),
  revealPath: (filePath) => invoke('reviewer:reveal-path', filePath),
  copyPath: (filePath) => invoke('reviewer:copy-path', filePath),
  chooseRoot: () => invoke('reviewer:choose-root'),
  onChanged: (callback) => subscribe('reviewer:changed', callback),
  onJob: (callback) => subscribe('reviewer:job', callback),
}));
