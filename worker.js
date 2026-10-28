const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&copy;/gi, '©')
    .replace(/&reg;/gi, '®')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => {
      const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : parseInt(number, 10);
      try { return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; }
      catch { return ''; }
    });
}

function cleanText(markup) {
  return decodeHtmlEntities(String(markup || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' '))
    .trim();
}

function readAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attributes.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function getRealUrl(href) {
  const decoded = decodeHtmlEntities(href).trim();
  let parsed;
  try { parsed = new URL(decoded, 'https://html.duckduckgo.com'); }
  catch { return null; }

  // Unwrap DuckDuckGo's outbound redirect URL when present.
  if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname === '/l/') {
    const target = parsed.searchParams.get('uddg');
    if (target) {
      try { parsed = new URL(target); }
      catch { return null; }
    }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return parsed.href;
}

function extractLinks(html) {
  const matches = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] || '';
    const classes = readAttribute(attributes, 'class').toLowerCase().split(/\s+/);
    if (!classes.includes('result__a') && !classes.includes('result-link')) continue;
    matches.push({ href: readAttribute(attributes, 'href'), title: cleanText(match[2]) });
  }
  return matches;
}

function extractSnippets(html) {
  const snippets = [];
  const pattern = /<(?:a|div|td|span)[^>]*\bclass\s*=\s*(["'])[^"']*\b(?:result__snippet|result-snippet)\b[^"']*\1[^>]*>([\s\S]*?)<\/(?:a|div|td|span)>/gi;
  for (const match of html.matchAll(pattern)) snippets.push(cleanText(match[2]));
  return snippets;
}

function parseResults(html, limit = 10) {
  const links = extractLinks(html);
  const snippets = extractSnippets(html);
  const results = [];
  const seen = new Set();

  for (let i = 0; i < links.length && results.length < limit; i++) {
    const url = getRealUrl(links[i].href);
    const title = links[i].title;
    if (!url || !title) continue;
    let hostname;
    try { hostname = new URL(url).hostname.toLowerCase(); }
    catch { continue; }
    if (hostname.endsWith('duckduckgo.com') || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: title.slice(0, 240),
      url,
      snippet: (snippets[i] || '').slice(0, 600)
    });
  }
  return results;
}


function xmlTag(item, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = item.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  if (!match) return '';
  return decodeHtmlEntities(match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim());
}

function parseBingRss(xml, limit = 10) {
  if (!/<item[\s>]/i.test(xml)) return [];
  const results = [];
  for (const item of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
    const title = cleanText(xmlTag(item, 'title'));
    const description = cleanText(xmlTag(item, 'description'));
    const link = xmlTag(item, 'link');
    let url;
    try { url = new URL(link).href; } catch { continue; }
    if (!title || !/^https?:$/.test(new URL(url).protocol)) continue;
    if (new URL(url).hostname.endsWith('bing.com')) {
      const redirected = new URL(url).searchParams.get('url');
      if (redirected) { try { url = new URL(redirected).href; } catch {} }
    }
    results.push({ title: title.slice(0, 240), url, snippet: description.slice(0, 600) });
    if (results.length >= limit) break;
  }
  return results;
}

async function fetchSearchResults(query) {
  // Bing's RSS search feed is tried first because DuckDuckGo may return an
  // HTTP 202 anti-automation/challenge page to server-side Worker requests.
  const bingUrl = new URL('https://www.bing.com/search');
  bingUrl.searchParams.set('q', query);
  bingUrl.searchParams.set('format', 'rss');
  bingUrl.searchParams.set('setlang', 'en-AU');
  let lastStatus = null;

  try {
    const upstream = await fetch(bingUrl.href, {
      headers: { 'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8', 'Accept-Language': 'en-AU,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000)
    });
    lastStatus = upstream.status;
    if (upstream.ok) {
      const body = await upstream.text();
      const results = parseBingRss(body, 10);
      if (results.length) return results;
    }
  } catch { /* continue to DuckDuckGo fallback */ }

  // DuckDuckGo HTML endpoints remain as fallbacks; upstream may challenge Workers.
  for (const endpoint of ['https://html.duckduckgo.com/html/', 'https://lite.duckduckgo.com/lite/']) {
    const searchUrl = new URL(endpoint);
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('kp', '1');
    searchUrl.searchParams.set('kl', 'au-en');
    try {
      const upstream = await fetch(searchUrl.href, {
        headers: { 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-AU,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000)
      });
      lastStatus = upstream.status;
      if (!upstream.ok) continue;
      const contentType = upstream.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('html')) continue;
      const html = await upstream.text();
      const results = parseResults(html, 10);
      if (results.length) return results;
    } catch { /* try next provider */ }
  }

  const reason = lastStatus ? ` (last provider HTTP ${lastStatus})` : '';
  throw new Error(`Search providers did not return usable results${reason}. Please try again shortly.`);
}

async function handleSearch(request) {
  if (request.method !== 'GET') {
    return json({ error: 'Use a GET request to search.' }, 405);
  }

  const requestUrl = new URL(request.url);
  const query = (requestUrl.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
  if (!query) return json({ error: 'Enter something to search for.' }, 400);
  if (query.length > 250) return json({ error: 'Searches must be 250 characters or fewer.' }, 400);

  try {
    const results = await fetchSearchResults(query);
    return json({ query, results, provider: 'Web search' });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Search is temporarily unavailable. Please try again.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/search') return handleSearch(request);
    if (url.pathname.startsWith('/api/')) return json({ error: 'API endpoint not found.' }, 404);
    return env.ASSETS.fetch(request);
  }
};
