import { Repository } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { MessageTemplate } from '../entities/MessageTemplate';

export class MessageTemplateRepository extends Repository<MessageTemplate> {
  constructor() {
    super(MessageTemplate, AppDataSource.manager);
  }

  // Create a new template
  async createTemplate(name: string, message: string): Promise<MessageTemplate> {
    const template = this.create({ name, message });
    return this.save(template);
  }

  // Get all templates
  async getAllTemplates(): Promise<MessageTemplate[]> {
    return this.find({ order: { createdAt: 'DESC' } });
  }

  // Get template by ID
  async getTemplateById(id: number): Promise<MessageTemplate | null> {
    return this.findOne({ where: { id } });
  }

  // Update a template
  async updateTemplate(id: number, updateData: Partial<MessageTemplate>): Promise<MessageTemplate | null> {
    const template = await this.findOne({ where: { id } });
    if (!template) return null;

    Object.assign(template, updateData);
    return this.save(template);
  }

  // Delete a template
  async deleteTemplate(id: number): Promise<boolean> {
    const result = await this.delete(id);
    return result.affected !== 0;
  }
}
