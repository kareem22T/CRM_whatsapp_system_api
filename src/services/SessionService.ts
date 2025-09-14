import { SessionRepository } from '../repositories/SessionRepository.ts';
import { Session } from '../entities/Session.ts';
import { DatabaseManager } from '../database/database-manager.ts';
import { Message } from '../entities/Message.ts';

export class SessionService {
  private sessionRepository: SessionRepository;

  constructor() {
    this.sessionRepository = new SessionRepository();
  }

  async createSession(sessionName: string, agentName: string, userId: number): Promise<Session> {
    // Check if session already exists
    const existingSession = await this.sessionRepository.findOne({
      where: { sessionName }
    });

    if (existingSession) {
      throw new Error(`Session with name "${sessionName}" already exists`);
    }

    // Check if agent already has a session
    const existingAgent = await this.sessionRepository.findByAgentName(agentName);
    if (existingAgent.length > 0) {
      throw new Error(`Agent "${agentName}" already has existing sessions`);
    }

    const session = this.sessionRepository.create({
      sessionName,
      agentName,
      isActive: true,
      connectionStatus: 'inactive',
      userId: userId
    });

    return this.sessionRepository.save(session);
  }

  async getAllSessions(userId?: number): Promise<Session[]> {
    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    return this.sessionRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }
  async getSessionWithStats(
    sessionName: string
  ): Promise<{
    session: Session;
    stats: {
      totalMessages: number;
      sentMessages: number;
      receivedMessages: number;
      mediaMessages: number;
      individualChats: number;
      groupChats: number;
      firstMessageTime: Date;
      lastMessageTime: Date;
      activeDays: number;
    };
  } | null> {
    const session = await this.sessionRepository.findOne({
      where: { sessionName },
      relations: ['messages']
    });

    if (!session) {
      return null;
    }

    // Calculate statistics
    const messages = session.messages;
    const totalMessages = messages.length;
    const sentMessages = messages.filter(m => m.isFromMe).length;
    const receivedMessages = messages.filter(m => !m.isFromMe).length;
    const mediaMessages = messages.filter(m => m.mediaFilename).length;
    
    const individualChats = new Set(
      messages
        .filter(m => !m.isGroup)
        .map(m => m.isFromMe ? m.toNumber : m.fromNumber)
    ).size;
    
    const groupChats = new Set(
      messages
        .filter(m => m.isGroup)
        .map(m => m.groupId)
    ).size;

    const timestamps = messages.map(m => m.timestamp).sort();
    const firstMessageTime = timestamps[0];
    const lastMessageTime = timestamps[timestamps.length - 1];
    
    const activeDays = firstMessageTime && lastMessageTime 
      ? Math.ceil((lastMessageTime.getTime() - firstMessageTime.getTime()) / (1000 * 60 * 60 * 24)) + 1
      : 0;

    return {
      session,
      stats: {
        totalMessages,
        sentMessages,
        receivedMessages,
        mediaMessages,
        individualChats,
        groupChats,
        firstMessageTime,
        lastMessageTime,
        activeDays
      }
    };
  }

  async updateSessionStatus(sessionName: string, status: string): Promise<void> {
    await this.sessionRepository.update(
      { sessionName },
      { 
        connectionStatus: status,
        lastConnected: new Date()
      }
    );
  }

