"use client";

/**
 * useLinks Hook
 *
 * Fetches paginated list of links.
 * Supports filtering by status, search, and date range.
 */

import { useQuery } from "@tanstack/react-query";
import { getLinks } from "@/lib/api";
import { linkKeys } from "./useCreateLink";
import type { LinkFilters, PaginatedResponse, Link } from "@/lib/types";

// =============================================================================
// Hook
// =============================================================================

interface UseLinksOptions {
  enabled?: boolean;
}

export function useLinks(
  page: number = 1,
  pageSize: number = 10,
  filters?: LinkFilters,
  options?: UseLinksOptions
) {
  return useQuery({
    queryKey: linkKeys.list({ page, pageSize, ...filters }),
    queryFn: (): Promise<PaginatedResponse<Link>> =>
      getLinks(page, pageSize, filters),
    enabled: options?.enabled !== false,
    staleTime: 60 * 1000, // 1 minute
    placeholderData: (previousData) => previousData, // Keep previous data while fetching
  });
}
