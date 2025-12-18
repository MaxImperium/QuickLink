/**
 * Shared Type Definitions
 */

// =============================================================================
// Link Types
// =============================================================================

/**
 * Link data structure used across services
 */
export interface LinkData {
  /** Unique identifier */
  id: string;

  /** Short code (Base62 or custom alias) */
  code: string;

  /** Original destination URL */
  originalUrl: string;

  /** User ID who created the link (null for anonymous) */
  userId: string | null;

  /** Custom alias flag */
  isCustomAlias: boolean;

  /** Link expiration date (null = never) */
  expiresAt: Date | null;

  /** Whether the link is active */
  isActive: boolean;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Click count (denormalized for quick access) */
  clickCount: number;
}

/**
 * Cached link data (minimal for performance)
 */
export interface CachedLink {
  /** Original destination URL */
  url: string;

  /** Whether the link is active */
  active: boolean;

  /** Expiration timestamp (Unix ms, null = never) */
  exp: number | null;
}

/**
 * Link creation request
 */
export interface CreateLinkRequest {
  /** URL to shorten */
  url: string;

  /** Optional custom alias */
  customAlias?: string;

  /** Optional expiration date */
  expiresAt?: Date;
}

/**
 * Link creation response
 */
export interface CreateLinkResponse {
  /** The created link */
  link: LinkData;

  /** Full short URL */
  shortUrl: string;
}

// =============================================================================
// Click/Analytics Types
// =============================================================================

/**
 * Click event data for analytics
 */
export interface ClickEvent {
  /** Short code that was clicked */
  code: string;

  /** Timestamp of the click */
  timestamp: Date;

  /** User agent string */
  userAgent: string | null;

  /** Referer URL */
  referer: string | null;

  /** Client IP (for geo lookup) */
  ip: string;

  /** Country code (from geo lookup) */
  country?: string;

  /** City (from geo lookup) */
  city?: string;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Standard API success response
 */
export interface ApiResponse<T> {
  success: true;
  data: T;
}

/**
 * Standard API error response
 */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
  };
}

// =============================================================================
// Service Health Types
// =============================================================================

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: HealthStatus;
    cache: HealthStatus;
    queue?: HealthStatus;
  };
}

/**
 * Individual health status
 */
export interface HealthStatus {
  status: "up" | "down" | "degraded";
  latencyMs?: number;
  message?: string;
}
