/**
 * Authentication Routes
 *
 * Endpoints:
 *   POST /auth/register  - Register a new user
 *   POST /auth/login     - Login and get JWT token
 *   GET  /auth/me        - Get current user profile
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { register, login } from "../../services/auth.js";
import { requireAuth } from "../../middleware/auth.js";
import { logger } from "@quicklink/logger";

// ============================================================================
// Request Schemas (Zod)
// ============================================================================

const registerSchema = z.object({
  email: z
    .string()
    .email("Invalid email format")
    .max(255, "Email too long"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long"),
  name: z
    .string()
    .min(1, "Name cannot be empty")
    .max(100, "Name too long")
    .optional(),
});

const loginSchema = z.object({
  email: z
    .string()
    .email("Invalid email format")
    .max(255, "Email too long"),
  password: z
    .string()
    .min(1, "Password is required")
    .max(128, "Password too long"),
});

type RegisterBody = z.infer<typeof registerSchema>;
type LoginBody = z.infer<typeof loginSchema>;

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * POST /auth/register - Register a new user
 */
async function registerHandler(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply
): Promise<void> {
  // Validate request body
  const parseResult = registerSchema.safeParse(request.body);

  if (!parseResult.success) {
    return reply.status(400).send({
      success: false,
      error: "Validation failed",
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { email, password, name } = parseResult.data;

  const result = await register({ email, password, name });

  if (!result.success) {
    // Determine status code based on error
    const statusCode = result.error === "Email already registered" ? 409 : 400;
    return reply.status(statusCode).send(result);
  }

  logger.info({ email }, "New user registered");

  return reply.status(201).send({
    success: true,
    token: result.token,
    user: result.user,
  });
}

/**
 * POST /auth/login - Login and get JWT token
 */
async function loginHandler(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply
): Promise<void> {
  // Validate request body
  const parseResult = loginSchema.safeParse(request.body);

  if (!parseResult.success) {
    return reply.status(400).send({
      success: false,
      error: "Validation failed",
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { email, password } = parseResult.data;

  const result = await login({ email, password });

  if (!result.success) {
    return reply.status(401).send(result);
  }

  logger.info({ email }, "User logged in");

  return reply.status(200).send({
    success: true,
    token: result.token,
    user: result.user,
  });
}

/**
 * GET /auth/me - Get current user profile
 */
async function meHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // User is guaranteed by requireAuth middleware
  const user = request.user!;

  return reply.status(200).send({
    success: true,
    user,
  });
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register auth routes
 */
export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /auth/register
  fastify.post(
    "/auth/register",
    {
      schema: {
        description: "Register a new user account",
        tags: ["auth"],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            name: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              token: { type: "string" },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                  name: { type: "string", nullable: true },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            },
          },
          400: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
              details: { type: "object" },
            },
          },
          409: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
            },
          },
        },
      },
    },
    registerHandler
  );

  // POST /auth/login
  fastify.post(
    "/auth/login",
    {
      schema: {
        description: "Login and receive JWT token",
        tags: ["auth"],
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              token: { type: "string" },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                  name: { type: "string", nullable: true },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            },
          },
          401: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
            },
          },
        },
      },
    },
    loginHandler
  );

  // GET /auth/me (protected)
  fastify.get(
    "/auth/me",
    {
      preHandler: requireAuth,
      schema: {
        description: "Get current user profile",
        tags: ["auth"],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                  name: { type: "string", nullable: true },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                },
              },
            },
          },
          401: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
              code: { type: "string" },
            },
          },
        },
      },
    },
    meHandler
  );

  logger.info("Auth routes registered");
}
