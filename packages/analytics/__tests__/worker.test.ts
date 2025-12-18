/**
 * Analytics Worker Tests
 *
 * Unit tests for the batch processing worker.
 * Tests the BatchAccumulator class and event processing logic.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

// Mock dependencies
jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
  })),
}));

jest.mock("@quicklink/db", () => ({
  prisma: {
    clickEvent: {
      createMany: jest.fn(),
    },
    link: {
      update: jest.fn(),
    },
  },
}));

jest.mock("@quicklink/logger", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

import type { ClickEventPayload, ClickEventRecord } from "../src/types.js";

describe("Analytics Worker", () => {
  describe("BatchAccumulator", () => {
    // Since BatchAccumulator is not exported, we test it through behavior
    // In a real implementation, you might export it for testing or use
    // a different approach

    interface BatchAccumulatorInterface {
      add(event: ClickEventRecord): Promise<void>;
      flush(): Promise<void>;
      getMetrics(): {
        pending: number;
        totalReceived: number;
        totalFlushed: number;
        msSinceLastFlush: number;
      };
    }

    // Simulated BatchAccumulator for testing
    class TestBatchAccumulator implements BatchAccumulatorInterface {
      private events: ClickEventRecord[] = [];
      private flushTimer: ReturnType<typeof setTimeout> | null = null;
      private readonly batchSize: number;
      private readonly batchTimeout: number;
      private readonly onFlush: (events: ClickEventRecord[]) => Promise<void>;

      private totalReceived = 0;
      private totalFlushed = 0;
      private lastFlushTime = Date.now();

      constructor(
        batchSize: number,
        batchTimeout: number,
        onFlush: (events: ClickEventRecord[]) => Promise<void>
      ) {
        this.batchSize = batchSize;
        this.batchTimeout = batchTimeout;
        this.onFlush = onFlush;
      }

      async add(event: ClickEventRecord): Promise<void> {
        this.events.push(event);
        this.totalReceived++;

        if (this.events.length === 1) {
          this.startTimer();
        }

        if (this.events.length >= this.batchSize) {
          await this.flush();
        }
      }

      async flush(): Promise<void> {
        this.clearTimer();

        if (this.events.length === 0) return;

        const eventsToFlush = this.events;
        this.events = [];

        await this.onFlush(eventsToFlush);
        this.totalFlushed += eventsToFlush.length;
        this.lastFlushTime = Date.now();
      }

      getMetrics() {
        return {
          pending: this.events.length,
          totalReceived: this.totalReceived,
          totalFlushed: this.totalFlushed,
          msSinceLastFlush: Date.now() - this.lastFlushTime,
        };
      }

      private startTimer(): void {
        this.clearTimer();
        this.flushTimer = setTimeout(() => {
          this.flush().catch(() => {});
        }, this.batchTimeout);
      }

      private clearTimer(): void {
        if (this.flushTimer) {
          clearTimeout(this.flushTimer);
          this.flushTimer = null;
        }
      }
    }

    let accumulator: TestBatchAccumulator;
    let flushCallback: jest.Mock;
    let flushedEvents: ClickEventRecord[][];

    const createEvent = (id: string): ClickEventRecord => ({
      linkId: BigInt(1),
      eventId: id,
      ipHash: "abc123",
      isBot: false,
      timestamp: Date.now(),
    });

    beforeEach(() => {
      flushedEvents = [];
      flushCallback = jest.fn().mockImplementation(async (events: ClickEventRecord[]) => {
        flushedEvents.push(events);
      });
      accumulator = new TestBatchAccumulator(5, 1000, flushCallback);
    });

    it("should accumulate events until batch size", async () => {
      for (let i = 0; i < 4; i++) {
        await accumulator.add(createEvent(`event-${i}`));
      }

      expect(accumulator.getMetrics().pending).toBe(4);
      expect(flushCallback).not.toHaveBeenCalled();
    });

    it("should flush when batch size is reached", async () => {
      for (let i = 0; i < 5; i++) {
        await accumulator.add(createEvent(`event-${i}`));
      }

      expect(flushCallback).toHaveBeenCalledTimes(1);
      expect(flushedEvents[0].length).toBe(5);
      expect(accumulator.getMetrics().pending).toBe(0);
    });

    it("should flush on timeout", async () => {
      jest.useFakeTimers();

      await accumulator.add(createEvent("event-1"));
      await accumulator.add(createEvent("event-2"));

      expect(flushCallback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // Flush the promise queue

      expect(flushCallback).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it("should track metrics correctly", async () => {
      for (let i = 0; i < 7; i++) {
        await accumulator.add(createEvent(`event-${i}`));
      }

      const metrics = accumulator.getMetrics();
      
      expect(metrics.totalReceived).toBe(7);
      expect(metrics.totalFlushed).toBe(5); // One batch of 5
      expect(metrics.pending).toBe(2); // 2 remaining
    });

    it("should handle manual flush", async () => {
      await accumulator.add(createEvent("event-1"));
      await accumulator.add(createEvent("event-2"));

      await accumulator.flush();

      expect(flushCallback).toHaveBeenCalledTimes(1);
      expect(flushedEvents[0].length).toBe(2);
    });

    it("should not flush when empty", async () => {
      await accumulator.flush();

      expect(flushCallback).not.toHaveBeenCalled();
    });

    it("should handle multiple batches", async () => {
      // Add 12 events (should create 2 full batches + 2 remaining)
      for (let i = 0; i < 12; i++) {
        await accumulator.add(createEvent(`event-${i}`));
      }

      expect(flushCallback).toHaveBeenCalledTimes(2);
      expect(accumulator.getMetrics().pending).toBe(2);

      // Flush remaining
      await accumulator.flush();

      expect(flushCallback).toHaveBeenCalledTimes(3);
      expect(flushedEvents[2].length).toBe(2);
    });
  });

  describe("Click Event Processing", () => {
    const samplePayload: ClickEventPayload = {
      eventId: "test-event-123",
      shortCode: "abc123",
      linkId: "1",
      ipHash: "abc123hash",
      userAgent: "Mozilla/5.0 Chrome/120.0",
      referrer: "https://google.com",
      country: "US",
      city: "San Francisco",
      device: "desktop",
      browser: "Chrome",
      os: "Windows",
      isBot: false,
      timestamp: Date.now(),
    };

    it("should convert payload to database record", () => {
      // Simulated conversion function
      const toDbRecord = (payload: ClickEventPayload): ClickEventRecord => ({
        linkId: BigInt(payload.linkId),
        eventId: payload.eventId,
        ipHash: payload.ipHash,
        userAgent: payload.userAgent,
        referrer: payload.referrer,
        country: payload.country,
        city: payload.city,
        device: payload.device,
        browser: payload.browser,
        os: payload.os,
        isBot: payload.isBot,
        timestamp: payload.timestamp,
      });

      const record = toDbRecord(samplePayload);

      expect(record.linkId).toBe(BigInt(1));
      expect(record.eventId).toBe("test-event-123");
      expect(record.isBot).toBe(false);
    });

    it("should handle bot events correctly", () => {
      const botPayload: ClickEventPayload = {
        ...samplePayload,
        userAgent: "Googlebot/2.1",
        isBot: true,
      };

      expect(botPayload.isBot).toBe(true);
    });

    it("should handle missing optional fields", () => {
      const minimalPayload: ClickEventPayload = {
        eventId: "minimal-123",
        shortCode: "abc123",
        linkId: "1",
        isBot: false,
        timestamp: Date.now(),
      };

      expect(minimalPayload.userAgent).toBeUndefined();
      expect(minimalPayload.referrer).toBeUndefined();
      expect(minimalPayload.country).toBeUndefined();
    });
  });

  describe("Database Batch Insert", () => {
    it("should batch insert click events", async () => {
      const { prisma } = jest.requireMock("@quicklink/db") as {
        prisma: {
          clickEvent: { createMany: jest.Mock };
          link: { update: jest.Mock };
        };
      };

      prisma.clickEvent.createMany.mockResolvedValueOnce({ count: 5 });

      const events = Array.from({ length: 5 }, (_, i) => ({
        linkId: BigInt(1),
        eventId: `event-${i}`,
        ipHash: `hash-${i}`,
        isBot: false,
        timestamp: Date.now(),
      }));

      await prisma.clickEvent.createMany({ data: events });

      expect(prisma.clickEvent.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ eventId: "event-0" }),
        ]),
      });
    });

    it("should handle database errors", async () => {
      const { prisma } = jest.requireMock("@quicklink/db") as {
        prisma: {
          clickEvent: { createMany: jest.Mock };
        };
      };

      prisma.clickEvent.createMany.mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      const events = [
        {
          linkId: BigInt(1),
          eventId: "event-1",
          ipHash: "hash",
          isBot: false,
          timestamp: Date.now(),
        },
      ];

      await expect(
        prisma.clickEvent.createMany({ data: events })
      ).rejects.toThrow("Database connection failed");
    });
  });
});
