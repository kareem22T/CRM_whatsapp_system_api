import { Request, Response, NextFunction } from 'express';
import { AuthUtils, JWTPayload, AuthUser } from '../utils/auth.ts';
import { UserService } from '../services/UserService.ts';

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export class AuthMiddleware {
  private static userService = new UserService();

  static authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          message: 'Access token is required'
        });
      }

      const token = authHeader.substring(7); // Remove "Bearer " prefix
      const decoded = AuthUtils.verifyToken(token);

      if (!decoded) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token'
        });
      }

      // Get fresh user data from database
      const user = await this.userService.getUserById(decoded.userId);

      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      req.user = AuthUtils.sanitizeUser(user);
      next();

    } catch (error) {
      console.error('Authentication error:', error);
      return res.status(500).json({
        success: false,
        message: 'Authentication failed'
      });
    }
  };

  static requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!AuthUtils.isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    next();
  };

  static requireRole = (roles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: `Required role: ${roles.join(' or ')}`
        });
      }

      next();
    };
  };
}
