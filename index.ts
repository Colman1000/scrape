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

// Twitter API base URL
const TWITTER_API_BASE_URL = "https://api.twitter.com/2";
// Replace with your actual Twitter API credentials
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN || "your_twitter_bearer_token_here";
const USE_API = process.env.USE_TWITTER_API === "true";

// Create Hono app
const app = new Hono();

// Utility function to calculate string similarity (Levenshtein distance based)
function calculateSimilarity(str1: string, str2: string): number {
	str1 = str1.toLowerCase();
	str2 = str2.toLowerCase();
	
	const len1 = str1.length;
	const len2 = str2.length;
	
	// Initialize the matrix
	const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
	
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
				matrix[i - 1][j - 1] + cost
			);
		}
	}
	
	// Calculate the distance and similarity
	const distance = matrix[len1][len2];
	const maxLen = Math.max(len1, len2);
	
	// Return similarity as a percentage
	return (1 - distance / maxLen);
}

// Function to search Twitter for potentially impersonating accounts using the API
async function searchTwitterAccountsViaAPI(options: CrawlOptions): Promise<ImpersonatingAccount[]> {
	const {
		keyword,
		limit = 100, // Twitter's API allows larger result sets
		throttleMs = 2000,
		fuzzyThreshold = 0.7
	} = options;
	
	const results: ImpersonatingAccount[] = [];
	
	try {
		// Search for accounts matching the keyword
		// Twitter API v2 search query to find users
		const searchUrl = `${TWITTER_API_BASE_URL}/users/search?query=${encodeURIComponent(keyword)}&max_results=${limit}`;
		
		const response = await fetch(searchUrl, {
			headers: {
				"Authorization": `Bearer ${TWITTER_BEARER_TOKEN}`,
				"Content-Type": "application/json"
			}
		});
		
		if (!response.ok) {
			console.error(`API request failed: ${response.status} ${response.statusText}`);
			console.error(await response.text());
			throw new Error(`API request failed: ${response.status}`);
		}
		
		const data = await response.json();
		
		// Process each result
		for (const user of data.data || []) {
			// Apply throttling
			await setTimeout(throttleMs);
			
			const { name, username, description } = user;
			const userUrl = `https://twitter.com/${username}`;
			
			// Check if the name or username matches our keyword with fuzzy matching
			const nameSimilarity = calculateSimilarity(name, keyword);
			const usernameSimilarity = calculateSimilarity(username, keyword);
			
			if (nameSimilarity >= fuzzyThreshold || usernameSimilarity >= fuzzyThreshold) {
				results.push({
					name: name,
					description: description,
					url: userUrl
				});
			} else if (description && description.toLowerCase().includes(keyword.toLowerCase())) {
				// Check if the description contains the keyword
				results.push({
					name: name,
					description: description,
					url: userUrl
				});
			}
		}
		
		return results;
		
	} catch (error) {
		console.error("Error searching Twitter accounts via API:", error);
		return [];
	}
}

// Function to search Twitter via web scraping (when API access is not available)
async function scrapeTwitterResults(options: CrawlOptions): Promise<ImpersonatingAccount[]> {
	const {
		keyword,
		throttleMs = 3000, // Use a more conservative throttle for scraping
		fuzzyThreshold = 0.7
	} = options;
	
	const results: ImpersonatingAccount[] = [];
	
	try {
		// Use Nitter as an alternative frontend for Twitter scraping
		// It's more reliable for scraping than twitter.com
		const searchUrl = `https://nitter.net/search?f=users&q=${encodeURIComponent(keyword)}`;
		
		const response = await fetch(searchUrl, {
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
			}
		});
		
		if (!response.ok) {
			throw new Error(`Failed to load search page: ${response.status}`);
		}
		
		const html = await response.text();
		
		// Extract user information using regex (not ideal but works for simple cases)
		// In a production environment, use a proper HTML parser
		const userPattern = /<a href="\/([^"]+)"[^>]*>([^<]+)<\/a>[^<]*<div class="tweet-content">([^<]*)<\/div>/g;
		
		let match;
		while ((match = userPattern.exec(html)) !== null) {
			await setTimeout(throttleMs);
			
			const username = match[1];
			const name = match[2].trim();
			const description = match[3].trim();
			
			const nameSimilarity = calculateSimilarity(name, keyword);
			const usernameSimilarity = calculateSimilarity(username, keyword);
			
			if (nameSimilarity >= fuzzyThreshold || usernameSimilarity >= fuzzyThreshold) {
				results.push({
					name: name,
					description: description,
					url: `https://twitter.com/${username}`
				});
			} else if (description && description.toLowerCase().includes(keyword.toLowerCase())) {
				results.push({
					name: name,
					description: description,
					url: `https://twitter.com/${username}`
				});
			}
		}
		
		return results;
	} catch (error) {
		console.error("Error scraping Twitter results:", error);
		return [];
	}
}

