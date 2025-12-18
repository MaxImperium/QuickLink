"use client";

/**
 * useLink Hook
 *
 * Fetches a single link by short code.
 */

import { useQuery } from "@tanstack/react-query";
import { getLink } from "@/lib/api";
import { linkKeys } from "./useCreateLink";
import type { Link } from "@/lib/types";

// =============================================================================
// Hook
// =============================================================================

interface UseLinkOptions {
  enabled?: boolean;
}

export function useLink(code: string, options?: UseLinkOptions) {
  return useQuery({
    queryKey: linkKeys.detail(code),
    queryFn: async (): Promise<Link> => {
      const response = await getLink(code);
      if (!response.data) {
        throw new Error("Link not found");
      }
      return response.data;
    },
    enabled: !!code && (options?.enabled !== false),
    staleTime: 60 * 1000, // 1 minute
    retry: 1,
  });
}
