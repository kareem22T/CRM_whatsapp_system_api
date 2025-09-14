import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { DatabaseManager } from './database/database-manager.ts';
import { MessageService } from './services/MessageService.ts';
import { SessionService } from './services/SessionService.ts';
import { ChatService } from './services/ChatService.ts';
import { UserService } from './services/UserService.ts';
import { AuthUser, AuthUtils } from './utils/auth.ts';
import { AuthMiddleware } from './middleware/auth.ts';
import { UserRole } from './entities/User.ts';
import { ContactGroupService, ContactService } from './services/ContactService.ts';
import { MessageTemplateService } from './services/MessageTemplateService.ts';
import { CampaignService } from './services/CampaignService.ts';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import * as XLSX from "xlsx";
import multer from "multer";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser; // whatever type you return in AuthMiddleware
    }
  }
}

const app = express();
const userService = new UserService();

// Middleware
app.use(cors({
  origin: "*",
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const connection = new IORedis({
  host: '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: null
});


const worker = new Worker('send-template', async job => {
  const { contactId, templateId } = job.data;
  await sendTemplateToContact(contactId, templateId);
  console.log(`Sent template ${templateId} to contact ${contactId} at ${new Date()}`);
}, { connection });

function sendTemplateToContact(contactId: number, templateId: number) {
  console.log(`Simulating sending template ${templateId} to contact ${contactId}`);
}
  
// Services
let messageService: MessageService;
let sessionService: SessionService;
let chatService: ChatService;
let contactService: ContactService;
let contactGroupService: ContactGroupService;
let messageTemplateService: MessageTemplateService;
let campaignService: CampaignService;

// Helper functions
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

function getPaginationInfo(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    currentPage: page,
    totalPages,
    totalItems: total,
    itemsPerPage: limit,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1
  };
}

// Helper function to filter out undefined values
function filterUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const filtered: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      filtered[key as keyof T] = value;
    }
  }
  return filtered;
}

// Function to create default admin user
async function createDefaultAdmin() {
  try {
    console.log('🔍 Checking for default admin user...');
    
    // Check if any admin users exist
    const adminUsers = await userService.getAllUsers();
    
    if (adminUsers.users.length === 0) {
      console.log('📝 No admin users found, creating default admin...');
      
      const defaultAdmin = {
        email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com',
        password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
        name: process.env.DEFAULT_ADMIN_NAME || 'System Administrator',
        role: UserRole.ADMIN
      };

      const adminUser = await userService.createUser(defaultAdmin);
      
      console.log('✅ Default admin user created successfully:');
      console.log(`   Email: ${defaultAdmin.email}`);
      console.log(`   Password: ${defaultAdmin.password}`);
      console.log('⚠️  Please change the default password after first login!');
      
      return adminUser;
    } else {
      console.log(`✅ Found ${adminUsers.users.length} admin user(s), skipping default admin creation`);
    }
  } catch (error) {
    console.error('❌ Error creating default admin user:', error);
    // Don't throw error to prevent server startup failure
  }
}

function createPaginatedResponse(
  success: boolean,
  data: any,
  message: string,
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  }
) {
  return {
    success,
    message,
    timestamp: new Date().toISOString(),
    data,
    pagination
  };
}

// Routes