  async getSessionStatistics(
    sessionName: string,
    days: number = 30
  ): Promise<any> {
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const query = this.sessionRepository
      .createQueryBuilder('session')
      .leftJoin('session.messages', 'message', 'message.timestamp >= :fromDate', { fromDate })
      .where('session.sessionName = :sessionName', { sessionName })
      .select([
        'COUNT(message.id) as totalMessages',
        'SUM(CASE WHEN message.isFromMe = true THEN 1 ELSE 0 END) as sentMessages',
        'SUM(CASE WHEN message.isFromMe = false THEN 1 ELSE 0 END) as receivedMessages',
        'SUM(CASE WHEN message.mediaFilename IS NOT NULL THEN 1 ELSE 0 END) as mediaMessages',
        'SUM(CASE WHEN message.isGroup = true THEN 1 ELSE 0 END) as groupMessages',
        'COUNT(DISTINCT message.fromNumber) as uniqueContacts',
        'AVG(LENGTH(message.messageBody)) as avgMessageLength',
        'SUM(message.mediaSize) as totalMediaSize'
      ])
      .groupBy('session.id');

    return query.getRawOne();
  }
  async getSessionStats(sessionName: string, days: number = 30) {
    const dbManager = DatabaseManager.getInstance();
    const messageRepository = dbManager.dataSource.getRepository(Message);

    // Check if session exists
    const sessionExists = await messageRepository.findOne({
      where: { sessionName }
    });

    if (!sessionExists) {
      return null;
    }

    const dateFilter = new Date();
    dateFilter.setDate(dateFilter.getDate() - days);

    // Get overview stats
    const overviewQuery = messageRepository
      .createQueryBuilder('message')
      .select([
        'COUNT(*) as totalMessages',
        'SUM(CASE WHEN message.isFromMe = true THEN 1 ELSE 0 END) as sentMessages',
        'SUM(CASE WHEN message.isFromMe = false THEN 1 ELSE 0 END) as receivedMessages',
        'SUM(CASE WHEN message.mediaFilename IS NOT NULL THEN 1 ELSE 0 END) as mediaMessages',
        'SUM(CASE WHEN message.isGroup = true THEN 1 ELSE 0 END) as groupMessages',
        'COUNT(DISTINCT message.fromNumber) as uniqueContacts',
        'AVG(LENGTH(message.messageBody)) as avgMessageLength',
        'SUM(COALESCE(message.mediaSize, 0)) as totalMediaSize'
      ])
      .where('message.sessionName = :sessionName', { sessionName })
      .andWhere('message.timestamp >= :dateFilter', { dateFilter });

    const overview = await overviewQuery.getRawOne();

    // Get hourly distribution
    const hourlyQuery = messageRepository
      .createQueryBuilder('message')
      .select([
        'EXTRACT(hour FROM message.timestamp) as hour',
        'COUNT(*) as messageCount'
      ])
      .where('message.sessionName = :sessionName', { sessionName })
      .andWhere('message.timestamp >= :dateFilter', { dateFilter })
      .groupBy('EXTRACT(hour FROM message.timestamp)')
      .orderBy('hour');

    const hourlyDistribution = await hourlyQuery.getRawMany();

    // Get top contacts
    const topContactsQuery = messageRepository
      .createQueryBuilder('message')
      .select([
        'CASE WHEN message.isFromMe = true THEN message.toNumber ELSE message.fromNumber END as contact',
        'COUNT(*) as messageCount',
        'SUM(CASE WHEN message.isFromMe = true THEN 1 ELSE 0 END) as sentToContact',
        'SUM(CASE WHEN message.isFromMe = false THEN 1 ELSE 0 END) as receivedFromContact'
      ])
      .where('message.sessionName = :sessionName', { sessionName })
      .andWhere('message.timestamp >= :dateFilter', { dateFilter })
      .andWhere('message.isGroup = false')
      .groupBy('CASE WHEN message.isFromMe = true THEN message.toNumber ELSE message.fromNumber END')
      .orderBy('messageCount', 'DESC')
      .limit(10);

    const topContacts = await topContactsQuery.getRawMany();

    return {
      overview: {
        ...overview,
        totalMessages: parseInt(overview.totalMessages),
        sentMessages: parseInt(overview.sentMessages),
        receivedMessages: parseInt(overview.receivedMessages),
        mediaMessages: parseInt(overview.mediaMessages),
        groupMessages: parseInt(overview.groupMessages),
        uniqueContacts: parseInt(overview.uniqueContacts),
        avgMessageLength: parseFloat(overview.avgMessageLength) || 0,
        totalMediaSize: parseInt(overview.totalMediaSize) || 0
      },
      hourlyDistribution: hourlyDistribution.map(item => ({
        hour: parseInt(item.hour),
        messageCount: parseInt(item.messageCount)
      })),
      topContacts: topContacts.map(item => ({
        contact: item.contact,
        messageCount: parseInt(item.messageCount),
        sentToContact: parseInt(item.sentToContact),
        receivedFromContact: parseInt(item.receivedFromContact)
      })),
      periodDays: days
    };
  }
}
