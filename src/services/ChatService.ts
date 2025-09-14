import { ChatRepository } from '../repositories/ChatRepository.ts';
import { Chat } from '../entities/Chat.ts';
import { DeepPartial } from 'typeorm';
import { DatabaseManager } from '../database/database-manager.ts';
import { Message } from '../entities/Message.ts';

export class ChatService {
  private chatRepository: ChatRepository;

  constructor() {
    this.chatRepository = new ChatRepository();
  }

  async ensureChatExists(chatData: {
    chatId: string;
    chatName: string | null;
    chatType: 'individual' | 'group';
    participantNumber: string | null;
    sessionName: string;
    isGroup: boolean;
    groupName?: string | null;
  }): Promise<Chat> {
    try {
      // First, try to find existing chat
      let chat = await this.chatRepository.findOne({
        where: { 
          chatId: chatData.chatId,
          sessionName: chatData.sessionName 
        }
      });

      if (!chat) {
        // Create new chat if it doesn't exist
        chat = this.chatRepository.create({
          chatId: chatData.chatId,
          chatName: chatData.chatName,
          chatType: chatData.chatType,
          participantNumber: chatData.participantNumber,
          groupName: chatData.groupName,
          sessionName: chatData.sessionName,
          isActive: true,
          unreadCount: 0,
          totalMessages: 0,
          replyCount: 0
        } as DeepPartial<Chat>);

        await this.chatRepository.save(chat);
        console.log(`✅ Created new chat: ${chatData.chatId} (${chatData.chatType})`);
      } else {
        // Update chat info if needed
        let shouldUpdate = false;
        
        if (!chat.chatName && chatData.chatName) {
          chat.chatName = chatData.chatName;
          shouldUpdate = true;
        }
        
        if (!chat.participantNumber && chatData.participantNumber) {
          chat.participantNumber = chatData.participantNumber;
          shouldUpdate = true;
        }
        
        if (!chat.groupName && chatData.groupName) {
          chat.groupName = chatData.groupName;
          shouldUpdate = true;
        }

        if (shouldUpdate) {
          await this.chatRepository.save(chat);
          console.log(`📝 Updated chat info: ${chatData.chatId}`);
        }
      }

      return chat;
    } catch (error) {
      console.error('Error ensuring chat exists:', error);
      throw error;
    }
  }

  async updateLastMessage(updateData: {
    chatId: string;
    sessionName: string;
    messageId: string;
    messageText: string;
    messageTime: Date;
    messageFrom: string;
    isReply: boolean;
  }): Promise<void> {
    try {
      const chat = await this.chatRepository.findOne({
        where: { 
          chatId: updateData.chatId,
          sessionName: updateData.sessionName 
        }
      });

      if (chat) {
        chat.lastMessageId = updateData.messageId;
        chat.lastMessageText = updateData.messageText;
        chat.lastMessageTime = updateData.messageTime;
        chat.lastMessageFrom = updateData.messageFrom;
        chat.totalMessages = chat.totalMessages + 1;
        
        if (updateData.isReply) {
          chat.lastReplyId = updateData.messageId;
          chat.replyCount = chat.replyCount + 1;
        }

        await this.chatRepository.save(chat);
        console.log(`📝 Updated last message for chat: ${updateData.chatId}`);
      }
    } catch (error) {
      console.error('Error updating last message:', error);
      throw error;
    }
  }

  async updateOrCreateChat(chatData: {
    chatId: string;
    sessionName: string;
    lastMessageId?: string;
    lastMessageText?: string;
    lastMessageTime?: Date;
    lastMessageFrom?: string;
    chatName?: string;
    chatType?: 'individual' | 'group';
    participantNumber?: string;
    groupName?: string;
  }): Promise<Chat> {
    let chat = await this.chatRepository.findOne({
      where: {
        chatId: chatData.chatId,
        sessionName: chatData.sessionName
      }
    });

    if (chat) {
      // Update existing chat
      Object.assign(chat, {
        lastMessageId: chatData.lastMessageId || chat.lastMessageId,
        lastMessageText: chatData.lastMessageText || chat.lastMessageText,
        lastMessageTime: chatData.lastMessageTime || chat.lastMessageTime,
        lastMessageFrom: chatData.lastMessageFrom || chat.lastMessageFrom,
        chatName: chatData.chatName || chat.chatName,
        updatedAt: new Date()
      });
    } else {
      // Create new chat
      chat = this.chatRepository.create({
        chatId: chatData.chatId,
        sessionName: chatData.sessionName,
        chatName: chatData.chatName,
        chatType: chatData.chatType || 'individual',
        participantNumber: chatData.participantNumber,
        groupName: chatData.groupName,
        lastMessageId: chatData.lastMessageId,
        lastMessageText: chatData.lastMessageText,
        lastMessageTime: chatData.lastMessageTime,
        lastMessageFrom: chatData.lastMessageFrom,
        isActive: true,
        unreadCount: 0,
        totalMessages: 0,
        replyCount: 0
      });
    }

    return this.chatRepository.save(chat);
  }

