# Short Code Generation Design

> **Document Status:** Production-ready  
> **Last Updated:** 2024-12-18  
> **Owner:** Backend Team

---

## Overview

This document defines the short code generation strategy for QuickLink URL shortener.

**Design Goals:**
- Unpredictable codes (security)
- No central coordination (horizontal scaling)
- Multi-region safe
- Low collision probability
- Blocklist support for reserved/inappropriate codes

---

## 1️⃣ Generation Strategy

### Chosen Approach: Random Base62

We use **cryptographically secure random generation** with Base62 encoding.

**Why Random over Sequential/Counter:**

| Aspect | Random Base62 | Sequential Counter |
|--------|---------------|-------------------|
| Predictability | ❌ Cannot enumerate | ⚠️ Easy to guess next |
| Coordination | ❌ None needed | ⚠️ Central service required |
| Multi-region | ✅ Safe | ⚠️ Complex synchronization |
| Collision | ⚠️ Check required | ✅ Never collides |
| Code length | Fixed (7 chars) | Grows over time |

**Trade-off:** We accept collision checks in exchange for security and simplicity.

---

## 2️⃣ Code Length & Alphabet

### Alphabet (Base62)

```
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
```

- 62 characters total
- URL-safe (no encoding needed)
- Case-sensitive
- No ambiguous characters removed (simplicity over readability)

### Code Length: 7 Characters

```
Total combinations = 62^7 = 3,521,614,606,208 (~3.5 trillion)
```

**Capacity Planning:**

| Links Stored | Fill Rate | Collision Probability |
|--------------|-----------|----------------------|
| 1 million | 0.00003% | ~0.00001% |
| 10 million | 0.0003% | ~0.0001% |
| 100 million | 0.003% | ~0.001% |
| 1 billion | 0.03% | ~0.01% |
| 10 billion | 0.3% | ~0.1% |

**Safe threshold:** 1% fill rate = ~35 billion links before considering length increase.

---

## 3️⃣ Collision Handling

### Strategy: Generate + Check + Retry

```
┌─────────────────────────────────────────────────────────┐
│  Generate Random Code                                   │
│         │                                               │
│         ▼                                               │
│  Is code in blocklist? ──YES──► Retry (no DB check)    │
│         │                                               │
│         NO                                              │
│         ▼                                               │
│  Check DB for existence ──EXISTS──► Retry              │
│         │                                               │
│         NO                                              │
│         ▼                                               │
│  INSERT with unique constraint                          │
│         │                                               │
│         ├──SUCCESS──► Return code                       │
│         │                                               │
│         └──DUPLICATE KEY──► Retry (race condition)     │
│                                                         │
│  Max 5 retries, then fail                              │
└─────────────────────────────────────────────────────────┘
```

### Why This Approach:

1. **Blocklist check first** — Avoids unnecessary DB calls
2. **SELECT before INSERT** — Reduces write contention
3. **Unique constraint** — Final safety net for race conditions
4. **Limited retries** — Fail fast, don't loop forever

### Retry Limits

| Attempt | Action |
|---------|--------|
| 1-5 | Generate new code, retry |
| 6+ | Fail with error |

At 0.003% collision rate (100M links), probability of 5 consecutive collisions: `(0.00003)^5 ≈ 0` (effectively impossible).

---

## 4️⃣ Blocklist Rules

### Categories

1. **System Routes** — Reserved for application endpoints
2. **Brand Names** — Legal/trademark protection
3. **Profanity** — Content policy compliance
4. **Confusing Codes** — Could cause user confusion

### System Routes (Blocked)

```
health, ready, live, metrics, status, ping
api, v1, v2, graphql, webhook
login, logout, signup, signin, register, auth
admin, dashboard, account, profile, settings
links, link, create, new, edit, delete
static, assets, public, docs, help, about
```

### Brand Names (Blocked)

```
google, facebook, twitter, instagram, youtube
bitly, tinyurl, quicklink, ql
```

### Profanity

- Basic list included in code
- Extensible via configuration
- Check both exact match and substring contains

### Confusing Codes

