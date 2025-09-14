import { Repository, SelectQueryBuilder, Brackets } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { Chat } from '../entities/Chat';

export class ChatRepository extends Repository<Chat> {
  constructor() {
    super(Chat, AppDataSource.manager);
  }

  async findBySessionWithStats(
    sessionName: string, 
    options: {
      chatType?: 'individual' | 'group';
      isActive?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ entities: Chat[]; raw: any[] }> {
    const { chatType, isActive, page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    let queryBuilder = this.createQueryBuilder('chat')
      .leftJoin('chat.messages', 'message')
      .where('chat.sessionName = :sessionName', { sessionName });

    // Add filters
    if (chatType) {
      queryBuilder = queryBuilder.andWhere('chat.chatType = :chatType', { chatType });
    }

    if (isActive !== undefined) {
      queryBuilder = queryBuilder.andWhere('chat.isActive = :isActive', { isActive: isActive ? 1 : 0 });
    }

    // Group by chat fields and add statistics
    queryBuilder = queryBuilder
      .select([
        'chat.chatId',
        'chat.chatName', 
        'chat.chatType',
        'chat.participantNumber',
        'chat.groupName',
        'chat.lastMessageId',
        'chat.lastMessageText',
        'chat.lastMessageTime',
        'chat.lastMessageFrom',
        'chat.unreadCount',
        'chat.isActive',
        'chat.sessionName',
        'chat.totalMessages',
        'chat.lastReplyId',
        'chat.replyCount',
        'chat.createdAt',
        'chat.updatedAt'
      ])
      .addSelect('COALESCE(COUNT(message.id), 0)', 'totalMessages')
      .addSelect('COALESCE(SUM(CASE WHEN message.isFromMe = 0 THEN 1 ELSE 0 END), 0)', 'receivedMessages')
      .addSelect('COALESCE(SUM(CASE WHEN message.isFromMe = 1 THEN 1 ELSE 0 END), 0)', 'sentMessages')
      .groupBy('chat.chatId')
      .addGroupBy('chat.chatName')
      .addGroupBy('chat.chatType')
      .addGroupBy('chat.participantNumber')
      .addGroupBy('chat.groupName')
      .addGroupBy('chat.lastMessageId')
      .addGroupBy('chat.lastMessageText')
      .addGroupBy('chat.lastMessageTime')
      .addGroupBy('chat.lastMessageFrom')
      .addGroupBy('chat.unreadCount')
      .addGroupBy('chat.isActive')
      .addGroupBy('chat.sessionName')
      .addGroupBy('chat.totalMessages')
      .addGroupBy('chat.lastReplyId')
      .addGroupBy('chat.replyCount')
      .addGroupBy('chat.createdAt')
      .addGroupBy('chat.updatedAt')
      .orderBy('chat.lastMessageTime', 'DESC')
      .offset(offset)
      .limit(limit);

    const result = await queryBuilder.getRawAndEntities();
    return result;
  }

  async searchChats(
    searchQuery: string,
    options: {
      sessionName?: string;
      chatType?: 'individual' | 'group';
      page?: number;
      limit?: number;
    } = {}
  ): Promise<[Chat[], number]> {
    const { sessionName, chatType, page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    let queryBuilder = this.createQueryBuilder('chat');

    // Add session filter if provided
    if (sessionName) {
      queryBuilder = queryBuilder.where('chat.sessionName = :sessionName', { sessionName });
    }

    // Add chat type filter if provided
    if (chatType) {
      queryBuilder = queryBuilder.andWhere('chat.chatType = :chatType', { chatType });
    }

    // Add search conditions
    queryBuilder = queryBuilder.andWhere(
      new Brackets(qb => {
        qb.where('chat.chatName LIKE :searchQuery', { searchQuery: `%${searchQuery}%` })
          .orWhere('chat.participantNumber LIKE :searchQuery', { searchQuery: `%${searchQuery}%` })
          .orWhere('chat.groupName LIKE :searchQuery', { searchQuery: `%${searchQuery}%` })
          .orWhere('chat.lastMessageText LIKE :searchQuery', { searchQuery: `%${searchQuery}%` });
      })
    );

    // Order by last message time
    queryBuilder = queryBuilder
      .orderBy('chat.lastMessageTime', 'DESC')
      .offset(offset)
      .limit(limit);

    const [chats, total] = await queryBuilder.getManyAndCount();
    return [chats, total];
  }

  async findActiveChats(sessionName: string): Promise<Chat[]> {
    return this.find({
      where: {
        sessionName,
        isActive: true
      },
      order: {
        lastMessageTime: 'DESC'
      }
    });
  }

  async findChatsByType(
    sessionName: string, 
    chatType: 'individual' | 'group'
  ): Promise<Chat[]> {
    return this.find({
      where: {
        sessionName,
        chatType,
        isActive: true
      },
      order: {
        lastMessageTime: 'DESC'
      }
    });
  }

  async getChatWithMessages(sessionName: string, chatId: string): Promise<Chat | null> {
    return this.findOne({
      where: {
        sessionName,
        chatId
      },
      relations: ['messages'],
      order: {
        messages: {
          timestamp: 'ASC'
        }
      }
    });
  }

  async updateChatStats(
    sessionName: string,
    chatId: string,
    stats: {
      totalMessages?: number;
      unreadCount?: number;
      replyCount?: number;
    }
  ): Promise<void> {
    await this.update(
      { sessionName, chatId },
      { ...stats, updatedAt: new Date() }
    );
  }

  async getRecentChats(sessionName: string, limit: number = 20): Promise<Chat[]> {
    return this.find({
      where: {
        sessionName,
        isActive: true
      },
      order: {
        lastMessageTime: 'DESC'
      },
      take: limit
    });
  }

  async getChatsByParticipant(
    sessionName: string,
    participantNumber: string
  ): Promise<Chat[]> {
    return this.find({
      where: {
        sessionName,
        participantNumber,
        isActive: true
      },
      order: {
        lastMessageTime: 'DESC'
      }
    });
  }

  async getGroupChats(sessionName: string): Promise<Chat[]> {
    return this.find({
      where: {
        sessionName,
        chatType: 'group',
        isActive: true
      },
      order: {
        lastMessageTime: 'DESC'
      }
    });
  }

  async getIndividualChats(sessionName: string): Promise<Chat[]> {
    return this.find({
      where: {
        sessionName,
        chatType: 'individual',
        isActive: true
      },
      order: {
        lastMessageTime: 'DESC'
      }
    });
  }

  async markAllAsRead(sessionName: string): Promise<void> {
    await this.update(
      { sessionName },
      { unreadCount: 0, updatedAt: new Date() }
    );
  }

  async getUnreadChatsCount(sessionName: string): Promise<number> {
    return this.count({
      where: {
        sessionName,
        unreadCount: { $gt: 0 } as any,
        isActive: true
      }
    });
  }

  async getTotalUnreadMessages(sessionName: string): Promise<number> {
    const result = await this.createQueryBuilder('chat')
      .select('SUM(chat.unreadCount)', 'totalUnread')
      .where('chat.sessionName = :sessionName', { sessionName })
      .getRawOne();

    return parseInt(result?.totalUnread) || 0;
  }

  async deactivateOldChats(
    sessionName: string,
    olderThanDays: number = 30
  ): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    await this.createQueryBuilder('chat')
      .update()
      .set({ 
        isActive: false, 
        updatedAt: new Date() 
      })
      .where('sessionName = :sessionName', { sessionName })
      .andWhere('lastMessageTime < :cutoffDate', { cutoffDate })
      .execute();
  }

  // Simple test method to verify basic functionality
  async testSessionQuery(sessionName: string): Promise<any> {
    console.log('🧪 Testing query for session:', sessionName);
    
    try {
      // Test 1: Raw SQL query
      const rawResult = await this.query(`
        SELECT COUNT(*) as count 
        FROM chats 
        WHERE session_name = '${sessionName}'
      `);
      console.log('🧪 Raw SQL count:', rawResult);
      
      // Test 2: TypeORM query
      const typeormResult = await this.find({
        where: { sessionName }
      });
      console.log('🧪 TypeORM count:', typeormResult.length);
      
      // Test 3: Active chats
      const activeResult = await this.find({
        where: { sessionName, isActive: true }
      });
      console.log('🧪 Active chats count:', activeResult.length);
      
      return {
        rawCount: rawResult[0]?.count || 0,
        typeormCount: typeormResult.length,
        activeCount: activeResult.length,
        sampleData: typeormResult[0] || null
      };
    } catch (error: any) {
      console.error('🧪 Test query error:', error);
      return { error: error.message };
    }
  }
}