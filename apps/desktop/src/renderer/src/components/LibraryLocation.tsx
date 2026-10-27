import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, HardDrive, RefreshCw, ScanLine, X } from 'lucide-react';
import type { LibraryStatus } from '@mh/shared';
import type { ScanProgress } from '../../../preload';
import { api, queryClient } from '../lib/api';
import { isAdmin, useSession } from '../lib/session';
import { Button } from './ui';

const PROMPT_DISMISSED = 'mh.libraryPromptDismissed';

/** Shared state for the library location, re-checked when the window regains focus (drives reconnect). */
export function useLibraryLocation() {
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await window.api.library.checkAccess());
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void recheck();
    const onFocus = () => void recheck();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [recheck]);

  return { status, setStatus, checking, recheck };
}

function useScanProgress() {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  useEffect(() => {
    void window.api.library.scanProgress().then(setProgress);
    return window.api.library.onProgress((p) => {
      setProgress(p);
      if (p.state === 'done') {
        void queryClient.invalidateQueries({ queryKey: ['assets'] });
        void queryClient.invalidateQueries({ queryKey: ['library-stats'] });
      }
    });
  }, []);
  return progress;
}

function Warning({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-800/60 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div className="flex-1">{children}</div>
      {onClose && (
        <button onClick={onClose} className="text-amber-400 hover:text-amber-200">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * The team library drive. An admin picks the network drive folder once ("Select Library Location");
 * every PC then finds that share among its own mapped drives, whatever letter it's mapped to.
 */
export function LibraryLocation() {
  const { user } = useSession();
  const admin = isAdmin(user);
  const { status, setStatus, checking, recheck } = useLibraryLocation();
  const progress = useScanProgress();
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (status) setName(status.name);
  }, [status?.name]);

  const location = status && status.state !== 'unset' && status.rootPath ? { rootPath: status.rootPath, uncPath: status.uncPath } : null;
  const nameChanged = !!status && name.trim() !== '' && name.trim() !== status.name;

  const select = async () => {
    setSelecting(true);
    setError(null);
    try {
      const result = await window.api.library.selectLocation(name);
      if (result.cancelled) return;
      if (result.error) return setError(result.error);
      setStatus(result);
      void queryClient.invalidateQueries({ queryKey: ['library-server'] });
      if (result.state === 'ok') localStorage.removeItem(PROMPT_DISMISSED);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSelecting(false);
    }
  };

  const rename = async () => {
    if (!location) return;
    setSavingName(true);
    setError(null);
    try {
      await api.put('/library', { name: name.trim(), ...location });
      void queryClient.invalidateQueries({ queryKey: ['library-server'] });
      await recheck();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingName(false);
    }
  };

  const scanning = progress?.state === 'scanning';
  const shownPath = status?.state === 'ok' ? status.path : location?.rootPath;

  return (
    <div className="space-y-3">
      {admin && (
        <div className="flex items-end gap-2">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-xs text-slate-400">Drive name (shown to the team)</span>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {location && nameChanged && (
            <Button variant="secondary" onClick={() => void rename()} loading={savingName}>Save name</Button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <HardDrive className="h-5 w-5 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{status?.name ?? 'Team library'}</div>
          {shownPath ? (
            <div className="truncate font-mono text-xs text-slate-300" title={shownPath}>{shownPath}</div>
          ) : (
            <div className="text-xs text-slate-500">{status ? 'Not set up yet' : 'Checking...'}</div>
          )}
          {location?.uncPath && (
            <div className="truncate font-mono text-xs text-slate-500" title={location.uncPath}>Network share: {location.uncPath}</div>
          )}
          {status?.state === 'ok' && (
            <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected
            </div>
          )}
        </div>
        {status && status.state !== 'unset' && (
          <Button variant="ghost" size="sm" onClick={() => void recheck()} loading={checking} title="Re-check access">
            {!checking && <RefreshCw className="h-3.5 w-3.5" />} Re-check
          </Button>
        )}
        {admin && (
          <Button onClick={() => void select()} loading={selecting}>
            {!selecting && <FolderOpen className="h-4 w-4" />}
            {location ? 'Change...' : 'Select Library Location'}
          </Button>
        )}
      </div>

      {status?.state === 'unavailable' && <Warning>{status.reason}</Warning>}
      {status?.state === 'unset' && !admin && (
        <p className="text-sm text-slate-400">An admin hasn't chosen the library drive yet. Please contact Admin.</p>
      )}
      {admin && location && !location.uncPath && (
        <Warning>
          This folder isn't on a network drive, so other team members won't be able to reach it. Choose a folder on the mapped
          Marketing &amp; Media drive instead.
        </Warning>
      )}
      {error && <Warning onClose={() => setError(null)}>{error}</Warning>}

      {status?.state === 'ok' && (
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <Button variant="secondary" size="sm" onClick={() => void window.api.library.scan(true)} disabled={scanning}>
            <ScanLine className="h-3.5 w-3.5" /> Scan now
          </Button>
          {progress && progress.state !== 'idle' && (
            <span>
              {progress.state === 'scanning' && `Scanning... ${progress.seen.toLocaleString()} files checked, ${progress.uploaded.toLocaleString()} indexed`}
              {progress.state === 'done' && `Last scan: ${progress.seen.toLocaleString()} files, ${progress.uploaded.toLocaleString()} new or changed`}
              {progress.state === 'busy' && (progress.message ?? 'Another team member is scanning the library right now.')}
              {progress.state === 'error' && <span className="text-rose-400">{progress.message}</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Banner above every page when the library drive is missing on this PC (or, for admins, not set up yet). */
export function LibraryFirstRunPrompt() {
  const { user } = useSession();
  const { status } = useLibraryLocation();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(PROMPT_DISMISSED) === '1');
  if (!status || status.state === 'ok' || dismissed) return null;
  if (status.state === 'unset' && !isAdmin(user)) return null;
  const unset = status.state === 'unset';
  return (
    <div className="mb-6 rounded-sm bg-chrome p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">{unset ? 'Set up the team asset library' : `${status.name} not found`}</div>
          <p className="mt-0.5 text-sm text-slate-400">
            {unset
              ? 'Choose the top-level folder of the Marketing & Media network drive. Everyone on the team will use that drive; files stay on it and Mantis only indexes thumbnails and details.'
              : 'If you just connected the drive or VPN, click Re-check.'}
          </p>
        </div>
        <button
          className="text-slate-500 hover:text-slate-300"
          title="Remind me later"
          onClick={() => {
            localStorage.setItem(PROMPT_DISMISSED, '1');
            setDismissed(true);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <LibraryLocation />
    </div>
  );
}
