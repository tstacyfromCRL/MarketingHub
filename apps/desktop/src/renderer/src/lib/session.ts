import { create } from 'zustand';
import type { NotificationPrefs, Role } from '@mh/shared';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  slackUserId: string | null;
  libraryConfigured: boolean;
  notificationPrefs: NotificationPrefs;
}

interface SessionState {
  serverUrl: string;
  token: string | null;
  user: User | null;
  ready: boolean;
  setServerUrl(url: string): void;
  signIn(token: string, user: User): Promise<void>;
  setUser(user: User): void;
  signOut(): Promise<void>;
  init(): Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  serverUrl: 'http://localhost:4000',
  token: null,
  user: null,
  ready: false,
  setServerUrl(url) {
    const clean = url.replace(/\/+$/, '');
    set({ serverUrl: clean });
    void window.api.session.set({ serverUrl: clean });
  },
  async signIn(token, user) {
    set({ token, user });
    await window.api.session.set({ token, serverUrl: get().serverUrl });
  },
  setUser(user) {
    set({ user });
  },
  async signOut() {
    set({ token: null, user: null });
    await window.api.session.set({ token: null });
  },
  async init() {
    const s = await window.api.session.get();
    set({ serverUrl: s.serverUrl, token: s.token });
    if (s.token) {
      try {
        const res = await fetch(`${s.serverUrl}/me`, { headers: { Authorization: `Bearer ${s.token}` } });
        if (res.ok) {
          set({ user: await res.json() });
          const refreshed = await fetch(`${s.serverUrl}/auth/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` } });
          if (refreshed.ok) {
            const { token } = await refreshed.json();
            set({ token });
            await window.api.session.set({ token });
          }
        } else {
          set({ token: null });
          await window.api.session.set({ token: null });
        }
      } catch {
        // Server unreachable; the login screen will show the error.
        set({ token: null });
      }
    }
    set({ ready: true });
  },
}));

export const isManager = (u: User | null) => u?.role === 'MANAGER' || u?.role === 'ADMIN';
export const isAdmin = (u: User | null) => u?.role === 'ADMIN';
