# @quicklink/config

Shared configuration files for the QuickLink monorepo.

## Contents

- ESLint configuration
- TypeScript base configurations
- Prettier configuration (inherited from root)

## Usage

```typescript
// In package.json
{
  "devDependencies": {
    "@quicklink/config": "workspace:*"
  }
}
```

```javascript
// In eslint.config.js
import config from "@quicklink/config/eslint";
export default config;
```

```json
// In tsconfig.json
{
  "extends": "@quicklink/config/tsconfig/base.json"
}
```
