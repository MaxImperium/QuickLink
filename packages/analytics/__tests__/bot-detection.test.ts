/**
 * Bot Detection Tests
 *
 * Unit tests for the bot detection module.
 * @see packages/analytics/src/bot-detection.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  detectBot,
  isKnownBot,
  getFrequencyStats,
  shutdownBotDetection,
} from "../src/bot-detection.js";

describe("Bot Detection", () => {
  afterEach(() => {
    // Clean up frequency tracker between tests
    shutdownBotDetection();
  });

  describe("detectBot", () => {
    describe("missing User-Agent", () => {
      it("should detect missing User-Agent as bot", () => {
        const result = detectBot(undefined);
        
        expect(result.isBot).toBe(true);
        expect(result.reason).toBe("missing_user_agent");
        expect(result.confidence).toBe(0.9);
      });

      it("should detect empty User-Agent as bot", () => {
        const result = detectBot("");
        
        expect(result.isBot).toBe(true);
        expect(result.reason).toBe("missing_user_agent");
      });

      it("should detect whitespace-only User-Agent as bot", () => {
        const result = detectBot("   ");
        
        expect(result.isBot).toBe(true);
        expect(result.reason).toBe("missing_user_agent");
      });
    });

    describe("search engine crawlers", () => {
      const crawlers = [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
        "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
        "DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)",
        "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
        "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
      ];

      it.each(crawlers)("should detect crawler: %s", (userAgent) => {
        const result = detectBot(userAgent);
        
        expect(result.isBot).toBe(true);
        expect(result.reason).toBe("user_agent_pattern");
        expect(result.confidence).toBe(0.95);
      });
    });

    describe("SEO tools", () => {
      const seoTools = [
        "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
        "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
        "MJ12bot/v1.4.8 (http://mj12bot.com/)",
        "Screaming Frog SEO Spider/15.0",
      ];

      it.each(seoTools)("should detect SEO tool: %s", (userAgent) => {
        const result = detectBot(userAgent);
        
        expect(result.isBot).toBe(true);
        expect(result.reason).toBe("user_agent_pattern");
      });
    });

    describe("social media crawlers", () => {
      const socialCrawlers = [
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        "Twitterbot/1.0",
        "LinkedInBot/1.0",
        "Pinterest/0.2 (+http://www.pinterest.com/)",
        "Slackbot-LinkExpanding 1.0",
        "TelegramBot (like TwitterBot)",
        "WhatsApp/2.21.23.23 A",
        "DiscordBot (https://discordapp.com)",
      ];

      it.each(socialCrawlers)("should detect social crawler: %s", (userAgent) => {
        const result = detectBot(userAgent);
        
        expect(result.isBot).toBe(true);
      });
    });

    describe("monitoring tools", () => {
      const monitoringTools = [
        "Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)",
        "UptimeRobot/2.0; http://www.uptimerobot.com/",
        "StatusCake/v1.0",
        "NewRelicPinger/1.0",
        "Datadog/Synthetics",
      ];

      it.each(monitoringTools)("should detect monitoring tool: %s", (userAgent) => {
        const result = detectBot(userAgent);
        
        expect(result.isBot).toBe(true);
      });
    });

    describe("HTTP libraries", () => {
      const httpLibraries = [
        "curl/7.79.1",
        "Wget/1.21.2",
        "python-requests/2.28.1",
        "Python-urllib/3.10",
        "axios/1.2.0",
        "node-fetch/1.0",
        "Go-http-client/1.1",
        "okhttp/4.9.3",
        "Apache-HttpClient/4.5.13",
      ];

      it.each(httpLibraries)("should detect HTTP library: %s", (userAgent) => {
        const result = detectBot(userAgent);
        
        expect(result.isBot).toBe(true);
      });
    });

    describe("generic bot patterns", () => {
      const genericBots = [
        "MyCustomBot/1.0",
        "WebCrawler/2.0",
        "SpiderMonkey/1.0",
        "DataScraper/3.0",
        "HeadlessChrome/91.0",
        "PhantomJS/2.1.1",
        "Selenium/4.0",
        "Puppeteer/10.0",
        "Playwright/1.0",
      ];

      it.each(genericBots)("should detect generic bot: %s", (userAgent) => {
        const result = detectBot(userAgent);
        
        expect(result.isBot).toBe(true);
      });
    });

    describe("legitimate browsers", () => {
      const browsers = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      ];

      it.each(browsers)("should not detect as bot: %s", (userAgent) => {
        const result = detectBot(userAgent);
        
        expect(result.isBot).toBe(false);
        expect(result.confidence).toBe(0);
      });
    });

    describe("request frequency detection", () => {
      it("should detect high frequency requests as bot", () => {
        const ipHash = "test-ip-high-freq";
        
        // Make many requests from same IP
        for (let i = 0; i < 35; i++) {
          detectBot("Mozilla/5.0 Chrome/120.0", ipHash);
        }
        
        // Next request should be flagged
        const result = detectBot("Mozilla/5.0 Chrome/120.0", ipHash);
        
        expect(result.isBot).toBe(true);
        expect(result.reason).toBe("request_frequency");
        expect(result.confidence).toBe(0.8);
      });

      it("should not flag low frequency requests", () => {
        const ipHash = "test-ip-low-freq";
        
        // Make a few requests
        for (let i = 0; i < 5; i++) {
          detectBot("Mozilla/5.0 Chrome/120.0", ipHash);
        }
        
        const result = detectBot("Mozilla/5.0 Chrome/120.0", ipHash);
        
        expect(result.isBot).toBe(false);
      });

      it("should track different IPs separately", () => {
        // Hit threshold for IP 1
        for (let i = 0; i < 35; i++) {
          detectBot("Mozilla/5.0 Chrome/120.0", "ip1");
        }
        
        // IP 2 should not be affected
        const result = detectBot("Mozilla/5.0 Chrome/120.0", "ip2");
        
        expect(result.isBot).toBe(false);
      });
    });

    describe("suspicious patterns", () => {
      it("should detect very short User-Agent", () => {
        const result = detectBot("Bot");
        
        expect(result.isBot).toBe(true);
        expect(result.confidence).toBeLessThanOrEqual(0.6);
      });

      it("should detect minimal Mozilla string", () => {
        const result = detectBot("Mozilla/5.0");
        
        expect(result.isBot).toBe(true);
      });
    });
  });

  describe("isKnownBot", () => {
    it("should return true for known bots", () => {
      expect(isKnownBot("Googlebot/2.1")).toBe(true);
      expect(isKnownBot("curl/7.79.1")).toBe(true);
      expect(isKnownBot("Twitterbot/1.0")).toBe(true);
    });

    it("should return true for undefined User-Agent", () => {
      expect(isKnownBot(undefined)).toBe(true);
    });

    it("should return false for legitimate browsers", () => {
      expect(isKnownBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0")).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(isKnownBot("GOOGLEBOT")).toBe(true);
      expect(isKnownBot("googlebot")).toBe(true);
      expect(isKnownBot("GoogleBot")).toBe(true);
    });
  });

  describe("getFrequencyStats", () => {
    it("should return stats about tracked IPs", () => {
      // Make some requests
      detectBot("Mozilla/5.0", "ip1");
      detectBot("Mozilla/5.0", "ip1");
      detectBot("Mozilla/5.0", "ip2");
      
      const stats = getFrequencyStats();
      
      expect(stats.uniqueIPs).toBe(2);
      expect(stats.totalRequests).toBe(3);
    });

    it("should return zeros when no requests tracked", () => {
      shutdownBotDetection();
      
      const stats = getFrequencyStats();
      
      expect(stats.uniqueIPs).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe("shutdownBotDetection", () => {
    it("should clear tracked data", () => {
      // Track some requests
      for (let i = 0; i < 10; i++) {
        detectBot("Mozilla/5.0", "ip");
      }
      
      expect(getFrequencyStats().totalRequests).toBe(10);
      
      shutdownBotDetection();
      
      // After shutdown and reinitialization, data should be cleared
      expect(getFrequencyStats().totalRequests).toBe(0);
    });
  });
});
