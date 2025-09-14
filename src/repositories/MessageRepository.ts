import { Repository } from 'typeorm';
import { Message } from '../entities/Message.ts';
import { AppDataSource } from '../database/data-source.ts';

export class MessageRepository extends Repository<Message> {
  constructor() {
    super(Message, AppDataSource.manager);
  }

  async findBySender(phoneNumber: string, sessionName?: string, page: number = 1, limit: number = 50) {
    const query = this.createQueryBuilder('message')
      .where('message.fromNumber = :phoneNumber', { phoneNumber })
      .andWhere('message.isFromMe = :isFromMe', { isFromMe: true })
      .orderBy('message.timestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (sessionName) {
      query.andWhere('message.sessionName = :sessionName', { sessionName });
    }

    return query.getManyAndCount();
  }

  async findByNumberWithPagination(
    phoneNumber: string, 
    options: {
      sessionName?: string;
      hasMedia?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ) {
    const { sessionName, hasMedia, page = 1, limit = 50 } = options;
    
    const query = this.createQueryBuilder('message')
      .where('(message.fromNumber = :phoneNumber OR message.toNumber = :phoneNumber)', { phoneNumber })
      .orderBy('message.timestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (sessionName) {
      query.andWhere('message.sessionName = :sessionName', { sessionName });
    }

    if (hasMedia !== undefined) {
      if (hasMedia) {
        query.andWhere('message.mediaFilename IS NOT NULL');
      } else {
        query.andWhere('message.mediaFilename IS NULL');
      }
    }

    return query.getManyAndCount();
  }

  async findChatBetweenNumbers(
    number1: string, 
    number2: string, 
    options: {
      sessionName?: string;
      page?: number;
      limit?: number;
      order?: 'ASC' | 'DESC';
    } = {}
  ) {
    const { sessionName, page = 1, limit = 50, order = 'DESC' } = options;
    
    const query = this.createQueryBuilder('message')
      .where('((message.fromNumber = :number1 AND message.toNumber = :number2) OR (message.fromNumber = :number2 AND message.toNumber = :number1))', {
        number1,
        number2
      })
      .orderBy('message.timestamp', order)
      .skip((page - 1) * limit)
      .take(limit);

    if (sessionName) {
      query.andWhere('message.sessionName = :sessionName', { sessionName });
    }

    return query.getManyAndCount();
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
  ) {
    const { sessionName, messageType, hasMedia, page = 1, limit = 20 } = options;
    
    const query = this.createQueryBuilder('message')
      .where('(message.messageBody LIKE :searchQuery OR message.fromNumber LIKE :searchQuery OR message.toNumber LIKE :searchQuery)', {
        searchQuery: `%${searchQuery}%`
      })
      .orderBy('message.timestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (sessionName) {
      query.andWhere('message.sessionName = :sessionName', { sessionName });
    }

    if (messageType) {
      query.andWhere('message.messageType = :messageType', { messageType });
    }

    if (hasMedia !== undefined) {
      if (hasMedia) {
        query.andWhere('message.mediaFilename IS NOT NULL');
      } else {
        query.andWhere('message.mediaFilename IS NULL');
      }
    }

    return query.getManyAndCount();
  }

  async findMessagesWithFilters(options: {
    sessionName?: string;
    messageType?: string;
    hasMedia?: boolean;
    isGroup?: boolean;
    fromDate?: Date;
    toDate?: Date;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const {
      sessionName,
      messageType,
      hasMedia,
      isGroup,
      fromDate,
      toDate,
      search,
      page = 1,
      limit = 50
    } = options;

    const query = this.createQueryBuilder('message')
      .orderBy('message.timestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (sessionName) {
      query.andWhere('message.sessionName = :sessionName', { sessionName });
    }

    if (messageType) {
      query.andWhere('message.messageType = :messageType', { messageType });
    }

    if (hasMedia !== undefined) {
      if (hasMedia) {
        query.andWhere('message.mediaFilename IS NOT NULL');
      } else {
        query.andWhere('message.mediaFilename IS NULL');
      }
    }

    if (isGroup !== undefined) {
      query.andWhere('message.isGroup = :isGroup', { isGroup });
    }

    if (fromDate) {
      query.andWhere('message.timestamp >= :fromDate', { fromDate });
    }

    if (toDate) {
      query.andWhere('message.timestamp <= :toDate', { toDate });
    }

    if (search) {
      query.andWhere('(message.messageBody LIKE :search OR message.fromNumber LIKE :search OR message.toNumber LIKE :search)', {
        search: `%${search}%`
      });
    }

    return query.getManyAndCount();
  }

  async getReplyChain(messageId: string): Promise<Message[]> {
    // Get the original message
    const originalMessage = await this.findOne({ where: { messageId } });
    if (!originalMessage) {
      return [];
    }

    // Get all replies to this message using a recursive CTE approach
    const query = `
      WITH ReplyChain AS (
        SELECT *, 1 as Level
        FROM messages 
        WHERE quoted_message_id = @0
        
        UNION ALL
        
        SELECT m.*, rc.Level + 1
        FROM messages m
        INNER JOIN ReplyChain rc ON m.quoted_message_id = rc.message_id
        WHERE rc.Level < 10
      )
      SELECT * FROM ReplyChain ORDER BY Level, timestamp
    `;

    return this.query(query, [messageId]);
  }

  async updateStatus(messageId: string, status: string): Promise<void> {
    await this.update({ messageId }, { messageStatus: status });
  }
}
