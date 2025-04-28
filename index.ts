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

// YouTube API base URL
const YT_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
// Replace with your actual YouTube API key
const YT_API_KEY = process.env.YT_API_KEY || "your_youtube_api_key_here";

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

// Function to search YouTube for potentially impersonating channels
async function searchYouTubeChannels(
  options: CrawlOptions,
): Promise<ImpersonatingAccount[]> {
  const {
    keyword,
    limit = 50, // YouTube API typically allows more results than Facebook
    throttleMs = 1000,
    fuzzyThreshold = 0.7,
  } = options;

  const results: ImpersonatingAccount[] = [];

  try {
    // Search for channels matching the keyword
    const searchUrl = `${YT_API_BASE_URL}/search?part=snippet&type=channel&q=${encodeURIComponent(keyword)}&maxResults=${limit}&key=${YT_API_KEY}`;

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
    for (const item of data.items || []) {
      // Apply throttling
      await setTimeout(throttleMs);

      const { title, description, channelId } = item.snippet;
      const channelUrl = `https://www.youtube.com/channel/${channelId}`;

      // Check if the name matches our keyword with fuzzy matching
      const similarity = calculateSimilarity(title, keyword);

      if (similarity >= fuzzyThreshold) {
        results.push({
          name: title,
          description: description,
          url: channelUrl,
        });
      } else {
        // Check if the description contains the keyword
        if (
          description &&
          description.toLowerCase().includes(keyword.toLowerCase())
        ) {
          results.push({
            name: title,
            description: description,
            url: channelUrl,
          });
        }
      }

      // For channels we find, also get their detailed info
      const channelUrl = `${YT_API_BASE_URL}/channels?part=snippet,brandingSettings&id=${channelId}&key=${YT_API_KEY}`;

      try {
        const channelResponse = await fetch(channelUrl);
        if (channelResponse.ok) {
          const channelData = await channelResponse.json();

          if (channelData.items && channelData.items.length > 0) {
            const channelDetails = channelData.items[0];

            // Check if channel description or about text contains relevant keywords
            const channelDescription =
              channelDetails.snippet?.description || "";
            const channelAbout =
              channelDetails.brandingSettings?.channel?.description || "";

            // Re-evaluate based on more detailed info
            if (
              channelDescription
                .toLowerCase()
                .includes(keyword.toLowerCase()) ||
              channelAbout.toLowerCase().includes(keyword.toLowerCase())
            ) {
              // Only add if not already in results
              if (
                !results.some(
                  (r) =>
                    r.url === `https://www.youtube.com/channel/${channelId}`,
                )
              ) {
                results.push({
                  name: title,
                  description: channelDescription || channelAbout,
                  url: `https://www.youtube.com/channel/${channelId}`,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error fetching channel details for ${channelId}:`, err);
      }

      // Apply throttling again
      await setTimeout(throttleMs);
    }

    return results;
  } catch (error) {
    console.error("Error searching YouTube channels:", error);
    return [];
  }
}

// Alternative approach using web scraping (as a fallback)
async function scrapeYouTubeResults(
  keyword: string,
  throttleMs = 2000,
): Promise<ImpersonatingAccount[]> {
  const results: ImpersonatingAccount[] = [];

  try {
    // This is a simplified example and would need to be extended with proper parsing
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=EgIQAg%253D%253D`; // Filter for channels

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

    // A very basic regex pattern to find channel information
    // In a real implementation, you'd want to use a proper HTML parser
    const channelRegex = /href="\/(@[^"]+)"[^>]*>[^<]*<\/a>/g;

    let match;
    while ((match = channelRegex.exec(html)) !== null) {
      await setTimeout(throttleMs);

      const handle = match[1];
      // Fetch the channel page to get more details
      const channelUrl = `https://www.youtube.com/${handle}`;

      try {
        const channelResponse = await fetch(channelUrl);
        if (channelResponse.ok) {
          const channelHtml = await channelResponse.text();

          // Extract the channel name (very simplified)
          const nameMatch = channelHtml.match(
            /<meta property="og:title" content="([^"]+)"/,
          );
          const name = nameMatch ? nameMatch[1] : handle;

          // Extract description (very simplified)
          const descMatch = channelHtml.match(
            /<meta property="og:description" content="([^"]+)"/,
          );
          const description = descMatch ? descMatch[1] : "";

          const similarity = calculateSimilarity(name, keyword);

          if (
            similarity >= 0.7 ||
            description.toLowerCase().includes(keyword.toLowerCase())
          ) {
            results.push({
              name,
              description,
              url: channelUrl,
            });
          }
        }
      } catch (err) {
        console.error(`Error fetching channel page for ${handle}:`, err);
      }

      // Apply throttling again
      await setTimeout(throttleMs);
    }

    return results;
  } catch (error) {
    console.error("Error scraping YouTube results:", error);
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
      limit: limit || 50,
      throttleMs: throttleMs || 1000,
      fuzzyThreshold: fuzzyThreshold || 0.7,
    };

    // Use the YouTube API method first
    let results = await searchYouTubeChannels(options);

    // If no results or API failed, try scraping (fallback)
    if (results.length === 0) {
      console.log("No results from API, trying scraping fallback");
      results = await scrapeYouTubeResults(keyword, options.throttleMs);
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

// Extended search endpoint that combines channel and video searches
app.post("/api/extended-search", async (c) => {
  try {
    const body = await c.req.json();
    const { keyword, limit, throttleMs, fuzzyThreshold } = body;

    if (!keyword) {
      return c.json({ error: "Keyword is required" }, 400);
    }

    const options: CrawlOptions = {
      keyword,
      limit: limit || 30,
      throttleMs: throttleMs || 1000,
      fuzzyThreshold: fuzzyThreshold || 0.7,
    };

    // Search for channels
    const channelResults = await searchYouTubeChannels(options);

    // Also search for videos that might be from impersonating channels
    const videoSearchUrl = `${YT_API_BASE_URL}/search?part=snippet&type=video&q=${encodeURIComponent(keyword)}&maxResults=${options.limit}&key=${YT_API_KEY}`;

    const videoResponse = await fetch(videoSearchUrl);
    let videoChannels: ImpersonatingAccount[] = [];

    if (videoResponse.ok) {
      const videoData = await videoResponse.json();
      const channelIds = new Set<string>();

      // Collect unique channel IDs from video results
      for (const item of videoData.items || []) {
        const { channelId, channelTitle } = item.snippet;

        if (!channelIds.has(channelId)) {
          channelIds.add(channelId);

          const similarity = calculateSimilarity(channelTitle, keyword);

          if (similarity >= options.fuzzyThreshold) {
            videoChannels.push({
              name: channelTitle,
              url: `https://www.youtube.com/channel/${channelId}`,
            });
          }
        }

        // Apply throttling
        await setTimeout(options.throttleMs);
      }
    }

    // Combine results, removing duplicates
    const allResults = [...channelResults];

    for (const channel of videoChannels) {
      if (!allResults.some((r) => r.url === channel.url)) {
        allResults.push(channel);
      }
    }

    return c.json({
      keyword,
      count: allResults.length,
      results: allResults,
    });
  } catch (error) {
    console.error("Error processing extended search request:", error);
    return c.json({ error: "Failed to process extended search request" }, 500);
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
