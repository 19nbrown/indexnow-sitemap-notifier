# IndexNow sitemap notifier

A Node.js helper that checks public HTML pages listed in a sitemap and notifies IndexNow when an eligible page is new, changed, or removed. Successful submissions are saved locally so unchanged pages are skipped on later runs. IndexNow may help participating search engines discover updates sooner, but it cannot guarantee indexing or rankings.

## How it works

1. After your web server starts, the helper waits one minute, then checks every six hours.
2. It reads /sitemap.xml from your local app and filters same-origin URLs through the public route allowlist in allowedPublicUrl().
3. It fetches each eligible page and hashes its title, meta description, and main content. It skips noindex pages and pages with a mismatched canonical URL.
4. It submits new, changed, and previously submitted pages that now return 404 or 410. Successful submissions are saved under dataDir/indexnow/state.json.

The helper fetches your local app at http://127.0.0.1:PORT. It uses the public HTTPS origin for canonical checks and IndexNow submissions. The local app must serve the same sitemap, pages, and key file as the public site.

## Setup

1. Copy indexnow.js and public/indexnow-key.example.txt into your Node.js app. Merge the test script from this repository's package.json into your own package.json if you already have one.
2. Use Node.js 20 or newer. Set PUBLIC_APP_URL to your canonical HTTPS origin, for example https://example.com. Set PORT to your local app port; the default is 3180.
3. Generate a private key of 8-128 letters, digits, or hyphens. One option is openssl rand -hex 24. Copy public/indexnow-key.example.txt to public/indexnow-key.txt and put the generated key in the new file. Never commit the real key; .gitignore excludes it.
4. Make the website serve that exact key at https://YOUR_DOMAIN/indexnow-key.txt. Also ensure /sitemap.xml is reachable and contains canonical HTTPS page URLs in its loc elements.
5. Review allowedPublicUrl() in indexnow.js and change its route allowlist to match your public pages. Keep account, API, upload, and other private routes excluded.
6. After your HTTP server is listening, call startIndexNow() with your public site URL, local port, and persistent writable data directory. See the function signature and usage notes in indexnow.js.
7. Preview without submitting by running: PUBLIC_APP_URL=https://example.com PORT=3180 npm run preview. Review the candidate URLs and errors. To submit changed URLs manually, run: PUBLIC_APP_URL=https://example.com PORT=3180 npm run submit.

Keep the state directory on persistent storage. A lock prevents overlapping runs; locks older than one hour are treated as stale and recovered.

## Tests

Run npm test. Tests use example.com, an in-memory fake site, and a temporary directory. They do not call the live IndexNow endpoint and do not need a real key.

## Privacy and limitations

Only URLs matching the configured public route allowlist are submitted. Local state stores URL fingerprints and submission timestamps. The notifier does not inspect account pages, uploads, prompts, or generated media. An IndexNow response of HTTP 200 or 202 means a submission was accepted, not that a page will be indexed. See https://www.indexnow.org/documentation.
