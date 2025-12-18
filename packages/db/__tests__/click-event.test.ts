/**
 * Click Event Model Integration Tests
 *
 * Tests for click event recording and aggregation.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { prisma } from "../src/client.js";
import { testHelpers } from "./setup.js";

describe("Click Event Model", () => {
  let testLink: Awaited<ReturnType<typeof testHelpers.createLink>>;

  beforeEach(async () => {
    testLink = await testHelpers.createLink({ shortCode: "clicks" });
  });

  describe("create", () => {
    it("should record a click event with minimal data", async () => {
      const event = await prisma.clickEvent.create({
        data: {
          linkId: testLink.id,
        },
      });

      expect(event.id).toBeDefined();
      expect(event.linkId).toBe(testLink.id);
      expect(event.clickedAt).toBeDefined();
      expect(event.isBot).toBe(false);
    });

    it("should record click with full metadata", async () => {
      const event = await prisma.clickEvent.create({
        data: {
          linkId: testLink.id,
          ipHash: "abc123hash",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          referrer: "https://google.com",
          country: "US",
          city: "San Francisco",
          device: "desktop",
          browser: "Chrome",
          os: "Windows",
        },
      });

      expect(event.ipHash).toBe("abc123hash");
      expect(event.userAgent).toContain("Mozilla");
      expect(event.referrer).toBe("https://google.com");
      expect(event.country).toBe("US");
    });

    it("should mark bot traffic", async () => {
      const event = await prisma.clickEvent.create({
        data: {
          linkId: testLink.id,
          userAgent: "Googlebot/2.1",
          isBot: true,
        },
      });

      expect(event.isBot).toBe(true);
    });

    it("should use correct timestamp", async () => {
      const before = new Date();
      
      const event = await prisma.clickEvent.create({
        data: { linkId: testLink.id },
      });
      
      const after = new Date();

      expect(event.clickedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(event.clickedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("createMany (batch insert)", () => {
    it("should insert multiple events efficiently", async () => {
      const events = Array.from({ length: 100 }, (_, i) => ({
        linkId: testLink.id,
        ipHash: `hash${i}`,
        userAgent: `Agent ${i}`,
      }));

      const result = await prisma.clickEvent.createMany({
        data: events,
      });

      expect(result.count).toBe(100);

      const count = await prisma.clickEvent.count({
        where: { linkId: testLink.id },
      });
      expect(count).toBe(100);
    });
  });

  describe("queries", () => {
    beforeEach(async () => {
      // Create test events
      await prisma.clickEvent.createMany({
        data: [
          { linkId: testLink.id, ipHash: "user1", isBot: false, country: "US" },
          { linkId: testLink.id, ipHash: "user2", isBot: false, country: "US" },
          { linkId: testLink.id, ipHash: "user1", isBot: false, country: "US" }, // Duplicate
          { linkId: testLink.id, ipHash: "bot1", isBot: true, country: "DE" },
          { linkId: testLink.id, ipHash: "user3", isBot: false, country: "UK" },
        ],
      });
    });

    it("should count total clicks", async () => {
      const total = await prisma.clickEvent.count({
        where: { linkId: testLink.id },
      });

      expect(total).toBe(5);
    });

    it("should count unique visitors (by IP hash)", async () => {
      const uniqueVisitors = await prisma.clickEvent.groupBy({
        by: ["ipHash"],
        where: { linkId: testLink.id, isBot: false },
      });

      expect(uniqueVisitors.length).toBe(3); // user1, user2, user3
    });

    it("should exclude bot traffic from analytics", async () => {
      const humanClicks = await prisma.clickEvent.count({
        where: { linkId: testLink.id, isBot: false },
      });

      expect(humanClicks).toBe(4);
    });

    it("should group by country", async () => {
      const byCountry = await prisma.clickEvent.groupBy({
        by: ["country"],
        where: { linkId: testLink.id },
        _count: true,
        orderBy: { _count: { country: "desc" } },
      });

      expect(byCountry[0].country).toBe("US");
      expect(byCountry[0]._count).toBe(3);
    });

    it("should find events in time range", async () => {
      const oneHourAgo = new Date(Date.now() - 3600000);
      
      const recentEvents = await prisma.clickEvent.findMany({
        where: {
          linkId: testLink.id,
          clickedAt: { gte: oneHourAgo },
        },
      });

      expect(recentEvents.length).toBe(5); // All events are recent
    });
  });

  describe("relations", () => {
    it("should load link with events", async () => {
      await testHelpers.createClickEvent(testLink.id);
      await testHelpers.createClickEvent(testLink.id);

      const linkWithEvents = await prisma.link.findUnique({
        where: { id: testLink.id },
        include: { clickEvents: true },
      });

      expect(linkWithEvents?.clickEvents.length).toBe(2);
    });

    it("should cascade delete events when link is deleted", async () => {
      await testHelpers.createClickEvent(testLink.id);
      await testHelpers.createClickEvent(testLink.id);

      // Delete the link
      await prisma.link.delete({
        where: { id: testLink.id },
      });

      // Events should be deleted
      const events = await prisma.clickEvent.findMany({
        where: { linkId: testLink.id },
      });

      expect(events.length).toBe(0);
    });
  });
});