// Session routes
app.get('/sessions', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const sessions = await sessionService.getAllSessions(req.user?.role === UserRole.AGENT ? req.user.id : undefined);
    
    // Add statistics for each session
    const sessionsWithStats = await Promise.all(
      sessions.map(async (session) => {
        const sessionData = await sessionService.getSessionWithStats(session.sessionName);
        return {
          ...session,
          ...sessionData?.stats,
          totalChats: (sessionData?.stats.individualChats || 0) + (sessionData?.stats.groupChats || 0),
          isActive: sessionData?.stats.lastMessageTime && 
                   new Date(sessionData.stats.lastMessageTime) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        };
      })
    );

    res.json(createResponse(
      true,
      sessionsWithStats,
      `Found ${sessionsWithStats.length} sessions`
    ));

  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

app.get('/sessions/:sessionName', async (req, res) => {
  try {
    const { sessionName } = req.params;
    const sessionData = await sessionService.getSessionWithStats(sessionName);

    if (!sessionData) {
      return res.status(404).json(createResponse(false, null, 'Session not found'));
    }

    res.json(createResponse(true, sessionData, 'Session details retrieved successfully'));

  } catch (error) {
    console.error('Error fetching session details:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Message routes
app.get('/messages', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const sessionName = req.query.session as string;
    const messageType = req.query.type as string;
    const hasMedia = req.query.hasMedia as string;
    const isGroup = req.query.isGroup as string;
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    const search = req.query.search as string;

    // Build filters object and remove undefined values
    const filters = filterUndefined({
      sessionName,
      messageType,
      hasMedia: hasMedia ? hasMedia === 'true' : false,
      isGroup: isGroup ? isGroup === 'true' : false,
      fromDate: new Date(fromDate),
      toDate: new Date(toDate),
      search,
      page,
      limit
    });

    const { messages, total } = await messageService.getMessagesWithFilters(filters);

    // Add download URLs for messages with media
    const messagesWithUrls = messages.map(message => ({
      ...message,
      downloadUrl: message.mediaFilename ? `/messages/${message.messageId}/download` : null,
      viewUrl: message.mediaFilename ? `/messages/${message.messageId}/view` : null
    }));

    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      messagesWithUrls,
      `Found ${messages.length} messages`,
      pagination
    ));

  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

app.get('/messages/search', async (req, res) => {
  try {
    const searchQuery = req.query.query as string;
    const sessionName = req.query.session as string;
    const messageType = req.query.type as string;
    const hasMedia = req.query.hasMedia as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(400).json(createResponse(false, null, 'Search query must be at least 2 characters'));
    }

    // Build filters object and remove undefined values
    const filters = filterUndefined({
      sessionName,
      messageType,
      hasMedia: hasMedia ? hasMedia === 'true' : false,
      page,
      limit
    });

    const { messages, total } = await messageService.searchMessages(searchQuery, filters);

    const messagesWithUrls = messages.map(message => ({
      ...message,
      downloadUrl: message.mediaFilename ? `/messages/${message.messageId}/download` : null,
      viewUrl: message.mediaFilename ? `/messages/${message.messageId}/view` : null
    }));

    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      messagesWithUrls,
      `Found ${messages.length} messages matching "${searchQuery}"`,
      pagination
    ));

  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

app.get('/messages/by-number/:number', async (req, res) => {
  try {
    const { number } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const sessionName = req.query.session as string;
    const hasMedia = req.query.hasMedia as string;

    // Build filters object and remove undefined values
    const filters = filterUndefined({
      sessionName,
      hasMedia: hasMedia ? hasMedia === 'true' : false,
      page,
      limit
    });

    const { messages, total } = await messageService.getMessagesByNumber(number, filters);

    const messagesWithUrls = messages.map(message => ({
      ...message,
      downloadUrl: message.mediaFilename ? `/messages/${message.messageId}/download` : null,
      viewUrl: message.mediaFilename ? `/messages/${message.messageId}/view` : null
    }));

    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      messagesWithUrls,
      `Found ${messages.length} messages for ${number}`,
      pagination
    ));

  } catch (error) {
    console.error('Error fetching messages by number:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Chat routes
app.get('/chats/:sessionName', async (req, res) => {
  try {
    const { sessionName } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const chatType = req.query.type as 'individual' | 'group';
    const isActive = req.query.active as string;

    // Build filters object and remove undefined values
    const filters = filterUndefined({
      chatType,
      page,
      limit
    });

    const { chats, total } = await chatService.getChatsBySession(sessionName, filters);

    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      chats,
      `Found ${chats.length} chats for session ${sessionName}`,
      pagination
    ));

  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const dbManager = DatabaseManager.getInstance();
    
    res.json(createResponse(
      true,
      {
        database: dbManager.dataSource.isInitialized ? 'connected' : 'disconnected',
        server: 'running',
        timestamp: new Date().toISOString()
      },
      'Service health check'
    ));

  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json(createResponse(false, null, 'Service unhealthy'));
  }
});


/* ------------------------- User Routes ------------------------- */

// Register new user (admin only)
app.post('/register', AuthMiddleware.authenticate, AuthMiddleware.requireAdmin, async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json(createResponse(false, null, 'Email, password, and name are required'));
    }

    const user = await userService.createUser({
      email,
      password,
      name,
      role: role || UserRole.AGENT
    });

    res.status(201).json(createResponse(true, AuthUtils.sanitizeUser(user), 'User created successfully'));

  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Registration failed'));
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json(createResponse(false, null, 'Email and password are required'));
    }

    const result = await userService.login({ email, password });
    if (!result) {
      return res.status(401).json(createResponse(false, null, 'Invalid credentials'));
    }

    res.json(createResponse(true, { user: AuthUtils.sanitizeUser(result.user), token: result.token }, 'Login successful'));

  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json(createResponse(false, null, 'Login failed'));
  }
});

// Profile
app.get('/profile', AuthMiddleware.authenticate, async (req, res) => {
  res.json(createResponse(true, req.user, 'Profile retrieved successfully'));
});

// Change password
app.post('/change-password', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json(createResponse(false, null, 'Current password and new password are required'));
    }

    if (newPassword.length < 6) {
      return res.status(400).json(createResponse(false, null, 'New password must be at least 6 characters long'));
    }

    await userService.changePassword(req.user!.id, currentPassword, newPassword);
    res.json(createResponse(true, null, 'Password changed successfully'));

  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to change password'));
  }
});

