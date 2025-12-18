/**
 * Link Analytics Queries
 *
 * Efficient analytics functions for link click tracking and statistics.
 * Uses Prisma for database queries with proper aggregation and indexing.
 *
 * Performance Notes:
 * - Uses indexed columns for filtering (linkId, createdAt)
 * - Aggregations done at database level where possible
 * - Results cached at application layer (caller responsibility)
 *
 * Usage:
 * ```ts
 * import { getClickStats, getTopReferrers } from "@quicklink/db";
 *
 * const stats = await getClickStats("abc123", {
 *   from: new Date("2024-01-01"),
 *   to: new Date("2024-01-31"),
 * });
 * ```
 */

import { prisma, prismaReplica } from "./client.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Time period for analytics queries
 */
export interface AnalyticsPeriod {
  /** Start date (inclusive) */
  from: Date;
  /** End date (inclusive) */
  to: Date;
}

/**
 * Click statistics result
 */
export interface ClickStats {
  /** Total number of clicks */
  totalClicks: number;
  /** Clicks from bots */
  botClicks: number;
  /** Human clicks (non-bot) */
  humanClicks: number;
  /** Bot click percentage */
  botPercentage: number;
  /** Time period covered */
  period: AnalyticsPeriod;
}

/**
 * Unique visitors result
 */
export interface UniqueVisitorStats {
  /** Total unique visitors (by IP) */
  uniqueVisitors: number;
  /** Total clicks (for comparison) */
  totalClicks: number;
  /** Visitors per click ratio */
  clicksPerVisitor: number;
  /** Time period covered */
  period: AnalyticsPeriod;
}

/**
 * Referrer statistics
 */
export interface ReferrerStats {
  /** Referrer URL or "(direct)" for null */
  referrer: string;
  /** Number of clicks from this referrer */
  clicks: number;
  /** Percentage of total clicks */
  percentage: number;
}

/**
 * Geographic distribution entry
 */
export interface GeoEntry {
  /** ISO 3166-1 alpha-2 country code */
  country: string;
  /** Region/state name */
  region: string | null;
  /** Number of clicks from this location */
  clicks: number;
  /** Percentage of total clicks */
  percentage: number;
}

/**
 * Geographic distribution result
 */
export interface GeoDistribution {
  /** Breakdown by country and region */
  entries: GeoEntry[];
  /** Total clicks with geo data */
  totalWithGeo: number;
  /** Clicks without geo data */
  unknownLocation: number;
}

/**
 * Click trend entry (for time series)
 */
export interface TrendEntry {
  /** Date for this data point */
  date: Date;
  /** Number of clicks on this date */
  clicks: number;
  /** Unique visitors on this date */
  uniqueVisitors: number;
}

/**
 * Click trends result
 */
export interface ClickTrends {
  /** Daily data points */
  data: TrendEntry[];
  /** Total days in range */
  totalDays: number;
  /** Average clicks per day */
  avgClicksPerDay: number;
  /** Peak day */
  peakDay: TrendEntry | null;
}

/**
 * Analytics error for invalid input or not found
 */
