"use client";

/**
 * useCreateLink Hook
 *
 * Handles creating new short links via the API.
 * Uses React Query mutation for caching and error handling.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createLink } from "@/lib/api";
import type { CreateLinkInput, CreateLinkResponse } from "@/lib/types";

// =============================================================================
// Query Keys
// =============================================================================

export const linkKeys = {
  all: ["links"] as const,
  lists: () => [...linkKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...linkKeys.lists(), filters] as const,
  details: () => [...linkKeys.all, "detail"] as const,
  detail: (code: string) => [...linkKeys.details(), code] as const,
  stats: (code: string) => [...linkKeys.detail(code), "stats"] as const,
};

// =============================================================================
// Hook
// =============================================================================

interface UseCreateLinkOptions {
  onSuccess?: (data: CreateLinkResponse) => void;
  onError?: (error: Error) => void;
}

export function useCreateLink(options?: UseCreateLinkOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateLinkInput) => createLink(input),
    onSuccess: (data) => {
      // Invalidate links list to refetch
      queryClient.invalidateQueries({ queryKey: linkKeys.lists() });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
}
