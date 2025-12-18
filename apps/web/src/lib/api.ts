/**
 * API Client
 *
 * Centralized API client for communicating with the QuickLink API.
 * Handles authentication, error handling, and request/response formatting.
 */

import type {
  Link,
  CreateLinkInput,
  CreateLinkResponse,
  AliasCheckResponse,
  LinkStats,
  DashboardStats,
  ApiResponse,
  PaginatedResponse,
  LinkFilters,
} from "./types";

// =============================================================================
// Configuration
// =============================================================================

/**
 * API base URL - defaults to localhost in development
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/**
 * Default request timeout (ms)
 */
const REQUEST_TIMEOUT = 10000;

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Custom API error class
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Handle API response and extract data or throw error
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = response.statusText;

    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      // Response body is not JSON
    }

    throw new ApiError(response.status, response.statusText, errorMessage);
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// =============================================================================
// Base Request Function
// =============================================================================

/**
 * Make an API request with timeout and error handling
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    return handleResponse<T>(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(408, "Request Timeout", "Request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// Link API
// =============================================================================

/**
 * Create a new short link
 */
export async function createLink(
  input: CreateLinkInput
): Promise<CreateLinkResponse> {
  return apiRequest<CreateLinkResponse>("/links", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Check if an alias is available
 */
export async function checkAlias(alias: string): Promise<AliasCheckResponse> {
  return apiRequest<AliasCheckResponse>(
    `/links/check?alias=${encodeURIComponent(alias)}`
  );
}

/**
 * Get a single link by short code
 */
export async function getLink(code: string): Promise<ApiResponse<Link>> {
  return apiRequest<ApiResponse<Link>>(`/links/${encodeURIComponent(code)}`);
}

/**
 * Get all links (paginated)
 */
export async function getLinks(
  page: number = 1,
  pageSize: number = 10,
  filters?: LinkFilters
): Promise<PaginatedResponse<Link>> {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
  });

  if (filters?.status) {
    params.append("status", filters.status);
  }
  if (filters?.search) {
    params.append("search", filters.search);
  }
  if (filters?.dateFrom) {
    params.append("dateFrom", filters.dateFrom);
  }
  if (filters?.dateTo) {
    params.append("dateTo", filters.dateTo);
  }

  return apiRequest<PaginatedResponse<Link>>(`/links?${params.toString()}`);
}

/**
 * Delete a link
 */
export async function deleteLink(code: string): Promise<ApiResponse<void>> {
  return apiRequest<ApiResponse<void>>(`/links/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}

/**
 * Update a link
 */
export async function updateLink(
  code: string,
  updates: Partial<CreateLinkInput>
): Promise<ApiResponse<Link>> {
  return apiRequest<ApiResponse<Link>>(`/links/${encodeURIComponent(code)}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

// =============================================================================
// Analytics API
// =============================================================================

/**
 * Get statistics for a single link
 */
export async function getLinkStats(code: string): Promise<ApiResponse<LinkStats>> {
  return apiRequest<ApiResponse<LinkStats>>(
    `/links/${encodeURIComponent(code)}/stats`
  );
}

/**
 * Get dashboard summary statistics
 */
export async function getDashboardStats(): Promise<ApiResponse<DashboardStats>> {
  return apiRequest<ApiResponse<DashboardStats>>("/stats/dashboard");
}

// =============================================================================
// Health API
// =============================================================================

/**
 * Check API health
 */
export async function checkHealth(): Promise<{ status: string }> {
  return apiRequest<{ status: string }>("/health");
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Build the full short URL from a code
 */
export function buildShortUrl(code: string): string {
  const redirectUrl =
    process.env.NEXT_PUBLIC_REDIRECT_URL || "http://localhost:3002";
  return `${redirectUrl}/${code}`;
}

/**
 * Check if the API is reachable
 */
export async function isApiReachable(): Promise<boolean> {
  try {
    await checkHealth();
    return true;
  } catch {
    return false;
  }
}
