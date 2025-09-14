import 'reflect-metadata';
import { AppDataSource } from './data-source.ts';

export class DatabaseManager {
  private static instance: DatabaseManager;
  private isInitialized = false;

  private constructor() {}

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await AppDataSource.initialize();
      this.isInitialized = true;
      console.log('✅ TypeORM Database initialized successfully');
      
      // Run any pending migrations
      await AppDataSource.runMigrations();
      console.log('✅ Database migrations completed');
      
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.isInitialized && AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      this.isInitialized = false;
      console.log('✅ Database connection closed');
    }
  }

  get dataSource() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return AppDataSource;
  }
}
