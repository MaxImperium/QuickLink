"use client";

/**
 * LinkList Component
 *
 * Displays a table of links with stats, actions, and filtering.
 */

import { useState } from "react";
import Link from "next/link";
import { useLinks, useDeleteLink } from "@/hooks";
import { useToast } from "./Toast";
import {
  formatDate,
  getRelativeTime,
  formatCompactNumber,
  truncateUrl,
  getStatusColor,
  copyToClipboard,
  buildShortUrl,
} from "@/lib";
import type { Link as LinkType, LinkStatus } from "@/lib/types";

// =============================================================================
// Component
// =============================================================================

export function LinkList() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<LinkStatus | "">("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, isError, error } = useLinks(page, 10, {
    status: statusFilter || undefined,
    search: searchQuery || undefined,
  });

  const { success, error: showError } = useToast();

  if (isLoading) {
    return <LinkListSkeleton />;
  }

  if (isError) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">
          Failed to load links: {error instanceof Error ? error.message : "Unknown error"}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const links = data?.data || [];
  const totalPages = data?.totalPages || 1;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search links..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as LinkStatus | "")}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Filter by status"
          >
            <option value="">All status</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </div>
        <p className="text-sm text-gray-500 self-center">
          {data?.total || 0} total links
        </p>
      </div>

      {/* Links Table */}
      {links.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No links yet</h3>
          <p className="mt-2 text-sm text-gray-500">
            Create your first short link to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Short Link
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Original URL
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Clicks
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {links.map((link) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  onCopy={() => {
                    copyToClipboard(buildShortUrl(link.shortCode));
                    success("Copied!", "Link copied to clipboard");
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Link Row
// =============================================================================

interface LinkRowProps {
  link: LinkType;
  onCopy: () => void;
}

function LinkRow({ link, onCopy }: LinkRowProps) {
  const deleteLink = useDeleteLink();
  const { success, error: showError } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const shortUrl = buildShortUrl(link.shortCode);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this link?")) return;

    setIsDeleting(true);
    try {
      await deleteLink.mutateAsync(link.shortCode);
      success("Deleted", "Link has been deleted");
    } catch (err) {
      showError(
        "Error",
        err instanceof Error ? err.message : "Failed to delete link"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Link
            href={`/link/${link.shortCode}`}
            className="text-blue-600 hover:text-blue-800 font-mono text-sm"
          >
            {link.shortCode}
          </Link>
          <button
            onClick={onCopy}
            className="p-1 text-gray-400 hover:text-gray-600"
            title="Copy link"
            aria-label="Copy short link"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
          </button>
        </div>
      </td>
      <td className="px-6 py-4">
        <a
          href={link.originalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-600 hover:text-gray-800 text-sm"
          title={link.originalUrl}
        >
          {truncateUrl(link.originalUrl, 40)}
        </a>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className="text-sm font-medium text-gray-900">
          {formatCompactNumber(link.clickCount)}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span
          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
            link.status
          )}`}
        >
          {link.status}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        <span title={formatDate(link.createdAt)}>
          {getRelativeTime(link.createdAt)}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <div className="flex justify-end gap-2">
          <Link
            href={`/link/${link.shortCode}`}
            className="text-blue-600 hover:text-blue-800"
          >
            View
          </Link>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-red-600 hover:text-red-800 disabled:opacity-50"
          >
            {isDeleting ? "..." : "Delete"}
          </button>
        </div>
      </td>
    </tr>
  );
}

// =============================================================================
// Skeleton
// =============================================================================

function LinkListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-10 bg-gray-200 rounded animate-pulse w-64" />
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-200 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}
