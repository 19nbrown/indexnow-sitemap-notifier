// Public-page IndexNow notifications. No account, upload or generation data.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const endpoint = 'https://api.indexnow.org/indexnow';
const intervalMs = 6 * 60 * 60 * 1000;
const decodeXml = value => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function allowedPublicUrl(value, origin) {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return false;
    // Safe, generic starter allowlist. Adapt this to the public routes in your sitemap.
    return /^\/(?:|about|pricing|blog\/[a-z0-9-]+)$/.test(url.pathname);
  } catch { return false; }
}

export function sitemapUrls(xml, origin) {
  // Deliberately match <loc>, not image:loc or other embedded media entries.
  return [...new Set([...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(match => decodeXml(match[1].trim())).filter(url => allowedPublicUrl(url, origin)))].slice(0, 10000);
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2]]));
}
export function pageFingerprint(html, headers, expectedUrl) {
  if (/noindex|none/i.test(headers.get('x-robots-tag') || '')) return null;
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0]));
  if (metas.some(meta => /^(robots|bingbot)$/i.test(meta.name || '') && /noindex|none/i.test(meta.content || ''))) return null;
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0])).find(tag => /\bcanonical\b/i.test(tag.rel || ''));
  if (canonical && new URL(canonical.href, expectedUrl).href !== expectedUrl) return null;
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!main) return null;
  const text = main.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
  const description = metas.find(meta => meta.name?.toLowerCase() === 'description')?.content || '';
  return crypto.createHash('sha256').update(JSON.stringify({title, description, text})).digest('hex');
}

async function readText(url, fetcher) {
  const response = await fetcher(url, {redirect:'manual', signal:AbortSignal.timeout(10000), headers:{'user-agent':'IndexNow-Sitemap-Notifier/1.0'}});
  if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('Response exceeds size limit');
  const reader = response.body?.getReader(); const chunks = []; let size = 0;
  if (reader) {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); throw new Error('Response exceeds size limit'); }
      chunks.push(Buffer.from(value));
    }
  }
  return {response, text:Buffer.concat(chunks).toString('utf8')};
}

export async function notifyIndexNow({siteUrl, port = 3180, dataDir = path.join(root, 'data'), keyFile = path.join(root, 'public', 'indexnow-key.txt'), fetcher = fetch, dryRun = false}) {
  const origin = new URL(siteUrl).origin;
  if (!origin.startsWith('https://')) throw new Error('IndexNow requires the public HTTPS site URL');
  const internal = `http://127.0.0.1:${port}`;
  const dir = path.join(dataDir, 'indexnow'); await fs.mkdir(dir, {recursive:true});
  const lockFile = path.join(dir, 'run.lock');
  let lock;
  try { lock = await fs.open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (Date.now() - (await fs.stat(lockFile)).mtimeMs < 60 * 60 * 1000) return {skipped:'another run is active'};
    await fs.unlink(lockFile); lock = await fs.open(lockFile, 'wx', 0o600);
  }
  try {
    const key = (await fs.readFile(keyFile, 'utf8')).trim();
    if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new Error('Invalid IndexNow key file');
    const keyLocation = origin + '/indexnow-key.txt';
    const stateFile = path.join(dir, 'state.json');
    let state = {pages:{}};
    try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const {response:sitemapResponse, text:xml} = await readText(internal + '/sitemap.xml', fetcher);
    if (!sitemapResponse.ok || !/<urlset\b/.test(xml)) throw new Error('Public sitemap unavailable');
    const urls = sitemapUrls(xml, origin);
    if (!urls.length) throw new Error('Sitemap has no eligible public pages');
    const candidates = [...new Set([...urls, ...Object.keys(state.pages).filter(url => allowedPublicUrl(url, origin))])];
    const changed = []; const changes = {}; const errors = [];
    for (const url of candidates) {
      try {
        const {response, text} = await readText(internal + new URL(url).pathname, fetcher);
        let fingerprint;
        if ([404, 410].includes(response.status) && state.pages[url]) fingerprint = `removed:${response.status}`;
        else if (response.ok && response.headers.get('content-type')?.includes('text/html')) fingerprint = pageFingerprint(text, response.headers, url);
        else if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (fingerprint && fingerprint !== state.pages[url]?.fingerprint) { changed.push(url); changes[url] = {fingerprint}; }
      } catch (error) { errors.push({url,error:error.message}); }
    }
    if (dryRun) return {dryRun:true,eligible:urls.length,changed:changed.length,urls:changed,errors};
    let status = null;
    if (changed.length) {
      const verification = await readText(keyLocation, fetcher);
      if (!verification.response.ok || verification.text.trim() !== key) throw new Error('Public IndexNow verification file is unavailable');
      const result = await fetcher(endpoint, {method:'POST',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({host:new URL(origin).host,key,keyLocation,urlList:changed})});
      status = result.status;
      if (![200,202].includes(status)) throw new Error(`IndexNow returned HTTP ${status}; submissions retained for retry`);
      for (const url of changed) state.pages[url] = {...changes[url],submittedAt:new Date().toISOString(),responseStatus:status};
    }
    const report = {checkedAt:new Date().toISOString(),eligible:urls.length,submitted:changed.length,status,errors};
    state.lastRun = report;
    const temporary = stateFile + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temporary,JSON.stringify(state,null,2),{mode:0o600}); await fs.rename(temporary,stateFile);
    console.log('IndexNow:',JSON.stringify(report));
    return report;
  } finally { await lock.close(); await fs.unlink(lockFile); }
}

export function startIndexNow(options) {
  const run = () => notifyIndexNow(options).catch(error=>console.warn('IndexNow:',error.message));
  setTimeout(run,60_000).unref();
  setInterval(run,intervalMs).unref();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  notifyIndexNow({siteUrl:process.env.PUBLIC_APP_URL,port:Number(process.env.PORT || 3180),dryRun:process.argv.includes('--dry-run')})
    .then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
