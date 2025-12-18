"use client";

/**
 * useLinkStats Hook
 *
 * Fetches click statistics for a specific link.
 * Uses React Query for caching and automatic refetching.
 */

import { useQuery } from "@tanstack/react-query";
import { getLinkStats } from "@/lib/api";
import { linkKeys } from "./useCreateLink";
import type { LinkStats } from "@/lib/types";

// =============================================================================
// Hook
// =============================================================================

interface UseLinkStatsOptions {
  enabled?: boolean;
  refetchInterval?: number;
}

export function useLinkStats(code: string, options?: UseLinkStatsOptions) {
  return useQuery({
    queryKey: linkKeys.stats(code),
    queryFn: async (): Promise<LinkStats> => {
      const response = await getLinkStats(code);
      if (!response.data) {
        throw new Error("No stats data returned");
      }
      return response.data;
    },
    enabled: !!code && (options?.enabled !== false),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: options?.refetchInterval,
    retry: 1,
  });
}
