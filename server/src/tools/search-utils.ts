import * as cheerio from 'cheerio';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function extractRealUrl(ddgHref: string): string {
  try {
    if (ddgHref.startsWith('//duckduckgo.com/l/')) {
      const parsed = new URL('https:' + ddgHref);
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
    if (ddgHref.startsWith('http')) return ddgHref;
    return ddgHref;
  } catch {
    return ddgHref;
  }
}

export async function searchDuckDuckGo(
  query: string,
  numResults: number = 8
): Promise<SearchResult[]> {
  console.log(`[search-utils] Searching DDG for: "${query}" (max ${numResults} results)`);

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `q=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    console.log(`[search-utils] DDG returned status ${response.status}`);
    throw new Error(`Search returned status ${response.status}`);
  }

  const html = await response.text();
  console.log(`[search-utils] Got ${html.length} bytes of HTML`);

  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $('.result').each((_i, el) => {
    if (results.length >= numResults) return false;

    const $el = $(el);
    const titleEl = $el.find('.result__title .result__a');
    const snippetEl = $el.find('.result__snippet');

    const title = titleEl.text().trim();
    const rawHref = titleEl.attr('href') || '';
    const snippet = snippetEl.text().trim();

    if (!title || !rawHref) return;

    const resolvedUrl = extractRealUrl(rawHref);

    if (resolvedUrl.includes('duckduckgo.com')) return;

    results.push({ title, url: resolvedUrl, snippet });
  });

  console.log(`[search-utils] Parsed ${results.length} results`);

  if (results.length === 0) {
    console.log('[search-utils] WARNING: Zero results parsed — DDG HTML structure may have changed');
  }

  return results;
}

export function extractPageContent(
  html: string,
  maxLength: number = 8000
): { title: string; description: string; content: string } {
  console.log(`[search-utils] Extracting content from ${html.length} bytes of HTML`);

  const $ = cheerio.load(html);

  const title =
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    '';

  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    '';

  $('script, style, nav, header, footer, aside, form, iframe, noscript, svg').remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
  $('.sidebar, .menu, .nav, .footer, .header, .ad, .advertisement, .cookie-banner, .popup, .modal').remove();
  $('[class*="cookie"], [class*="gdpr"], [class*="consent"], [id*="cookie"]').remove();

  const contentSelectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-body',
    '.article-content',
    '.entry-content',
    '.content',
    '.post',
    '#content',
  ];

  let contentText = '';

  for (const selector of contentSelectors) {
    const el = $(selector).first();
    if (el.length > 0) {
      contentText = el.text();
      console.log(`[search-utils] Found content via selector: ${selector}`);
      break;
    }
  }

  if (!contentText) {
    contentText = $('body').text();
    console.log('[search-utils] Fell back to body text');
  }

  contentText = contentText
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  const truncated = contentText.length > maxLength;
  if (truncated) {
    contentText = contentText.slice(0, maxLength) + '... [truncated]';
  }

  console.log(`[search-utils] Extracted ${contentText.length} chars, title: "${title.slice(0, 50)}"`);

  return { title, description, content: contentText };
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
