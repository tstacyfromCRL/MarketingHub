import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import iconUrl from '../assets/mantis-icon.png';
import { queryClient } from './api';
import { useSession } from './session';

const INVALIDATE: Record<string, string[][]> = {
  activity: [['activity'], ['dashboard']],
  post: [['posts'], ['post'], ['dashboard'], ['calendar'], ['campaign']],
  task: [['board'], ['dashboard'], ['calendar']],
  campaign: [['campaigns'], ['campaign']],
  library: [['assets'], ['library-stats']],
  notification: [['notifications'], ['dashboard']],
  onboarding: [['onboarding'], ['brand']],
  // A Canva return replaces the stored graphic while this window is still open on the post.
  design: [['designs'], ['design'], ['posts'], ['post'], ['dashboard']],
};

/** Live updates over WebSocket: refreshes affected views and shows desktop notifications. */
export function useRealtime() {
  const { serverUrl, token } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;

    const connect = () => {
      ws = new WebSocket(`${serverUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        retry = 1000;
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as { type: string; payload: { title?: string; body?: string; link?: string } };
        for (const key of INVALIDATE[msg.type] ?? []) void queryClient.invalidateQueries({ queryKey: key });
        if (msg.type === 'notification' && msg.payload.title) {
          // Toasts carry the mantis mark so they are recognizable beside other apps.
          const n = new Notification(msg.payload.title, { body: msg.payload.body ?? '', icon: new URL(iconUrl, window.location.href).href });
          n.onclick = () => {
            if (msg.payload.link) navigate(msg.payload.link);
          };
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30_000);
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [serverUrl, token, navigate]);
}
