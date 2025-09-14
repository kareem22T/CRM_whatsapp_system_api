import { Repository } from 'typeorm';
import { Session } from '../entities/Session.ts';
import { AppDataSource } from '../database/data-source.ts';

export class SessionRepository extends Repository<Session> {
  constructor() {
    super(Session, AppDataSource.manager);
  }

  async findWithStatistics(options: { active?: boolean; page?: number; limit?: number } = {}) {
    const { active, page = 1, limit = 20 } = options;

    const query = this.createQueryBuilder('session')
      .leftJoinAndSelect('session.messages', 'message')
      .select([
        'session.sessionName',
        'session.agentName',
        'session.createdAt',
        'COUNT(message.id) as totalMessages',
        'SUM(CASE WHEN message.isFromMe = true THEN 1 ELSE 0 END) as sentMessages',
        'SUM(CASE WHEN message.isFromMe = false THEN 1 ELSE 0 END) as receivedMessages',
        'SUM(CASE WHEN message.mediaFilename IS NOT NULL THEN 1 ELSE 0 END) as mediaMessages',
        'MIN(message.timestamp) as firstMessageTime',
        'MAX(message.timestamp) as lastMessageTime'
      ])
      .groupBy('session.sessionName, session.agentName, session.createdAt')
      .orderBy('MAX(message.timestamp)', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (active !== undefined) {
      if (active) {
        query.andWhere('session.lastConnected >= :thirtyDaysAgo', {
          thirtyDaysAgo: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        });
      } else {
        query.andWhere('(session.lastConnected < :thirtyDaysAgo OR session.lastConnected IS NULL)', {
          thirtyDaysAgo: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        });
      }
    }

    return query.getRawAndEntities();
  }

  async findByAgentName(agentName: string): Promise<Session[]> {
    return this.find({
      where: { agentName },
      order: { createdAt: 'DESC' }
    });
  }
}
