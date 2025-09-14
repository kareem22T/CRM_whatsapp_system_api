import { MessageTemplateRepository } from '../repositories/MessageTemplateRepository';
import { MessageTemplate } from '../entities/MessageTemplate';

export class MessageTemplateService {
  private templateRepository: MessageTemplateRepository;

  constructor() {
    this.templateRepository = new MessageTemplateRepository();
  }

  // Create template
  async createTemplate(data: { name: string; message: string }): Promise<MessageTemplate> {
    const existing = await this.templateRepository.findOne({ where: { name: data.name } });
    if (existing) {
      throw new Error('Template with this name already exists');
    }
    return this.templateRepository.createTemplate(data.name, data.message);
  }

  // Get all templates
  async getAllTemplates(): Promise<MessageTemplate[]> {
    return this.templateRepository.getAllTemplates();
  }

  // Get template by id
  async getTemplateById(id: number): Promise<MessageTemplate | null> {
    return this.templateRepository.getTemplateById(id);
  }

  // Update template
  async updateTemplate(
    id: number,
    updates: { name?: string; message?: string }
  ): Promise<MessageTemplate | null> {
    if (updates.name) {
      const existing = await this.templateRepository.findOne({ where: { name: updates.name } });
      if (existing && existing.id !== id) {
        throw new Error('Template with this name already exists');
      }
    }
    return this.templateRepository.updateTemplate(id, updates);
  }

  // Delete template
  async deleteTemplate(id: number): Promise<boolean> {
    return this.templateRepository.deleteTemplate(id);
  }
}
