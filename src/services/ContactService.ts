import { ContactRepository, ContactGroupRepository, GroupCheckingStats } from '../repositories/ContactRepository';
import { Contact, ContactGroup } from '../entities/Contact';
import { DeepPartial } from 'typeorm';

export class ContactService {
  private contactRepository: ContactRepository;

  constructor() {
    this.contactRepository = new ContactRepository();
  }

    async createContact(contactData: {
    name: string;
    email?: string;
    phone: string;
    company?: string;
    notes?: string;
    position?: string;
    avatar?: string;
    groupIds?: number[];
    groupNames?: string[]; // ✅ إضافة دعم للأسماء
    }): Promise<Contact> {
    try {
        const existingContact = await this.contactRepository.findByPhone(contactData.phone);
        if (existingContact) {
        throw new Error('Contact with this phone number already exists');
        }

        if (contactData.email) {
        const existingEmailContact = await this.contactRepository.findByEmail(contactData.email);
        if (existingEmailContact) {
            throw new Error('Contact with this email already exists');
        }
        }

        const contact = this.contactRepository.create({
        name: contactData.name,
        email: contactData.email,
        phone: contactData.phone,
        company: contactData.company,
        notes: contactData.notes,
        position: contactData.position,
        avatar: contactData.avatar,
        isActive: true
        } as DeepPartial<Contact>);

        const savedContact = await this.contactRepository.save(contact);

        // ✅ Handle groups
        let allGroupIds: number[] = [];
        if (contactData.groupIds?.length) {
        allGroupIds = [...allGroupIds, ...contactData.groupIds];
        }
        if (contactData.groupNames?.length) {
        const groupIdsFromNames = await this.getOrCreateGroupsByName(contactData.groupNames);
        allGroupIds = [...allGroupIds, ...groupIdsFromNames];
        }
        if (allGroupIds.length > 0) {
        await this.addContactToGroups(savedContact.id, allGroupIds);
        }

        console.log(`✅ Created new contact: ${contactData.name} (${contactData.phone})`);
        return await this.contactRepository.findWithGroups(savedContact.id) || savedContact;
    } catch (error) {
        console.error('Error creating contact:', error);
        throw error;
    }
    }
    async importContacts(contactsData: Array<{
        name: string;
        email?: string;
        phone: string;
        company?: string;
        notes?: string;
        position?: string;
        groupNames?: string[]; // ✅
        }>): Promise<{ created: number; failed: number; errors: string[] }> {
        let created = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const contactData of contactsData) {
            try {
            await this.createContact(contactData);
            created++;
            } catch (error: any) {
            failed++;
            errors.push(`Failed to create ${contactData.name}: ${error.message}`);
            }
        }

        console.log(`📊 Import complete: ${created} created, ${failed} failed`);
        return { created, failed, errors };
        }

    private async getOrCreateGroupsByName(groupNames: string[]): Promise<number[]> {
        const groupRepository = new ContactGroupRepository();
        const groupIds: number[] = [];

        for (const name of groupNames) {
            let group = await groupRepository.findOne({ where: { name, isActive: true } });
            if (!group) {
            // create group if not exists
            group = groupRepository.create({ name, isActive: true });
            group = await groupRepository.save(group);
            console.log(`✅ Created new group while importing: ${name}`);
            }
            groupIds.push(group.id);
        }

        return groupIds;
        }


// Updated ContactService updateContact method
async updateContact(
  contactId: number,
  updates: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    notes?: string;
    position?: string;
    avatar?: string;
    isActive?: boolean;
    groupIds?: number[]; // Add groupIds parameter
  }
): Promise<Contact | null> {
  try {
    const contact = await this.contactRepository.findOne({ where: { id: contactId } });
    if (!contact) {
      throw new Error('Contact not found');
    }

    // Check for duplicate phone if phone is being updated
    if (updates.phone && updates.phone !== contact.phone) {
      const existingContact = await this.contactRepository.findByPhone(updates.phone);
      if (existingContact && existingContact.id !== contactId) {
        throw new Error('Contact with this phone number already exists');
      }
    }

    // Check for duplicate email if email is being updated
    if (updates.email && updates.email !== contact.email) {
      const existingEmailContact = await this.contactRepository.findByEmail(updates.email);
      if (existingEmailContact && existingEmailContact.id !== contactId) {
        throw new Error('Contact with this email already exists');
      }
    }

    // Extract groupIds from updates to handle separately
    const { groupIds, ...contactUpdates } = updates;

    // Update basic contact information
    Object.assign(contact, contactUpdates, { updatedAt: new Date() });
    const updatedContact = await this.contactRepository.save(contact);

    // Handle group associations if groupIds are provided
    if (groupIds !== undefined) {
      await this.updateContactGroups(contactId, groupIds);
    }

    console.log(`📝 Updated contact: ${updatedContact.name} (${updatedContact.phone})`);
    return await this.contactRepository.findWithGroups(updatedContact.id);
  } catch (error) {
    console.error('Error updating contact:', error);
    throw error;
  }
}