// Alternate scraping method using direct Twitter scraping
// Twitter changes their HTML structure frequently, so this is likely to break
async function scrapeDirectTwitterResults(options: CrawlOptions): Promise<ImpersonatingAccount[]> {
	const {
		keyword,
		throttleMs = 3000,
		fuzzyThreshold = 0.7
	} = options;
	
	const results: ImpersonatingAccount[] = [];
	
	try {
		// This URL might change as Twitter updates their site
		const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=user`;
		
		const response = await fetch(searchUrl, {
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
				"Accept": "text/html,application/xhtml+xml,application/xml",
				"Accept-Language": "en-US,en;q=0.9"
			}
		});
		
		if (!response.ok) {
			throw new Error(`Failed to load Twitter search page: ${response.status}`);
		}
		
		const html = await response.text();
		
		// Extract JSON data from the script tags
		// Twitter embeds user data in JSON objects within script tags
		const scriptDataRegex = /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/;
		const scriptMatch = html.match(scriptDataRegex);
		
		if (scriptMatch && scriptMatch[1]) {
			const jsonData = JSON.parse(scriptMatch[1]);
			// Navigate through the complex Twitter JSON structure
			// This structure might change frequently as Twitter updates their site
			
			// This is a simplified example, the actual path to user data may be different
			const users = jsonData?.props?.pageProps?.initialState?.entities?.users?.entities || {};
			
			for (const userId in users) {
				const user = users[userId];
				await setTimeout(throttleMs);
				
				const name = user.name || '';
				const username = user.screen_name || '';
				const description = user.description || '';
				
				const nameSimilarity = calculateSimilarity(name, keyword);
				const usernameSimilarity = calculateSimilarity(username, keyword);
				
				if (nameSimilarity >= fuzzyThreshold ||
					usernameSimilarity >= fuzzyThreshold ||
					description.toLowerCase().includes(keyword.toLowerCase())) {
					
					results.push({
						name,
						description,
						url: `https://twitter.com/${username}`
					});
				}
			}
		}
		
		return results;
	} catch (error) {
		console.error("Error scraping direct Twitter results:", error);
		return [];
	}
}

// Unified search function that tries all available methods
async function searchTwitterAccounts(options: CrawlOptions): Promise<ImpersonatingAccount[]> {
	// Try API first if credentials are available
	if (USE_API && TWITTER_BEARER_TOKEN && TWITTER_BEARER_TOKEN !== "your_twitter_bearer_token_here") {
		try {
			const apiResults = await searchTwitterAccountsViaAPI(options);
			if (apiResults.length > 0) {
				return apiResults;
			}
		} catch (error) {
			console.error("API search failed, falling back to scraping", error);
		}
	}
	
	// Try Nitter scraping
	try {
		const nitterResults = await scrapeTwitterResults(options);
		if (nitterResults.length > 0) {
			return nitterResults;
		}
	} catch (error) {
		console.error("Nitter scraping failed, trying direct Twitter scraping", error);
	}
	
	// Try direct Twitter scraping as last resort
	return await scrapeDirectTwitterResults(options);
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
			limit: limit || 100,
			throttleMs: throttleMs || 2000,
			fuzzyThreshold: fuzzyThreshold || 0.7
		};
		
		// Unified search function that tries different methods
		const results = await searchTwitterAccounts(options);
		
		return c.json({
			keyword,
			count: results.length,
			results
		});
	} catch (error) {
		console.error("Error processing search request:", error);
		return c.json({ error: "Failed to process search request" }, 500);
	}
});

