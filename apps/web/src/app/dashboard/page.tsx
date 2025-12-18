import { LinkList, ShortLinkForm } from "@/components";

/**
 * Dashboard Page
 *
 * Shows user's links with stats and management options.
 */
export default function DashboardPage() {
  return (
    <main className="flex-1 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-2 text-gray-600">
            Manage your short links and view analytics.
          </p>
        </div>

        {/* Quick Create Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Create New Link
          </h2>
          <ShortLinkForm />
        </div>

        {/* Links List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Your Links
          </h2>
          <LinkList />
        </div>
      </div>
    </main>
  );
}
