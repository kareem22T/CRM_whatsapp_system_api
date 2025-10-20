import { Repository } from 'typeorm';
import { AppDataSource } from '../database/data-source';
import { MessageTemplate } from '../entities/MessageTemplate';

export class MessageTemplateRepository extends Repository<MessageTemplate> {
  constructor() {
    super(MessageTemplate, AppDataSource.manager);
  }

  // Create a new template with optional image
  async createTemplate(
    name: string,
    message: string,
    imageData?: {
      filename: string;
      mimetype: string;
      size: number;
      data: Buffer;
    }
  ): Promise<MessageTemplate> {
    const template = this.create({
      name,
      message,
      imageFilename: imageData?.filename || null,
      imageMimetype: imageData?.mimetype || null,
      imageSize: imageData?.size || null,
      imageData: imageData?.data || null
    });
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

  // Get template by ID without image data (for list views)
  async getTemplateByIdLean(id: number): Promise<Partial<MessageTemplate> | null> {
    const query = this.createQueryBuilder('template')
      .select(['template.id', 'template.name', 'template.message', 'template.imageFilename', 'template.imageMimetype', 'template.imageSize', 'template.createdAt', 'template.updatedAt'])
      .where('template.id = :id', { id });
    
    return query.getOne();
  }

  // Update a template with optional image
  async updateTemplate(
    id: number,
    updateData: Partial<MessageTemplate> & {
      imageData?: {
        filename: string;
        mimetype: string;
        size: number;
        data: Buffer;
      };
    }
  ): Promise<MessageTemplate | null> {
    const template = await this.findOne({ where: { id } });
    if (!template) return null;

    // Handle image update
    if (updateData.imageData) {
      template.imageFilename = updateData.imageData.filename;
      template.imageMimetype = updateData.imageData.mimetype;
      template.imageSize = updateData.imageData.size;
      template.imageData = updateData.imageData.data;
      delete (updateData as any).imageData;
    }

    Object.assign(template, updateData);
    return this.save(template);
  }

  // Remove image from template
  async removeImage(id: number): Promise<MessageTemplate | null> {
    const template = await this.findOne({ where: { id } });
    if (!template) return null;

    template.imageFilename = null;
    template.imageMimetype = null;
    template.imageSize = null;
    template.imageData = null;

    return this.save(template);
  }

  // Delete a template
  async deleteTemplate(id: number): Promise<boolean> {
    const result = await this.delete(id);
    return result.affected !== 0;
  }
}