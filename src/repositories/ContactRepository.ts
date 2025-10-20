import { Repository, Brackets, In } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { Contact, ContactGroup } from '../entities/Contact';

export interface GroupCheckingStats {
  totalContacts: number;
  checked: number;
  onWhatsapp: number;
  notOnWhatsapp: number;
}

export class ContactGroupRepository extends Repository<ContactGroup> {
  constructor() {
    super(ContactGroup, AppDataSource.manager);
  }

  async findWithContacts(groupId: number): Promise<ContactGroup | null> {
    return this.findOne({
      where: { id: groupId },
      relations: ['contacts']
    });
  }

  async findWithContactCount(): Promise<Array<ContactGroup & { contactCount: number; checkingStates: GroupCheckingStats }>> {
    const queryBuilder = this.createQueryBuilder('group')
      .leftJoin('group.contacts', 'contact')
      .addSelect('COUNT(contact.id)', 'contactCount')
      .addSelect('SUM(CASE WHEN contact.is_checked = 1 THEN 1 ELSE 0 END)', 'checkedCount')
      .addSelect('SUM(CASE WHEN contact.is_checked = 1 AND contact.is_wp_contact = 1 THEN 1 ELSE 0 END)', 'onWhatsappCount')
      .addSelect('SUM(CASE WHEN contact.is_checked = 1 AND contact.is_wp_contact = 0 THEN 1 ELSE 0 END)', 'notOnWhatsappCount')
      .where('group.isActive = :isActive', { isActive: true })
      .groupBy('group.id')
      .addGroupBy('group.name')
      .addGroupBy('group.description')
      .addGroupBy('group.color')
      .addGroupBy('group.isActive')
      .addGroupBy('group.createdAt')
      .addGroupBy('group.updatedAt')
      .orderBy('group.name', 'ASC');

    const rawAndEntities = await queryBuilder.getRawAndEntities();
    
    return rawAndEntities.entities.map((group, index) => {
      const raw = rawAndEntities.raw[index];
      const totalContacts = parseInt(raw?.contactCount) || 0;
      const checked = parseInt(raw?.checkedCount) || 0;
      const onWhatsapp = parseInt(raw?.onWhatsappCount) || 0;
      const notOnWhatsapp = parseInt(raw?.notOnWhatsappCount) || 0;

      return {
        ...group,
        contactCount: totalContacts,
        checkingStates: {
          totalContacts,
          checked,
          onWhatsapp,
          notOnWhatsapp
        }
      };
    });
  }

  async getGroupCheckingStats(groupId: number): Promise<GroupCheckingStats> {
    const result = await this.createQueryBuilder('group')
      .leftJoin('group.contacts', 'contact')
      .select('COUNT(contact.id)', 'totalContacts')
      .addSelect('SUM(CASE WHEN contact.is_checked = 1 THEN 1 ELSE 0 END)', 'checked')
      .addSelect('SUM(CASE WHEN contact.is_checked = 1 AND contact.is_wp_contact = 1 THEN 1 ELSE 0 END)', 'onWhatsapp')
      .addSelect('SUM(CASE WHEN contact.is_checked = 1 AND contact.is_wp_contact = 0 THEN 1 ELSE 0 END)', 'notOnWhatsapp')
      .where('group.id = :groupId', { groupId })
      .getRawOne();

    return {
      totalContacts: parseInt(result?.totalContacts) || 0,
      checked: parseInt(result?.checked) || 0,
      onWhatsapp: parseInt(result?.onWhatsapp) || 0,
      notOnWhatsapp: parseInt(result?.notOnWhatsapp) || 0
    };
  }

  async addContactsToGroup(groupId: number, contactIds: number[]): Promise<void> {
    const group = await this.findOne({
      where: { id: groupId },
      relations: ['contacts']
    });

    if (!group) {
      throw new Error('Group not found');
    }

    const contactRepository = new ContactRepository();
    const contacts = await contactRepository.find({
      where: { id: In(contactIds) }
    });

    // Add new contacts to existing ones
    group.contacts = [...group.contacts, ...contacts];
    await this.save(group);
  }

  async removeContactsFromGroup(groupId: number, contactIds: number[]): Promise<void> {
    const group = await this.findOne({
      where: { id: groupId },
      relations: ['contacts']
    });

    if (!group) {
      throw new Error('Group not found');
    }

    // Remove specified contacts
    group.contacts = group.contacts.filter(
      contact => !contactIds.includes(contact.id)
    );

    await this.save(group);
  }

