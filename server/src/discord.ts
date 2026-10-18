import type { SessionUser, GuildSummary, ConnectionSummary, GuildMemberInfo } from './session';
import { env } from './env';

const API = 'https://discord.com/api/v10';

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.DISCORD_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('token response missing access_token');
  return json.access_token;
}

const MAX_MEMBER_LOOKUPS = 100;
const CONCURRENCY = 5;

async function get<T>(path: string, token: string, retry = true): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429 && retry) {
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
    await new Promise((r) => setTimeout(r, Math.min(body.retry_after ?? 1, 5) * 1000));
    return get<T>(path, token, false);
  }
  if (!res.ok) throw new Error(`${path.split('?')[0]} failed (${res.status})`);
  return (await res.json()) as T;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function fetchExtras(token: string): Promise<Pick<SessionUser, 'guilds' | 'connections'>> {
  const [g, c] = await Promise.allSettled([
    get<{ id: string; name: string; icon: string | null; owner: boolean }[]>('/users/@me/guilds?limit=200', token),
    get<{ type: string; name: string; verified: boolean }[]>('/users/@me/connections', token),
  ]);
  if (g.status === 'rejected') console.error('Discord guilds fetch failed:', (g.reason as Error).message);
  if (c.status === 'rejected') console.error('Discord connections fetch failed:', (c.reason as Error).message);

  let guilds: GuildSummary[] | null = null;
  if (g.status === 'fulfilled') {
    guilds = await mapLimit(g.value, CONCURRENCY, async (x, ) => {
      let member: GuildMemberInfo | null = null;
      if (g.value.indexOf(x) < MAX_MEMBER_LOOKUPS) {
        try {
          const m = await get<{ nick: string | null; roles: string[]; joined_at: string }>(
            `/users/@me/guilds/${x.id}/member`, token);
          member = { nickname: m.nick, roleCount: m.roles.length, joinedAt: m.joined_at };
        } catch (e) {
          console.error('Discord member fetch failed:', (e as Error).message);
        }
      }
      return {
        id: x.id, name: x.name, owner: x.owner, member,
        iconUrl: x.icon ? `https://cdn.discordapp.com/icons/${x.id}/${x.icon}.png?size=64` : null,
      };
    });
  }
  const connections: ConnectionSummary[] | null = c.status === 'fulfilled'
    ? c.value.map((x) => ({ type: x.type, name: x.name, verified: x.verified }))
    : null;
  return { guilds, connections };
}

export async function fetchUser(accessToken: string): Promise<Omit<SessionUser, 'guilds' | 'connections'>> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`user fetch failed (${res.status})`);
  const u = (await res.json()) as {
    id: string; username: string; global_name?: string | null;
    discriminator?: string; avatar?: string | null;
    email?: string | null; verified?: boolean;
  };
  const legacy = u.discriminator && u.discriminator !== '0' ? u.discriminator : null;
  const avatarUrl = u.avatar
    ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`
    : `https://cdn.discordapp.com/embed/avatars/${legacy ? Number(legacy) % 5 : Number((BigInt(u.id) >> 22n) % 6n)}.png`;
  return {
    id: u.id, username: u.username, globalName: u.global_name ?? null,
    discriminator: legacy, avatarUrl,
    email: u.email ?? null, emailVerified: u.verified ?? false,
  };
}
