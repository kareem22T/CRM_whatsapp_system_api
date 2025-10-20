import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToMany } from 'typeorm';
import { Campaign } from './Campaign';

@Entity('message_templates')
export class MessageTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'nvarchar', length: 255 })
  name: string;

  @Column({ type: "nvarchar", length: 255 })
  message: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  imageFilename: string | null;

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  imageMimetype: string | null;

  @Column({ type: 'int', nullable: true })
  imageSize: number | null;

  @Column({ type: 'varbinary', length: 'max', nullable: true  })
  imageData: Buffer | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToMany(() => Campaign, campaign => campaign.templates)
  campaigns: Campaign[];
}