import { MessageRepository } from '../repositories/MessageRepository.ts';
import { ChatService } from './ChatService.ts';
import { AppDataSource } from '../database/data-source.ts';
import { Message } from '../entities/Message.ts';
import { DatabaseManager } from '../database/database-manager.ts';

export class MessageService {
  private messageRepository: MessageRepository;
  private chatService: ChatService;

  constructor() {
    this.messageRepository = new MessageRepository();
    this.chatService = new ChatService();
  }

  async saveMessage(messageData: Partial<Message>): Promise<Message> {
    // Check if message already exists
    const existingMessage = await this.messageRepository.findOne({
      where: { messageId: messageData.messageId }
    });

    if (existingMessage) {
      console.log(`⚠️ Message already exists: ${messageData.messageId}`);
      return existingMessage;
    }

    // Create new message
    const message = this.messageRepository.create(messageData);
    const savedMessage = await this.messageRepository.save(message);

    // Update chat information
    if (messageData.chatId && messageData.sessionName) {
      await this.chatService.updateOrCreateChat({
        chatId: messageData.chatId,
        sessionName: messageData.sessionName,
        lastMessageId: messageData.messageId,
        lastMessageText: messageData.messageBody || `[${messageData.messageType?.toUpperCase()}]`,
        lastMessageTime: messageData.timestamp || new Date(),
        lastMessageFrom: messageData.isFromMe ? 'You' : (messageData.participantName || 'Unknown'),
        chatName: messageData.participantName,
        chatType: messageData.isGroup ? 'group' : 'individual',
        participantNumber: messageData.isFromMe ? messageData.toNumber : messageData.fromNumber,
        groupName: String(messageData.isGroup ? messageData.participantName : null)
      });
    }

    console.log(`✅ Message saved: ${savedMessage.messageId}`);
    return savedMessage;
  }

  async updateMessageStatus(messageId: string, status: string): Promise<void> {
    await this.messageRepository.updateStatus(messageId, status);
  }

  async getMessagesBySession(
    sessionName: string,
    options: {
      limit?: number;
      offset?: number;
      type?: 'all' | 'sent' | 'received';
      participant?: string;
    } = {}
  ): Promise<{ messages: Message[]; total: number }> {
    const { limit = 50, offset = 0, type = 'all', participant } = options;
    const page = Math.floor(offset / limit) + 1;

    let messages: Message[];
    let total: number;

    const query = this.messageRepository.createQueryBuilder('message')
      .where('message.sessionName = :sessionName', { sessionName })
      .orderBy('message.timestamp', 'DESC')
      .skip(offset)
      .take(limit);

    if (type === 'sent') {
      query.andWhere('message.isFromMe = :isFromMe', { isFromMe: true });
    } else if (type === 'received') {
      query.andWhere('message.isFromMe = :isFromMe', { isFromMe: false });
    }

    if (participant) {
      query.andWhere('(message.participantName LIKE :participant OR message.participantPhone LIKE :participant)', {
        participant: `%${participant}%`
      });
    }

    [messages, total] = await query.getManyAndCount();

    return { messages, total };
  }

  async searchMessages(
    searchQuery: string,
    options: {
      sessionName?: string;
      messageType?: string;
      hasMedia?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ messages: Message[]; total: number }> {
    const { page = 1, limit = 20 } = options;
    const [messages, total] = await this.messageRepository.searchMessages(searchQuery, { ...options, page, limit });
    
    return { messages, total };
  }

  async getMessagesWithFilters(options: {
    sessionName?: string;
    messageType?: string;
    hasMedia?: boolean;
    isGroup?: boolean;
    fromDate?: Date;
    toDate?: Date;
    search?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ messages: Message[]; total: number }> {
    const [messages, total] = await this.messageRepository.findMessagesWithFilters(options);
    
    return { messages, total };
  }

  async getChatBetweenNumbers(
    number1: string,
    number2: string,
    options: {
      sessionName?: string;
      page?: number;
      limit?: number;
      order?: 'ASC' | 'DESC';
    } = {}
  ): Promise<{ messages: Message[]; total: number }> {
    const [messages, total] = await this.messageRepository.findChatBetweenNumbers(number1, number2, options);
    
    return { messages, total };
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    return this.messageRepository.findOne({ where: { messageId } });
  }

  async getMessagesByNumber(
    phoneNumber: string,
    options: {
      sessionName?: string;
      hasMedia?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ messages: Message[]; total: number }> {
    const [messages, total] = await this.messageRepository.findByNumberWithPagination(phoneNumber, options);
    
    return { messages, total };
  }

  async getReplyChain(messageId: string): Promise<Message[]> {
    return this.messageRepository.getReplyChain(messageId);
  }

    async getMessagesSentBy(
    number: string, 
    filters: {
      sessionName?: string;
      hasMedia?: boolean;
      page: number;
      limit: number;
    }
  ) {
    const dbManager = DatabaseManager.getInstance();
    const messageRepository = dbManager.dataSource.getRepository(Message);

    const queryBuilder = messageRepository
      .createQueryBuilder('message')
      .where('message.fromNumber = :number', { number })
      .andWhere('message.isFromMe = :isFromMe', { isFromMe: true });

    if (filters.sessionName) {
      queryBuilder.andWhere('message.sessionName = :sessionName', { sessionName: filters.sessionName });
    }

    if (filters.hasMedia !== undefined) {
      if (filters.hasMedia) {
        queryBuilder.andWhere('message.mediaFilename IS NOT NULL');
      } else {
        queryBuilder.andWhere('message.mediaFilename IS NULL');
      }
    }

    const total = await queryBuilder.getCount();

    const messages = await queryBuilder
      .orderBy('message.timestamp', 'DESC')
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getMany();

    return { messages, total };
  }

  async downloadMessageMedia(messageId: string) {
    const fs = require('fs');
    const path = require('path');
    const mime = require('mime-types');

    const message = await this.getMessageById(messageId);
    
    if (!message || !message.mediaFilename) {
      return null;
    }

    const mediaDir = path.join(process.cwd(), 'media');
    const filepath = path.join(mediaDir, message.mediaFilename);

    // Security check: prevent directory traversal
    if (!filepath.startsWith(mediaDir)) {
      throw new Error('Invalid filename');
    }

    // Check if file exists
    if (!fs.existsSync(filepath)) {
      return null;
    }

    // Get file stats
    const stats = fs.statSync(filepath);
    
    // Enhanced MIME type detection
    let mimeType = message.mediaMimetype || this.getMimeType(message.mediaFilename);
    
    // Determine original filename for download
    const originalName = message.mediaFilename.includes('_') ? 
      message.mediaFilename.split('_').slice(2).join('_') : message.mediaFilename;

    return {
      filepath,
      message,
      stats,
      mimeType,
      originalName
    };
  }

  private getMimeType(filename: string): string {
    const mime = require('mime-types');
    const path = require('path');

    let mimeType = mime.lookup(filename);
    
    if (!mimeType) {
      const extension = path.extname(filename).toLowerCase();
      const customMimeTypes: { [key: string]: string } = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.aac': 'audio/aac',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.txt': 'text/plain',
        '.bin': 'application/octet-stream'
      };
      
      mimeType = customMimeTypes[extension] || 'application/octet-stream';
    }
    
    return mimeType;
  }

}
