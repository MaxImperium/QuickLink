/**
 * Analytics Producer Tests
 *
 * Unit tests for the click event producer.
 * Uses mocked BullMQ queue to avoid Redis dependency.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { Queue, Job } from "bullmq";

// Mock BullMQ before importing producer
jest.mock("bullmq", () => {
  const mockQueue = {
    add: jest.fn(),
    on: jest.fn(),
    close: jest.fn(),
    getJob: jest.fn(),
  };
  
  return {
    Queue: jest.fn(() => mockQueue),
    Job: jest.fn(),
  };
});

// Mock the logger
jest.mock("@quicklink/logger", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Import after mocking
import { emitClickEvent, closeClickQueue } from "../src/producer.js";
import type { EmitClickEventInput } from "../src/types.js";

describe("Analytics Producer", () => {
  let mockAdd: jest.Mock;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the mocked queue's add function
    const { Queue } = jest.requireMock("bullmq") as { Queue: jest.Mock };
    mockAdd = Queue().add;
  });

  afterEach(async () => {
    await closeClickQueue();
  });

  describe("emitClickEvent", () => {
    const validInput: EmitClickEventInput = {
      shortCode: "abc123",
      linkId: BigInt(1),
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
    };

    it("should emit a click event successfully", async () => {
      mockAdd.mockResolvedValueOnce({ id: "job-123" } as unknown as Job);
      
      const result = await emitClickEvent(validInput);
      
      expect(result.success).toBe(true);
      expect(result.eventId).toBeDefined();
      expect(mockAdd).toHaveBeenCalled();
    });

    it("should hash IP address for privacy", async () => {
      mockAdd.mockResolvedValueOnce({ id: "job-123" } as unknown as Job);
      
      await emitClickEvent(validInput);
      
      // Check that the payload has hashed IP, not raw IP
      const addCall = mockAdd.mock.calls[0];
      const payload = addCall[1];
      
      expect(payload.ipHash).toBeDefined();
      expect(payload.ipHash).not.toBe(validInput.ipAddress);
      expect(payload.ipHash.length).toBe(16); // SHA256 truncated to 16 chars
    });

    it("should include bot detection result", async () => {
      mockAdd.mockResolvedValueOnce({ id: "job-123" } as unknown as Job);
      
      await emitClickEvent(validInput);
      
      const addCall = mockAdd.mock.calls[0];
      const payload = addCall[1];
      
      expect(payload.isBot).toBeDefined();
      expect(typeof payload.isBot).toBe("boolean");
    });

    it("should detect bot User-Agents", async () => {
      mockAdd.mockResolvedValueOnce({ id: "job-123" } as unknown as Job);
      
      const botInput: EmitClickEventInput = {
        ...validInput,
        userAgent: "Googlebot/2.1",
      };
      
      await emitClickEvent(botInput);
      
      const addCall = mockAdd.mock.calls[0];
      const payload = addCall[1];
      
      expect(payload.isBot).toBe(true);
    });

    it("should include referrer when provided", async () => {
      mockAdd.mockResolvedValueOnce({ id: "job-123" } as unknown as Job);
      
      const inputWithReferrer: EmitClickEventInput = {
        ...validInput,
        referrer: "https://google.com/search?q=test",
      };
      
      await emitClickEvent(inputWithReferrer);
      
      const addCall = mockAdd.mock.calls[0];
      const payload = addCall[1];
      
      expect(payload.referrer).toBe("https://google.com/search?q=test");
    });

    it("should truncate long User-Agents", async () => {
      mockAdd.mockResolvedValueOnce({ id: "job-123" } as unknown as Job);
      
      const longUserAgent = "X".repeat(1000);
      const inputWithLongUA: EmitClickEventInput = {
        ...validInput,
        userAgent: longUserAgent,
      };
      
      await emitClickEvent(inputWithLongUA);
      
      const addCall = mockAdd.mock.calls[0];
      const payload = addCall[1];
      
      expect(payload.userAgent.length).toBeLessThanOrEqual(512);
    });

    it("should handle queue errors gracefully", async () => {
      mockAdd.mockRejectedValueOnce(new Error("Queue unavailable"));
      
      const result = await emitClickEvent(validInput);
      
      // Should return failure but not throw
      expect(result.success).toBe(false);
      expect(result.error).toContain("Queue unavailable");
    });

    it("should generate unique event IDs", async () => {
      mockAdd.mockResolvedValue({ id: "job-123" } as unknown as Job);
      
      const result1 = await emitClickEvent(validInput);
      const result2 = await emitClickEvent(validInput);
      
      expect(result1.eventId).not.toBe(result2.eventId);
    });

    it("should include timestamp in payload", async () => {
      mockAdd.mockResolvedValueOnce({ id: "job-123" } as unknown as Job);
      
      const before = Date.now();
      await emitClickEvent(validInput);
      const after = Date.now();
      
      const addCall = mockAdd.mock.calls[0];
      const payload = addCall[1];
      
      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });

    it("should handle missing optional fields", async () => {
      mockAdd.mockResolvedValueOnce({ id: "job-123" } as unknown as Job);
      
      const minimalInput: EmitClickEventInput = {
        shortCode: "abc123",
        linkId: BigInt(1),
      };
      
      const result = await emitClickEvent(minimalInput);
      
      expect(result.success).toBe(true);
    });
  });
});
