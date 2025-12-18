/**
 * Database Seeding Script
 *
 * Populates the database with initial data for development and testing.
 *
 * Usage:
 *   pnpm db:seed          # Seed only if empty
 *   pnpm db:seed:force    # Truncate and reseed
 *
 * Data Created:
 *   - 3 users (admin, user, demo)
 *   - 10 links (active, expired, disabled, custom alias)
 *   - 100 click events
 *   - 7 days of aggregated stats
 */

import { PrismaClient, LinkLifecycleState } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

// =============================================================================
// Configuration
// =============================================================================

const prisma = new PrismaClient();

/** Check for --force flag */
const FORCE_RESEED = process.argv.includes("--force");

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Hash a password using SHA-256 (simplified for demo; use bcrypt in production)
 */
function hashPassword(password: string): string {
  // In production, use bcrypt with proper salt rounds
  // This is simplified for seeding demo data
  const salt = "quicklink-dev-salt";
  return createHash("sha256").update(password + salt).digest("hex");
}

/**
 * Generate a random short code
 */
function generateShortCode(length = 7): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

/**
 * Get a random element from an array
 */
function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get a random date within the last N days
 */
function randomDateWithinDays(days: number): Date {
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const randomMs = Math.floor(Math.random() * days * msPerDay);
  return new Date(now - randomMs);
}

/**
 * Get date N days ago at midnight (for aggregations)
 */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Log with timestamp
 */
function log(message: string): void {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
  console.log(`[${timestamp}] ${message}`);
}

// =============================================================================
// Seed Data
// =============================================================================

/** Users to create */
const USERS_DATA = [
  {
    email: "admin@quicklink.io",
    password: "admin123",
    name: "Admin User",
    isAdmin: true,
  },
  {
    email: "user@quicklink.io",
    password: "user123",
    name: "Regular User",
    isAdmin: false,
  },
  {
    email: "demo@quicklink.io",
    password: "demo123",
    name: "Demo User",
    isAdmin: false,
  },
];

/** Sample target URLs */
const TARGET_URLS = [
  "https://www.google.com",
  "https://github.com",
  "https://stackoverflow.com",
  "https://developer.mozilla.org",
  "https://www.reddit.com",
  "https://news.ycombinator.com",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://en.wikipedia.org/wiki/URL_shortening",
  "https://www.amazon.com/dp/B08N5WRWNW",
  "https://medium.com/@example/best-practices-2024",
];

/** Sample referrers */
const REFERRERS = [
  "https://twitter.com/",
  "https://www.facebook.com/",
  "https://www.linkedin.com/",
  "https://www.reddit.com/r/programming/",
  "https://news.ycombinator.com/",
  "https://www.google.com/search?q=url+shortener",
  null, // Direct traffic
  null,
  null,
];

/** Sample user agents */
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", // Bot
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", // Bot
  "curl/8.4.0", // Bot/tool
];

/** Sample countries */
const COUNTRIES = [
  { code: "US", region: "California" },
  { code: "US", region: "New York" },
  { code: "US", region: "Texas" },
  { code: "GB", region: "England" },
  { code: "DE", region: "Bavaria" },
  { code: "FR", region: "Île-de-France" },
  { code: "JP", region: "Tokyo" },
  { code: "AU", region: "New South Wales" },
  { code: "CA", region: "Ontario" },
  { code: "BR", region: "São Paulo" },
];

