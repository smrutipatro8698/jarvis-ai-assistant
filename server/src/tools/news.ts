import { searchDuckDuckGo, extractDomain } from './search-utils';

export const definition = {
  name: 'get_news',
  description: 'Get the latest news headlines by category.',
  input_schema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        enum: [
          'technology',
          'science',
          'business',
          'sports',
          'entertainment',
          'general',
        ],
        description: 'The news category to fetch headlines for',
      },
    },
    required: ['category'],
  },
};

export async function execute(input: { category: string }): Promise<any> {
  const category = input.category.toLowerCase();
  console.log(`[get_news] Fetching real news for category: ${category}`);

  try {
    const today = new Date().toISOString().slice(0, 10);
    const query = `${category} news today ${today}`;
    console.log(`[get_news] Search query: "${query}"`);

    const results = await searchDuckDuckGo(query, 7);

    if (results.length === 0) {
      console.log('[get_news] No results from DDG, returning error');
      return { error: `No news found for category: ${category}` };
    }

    const headlines = results.map((r, i) => ({
      rank: i + 1,
      headline: r.title,
      source: extractDomain(r.url),
      url: r.url,
    }));

    console.log(`[get_news] Returning ${headlines.length} headlines`);

    return {
      category,
      headlines,
    };
  } catch (error: any) {
    console.error(`[get_news] Error: ${error.message}`);
    return { error: `News fetch failed: ${error.message}` };
  }
}