  async getChatsBySession(
    sessionName: string,
    options: {
      chatType?: 'individual' | 'group';
      isActive?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ chats: any[]; total: number }> {
    try {
      const { entities: chats, raw } = await this.chatRepository.findBySessionWithStats(sessionName, options);
      
      // Combine entity data with raw statistics - handle case where raw data might not match
      const chatsWithStats = chats.map((chat, index) => {
        const rawData = raw[index] || {};
        return {
          ...chat,
          totalMessages: parseInt(rawData.totalMessages) || chat.totalMessages || 0,
          receivedMessages: parseInt(rawData.receivedMessages) || 0,
          sentMessages: parseInt(rawData.sentMessages) || 0
        };
      });

      // Get total count separately for reliability
      const whereCondition: any = { sessionName };
      if (options.chatType) {
        whereCondition.chatType = options.chatType;
      }
      if (options.isActive !== undefined) {
        whereCondition.isActive = options.isActive;
      }

      const total = await this.chatRepository.count({ where: whereCondition });

      return { chats: chatsWithStats, total };
    } catch (error) {
      console.error('Error getting chats by session:', error);
      
      // Fallback to simple query without stats
      const whereCondition: any = { sessionName };
      if (options.chatType) {
        whereCondition.chatType = options.chatType;
      }
      if (options.isActive !== undefined) {
        whereCondition.isActive = options.isActive;
      }

      const skip = ((options.page || 1) - 1) * (options.limit || 50);
      
      const [chats, total] = await this.chatRepository.findAndCount({
        where: whereCondition,
        order: { lastMessageTime: 'DESC' },
        skip,
        take: options.limit || 50
      });

      const chatsWithStats = chats.map(chat => ({
        ...chat,
        totalMessages: chat.totalMessages || 0,
        receivedMessages: 0,
        sentMessages: 0
      }));

      return { chats: chatsWithStats, total };
    }
  }

  async searchChats(
    searchQuery: string,
    options: {
      sessionName?: string;
      chatType?: 'individual' | 'group';
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ chats: Chat[]; total: number }> {
    try {
      const [chats, total] = await this.chatRepository.searchChats(searchQuery, options);
      return { chats, total };
    } catch (error) {
      console.error('Error searching chats:', error);
      throw error;
    }
  }

  async getChatById(sessionName: string, chatId: string): Promise<Chat | null> {
    return this.chatRepository.findOne({
      where: { sessionName, chatId },
      relations: ['messages']
    });
  }

  async updateChat(
    sessionName: string,
    chatId: string,
    updates: {
      isActive?: boolean;
      unreadCount?: number;
      chatName?: string;
    }
  ): Promise<void> {
    await this.chatRepository.update(
      { sessionName, chatId },
      { ...updates, updatedAt: new Date() }
    );
  }

  async getChatStatistics(sessionName: string, chatId: string): Promise<any> {
    try {
      const query = this.chatRepository
        .createQueryBuilder('chat')
        .leftJoin('chat.messages', 'message')
        .where('chat.sessionName = :sessionName', { sessionName })
        .andWhere('chat.chatId = :chatId', { chatId })
        .select([
          'COALESCE(COUNT(message.id), 0) as totalMessages',
          'COALESCE(SUM(CASE WHEN message.isFromMe = 1 THEN 1 ELSE 0 END), 0) as sentMessages',
          'COALESCE(SUM(CASE WHEN message.isFromMe = 0 THEN 1 ELSE 0 END), 0) as receivedMessages',
          'COALESCE(SUM(CASE WHEN message.mediaFilename IS NOT NULL THEN 1 ELSE 0 END), 0) as mediaMessages',
          'COALESCE(SUM(CASE WHEN message.isGroup = 1 THEN 1 ELSE 0 END), 0) as groupMessages',
          'MIN(message.timestamp) as firstMessageTime',
          'MAX(message.timestamp) as lastMessageTime',
          'COUNT(DISTINCT CASE WHEN message.isFromMe = 0 THEN message.fromNumber END) as uniqueSenders'
        ]);

      return await query.getRawOne();
    } catch (error) {
      console.error('Error getting chat statistics:', error);
      // Return default stats if query fails
      return {
        totalMessages: 0,
        sentMessages: 0,
        receivedMessages: 0,
        mediaMessages: 0,
        groupMessages: 0,
        firstMessageTime: null,
        lastMessageTime: null,
        uniqueSenders: 0
      };
    }
  }

  async markChatAsRead(sessionName: string, chatId: string): Promise<void> {
    try {
      await this.chatRepository.update(
        { sessionName, chatId },
        { unreadCount: 0, updatedAt: new Date() }
      );
      console.log(`📖 Marked chat as read: ${chatId}`);
    } catch (error) {
      console.error('Error marking chat as read:', error);
      throw error;
    }
  }

  async incrementUnreadCount(sessionName: string, chatId: string): Promise<void> {
    try {
      const chat = await this.chatRepository.findOne({
        where: { sessionName, chatId }
      });

      if (chat) {
        chat.unreadCount = (chat.unreadCount || 0) + 1;
        chat.updatedAt = new Date();
        await this.chatRepository.save(chat);
      }
    } catch (error) {
      console.error('Error incrementing unread count:', error);
      throw error;
    }
  }

  async deactivateChat(sessionName: string, chatId: string): Promise<void> {
    try {
      await this.chatRepository.update(
        { sessionName, chatId },
        { isActive: false, updatedAt: new Date() }
      );
      console.log(`🚫 Deactivated chat: ${chatId}`);
    } catch (error) {
      console.error('Error deactivating chat:', error);
      throw error;
    }
  }

  async getChatStats(sessionName: string, chatId: string): Promise<{
    totalMessages: number;
    replyCount: number;
    unreadCount: number;
    lastMessageTime: Date | null;
  } | null> {
    try {
      const chat = await this.chatRepository.findOne({
        where: { sessionName, chatId },
        select: ['totalMessages', 'replyCount', 'unreadCount', 'lastMessageTime']
      });

      if (!chat) {
        return null;
      }

      return {
        totalMessages: chat.totalMessages || 0,
        replyCount: chat.replyCount || 0,
        unreadCount: chat.unreadCount || 0,
        lastMessageTime: chat.lastMessageTime
      };
    } catch (error) {
      console.error('Error getting chat stats:', error);
      throw error;
    }
  }

  // Additional utility methods for better chat management

  async getActiveChats(sessionName: string): Promise<Chat[]> {
    return this.chatRepository.findActiveChats(sessionName);
  }

  async getRecentChats(sessionName: string, limit: number = 20): Promise<Chat[]> {
    return this.chatRepository.getRecentChats(sessionName, limit);
  }

  async getChatsByType(
    sessionName: string, 
    chatType: 'individual' | 'group'
  ): Promise<Chat[]> {
    return this.chatRepository.findChatsByType(sessionName, chatType);
  }

  async getTotalUnreadMessages(sessionName: string): Promise<number> {
    return this.chatRepository.getTotalUnreadMessages(sessionName);
  }

  async markAllChatsAsRead(sessionName: string): Promise<void> {
    await this.chatRepository.markAllAsRead(sessionName);
    console.log(`📖 Marked all chats as read for session: ${sessionName}`);
  }

  async cleanupOldChats(sessionName: string, olderThanDays: number = 30): Promise<void> {
    await this.chatRepository.deactivateOldChats(sessionName, olderThanDays);
    console.log(`🧹 Deactivated chats older than ${olderThanDays} days for session: ${sessionName}`);
  }

  // Debug method to troubleshoot the empty results issue
  async debugChatIssue(sessionName: string): Promise<any> {
    console.log('🐛 Starting debug for session:', sessionName);
    
    try {
      // Check total chats
      const allChats = await this.chatRepository.find();
      console.log('📊 Total chats in database:', allChats.length);
      
      // Check chats for this specific session
      const sessionChats = await this.chatRepository.find({
        where: { sessionName }
      });
      console.log('📊 Chats for session:', sessionChats.length);
      
      if (sessionChats.length > 0) {
        console.log('📋 First chat details:', {
          chatId: sessionChats[0].chatId,
          sessionName: sessionChats[0].sessionName,
          isActive: sessionChats[0].isActive,
          chatType: sessionChats[0].chatType
        });
      }
      
      // Check active chats
      const activeChats = await this.chatRepository.find({
        where: { sessionName, isActive: true }
      });
      console.log('📊 Active chats for session:', activeChats.length);
      
      // Check inactive chats
      const inactiveChats = await this.chatRepository.find({
        where: { sessionName, isActive: false }
      });
      console.log('📊 Inactive chats for session:', inactiveChats.length);
      
      // Check different session names (in case of encoding issues)
      const allSessionNames = await this.chatRepository
        .createQueryBuilder('chat')
        .select('DISTINCT chat.sessionName', 'sessionName')
        .getRawMany();
      
      console.log('📊 All session names in database:', allSessionNames.map(s => s.sessionName));
      
      return {
        totalChats: allChats.length,
        sessionChats: sessionChats.length,
        activeChats: activeChats.length,
        inactiveChats: inactiveChats.length,
        allSessionNames: allSessionNames.map(s => s.sessionName),
        sampleChat: sessionChats[0] || null
      };
    } catch (error: any) {
      console.error('🐛 Debug error:', error);
      return { error: error.message };
    }
  }
    async getAllChats(filters: {
    sessionName?: string;
    chatType?: 'individual' | 'group';
    isActive?: boolean;
    page: number;
    limit: number;
  }) {
    const dbManager = DatabaseManager.getInstance();
    const chatRepository = dbManager.dataSource.getRepository(Chat);

    const queryBuilder = chatRepository.createQueryBuilder('chat');

    if (filters.sessionName) {
      queryBuilder.andWhere('chat.sessionName = :sessionName', { sessionName: filters.sessionName });
    }

    if (filters.chatType) {
      queryBuilder.andWhere('chat.chatType = :chatType', { chatType: filters.chatType });
    }

    if (filters.isActive !== undefined) {
      queryBuilder.andWhere('chat.isActive = :isActive', { isActive: filters.isActive });
    }

    const total = await queryBuilder.getCount();

    const chats = await queryBuilder
      .leftJoinAndSelect('chat.messages', 'message')
      .addSelect([
        'COUNT(message.id) as totalMessages',
        'SUM(CASE WHEN message.isFromMe = false THEN 1 ELSE 0 END) as receivedMessages',
        'SUM(CASE WHEN message.isFromMe = true THEN 1 ELSE 0 END) as sentMessages'
      ])
      .groupBy('chat.id')
      .orderBy('chat.lastMessageTime', 'DESC')
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getRawAndEntities();

    const chatsWithStats = chats.entities.map((chat, index) => {
      const raw = chats.raw[index];
      return {
        ...chat,
        totalMessages: parseInt(raw.totalMessages) || 0,
        receivedMessages: parseInt(raw.receivedMessages) || 0,
        sentMessages: parseInt(raw.sentMessages) || 0
      };
    });

    return { chats: chatsWithStats, total };
  }

  async getChatDetails(sessionName: string, chatId: string) {
    const dbManager = DatabaseManager.getInstance();
    const chatRepository = dbManager.dataSource.getRepository(Chat);

    const chat = await chatRepository
      .createQueryBuilder('chat')
      .leftJoinAndSelect('chat.messages', 'message')
      .addSelect([
        'COUNT(message.id) as totalMessages',
        'SUM(CASE WHEN message.isFromMe = false THEN 1 ELSE 0 END) as receivedMessages',
        'SUM(CASE WHEN message.isFromMe = true THEN 1 ELSE 0 END) as sentMessages',
        'SUM(CASE WHEN message.mediaFilename IS NOT NULL THEN 1 ELSE 0 END) as mediaMessages'
      ])
      .where('chat.sessionName = :sessionName', { sessionName })
      .andWhere('chat.chatId = :chatId', { chatId })
      .groupBy('chat.id')
      .orderBy('chat.id', 'DESC')
      .getRawAndEntities();

    if (chat.entities.length === 0) {
      return null;
    }

    const chatEntity = chat.entities[0];
    const raw = chat.raw[0];

    return {
      ...chatEntity,
      totalMessages: parseInt(raw.totalMessages) || 0,
      receivedMessages: parseInt(raw.receivedMessages) || 0,
      sentMessages: parseInt(raw.sentMessages) || 0,
      mediaMessages: parseInt(raw.mediaMessages) || 0
    };
  }

  async getChatMessages(
    sessionName: string,
    chatId: string,
    filters: {
      hasMedia?: boolean;
      messageType?: string;
      page: number;
      limit: number;
    }
  ) {
    const dbManager = DatabaseManager.getInstance();
    const messageRepository = dbManager.dataSource.getRepository(Message);

    const queryBuilder = messageRepository
      .createQueryBuilder('message')
      .where('message.sessionName = :sessionName', { sessionName })
      .andWhere('message.chatId = :chatId', { chatId });

    if (filters.hasMedia !== undefined) {
      if (filters.hasMedia) {
        queryBuilder.andWhere('message.mediaFilename IS NOT NULL');
      } else {
        queryBuilder.andWhere('message.mediaFilename IS NULL');
      }
    }

    if (filters.messageType) {
      queryBuilder.andWhere('message.messageType = :messageType', { messageType: filters.messageType });
    }

    const total = await queryBuilder.getCount();

    const messages = await queryBuilder
      .orderBy('message.timestamp', 'DESC')
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getMany();

    return { messages, total };
  }

}