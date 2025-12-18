/**
 * QuickLink Redirect Service
 *
 * Ultra-low-latency HTTP redirect service.
 * This is the entry point - just re-exports server startup.
 *
 * Target: <10ms p50 latency, <20ms p99 latency
 */

// Start the server
import "./server.js";

