/**
 * Bot Detection Module
 *
 * Identifies bot traffic to:
 * 1. Filter from analytics (optional)
 * 2. Mark in database for reporting
 * 3. Protect against abuse
 *
 * Detection Methods:
 * - User-Agent pattern matching (primary)
 * - Request frequency analysis (secondary)
 * - Missing/suspicious headers (supplementary)
 *
 * Design Trade-offs:
 * - False positives: Some legitimate tools (curl, wget) are marked as bots
 * - False negatives: Sophisticated bots may evade detection
 * - Performance: Pattern matching is O(n) where n = number of patterns
 *
 * For high-volume production:
 * - Consider using a bloom filter for IP reputation
 * - Integrate with external bot detection services (Cloudflare, Fastly)
 * - Use ML-based detection for better accuracy
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent
 */

import type { BotDetectionResult } from "./types.js";

// =============================================================================
// Bot User-Agent Patterns
// =============================================================================

/**
 * Known bot User-Agent patterns (case-insensitive)
 *
 * Categories:
 * - Search engine crawlers (Googlebot, Bingbot, etc.)
 * - SEO tools (Ahrefs, SEMrush, Majestic)
 * - Social media crawlers (Facebook, Twitter, LinkedIn)
 * - Monitoring tools (Pingdom, UptimeRobot)
 * - Generic bots and scripts
 */
const BOT_USER_AGENT_PATTERNS: readonly RegExp[] = [
  // Search engines
  /googlebot/i,
  /bingbot/i,
  /slurp/i, // Yahoo
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /sogou/i,
  /exabot/i,
  /facebot/i,
  /ia_archiver/i, // Alexa

  // SEO tools
  /ahrefs/i,
  /semrush/i,
  /mj12bot/i, // Majestic
  /dotbot/i,
  /rogerbot/i,
  /screaming frog/i,

  // Social media
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /pinterest/i,
  /slackbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /discordbot/i,

  // Monitoring & testing
  /pingdom/i,
  /uptimerobot/i,
  /statuscake/i,
  /site24x7/i,
  /newrelicpinger/i,
  /datadog/i,

  // Generic bot patterns
  /bot\b/i,
  /crawl/i,
  /spider/i,
  /scraper/i,
  /headless/i,
  /phantom/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,

  // HTTP libraries (often used programmatically)
  /curl/i,
  /wget/i,
  /python-requests/i,
  /python-urllib/i,
  /httpx/i,
  /axios/i,
  /node-fetch/i,
  /go-http-client/i,
  /java\//i,
  /okhttp/i,
  /apache-httpclient/i,

  // Preview generators
  /preview/i,
  /embed/i,
  /unfurl/i,
];

/**
 * Suspicious User-Agent patterns that indicate potential bots
 * Lower confidence than known bots
 */
const SUSPICIOUS_USER_AGENT_PATTERNS: readonly RegExp[] = [
  // Very short user agents
  /^.{0,10}$/,

  // Missing browser identifier
  /^Mozilla\/\d\.\d$/,

  // Only contains version numbers
  /^\d+\.\d+(\.\d+)?$/,
];

// =============================================================================
// Request Frequency Tracking
// =============================================================================

/**
 * In-memory rate limiter for bot detection
 * Uses a sliding window counter pattern
 *
 * Trade-offs:
 * - Memory: O(n) where n = unique IPs in window
 * - Accuracy: Per-process only; distributed systems need Redis
 * - Cleanup: Automatic via setTimeout (may leak on high traffic)
 *
 * For production at scale:
 * - Use Redis sorted sets for distributed rate limiting
 * - Use a bloom filter for space efficiency
 * - Consider using a dedicated rate limiting service
 */
class RequestFrequencyTracker {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly requests: Map<string, number[]>;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(windowMs = 60_000, maxRequests = 30) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();

