import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { config } from './config';

/** A message pushed to connected desktop clients. userId '*' = broadcast. */
export interface RealtimeMessage {
  userId: string | '*';
  type: 'notification' | 'activity' | 'post' | 'task' | 'campaign' | 'library' | 'onboarding';
  payload: unknown;
}

type Handler = (msg: RealtimeMessage) => void;

const CHANNEL = 'mh:realtime';
const local = new EventEmitter();
local.setMaxListeners(100);

let pub: Redis | null = null;
let sub: Redis | null = null;

/**
 * Realtime fan-out. With Redis configured, messages from the worker process reach the
 * API server's WebSocket connections through Redis pub/sub.
 */
export const bus = {
  publish(msg: RealtimeMessage): void {
    if (config.REDIS_URL) {
      pub ??= new Redis(config.REDIS_URL);
      void pub.publish(CHANNEL, JSON.stringify(msg));
    } else {
      local.emit(CHANNEL, msg);
    }
  },
  subscribe(handler: Handler): () => void {
    if (config.REDIS_URL) {
      if (!sub) {
        sub = new Redis(config.REDIS_URL);
        void sub.subscribe(CHANNEL);
        sub.on('message', (_ch, raw) => local.emit(CHANNEL, JSON.parse(raw)));
      }
    }
    local.on(CHANNEL, handler);
    return () => local.off(CHANNEL, handler);
  },
};
