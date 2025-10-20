import { MessageTemplateRepository } from '../repositories/MessageTemplateRepository';
import { MessageTemplate } from '../entities/MessageTemplate';

export class MessageTemplateService {
  private templateRepository: MessageTemplateRepository;

  constructor() {
    this.templateRepository = new MessageTemplateRepository();
  }

  // Create template with optional image
  async createTemplate(data: {
    name: string;
    message: string;
    imageFile?: {
      filename: string;
      mimetype: string;
      size: number;
      data: Buffer;
    };
  }): Promise<MessageTemplate> {
    const existing = await this.templateRepository.findOne({ where: { name: data.name } });
    if (existing) {
      throw new Error('Template with this name already exists');
    }

    return this.templateRepository.createTemplate(
      data.name,
      data.message,
      data.imageFile
    );
  }

  // Get all templates (without image data for performance)
  async getAllTemplates(): Promise<Array<Partial<MessageTemplate>>> {
    const templates = await this.templateRepository.find({
      select: ['id', 'name', 'message', 'imageFilename', 'imageMimetype', 'imageSize', 'createdAt', 'updatedAt'],
      order: { createdAt: 'DESC' }
    });
    return templates;
  }

  // Get template by ID (with image data)
  async getTemplateById(id: number): Promise<MessageTemplate | null> {
    return this.templateRepository.getTemplateById(id);
  }

  // Get template without image data (for list views)
  async getTemplateByIdLean(id: number): Promise<Partial<MessageTemplate> | null> {
    return this.templateRepository.getTemplateByIdLean(id);
  }

    async updateTemplate(
    id: number,
    updates: {
      name?: string;
      message?: string;
      imageFile?: {
        filename: string;
        mimetype: string;
        size: number;
        data: Buffer;
      };
    }
  ): Promise<MessageTemplate | null> {
    if (updates.name) {
      const existing = await this.templateRepository.findOne({ where: { name: updates.name } });
      if (existing && existing.id !== id) {
        throw new Error('Template with this name already exists');
      }
    }

    const updateData = {
      ...(updates.name && { name: updates.name }),
      ...(updates.message && { message: updates.message }),
      ...(updates.imageFile && { imageData: {
        filename: updates.imageFile.filename,
        mimetype: updates.imageFile.mimetype,
        size: updates.imageFile.size,
        data: updates.imageFile.data
      }})
    }

    return this.templateRepository.updateTemplate(id, updateData);
  }

  // Remove image from template
  async removeImage(id: number): Promise<MessageTemplate | null> {
    return this.templateRepository.removeImage(id);
  }

  // Delete template
  async deleteTemplate(id: number): Promise<boolean> {
    return this.templateRepository.deleteTemplate(id);
  }

  // Get template with image (for campaign sending)
  async getTemplateWithImage(id: number): Promise<{
    id: number;
    name: string;
    message: string;
    hasImage: boolean;
    imageFilename?: string | null;
    imageMimetype?: string | null;
    imageSize?: number | null;
    imageData?: Buffer | null;
  } | null> {
    const template = await this.templateRepository.getTemplateById(id);
    if (!template) return null;

    return {
      id: template.id,
      name: template.name,
      message: template.message,
      hasImage: !!template.imageData,
      ...(template.imageData && {
        imageFilename: template.imageFilename,
        imageMimetype: template.imageMimetype,
        imageSize: template.imageSize,
        imageData: template.imageData
      })
    };
  }
}