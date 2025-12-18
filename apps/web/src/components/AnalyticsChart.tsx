"use client";

/**
 * AnalyticsChart Component
 *
 * Displays click statistics in chart format.
 * Uses Recharts for visualization.
 */

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { DailyStats } from "@/lib/types";

// =============================================================================
// Types
// =============================================================================

interface AnalyticsChartProps {
  data: DailyStats[];
  type?: "bar" | "line";
  showBots?: boolean;
  height?: number;
}

// =============================================================================
// Component
// =============================================================================

export function AnalyticsChart({
  data,
  type = "bar",
  showBots = false,
  height = 300,
}: AnalyticsChartProps) {
  // Format date for display
  const formattedData = data.map((item) => ({
    ...item,
    displayDate: new Date(item.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-gray-50 rounded-lg"
        style={{ height }}
      >
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  const ChartComponent = type === "bar" ? BarChart : LineChart;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ChartComponent
        data={formattedData}
        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="displayDate"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "#e5e7eb" }}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "#e5e7eb" }}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          }}
          formatter={(value: number, name: string) => [
            value.toLocaleString(),
            name === "clicks"
              ? "Total Clicks"
              : name === "uniqueVisitors"
              ? "Unique Visitors"
              : "Bot Clicks",
          ]}
        />
        <Legend />
        {type === "bar" ? (
          <>
            <Bar
              dataKey="clicks"
              fill="#3b82f6"
              name="Total Clicks"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="uniqueVisitors"
              fill="#10b981"
              name="Unique Visitors"
              radius={[4, 4, 0, 0]}
            />
            {showBots && (
              <Bar
                dataKey="botClicks"
                fill="#f59e0b"
                name="Bot Clicks"
                radius={[4, 4, 0, 0]}
              />
            )}
          </>
        ) : (
          <>
            <Line
              type="monotone"
              dataKey="clicks"
              stroke="#3b82f6"
              strokeWidth={2}
              name="Total Clicks"
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="uniqueVisitors"
              stroke="#10b981"
              strokeWidth={2}
              name="Unique Visitors"
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            {showBots && (
              <Line
                type="monotone"
                dataKey="botClicks"
                stroke="#f59e0b"
                strokeWidth={2}
                name="Bot Clicks"
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            )}
          </>
        )}
      </ChartComponent>
    </ResponsiveContainer>
  );
}

// =============================================================================
// Stats Cards
// =============================================================================

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export function StatsCard({ title, value, subtitle, icon, trend }: StatsCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
          )}
          {trend && (
            <p
              className={`mt-1 text-sm ${
                trend.isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {trend.isPositive ? "↑" : "↓"} {Math.abs(trend.value)}%
            </p>
          )}
        </div>
        {icon && (
          <div className="p-3 bg-blue-50 rounded-full text-blue-600">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Top Items List
// =============================================================================

interface TopListProps {
  title: string;
  items: { label: string; count: number }[];
  maxItems?: number;
}

export function TopList({ title, items, maxItems = 5 }: TopListProps) {
  const displayItems = items.slice(0, maxItems);
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-4">{title}</h3>
      {displayItems.length === 0 ? (
        <p className="text-gray-400 text-sm">No data available</p>
      ) : (
        <ul className="space-y-3">
          {displayItems.map((item, index) => {
            const percentage = total > 0 ? (item.count / total) * 100 : 0;
            return (
              <li key={index} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700 truncate" title={item.label}>
                    {item.label || "Direct"}
                  </span>
                  <span className="text-gray-500">
                    {item.count.toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// =============================================================================
// Mini Stat
// =============================================================================

interface MiniStatProps {
  label: string;
  value: string | number;
  color?: "blue" | "green" | "yellow" | "red";
}

export function MiniStat({ label, value, color = "blue" }: MiniStatProps) {
  const colorClasses = {
    blue: "bg-blue-100 text-blue-800",
    green: "bg-green-100 text-green-800",
    yellow: "bg-yellow-100 text-yellow-800",
    red: "bg-red-100 text-red-800",
  };

  return (
    <div className={`px-3 py-2 rounded-lg ${colorClasses[color]}`}>
      <p className="text-xs font-medium opacity-75">{label}</p>
      <p className="text-lg font-bold">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