/** Sample IP addresses (fake but realistic format) */
function generateFakeIP(): string {
  const isIPv6 = Math.random() < 0.1; // 10% IPv6
  if (isIPv6) {
    return `2001:db8:${randomBytes(2).toString("hex")}::${randomBytes(2).toString("hex")}`;
  }
  return `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
}

// =============================================================================
// Seeding Functions
// =============================================================================

/**
 * Truncate all tables (for --force reseed)
 */
async function truncateTables(): Promise<void> {
  log("Truncating all tables...");

  // Order matters due to foreign key constraints
  await prisma.aggregatedStat.deleteMany({});
  await prisma.clickEvent.deleteMany({});
  await prisma.link.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.reservedAlias.deleteMany({});

  log("All tables truncated");
}

/**
 * Check if database already has data
 */
async function hasExistingData(): Promise<boolean> {
  const userCount = await prisma.user.count();
  const linkCount = await prisma.link.count();
  return userCount > 0 || linkCount > 0;
}

/**
 * Seed users
 */
async function seedUsers(): Promise<Map<string, bigint>> {
  log("Creating users...");

  const userIds = new Map<string, bigint>();

  for (const userData of USERS_DATA) {
    const user = await prisma.user.create({
      data: {
        email: userData.email,
        hashedPassword: hashPassword(userData.password),
        name: userData.name,
      },
    });

    userIds.set(userData.email, user.id);
    log(`  Created user: ${userData.email} (ID: ${user.id})`);
  }

  return userIds;
}

/**
 * Seed links
 */
async function seedLinks(userIds: Map<string, bigint>): Promise<bigint[]> {
  log("Creating links...");

  const adminId = userIds.get("admin@quicklink.io")!;
  const userId = userIds.get("user@quicklink.io")!;
  const demoId = userIds.get("demo@quicklink.io")!;

  const linkIds: bigint[] = [];

  // Link configurations
  const linksConfig = [
    // 5 active links
    {
      shortCode: generateShortCode(),
      targetUrl: TARGET_URLS[0],
      title: "Google Search",
      userId: adminId,
      lifecycleState: LinkLifecycleState.active,
    },
    {
      shortCode: generateShortCode(),
      targetUrl: TARGET_URLS[1],
      title: "GitHub",
      userId: userId,
      lifecycleState: LinkLifecycleState.active,
    },
    {
      shortCode: generateShortCode(),
      targetUrl: TARGET_URLS[2],
      title: "Stack Overflow",
      userId: userId,
      lifecycleState: LinkLifecycleState.active,
    },
    {
      shortCode: generateShortCode(),
      targetUrl: TARGET_URLS[3],
      title: "MDN Web Docs",
      userId: demoId,
      lifecycleState: LinkLifecycleState.active,
    },
    {
      shortCode: generateShortCode(),
      targetUrl: TARGET_URLS[4],
      title: null, // No title - anonymous link
      userId: null, // Anonymous
      lifecycleState: LinkLifecycleState.active,
    },

    // 2 expired links
    {
      shortCode: generateShortCode(),
      targetUrl: TARGET_URLS[5],
      title: "Expired Promo Link",
      userId: adminId,
      lifecycleState: LinkLifecycleState.expired,
      expiresAt: daysAgo(7), // Expired 7 days ago
    },
    {
      shortCode: generateShortCode(),
      targetUrl: TARGET_URLS[6],
      title: "Old Campaign",
      userId: userId,
      lifecycleState: LinkLifecycleState.expired,
      expiresAt: daysAgo(30), // Expired 30 days ago
    },

    // 2 disabled links
    {
      shortCode: generateShortCode(),
      targetUrl: TARGET_URLS[7],
      title: "Disabled by Admin",
      userId: demoId,
      lifecycleState: LinkLifecycleState.disabled,
      active: false,
    },
    {
      shortCode: generateShortCode(),
      targetUrl: TARGET_URLS[8],
      title: null,
      userId: null, // Anonymous disabled link
      lifecycleState: LinkLifecycleState.disabled,
      active: false,
    },

    // 1 custom alias link
    {
      shortCode: "my-blog", // Custom alias
      targetUrl: TARGET_URLS[9],
      title: "My Personal Blog",
      userId: userId,
      lifecycleState: LinkLifecycleState.active,
      customAlias: true,
    },
  ];

  for (const config of linksConfig) {
    const link = await prisma.link.create({
      data: {
        shortCode: config.shortCode,
        targetUrl: config.targetUrl,
        title: config.title,
        userId: config.userId,
        lifecycleState: config.lifecycleState,
        active: config.active ?? true,
        customAlias: config.customAlias ?? false,
        expiresAt: config.expiresAt ?? null,
      },
    });

    linkIds.push(link.id);
    log(`  Created link: ${link.shortCode} -> ${link.targetUrl.slice(0, 40)}...`);
  }

  return linkIds;
}

/**
 * Seed click events
 */
async function seedClickEvents(linkIds: bigint[]): Promise<void> {
  log("Creating click events (100 total)...");

  // Only use active links for click events (first 5 + last 1 custom)
  const activeLinksIds = [linkIds[0], linkIds[1], linkIds[2], linkIds[3], linkIds[4], linkIds[9]];

  const clickEvents = [];

  for (let i = 0; i < 100; i++) {
    const linkId = randomElement(activeLinksIds);
    const userAgent = randomElement(USER_AGENTS);
    const isBot = userAgent.includes("bot") || userAgent.includes("curl");
    const geo = randomElement(COUNTRIES);

    clickEvents.push({
      linkId,
      createdAt: randomDateWithinDays(30),
      ipAddress: generateFakeIP(),
      userAgent,
      referrer: randomElement(REFERRERS),
      country: geo.code,
      region: geo.region,
      bot: isBot,
    });
  }

  // Batch insert for performance
  await prisma.clickEvent.createMany({
    data: clickEvents,
  });

  log(`  Created ${clickEvents.length} click events`);

  // Log distribution
  const botClicks = clickEvents.filter((e) => e.bot).length;
  log(`  Bot traffic: ${botClicks} clicks (${((botClicks / clickEvents.length) * 100).toFixed(1)}%)`);
}

/**
 * Seed aggregated stats for the past 7 days
 */
async function seedAggregatedStats(linkIds: bigint[]): Promise<void> {
  log("Creating aggregated stats (7 days)...");

  // Only active links
  const activeLinksIds = [linkIds[0], linkIds[1], linkIds[2], linkIds[3], linkIds[4], linkIds[9]];

  const stats = [];

  for (let day = 0; day < 7; day++) {
    const date = daysAgo(day);

    for (const linkId of activeLinksIds) {
      // Random clicks between 0-20 per day
      const clicks = Math.floor(Math.random() * 20);
      // Unique visitors are typically 60-90% of clicks
      const uniqueVisitors = Math.max(1, Math.floor(clicks * (0.6 + Math.random() * 0.3)));

      if (clicks > 0) {
        stats.push({
          linkId,
          date,
          clicks: BigInt(clicks),
          uniqueVisitors: BigInt(uniqueVisitors),
        });
      }
    }
  }

  await prisma.aggregatedStat.createMany({
    data: stats,
  });

  log(`  Created ${stats.length} aggregated stat entries`);
}

/**
 * Seed reserved aliases
 */
async function seedReservedAliases(): Promise<void> {
  log("Creating reserved aliases...");

  const aliases = [
    { alias: "api", reason: "System route", category: "system" },
    { alias: "admin", reason: "System route", category: "system" },
    { alias: "health", reason: "System route", category: "system" },
    { alias: "login", reason: "System route", category: "system" },
    { alias: "signup", reason: "System route", category: "system" },
    { alias: "google", reason: "Brand protection", category: "brand" },
    { alias: "facebook", reason: "Brand protection", category: "brand" },
    { alias: "twitter", reason: "Brand protection", category: "brand" },
  ];

  await prisma.reservedAlias.createMany({
    data: aliases.map((a) => ({
      ...a,
      reservedBy: "system",
    })),
  });

  log(`  Created ${aliases.length} reserved aliases`);
}

// =============================================================================
// Main Seed Function
// =============================================================================

/**
 * Main seed function
 *
 * @param force - If true, truncate tables before seeding
 * @returns Promise resolving when seeding is complete
 */
export async function seed(force = false): Promise<void> {
  log("=== QuickLink Database Seeding ===");
  log(`Mode: ${force ? "FORCE (truncate & reseed)" : "Normal (skip if data exists)"}`);

  try {
    // Check for existing data
    if (!force && (await hasExistingData())) {
      log("Database already has data. Use --force to reseed.");
      log("Seeding skipped.");
      return;
    }

    // Truncate if force mode
    if (force) {
      await truncateTables();
    }

    // Run all seeds in a transaction
    await prisma.$transaction(async () => {
      // Seed in order (respecting foreign keys)
      const userIds = await seedUsers();
      const linkIds = await seedLinks(userIds);
      await seedClickEvents(linkIds);
      await seedAggregatedStats(linkIds);
      await seedReservedAliases();
    });

    log("=== Seeding Complete ===");
    log("");
    log("Test accounts:");
    log("  admin@quicklink.io / admin123");
    log("  user@quicklink.io  / user123");
    log("  demo@quicklink.io  / demo123");
    log("");
  } catch (error) {
    log("=== Seeding Failed ===");
    console.error(error);
    throw error;
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================

// Run when executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;

if (isMainModule) {
  seed(FORCE_RESEED)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Seed failed:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
