import { useCallback, useEffect, useState } from 'react';

interface Member { nickname: string | null; roleCount: number; joinedAt: string }
interface Guild { id: string; name: string; iconUrl: string | null; owner: boolean; member: Member | null }
interface Connection { type: string; name: string; verified: boolean }
interface User {
  id: string;
  username: string;
  globalName: string | null;
  discriminator: string | null;
  avatarUrl: string;
  guilds: Guild[] | null;
  connections: Connection[] | null;
}
type Me =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'error' }
  | { status: 'ok'; user: User; csrfToken: string };

const ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the Discord authorization. Nothing was changed.',
  invalid_state: 'The sign-in attempt expired or could not be verified. Please try again.',
  oauth_failed: 'Discord sign-in failed. Please try again in a moment.',
};

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = useCallback((to: string) => {
    window.history.pushState({}, '', to);
    setPath(to);
  }, []);
  return { path, go };
}

function LoginCard({ error, notice }: { error?: string | null; notice?: string }) {
  return (
    <main className="card">
      <h1>Sign in</h1>
      <p className="muted">{notice ?? 'Use your Discord account to continue.'}</p>
      {error && <p role="alert" className="alert">{ERRORS[error] ?? ERRORS.oauth_failed}</p>}
      <a className="btn" href="/auth/discord">Continue with Discord</a>
    </main>
  );
}

function Details({ me, onLoggedOut }: { me: Extract<Me, { status: 'ok' }>; onLoggedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { user } = me;

  const logout = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': me.csrfToken },
        credentials: 'same-origin',
      });
      if (r.status === 204 || r.status === 401) onLoggedOut();
      else setErr('Could not sign out. Please try again.');
    } catch {
      setErr('Network error. You are still signed in.');
    }
    setBusy(false);
  };

  return (
    <main className="card">
      <img className="avatar" src={user.avatarUrl} alt={`${user.username}'s avatar`} width={96} height={96} />
      <h1>{user.globalName ?? user.username}</h1>

      <dl>
        <dt>Username</dt><dd>{user.username}</dd>
        <dt>Display name</dt><dd>{user.globalName ?? 'Not set'}</dd>
        <dt>User ID</dt><dd className="mono">{user.id}</dd>
        <dt>Email</dt><dd>{user.email ? `${user.email}${user.emailVerified ? '' : ' (unverified)'}` : 'Not shared'}</dd>
        {user.discriminator && (
          <>
            <dt>Discriminator</dt><dd className="mono">#{user.discriminator}</dd>
          </>
        )}
      </dl>

      <section>
        <h2>Servers{user.guilds ? ` (${user.guilds.length})` : ''}</h2>
        {user.guilds === null ? (
          <p className="muted">Couldn’t load your servers.</p>
        ) : user.guilds.length === 0 ? (
          <p className="muted">No servers.</p>
        ) : (
          <ul className="list">
            {user.guilds.map((g) => (
              <li key={g.id}>
                {g.iconUrl ? <img src={g.iconUrl} alt="" width={24} height={24} /> : <span className="ph" />}
                <span>
                  {g.name}
                  {g.owner && <span className="muted"> · owner</span>}
                  {g.member?.nickname && <span className="muted"> · nickname “{g.member.nickname}”</span>}
                  {g.member && <span className="muted"> · {g.member.roleCount} roles</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Connected accounts</h2>
        {user.connections === null ? (
          <p className="muted">Couldn’t load connections.</p>
        ) : user.connections.length === 0 ? (
          <p className="muted">None linked.</p>
        ) : (
          <ul className="list">
            {user.connections.map((c, i) => (
              <li key={i}>
                <span>
                  {c.name}
                  <span className="muted"> {c.type}{c.verified ? ', verified' : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {err && <p role="alert" className="alert">{err}</p>}
      <button className="btn secondary" onClick={logout} disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </main>
  );
}

export function App() {
  const { path, go } = usePath();
  const [me, setMe] = useState<Me>({ status: 'loading' });
  const error = new URLSearchParams(window.location.search).get('error');

  useEffect(() => {
    fetch('/api/me', { credentials: 'same-origin' })
      .then(async (r) => {
        if (r.status === 401) return setMe({ status: 'anon' });
        if (!r.ok) return setMe({ status: 'error' });
        const j = await r.json();
        setMe({ status: 'ok', user: j.user, csrfToken: j.csrfToken });
      })
      .catch(() => setMe({ status: 'error' }));
  }, []);

  const loggedOut = () => {
    setMe({ status: 'anon' });
    go('/');
  };

  if (me.status === 'loading') return <main className="card"><p className="muted">Loading…</p></main>;
  if (me.status === 'error') {
    return <main className="card"><p role="alert" className="alert">Could not reach the server.</p></main>;
  }
  if (path === '/details') {
    return me.status === 'ok'
      ? <Details me={me} onLoggedOut={loggedOut} />
      : <LoginCard notice="Sign in with Discord to view your account details." />;
  }
  if (me.status === 'ok') {
    go('/details');
    return null;
  }
  return <LoginCard error={error} />;
}