// API endpoint to check a specific account
app.post("/api/check-account", async (c) => {
	try {
		const body = await c.req.json();
		const { username, keyword, fuzzyThreshold = 0.7 } = body;
		
		if (!username || !keyword) {
			return c.json({ error: "Both username and keyword are required" }, 400);
		}
		
		let accountData: ImpersonatingAccount | null = null;
		
		// Check via API if available
		if (USE_API && TWITTER_BEARER_TOKEN && TWITTER_BEARER_TOKEN !== "your_twitter_bearer_token_here") {
			try {
				const userUrl = `${TWITTER_API_BASE_URL}/users/by/username/${username}?user.fields=name,description`;
				
				const response = await fetch(userUrl, {
					headers: {
						"Authorization": `Bearer ${TWITTER_BEARER_TOKEN}`,
						"Content-Type": "application/json"
					}
				});
				
				if (response.ok) {
					const userData = await response.json();
					const user = userData.data;
					
					if (user) {
						const nameSimilarity = calculateSimilarity(user.name, keyword);
						const usernameSimilarity = calculateSimilarity(username, keyword);
						
						accountData = {
							name: user.name,
							description: user.description,
							url: `https://twitter.com/${username}`
						};
						
						const isImpersonating =
							nameSimilarity >= fuzzyThreshold ||
							usernameSimilarity >= fuzzyThreshold ||
							(user.description && user.description.toLowerCase().includes(keyword.toLowerCase()));
						
						return c.json({
							account: accountData,
							isImpersonating,
							similarityScore: Math.max(nameSimilarity, usernameSimilarity)
						});
					}
				}
			} catch (error) {
				console.error("Error checking account via API:", error);
			}
		}
		
		// Fallback to scraping the user profile
		try {
			const profileUrl = `https://nitter.net/${username}`;
			
			const response = await fetch(profileUrl, {
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
				}
			});
			
			if (response.ok) {
				const html = await response.text();
				
				// Extract name
				const nameMatch = html.match(/<a[^>]*class="profile-card-fullname"[^>]*>([^<]+)<\/a>/);
				const name = nameMatch ? nameMatch[1].trim() : username;
				
				// Extract bio/description
				const bioMatch = html.match(/<div class="profile-bio">([^<]+)<\/div>/);
				const description = bioMatch ? bioMatch[1].trim() : '';
				
				accountData = {
					name,
					description,
					url: `https://twitter.com/${username}`
				};
				
				const nameSimilarity = calculateSimilarity(name, keyword);
				const usernameSimilarity = calculateSimilarity(username, keyword);
				
				const isImpersonating =
					nameSimilarity >= fuzzyThreshold ||
					usernameSimilarity >= fuzzyThreshold ||
					description.toLowerCase().includes(keyword.toLowerCase());
				
				return c.json({
					account: accountData,
					isImpersonating,
					similarityScore: Math.max(nameSimilarity, usernameSimilarity)
				});
			}
		} catch (error) {
			console.error("Error checking account via scraping:", error);
		}
		
		return c.json({ error: "Could not retrieve account information" }, 404);
	} catch (error) {
		console.error("Error processing account check request:", error);
		return c.json({ error: "Failed to process account check request" }, 500);
	}
});

// Get all previous search results (this would be expanded with a database)
app.get("/api/results", (c) => {
	// This is a placeholder - in a real app, you'd retrieve from a database
	return c.json({ message: "This endpoint would return saved results from a database" });
});

// Health check endpoint
app.get("/health", (c) => {
	return c.json({ status: "ok" });
});

// Start the server
const port = process.env.PORT || 3000;
serve({
	fetch: app.fetch,
	port
});

console.log(`Server running at http://localhost:${port}`);