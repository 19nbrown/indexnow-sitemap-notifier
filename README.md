# IndexNow sitemap notifier

A small Node.js service that watches public HTML pages listed in your sitemap and tells IndexNow when an eligible page is new, changed, or removed. Successful submissions are recorded locally, so unchanged pages are skipped on later runs. This can help participating search engines discover updates sooner, but it does not guarantee indexing or rankings.

## How it works

1. After your web server starts, the helper waits one minute and then checks every six hours.
2. It reads /sitemap.xml from your local app and keeps same-origin URLs that match the public route allowlist in allowedPublicUrl().
3. For each eligible route, it fetches the HTML and hashes the title, meta description, and main content. Noindex pages and pages with a mismatched canonical are skipped.
4. New, changed, and previously submitted pages now returning 404 or 410 are submitted to IndexNow. Successful submissions are saved under dataDir/indexnow/state.json; unchanged pages are skipped.

The helper reads HTML from http://127.0.0.1:<PORT> and uses the public HTTPS site URL for canonical checks and IndexNow submissions. The local app should serve the same sitemap, pages, and public key file as the public site.

## Setup

1. Copy these files into your Node.js app: indexnow.js, package.json, and public/indexnow-key.example.txt. Merge the test script from this repository's package.json into your own package.json if you already have one.
2. Use Node.js 20 or newer. Set PUBLIC_APP_URL to your canonical HTTPS origin, such as https://example.com, and set PORT to the local port your app listens on (3180 by default).
3. Generate a private key containing 8-128 letters, digits, or hyphens. For example, openssl rand -hex 24. Copy public/indexnow-key.example.txt to public/indexnow-key.txt and put the generated key in the new file. Never commit the real key. The included .gitignore excludes it.
4. Make sure your website serves that exact key at https://<your-domain>/indexnow-key.txt, and serves a valid /sitemap.xml containing <url><loc>canonical-https-url</loc></url> entries.
5. Review allowedPublicUrl() in indexnow.js and adapt its route allowlist to your public sitemap pages. Keep account, API, upload, and other private routes out of the allowlist.
6. Start the notifier after your HTTP server is listening:

   import { startIndexNow } from './indexnow.js';

   server.listen(port, () => {
     startIndexNow({
       siteUrl: process.env.PUBLIC_APP_URL,
       port: Number(process.env.PORT || 3180),
       dataDir: process.env.DATA_DIR || './data'
     });
   });

7. Preview without submitting by running PUBLIC_APP_URL=https://example.com PORT=3180 npm run preview. Check the listed URLs and errors first. To submit changes manually, run PUBLIC_APP_URL=https://example.com PORT=3180 npm run submit.

Keep the state directory on persistent storage and writable by the service. The lock file prevents overlapping runs; stale locks older than one hour are recovered automatically.

## Tests

Run npm test. The tests use example.com, an in-memory fake site, and a temporary directory; they do not call the live IndexNow endpoint or need a real key.

## Privacy and limitations

The notifier submits only URLs from the configured public route allowlist and stores URL fingerprints and submission timestamps locally. It does not inspect account pages, uploads, prompts, or generated-media data. IndexNow HTTP 200 or 202 means the submission was accepted, not that a search engine will index or rank a page. See the [IndexNow protocol documentation](https://www.indexnow.org/documentation).