// Get all users (admin only)
  app.get('/users', AuthMiddleware.authenticate, AuthMiddleware.requireAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string || '';
      const role = req.query.role as string || '';
      
      const result = await userService.getAllUsers(page, limit, search, role, false, req.user?.id);
      
      res.json(createPaginatedResponse(
        true,
        result.users.map(AuthUtils.sanitizeUser),
        `Found ${result.total} users`,
        {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
          hasNextPage: result.hasNextPage,
          hasPrevPage: result.hasPrevPage
        }
      ));
    } catch (error: any) {
      console.error('Get users error:', error);
      res.status(500).json(createResponse(false, null, 'Failed to retrieve users'));
    }
  });

  // update profile
  app.put('/profile', AuthMiddleware.authenticate, async (req, res) => {
    try {
      const { email, name } = req.body;

      if (!email && !name) {
        return res.status(400).json(createResponse(false, null, 'At least one field (email or name) is required'));
      }

      // Build update object with only provided fields
      const updateData = filterUndefined({ email, name });

      const updatedUser = await userService.updateUser(req.user!.id, updateData);
      if (!updatedUser) {
        return res.status(404).json(createResponse(false, null, 'User not found'));
      }

      res.json(createResponse(true, AuthUtils.sanitizeUser(updatedUser), 'Profile updated successfully'));

    } catch (error: any) {
      console.error('Update profile error:', error);
      res.status(400).json(createResponse(false, null, error.message || 'Failed to update profile'));
    }
  });


// Update user (admin only)
app.put('/users/:id', AuthMiddleware.authenticate, AuthMiddleware.requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { email, name, role, isActive } = req.body;

    const updatedUser = await userService.updateUser(userId, { email, name, role, isActive });
    if (!updatedUser) {
      return res.status(404).json(createResponse(false, null, 'User not found'));
    }

    res.json(createResponse(true, AuthUtils.sanitizeUser(updatedUser), 'User updated successfully'));

  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(500).json(createResponse(false, null, error.message || 'Failed to update user'));
  }
});

// Delete user (admin only)
app.delete(
  '/users/:id',
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAdmin,
  async (req, res) => {
    try {
      const userId = parseInt(req.params.id, 10);

      // Prevent admin from deleting themselves (optional safety)
      if (req.user && req.user.id === userId) {
        return res
          .status(400)
          .json(createResponse(false, null, 'You cannot delete your own account'));
      }

      const deleted = await userService.deleteUser(userId);
      if (!deleted) {
        return res
          .status(404)
          .json(createResponse(false, null, 'User not found'));
      }

      res.json(createResponse(true, null, 'User deleted successfully'));
    } catch (error: any) {
      console.error('Delete user error:', error);
      res
        .status(500)
        .json(createResponse(false, null, error.message || 'Failed to delete user'));
    }
  }
);

/* ------------------------- Contact Routes ------------------------- */

// Create contact
// Multer config
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.includes("excel") || file.mimetype.includes("spreadsheetml")) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files are allowed!"));
    }
  },
});

// ✅ Import contacts from Excel
app.post(
  "/contacts/import-excel",
  AuthMiddleware.authenticate,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json(createResponse(false, null, "Excel file is required"));
      }

      // اقرأ الـ Excel
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      // جهّز الداتا للـ service
      const contactsData = rows.map((row) => ({
        name: row["Name"],
        email: row["Email"],
        phone: String(row["Phone"]),
        company: row["Company"],
        notes: row["Notes"],
        position: row["Position"],
        groupNames: row["Groups"]
          ? String(row["Groups"]).split(",").map((g) => g.trim())
          : [],
      }));

      const result = await contactService.importContacts(contactsData);

      res.json(
        createResponse(true, result, "Contacts imported successfully")
      );
    } catch (error: any) {
      console.error("Import contacts error:", error);
      res
        .status(500)
        .json(
          createResponse(false, null, error.message || "Failed to import contacts")
        );
    }
  }
);

// ✅ Download Excel template
app.get(
  "/contacts/template",
  AuthMiddleware.authenticate,
  async (req, res) => {
    try {
      // Define template headers
      const headers = [
        ["Name", "Email", "Phone", "Company", "Notes", "Position", "Groups"],
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(headers);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "ContactsTemplate");

      const buffer = XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
      });

      res.setHeader(
        "Content-Disposition",
        'attachment; filename="contacts_template.xlsx"'
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.send(buffer);
    } catch (error: any) {
      console.error("Download template error:", error);
      res
        .status(500)
        .json(
          createResponse(
            false,
            null,
            error.message || "Failed to download template"
          )
        );
    }
  }
);

app.post('/contacts', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { name, email, phone, company, notes, position, avatar, groupIds } = req.body;

    if (!name || !phone) {
      return res.status(400).json(createResponse(false, null, 'Name and phone are required'));
    }

    const contact = await contactService.createContact({
      name,
      email,
      phone,
      company,
      notes,
      position,
      avatar,
      groupIds
    });

    res.status(201).json(createResponse(true, contact, 'Contact created successfully'));

  } catch (error: any) {
    console.error('Create contact error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to create contact'));
  }
});