// Helper method to update contact groups
private async updateContactGroups(contactId: number, groupIds: number[]): Promise<void> {
  try {
    const contact = await this.contactRepository.findWithGroups(contactId);
    if (!contact) {
      throw new Error('Contact not found');
    }

    // If groupIds is empty array, remove from all groups
    if (groupIds.length === 0) {
      contact.groups = [];
      await this.contactRepository.save(contact);
      console.log(`➖ Removed contact ${contact.name} from all groups`);
      return;
    }

    // Get the groups that should be associated
    const groupRepository = new ContactGroupRepository();
    const groups = await groupRepository.findByIds(groupIds);

    if (groups.length !== groupIds.length) {
      const foundIds = groups.map(g => g.id);
      const notFoundIds = groupIds.filter(id => !foundIds.includes(id));
      throw new Error(`Groups not found: ${notFoundIds.join(', ')}`);
    }

    // Replace current groups with new ones
    contact.groups = groups;
    await this.contactRepository.save(contact);

    console.log(`🔄 Updated contact ${contact.name} groups: ${groups.map(g => g.name).join(', ')}`);
  } catch (error) {
    console.error('Error updating contact groups:', error);
    throw error;
  }
}
  async getContactById(contactId: number): Promise<Contact | null> {
    return this.contactRepository.findWithGroups(contactId);
  }

  async getAllContacts(options: {
    page?: number;
    limit?: number;
    search?: string;
    groupId?: number;
    company?: string;
    isActive?: boolean;
  } = {}): Promise<{ contacts: Contact[]; total: number }> {
    try {
      const { page = 1, limit = 50, search = '', ...filters } = options;
      
      const [contacts, total] = await this.contactRepository.searchContacts(search, {
        ...filters,
        page,
        limit
      });

      return { contacts, total };
    } catch (error) {
      console.error('Error getting contacts:', error);
      throw error;
    }
  }

  async getContactsByGroup(groupId: number): Promise<Contact[]> {
    return this.contactRepository.findByGroup(groupId);
  }

  async getContactsByCompany(company: string): Promise<Contact[]> {
    return this.contactRepository.findByCompany(company);
  }

  async addContactToGroups(contactId: number, groupIds: number[]): Promise<void> {
    try {
      const contact = await this.contactRepository.findWithGroups(contactId);
      if (!contact) {
        throw new Error('Contact not found');
      }

      const groupRepository = new ContactGroupRepository();
      const groups = await groupRepository.findByIds(groupIds);

      // Add new groups to existing ones (avoid duplicates)
      const existingGroupIds = contact.groups.map(g => g.id);
      const newGroups = groups.filter(g => !existingGroupIds.includes(g.id));
      
      contact.groups = [...contact.groups, ...newGroups];
      await this.contactRepository.save(contact);

      console.log(`➕ Added contact ${contact.name} to ${newGroups.length} groups`);
    } catch (error) {
      console.error('Error adding contact to groups:', error);
      throw error;
    }
  }

  async removeContactFromGroups(contactId: number, groupIds: number[]): Promise<void> {
    try {
      const contact = await this.contactRepository.findWithGroups(contactId);
      if (!contact) {
        throw new Error('Contact not found');
      }

      contact.groups = contact.groups.filter(g => !groupIds.includes(g.id));
      await this.contactRepository.save(contact);

      console.log(`➖ Removed contact ${contact.name} from ${groupIds.length} groups`);
    } catch (error) {
      console.error('Error removing contact from groups:', error);
      throw error;
    }
  }

  async updateLastContacted(contactId: number): Promise<void> {
    await this.contactRepository.updateLastContacted(contactId);
  }

    async deleteContact(contactId: number): Promise<boolean> {
    try {
        const contact = await this.contactRepository.findOne({ where: { id: contactId } });
        if (!contact) {
        return false;
        }

        // Hard delete
        await this.contactRepository.remove(contact);

        console.log(`🗑️ Permanently deleted contact: ${contact.name} (${contact.phone})`);
        return true;
    } catch (error) {
        console.error('Error deleting contact:', error);
        throw error;
    }
    }

  async getContactStats(): Promise<any> {
    return this.contactRepository.getContactStats();
  }

}

export class ContactGroupService {
  private groupRepository: ContactGroupRepository;

