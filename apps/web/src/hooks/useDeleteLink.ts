"use client";

/**
 * useDeleteLink Hook
 *
 * Handles deleting a link via the API.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteLink } from "@/lib/api";
import { linkKeys } from "./useCreateLink";

// =============================================================================
// Hook
// =============================================================================

interface UseDeleteLinkOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useDeleteLink(options?: UseDeleteLinkOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => deleteLink(code),
    onSuccess: () => {
      // Invalidate links list to refetch
      queryClient.invalidateQueries({ queryKey: linkKeys.lists() });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
}
