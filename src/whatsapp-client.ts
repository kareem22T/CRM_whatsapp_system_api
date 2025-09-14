
import 'reflect-metadata';
import { Client } from 'whatsapp-web.js';
import pkg from 'whatsapp-web.js';
const { LocalAuth, MessageMedia } = pkg;

import fs from 'fs';
import path from 'path';
import express from 'express';
import qrcode from 'qrcode';
import cors from 'cors';
import multer from 'multer';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

// TypeORM imports
import { DatabaseManager } from './database/database-manager.ts';
import { MessageService } from './services/MessageService.ts';
import { SessionService } from './services/SessionService.ts';
import { ChatService } from './services/ChatService.ts';
import { Message } from './entities/Message.ts';

import { fileURLToPath } from "url";
import { AuthMiddleware } from './middleware/auth.ts';

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { CampaignService } from './services/CampaignService.ts';
import { ContactService } from './services/ContactService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(cors());
const connection = new IORedis({
  host: '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: null
});

connection.ping().then(console.log); // لازم يطبع PONG
export const jobQueue = new Queue('send-campaign-message', { connection });

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

let campaignService: CampaignService;
const dbManager = DatabaseManager.getInstance();
await dbManager.initialize();
campaignService = new CampaignService(dbManager.dataSource);


let activeSessions: { [key: string]: Client } = {};
let qrCodes: { [key: string]: any } = {};
let sessionStatuses: { [key: string]: string } = {};

// Services
let messageService: MessageService;
let sessionService: SessionService;
let chatService: ChatService;
let contactService: ContactService;

// Create media directory if it doesn't exist
const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

// Real-time event emitter functions
function emitNewMessage(sessionName: string, message: any, direction: string, participantInfo: any = null) {
  const eventData = {
    sessionName,
    direction,
    messageId: message.id.id,
    from: message.from,
    to: message.to,
    body: message.body || `[${message.type.toUpperCase()}]`,
    type: message.type,
    isGroup: message.from.includes('@g.us') || message.to.includes('@g.us'),
    hasMedia: message.hasMedia,
    timestamp: new Date(message.timestamp * 1000).toISOString(),
    fromMe: message.fromMe,
    participantName: participantInfo?.displayName || null,
    participantPhone: participantInfo?.phone || null,
    contactPushname: participantInfo?.pushname || null,
    isReply: participantInfo?.isReply || false,
    quotedMessageId: participantInfo?.quotedMessageId || null,
    quotedMessageBody: participantInfo?.quotedMessageBody || null,
    quotedMessageFrom: participantInfo?.quotedMessageFrom || null,
    quotedMessageType: participantInfo?.quotedMessageType || null
  };

  // Emit to all connected clients
  io.emit('new-message', eventData);
  io.emit(`session-${sessionName}`, eventData);
  
  const chatId = message.fromMe ? message.to : message.from;
  io.emit(`chat-${chatId}`, eventData);

  const replyText = eventData.isReply ? ' (REPLY)' : '';
  console.log(`🔴 Real-time event emitted: ${direction} message${replyText} for session ${sessionName}`);
}

function emitMessageStatusUpdate(messageId: string, status: string, sessionName: string) {
  const eventData = {
    messageId,
    status,
    sessionName,
    timestamp: new Date().toISOString()
  };

  io.emit('message-status-update', eventData);
  io.emit(`session-${sessionName}`, { type: 'status-update', ...eventData });

  console.log(`🔴 Real-time status update emitted: ${messageId} -> ${status}`);
}

function emitSessionStatusUpdate(sessionName: string, status: string) {
  const eventData = {
    sessionName,
    status,
    timestamp: new Date().toISOString()
  };

  io.emit('session-status-update', eventData);
  io.emit(`session-${sessionName}`, { type: 'session-status', ...eventData });

  console.log(`🔴 Real-time session status emitted: ${sessionName} -> ${status}`);
}

