import { prisma } from '@mh/db';
import { DEFAULT_NOTIFICATION_PREFS, notificationPrefsSchema } from '@mh/shared';
import nodemailer from 'nodemailer';
import { bus } from './bus';
import { config } from './config';
import { enqueue } from './queue';

export interface NotifyInput {
  title: string;
  body?: string;
  /** In-app deep link, e.g. /posts/abc */
  link?: string;
}

/** Sends a notification to each user over the channels they have enabled. */
export async function notify(userIds: (string | null | undefined)[], input: NotifyInput, exceptUserId?: string) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== exceptUserId))];
  if (ids.length === 0) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids }, active: true } });
  for (const user of users) {
    const parsed = notificationPrefsSchema.safeParse(user.notificationPrefs);
    const prefs = parsed.success ? parsed.data : DEFAULT_NOTIFICATION_PREFS;

    if (prefs.inApp) {
      const n = await prisma.notification.create({
        data: { userId: user.id, title: input.title, body: input.body ?? '', link: input.link },
      });
      bus.publish({ userId: user.id, type: 'notification', payload: n });
    }
    if (prefs.email && config.SMTP_URL) {
      await enqueue('send-email', {
        to: user.email,
        subject: input.title,
        text: `${input.body ?? ''}\n\nOpen Mantis to view${input.link ? `: marketinghub://${input.link.replace(/^\//, '')}` : '.'}`,
      });
    }
    if (prefs.slack && user.slackUserId && config.SLACK_BOT_TOKEN) {
      await enqueue('send-slack', {
        slackUserId: user.slackUserId,
        text: `*${input.title}*${input.body ? `\n${input.body}` : ''}`,
      });
    }
  }
}

/** Notifies every active user with at least the given role. */
export async function notifyRole(role: 'MANAGER' | 'ADMIN', input: NotifyInput, exceptUserId?: string) {
  const roles = role === 'ADMIN' ? ['ADMIN'] : ['MANAGER', 'ADMIN'];
  const users = await prisma.user.findMany({ where: { role: { in: roles as never }, active: true }, select: { id: true } });
  await notify(users.map((u) => u.id), input, exceptUserId);
}

let transport: nodemailer.Transporter | null = null;

export async function sendEmail(data: { to: string; subject: string; text: string; html?: string }) {
  if (!config.SMTP_URL) return;
  transport ??= nodemailer.createTransport(config.SMTP_URL);
  await transport.sendMail({ from: config.EMAIL_FROM, ...data });
}

export async function sendSlack(data: { slackUserId: string; text: string }) {
  if (!config.SLACK_BOT_TOKEN) return;
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: data.slackUserId, text: data.text }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) throw new Error(`Slack error: ${json.error}`);
}