// Get all contacts
app.get('/contacts', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const search = req.query.search as string;
    const groupId = req.query.groupId ? parseInt(req.query.groupId as string) : undefined;
    const company = req.query.company as string;
    const isActive = req.query.isActive ? req.query.isActive === 'true' : undefined;

    const filters = filterUndefined({
      page,
      limit,
      search,
      groupId,
      company,
      isActive
    });

    const { contacts, total } = await contactService.getAllContacts(filters);
    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      contacts,
      `Found ${contacts.length} contacts`,
      pagination
    ));

  } catch (error: any) {
    console.error('Get contacts error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to retrieve contacts'));
  }
});

// Get contact by ID
app.get('/contacts/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const contactId = parseInt(req.params.id);
    const contact = await contactService.getContactById(contactId);

    if (!contact) {
      return res.status(404).json(createResponse(false, null, 'Contact not found'));
    }

    res.json(createResponse(true, contact, 'Contact retrieved successfully'));

  } catch (error: any) {
    console.error('Get contact error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to retrieve contact'));
  }
});

// Update contact
// Update contact
app.put('/contacts/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const contactId = parseInt(req.params.id);
    const { 
      name, 
      email, 
      phone, 
      company, 
      notes, 
      position, 
      avatar, 
      isActive, 
      groupIds // Add groupIds to destructured body
    } = req.body;

    // Validate groupIds if provided
    if (groupIds !== undefined && !Array.isArray(groupIds)) {
      return res.status(400).json(createResponse(false, null, 'groupIds must be an array'));
    }

    // Validate that all groupIds are numbers if provided
    if (groupIds && groupIds.some((id: any) => typeof id !== 'number' || !Number.isInteger(id))) {
      return res.status(400).json(createResponse(false, null, 'All groupIds must be integers'));
    }

    const updatedContact = await contactService.updateContact(contactId, {
      name,
      email,
      phone,
      company,
      notes,
      position,
      avatar,
      isActive,
      groupIds // Pass groupIds to service
    });

    if (!updatedContact) {
      return res.status(404).json(createResponse(false, null, 'Contact not found'));
    }

    res.json(createResponse(true, updatedContact, 'Contact updated successfully'));
  } catch (error: any) {
    console.error('Update contact error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to update contact'));
  }
});

// Delete contact
app.delete('/contacts/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const contactId = parseInt(req.params.id);
    const deleted = await contactService.deleteContact(contactId);

    if (!deleted) {
      return res.status(404).json(createResponse(false, null, 'Contact not found'));
    }

    res.json(createResponse(true, null, 'Contact deleted successfully'));

  } catch (error: any) {
    console.error('Delete contact error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to delete contact'));
  }
});

// Add contact to groups
app.post('/contacts/:id/groups', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const contactId = parseInt(req.params.id);
    const { groupIds } = req.body;

    if (!groupIds || !Array.isArray(groupIds)) {
      return res.status(400).json(createResponse(false, null, 'groupIds array is required'));
    }

    await contactService.addContactToGroups(contactId, groupIds);
    res.json(createResponse(true, null, 'Contact added to groups successfully'));

  } catch (error: any) {
    console.error('Add contact to groups error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to add contact to groups'));
  }
});

// Remove contact from groups
app.delete('/contacts/:id/groups', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const contactId = parseInt(req.params.id);
    const { groupIds } = req.body;

    if (!groupIds || !Array.isArray(groupIds)) {
      return res.status(400).json(createResponse(false, null, 'groupIds array is required'));
    }

    await contactService.removeContactFromGroups(contactId, groupIds);
    res.json(createResponse(true, null, 'Contact removed from groups successfully'));

  } catch (error: any) {
    console.error('Remove contact from groups error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to remove contact from groups'));
  }
});

// Get contacts by company
app.get('/contacts/by-company/:company', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { company } = req.params;
    const contacts = await contactService.getContactsByCompany(company);

    res.json(createResponse(
      true,
      contacts,
      `Found ${contacts.length} contacts for ${company}`
    ));

  } catch (error: any) {
    console.error('Get contacts by company error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to retrieve contacts'));
  }
});

// Import contacts
app.post('/contacts/import', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { contacts } = req.body;

    if (!contacts || !Array.isArray(contacts)) {
      return res.status(400).json(createResponse(false, null, 'contacts array is required'));
    }

    const result = await contactService.importContacts(contacts);
    
    res.json(createResponse(
      true,
      result,
      `Import completed: ${result.created} created, ${result.failed} failed`
    ));

  } catch (error: any) {
    console.error('Import contacts error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to import contacts'));
  }
});

// Get contact stats
app.get('/contacts/stats', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const stats = await contactService.getContactStats();
    res.json(createResponse(true, stats, 'Contact statistics retrieved successfully'));

  } catch (error: any) {
    console.error('Get contact stats error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to retrieve contact statistics'));
  }
});

