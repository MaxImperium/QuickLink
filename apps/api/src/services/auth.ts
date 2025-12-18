/**
 * Authentication Service
 *
 * Handles user registration, login, and JWT token management.
 * Uses bcrypt for password hashing and jsonwebtoken for JWT.
 */

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  prisma,
  type User,
  type SafeUser,
  type AuthPayload,
  type AuthResponse,
  type RegisterInput,
  type LoginInput,
} from "@quicklink/db";
import { logger } from "@quicklink/logger";

// ============================================================================
// Configuration
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-key-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);

// Validate JWT_SECRET in production
if (process.env.NODE_ENV === "production" && JWT_SECRET === "your-super-secret-key-change-in-production") {
  throw new Error("JWT_SECRET must be set in production environment");
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert User to SafeUser (strips sensitive fields)
 */
export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(user: User): string {
  const payload: AuthPayload = {
    userId: user.id.toString(),
    email: user.email,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    return decoded;
  } catch (error) {
    logger.debug({ error }, "Token verification failed");
    return null;
  }
}

// ============================================================================
// Auth Service Functions
// ============================================================================

/**
 * Register a new user
 *
 * @param input - Registration data (email, password, optional name)
 * @returns AuthResponse with token and user on success
 */
export async function register(input: RegisterInput): Promise<AuthResponse> {
  const { email, password, name } = input;

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      success: false,
      error: "Invalid email format",
    };
  }

  // Validate password strength
  if (password.length < 8) {
    return {
      success: false,
      error: "Password must be at least 8 characters long",
    };
  }

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return {
        success: false,
        error: "Email already registered",
      };
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        hashedPassword,
        name: name || null,
      },
    });

    logger.info({ userId: user.id.toString(), email: user.email }, "User registered");

    // Generate token
    const token = generateToken(user);

    return {
      success: true,
      token,
      user: toSafeUser(user),
    };
  } catch (error) {
    logger.error({ error, email }, "Registration failed");
    return {
      success: false,
      error: "Registration failed. Please try again.",
    };
  }
}

/**
 * Login a user with email and password
 *
 * @param input - Login credentials
 * @returns AuthResponse with token and user on success
 */
export async function login(input: LoginInput): Promise<AuthResponse> {
  const { email, password } = input;

  try {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Use generic error to prevent email enumeration
      return {
        success: false,
        error: "Invalid email or password",
      };
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.hashedPassword);

    if (!isValidPassword) {
      logger.debug({ email }, "Invalid password attempt");
      return {
        success: false,
        error: "Invalid email or password",
      };
    }

    logger.info({ userId: user.id.toString(), email: user.email }, "User logged in");

    // Generate token
    const token = generateToken(user);

    return {
      success: true,
      token,
      user: toSafeUser(user),
    };
  } catch (error) {
    logger.error({ error, email }, "Login failed");
    return {
      success: false,
      error: "Login failed. Please try again.",
    };
  }
}

/**
 * Get user by ID
 *
 * @param userId - User ID as string (from JWT)
 * @returns User or null if not found
 */
export async function getUserById(userId: string): Promise<SafeUser | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
    });

    if (!user) {
      return null;
    }

    return toSafeUser(user);
  } catch (error) {
    logger.error({ error, userId }, "Failed to get user by ID");
    return null;
  }
}

/**
 * Get user by email
 *
 * @param email - User email
 * @returns User or null if not found
 */
export async function getUserByEmail(email: string): Promise<SafeUser | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return null;
    }

    return toSafeUser(user);
  } catch (error) {
    logger.error({ error, email }, "Failed to get user by email");
    return null;
  }
}
