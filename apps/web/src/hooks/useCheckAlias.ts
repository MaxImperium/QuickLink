"use client";

/**
 * useCheckAlias Hook
 *
 * Checks if a custom alias is available.
 * Used for real-time validation in the form.
 */

import { useMutation } from "@tanstack/react-query";
import { checkAlias } from "@/lib/api";
import type { AliasCheckResponse } from "@/lib/types";

// =============================================================================
// Hook
// =============================================================================

export function useCheckAlias() {
  return useMutation({
    mutationFn: (alias: string): Promise<AliasCheckResponse> =>
      checkAlias(alias),
  });
}