export class AnalyticsError extends Error {
  constructor(
    message: string,
    public readonly code: "LINK_NOT_FOUND" | "INVALID_INPUT" | "QUERY_ERROR"
  ) {
    super(message);
    this.name = "AnalyticsError";
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the Prisma client (use replica for read-heavy analytics if available)
 */
function getClient() {
  return prismaReplica || prisma;
}

/**
 * Get default period (last 30 days)
 */
function getDefaultPeriod(): AnalyticsPeriod {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date();
  from.setDate(from.getDate() - 30);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * Validate period input
 */
function validatePeriod(period?: AnalyticsPeriod): AnalyticsPeriod {
  const p = period || getDefaultPeriod();

  if (p.from > p.to) {
    throw new AnalyticsError(
      "Invalid period: 'from' date must be before 'to' date",
      "INVALID_INPUT"
    );
  }

  return p;
}

/**
 * Find link by shortCode or ID, throw if not found
 */
async function findLinkOrThrow(linkId: string): Promise<bigint> {
  const client = getClient();

  // Try to parse as bigint ID first
  let numericId: bigint | null = null;
  try {
    numericId = BigInt(linkId);
  } catch {
    // Not a numeric ID, treat as shortCode
  }

  const link = await client.link.findFirst({
    where: numericId
      ? { id: numericId, deletedAt: null }
      : { shortCode: linkId, deletedAt: null },
    select: { id: true },
  });

  if (!link) {
    throw new AnalyticsError(
      `Link not found: ${linkId}`,
      "LINK_NOT_FOUND"
    );
  }

  return link.id;
}

// =============================================================================
// Analytics Functions
// =============================================================================

/**
 * Get click statistics for a link
 *
 * @param linkId - Short code or numeric ID of the link
 * @param period - Optional time period (defaults to last 30 days)
 * @returns Click statistics including bot/human breakdown
 *
 * @example
 * ```ts
 * const stats = await getClickStats("abc123");
 * console.log(`Total: ${stats.totalClicks}, Bots: ${stats.botPercentage}%`);
 * ```
 */
export async function getClickStats(
  linkId: string,
  period?: AnalyticsPeriod
): Promise<ClickStats> {
  const client = getClient();
  const id = await findLinkOrThrow(linkId);
  const p = validatePeriod(period);

  const [totalResult, botResult] = await Promise.all([
    client.clickEvent.count({
      where: {
        linkId: id,
        createdAt: { gte: p.from, lte: p.to },
      },
    }),
    client.clickEvent.count({
      where: {
        linkId: id,
        createdAt: { gte: p.from, lte: p.to },
        bot: true,
      },
    }),
  ]);

  const totalClicks = totalResult;
  const botClicks = botResult;
  const humanClicks = totalClicks - botClicks;
  const botPercentage = totalClicks > 0
    ? Math.round((botClicks / totalClicks) * 100 * 10) / 10
    : 0;

  return {
    totalClicks,
    botClicks,
    humanClicks,
    botPercentage,
    period: p,
  };
}

/**
 * Get unique visitor count for a link
 *
 * @param linkId - Short code or numeric ID of the link
 * @param period - Optional time period (defaults to last 30 days)
 * @returns Unique visitor statistics
 *
 * @example
 * ```ts
 * const visitors = await getUniqueVisitors("abc123");
 * console.log(`Unique: ${visitors.uniqueVisitors}, Ratio: ${visitors.clicksPerVisitor}`);
 * ```
 */
export async function getUniqueVisitors(
  linkId: string,
  period?: AnalyticsPeriod
): Promise<UniqueVisitorStats> {
  const client = getClient();
  const id = await findLinkOrThrow(linkId);
  const p = validatePeriod(period);

  // Count total clicks
  const totalClicks = await client.clickEvent.count({
    where: {
      linkId: id,
      createdAt: { gte: p.from, lte: p.to },
    },
  });

  // Get unique IPs using groupBy
  const uniqueIps = await client.clickEvent.groupBy({
    by: ["ipAddress"],
    where: {
      linkId: id,
      createdAt: { gte: p.from, lte: p.to },
      ipAddress: { not: null },
    },
    _count: true,
  });

  const uniqueVisitors = uniqueIps.length;
  const clicksPerVisitor = uniqueVisitors > 0
    ? Math.round((totalClicks / uniqueVisitors) * 100) / 100
    : 0;

  return {
    uniqueVisitors,
    totalClicks,
    clicksPerVisitor,
    period: p,
  };
}

/**
 * Get top referrers for a link
 *
 * @param linkId - Short code or numeric ID of the link
 * @param limit - Maximum number of referrers to return (default: 10)
 * @returns Array of referrer statistics sorted by click count
 *
 * @example
 * ```ts
 * const referrers = await getTopReferrers("abc123", 5);
 * referrers.forEach(r => console.log(`${r.referrer}: ${r.clicks} clicks`));
 * ```
 */
export async function getTopReferrers(
  linkId: string,
  limit = 10
): Promise<ReferrerStats[]> {
  const client = getClient();
  const id = await findLinkOrThrow(linkId);

  if (limit < 1 || limit > 100) {
    throw new AnalyticsError(
      "Limit must be between 1 and 100",
      "INVALID_INPUT"
    );
  }

  // Get total clicks for percentage calculation
  const totalClicks = await client.clickEvent.count({
    where: { linkId: id },
  });

  if (totalClicks === 0) {
    return [];
  }

  // Group by referrer
  const referrerGroups = await client.clickEvent.groupBy({
    by: ["referrer"],
    where: { linkId: id },
    _count: { _all: true },
    orderBy: { _count: { referrer: "desc" } },
    take: limit,
  });

  return referrerGroups.map((group) => ({
    referrer: group.referrer || "(direct)",
    clicks: group._count._all,
    percentage: Math.round((group._count._all / totalClicks) * 100 * 10) / 10,
  }));
}

/**
 * Get geographic distribution of clicks for a link
 *
 * @param linkId - Short code or numeric ID of the link
 * @returns Geographic distribution with country/region breakdown
 *
 * @example
 * ```ts
 * const geo = await getGeoDistribution("abc123");
 * geo.entries.forEach(e => console.log(`${e.country}: ${e.clicks} clicks`));
 * ```
 */
export async function getGeoDistribution(
  linkId: string
): Promise<GeoDistribution> {
  const client = getClient();
  const id = await findLinkOrThrow(linkId);

  // Get total clicks
  const totalClicks = await client.clickEvent.count({
    where: { linkId: id },
  });

  if (totalClicks === 0) {
    return {
      entries: [],
      totalWithGeo: 0,
      unknownLocation: 0,
    };
  }

  // Group by country and region
  const geoGroups = await client.clickEvent.groupBy({
    by: ["country", "region"],
    where: {
      linkId: id,
      country: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { country: "desc" } },
  });

  // Count clicks without geo data
  const unknownLocation = await client.clickEvent.count({
    where: {
      linkId: id,
      country: null,
    },
  });

  const totalWithGeo = totalClicks - unknownLocation;

  const entries: GeoEntry[] = geoGroups.map((group) => ({
    country: group.country!,
    region: group.region,
    clicks: group._count._all,
    percentage: totalWithGeo > 0
      ? Math.round((group._count._all / totalWithGeo) * 100 * 10) / 10
      : 0,
  }));

  return {
    entries,
    totalWithGeo,
    unknownLocation,
  };
}

/**
 * Get click trends for a link over time
 *
 * Uses aggregated_stats table if available, falls back to click_events.
 *
 * @param linkId - Short code or numeric ID of the link
 * @param days - Number of days to include (default: 7)
 * @returns Daily click trends with statistics
 *
 * @example
 * ```ts
 * const trends = await getClickTrends("abc123", 14);
 * console.log(`Peak day: ${trends.peakDay?.date} with ${trends.peakDay?.clicks} clicks`);
 * ```
 */
export async function getClickTrends(
  linkId: string,
  days = 7
): Promise<ClickTrends> {
  const client = getClient();
  const id = await findLinkOrThrow(linkId);

  if (days < 1 || days > 365) {
    throw new AnalyticsError(
      "Days must be between 1 and 365",
      "INVALID_INPUT"
    );
  }

  // Calculate date range
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);

  // Try aggregated stats first (faster for large datasets)
  const aggregatedStats = await client.aggregatedStat.findMany({
    where: {
      linkId: id,
      date: { gte: from, lte: to },
    },
    orderBy: { date: "asc" },
  });

  let data: TrendEntry[];

  if (aggregatedStats.length > 0) {
    // Use pre-aggregated data
    data = aggregatedStats.map((stat) => ({
      date: stat.date,
      clicks: Number(stat.clicks),
      uniqueVisitors: Number(stat.uniqueVisitors),
    }));
  } else {
    // Fall back to calculating from click_events
    // Group clicks by date
    const clickGroups = await client.clickEvent.groupBy({
      by: ["createdAt"],
      where: {
        linkId: id,
        createdAt: { gte: from, lte: to },
      },
      _count: { _all: true },
    });

    // Aggregate by day
    const dailyMap = new Map<string, { clicks: number; ips: Set<string> }>();

    // Initialize all days in range
    for (let d = 0; d < days; d++) {
      const date = new Date(from);
      date.setDate(date.getDate() + d);
      const key = date.toISOString().split("T")[0];
      dailyMap.set(key, { clicks: 0, ips: new Set() });
    }

    // Get all click events for unique visitor calculation
    const clicks = await client.clickEvent.findMany({
      where: {
        linkId: id,
        createdAt: { gte: from, lte: to },
      },
      select: {
        createdAt: true,
        ipAddress: true,
      },
    });

    clicks.forEach((click) => {
      const key = click.createdAt.toISOString().split("T")[0];
      const entry = dailyMap.get(key);
      if (entry) {
        entry.clicks++;
        if (click.ipAddress) {
          entry.ips.add(click.ipAddress);
        }
      }
    });

    data = Array.from(dailyMap.entries()).map(([dateStr, entry]) => ({
      date: new Date(dateStr),
      clicks: entry.clicks,
      uniqueVisitors: entry.ips.size,
    }));
  }

  // Calculate statistics
  const totalClicks = data.reduce((sum, d) => sum + d.clicks, 0);
  const avgClicksPerDay = days > 0 ? Math.round((totalClicks / days) * 100) / 100 : 0;

  // Find peak day
  let peakDay: TrendEntry | null = null;
  for (const entry of data) {
    if (!peakDay || entry.clicks > peakDay.clicks) {
      peakDay = entry;
    }
  }

  return {
    data,
    totalDays: days,
    avgClicksPerDay,
    peakDay: peakDay?.clicks > 0 ? peakDay : null,
  };
}

/**
 * Get link summary with all analytics
 *
 * Convenience function that combines multiple analytics queries.
 *
 * @param linkId - Short code or numeric ID of the link
 * @returns Combined analytics summary
 */
export async function getLinkAnalyticsSummary(linkId: string): Promise<{
  clickStats: ClickStats;
  visitors: UniqueVisitorStats;
  topReferrers: ReferrerStats[];
  geoDistribution: GeoDistribution;
  trends: ClickTrends;
}> {
  const [clickStats, visitors, topReferrers, geoDistribution, trends] =
    await Promise.all([
      getClickStats(linkId),
      getUniqueVisitors(linkId),
      getTopReferrers(linkId, 5),
      getGeoDistribution(linkId),
      getClickTrends(linkId, 7),
    ]);

  return {
    clickStats,
    visitors,
    topReferrers,
    geoDistribution,
    trends,
  };
}

// =============================================================================
// CLI Support (for debugging)
// =============================================================================

/**
 * Run analytics from command line
 * Usage: tsx src/analytics.ts <linkId>
 */
async function main(): Promise<void> {
  const linkId = process.argv[2];

  if (!linkId) {
    console.log("Usage: tsx src/analytics.ts <linkId>");
    console.log("Example: tsx src/analytics.ts abc123");
    process.exit(1);
  }

  console.log(`\n📊 Analytics for link: ${linkId}\n`);

  try {
    const summary = await getLinkAnalyticsSummary(linkId);

    console.log("=== Click Statistics ===");
    console.log(`  Total clicks: ${summary.clickStats.totalClicks}`);
    console.log(`  Human clicks: ${summary.clickStats.humanClicks}`);
    console.log(`  Bot clicks: ${summary.clickStats.botClicks} (${summary.clickStats.botPercentage}%)`);

    console.log("\n=== Unique Visitors ===");
    console.log(`  Unique visitors: ${summary.visitors.uniqueVisitors}`);
    console.log(`  Clicks per visitor: ${summary.visitors.clicksPerVisitor}`);

    console.log("\n=== Top Referrers ===");
    if (summary.topReferrers.length === 0) {
      console.log("  No referrer data");
    } else {
      summary.topReferrers.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.referrer}: ${r.clicks} clicks (${r.percentage}%)`);
      });
    }

    console.log("\n=== Geographic Distribution ===");
    if (summary.geoDistribution.entries.length === 0) {
      console.log("  No geo data");
    } else {
      summary.geoDistribution.entries.slice(0, 5).forEach((e) => {
        console.log(`  ${e.country}${e.region ? ` (${e.region})` : ""}: ${e.clicks} clicks (${e.percentage}%)`);
      });
      if (summary.geoDistribution.unknownLocation > 0) {
        console.log(`  Unknown: ${summary.geoDistribution.unknownLocation} clicks`);
      }
    }

    console.log("\n=== 7-Day Trends ===");
    console.log(`  Average: ${summary.trends.avgClicksPerDay} clicks/day`);
    if (summary.trends.peakDay) {
      console.log(`  Peak: ${summary.trends.peakDay.date.toISOString().split("T")[0]} with ${summary.trends.peakDay.clicks} clicks`);
    }

    console.log("");
  } catch (error) {
    if (error instanceof AnalyticsError) {
      console.error(`Error [${error.code}]: ${error.message}`);
    } else {
      console.error("Unexpected error:", error);
    }
    process.exit(1);
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMainModule) {
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
