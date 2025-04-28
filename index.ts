import { Hono } from "hono";
import { serve } from "bun";
import { setTimeout } from "node:timers/promises";

// Types
interface ImpersonatingAccount {
  name: string;
  description?: string;
  url: string;
}

interface CrawlOptions {
  keyword: string;
  limit?: number;
  throttleMs?: number;
  fuzzyThreshold?: number;
}

// Facebook Graph API base URL
const FB_GRAPH_BASE_URL = "https://graph.facebook.com/v18.0";
// You'll need to replace this with your actual access token
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || "your_access_token_here";

// Create Hono app
const app = new Hono();

// Utility function to calculate string similarity (Levenshtein distance based)
function calculateSimilarity(str1: string, str2: string): number {
  str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();

  const len1 = str1.length;
  const len2 = str2.length;

  // Initialize the matrix
  const matrix = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Fill the first row and column
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  // Fill the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  // Calculate the distance and similarity
  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);

  // Return similarity as a percentage
  return 1 - distance / maxLen;
}

// Function to search Facebook for potentially impersonating accounts
async function searchFacebookAccounts(
  options: CrawlOptions,
): Promise<ImpersonatingAccount[]> {
  const {
    keyword,
    limit = 25,
    throttleMs = 1000,
    fuzzyThreshold = 0.7,
  } = options;

  const results: ImpersonatingAccount[] = [];

  try {
    // Search for pages first
    const searchUrl = `${FB_GRAPH_BASE_URL}/search?q=${encodeURIComponent(keyword)}&type=page&limit=${limit}&fields=name,about,link&access_token=${FB_ACCESS_TOKEN}`;

    const response = await fetch(searchUrl);
    if (!response.ok) {
      console.error(
        `API request failed: ${response.status} ${response.statusText}`,
      );
      console.error(await response.text());
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();

    // Process each result
    for (const item of data.data || []) {
      // Apply throttling
      await setTimeout(throttleMs);

      const { name, about, link } = item;

      // Check if the name matches our keyword with fuzzy matching
      const similarity = calculateSimilarity(name, keyword);

      if (similarity >= fuzzyThreshold) {
        results.push({
          name,
          description: about,
          url: link,
        });
      }
    }

    // For user accounts (profiles), we need to use a different approach
    // This is a simplified version and may need additional methods
    // like web scraping if the API doesn't provide enough data

    const userSearchUrl = `${FB_GRAPH_BASE_URL}/search?q=${encodeURIComponent(keyword)}&type=user&limit=${limit}&fields=name,link&access_token=${FB_ACCESS_TOKEN}`;

    const userResponse = await fetch(userSearchUrl);
    if (!userResponse.ok) {
      console.error(`User API request failed: ${userResponse.status}`);
    } else {
      const userData = await userResponse.json();

      for (const user of userData.data || []) {
        // Apply throttling
        await setTimeout(throttleMs);

        const { name, link } = user;
        const similarity = calculateSimilarity(name, keyword);

        if (similarity >= fuzzyThreshold) {
          results.push({
            name,
            url: link,
          });
        }
      }
    }

    return results;
  } catch (error) {
    console.error("Error searching Facebook accounts:", error);
    return [];
  }
}

// Alternative approach using web scraping (as a fallback)
async function scrapeFacebookResults(
  keyword: string,
  throttleMs = 2000,
): Promise<ImpersonatingAccount[]> {
  const results: ImpersonatingAccount[] = [];

  try {
    // This is a simplified example and would need to be extended with proper parsing
    const searchUrl = `https://www.facebook.com/search/pages?q=${encodeURIComponent(keyword)}`;

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to load search page: ${response.status}`);
    }

    const html = await response.text();

    // A basic regex pattern to find page information
    // In a real implementation, you'd want to use a proper HTML parser
    const pageRegex =
      /<a[^>]*href="(https:\/\/www\.facebook\.com\/[^"]+)"[^>]*><span[^>]*>([^<]+)<\/span>/g;

    let match;
    while ((match = pageRegex.exec(html)) !== null) {
      await setTimeout(throttleMs);

      const url = match[1];
      const name = match[2];

      const similarity = calculateSimilarity(name, keyword);

      if (similarity >= 0.7) {
        results.push({
          name,
          url,
        });
      }
    }

    return results;
  } catch (error) {
    console.error("Error scraping Facebook results:", error);
    return [];
  }
}

// API endpoint to start a search
app.post("/api/search", async (c) => {
  try {
    const body = await c.req.json();
    const { keyword, limit, throttleMs, fuzzyThreshold } = body;

    if (!keyword) {
      return c.json({ error: "Keyword is required" }, 400);
    }

    const options: CrawlOptions = {
      keyword,
      limit: limit || 25,
      throttleMs: throttleMs || 1000,
      fuzzyThreshold: fuzzyThreshold || 0.7,
    };

    // Use the Graph API method first
    let results = await searchFacebookAccounts(options);

    // If no results or API failed, try scraping (fallback)
    if (results.length === 0) {
      console.log("No results from API, trying scraping fallback");
      results = await scrapeFacebookResults(keyword, options.throttleMs);
    }

    return c.json({
      keyword,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("Error processing search request:", error);
    return c.json({ error: "Failed to process search request" }, 500);
  }
});

// Get all previous search results (this would be expanded with a database)
app.get("/api/results", (c) => {
  // This is a placeholder - in a real app, you'd retrieve from a database
  return c.json({
    message: "This endpoint would return saved results from a database",
  });
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// Start the server
const port = process.env.PORT || 3000;
serve({
  fetch: app.fetch,
  port,
});

console.log(`Server running at http://localhost:${port}`);
