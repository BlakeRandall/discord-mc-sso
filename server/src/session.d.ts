import 'express-session';

export interface GuildMemberInfo { nickname: string | null; roleCount: number; joinedAt: string }
export interface GuildSummary { id: string; name: string; iconUrl: string | null; owner: boolean; member: GuildMemberInfo | null }
export interface ConnectionSummary { type: string; name: string; verified: boolean }

export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  discriminator: string | null;
  avatarUrl: string;
  email: string | null;
  emailVerified: boolean;
  guilds: GuildSummary[] | null;
  connections: ConnectionSummary[] | null;
}

declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
    user?: SessionUser;
    csrfToken?: string;
  }
}
