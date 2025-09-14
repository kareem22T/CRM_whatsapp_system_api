import { DataSource } from 'typeorm';
import { Message } from '../entities/Message.ts';
import { Session } from '../entities/Session.ts';
import { Chat } from '../entities/Chat.ts';
import { MessageAnalytics } from '../entities/MessageAnalytics.ts';
import { User } from '../entities/User.ts';
import { Contact, ContactGroup } from '../entities/Contact.ts';
import { MessageTemplate } from '../entities/MessageTemplate.ts';
import { Campaign } from '../entities/Campaign.ts';
import { CampaignJob } from '../entities/CampaignJob.ts';

export const AppDataSource = new DataSource({
  type: 'mssql',
  host: '67.211.221.109',
  port: 1433,
  username: 'Whatsapp@Cyrus',
  password: 'apC31Wu@rssah2typ',
  database: 'CRM_Whatsapp',
  synchronize: true,
  logging: false,
  entities: [Message, Session, Chat, MessageAnalytics, User, Contact, ContactGroup, MessageTemplate, Campaign, CampaignJob],
  migrations: ['src/migrations/*.ts'],
  subscribers: ['src/subscribers/*.ts'],
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
});

// export const AppDataSource = new DataSource({
//   type: 'mssql',
//   host: '192.168.1.149',
//   port: 1433,
//   username: 'cyrus_crm_root',
//   password: 'Password',
//   database: 'crm_whatsapp',
//   synchronize: true,
//   logging: false,
//   entities: [Message, Session, Chat, MessageAnalytics, User, Contact, ContactGroup, MessageTemplate, Campaign, CampaignJob],
//   migrations: ['src/migrations/*.ts'],
//   subscribers: ['src/subscribers/*.ts'],
//   options: {
//     encrypt: false,
//     trustServerCertificate: true
//   }
// });