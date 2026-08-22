import { extractPageContent } from './search-utils';

export const definition = {
  name: 'read_webpage',
  description:
    'Fetch and extract the readable text content from a webpage URL. Use this to read articles, blog posts, Substack newsletters, documentation, company pages, or any web content. Returns clean text without HTML markup.',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The full URL of the webpage to read',
      },
      max_length: {
        type: 'number',
        description:
          'Maximum character length of extracted content (default 8000)',
      },
    },
    required: ['url'],
  },
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function execute(input: {
  url: string;
  max_length?: number;
}): Promise<any> {
  console.log(`[read_webpage] Fetching: ${input.url}`);

  try {
    const maxLength = input.max_length || 8000;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(input.url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`[read_webpage] HTTP ${response.status} from ${input.url}`);
      return {
        error: `Failed to fetch page: HTTP ${response.status} ${response.statusText}`,
        url: input.url,
      };
    }

    const html = await response.text();
    console.log(`[read_webpage] Got ${html.length} bytes from ${input.url}`);

    const { title, description, content } = extractPageContent(html, maxLength);

    console.log(`[read_webpage] Extracted ${content.length} chars, title: "${title.slice(0, 60)}"`);

    return {
      url: input.url,
      title,
      description,
      content,
      contentLength: content.length,
      truncated: content.endsWith('... [truncated]'),
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error(`[read_webpage] Timeout after 15s: ${input.url}`);
      return { error: 'Request timed out after 15 seconds', url: input.url };
    }
    console.error(`[read_webpage] Error: ${error.message}`);
    return { error: `Failed to read webpage: ${error.message}`, url: input.url };
  }
}
