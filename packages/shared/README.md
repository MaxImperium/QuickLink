# @quicklink/shared

Shared types, utilities, and constants for QuickLink.

## Overview

This package contains code shared across multiple apps and packages, ensuring type consistency and code reuse.

## Contents

### Types
- API request/response types
- Domain entities (Link, User, Click)
- Validation schemas (Zod)

### Utils
- Short code generation
- URL validation
- Date helpers

### Constants
- Error codes
- HTTP status codes
- Configuration defaults

## Usage

```typescript
// Import types
import type { Link, CreateLinkRequest } from "@quicklink/shared/types";

// Import utilities
import { generateShortCode, validateUrl } from "@quicklink/shared/utils";

// Import constants
import { ERROR_CODES, DEFAULT_TTL } from "@quicklink/shared/constants";
```

## Structure

```
src/
├── index.ts              # Main exports
├── types/
│   ├── index.ts
│   ├── link.ts           # Link-related types
│   ├── user.ts           # User-related types
│   └── api.ts            # API request/response types
├── utils/
│   ├── index.ts
│   ├── shortcode.ts      # Short code generation
│   └── validation.ts     # Input validation
└── constants/
    ├── index.ts
    └── errors.ts         # Error code definitions
```

## Guidelines

1. **Only shared code**: Don't add app-specific code
2. **No side effects**: Pure functions only
3. **Well documented**: All exports should have JSDoc
4. **Well tested**: High test coverage for utilities
