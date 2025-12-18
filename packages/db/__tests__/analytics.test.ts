/**
 * Link Analytics Tests
 *
 * Tests for analytics query functions.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { prisma } from "../src/client.js";
import {
  getClickStats,
  getUniqueVisitors,
  getTopReferrers,
  getGeoDistribution,
  getClickTrends,
  getLinkAnalyticsSummary,
  AnalyticsError,
} from "../src/analytics.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a test link
 */
async function createTestLink(shortCode?: string) {
  return prisma.link.create({
    data: {
      shortCode: shortCode || `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      targetUrl: "https://example.com",
    },
  });
}

/**
 * Create a test click event
 */
async function createTestClick(
  linkId: bigint,
  options?: {
    ipAddress?: string;
    userAgent?: string;
    referrer?: string;
    country?: string;
    region?: string;
    bot?: boolean;
    createdAt?: Date;
  }
) {
  return prisma.clickEvent.create({
    data: {
      linkId,
      ipAddress: options?.ipAddress || `192.168.1.${Math.floor(Math.random() * 255)}`,
      userAgent: options?.userAgent || "Mozilla/5.0 Test Browser",
      referrer: options?.referrer,
      country: options?.country,
      region: options?.region,
      bot: options?.bot ?? false,
      createdAt: options?.createdAt,
    },
  });
}

/**
 * Create multiple test clicks with variations
 */
async function createMultipleClicks(
  linkId: bigint,
  count: number,
  options?: {
    uniqueIps?: boolean;
    includeBot?: boolean;
    referrers?: string[];
    countries?: Array<{ country: string; region?: string }>;
  }
) {
  const clicks = [];
  for (let i = 0; i < count; i++) {
    clicks.push({
      linkId,
      ipAddress: options?.uniqueIps ? `192.168.1.${i}` : "192.168.1.1",
      userAgent: options?.includeBot && i % 5 === 0 ? "Googlebot" : "Mozilla/5.0",
      referrer: options?.referrers ? options.referrers[i % options.referrers.length] : null,
      country: options?.countries ? options.countries[i % options.countries.length].country : null,
      region: options?.countries ? options.countries[i % options.countries.length].region : null,
      bot: options?.includeBot ? i % 5 === 0 : false,
    });
  }

  await prisma.clickEvent.createMany({ data: clicks });
}

// =============================================================================
// Setup
// =============================================================================

beforeEach(async () => {
  // Clean up in reverse order of dependencies
  await prisma.aggregatedStat.deleteMany({});
  await prisma.clickEvent.deleteMany({});
  await prisma.link.deleteMany({});
});

// =============================================================================
// Tests: getClickStats
// =============================================================================

describe("getClickStats", () => {
  it("should return zero stats for link with no clicks", async () => {
    const link = await createTestLink("no-clicks");

    const stats = await getClickStats(link.shortCode);

    expect(stats.totalClicks).toBe(0);
    expect(stats.botClicks).toBe(0);
    expect(stats.humanClicks).toBe(0);
    expect(stats.botPercentage).toBe(0);
  });

  it("should count total clicks", async () => {
    const link = await createTestLink("with-clicks");
    await createMultipleClicks(link.id, 10);

    const stats = await getClickStats(link.shortCode);

    expect(stats.totalClicks).toBe(10);
  });

  it("should separate bot and human clicks", async () => {
    const link = await createTestLink("bot-human");
    
    // Create 8 human clicks
    for (let i = 0; i < 8; i++) {
      await createTestClick(link.id, { bot: false });
    }
    // Create 2 bot clicks
    for (let i = 0; i < 2; i++) {
      await createTestClick(link.id, { bot: true });
    }

    const stats = await getClickStats(link.shortCode);

    expect(stats.totalClicks).toBe(10);
    expect(stats.humanClicks).toBe(8);
    expect(stats.botClicks).toBe(2);
    expect(stats.botPercentage).toBe(20);
  });

  it("should filter by date range", async () => {
    const link = await createTestLink("date-range");
    
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    // Create clicks on different days
    await createTestClick(link.id, { createdAt: twoDaysAgo });
    await createTestClick(link.id, { createdAt: yesterday });
    await createTestClick(link.id, { createdAt: now });

    const stats = await getClickStats(link.shortCode, {
      from: yesterday,
      to: now,
    });

    expect(stats.totalClicks).toBe(2);
  });

  it("should work with numeric ID", async () => {
    const link = await createTestLink("numeric-id");
    await createTestClick(link.id);

    const stats = await getClickStats(link.id.toString());

    expect(stats.totalClicks).toBe(1);
  });

  it("should throw for non-existent link", async () => {
    await expect(getClickStats("nonexistent")).rejects.toThrow(AnalyticsError);
    await expect(getClickStats("nonexistent")).rejects.toThrow("LINK_NOT_FOUND");
  });

  it("should throw for invalid period (from > to)", async () => {
    const link = await createTestLink("invalid-period");
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    await expect(
      getClickStats(link.shortCode, { from: now, to: yesterday })
    ).rejects.toThrow("INVALID_INPUT");
  });
});

// =============================================================================
// Tests: getUniqueVisitors
// =============================================================================

describe("getUniqueVisitors", () => {
  it("should return zero for link with no clicks", async () => {
    const link = await createTestLink("no-visitors");

    const visitors = await getUniqueVisitors(link.shortCode);

    expect(visitors.uniqueVisitors).toBe(0);
    expect(visitors.totalClicks).toBe(0);
  });

  it("should count unique IPs", async () => {
    const link = await createTestLink("unique-ips");
    
    // 3 unique visitors, 5 total clicks
    await createTestClick(link.id, { ipAddress: "1.1.1.1" });
    await createTestClick(link.id, { ipAddress: "1.1.1.1" }); // Repeat
    await createTestClick(link.id, { ipAddress: "2.2.2.2" });
    await createTestClick(link.id, { ipAddress: "3.3.3.3" });
    await createTestClick(link.id, { ipAddress: "3.3.3.3" }); // Repeat

    const visitors = await getUniqueVisitors(link.shortCode);

    expect(visitors.uniqueVisitors).toBe(3);
    expect(visitors.totalClicks).toBe(5);
    expect(visitors.clicksPerVisitor).toBeCloseTo(1.67, 1);
  });

  it("should handle null IPs", async () => {
    const link = await createTestLink("null-ips");
    
    await createTestClick(link.id, { ipAddress: "1.1.1.1" });
    await prisma.clickEvent.create({
      data: {
        linkId: link.id,
        ipAddress: null, // Null IP
      },
    });

    const visitors = await getUniqueVisitors(link.shortCode);

    expect(visitors.uniqueVisitors).toBe(1); // Only counts non-null IPs
    expect(visitors.totalClicks).toBe(2);
  });

  it("should filter by period", async () => {
    const link = await createTestLink("visitor-period");
    
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    await createTestClick(link.id, { ipAddress: "1.1.1.1", createdAt: yesterday });
    await createTestClick(link.id, { ipAddress: "2.2.2.2", createdAt: now });

    const visitors = await getUniqueVisitors(link.shortCode, {
      from: now,
      to: now,
    });

    expect(visitors.uniqueVisitors).toBe(1);
  });
});

// =============================================================================
// Tests: getTopReferrers
// =============================================================================

describe("getTopReferrers", () => {
  it("should return empty array for link with no clicks", async () => {
    const link = await createTestLink("no-referrers");

    const referrers = await getTopReferrers(link.shortCode);

    expect(referrers).toEqual([]);
  });

  it("should return referrers sorted by count", async () => {
    const link = await createTestLink("sorted-referrers");
    
    // Twitter: 5 clicks
    for (let i = 0; i < 5; i++) {
      await createTestClick(link.id, { referrer: "https://twitter.com" });
    }
    // Facebook: 3 clicks
    for (let i = 0; i < 3; i++) {
      await createTestClick(link.id, { referrer: "https://facebook.com" });
    }
    // Google: 2 clicks
    for (let i = 0; i < 2; i++) {
      await createTestClick(link.id, { referrer: "https://google.com" });
    }

    const referrers = await getTopReferrers(link.shortCode);

    expect(referrers.length).toBe(3);
    expect(referrers[0].referrer).toBe("https://twitter.com");
    expect(referrers[0].clicks).toBe(5);
    expect(referrers[0].percentage).toBe(50);
    expect(referrers[1].referrer).toBe("https://facebook.com");
    expect(referrers[2].referrer).toBe("https://google.com");
  });

  it("should handle null referrer as (direct)", async () => {
    const link = await createTestLink("direct-referrer");
    
    await createTestClick(link.id, { referrer: null });
    await createTestClick(link.id, { referrer: "https://example.com" });

    const referrers = await getTopReferrers(link.shortCode);

    const directEntry = referrers.find((r) => r.referrer === "(direct)");
    expect(directEntry).toBeDefined();
    expect(directEntry?.clicks).toBe(1);
  });

  it("should respect limit parameter", async () => {
    const link = await createTestLink("limited-referrers");
    
    const referrerUrls = [
      "https://a.com",
      "https://b.com",
      "https://c.com",
      "https://d.com",
      "https://e.com",
    ];

    for (const url of referrerUrls) {
      await createTestClick(link.id, { referrer: url });
    }

    const referrers = await getTopReferrers(link.shortCode, 3);

    expect(referrers.length).toBe(3);
  });

  it("should throw for invalid limit", async () => {
    const link = await createTestLink("invalid-limit");

    await expect(getTopReferrers(link.shortCode, 0)).rejects.toThrow("INVALID_INPUT");
    await expect(getTopReferrers(link.shortCode, 101)).rejects.toThrow("INVALID_INPUT");
  });
});

// =============================================================================
// Tests: getGeoDistribution
// =============================================================================

describe("getGeoDistribution", () => {
  it("should return empty distribution for link with no clicks", async () => {
    const link = await createTestLink("no-geo");

    const geo = await getGeoDistribution(link.shortCode);

    expect(geo.entries).toEqual([]);
    expect(geo.totalWithGeo).toBe(0);
    expect(geo.unknownLocation).toBe(0);
  });

  it("should aggregate by country and region", async () => {
    const link = await createTestLink("with-geo");
    
    // US, California: 3 clicks
    for (let i = 0; i < 3; i++) {
      await createTestClick(link.id, { country: "US", region: "California" });
    }
    // US, Texas: 2 clicks
    for (let i = 0; i < 2; i++) {
      await createTestClick(link.id, { country: "US", region: "Texas" });
    }
    // UK: 1 click
    await createTestClick(link.id, { country: "GB", region: "England" });

    const geo = await getGeoDistribution(link.shortCode);

    expect(geo.totalWithGeo).toBe(6);
    expect(geo.entries.length).toBe(3);
    
    const usca = geo.entries.find((e) => e.country === "US" && e.region === "California");
    expect(usca?.clicks).toBe(3);
    expect(usca?.percentage).toBe(50);
  });

  it("should count unknown locations separately", async () => {
    const link = await createTestLink("unknown-geo");
    
    await createTestClick(link.id, { country: "US", region: "NY" });
    await createTestClick(link.id, { country: null, region: null });
    await createTestClick(link.id, { country: null, region: null });

    const geo = await getGeoDistribution(link.shortCode);

    expect(geo.totalWithGeo).toBe(1);
    expect(geo.unknownLocation).toBe(2);
  });
});

// =============================================================================
// Tests: getClickTrends
// =============================================================================

describe("getClickTrends", () => {
  it("should return empty data for link with no clicks", async () => {
    const link = await createTestLink("no-trends");

    const trends = await getClickTrends(link.shortCode, 7);

    expect(trends.totalDays).toBe(7);
    expect(trends.avgClicksPerDay).toBe(0);
    expect(trends.peakDay).toBeNull();
  });

  it("should use aggregated stats if available", async () => {
    const link = await createTestLink("with-agg-stats");
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    await prisma.aggregatedStat.createMany({
      data: [
        { linkId: link.id, date: yesterday, clicks: BigInt(10), uniqueVisitors: BigInt(8) },
        { linkId: link.id, date: today, clicks: BigInt(15), uniqueVisitors: BigInt(12) },
      ],
    });

    const trends = await getClickTrends(link.shortCode, 7);

    expect(trends.data.length).toBe(2);
    expect(trends.peakDay?.clicks).toBe(15);
  });

  it("should fall back to click events when no aggregated stats", async () => {
    const link = await createTestLink("fallback-trends");
    
    const today = new Date();
    for (let i = 0; i < 5; i++) {
      await createTestClick(link.id, { ipAddress: `1.1.1.${i}`, createdAt: today });
    }

    const trends = await getClickTrends(link.shortCode, 7);

    const todayEntry = trends.data.find(
      (d) => d.date.toISOString().split("T")[0] === today.toISOString().split("T")[0]
    );
    expect(todayEntry?.clicks).toBe(5);
    expect(todayEntry?.uniqueVisitors).toBe(5);
  });

  it("should calculate average clicks per day", async () => {
    const link = await createTestLink("avg-trends");
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.aggregatedStat.createMany({
      data: [
        { linkId: link.id, date: today, clicks: BigInt(10), uniqueVisitors: BigInt(5) },
      ],
    });

    const trends = await getClickTrends(link.shortCode, 7);

    expect(trends.avgClicksPerDay).toBeCloseTo(10 / 7, 1);
  });

  it("should throw for invalid days parameter", async () => {
    const link = await createTestLink("invalid-days");

    await expect(getClickTrends(link.shortCode, 0)).rejects.toThrow("INVALID_INPUT");
    await expect(getClickTrends(link.shortCode, 366)).rejects.toThrow("INVALID_INPUT");
  });
});

// =============================================================================
// Tests: getLinkAnalyticsSummary
// =============================================================================

describe("getLinkAnalyticsSummary", () => {
  it("should return combined analytics for a link", async () => {
    const link = await createTestLink("summary-link");
    
    await createMultipleClicks(link.id, 10, {
      uniqueIps: true,
      includeBot: true,
      referrers: ["https://twitter.com", "https://facebook.com", null],
      countries: [
        { country: "US", region: "CA" },
        { country: "GB", region: "London" },
      ],
    });

    const summary = await getLinkAnalyticsSummary(link.shortCode);

    expect(summary.clickStats.totalClicks).toBe(10);
    expect(summary.visitors.uniqueVisitors).toBe(10);
    expect(summary.topReferrers.length).toBeGreaterThan(0);
    expect(summary.geoDistribution.entries.length).toBeGreaterThan(0);
    expect(summary.trends).toBeDefined();
  });

  it("should throw for non-existent link", async () => {
    await expect(getLinkAnalyticsSummary("nonexistent")).rejects.toThrow(AnalyticsError);
  });
});

// =============================================================================
// Tests: AnalyticsError
// =============================================================================

describe("AnalyticsError", () => {
  it("should have correct error code for not found", async () => {
    try {
      await getClickStats("nonexistent");
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(AnalyticsError);
      expect((error as AnalyticsError).code).toBe("LINK_NOT_FOUND");
    }
  });

  it("should have correct error code for invalid input", async () => {
    const link = await createTestLink("invalid-input-test");
    
    try {
      await getTopReferrers(link.shortCode, -1);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(AnalyticsError);
      expect((error as AnalyticsError).code).toBe("INVALID_INPUT");
    }
  });
});