/* ------------------------- Contact Group Routes ------------------------- */

// Create contact group
app.post('/contact-groups', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { name, description, color } = req.body;

    if (!name) {
      return res.status(400).json(createResponse(false, null, 'Name is required'));
    }

    const group = await contactGroupService.createGroup({
      name,
      description,
      color
    });

    res.status(201).json(createResponse(true, group, 'Contact group created successfully'));

  } catch (error: any) {
    console.error('Create contact group error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to create contact group'));
  }
});

// Get all contact groups
app.get('/contact-groups', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const search = req.query.search as string;
    const isActive = req.query.isActive ? req.query.isActive === 'true' : undefined;

    const filters = filterUndefined({
      page,
      limit,
      search,
      isActive
    });

    const { groups, total } = await contactGroupService.getAllGroups(filters);
    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      groups,
      `Found ${groups.length} contact groups`,
      pagination
    ));

  } catch (error: any) {
    console.error('Get contact groups error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to retrieve contact groups'));
  }
});

// Get contact group by ID
app.get('/contact-groups/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const group = await contactGroupService.getGroupById(groupId);

    if (!group) {
      return res.status(404).json(createResponse(false, null, 'Contact group not found'));
    }

    res.json(createResponse(true, group, 'Contact group retrieved successfully'));

  } catch (error: any) {
    console.error('Get contact group error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to retrieve contact group'));
  }
});

// Update contact group
app.put('/contact-groups/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const { name, description, color, isActive } = req.body;

    const updatedGroup = await contactGroupService.updateGroup(groupId, {
      name,
      description,
      color,
      isActive
    });

    if (!updatedGroup) {
      return res.status(404).json(createResponse(false, null, 'Contact group not found'));
    }

    res.json(createResponse(true, updatedGroup, 'Contact group updated successfully'));

  } catch (error: any) {
    console.error('Update contact group error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to update contact group'));
  }
});

// Delete contact group
app.delete('/contact-groups/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const deleted = await contactGroupService.deleteGroup(groupId);

    if (!deleted) {
      return res.status(404).json(createResponse(false, null, 'Contact group not found'));
    }

    res.json(createResponse(true, null, 'Contact group deleted successfully'));

  } catch (error: any) {
    console.error('Delete contact group error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to delete contact group'));
  }
});

// Add contacts to group
app.post('/contact-groups/:id/contacts', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const { contactIds } = req.body;

    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json(createResponse(false, null, 'contactIds array is required'));
    }

    await contactGroupService.addContactsToGroup(groupId, contactIds);
    res.json(createResponse(true, null, 'Contacts added to group successfully'));

  } catch (error: any) {
    console.error('Add contacts to group error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to add contacts to group'));
  }
});

// Remove contacts from group
app.delete('/contact-groups/:id/contacts', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const { contactIds } = req.body;

    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json(createResponse(false, null, 'contactIds array is required'));
    }

    await contactGroupService.removeContactsFromGroup(groupId, contactIds);
    res.json(createResponse(true, null, 'Contacts removed from group successfully'));

  } catch (error: any) {
    console.error('Remove contacts from group error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to remove contacts from group'));
  }
});

// Get contact group stats
app.get('/contact-groups/stats', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const stats = await contactGroupService.getGroupStats();
    res.json(createResponse(true, stats, 'Contact group statistics retrieved successfully'));

  } catch (error: any) {
    console.error('Get contact group stats error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to retrieve contact group statistics'));
  }
});

// Create message template
app.post('/templates', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { name, message } = req.body;

    if (!name || !message) {
      return res.status(400).json({ success: false, message: 'Name and message are required' });
    }

    const template = messageTemplateService.createTemplate({ name, message });

    res.status(201).json({ success: true, data: template, message: 'Template created successfully' });
  } catch (error: any) {
    console.error('Create template error:', error);
    res.status(500).json({ success: false, message: 'Failed to create template' });
  }
});

// Get all templates
app.get('/templates', AuthMiddleware.authenticate, async (_req, res) => {
  try {
    const templates = await messageTemplateService.getAllTemplates();
    res.json({ success: true, data: templates });
  } catch (error: any) {
    console.error('Get templates error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve templates' });
  }
});

// Get template by ID
app.get('/templates/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const template = await messageTemplateService.getTemplateById(parseInt(req.params.id));

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    res.json({ success: true, data: template });
  } catch (error: any) {
    console.error('Get template error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve template' });
  }
});

// Update template
app.put('/templates/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { name, message } = req.body;
    const template = await messageTemplateService.getTemplateById(parseInt(req.params.id));

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    template.name = name ?? template.name;
    template.message = message ?? template.message;

    await messageTemplateService.updateTemplate(template.id, template);

    res.json({ success: true, data: template, message: 'Template updated successfully' });
  } catch (error: any) {
    console.error('Update template error:', error);
    res.status(500).json({ success: false, message: 'Failed to update template' });
  }
});

