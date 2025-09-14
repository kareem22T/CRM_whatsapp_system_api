import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User, UserRole } from '../entities/User.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-this-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface JWTPayload {
  userId: number;
  email: string;
  role: UserRole;
  name: string;
}

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  name: string;
  isActive: boolean;
}

export class AuthUtils {
  static generateToken(user: User): string {
    const payload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    };

    return jwt.sign(
    payload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
    );
  }

  static verifyToken(token: string): JWTPayload | null {
    try {
      return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch (error) {
      return null;
    }
  }

  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  static async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  static isAdmin(user: AuthUser): boolean {
    return user.role === UserRole.ADMIN;
  }

  static isAgent(user: AuthUser): boolean {
    return user.role === UserRole.AGENT;
  }

  static canAccessSession(user: AuthUser, sessionUserId?: number): boolean {
    if (user.role === UserRole.ADMIN) {
      return true; // Admin can access all sessions
    }
    
    if (user.role === UserRole.AGENT) {
      return user.id === sessionUserId; // Agent can only access their own sessions
    }

    return false;
  }

  static sanitizeUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      isActive: user.isActive
    };
  }
}
