# Deploying the preview site

The work-in-progress site is hosted on **Cloudflare Pages** at a temporary
`*.pages.dev` address, behind a password. Nobody reaches it without the
password, so it cannot be indexed or stumbled upon.

**Git and deployment are deliberately unconnected.** The Pages project is a
*Direct Upload* project — Cloudflare has no access to the repository and no
knowledge of it. Commit and push as often as you like; the live site changes
only when you personally run `npm run deploy`.

```
  git push          ->  GitHub only. Live site untouched.
  npm run deploy    ->  Live site updated. Git untouched.
```

---

## One-time setup

Run these once, from the project root. You need a Cloudflare account (the free
plan covers all of this).

> **Why the exact version number?** `npx wrangler@4` would be a semver *range*, and
> npm cannot resolve a range without asking the registry — so every invocation makes
> a network round trip and prints `the following package was not found and will be
> installed`, despite the package being cached. An exact version is answerable from
> the local cache, so it runs silently. Keep the number in step with the one in
> `package.json`; to upgrade, change both and run once to warm the cache.

**1. Log in.** Opens a browser to authorise Wrangler, Cloudflare's CLI:

```
npx wrangler@4.115.0 login
```

**2. Create the project.** The name becomes the URL, so pick something
unremarkable — `fifl-site` gives you `https://fifl-site.pages.dev`. If you
change it, change `--project-name` in the `deploy` script in `package.json` to
match:

```
npx wrangler@4.115.0 pages project create fifl-site --production-branch=master
```

**3. Set the password.** This is the one piece that must never be committed. It
is stored encrypted at Cloudflare and reaches the site as `env.PREVIEW_PASSWORD`:

```
npx wrangler@4.115.0 pages secret put PREVIEW_PASSWORD --project-name=fifl-site
```

Paste the password when prompted. The username is `fifl` unless you also set a
`PREVIEW_USER` secret the same way.

**4. Deploy.**

```
npm run deploy
```

That's it. The URL is printed at the end.

---

## Updating the live site

Whenever you want the world (well, whoever has the password) to see your latest
work:

```
npm run deploy
```

which runs, in order:

1. `npm run check` — the same partials and colour checks as the pre-commit hook.
   **A failure stops the deploy**, so a page with a stale header cannot go up.
2. `npm run build` — wipes and rebuilds `dist/` (see `tools/build.js`).
3. `wrangler pages deploy` — uploads `dist/`. Only changed files transfer, so
   after the first run it takes a few seconds.

Uncommitted changes deploy fine — the two systems are independent. Deploying
does not require committing, and committing does not deploy.

### Rolling back

Every deploy is kept. In the Cloudflare dashboard, under
**Workers & Pages -> fifl-site -> Deployments**, any previous deployment can be
promoted back to live with *Rollback*. Nothing in git needs to change.

---

## Sharing it

Give people the URL and the password. Their browser shows a standard login box;
the username is `fifl`.

To change the password, run the `pages secret put` command again with a new
value, then `npm run deploy`. Anyone with the old one is locked out. (A password
in an already-open browser tab stays cached until the browser is closed — that
is the browser's doing, not the site's.)

---

## Checking the gate locally

To run the site exactly as Cloudflare will, password and all:

```
echo PREVIEW_PASSWORD=whatever > .dev.vars
npm run build
npx wrangler@4.115.0 pages dev dist
```

`.dev.vars` is gitignored. Delete it when you are done.

For ordinary day-to-day previewing, `npm run serve` is still the right tool —
it is faster and has no password in the way.

---

## Going live, later

When the site is ready to be public and on its real domain:

1. Delete `deploy/_worker.js` and `deploy/robots.txt`. **Both.** A leftover
   `robots.txt` would keep the finished site out of Google indefinitely.
2. Remove the `_worker.js` guard near the top of `tools/build.js` (it refuses to
   build without it).
3. Add a real `robots.txt` and the custom domain in the Cloudflare dashboard.

---

## Known quirk: `.html` URLs redirect

Cloudflare Pages serves `about.html` at `/about` and 308-redirects
`/about.html` to it. The site's links all say `about.html`, so every navigation
costs one extra redirect. Everything works; the address bar just shows the
tidier URL. Rewriting the links to extensionless form would remove the hop, but
would also break opening the pages directly from the file system.