// Delete template
app.delete('/templates/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const template = await messageTemplateService.getTemplateById(parseInt(req.params.id));

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    await messageTemplateService.deleteTemplate(template.id);

    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error: any) {
    console.error('Delete template error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete template' });
  }
});

// Create campaign
app.post('/campaigns', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const {
      name,
      description,
      sessionId,
      minIntervalMinutes,
      maxIntervalMinutes,
      groupId,      // Required field
      templateIds
    } = req.body;

    if (!name) {
      return res.status(400).json(createResponse(false, null, 'Campaign name is required'));
    }

    if (!groupId) {
      return res.status(400).json(createResponse(false, null, 'Contact group ID is required'));
    }

    const campaign = await campaignService.createCampaign({
      name,
      description,
      sessionId,
      minIntervalMinutes,
      maxIntervalMinutes,
      groupId,
      templateIds
    });

    res.status(201).json(createResponse(true, campaign, 'Campaign created successfully'));
  } catch (error: any) {
    console.error('Create campaign error:', error);
    res.status(400).json(createResponse(false, null, error.message || 'Failed to create campaign'));
  }
});

// Get all campaigns
app.get('/campaigns', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const sessionId = req.query.sessionId ? parseInt(req.query.sessionId as string) : undefined;
    const isActive = req.query.isActive ? req.query.isActive === 'true' : undefined;
    const status = req.query.status as string;
    const includeContactGroup = req.query.includeContactGroup === 'true';  // Changed from includeContacts
    const includeTemplates = req.query.includeTemplates === 'true';
    const includeSession = req.query.includeSession === 'true';

    const options = filterUndefined({
      page,
      limit,
      sessionId,
      isActive,
      status,
      includeContactGroup,  // Updated property name
      includeTemplates,
      includeSession
    });

    const { campaigns, total } = await campaignService.getCampaigns(options);
    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      campaigns,
      `Found ${campaigns.length} campaigns`,
      pagination
    ));

  } catch (error: any) {
    console.error('Get campaigns error:', error);
    res.status(500).json(createResponse(false, null, 'Failed to retrieve campaigns'));
  }
});

// Get campaign by ID
app.get('/campaigns/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const campaign = await campaignService.getCampaignById(campaignId);

    res.json(createResponse(true, campaign, 'Campaign retrieved successfully'));

  } catch (error: any) {
    console.error('Get campaign error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json(createResponse(false, null, error.message));
    } else {
      res.status(500).json(createResponse(false, null, 'Failed to retrieve campaign'));
    }
  }
});

// Update campaign
app.put('/campaigns/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const { 
      name, 
      description, 
      sessionId, 
      isActive, 
      minIntervalMinutes, 
      maxIntervalMinutes, 
      status, 
      groupId,        // Changed from contactIds to groupId
      templateIds 
    } = req.body;

    const updateData = filterUndefined({
      name,
      description,
      sessionId,
      isActive,
      minIntervalMinutes,
      maxIntervalMinutes,
      status,
      groupId,        // Updated field name
      templateIds
    });

    const updatedCampaign = await campaignService.updateCampaign(campaignId, updateData);

    res.json(createResponse(true, updatedCampaign, 'Campaign updated successfully'));

  } catch (error: any) {
    console.error('Update campaign error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json(createResponse(false, null, error.message));
    } else {
      res.status(400).json(createResponse(false, null, error.message || 'Failed to update campaign'));
    }
  }
});

// Delete campaign
app.delete('/campaigns/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    await campaignService.deleteCampaign(campaignId);

    res.json(createResponse(true, null, 'Campaign deleted successfully'));

  } catch (error: any) {
    console.error('Delete campaign error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json(createResponse(false, null, error.message));
    } else {
      res.status(500).json(createResponse(false, null, 'Failed to delete campaign'));
    }
  }
});

// Additional endpoint: Update campaign contact group
app.put('/campaigns/:id/contact-group', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const { groupId } = req.body;

    if (!groupId) {
      return res.status(400).json(createResponse(false, null, 'Contact group ID is required'));
    }

    const updatedCampaign = await campaignService.updateCampaignContactGroup(campaignId, groupId);

    res.json(createResponse(true, updatedCampaign, 'Campaign contact group updated successfully'));

  } catch (error: any) {
    console.error('Update campaign contact group error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json(createResponse(false, null, error.message));
    } else {
      res.status(400).json(createResponse(false, null, error.message || 'Failed to update campaign contact group'));
    }
  }
});

// Additional endpoint: Get campaign statistics
app.get('/campaigns/:id/statistics', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const statistics = await campaignService.getCampaignStatistics(campaignId);

    res.json(createResponse(true, statistics, 'Campaign statistics retrieved successfully'));

  } catch (error: any) {
    console.error('Get campaign statistics error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json(createResponse(false, null, error.message));
    } else {
      res.status(500).json(createResponse(false, null, 'Failed to retrieve campaign statistics'));
    }
  }
});