```
null, undefined, none, empty, void
true, false, yes, no
error, 404, 500, test, demo
```

### Blocklist Behavior

| Check Type | Applied To | Action |
|------------|-----------|--------|
| Exact match | Auto-generated codes | Regenerate |
| Exact match | Custom aliases | Reject |
| Substring match | Custom aliases only | Reject |

---

## 5️⃣ Custom Aliases

Users may provide custom short codes (aliases) with additional validation:

### Validation Rules

| Rule | Constraint |
|------|-----------|
| Length | 3-30 characters |
| Characters | `a-zA-Z0-9`, `-`, `_` |
| Start/End | Must be alphanumeric |
| Blocklist | No blocked words (including substrings) |
| Uniqueness | Must not exist in database |

### Regex Pattern

```regex
^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$
```

---

## 6️⃣ Implementation Interface

### Core Functions

```typescript
// Generate a random 7-character Base62 code
generateRandomCode(length?: number): string

// Generate with collision checking (async)
generateUniqueCode(existsCheck: (code: string) => Promise<boolean>): Promise<string>

// Validate auto-generated code format
validateShortCode(code: string): ValidationResult

// Validate user-provided custom alias
validateCustomAlias(alias: string): ValidationResult

// Check if code is in blocklist
isBlockedCode(code: string): boolean
```

### Types

```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
}
```

---

## 7️⃣ Evolution Strategy

### Phase 1: Current (0-1B links)
- 7-character codes
- Random Base62
- Single-region

### Phase 2: Scale (1B-10B links)
- Monitor collision rate
- Consider 8-character codes if collision > 0.1%
- Add region prefix for multi-region: `{region}:{code}`

### Phase 3: Extreme Scale (10B+ links)
- Hybrid approach: timestamp prefix + random suffix
- Example: `{base62(timestamp)}{random}` = predictable length, unique per millisecond
- Or switch to sequential with distributed ID service (Snowflake-like)

### Migration Path

1. New codes get new format
2. Old codes remain valid (backward compatible)
3. Version in key schema: `ql:v2:link:{newformat}`

---

## 8️⃣ Security Considerations

### Rate Limiting
- Limit code generation: 100/minute per user
- Limit custom alias attempts: 10/minute per user

### Enumeration Prevention
- Random codes cannot be predicted
- No sequential patterns to exploit
- Failed lookups return same response time (timing attack prevention)

### Input Validation
- Sanitize all inputs before processing
- Reject URLs with dangerous protocols
- Block known malicious domains

---

## 9️⃣ Monitoring

### Metrics to Track

| Metric | Alert Threshold |
|--------|-----------------|
| Collision rate | > 0.1% |
| Generation retries | > 2 average |
| Blocklist hits | Informational |
| Custom alias rejections | Informational |

### Prometheus Metrics

```
quicklink_shortcode_generated_total{type="random|custom"}
quicklink_shortcode_collisions_total
quicklink_shortcode_retries_total
quicklink_shortcode_blocklist_hits_total
quicklink_shortcode_validation_failures_total{reason="..."}
```

---

## Summary

| Aspect | Decision |
|--------|----------|
| Strategy | Random Base62 |
| Length | 7 characters |
| Alphabet | `0-9A-Za-z` (62 chars) |
| Capacity | ~3.5 trillion codes |
| Collision handling | Check + retry (max 5) |
| Blocklist | System routes, brands, profanity, confusing |
| Custom aliases | 3-30 chars, alphanumeric + `-_` |
| Evolution | Increase length or add prefix when needed |

---

## Appendix: Collision Probability Formula

Birthday problem approximation:

```
P(collision) ≈ 1 - e^(-n²/2N)

Where:
  n = number of existing codes
  N = total possible codes (62^7)
```

For n = 100,000,000 (100M):
```
P ≈ 1 - e^(-(10^8)²/(2 × 3.5 × 10^12))
P ≈ 1 - e^(-1428)
P ≈ 0.0014 (0.14%)
```

Single generation collision probability: `n/N = 100M / 3.5T ≈ 0.003%`
