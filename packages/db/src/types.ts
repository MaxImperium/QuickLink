/**
 * Database Type Definitions
 *
 * TypeScript interfaces that mirror the Prisma schema.
 * Use these when you need types without importing Prisma client.
 *
 * @see prisma/schema.prisma for the authoritative schema
 */

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Link lifecycle states
 */
export enum LinkLifecycleState {
  /** Link is active and accepting redirects */
  ACTIVE = "active",
  /** Link has passed its expiration date */
  EXPIRED = "expired",
  /** Link manually disabled by owner/admin */
  DISABLED = "disabled",
}

// =============================================================================
// TABLE: users
// =============================================================================

export interface User {
  id: bigint;
  email: string;
  hashedPassword: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** User without sensitive fields (for API responses) */
export interface SafeUser {
  id: bigint;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  hashedPassword: string;
  name?: string;
}

export interface UpdateUserInput {
  email?: string;
  hashedPassword?: string;
  name?: string | null;
}

// =============================================================================
// AUTH TYPES
// =============================================================================

/** JWT payload stored in token */
export interface AuthPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/** Login credentials */
export interface LoginInput {
  email: string;
  password: string;
}

/** Registration input */
export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

/** Auth response with token */
export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: SafeUser;
  error?: string;
}

// =============================================================================
// TABLE: links
// =============================================================================

export interface Link {
  id: bigint;
  shortCode: string;
  targetUrl: string;
  title: string | null;
  active: boolean;
  customAlias: boolean;
  lifecycleState: LinkLifecycleState;
  expiresAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  userId: bigint | null;
}

export interface CreateLinkInput {
  shortCode: string;
  targetUrl: string;
  title?: string;
  customAlias?: boolean;
  expiresAt?: Date;
  userId?: bigint;
}

export interface UpdateLinkInput {
  targetUrl?: string;
  title?: string | null;
  active?: boolean;
  lifecycleState?: LinkLifecycleState;
  expiresAt?: Date | null;
}

/**
 * Link with all relations loaded
 */
export interface LinkWithRelations extends Link {
  user: User | null;
  clickEvents: ClickEvent[];
  aggregatedStats: AggregatedStat[];
}

/**
 * Link data for cache (minimal fields for redirect)
 */
export interface LinkCacheData {
  targetUrl: string;
  active: boolean;
  lifecycleState: LinkLifecycleState;
  expiresAt: Date | null;
}

// =============================================================================
// TABLE: click_events
// =============================================================================

export interface ClickEvent {
  id: bigint;
  linkId: bigint;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  referrer: string | null;
  region: string | null;
  country: string | null;
  bot: boolean;
}

export interface CreateClickEventInput {
  linkId: bigint;
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
  region?: string;
  country?: string;
  bot?: boolean;
}

/**
 * Click event for analytics queue
 */
export interface ClickEventPayload {
  linkId: bigint;
  timestamp: number;
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
}

// =============================================================================
// TABLE: aggregated_stats
// =============================================================================

export interface AggregatedStat {
  id: bigint;
  linkId: bigint;
  date: Date;
  clicks: bigint;
  uniqueVisitors: bigint;
}

export interface UpsertAggregatedStatInput {
  linkId: bigint;
  date: Date;
  clicks: bigint;
  uniqueVisitors: bigint;
}

/**
 * Aggregated stats for dashboard display
 */
export interface LinkStats {
  linkId: bigint;
  totalClicks: bigint;
  uniqueVisitors: bigint;
  clicksByDate: Array<{
    date: Date;
    clicks: bigint;
  }>;
}

// =============================================================================
// TABLE: reserved_aliases
// =============================================================================

export interface ReservedAlias {
  id: bigint;
  alias: string;
  reason: string | null;
  category: string | null;
  reservedBy: string | null;
  createdAt: Date;
}

export interface CreateReservedAliasInput {
  alias: string;
  reason?: string;
  category?: string;
  reservedBy?: string;
}

/**
 * Reserved alias categories
 */
export enum ReservedAliasCategory {
  /** System routes (api, health, admin) */
  SYSTEM = "system",
  /** Brand protection */
  BRAND = "brand",
  /** Offensive content */
  PROFANITY = "profanity",
  /** User-reserved */
  USER = "user",
}

// =============================================================================
// QUERY TYPES
// =============================================================================

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  cursor?: bigint;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  items: T[];
  total: bigint;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Link filter options
 */
export interface LinkFilterOptions {
  userId?: bigint;
  active?: boolean;
  lifecycleState?: LinkLifecycleState;
  includeDeleted?: boolean;
  search?: string;
}

/**
 * Click event filter options
 */
export interface ClickEventFilterOptions {
  linkId?: bigint;
  startDate?: Date;
  endDate?: Date;
  excludeBots?: boolean;
  country?: string;
}

// =============================================================================
// DATABASE RESULT TYPES (for raw queries)
// =============================================================================

/**
 * Raw link row from database
 */
export interface LinkRow {
  id: string;  // bigint comes as string from pg
  short_code: string;
  target_url: string;
  title: string | null;
  active: boolean;
  custom_alias: boolean;
  lifecycle_state: string;
  expires_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  user_id: string | null;
}

/**
 * Raw click event row from database
 */
export interface ClickEventRow {
  id: string;
  link_id: string;
  created_at: Date;
  ip_address: string | null;
  user_agent: string | null;
  referrer: string | null;
  region: string | null;
  country: string | null;
  bot: boolean;
}

/**
 * Convert database row to Link interface
 */
export function rowToLink(row: LinkRow): Link {
  return {
    id: BigInt(row.id),
    shortCode: row.short_code,
    targetUrl: row.target_url,
    title: row.title,
    active: row.active,
    customAlias: row.custom_alias,
    lifecycleState: row.lifecycle_state as LinkLifecycleState,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: row.user_id ? BigInt(row.user_id) : null,
  };
}

/**
 * Convert database row to ClickEvent interface
 */
export function rowToClickEvent(row: ClickEventRow): ClickEvent {
  return {
    id: BigInt(row.id),
    linkId: BigInt(row.link_id),
    createdAt: row.created_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    referrer: row.referrer,
    region: row.region,
    country: row.country,
    bot: row.bot,
  };
}