// Initialize and start server
async function startServer() {
  try {
    console.log('🚀 Starting WhatsApp Tracker API Server with TypeORM...');
    
    // Initialize database
    const dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();
    
    // Initialize services
    messageService = new MessageService();
    sessionService = new SessionService();
    chatService = new ChatService();
    contactService = new ContactService();
    contactGroupService = new ContactGroupService();
    messageTemplateService = new MessageTemplateService();
    campaignService = new CampaignService(dbManager.dataSource);

    
    // Create default admin user if none exists
    await createDefaultAdmin();
    
    // Start server
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`✅ API Server running on http://localhost:${PORT}`);
      console.log('✅ TypeORM initialized and ready');
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}


// Get messages sent by a specific number
app.get('/messages/sent-by/:number', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { number } = req.params;
    const page = Number(parseInt(req.query.page as string) || 1);
    const limit = Number(Math.min(parseInt(req.query.limit as string) || 50, 100));
    const sessionName = req.query.session as string;
    const hasMedia = req.query.hasMedia as string;

    const filters = filterUndefined({
      sessionName,
      hasMedia: hasMedia ? hasMedia === 'true' : undefined,
      page,
      limit
    });

    const { messages, total } = await messageService.getMessagesSentBy(number, {
      ...filters,
      page,
      limit
    });
    const messagesWithUrls = messages.map(message => ({
      ...message,
      downloadUrl: message.mediaFilename ? `/messages/${message.messageId}/download` : null,
      viewUrl: message.mediaFilename ? `/messages/${message.messageId}/view` : null
    }));

    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      messagesWithUrls,
      `Found ${messages.length} messages sent by ${number}`,
      pagination
    ));

  } catch (error: any) {
    console.error('Error fetching sent messages:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Get chat between two numbers
app.get('/messages/chat/:number1/:number2', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { number1, number2 } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const sessionName = req.query.session as string;
    const order = (req.query.order as string) || 'desc'; // 'asc' for chronological, 'desc' for latest first

    const filters = filterUndefined({
      sessionName,
      page,
      limit,
      order
    });

    const { messages, total } = await messageService.getChatBetweenNumbers(number1, number2, {
      ...filters,
      page,
      limit,
      order: order as 'ASC' | 'DESC', // ensure type safety
    });
    const messagesWithUrls = messages.map(message => ({
      ...message,
      downloadUrl: message.mediaFilename ? `/messages/${message.messageId}/download` : null,
      viewUrl: message.mediaFilename ? `/messages/${message.messageId}/view` : null
    }));

    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      messagesWithUrls,
      `Found ${messages.length} messages in chat between ${number1} and ${number2}`,
      pagination
    ));

  } catch (error: any) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Get message details by ID
