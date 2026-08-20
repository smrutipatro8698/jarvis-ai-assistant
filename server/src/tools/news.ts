export const definition = {
  name: 'get_news',
  description: 'Get the latest news headlines by category.',
  input_schema: {
    type: 'object' as const,
    properties: {
      category: {
        type: 'string',
        enum: ['technology', 'science', 'business', 'sports', 'entertainment', 'general'],
        description: 'The news category to fetch headlines for',
      },
    },
    required: ['category'],
  },
};

const headlinesByCategory: Record<string, Array<{ headline: string; source: string }>> = {
  technology: [
    { headline: 'Quantum Computing Startup Achieves New Error Correction Milestone', source: 'TechCrunch' },
    { headline: 'Major Browser Vendors Agree on New Privacy Standard for Web3', source: 'The Verge' },
    { headline: 'AI-Powered Code Review Tools See 300% Adoption Increase in Enterprise', source: 'Ars Technica' },
    { headline: 'New Solid-State Battery Design Promises 1000-Mile EV Range', source: 'Wired' },
    { headline: 'Open Source LLM Framework Surpasses 100K GitHub Stars', source: 'VentureBeat' },
    { headline: 'Satellite Internet Constellation Reaches Full Global Coverage', source: 'IEEE Spectrum' },
    { headline: 'Breakthrough in Neuromorphic Chip Design Cuts AI Power Usage by 90%', source: 'MIT Technology Review' },
  ],
  science: [
    { headline: 'James Webb Telescope Detects New Biosignature in Exoplanet Atmosphere', source: 'Nature' },
    { headline: 'CRISPR Gene Therapy Shows Promise in Treating Hereditary Blindness', source: 'Science Daily' },
    { headline: 'Deep Ocean Expedition Discovers New Extremophile Species Near Hydrothermal Vents', source: 'National Geographic' },
    { headline: 'Fusion Reactor Prototype Sustains Plasma for Record 8 Minutes', source: 'New Scientist' },
    { headline: 'Archaeological Team Uncovers Previously Unknown Bronze Age Settlement', source: 'Smithsonian' },
    { headline: 'New Study Links Gut Microbiome Diversity to Cognitive Performance', source: 'The Lancet' },
    { headline: 'Mars Sample Return Mission Enters Final Design Phase', source: 'Space.com' },
  ],
  business: [
    { headline: 'Federal Reserve Signals Potential Rate Adjustment in Coming Quarter', source: 'Bloomberg' },
    { headline: 'Major Automaker Announces $20B Investment in Domestic EV Manufacturing', source: 'Reuters' },
    { headline: 'Global Supply Chain Resilience Index Shows Strongest Recovery Since 2019', source: 'Financial Times' },
    { headline: 'Remote Work Policies Drive Office Space Redesign Wave Across Tech Sector', source: 'Wall Street Journal' },
    { headline: 'Renewable Energy Investment Surpasses Fossil Fuels for Third Consecutive Year', source: 'CNBC' },
    { headline: 'Southeast Asian Markets See Record Foreign Direct Investment Inflows', source: 'The Economist' },
    { headline: 'Cybersecurity Insurance Market Projected to Double by 2028', source: 'Forbes' },
  ],
  sports: [
    { headline: 'Underdog Team Clinches Playoff Spot with Dramatic Last-Second Victory', source: 'ESPN' },
    { headline: 'Olympic Committee Announces New Host City Selection for 2036 Games', source: 'BBC Sport' },
    { headline: 'Tennis Star Returns from Injury to Win Major Tournament', source: 'Sports Illustrated' },
    { headline: 'Historic Transfer Deal Reshapes Soccer League Title Race', source: 'Sky Sports' },
    { headline: 'Marathon World Record Broken by 23-Year-Old Debut Runner', source: 'The Athletic' },
    { headline: 'Esports League Revenue Surpasses Traditional Minor League Baseball', source: 'Yahoo Sports' },
    { headline: 'NBA Draft Lottery Shake-Up Produces Surprising Number One Pick', source: 'Bleacher Report' },
  ],
  entertainment: [
    { headline: 'Streaming Platform Greenlights Most Expensive Series in Television History', source: 'Variety' },
    { headline: 'Indie Film Festival Darling Secures Surprise Wide Release Deal', source: 'Hollywood Reporter' },
    { headline: 'Legendary Music Producer Announces Comeback Album After Decade-Long Hiatus', source: 'Rolling Stone' },
    { headline: 'Video Game Sequel Breaks Sales Records with 25 Million Copies in First Week', source: 'IGN' },
    { headline: 'Broadway Revival of Classic Musical Earns Record 15 Tony Nominations', source: 'Deadline' },
    { headline: 'AI-Generated Visual Effects Spark Debate at Major Film Awards', source: 'Entertainment Weekly' },
    { headline: 'Global Concert Tour Becomes Highest-Grossing Live Event in History', source: 'Billboard' },
  ],
  general: [
    { headline: 'International Climate Summit Produces Binding Emissions Agreement', source: 'Associated Press' },
    { headline: 'City Launches Ambitious Urban Green Space Initiative Spanning 500 Acres', source: 'The Guardian' },
    { headline: 'New Study Reveals Shifting Trends in Global Migration Patterns', source: 'NPR' },
    { headline: 'National Education Reform Bill Advances with Bipartisan Support', source: 'Washington Post' },
    { headline: 'Community-Led Housing Project Named Model for Affordable Development', source: 'BBC News' },
    { headline: 'Wildfire Prevention Program Shows 40% Reduction in Seasonal Burns', source: 'USA Today' },
    { headline: 'Public Transit Modernization Plan Receives Federal Funding Approval', source: 'CNN' },
  ],
};

export async function execute(input: { category: string }) {
  try {
    const category = input.category.toLowerCase();
    const headlines = headlinesByCategory[category];

    if (!headlines) {
      return {
        error: `Unknown category: "${input.category}". Available categories: technology, science, business, sports, entertainment, general`,
      };
    }

    // Shuffle and pick 5
    const shuffled = [...headlines].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 5);

    return {
      category: input.category,
      headlines: selected.map((h, i) => ({
        rank: i + 1,
        headline: h.headline,
        source: h.source,
      })),
      note: 'Headlines are simulated for demonstration purposes.',
    };
  } catch (error: any) {
    return { error: `News fetch failed: ${error.message}` };
  }
}
