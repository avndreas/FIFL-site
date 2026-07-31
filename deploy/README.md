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

**4. Create the store for client edits.** This is what edit mode writes into
(see *Letting the client edit the site*, below). Skip it and the site works
perfectly — only `/edits` reports that it has nowhere to put anything.

```
npx wrangler@4.115.0 kv namespace create fifl-edits
```

That prints an `id`. Bind it to the Pages project in the dashboard —
**Workers & Pages → fifl-site → Settings → Bindings → Add → KV namespace** —
with the variable name **`EDITS`** and that namespace selected. Pages Direct
Upload projects take bindings from the dashboard, not from a config file, which
is why this step is clicks rather than a command.

**5. Create the store for client photos.** Same shape as step 4. Skip it and text
editing still works perfectly — only the photo half reports that it has nowhere
to put anything.

```
npx wrangler@4.115.0 r2 bucket create fifl-uploads
```

Bind it in the dashboard the same way — **Settings → Bindings → Add → R2
bucket** — with the variable name **`UPLOADS`**.

R2 rather than KV because KV is a key-value store for small values, not a place
to put half-megabyte images. The free tier covers this site many times over.

**6. Deploy.**

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

### The URL wrangler prints is not the live site

Wrangler ends with something like
`Take a peek over at https://85d7fde7.fifl-site.pages.dev`. **That is not a
replacement for `fifl-site.pages.dev`, and it does not mean production was
skipped.** Every deployment gets two addresses:

| Address | What it is |
|---|---|
| `fifl-site.pages.dev` | **The live site.** Always the newest production deployment. This is the link you give people. |
| `85d7fde7.fifl-site.pages.dev` | An immutable snapshot of *that one deploy*, kept forever. This is what makes rollback possible, and it is handy for showing someone a specific older version. |

Wrangler only prints the second one, which reads as though the first was ignored.
It wasn't. The `postdeploy` script in `package.json` prints the live URL
afterwards to make that unambiguous.

To confirm which deployment is live, ask Cloudflare rather than reading the
terminal — the `Environment` column says `Production` for anything serving
`fifl-site.pages.dev`:

```
npx wrangler@4.115.0 pages deployment list --project-name=fifl-site
```

If the live URL really does look stale, it is almost always the browser: hard
reload with **Ctrl+Shift+R**. Pages serves HTML with an `ETag` and no long
`max-age`, so a normal reload revalidates and a hard reload is decisive.

*If* the `Environment` column ever says `Preview` instead, that is the one real
failure mode: it means the `--branch` in the deploy script no longer matches the
project's production branch (`master`), and only then does production genuinely
not update.

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

## Letting the client edit the site

Send him one link — his existing password, no account, nothing to install:

```
https://fifl-site.pages.dev/?edit
```

Saved as a desktop shortcut called *Edit the website*, that is the whole
interface.

- **Text** — every paragraph and heading gets a dashed violet outline. He clicks
  one and types.
- **Photos** — every picture box gets a dashed blue outline. He clicks it to pick
  a file, or drags one onto it. Once filled, he can drag *inside* the box to
  slide the photo around until the right part shows. He is asked, once, what the
  photo is of — that becomes the `alt` text.

A bar along the bottom counts his changes and carries the **Send changes**
button. Moving between pages via the nav keeps him in edit mode.

Photos upload the moment he picks them; everything else waits for **Send**. That
is deliberate — an image cannot live in the browser's local storage, and a
failure while he is looking at the photo is far easier to understand than one
buried in a batch ten minutes later.

**Nothing he does touches the site.** Until he presses Send his changes exist
only in his own browser; after he presses Send they exist as a message in KV.
The pages, the repo and the live site are untouched either way — so he cannot
break anything, and there is nothing to revert if he goes wrong.

### Reading what he sent

```
https://fifl-site.pages.dev/edits
```

Same password. Each submission is listed newest first, grouped by page: text as
before/after pairs, photos as a thumbnail with the filename, dimensions, his
chosen `object-position` and his description.

- **Copy all as text** puts the whole batch on the clipboard — text edits *and*
  a description of each photo — in a form you can paste straight into an editor,
  or hand to Claude with "apply these".
- **Download all photos** saves the image files themselves under the names shown.
  The browser asks once to allow multiple downloads.
- **Delete** clears a batch once you are done with it. That is emptying your
  inbox, not merging anything.

So the loop is: download the photos, drag them into `assets/`, paste the text,
`npm run deploy`.

> **Two practical notes when applying a batch:**
>
> The review page shows copy with its whitespace collapsed onto one line, while
> the source files wrap and indent it. Search for a distinctive phrase from the
> middle of the sentence rather than pasting the whole thing.
>
> And keep the surrounding indentation when you paste the replacement. Dropping
> a flush-left block into an indented `<p>` renders identically and is therefore
> easy to miss, but it leaves the source inconsistent with every other page.