app.get('/messages/:messageId', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await messageService.getMessageById(messageId);

    if (!message) {
      return res.status(404).json(createResponse(false, null, 'Message not found'));
    }

    // Add download URLs if message has media
    if (message.mediaFilename) {
      (message as any).downloadUrl = `/messages/${messageId}/download`;
      (message as any).viewUrl = `/messages/${messageId}/view`;
    }

    res.json(createResponse(true, message, 'Message retrieved successfully'));

  } catch (error: any) {
    console.error('Error fetching message:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Download file by message ID
app.get('/messages/:messageId/download', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const result = await messageService.downloadMessageMedia(messageId);

    if (!result) {
      return res.status(404).json(createResponse(false, null, 'Message not found or has no media'));
    }

    const { filepath, message, stats, mimeType, originalName } = result;

    // Set headers for download
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);
    res.setHeader('X-Message-ID', messageId);
    res.setHeader('X-Original-Filename', originalName);
    res.setHeader('X-File-Size', stats.size.toString());
    res.setHeader('X-MIME-Type', mimeType);

    // Create read stream and pipe to response
    const fs = require('fs');
    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);

    fileStream.on('error', (err: any) => {
      console.error('Error streaming file:', err);
      if (!res.headersSent) {
        res.status(500).json(createResponse(false, null, 'Error downloading file'));
      }
    });

  } catch (error: any) {
    console.error('Download error:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// View file inline (for images, videos, etc.)
app.get('/messages/:messageId/view', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const result = await messageService.downloadMessageMedia(messageId);

    if (!result) {
      return res.status(404).json(createResponse(false, null, 'Message not found or has no media'));
    }

    const { filepath, message, stats, mimeType } = result;

    // Set headers for inline viewing
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${message.mediaFilename}"`);

    // Stream file
    const fs = require('fs');
    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);

    fileStream.on('error', (err: any) => {
      console.error('Error streaming file:', err);
      if (!res.headersSent) {
        res.status(500).json(createResponse(false, null, 'Error viewing file'));
      }
    });

  } catch (error: any) {
    console.error('View error:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

/* ------------------------- Missing Session Stats Routes ------------------------- */

// Get session statistics summary
app.get('/sessions/:sessionName/stats', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { sessionName } = req.params;
    const days = parseInt(req.query.days as string) || 30;

    const stats = await sessionService.getSessionStats(sessionName, days);

    if (!stats) {
      return res.status(404).json(createResponse(false, null, 'Session not found'));
    }

    res.json(createResponse(true, stats, `Session statistics for last ${days} days`));

  } catch (error: any) {
    console.error('Error fetching session stats:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

/* ------------------------- Missing Chat Routes ------------------------- */

// Get all chats (across all sessions)
app.get('/chats', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const chatType = req.query.type as 'individual' | 'group';
    const isActive = req.query.active as string;
    const sessionName = req.query.session as string;

    const filters = filterUndefined({
      sessionName,
      chatType,
      isActive: isActive ? isActive === 'true' : undefined,
      page,
      limit
    });

    const { chats, total } = await chatService.getAllChats({
      ...filters,
      page,
      limit
    });
    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      chats,
      `Found ${chats.length} chats`,
      pagination
    ));

  } catch (error: any) {
    console.error('Error fetching chats:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Get specific chat details
app.get('/chats/:sessionName/:chatId', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { sessionName, chatId } = req.params;
    const decodedChatId = decodeURIComponent(chatId);

    const chat = await chatService.getChatDetails(sessionName, decodedChatId);

    if (!chat) {
      return res.status(404).json(createResponse(false, null, 'Chat not found'));
    }

    res.json(createResponse(true, chat, 'Chat retrieved successfully'));

  } catch (error: any) {
    console.error('Error fetching chat:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Get messages for a specific chat
app.get('/chats/:sessionName/:chatId/messages', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { sessionName, chatId } = req.params;
    const decodedChatId = decodeURIComponent(chatId);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const hasMedia = req.query.hasMedia as string;
    const messageType = req.query.type as string;

    const filters = filterUndefined({
      hasMedia: hasMedia ? hasMedia === 'true' : undefined,
      messageType,
      page,
      limit
    });

    const { messages, total } = await chatService.getChatMessages(sessionName, decodedChatId, {
      ...filters,
      page,
      limit
    });

    // Add download URLs for messages with media
    const messagesWithUrls = messages.map(message => ({
      ...message,
      downloadUrl: message.mediaFilename ? `/messages/${message.messageId}/download` : null,
      viewUrl: message.mediaFilename ? `/messages/${message.messageId}/view` : null
    }));

    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      messagesWithUrls,
      `Found ${messages.length} messages for chat`,
      pagination
    ));

  } catch (error: any) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Get chat statistics
app.get('/chats/:sessionName/:chatId/stats', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { sessionName, chatId } = req.params;
    const decodedChatId = decodeURIComponent(chatId);

    const stats = await chatService.getChatStats(sessionName, decodedChatId);

    if (!stats) {
      return res.status(404).json(createResponse(false, null, 'Chat not found'));
    }

    res.json(createResponse(true, stats, 'Chat statistics retrieved successfully'));

  } catch (error: any) {
    console.error('Error fetching chat stats:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Search chats
app.get('/chats/search', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const searchQuery = req.query.query as string;
    const sessionName = req.query.session as string;
    const chatType = req.query.type as 'individual' | 'group';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!searchQuery || searchQuery.trim().length < 2) {
      return res.status(400).json(createResponse(false, null, 'Search query must be at least 2 characters'));
    }

    const filters = filterUndefined({
      sessionName,
      chatType,
      page,
      limit
    });

    const { chats, total } = await chatService.searchChats(searchQuery, filters);
    const pagination = getPaginationInfo(page, limit, total);

    res.json(createResponse(
      true,
      chats,
      `Found ${chats.length} chats matching "${searchQuery}"`,
      pagination
    ));

  } catch (error: any) {
    console.error('Error searching chats:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});

// Update chat (mark as read, archive, etc.)
app.put('/chats/:sessionName/:chatId', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { sessionName, chatId } = req.params;
    const decodedChatId = decodeURIComponent(chatId);
    const { isActive, unreadCount, chatName } = req.body;

    const updateData = filterUndefined({
      isActive,
      unreadCount,
      chatName
    });

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json(createResponse(false, null, 'No valid fields to update'));
    }

    const updated = await chatService.updateChat(sessionName, decodedChatId, updateData);

    res.json(createResponse(true, null, 'Chat updated successfully'));

  } catch (error: any) {
    console.error('Error updating chat:', error);
    res.status(500).json(createResponse(false, null, 'Internal server error'));
  }
});
// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  try {
    const dbManager = DatabaseManager.getInstance();
    await dbManager.close();
    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

startServer().catch(console.error);

export default app;