/**
 * Authentication Middleware
 *
 * Fastify hooks and decorators for JWT-based authentication.
 * Provides both required and optional authentication patterns.
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyPluginAsync,
  preHandlerHookHandler,
} from "fastify";
import fp from "fastify-plugin";
import { verifyToken, getUserById } from "../services/auth.js";
import type { AuthPayload, SafeUser } from "@quicklink/db";
import { logger } from "@quicklink/logger";

// ============================================================================
// Type Augmentation
// ============================================================================

declare module "fastify" {
  interface FastifyRequest {
    /** JWT payload if authenticated */
    auth?: AuthPayload;
    /** Current user if authenticated */
    user?: SafeUser;
    /** User ID as string if authenticated */
    userId?: string;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return null;
  }

  const [type, token] = authHeader.split(" ");

  if (type !== "Bearer" || !token) {
    return null;
  }

  return token;
}

// ============================================================================
// Middleware Hooks
// ============================================================================

/**
 * Required authentication hook
 *
 * Use this for routes that require a valid JWT token.
 * Returns 401 if no valid token is provided.
 *
 * Usage:
 * ```ts
 * fastify.get("/protected", { preHandler: requireAuth }, handler);
 * ```
 */
export const requireAuth: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  const token = extractBearerToken(request);

  if (!token) {
    return reply.status(401).send({
      success: false,
      error: "Authentication required",
      code: "UNAUTHORIZED",
    });
  }

  const payload = verifyToken(token);

  if (!payload) {
    return reply.status(401).send({
      success: false,
      error: "Invalid or expired token",
      code: "INVALID_TOKEN",
    });
  }

  // Optionally load full user (can be disabled for performance)
  const user = await getUserById(payload.userId);

  if (!user) {
    return reply.status(401).send({
      success: false,
      error: "User not found",
      code: "USER_NOT_FOUND",
    });
  }

  // Attach auth info to request
  request.auth = payload;
  request.user = user;
  request.userId = payload.userId;
};

/**
 * Optional authentication hook
 *
 * Use this for routes that work with or without authentication.
 * Attaches user info if valid token provided, continues without error otherwise.
 *
 * Usage:
 * ```ts
 * fastify.get("/public", { preHandler: optionalAuth }, handler);
 * ```
 */
export const optionalAuth: preHandlerHookHandler = async (
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> => {
  const token = extractBearerToken(request);

  if (!token) {
    return; // Continue without auth
  }

  const payload = verifyToken(token);

  if (!payload) {
    logger.debug("Invalid token provided for optional auth route");
    return; // Continue without auth
  }

  // Load user if token valid
  const user = await getUserById(payload.userId);

  if (user) {
    request.auth = payload;
    request.user = user;
    request.userId = payload.userId;
  }
};

// ============================================================================
// Fastify Plugin
// ============================================================================

/**
 * Authentication plugin
 *
 * Registers authentication decorators and global hooks.
 *
 * Usage:
 * ```ts
 * await fastify.register(authPlugin);
 * ```
 */
const authPluginCallback: FastifyPluginAsync = async (fastify: FastifyInstance): Promise<void> => {
  // Decorate request with auth properties
  fastify.decorateRequest("auth", null);
  fastify.decorateRequest("user", null);
  fastify.decorateRequest("userId", null);

  logger.info("Auth plugin registered");
};

export const authPlugin = fp(authPluginCallback, {
  name: "auth-plugin",
  fastify: "4.x",
});

// ============================================================================
// Route Protection Helper
// ============================================================================

/**
 * Create a route configuration with required auth
 */
export function protectedRoute<T>(
  config: T
): T & { preHandler: preHandlerHookHandler } {
  return {
    ...config,
    preHandler: requireAuth,
  };
}

/**
 * Create a route configuration with optional auth
 */
export function publicRoute<T>(
  config: T
): T & { preHandler: preHandlerHookHandler } {
  return {
    ...config,
    preHandler: optionalAuth,
  };
}
