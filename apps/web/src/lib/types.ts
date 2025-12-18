/**
 * Frontend Type Definitions
 *
 * Types for the QuickLink web application.
 * Aligned with API response shapes.
 */

// =============================================================================
// Link Types
// =============================================================================

/**
 * Link status enum
 */
export type LinkStatus = "ACTIVE" | "EXPIRED" | "DISABLED";

/**
 * Link data returned from API
 */
export interface Link {
  id: string;
  shortCode: string;
  originalUrl: string;
  customAlias?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  maxClicks?: number | null;
  clickCount: number;
  status: LinkStatus;
  isPermanent: boolean;
}

/**
 * Input for creating a new link
 */
export interface CreateLinkInput {
  url: string;
  customAlias?: string;
  expiresAt?: string;
  maxClicks?: number;
}

/**
 * Response from create link API
 */
export interface CreateLinkResponse {
  success: boolean;
  data?: Link;
  shortUrl?: string;
  error?: string;
}

/**
 * Alias availability check response
 */
export interface AliasCheckResponse {
  available: boolean;
  reason?: string;
}

// =============================================================================
// Analytics Types
// =============================================================================

/**
 * Click event data
 */
export interface ClickEvent {
  id: string;
  linkId: string;
  clickedAt: string;
  country?: string;
  referrer?: string;
  userAgent?: string;
  isBot: boolean;
}

/**
 * Daily click stats
 */
export interface DailyStats {
  date: string;
  clicks: number;
  uniqueVisitors: number;
  botClicks: number;
}

/**
 * Link statistics summary
 */
export interface LinkStats {
  totalClicks: number;
  uniqueVisitors: number;
  topCountries: { country: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
  clicksByDay: DailyStats[];
  botPercentage: number;
}

/**
 * Dashboard summary stats
 */
export interface DashboardStats {
  totalLinks: number;
  totalClicks: number;
  activeLinks: number;
  clicksToday: number;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// =============================================================================
// Form Types
// =============================================================================

/**
 * Form state for link creation
 */
export interface LinkFormState {
  url: string;
  customAlias: string;
  expiresAt: string;
  maxClicks: string;
}

/**
 * Form validation errors
 */
export interface FormErrors {
  url?: string;
  customAlias?: string;
  expiresAt?: string;
  maxClicks?: string;
}

// =============================================================================
// UI Types
// =============================================================================

/**
 * Toast notification type
 */
export type ToastType = "success" | "error" | "warning" | "info";

/**
 * Toast notification
 */
export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

/**
 * Sort configuration
 */
export interface SortConfig {
  field: string;
  direction: "asc" | "desc";
}

/**
 * Filter configuration for links
 */
export interface LinkFilters {
  status?: LinkStatus;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}
