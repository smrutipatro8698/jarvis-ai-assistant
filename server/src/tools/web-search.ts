import { searchDuckDuckGo } from './search-utils';

export const definition = {
  name: 'web_search',
  description:
    'Search the web using DuckDuckGo. Returns titles, URLs, and snippets for the top results. Use this to find current information, news, research data, competitor info, market analysis, or anything you need to look up.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return (default 8, max 15)',
      },
    },
    required: ['query'],
  },
};

export async function execute(input: {
  query: string;
  num_results?: number;
}): Promise<any> {
  console.log(`[web_search] Executing with query: "${input.query}"`);

  try {
    const numResults = Math.min(input.num_results || 8, 15);
    const results = await searchDuckDuckGo(input.query, numResults);

    console.log(`[web_search] Returning ${results.length} results`);

    return {
      query: input.query,
      results: results.map((r, i) => ({
        rank: i + 1,
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      })),
      resultCount: results.length,
    };
  } catch (error: any) {
    console.error(`[web_search] Error: ${error.message}`);
    return { error: `Web search failed: ${error.message}` };
  }
}
