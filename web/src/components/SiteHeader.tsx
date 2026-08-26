'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Viewer } from '@/lib/types';
import { listSpecs, getSpecMeta } from '@/lib/specs-registry';

const SPECS = listSpecs();

/** The current spec slug from the path, or null on the landing page and other non-spec routes. */
function currentSpecFrom(pathname: string): string | null {
  const slug = pathname.split('/')[1] ?? '';
  return getSpecMeta(slug) ? slug : null;
}

function navFor(spec: string) {
  return [
    { href: `/${spec}`, label: 'Reference' },
    { href: `/${spec}/proposals`, label: 'Edit requests' },
    { href: `/${spec}/history`, label: 'History' },
  ];
}

export function SiteHeader({ viewer }: { viewer: Viewer }) {
  const pathname = usePathname();
  const spec = currentSpecFrom(pathname);

  return (
    <header className="header">
      <Link href="/" className="header-brand">
        <span className="header-mark" aria-hidden>
          A2
        </span>
        <span className="header-brand-label">API Contracts</span>
      </Link>

      {spec ? <SpecSwitcher current={spec} /> : null}

      {spec ? (
        <nav className="header-nav">
          {navFor(spec).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-active={item.href === `/${spec}` ? pathname === item.href : pathname.startsWith(item.href)}
            >
              {item.label}
            </Link>
          ))}
          <Link href={`/${spec}/editor`} data-active={pathname.startsWith(`/${spec}/editor`)}>
            {/* The label states the outcome, so nobody clicks expecting to be
                able to save and finds out only after typing. */}
            {viewer.role === 'owner' ? 'Edit' : 'Propose an edit'}
          </Link>
        </nav>
      ) : null}

      <div className="header-spacer" />

      <div className="header-right">
        <ThemeToggle />
        <SignedInAs viewer={viewer} pathname={pathname} />
      </div>

      {/*
        Flex-basis:100% forces whatever follows onto its own row. Invisible
        and inert above the mobile breakpoint (display:none there), so it
        cannot affect the desktop layout — see globals.css.
      */}
      {spec ? <div className="header-break" aria-hidden /> : null}
    </header>
  );
}

/**
 * Switching always lands on the new spec's reference page rather than trying
 * to preserve the current sub-route — a proposal id under one spec has no
 * meaningful equivalent under another.
 */
function SpecSwitcher({ current }: { current: string }) {
  const router = useRouter();

  if (SPECS.length <= 1) {
    return <span className="pill">{getSpecMeta(current)?.name ?? current}</span>;
  }

  return (
    <select
      className="spec-switcher"
      value={current}
      aria-label="Switch spec"
      onChange={(event) => router.push(`/${event.target.value}`)}
    >
      {SPECS.map((s) => (
        <option key={s.slug} value={s.slug}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function SignedInAs({ viewer, pathname }: { viewer: Viewer; pathname: string }) {
  if (viewer.role === 'guest') {
    return (
      <a className="btn btn-primary btn-sm" href={`/api/auth/login?returnTo=${encodeURIComponent(pathname)}`}>
        Sign in with GitHub
      </a>
    );
  }

  return (
    <div className="who">
      {viewer.avatar ? (
        // A plain <img>: these are github.com avatar URLs, and routing them
        // through next/image would need a remote-pattern allowlist for a
        // 26px image that is already the right size.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="avatar" src={viewer.avatar} alt="" width={26} height={26} />
      ) : null}
      <span className="who-name">{viewer.login}</span>
      {viewer.role === 'owner' ? <span className="pill pill-owner">owner</span> : null}
      <form action="/api/auth/logout" method="post">
        <button className="btn btn-ghost btn-sm" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
}

function ThemeToggle() {
  // Starts undefined rather than guessing: rendering a moon on the server and
  // a sun on the client is a hydration mismatch.
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>(undefined);

  useEffect(() => {
    const stored = localStorage.getItem('a2m8-theme');
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored);
    } else {
      setTheme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('a2m8-theme', next);
  }

  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={toggle}
      title="Switch between light and dark"
      aria-label="Switch between light and dark"
      type="button"
    >
      {theme === undefined ? '◐' : theme === 'dark' ? '☾' : '☀'}
    </button>
  );
}
