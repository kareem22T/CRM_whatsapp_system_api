import { AppDataSource } from '../database/data-source.ts';
import { User, UserRole } from '../entities/User.ts';
import { Repository } from 'typeorm';
import { AuthUtils } from '../utils/auth.ts';
import { BlobOptions } from 'buffer';

export interface CreateUserData {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
}

export interface UpdateUserData {
  email?: string;
  name?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export class UserService {
  private userRepository: Repository<User>;

  constructor() {
    this.userRepository = AppDataSource.getRepository(User);
  }

  async createUser(userData: CreateUserData): Promise<User> {
    const existingUser = await this.userRepository.findOne({
      where: { email: userData.email }
    });

    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    const hashedPassword = await AuthUtils.hashPassword(userData.password);

    const user = this.userRepository.create({
      ...userData,
      password: hashedPassword,
      role: userData.role || UserRole.AGENT
    });

    return await this.userRepository.save(user);
  }

  async getUserById(id: number): Promise<User | null> {
    return await this.userRepository.findOne({
      where: { id },
      relations: ['sessions']
    });
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return await this.userRepository.findOne({
      where: { email },
      relations: ['sessions']
    });
  }

  async getAllUsers(
    page: number = 1,
    limit: number = 10,
    search: string = '',
    role: string = '',
    withMe: boolean = true,
    userId?: number // pass the current user’s ID here
  ): Promise<{
    users: User[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  }> {
    const skip = (page - 1) * limit;

    const queryBuilder = this.userRepository.createQueryBuilder('user')
      .leftJoinAndSelect('user.sessions', 'sessions');

    // Search filter
    if (search) {
      queryBuilder.andWhere(
        '(LOWER(user.name) LIKE LOWER(:search) OR LOWER(user.email) LIKE LOWER(:search))',
        { search: `%${search}%` }
      );
    }

    // Role filter
    if (role) {
      queryBuilder.andWhere('user.role = :role', { role });
    }

    // Exclude the current user if withMe === false
    if (!withMe && userId) {
      queryBuilder.andWhere('user.id != :userId', { userId });
    }

    // Count first
    const total = await queryBuilder.getCount();

    // Pagination
    const users = await queryBuilder
      .skip(skip)
      .take(limit)
      .orderBy('user.id', 'ASC')
      .getMany();

    const totalPages = Math.ceil(total / limit);

    return {
      users,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    };
  }
  async updateUser(id: number, updateData: UpdateUserData): Promise<User | null> {
    await this.userRepository.update(id, updateData);
    return await this.getUserById(id);
  }

  async deleteUser(id: number): Promise<boolean> {
    const result = await this.userRepository.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async login(credentials: LoginCredentials): Promise<{ user: User; token: string } | null> {
    const user = await this.getUserByEmail(credentials.email);

    if (!user || !user.isActive) {
      return null;
    }

    const isPasswordValid = await AuthUtils.comparePassword(credentials.password, user.password);

    if (!isPasswordValid) {
      return null;
    }

    // Update last login
    await this.userRepository.update(user.id, {
      lastLoginAt: new Date()
    });

    const token = AuthUtils.generateToken(user);

    return { user, token };
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await this.getUserById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    const isCurrentPasswordValid = await AuthUtils.comparePassword(currentPassword, user.password);

    if (!isCurrentPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    const hashedNewPassword = await AuthUtils.hashPassword(newPassword);

    await this.userRepository.update(userId, {
      password: hashedNewPassword
    });

    return true;
  }
}