  constructor() {
    this.groupRepository = new ContactGroupRepository();
  }

  async createGroup(groupData: {
    name: string;
    description?: string;
    color?: string;
  }): Promise<ContactGroup> {
    try {
      // Check if group with same name already exists
      const existingGroup = await this.groupRepository.findOne({
        where: { name: groupData.name, isActive: true }
      });
      
      if (existingGroup) {
        throw new Error('Group with this name already exists');
      }

      const group = this.groupRepository.create({
        name: groupData.name,
        description: groupData.description,
        color: groupData.color,
        isActive: true
      });

      const savedGroup = await this.groupRepository.save(group);
      console.log(`✅ Created new group: ${groupData.name}`);
      return savedGroup;
    } catch (error) {
      console.error('Error creating group:', error);
      throw error;
    }
  }

  async updateGroup(
    groupId: number,
    updates: {
      name?: string;
      description?: string;
      color?: string;
      isActive?: boolean;
    }
  ): Promise<ContactGroup | null> {
    try {
      const group = await this.groupRepository.findOne({ where: { id: groupId } });
      if (!group) {
        throw new Error('Group not found');
      }

      // Check for duplicate name if name is being updated
      if (updates.name && updates.name !== group.name) {
        const existingGroup = await this.groupRepository.findOne({
          where: { name: updates.name, isActive: true }
        });
        if (existingGroup && existingGroup.id !== groupId) {
          throw new Error('Group with this name already exists');
        }
      }

      Object.assign(group, updates, { updatedAt: new Date() });
      const updatedGroup = await this.groupRepository.save(group);

      console.log(`📝 Updated group: ${updatedGroup.name}`);
      return updatedGroup;
    } catch (error) {
      console.error('Error updating group:', error);
      throw error;
    }
  }

  async getGroupById(groupId: number): Promise<ContactGroup | null> {
    return this.groupRepository.findWithContacts(groupId);
  }

  async getAllGroups(options: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  } = {}): Promise<{ groups: Array<ContactGroup & { contactCount: number; checkingStates: GroupCheckingStats }>; total: number }> {
    try {
      const { page = 1, limit = 50, search = '', isActive } = options;
      
      if (search) {
        const [groups, total] = await this.groupRepository.searchGroups(search, {
          isActive,
          page,
          limit
        });
        
        // Add contact count and checking states for searched groups
        const groupsWithStats = await Promise.all(
          groups.map(async (group) => {
            const checkingStates = await this.groupRepository.getGroupCheckingStats(group.id);
            return {
              ...group,
              contactCount: checkingStates.totalContacts,
              checkingStates
            };
          })
        );

        return { groups: groupsWithStats, total };
      } else {
        // Use optimized query when not searching
        const allGroups = await this.groupRepository.findWithContactCount();
        const filteredGroups = isActive !== undefined 
          ? allGroups.filter(g => g.isActive === isActive)
          : allGroups;

        const offset = (page - 1) * limit;
        const paginatedGroups = filteredGroups.slice(offset, offset + limit);

        return { groups: paginatedGroups, total: filteredGroups.length };
      }
    } catch (error) {
      console.error('Error getting groups:', error);
      throw error;
    }
  }

  async addContactsToGroup(groupId: number, contactIds: number[]): Promise<void> {
    try {
      await this.groupRepository.addContactsToGroup(groupId, contactIds);
      console.log(`➕ Added ${contactIds.length} contacts to group ${groupId}`);
    } catch (error) {
      console.error('Error adding contacts to group:', error);
      throw error;
    }
  }

  async removeContactsFromGroup(groupId: number, contactIds: number[]): Promise<void> {
    try {
      await this.groupRepository.removeContactsFromGroup(groupId, contactIds);
      console.log(`➖ Removed ${contactIds.length} contacts from group ${groupId}`);
    } catch (error) {
      console.error('Error removing contacts from group:', error);
      throw error;
    }
  }
async deleteGroup(groupId: number): Promise<boolean> {
  try {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
      relations: ["contacts"],
    });

    if (!group) {
      return false;
    }

    // Hard delete contacts inside group
    if (group.contacts && group.contacts.length > 0) {
      await this.groupRepository.manager.getRepository(Contact).remove(group.contacts);
      console.log(`🗑️ Permanently deleted ${group.contacts.length} contacts from group: ${group.name}`);
    }

    // Hard delete group
    await this.groupRepository.remove(group);

    console.log(`🗑️ Permanently deleted group: ${group.name}`);
    return true;
  } catch (error) {
    console.error("Error deleting group:", error);
    throw error;
  }
}

async getGroupStats(): Promise<any> {
    return this.groupRepository.getGroupStats();
  }
}