    // Periodic cleanup to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), windowMs);
  }

  /**
   * Record a request and check if it exceeds the threshold
   */
  isHighFrequency(ipHash: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get existing requests for this IP
    let timestamps = this.requests.get(ipHash) || [];

    // Filter to only requests within the window
    timestamps = timestamps.filter((ts) => ts > windowStart);

    // Add current request
    timestamps.push(now);
    this.requests.set(ipHash, timestamps);

    // Check if over threshold
    return timestamps.length > this.maxRequests;
  }

  /**
   * Clean up old entries to prevent memory growth
   */
  private cleanup(): void {
    const windowStart = Date.now() - this.windowMs;

    for (const [ip, timestamps] of this.requests.entries()) {
      const recent = timestamps.filter((ts) => ts > windowStart);
      if (recent.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, recent);
      }
    }
  }

  /**
   * Shut down the tracker (for graceful shutdown)
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.requests.clear();
  }

  /**
   * Get current tracking stats (for monitoring)
   */
  getStats(): { uniqueIPs: number; totalRequests: number } {
    let totalRequests = 0;
    for (const timestamps of this.requests.values()) {
      totalRequests += timestamps.length;
    }
    return {
      uniqueIPs: this.requests.size,
      totalRequests,
    };
  }
}

// Global tracker instance (singleton)
let frequencyTracker: RequestFrequencyTracker | null = null;

function getFrequencyTracker(): RequestFrequencyTracker {
  if (!frequencyTracker) {
    // 30 requests per minute threshold
    // Adjust based on expected legitimate traffic patterns
    frequencyTracker = new RequestFrequencyTracker(60_000, 30);
  }
  return frequencyTracker;
}

// =============================================================================
// Main Detection Function
// =============================================================================

/**
 * Detect if a request is from a bot
 *
 * Detection priority:
 * 1. Missing User-Agent → likely bot (confidence: 0.9)
 * 2. Known bot pattern → definitely bot (confidence: 0.95)
 * 3. High request frequency → likely bot (confidence: 0.8)
 * 4. Suspicious User-Agent → maybe bot (confidence: 0.6)
 *
 * @param userAgent - User-Agent header from request
 * @param ipHash - Hashed IP for frequency tracking
 * @returns Detection result with confidence score
 */
export function detectBot(
  userAgent: string | undefined,
  ipHash?: string
): BotDetectionResult {
  // Check 1: Missing User-Agent
  if (!userAgent || userAgent.trim() === "") {
    return {
      isBot: true,
      reason: "missing_user_agent",
      confidence: 0.9,
    };
  }

  const ua = userAgent.toLowerCase();

  // Check 2: Known bot patterns (high confidence)
  for (const pattern of BOT_USER_AGENT_PATTERNS) {
    if (pattern.test(ua)) {
      return {
        isBot: true,
        reason: "user_agent_pattern",
        confidence: 0.95,
      };
    }
  }

  // Check 3: Request frequency (if IP hash provided)
  if (ipHash) {
    const tracker = getFrequencyTracker();
    if (tracker.isHighFrequency(ipHash)) {
      return {
        isBot: true,
        reason: "request_frequency",
        confidence: 0.8,
      };
    }
  }

  // Check 4: Suspicious patterns (lower confidence)
  for (const pattern of SUSPICIOUS_USER_AGENT_PATTERNS) {
    if (pattern.test(ua)) {
      return {
        isBot: true,
        reason: "suspicious_headers",
        confidence: 0.6,
      };
    }
  }

  // Not detected as bot
  return {
    isBot: false,
    confidence: 0,
  };
}

/**
 * Quick check if User-Agent matches known bot pattern
 * Faster than full detection (no frequency tracking)
 */
export function isKnownBot(userAgent: string | undefined): boolean {
  if (!userAgent) return true;

  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENT_PATTERNS.some((pattern) => pattern.test(ua));
}

/**
 * Get frequency tracker stats for monitoring
 */
export function getFrequencyStats(): { uniqueIPs: number; totalRequests: number } {
  return getFrequencyTracker().getStats();
}

/**
 * Shutdown bot detection (for graceful shutdown)
 */
export function shutdownBotDetection(): void {
  if (frequencyTracker) {
    frequencyTracker.shutdown();
    frequencyTracker = null;
  }
}
