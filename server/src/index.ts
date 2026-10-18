import crypto from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import session, { type CookieOptions } from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { env } from './env';
import { exchangeCode, fetchUser, fetchExtras } from './discord';

const isProd = env.NODE_ENV === 'production';
const COOKIE_NAME = 'dsso.sid';
const ttlMs = env.SESSION_TTL_HOURS * 3600 * 1000;
const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: isProd, path: '/' };

const app = express();
app.disable('x-powered-by');
if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'https://cdn.discordapp.com', 'data:'],
        formAction: ["'self'", 'https://discord.com'],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
  }),
);
app.use(express.json({ limit: '10kb' }));

app.use(
  session({
    name: COOKIE_NAME,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    store: MongoStore.create({ mongoUrl: env.MONGODB_URI, ttl: ttlMs / 1000, autoRemove: 'native', touchAfter: 300 }),
    cookie: { ...cookieOpts, maxAge: ttlMs },
  }),
);

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

function requireCsrf(req: Request, res: Response, next: NextFunction) {
  const sent = req.get('x-csrf-token') ?? '';
  const expected = req.session.csrfToken ?? '';
  const a = Buffer.from(sent), b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'invalid_csrf_token' });
  }
  next();
}

// ---- OAuth (authorization-code flow, identify scope only) ----
app.get('/auth/discord', authLimiter, (req, res, next) => {
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  req.session.save((err) => {
    if (err) return next(err);
    const q = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      redirect_uri: env.DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify email guilds connections guilds.members.read',
      state,
      prompt: 'none',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${q}`);
  });
});

app.get('/auth/discord/callback', authLimiter, async (req, res) => {
  const fail = (code: string) => res.redirect(`/?error=${code}`);
  try {
    const { code, state, error } = req.query;
    const expected = req.session.oauthState;
    delete req.session.oauthState;
    if (typeof state !== 'string' || !expected || state.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return fail('invalid_state');
    if (error === 'access_denied') return fail('access_denied');
    if (typeof code !== 'string' || !code) return fail('oauth_failed');

    const token = await exchangeCode(code); // never stored or sent to the browser
    const user = { ...(await fetchUser(token)), ...(await fetchExtras(token)) };

    await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.user = user;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
    res.redirect('/details');
  } catch (e) {
    console.error('OAuth callback error:', e instanceof Error ? e.message : 'unknown');
    fail('oauth_failed');
  }
});

// ---- API ----
app.use('/api', apiLimiter);

app.get('/api/me', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
});

app.post('/api/logout', requireAuth, requireCsrf, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy failed');
      return res.status(500).json({ error: 'logout_failed' });
    }
    res.clearCookie(COOKIE_NAME, cookieOpts);
    res.status(204).end();
  });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// ---- Static React app (production) ----
const clientDir = env.CLIENT_DIST ? path.resolve(env.CLIENT_DIST) : path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDir, { index: false, maxAge: isProd ? '1h' : 0 }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  res.sendFile(path.join(clientDir, 'index.html'), (err) => err && next());
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err instanceof Error ? err.message : 'unknown');
  res.status(500).json({ error: 'internal_error' });
});

app.listen(env.PORT, () => console.log(`Listening on :${env.PORT} (${env.NODE_ENV})`));
