# @quicklink/web

Next.js frontend application for the QuickLink URL shortener platform.

## Overview

This is the main user-facing web application built with Next.js 14+ using the App Router.

## Features (Planned)

- Dashboard for managing shortened URLs
- Analytics visualization
- User authentication
- Link creation and management
- QR code generation

## Development

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

## Environment Variables

See `.env.example` in the root directory for required environment variables.

## Structure

```
src/
├── app/              # Next.js App Router pages
├── components/       # React components
├── hooks/            # Custom React hooks
├── lib/              # Utility functions
└── styles/           # Global styles
```
