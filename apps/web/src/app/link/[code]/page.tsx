"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useLink, useLinkStats } from "@/hooks";
import {
  AnalyticsChart,
  StatsCard,
  TopList,
  PageLoader,
  ErrorState,
  Alert,
} from "@/components";
import { useToast } from "@/components/Toast";
import {
  formatDate,
  formatDateTime,
  formatCompactNumber,
  getStatusColor,
  copyToClipboard,
  buildShortUrl,
  isExpired,
} from "@/lib";

/**
 * Link Detail Page
 *
 * Shows detailed information and analytics for a single link.
 */
export default function LinkPage() {
  const params = useParams();
  const code = params.code as string;

  const { data: link, isLoading, isError, error } = useLink(code);
  const { data: stats, isLoading: statsLoading } = useLinkStats(code, {
    enabled: !!link,
  });

  const { success } = useToast();

  if (isLoading) {
    return <PageLoader />;
  }

  if (isError || !link) {
    return (
      <main className="flex-1 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ErrorState
            title="Link not found"
            message={
              error instanceof Error
                ? error.message
                : "The link you're looking for doesn't exist or has been deleted."
            }
            onRetry={() => window.location.reload()}
          />
          <div className="text-center mt-4">
            <Link
              href="/dashboard"
              className="text-blue-600 hover:text-blue-800"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const shortUrl = buildShortUrl(link.shortCode);
  const expired = isExpired(link.expiresAt);

  const handleCopy = async () => {
    await copyToClipboard(shortUrl);
    success("Copied!", "Link copied to clipboard");
  };

  return (
    <main className="flex-1 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav className="mb-6">
          <Link
            href="/dashboard"
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            ← Back to Dashboard
          </Link>
        </nav>

        {/* Link Header */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900 font-mono">
                  {link.shortCode}
                </h1>
                <span
                  className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full ${getStatusColor(
                    link.status
                  )}`}
                >
                  {link.status}
                </span>
              </div>
              <p className="mt-2 text-gray-600 break-all">{link.originalUrl}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                Copy Link
              </button>
              <a
                href={shortUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Visit
              </a>
            </div>
          </div>

          {/* Short URL Display */}
          <div className="mt-4 p-3 bg-gray-50 rounded-md">
            <p className="text-sm text-gray-500 mb-1">Short URL</p>
            <p className="font-mono text-blue-600">{shortUrl}</p>
          </div>

          {/* Warnings */}
          {expired && (
            <Alert
              type="warning"
              title="This link has expired"
              message="Visitors will see a 404 error when trying to access this link."
              className="mt-4"
            />
          )}
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <StatsCard
            title="Total Clicks"
            value={link.clickCount}
            icon={
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                />
              </svg>
            }
          />
          <StatsCard
            title="Unique Visitors"
            value={stats?.uniqueVisitors || 0}
            icon={
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            }
          />
          <StatsCard
            title="Bot Traffic"
            value={`${stats?.botPercentage || 0}%`}
            icon={
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            }
          />
          <StatsCard
            title="Created"
            value={formatDate(link.createdAt)}
            subtitle={link.isPermanent ? "Permanent (301)" : "Temporary (302)"}
          />
        </div>

        {/* Charts and Details */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Click Chart */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Clicks Over Time
              </h2>
            </div>
            {statsLoading ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : (
              <AnalyticsChart
                data={stats?.clicksByDay || []}
                type="bar"
                height={300}
              />
            )}
          </div>

          {/* Side Info */}
          <div className="space-y-6">
            {/* Link Details */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-4">
                Link Details
              </h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-gray-400">Short Code</dt>
                  <dd className="font-mono text-gray-900">{link.shortCode}</dd>
                </div>
                {link.customAlias && (
                  <div>
                    <dt className="text-xs text-gray-400">Custom Alias</dt>
                    <dd className="text-gray-900">{link.customAlias}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-gray-400">Created</dt>
                  <dd className="text-gray-900">
                    {formatDateTime(link.createdAt)}
                  </dd>
                </div>
                {link.expiresAt && (
                  <div>
                    <dt className="text-xs text-gray-400">Expires</dt>
                    <dd
                      className={
                        expired ? "text-red-600" : "text-gray-900"
                      }
                    >
                      {formatDateTime(link.expiresAt)}
                    </dd>
                  </div>
                )}
                {link.maxClicks && (
                  <div>
                    <dt className="text-xs text-gray-400">Max Clicks</dt>
                    <dd className="text-gray-900">
                      {formatCompactNumber(link.clickCount)} /{" "}
                      {formatCompactNumber(link.maxClicks)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Top Countries */}
            <TopList
              title="Top Countries"
              items={
                stats?.topCountries.map((c) => ({
                  label: c.country || "Unknown",
                  count: c.count,
                })) || []
              }
            />

            {/* Top Referrers */}
            <TopList
              title="Top Referrers"
              items={
                stats?.topReferrers.map((r) => ({
                  label: r.referrer || "Direct",
                  count: r.count,
                })) || []
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
}
