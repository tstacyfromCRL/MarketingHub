import { contextBridge, ipcRenderer } from 'electron';
import type { LibraryStatus } from '@mh/shared';

export interface ScanProgress {
  state: 'idle' | 'scanning' | 'busy' | 'error' | 'done';
  seen: number;
  uploaded: number;
  message?: string;
}

/** The only bridge between the UI and Node/the file system. */
const api = {
  session: {
    get: (): Promise<{ serverUrl: string; token: string | null }> => ipcRenderer.invoke('session:get'),
    set: (s: { serverUrl?: string; token?: string | null }): Promise<boolean> => ipcRenderer.invoke('session:set', s),
  },
  library: {
    /** Admin only: pick the network drive folder the whole team uses. */
    selectLocation: (name?: string): Promise<LibraryStatus & { cancelled?: boolean; error?: string }> => ipcRenderer.invoke('library:select', name),
    getLocation: (): Promise<{ status: LibraryStatus; machine: string }> => ipcRenderer.invoke('library:getLocation'),
    checkAccess: (): Promise<LibraryStatus> => ipcRenderer.invoke('library:checkAccess'),
    /** Pick files or folders inside the library drive. Nothing outside that drive is accepted. */
    importPaths: (kind: 'FOLDER' | 'FILE'): Promise<{ cancelled?: boolean; error?: string; warning?: string; imported: number }> =>
      ipcRenderer.invoke('library:import', kind),
    /** Moves files into a folder on the shared drive and updates the library index. */
    relocate: (folder: string, moves: { id: string; from: string; to: string }[]): Promise<{ error?: string }> =>
      ipcRenderer.invoke('library:relocate', folder, moves),
    scan: (force?: boolean): Promise<ScanProgress> => ipcRenderer.invoke('library:scan', force),
    scanProgress: (): Promise<ScanProgress> => ipcRenderer.invoke('library:scanProgress'),
    open: (relPath: string): Promise<void> => ipcRenderer.invoke('library:open', relPath),
    reveal: (relPath: string): Promise<void> => ipcRenderer.invoke('library:reveal', relPath),
    upload: (assetId: string, relPath: string): Promise<unknown> => ipcRenderer.invoke('library:upload', assetId, relPath),
    onProgress: (cb: (p: ScanProgress) => void) => {
      const listener = (_e: unknown, p: ScanProgress) => cb(p);
      ipcRenderer.on('library:progress', listener);
      return (): void => {
        ipcRenderer.removeListener('library:progress', listener);
      };
    },
  },
  app: {
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
    takeDeepLink: (): Promise<string | null> => ipcRenderer.invoke('app:takeDeepLink'),
    onNavigate: (cb: (route: string) => void) => {
      const listener = (_e: unknown, route: string) => cb(route);
      ipcRenderer.on('app:navigate', listener);
      return (): void => {
        ipcRenderer.removeListener('app:navigate', listener);
      };
    },
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  },
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
