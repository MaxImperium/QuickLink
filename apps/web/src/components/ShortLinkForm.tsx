"use client";

/**
 * ShortLinkForm Component
 *
 * Form for creating new short links.
 * Includes URL validation, custom alias checking, and optional settings.
 */

import { useState, useCallback, type FormEvent } from "react";
import { useCreateLink, useCheckAlias } from "@/hooks";
import { useToast } from "./Toast";
import {
  isValidUrl,
  ensureProtocol,
  isValidAlias,
  copyToClipboard,
  buildShortUrl,
} from "@/lib";
import type { LinkFormState, FormErrors } from "@/lib/types";

// =============================================================================
// Component
// =============================================================================

interface ShortLinkFormProps {
  onSuccess?: (shortUrl: string) => void;
}

export function ShortLinkForm({ onSuccess }: ShortLinkFormProps) {
  // Form state
  const [formData, setFormData] = useState<LinkFormState>({
    url: "",
    customAlias: "",
    expiresAt: "",
    maxClicks: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Hooks
  const { success, error: showError } = useToast();
  const createLink = useCreateLink();
  const checkAlias = useCheckAlias();

  // Validation
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    // URL validation
    const urlWithProtocol = ensureProtocol(formData.url);
    if (!formData.url.trim()) {
      newErrors.url = "URL is required";
    } else if (!isValidUrl(urlWithProtocol)) {
      newErrors.url = "Please enter a valid URL";
    }

    // Custom alias validation (optional)
    if (formData.customAlias && !isValidAlias(formData.customAlias)) {
      newErrors.customAlias =
        "Alias must be 3-30 characters (letters, numbers, - and _ only)";
    }

    // Max clicks validation (optional)
    if (formData.maxClicks) {
      const maxClicks = parseInt(formData.maxClicks, 10);
      if (isNaN(maxClicks) || maxClicks < 1) {
        newErrors.maxClicks = "Must be a positive number";
      }
    }

    // Expiration validation (optional)
    if (formData.expiresAt) {
      const expiresDate = new Date(formData.expiresAt);
      if (expiresDate <= new Date()) {
        newErrors.expiresAt = "Expiration must be in the future";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  // Handle input changes
  const handleChange = (field: keyof LinkFormState, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user types
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  // Check alias availability (debounced in hook)
  const handleAliasBlur = useCallback(async () => {
    if (formData.customAlias && isValidAlias(formData.customAlias)) {
      const result = await checkAlias.mutateAsync(formData.customAlias);
      if (!result.available) {
        setErrors((prev) => ({
          ...prev,
          customAlias: result.reason || "This alias is not available",
        }));
      }
    }
  }, [formData.customAlias, checkAlias]);

  // Handle form submission
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    try {
      const result = await createLink.mutateAsync({
        url: ensureProtocol(formData.url),
        customAlias: formData.customAlias || undefined,
        expiresAt: formData.expiresAt || undefined,
        maxClicks: formData.maxClicks ? parseInt(formData.maxClicks, 10) : undefined,
      });

      if (result.success && result.data) {
        const shortUrl = buildShortUrl(result.data.shortCode);
        setCreatedUrl(shortUrl);
        success("Link created!", "Your short link is ready to use");
        onSuccess?.(shortUrl);

        // Reset form
        setFormData({
          url: "",
          customAlias: "",
          expiresAt: "",
          maxClicks: "",
        });
        setShowAdvanced(false);
      } else {
        showError("Failed to create link", result.error);
      }
    } catch (err) {
      showError(
        "Error",
        err instanceof Error ? err.message : "Failed to create link"
      );
    }
  };

  // Copy to clipboard
  const handleCopy = async () => {
    if (createdUrl) {
      const success = await copyToClipboard(createdUrl);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* URL Input */}
        <div>
          <label
            htmlFor="url"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Enter your long URL
          </label>
          <div className="flex gap-2">
            <input
              id="url"
              type="text"
              value={formData.url}
              onChange={(e) => handleChange("url", e.target.value)}
              placeholder="https://example.com/very/long/url"
              className={`flex-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                errors.url ? "border-red-500" : "border-gray-300"
              }`}
              aria-describedby={errors.url ? "url-error" : undefined}
              aria-invalid={!!errors.url}
            />
            <button
              type="submit"
              disabled={createLink.isPending}
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {createLink.isPending ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Creating...
                </span>
              ) : (
                "Shorten"
              )}
            </button>
          </div>
          {errors.url && (
            <p id="url-error" className="mt-1 text-sm text-red-600">
              {errors.url}
            </p>
          )}
        </div>

        {/* Advanced Options Toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-blue-600 hover:text-blue-700 focus:outline-none flex items-center gap-1"
        >
          <svg
            className={`w-4 h-4 transition-transform ${
              showAdvanced ? "rotate-90" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          Advanced options
        </button>

        {/* Advanced Options */}
        {showAdvanced && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
            {/* Custom Alias */}
            <div>
              <label
                htmlFor="customAlias"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Custom alias (optional)
              </label>
              <input
                id="customAlias"
                type="text"
                value={formData.customAlias}
                onChange={(e) => handleChange("customAlias", e.target.value)}
                onBlur={handleAliasBlur}
                placeholder="my-link"
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.customAlias ? "border-red-500" : "border-gray-300"
                }`}
                aria-describedby={errors.customAlias ? "alias-error" : undefined}
              />
              {errors.customAlias && (
                <p id="alias-error" className="mt-1 text-xs text-red-600">
                  {errors.customAlias}
                </p>
              )}
            </div>

            {/* Expiration */}
            <div>
              <label
                htmlFor="expiresAt"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Expires (optional)
              </label>
              <input
                id="expiresAt"
                type="datetime-local"
                value={formData.expiresAt}
                onChange={(e) => handleChange("expiresAt", e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.expiresAt ? "border-red-500" : "border-gray-300"
                }`}
              />
              {errors.expiresAt && (
                <p className="mt-1 text-xs text-red-600">{errors.expiresAt}</p>
              )}
            </div>

            {/* Max Clicks */}
            <div>
              <label
                htmlFor="maxClicks"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Max clicks (optional)
              </label>
              <input
                id="maxClicks"
                type="number"
                min="1"
                value={formData.maxClicks}
                onChange={(e) => handleChange("maxClicks", e.target.value)}
                placeholder="Unlimited"
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.maxClicks ? "border-red-500" : "border-gray-300"
                }`}
              />
              {errors.maxClicks && (
                <p className="mt-1 text-xs text-red-600">{errors.maxClicks}</p>
              )}
            </div>
          </div>
        )}
      </form>

      {/* Created URL Display */}
      {createdUrl && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700 font-medium mb-2">
            🎉 Your short link is ready!
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={createdUrl}
              className="flex-1 px-3 py-2 bg-white border border-green-300 rounded-md text-green-800 font-mono"
            />
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