function emitQRCode(sessionName: string, qrData: any) {
  const eventData = {
    sessionName,
    qr: qrData.base64Qr,
    qrString: qrData.qrString,
    attempts: qrData.attempts,
    timestamp: new Date().toISOString()
  };

  io.emit('qr-code', eventData);
  io.emit(`session-${sessionName}`, { type: 'qr-code', ...eventData });

  console.log(`🔴 Real-time QR code emitted for session: ${sessionName}`);
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('join-session', (sessionName) => {
    socket.join(`session-${sessionName}`);
    console.log(`📡 Client ${socket.id} joined session channel: ${sessionName}`);
  });

  socket.on('join-chat', (chatId) => {
    socket.join(`chat-${chatId}`);
    console.log(`📡 Client ${socket.id} joined chat channel: ${chatId}`);
  });

  socket.on('leave-session', (sessionName) => {
    socket.leave(`session-${sessionName}`);
    console.log(`📡 Client ${socket.id} left session channel: ${sessionName}`);
  });

  socket.on('leave-chat', (chatId) => {
    socket.leave(`chat-${chatId}`);
    console.log(`📡 Client ${socket.id} left chat channel: ${chatId}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Function to download and save media
async function downloadMedia(message: any): Promise<any> {
  try {
    if (!message.hasMedia) {
      return null;
    }

    console.log(`📥 Downloading media for message: ${message.id.id}`);
    
    const media = await message.downloadMedia();
    
    if (!media) {
      console.log('❌ Failed to download media');
      return null;
    }

    const timestamp = Date.now();
    const extension = getFileExtension(media.mimetype || 'application/octet-stream');
    const filename = `${message.type}_${timestamp}_${message.id.id.split('_')[2] || 'unknown'}${extension}`;
    const filepath = path.join(mediaDir, filename);
    
    const buffer = Buffer.from(media.data, 'base64');
    fs.writeFileSync(filepath, buffer);
    
    console.log(`✅ Media saved: ${filename}`);
    
    return {
      filename: filename,
      filepath: filepath,
      size: buffer.length,
      mimetype: media.mimetype
    };
    
  } catch (error) {
    console.error('Error downloading media:', error);
    return null;
  }
}

function getFileExtension(mimetype: string): string {
  const extensions: { [key: string]: string } = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/aac': '.aac',
    'audio/mpeg; codecs=opus': '.ogg',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt'
  };
  
  return extensions[mimetype] || '.bin';
}
interface ParticipantInfo {
  phone: string | null
  name: string | null
  pushname: string | null
  displayName: string | null
  isReply: boolean
  quotedMessageId: number | null
  quotedMessageBody: string | null
  quotedMessageFrom: string | null
  quotedMessageType: string | null
  quotedMessageTimestamp: Date | null
  
}
async function getParticipantInfo(message: any): Promise<any> {
  let participantInfo : ParticipantInfo = {
    phone: null,
    name: null,
    pushname: null,
    displayName: null,
    isReply: false,
    quotedMessageId: null,
    quotedMessageBody: null,
    quotedMessageFrom: null,
    quotedMessageType: null,
    quotedMessageTimestamp: null
  };

  try {
    // Determine the participant phone number
    if (message.fromMe) {
      participantInfo.phone = message.to;
    } else {
      participantInfo.phone = message.from;
    }

    // For group messages, extract the actual sender
    if (message.from.includes('@g.us') && !message.fromMe) {
      if (message.author) {
        participantInfo.phone = message.author;
      }
    }

    // Get contact information
    if (!message.fromMe) {
      try {
        const contact = await message.getContact();
        if (contact) {
          participantInfo.name = contact.name || contact.verifiedName;
          participantInfo.pushname = contact.pushname;
          participantInfo.displayName = participantInfo.pushname || 
                                       participantInfo.name || 
                                       String(participantInfo.phone)?.replace('@c.us', '').replace('@g.us', '');
        }
      } catch (contactError : any) {
        console.log('Could not get contact info:', contactError.message);
      }
    }

    // Check for reply message
    if (message.hasQuotedMsg) {
      participantInfo.isReply = true;
      
      try {
        const quotedMsg = await message.getQuotedMessage();
        if (quotedMsg) {
          participantInfo.quotedMessageId = quotedMsg.id.id;
          participantInfo.quotedMessageBody = quotedMsg.body || `[${quotedMsg.type?.toUpperCase() || 'MEDIA'}]`;
          participantInfo.quotedMessageFrom = quotedMsg.from;
          participantInfo.quotedMessageType = quotedMsg.type;
          participantInfo.quotedMessageTimestamp = quotedMsg.timestamp ? new Date(quotedMsg.timestamp * 1000) : null;
          
          console.log(`💬 Reply detected: "${message.body}" replying to "${participantInfo.quotedMessageBody}"`);
        }
      } catch (quotedError) {
        console.error('Error getting quoted message:', quotedError);
        participantInfo.isReply = true;
      }
    }

    // Final fallback for display name
    if (!participantInfo.displayName) {
      participantInfo.displayName = String(participantInfo.phone)?.replace('@c.us', '').replace('@g.us', '');
    }

  } catch (error) {
    console.error('Error getting participant info with reply:', error);
    participantInfo.phone = message.fromMe ? message.to : message.from;
    participantInfo.displayName = String(participantInfo.phone)?.replace('@c.us', '').replace('@g.us', '');
  }

  return participantInfo;
}

// Enhanced function to save message using TypeORM
async function saveMessage(message: any, sessionName: string): Promise<void> {
  try {
    // Get enhanced participant info including reply details
    const participantInfo = await getParticipantInfo(message);

    let mediaInfo = null;
    if (message.hasMedia) {
      mediaInfo = await downloadMedia(message);
    }

    // Determine chat ID and type
    let chatId = message.from;
    let chatType: 'individual' | 'group' = 'individual';
    let participantNumber: string | null = null;
    let chatName: string | null = null;

    if (message.from.includes('@g.us')) {
      chatId = message.from; // Group chat
      chatType = 'group';
      chatName = 'Group Chat'; // You might want to get actual group name
    } else {
      chatId = message.fromMe ? message.to : message.from; // Individual chat
      chatType = 'individual';
      participantNumber = message.fromMe ? message.to.replace('@c.us', '') : message.from.replace('@c.us', '');
      chatName = participantInfo.displayName || participantNumber;
    }

    // Ensure chat exists before saving message
    await chatService.ensureChatExists({
      chatId,
      chatName,
      chatType,
      participantNumber,
      sessionName,
      isGroup: chatType === 'group',
      groupName: chatType === 'group' ? chatName : null
    });

    // Create message data for TypeORM
    const messageData: Partial<Message> = {
      messageId: message.id.id,
      fromNumber: message.from,
      toNumber: message.to,
      messageBody: message.body || (mediaInfo ? `[${message.type.toUpperCase()}]` : ''),
      messageType: chatType === 'group' ? 'group' : 'Chat',
      isGroup: chatType === 'group',
      groupId: chatType === 'group' ? message.from : null,
      isFromMe: message.fromMe,
      messageStatus: message.fromMe ? 'sent' : 'received',
      sessionName,
      mediaFilename: mediaInfo ? mediaInfo.filename : null,
      mediaMimetype: mediaInfo ? mediaInfo.mimetype : null,
      mediaSize: mediaInfo ? mediaInfo.size : null,
      chatId,
      senderName: participantInfo.displayName,
      timestamp: new Date(message.timestamp * 1000),
      participantName: participantInfo.displayName,
      participantPhone: participantInfo.phone,
      contactPushname: participantInfo.pushname,
      // Reply fields
      isReply: participantInfo.isReply,
      quotedMessageId: participantInfo.quotedMessageId,
      quotedMessageBody: participantInfo.quotedMessageBody,
      quotedMessageFrom: participantInfo.quotedMessageFrom,
      quotedMessageType: participantInfo.quotedMessageType,
      quotedMessageTimestamp: participantInfo.quotedMessageTimestamp
    };

    // Save message using TypeORM service
    await messageService.saveMessage(messageData);

    // Update chat with last message info
    await chatService.updateLastMessage({
      chatId,
      sessionName,
      messageId: message.id.id,
      messageText: message.body || `[${message.type.toUpperCase()}]`,
      messageTime: new Date(message.timestamp * 1000),
      messageFrom: message.fromMe ? 'me' : participantInfo.displayName || 'unknown',
      isReply: participantInfo.isReply
    });

    // Emit real-time event with reply information
    const direction = message.fromMe ? 'sent' : 'received';
    emitNewMessage(sessionName, message, direction, participantInfo);

    const replyText = participantInfo.isReply ? '(REPLY)' : '';
    const mediaText = mediaInfo ? '(with media)' : '';
    console.log(`✅ ${direction.toUpperCase()} message saved: ${message.id.id} ${replyText} ${mediaText}`);
    console.log(`   From: ${message.from} | To: ${message.to} | Body: ${message.body || '[Media]'}`);
    
    if (participantInfo.isReply) {
      console.log(`   ↳ Replying to: "${participantInfo.quotedMessageBody}"`);
    }

  } catch (error) {
    console.error('❌ Error saving message with reply:', error);
  }
}
// Function to update message status using TypeORM
async function updateMessageStatus(messageId: string, status: string): Promise<void> {
  try {
    await messageService.updateMessageStatus(messageId, status);

    // Get message to find session name for real-time update
    const message = await messageService.getMessageById(messageId);
    if (message) {
      emitMessageStatusUpdate(messageId, status, message.sessionName);
    }

    console.log(`📋 Message ${messageId} status updated to: ${status}`);
  } catch (error) {
    console.error('Error updating message status:', error);
  }
}

// Function to send message
async function sendMessage(
  sessionName: string, 
  phoneNumber: string, 
  messageText: string, 
  mediaPath: string | null = null, 
  caption: string | null = null, 
  replyToMessageId: string | null = null,
  originalFilename: string | null = null,  // ADD THIS PARAMETER
  mimetype: string | null = null           // ADD THIS PARAMETER
): Promise<any> {
  try {
    const client = activeSessions[sessionName];
    
    if (!client || !isClientReady(sessionName)) {
      throw new Error('Session not ready or not found');
    }

    const formattedNumber = formatPhoneNumber(phoneNumber);
    let sentMessage: any;
    let options: any = {};

    // Handle reply functionality
    if (replyToMessageId) {
      try {
        const originalMessage = await messageService.getMessageById(replyToMessageId);

        if (!originalMessage) {
          throw new Error(`Original message with ID ${replyToMessageId} not found`);
        }

        console.log(`📤 Preparing reply to message: ${originalMessage.messageBody || '[Media]'}`);
        options.quotedMessageId = replyToMessageId;
        
      } catch (replyError: any) {
        console.error('Error setting up reply:', replyError);
        throw new Error(`Failed to setup reply: ${replyError.message}`);
      }
    }

    // Send the message based on type
    if (mediaPath && fs.existsSync(mediaPath)) {
      const media = MessageMedia.fromFilePath(mediaPath);
      
      // Set proper mimetype and filename if provided
      if (mimetype) {
        media.mimetype = mimetype;
      }
      if (originalFilename) {
        media.filename = originalFilename; // This preserves the extension
      }
      
      if (caption) {
        options.caption = caption;
      }
      sentMessage = await client.sendMessage(formattedNumber, media, options);
      console.log(`📤 Media message sent via ${sessionName} to ${formattedNumber}${replyToMessageId ? ' (as reply)' : ''} - File: ${originalFilename || 'unknown'}`);
    } else {
      sentMessage = await client.sendMessage(formattedNumber, messageText, options);
      console.log(`📤 Text message sent via ${sessionName} to ${formattedNumber}: ${messageText}${replyToMessageId ? ' (as reply)' : ''}`);
    }

    return {
      success: true,
      messageId: sentMessage.id.id,
      to: formattedNumber,
      body: messageText,
      hasMedia: !!mediaPath,
      filename: originalFilename,
      mimetype: mimetype,
      isReply: !!replyToMessageId,
      replyToMessageId: replyToMessageId,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error(`❌ Error sending message via ${sessionName}:`, error);
    throw error;
  }
}
// Initialize WhatsApp Web Client
async function startAgentSession(sessionName: string): Promise<void> {
  try {
    const client = new Client({
      authStrategy: new LocalAuth({ 
        clientId: sessionName,
        dataPath: path.join(__dirname, 'sessions')
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    // QR Code generation
    client.on('qr', async (qr) => {
      console.log(`🆕 QR Code for session ${sessionName}:`);
      console.log(qr);

      const qrBase64 = await qrcode.toDataURL(qr);
      const qrData = { 
        base64Qr: qrBase64,
        qrString: qr,
        attempts: 1
      };
      
      qrCodes[sessionName] = qrData;
      emitQRCode(sessionName, qrData);
    });

    // Authentication success
    client.on('authenticated', async () => {
      console.log(`✅ Session ${sessionName} is authenticated`);
      sessionStatuses[sessionName] = 'authenticated';
      emitSessionStatusUpdate(sessionName, 'authenticated');
      
      // Update session status in database
      await sessionService.updateSessionStatus(sessionName, 'authenticated');
    });

    // Client ready
    client.on('ready', async () => {
      console.log(`✅ Session ${sessionName} is ready`);
      sessionStatuses[sessionName] = 'ready';
      emitSessionStatusUpdate(sessionName, 'ready');
      
      // Update session status in database
      await sessionService.updateSessionStatus(sessionName, 'ready');
      
      delete qrCodes[sessionName];
      
      try {
        const info = client.info;
        console.log(`📱 Client info for ${sessionName}:`, info.wid.user);
      } catch (error) {
        console.log(`⚠️ Could not get client info for ${sessionName}`);
      }
    });

    // Authentication failure
    client.on('auth_failure', async (message) => {
      console.error(`❌ Authentication failed for ${sessionName}:`, message);
      sessionStatuses[sessionName] = 'auth_failure';
      emitSessionStatusUpdate(sessionName, 'auth_failure');
      
      // Update session status in database
      await sessionService.updateSessionStatus(sessionName, 'auth_failure');
    });

    // Client disconnected
    client.on('disconnected', async (reason) => {
      console.log(`🔴 Session ${sessionName} disconnected:`, reason);
      sessionStatuses[sessionName] = 'disconnected';
      emitSessionStatusUpdate(sessionName, 'disconnected');
      
      // Update session status in database
      await sessionService.updateSessionStatus(sessionName, 'disconnected');
      
      delete activeSessions[sessionName];
    });

    // Setup enhanced event listeners
    setupEventListeners(client, sessionName);

    sessionStatuses[sessionName] = 'initializing';
    emitSessionStatusUpdate(sessionName, 'initializing');
    
    // Update session status in database
    await sessionService.updateSessionStatus(sessionName, 'initializing');
    
    await client.initialize();
    
    activeSessions[sessionName] = client;
    console.log(`✅ Agent session started: ${sessionName}`);

  } catch (error) {
    console.error(`❌ Failed to start session ${sessionName}:`, error);
  }
}

function setupEventListeners(client: Client, sessionName: string): void {
  // Main message listener
  client.on('message', async (message) => {
    const direction = message.fromMe ? '📤 SENT' : '📥 RECEIVED';
    const isGroup = message.from.includes('@g.us');
    const chatType = isGroup ? 'GROUP' : 'INDIVIDUAL';
    const mediaType = message.hasMedia ? `[${message.type.toUpperCase()}]` : '';
    const replyType = message.hasQuotedMsg ? '↳ REPLY' : '';
    
    console.log(`${direction} ${chatType} ${replyType} Message:`, {
      id: message.id.id,
      from: message.from,
      to: message.to,
      body: message.body || mediaType,
      type: message.type,
      hasQuotedMsg: message.hasQuotedMsg,
      fromMe: message.fromMe,
      isGroup: isGroup,
      hasMedia: message.hasMedia,
      timestamp: new Date(message.timestamp * 1000).toISOString()
    });
    
    await saveMessage(message, sessionName);
  });

  // Message create listener
  client.on('message_create', async (message) => {
    const direction = message.fromMe ? '📤 SENT' : '📥 RECEIVED';
    const isGroup = message.from.includes('@g.us') || message.to.includes('@g.us');
    const chatType = isGroup ? 'GROUP' : 'INDIVIDUAL';
    const mediaType = message.hasMedia ? `[${message.type.toUpperCase()}]` : '';
    
    console.log(`${direction} ${chatType} Message:`, {
      id: message.id.id,
      from: message.from,
      to: message.to,
      body: message.body || mediaType,
      type: message.type,
      fromMe: message.fromMe,
      isGroup: isGroup,
      hasMedia: message.hasMedia,
      timestamp: new Date(message.timestamp * 1000).toISOString()
    });
    
    await saveMessage(message, sessionName);
    console.log(`🔄 Message created: ${message.id.id} | FromMe: ${message.fromMe}`);
  });

  // Message revoke listeners
  client.on('message_revoke_everyone', async (after, before) => {
    console.log('🗑️ Message revoked for everyone:', before?.body || 'Media message');
    
    if (before && before.id) {
      await updateMessageStatus(before.id.id, 'revoked');
    }
  });

  client.on('message_revoke_me', async (message) => {
    console.log('🗑️ Message revoked for me:', message.body || 'Media message');
    
    if (message.id) {
      await updateMessageStatus(message.id.id, 'revoked_me');
    }
  });

  // Message acknowledgments
  client.on('message_ack', async (message, ack) => {
    const statusMap: { [key: number]: string } = {
      1: 'sent',
      2: 'delivered',
      3: 'read',
      4: 'played'
    };
    
    const status = statusMap[ack] || 'unknown';
    console.log(`📋 Message acknowledgment: ${message.id.id} -> ${status}`);
    
    await updateMessageStatus(message.id.id, status);
  });

  // Group events
  client.on('group_join', (notification) => {
    console.log('👥 Someone joined group:', notification);
  });

  client.on('group_leave', (notification) => {
    console.log('👋 Someone left group:', notification);
  });

  // Contact events
  client.on('contact_changed', (message, oldId, newId, isContact) => {
    console.log('📞 Contact changed:', { oldId, newId, isContact });
  });

  // Auto-reply example
  client.on('message', async (message) => {
    if (!message.fromMe && message.body && message.body.toLowerCase() === 'ping') {
      try {
        await client.sendMessage(message.from, 'pong! 🏓');
        console.log('🤖 Auto-reply sent');
      } catch (error) {
        console.error('Error sending auto-reply:', error);
      }
    }
  });
}

async function loadAllAgentSessions(): Promise<void> {
  try {
    const sessions = await sessionService.getAllSessions();

    if (sessions.length === 0) {
      console.log('⚠️ No sessions found in the database');
      return;
    }

    console.log(`📋 Loading ${sessions.length} sessions...`);
    
    for (let session of sessions) {
      console.log(`🔄 Starting session: ${session.sessionName}`);
      await startAgentSession(session.sessionName);
      // Add small delay between sessions
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('✅ All sessions loaded successfully');
  } catch (error) {
    console.error('❌ Error loading sessions:', error);
  }
}

// Helper functions
function isClientReady(sessionName: string): boolean {
  const isReady = sessionStatuses[sessionName] === 'ready';
  const hasClient = !!activeSessions[sessionName];
  return isReady && hasClient;
}

function formatPhoneNumber(phoneNumber: string): string {
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  if (!phoneNumber.includes('@')) {
    if (cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }
    return cleaned + '@c.us';
  }
  
  return phoneNumber;
}

function createResponse(success: boolean, data: any = null, message: string = '', pagination: any = null) {
  const response: any = {
    success,
    message,
    timestamp: new Date().toISOString()
  };

  if (data !== null) {
    response.data = data;
  }

  if (pagination) {
    response.pagination = pagination;
  }

  return response;
}

// API Endpoints
app.get('/tracker/health', async (req, res) => {
  try {    
    res.json("hello from tracker");
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json(createResponse(false, error, 'Service unhealthy'));
  }
});

// Add session endpoint with TypeORM
app.post('/add-session', AuthMiddleware.authenticate, AuthMiddleware.requireAdmin, async (req, res) => {
  const agentName = req.query.agentName as string;
  const userId = Number(req.query.userId);
  console.log(userId);
  

  if (!agentName || typeof agentName !== 'string' || agentName.trim() === '') {
    return res.status(400).json({ 
      success: false, 
      message: 'Agent name is required and must be a non-empty string' 
    });
  }
  
  if (!userId)
    return res.status(400).json({ 
      success: false, 
      message: 'User is required' 
    });


  const cleanAgentName = agentName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessionName = `agent_${cleanAgentName}_${Date.now()}`;
  
  try {
    // Create session using TypeORM service
    await sessionService.createSession(sessionName, agentName, userId);

    // Start the WhatsApp session
    await startAgentSession(sessionName);

    console.log(`✅ New agent session created: ${sessionName} (Agent: ${agentName})`);

    res.json({ 
      success: true, 
      message: `Agent "${agentName}" session started successfully`, 
      sessionName: sessionName,
      agentName: cleanAgentName,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Error creating new session:', error);
    
    res.status(500).json({ 
      success: false, 
      message: 'Error creating new agent session',
      error: error.message 
    });
  }
});

// Send message endpoints
app.post('/send-message/:sessionName', async (req, res) => {
  const sessionName = req.params.sessionName;
  const { phoneNumber, message, caption, replyToMessageId } = req.body;

  if (!phoneNumber || !message) {
    return res.status(400).json(createResponse(
      false, 
      null, 
      'Phone number and message are required'
    ));
  }

  if (!isClientReady(sessionName)) {
    return res.status(400).json(createResponse(
      false, 
      null, 
      `Session "${sessionName}" is not ready or does not exist`
    ));
  }

  try {
    const result = await sendMessage(sessionName, phoneNumber, message, null, caption, replyToMessageId);
    
    res.json(createResponse(
      true, 
      result, 
      result.isReply ? 'Reply message sent successfully' : 'Message sent successfully'
    ));

  } catch (error: any) {
    console.error('Error in send-message endpoint:', error);
    res.status(500).json(createResponse(
      false, 
      null, 
      `Failed to send message: ${error.message}`
    ));
  }
});

// Send media message endpoint
app.post('/send-media/:sessionName', upload.single('media'), async (req, res) => {
  const sessionName = req.params.sessionName;
  const phoneNumber = req.body.phoneNumber;
  const message = req.body?.message;
  const caption = req.body?.caption;
  const replyToMessageId = req.body?.replyToMessageId;
  const mediaFile = req.file;

  if (!phoneNumber) {
    return res.status(400).json(createResponse(
      false, 
      null, 
      'Phone number is required'
    ));
  }

  if (!mediaFile && !message) {
    return res.status(400).json(createResponse(
      false, 
      null, 
      'Either media file or message text is required'
    ));
  }

  if (!isClientReady(sessionName)) {
    return res.status(400).json(createResponse(
      false, 
      null, 
      `Session "${sessionName}" is not ready or does not exist`
    ));
  }

  try {
    let result;
    
    if (mediaFile) {
      // Create MessageMedia with proper mimetype and filename
      const media = MessageMedia.fromFilePath(mediaFile.path);
      
      // Set the proper mimetype and filename
      media.mimetype = mediaFile.mimetype;
      media.filename = mediaFile.originalname; // This preserves the original filename with extension
      
      // Send media message directly here instead of using sendMessage function
      const client = activeSessions[sessionName];
      const formattedNumber = formatPhoneNumber(phoneNumber);
      
      let options: any = {};
      
      // Handle caption
      if (caption) {
        options.caption = caption;
      }
      
      // Handle reply functionality
      if (replyToMessageId) {
        try {
          const originalMessage = await messageService.getMessageById(replyToMessageId);
          if (!originalMessage) {
            throw new Error(`Original message with ID ${replyToMessageId} not found`);
          }
          options.quotedMessageId = replyToMessageId;
        } catch (replyError: any) {
          console.error('Error setting up reply:', replyError);
          throw new Error(`Failed to setup reply: ${replyError.message}`);
        }
      }
      
      const sentMessage = await client.sendMessage(formattedNumber, media, options);
      
      result = {
        success: true,
        messageId: sentMessage.id.id,
        to: formattedNumber,
        body: caption || '',
        hasMedia: true,
        filename: mediaFile.originalname,
        mimetype: mediaFile.mimetype,
        isReply: !!replyToMessageId,
        replyToMessageId: replyToMessageId,
        timestamp: new Date().toISOString()
      };
      
      console.log(`📤 Media message sent via ${sessionName} to ${formattedNumber}${replyToMessageId ? ' (as reply)' : ''} - File: ${mediaFile.originalname}`);
      
    } else {
      // Send text message only
      const messageText = message || caption || '';
      result = await sendMessage(sessionName, phoneNumber, messageText, null, null, replyToMessageId);
    }
    
    // Clean up uploaded file
    if (mediaFile && fs.existsSync(mediaFile.path)) {
      fs.unlinkSync(mediaFile.path);
    }
    
    res.json(createResponse(
      true, 
      result, 
      result.isReply ? 'Reply media message sent successfully' : 'Media message sent successfully'
    ));

  } catch (error:any) {
    console.error('Error in send-media endpoint:', error);
    
    // Clean up uploaded file on error
    if (mediaFile && fs.existsSync(mediaFile.path)) {
      fs.unlinkSync(mediaFile.path);
    }
    
    res.status(500).json(createResponse(
      false, 
      null, 
      `Failed to send media message: ${error.message}`
    ));
  }
});


// Get QR code endpoint
app.get('/qr/:sessionName', (req, res) => {
  const sessionName = req.params.sessionName;

  if (qrCodes[sessionName]) {
    res.json({
      sessionName,
      qr: qrCodes[sessionName].base64Qr,
      qrString: qrCodes[sessionName].qrString,
      attempts: qrCodes[sessionName].attempts
    });
  } else {
    res.status(404).json({ message: 'QR not available or session already connected' });
  }
});

// Get agent status
app.get('/agent/:sessionName/status', (req, res) => {
  const sessionName = req.params.sessionName;
  
  const status = sessionStatuses[sessionName] || 'not_found';
  const isReady = isClientReady(sessionName);
  const hasQR = !!qrCodes[sessionName];

  res.json({
    sessionName,
    status,
    isReady,
    hasQR,
    qrAvailable: hasQR ? `/qr/${sessionName}` : null,
    timestamp: new Date().toISOString()
  });
});

app.post('/start-campaign/:campaignId', async (req, res) => {
  const campaignId = parseInt(req.params.campaignId);
  
  if (!campaignId || isNaN(campaignId)) {
    return res.status(400).json(createResponse(
      false, 
      null, 
      'Valid campaign ID is required'
    ));
  }

  try {
    // Get campaign with contact group, templates and session
    const campaign = await campaignService.getCampaignById(campaignId);
    
    if (!campaign) {
      return res.status(404).json(createResponse(
        false, 
        null, 
        'Campaign not found'
      ));
    }

    if (!campaign.contactGroup) {
      return res.status(400).json(createResponse(
        false, 
        null, 
        'Campaign has no contact group assigned'
      ));
    }

    // Get contacts from the contact group
    const contacts = await contactService.getContactsByGroup(campaign.groupId);
    
    if (!contacts || contacts.length === 0) {
      return res.status(400).json(createResponse(
        false, 
        null, 
        'Contact group has no contacts'
      ));
    }

    if (!campaign.templates || campaign.templates.length === 0) {
      return res.status(400).json(createResponse(
        false, 
        null, 
        'Campaign has no templates'
      ));
    }

    if (!campaign.session) {
      return res.status(400).json(createResponse(
        false, 
        null, 
        'Campaign has no associated session'
      ));
    }

    // Check if session is ready
    if (!isClientReady(campaign.session.sessionName)) {
      return res.status(400).json(createResponse(
        false, 
        null, 
        `Session "${campaign.session.sessionName}" is not ready`
      ));
    }

    let cumulativeDelay = 0;
    const jobsScheduled = [];

    // Loop through contacts and create jobs
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      
      // Generate random delay between min and max intervals (in minutes) for EACH job
      const randomDelayMinutes = Math.floor(
        Math.random() * (campaign.maxIntervalMinutes - campaign.minIntervalMinutes + 1)
      ) + campaign.minIntervalMinutes;
      
      // Convert to milliseconds and add to cumulative delay to ensure jobs run in sequence
      const randomDelayMs = randomDelayMinutes * 60 * 1000;
      cumulativeDelay += randomDelayMs;

      // Select random template
      const randomTemplateIndex = Math.floor(Math.random() * campaign.templates.length);
      const selectedTemplate = campaign.templates[randomTemplateIndex];

      // Create job data
      const jobData = {
        contactId: contact.id,
        contactPhone: contact.phone,
        templateId: selectedTemplate.id,
        templateMessage: selectedTemplate.message,
        campaignId: campaign.id,
        campaignName: campaign.name,
        sessionName: campaign.session.sessionName,
        delayMinutes: randomDelayMinutes
      };

      // Schedule job with cumulative delay
      await jobQueue.add('send-campaign-message', jobData, {
        delay: cumulativeDelay,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 30000, // 30 seconds
        }
      });

      jobsScheduled.push({
        contactId: contact.id,
        contactName: contact.name,
        contactPhone: contact.phone,
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name,
        delayMinutes: randomDelayMinutes,
        scheduledAt: new Date(Date.now() + cumulativeDelay).toISOString()
      });

      console.log(`📅 Job scheduled for contact ${contact.name} (${contact.phone}) with template "${selectedTemplate.name}" in ${Math.floor(cumulativeDelay / 60000)} minutes`);
    }

    // Update campaign last sent time
    await campaignService.updateLastSent(campaignId);
    await campaignService.updateIsStarted(campaignId, true);

    console.log(`✅ Campaign "${campaign.name}" started with ${jobsScheduled.length} jobs scheduled`);

    res.json(createResponse(
      true, 
      {
        campaignId: campaign.id,
        campaignName: campaign.name,
        sessionName: campaign.session.sessionName,
        groupId: campaign.groupId,
        groupName: campaign.contactGroup.name,
        totalContacts: contacts.length,
        totalTemplates: campaign.templates.length,
        jobsScheduled: jobsScheduled.length,
        estimatedCompletionTime: new Date(Date.now() + cumulativeDelay).toISOString(),
        jobs: jobsScheduled
      }, 
      `Campaign started successfully with ${jobsScheduled.length} messages scheduled`
    ));

  } catch (error: any) {
    console.error('Error starting campaign:', error);
    res.status(500).json(createResponse(
      false, 
      null, 
      `Failed to start campaign: ${error.message}`
    ));
  }
});
// Job worker for campaign messages
const campaignWorker = new Worker('send-campaign-message', async (job) => {
  const { 
    contactId, 
    contactPhone, 
    templateId, 
    templateMessage, 
    campaignId, 
    campaignName, 
    sessionName 
  } = job.data;

  try {
    console.log(`🚀 Processing campaign message job: Contact ${contactPhone}, Template ${templateId}`);

    // Check if session is still ready
    if (!isClientReady(sessionName)) {
      throw new Error(`Session "${sessionName}" is not ready`);
    }

    // Send message using existing sendMessage function
    const result = await sendMessage(
      sessionName, 
      contactPhone, 
      templateMessage
    );

    console.log(`✅ Campaign message sent successfully to ${contactPhone} via ${sessionName}`);
    console.log(`📊 Campaign "${campaignName}" - Message sent to contact ${contactId} using template ${templateId}`);
    console.log(`Sent template ${templateId} to contact ${contactId} at ${new Date()}`);

    return {
      success: true,
      contactId,
      contactPhone,
      templateId,
      messageId: result.messageId,
      sentAt: new Date().toISOString()
    };

  } catch (error: any) {
    console.error(`❌ Failed to send campaign message to ${contactPhone}:`, error);
    console.log(`📊 Campaign "${campaignName}" - Failed to send message to contact ${contactId}: ${error.message}`);
    
    throw error;
  }
}, { connection });

// Start server
server.listen(3002, () => {
  console.log('✅ Session API with WebSocket and TypeORM is running on port 3002');
  console.log('🔴 Real-time WebSocket server is active');
  console.log('📡 Message listeners are active for both sent and received messages');
  console.log('🗄️ Using TypeORM for database operations');
});

// Initialize application
async function main(): Promise<void> {
  console.log('🚀 Starting WhatsApp Multi-Agent Tracker with TypeORM and Real-time Events...');
  
  try {
    // Initialize database
    const dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();
    
    // Initialize services
    messageService = new MessageService();
    sessionService = new SessionService();
    chatService = new ChatService();
    contactService = new ContactService();
    
    // Load all sessions
    await loadAllAgentSessions();

    console.log('✅ System is ready with TypeORM and all sessions are running!');
    console.log('🎯 Enhanced features:');
    console.log('   - TypeORM for better database management');
    console.log('   - Type-safe database operations');
    console.log('   - Improved error handling');
    console.log('   - Better performance with optimized queries');
    console.log('   - Automatic database migrations');
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');

  try {
    for (let sessionName in activeSessions) {
      console.log(`🔒 Closing session: ${sessionName}`);
      await activeSessions[sessionName].destroy();
    }

    const dbManager = DatabaseManager.getInstance();
    await dbManager.close();

    server.close(() => {
      console.log('🔌 HTTP server closed.');
    });

    console.log('✅ Shutdown complete.');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

main().catch(console.error);

export default app;