### Being told when a batch arrives

Not wired up yet, and deliberately: it needs FIFL's real domain onboarded to
Cloudflare Email Sending, which cannot be done from a `pages.dev` address. The
code is in place and inert. When the domain exists:

```
npx wrangler@4.115.0 email sending enable <the-domain>
```

then set these four on the Pages project (Settings → Variables and Secrets).
`notify()` in `_worker.js` stays a no-op until all four are present:

| Name | | What |
|---|---|---|
| `NOTIFY_EMAIL` | variable | where the notification goes — change it here, never in code |
| `NOTIFY_FROM` | variable | sender, on the onboarded domain, e.g. `site@<the-domain>` |
| `CF_ACCOUNT_ID` | variable | Cloudflare account id |
| `CF_API_TOKEN` | **secret** | token with Email Sending permission |

The contact form will use the same `notify()` when it is wired up, so this is
done once, not twice.

---

## Checking the gate locally

To run the site exactly as Cloudflare will, password and all:

```
echo PREVIEW_PASSWORD=whatever > .dev.vars
npm run build
npx wrangler@4.115.0 pages dev dist --kv EDITS --r2 UPLOADS --compatibility-date=2026-07-29
```

`.dev.vars` is gitignored. Delete it when you are done.

`--kv EDITS` and `--r2 UPLOADS` give edit mode throwaway local stores on disk
under `.wrangler/`. They never touch Cloudflare and the real namespace and bucket
are not involved, so you can post test batches and upload test photos freely.

Then open `http://localhost:8788/?edit` and `http://localhost:8788/edits`.

> **`--compatibility-date` is not optional, and the error it prevents looks
> alarming.** Wrangler defaults the date to *today*, but the workerd runtime
> inside the pinned `wrangler@4.115.0` only understands dates up to
> **2026-07-29**. Without the flag it refuses to boot with
> *"This Worker requires compatibility date … but the newest date supported by
> this server binary is …"*, which reads like a broken install and is not.
>
> It affects local dev only — the deployed site takes its compatibility date
> from the Pages project, not from your machine. It goes away when wrangler is
> upgraded; until then, keep the flag at or below the date in that message.

> **If a restart seems to change nothing, look for an orphaned `workerd`.**
> Ctrl+C on wrangler does not always take its runtime down with it, and the
> survivor keeps the port. You then get the *old* worker answering while the
> terminal says the new one is ready — which looks exactly like your edit having
> no effect, and cost an hour to diagnose once already.
>
> ```
> Get-CimInstance Win32_Process -Filter "Name='workerd.exe' OR Name='node.exe'" |
>   Select-Object ProcessId, CommandLine
> ```
>
> Kill anything whose command line mentions `wrangler` or `workerd` — parents
> first, or they respawn the child — and start again.

This is the only way to test edit mode. `npm run serve` deliberately knows
nothing about it: the injection, the auth and the store all live in the worker,
and a second implementation in `tools/serve.js` would be exactly the kind of
serve-versus-Cloudflare divergence that SITE-SPEC § 9 exists to warn about.

For ordinary day-to-day previewing, `npm run serve` is still the right tool —
it is faster and has no password in the way.

---

## Going live, later

When the site is ready to be public and on its real domain:

1. In `deploy/_worker.js`, set **`GATE_WHOLE_SITE = false`**. The site becomes
   public; `/edits` and `/api/edits` stay password-protected.

   **The file is not deleted.** That was the old instruction, from before it did
   anything but gate the site. Edit mode has to keep working after launch, and
   its endpoints have to stay private forever. The `_worker.js` guard in
   `tools/build.js` therefore stays too — but reword its message, which
   currently says "refusing to build an unprotected site" and would no longer be
   true.

   Read the fail-closed comment above that constant before flipping it. The
   meaning of "fail closed" inverts at the same moment, and the worker already
   handles both sides — a missing password takes the site down today and takes
   only edit mode down afterwards.

2. Delete `deploy/robots.txt`. A leftover copy would keep the finished site out
   of Google indefinitely, and it is the failure mode nobody notices for months.
3. Add a real `robots.txt` and the custom domain in the Cloudflare dashboard.
4. Decide whether `js/edit.js` should ship. It is a few KB that no public page
   ever loads or references, so leaving it costs a visitor nothing — but it is
   publicly readable, and it names the `/edits` and `/api/edits` routes. Those
   are password-protected regardless, so this is tidiness rather than security.
   To exclude it, skip it in `tools/build.js` and serve it from the worker instead.

---

## Known quirk: `.html` URLs redirect

Cloudflare Pages serves `about.html` at `/about` and 308-redirects
`/about.html` to it. The site's links all say `about.html`, so every navigation
costs one extra redirect. Everything works; the address bar just shows the
tidier URL. Rewriting the links to extensionless form would remove the hop, but
would also break opening the pages directly from the file system.