  async searchGroups(
    searchQuery: string,
    options: {
      isActive?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<[ContactGroup[], number]> {
    const { isActive, page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    let queryBuilder = this.createQueryBuilder('group');

    // Add search conditions
    if (searchQuery) {
      queryBuilder = queryBuilder.andWhere(
        new Brackets(qb => {
          qb.where('group.name LIKE :searchQuery', { searchQuery: `%${searchQuery}%` })
            .orWhere('group.description LIKE :searchQuery', { searchQuery: `%${searchQuery}%` });
        })
      );
    }

    // Add filters
    if (isActive !== undefined) {
      queryBuilder = queryBuilder.andWhere('group.isActive = :isActive', { isActive });
    }

    // Order and paginate
    queryBuilder = queryBuilder
      .orderBy('group.name', 'ASC')
      .offset(offset)
      .limit(limit);

    const [groups, total] = await queryBuilder.getManyAndCount();
    return [groups, total];
  }

  async getGroupStats(): Promise<{
    totalGroups: number;
    activeGroups: number;
    inactiveGroups: number;
    averageContactsPerGroup: number;
  }> {
    const totalGroups = await this.count();
    const activeGroups = await this.count({ where: { isActive: true } });
    const inactiveGroups = totalGroups - activeGroups;

    const avgResult = await this.createQueryBuilder('group')
      .leftJoin('group.contacts', 'contact')
      .select('AVG(CAST(COUNT(contact.id) AS DECIMAL))', 'average')
      .where('group.isActive = :isActive', { isActive: true })
      .groupBy('group.id')
      .getRawOne();

    return {
      totalGroups,
      activeGroups,
      inactiveGroups,
      averageContactsPerGroup: parseFloat(avgResult?.average) || 0
    };
  }
}

export class ContactRepository extends Repository<Contact> {
  constructor() {
    super(Contact, AppDataSource.manager);
  }

  async findWithGroups(contactId: number): Promise<Contact | null> {
    return this.findOne({
      where: { id: contactId },
      relations: ['groups']
    });
  }

  async searchContacts(
    searchQuery: string,
    options: {
      groupId?: number;
      company?: string;
      isActive?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<[Contact[], number]> {
    const { groupId, company, isActive, page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    let queryBuilder = this.createQueryBuilder('contact')
      .leftJoinAndSelect('contact.groups', 'group');

    // Add search conditions
    if (searchQuery) {
      queryBuilder = queryBuilder.andWhere(
        new Brackets(qb => {
          qb.where('contact.name LIKE :searchQuery', { searchQuery: `%${searchQuery}%` })
            .orWhere('contact.email LIKE :searchQuery', { searchQuery: `%${searchQuery}%` })
            .orWhere('contact.phone LIKE :searchQuery', { searchQuery: `%${searchQuery}%` })
            .orWhere('contact.company LIKE :searchQuery', { searchQuery: `%${searchQuery}%` });
        })
      );
    }

    // Add filters
    if (groupId) {
      queryBuilder = queryBuilder.andWhere('group.id = :groupId', { groupId });
    }

    if (company) {
      queryBuilder = queryBuilder.andWhere('contact.company = :company', { company });
    }

    if (isActive !== undefined) {
      queryBuilder = queryBuilder.andWhere('contact.isActive = :isActive', { isActive });
    }

    // Order and paginate
    queryBuilder = queryBuilder
      .orderBy('contact.name', 'ASC')
      .offset(offset)
      .limit(limit);

    const [contacts, total] = await queryBuilder.getManyAndCount();
    return [contacts, total];
  }

  async findByGroup(groupId: number): Promise<Contact[]> {
    return this.createQueryBuilder('contact')
      .innerJoin('contact.groups', 'group')
      .where('group.id = :groupId', { groupId })
      .andWhere('contact.isActive = :isActive', { isActive: true })
      .orderBy('contact.name', 'ASC')
      .getMany();
  }

  async findByPhone(phone: string): Promise<Contact | null> {
    return this.findOne({
      where: { phone, isActive: true },
      relations: ['groups']
    });
  }

  async findByEmail(email: string): Promise<Contact | null> {
    return this.findOne({
      where: { email, isActive: true },
      relations: ['groups']
    });
  }

  async findByCompany(company: string): Promise<Contact[]> {
    return this.find({
      where: { company, isActive: true },
      relations: ['groups'],
      order: { name: 'ASC' }
    });
  }

  async updateLastContacted(contactId: number): Promise<void> {
    await this.update(
      { id: contactId },
      { lastContacted: new Date(), updatedAt: new Date() }
    );
  }

  async getContactStats(): Promise<{
    totalContacts: number;
    activeContacts: number;
    inactiveContacts: number;
    companiesCount: number;
    ungroupedContacts: number;
  }> {
    const totalContacts = await this.count();
    const activeContacts = await this.count({ where: { isActive: true } });
    const inactiveContacts = totalContacts - activeContacts;

    const companiesResult = await this.createQueryBuilder('contact')
      .select('COUNT(DISTINCT contact.company)', 'count')
      .where('contact.company IS NOT NULL')
      .andWhere('contact.company != \'\'')
      .getRawOne();

    const ungroupedResult = await this.createQueryBuilder('contact')
      .leftJoin('contact.groups', 'group')
      .where('group.id IS NULL')
      .andWhere('contact.isActive = :isActive', { isActive: true })
      .getCount();

    return {
      totalContacts,
      activeContacts,
      inactiveContacts,
      companiesCount: parseInt(companiesResult?.count) || 0,
      ungroupedContacts: ungroupedResult
    };
  }
}