# @quicklink/web

Next.js 14 frontend application for the QuickLink URL shortener platform.

## Overview

This is the main user-facing web application built with Next.js 14 using the App Router, React Query for state management, and TailwindCSS for styling.

## Features

- **URL Shortening**: Quick and easy URL shortening from the home page
- **Dashboard**: Manage all your shortened URLs with filtering and search
- **Analytics**: Detailed click analytics with charts and geographic data
- **Custom Aliases**: Create memorable custom short codes
- **Link Management**: Set expiration dates and click limits
- **Responsive Design**: Works on all device sizes
- **Toast Notifications**: User feedback for all actions

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **State Management**: TanStack React Query
- **Styling**: TailwindCSS
- **Charts**: Recharts
- **TypeScript**: Full type safety

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home page with URL shortener hero |
| `/dashboard` | Link management dashboard |
| `/link/[code]` | Detailed link analytics |

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run type check
pnpm typecheck

# Run linting
pnpm lint
```

## Environment Variables

Create a `.env.local` file in the web app directory:

```env
# API URL (Fastify backend)
NEXT_PUBLIC_API_URL=http://localhost:3001

# Redirect service URL (for building short URLs)
NEXT_PUBLIC_REDIRECT_URL=http://localhost:3002
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # Root layout with providers
│   ├── page.tsx            # Home page
│   ├── globals.css         # Global styles
│   ├── dashboard/
│   │   └── page.tsx        # Dashboard page
│   └── link/
│       └── [code]/
│           └── page.tsx    # Link detail page
├── components/             # React components
│   ├── AnalyticsChart.tsx  # Charts and stats cards
│   ├── Layout.tsx          # Header, Footer, Loading states
│   ├── LinkList.tsx        # Paginated links table
│   ├── ShortLinkForm.tsx   # URL shortening form
│   └── Toast.tsx           # Toast notification system
├── hooks/                  # Custom React hooks
│   ├── useCheckAlias.ts    # Alias availability check
│   ├── useCreateLink.ts    # Create link mutation
│   ├── useDeleteLink.ts    # Delete link mutation
│   ├── useLink.ts          # Fetch single link
│   ├── useLinks.ts         # Fetch paginated links
│   └── useLinkStats.ts     # Fetch link statistics
└── lib/                    # Utilities
    ├── api.ts              # API client functions
    ├── providers.tsx       # React Query provider
    ├── types.ts            # TypeScript interfaces
    └── utils.ts            # Helper functions
```

## Components

### ShortLinkForm
URL input with validation, custom alias support, and expiration options.

### LinkList
Paginated table with status filtering, search, copy, and delete actions.

### AnalyticsChart
Bar/line charts for click data, stats cards, and top lists.

### Toast
Context-based notification system with auto-dismiss.

## Hooks

All hooks use React Query for caching and automatic refetching:

- `useCreateLink()` - Mutation for creating new links
- `useLinks(filters)` - Query for paginated link list
- `useLink(code)` - Query for single link details
- `useLinkStats(code)` - Query for link analytics
- `useCheckAlias(alias)` - Mutation for alias availability
- `useDeleteLink()` - Mutation for deleting links

## API Integration

The frontend integrates with the Fastify API (`@quicklink/api`) running on port 3001:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/links` | GET | List links (paginated) |
| `/links` | POST | Create a new link |
| `/links/:id` | GET | Get link details |
| `/links/:id` | DELETE | Delete a link |
| `/links/:id/stats` | GET | Get link statistics |
| `/links/check` | POST | Check alias availability |

## Styling

TailwindCSS is used throughout with custom configurations:

- Custom color palette
- Animations (fade-in, slide-in)
- Custom scrollbar styles
- Form input styles
- Badge variants
