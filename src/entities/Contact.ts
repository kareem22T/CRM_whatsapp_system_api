import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToMany, JoinTable, Index, OneToMany } from 'typeorm';
import { Campaign } from './Campaign';

@Entity('contact_groups')
@Index(['name'])
@Index(['isActive'])
export class ContactGroup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ type: 'nvarchar', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  color: string;

  @Column({ type: 'bit', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToMany(() => Contact, contact => contact.groups)
  contacts: Contact[];

  // FIXED: Changed from @ManyToMany to @OneToMany since Campaign has @ManyToOne
  @OneToMany(() => Campaign, campaign => campaign.contactGroup)
  campaigns: Campaign[];
}

@Entity('contacts')
@Index(['name'])
@Index(['email'])
@Index(['phone'])
@Index(['company'])
@Index(['isActive'])
@Index(['isChecked'])
@Index(['isWpContact'])
export class Contact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  name: string;

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  email: string;

  @Column({ type: 'nvarchar', length: 50, default: '' })
  phone: string;

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  company: string;

  @Column({ type: 'nvarchar', nullable: true })
  notes: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  position: string;

  @Column({ type: 'nvarchar', length: 255, nullable: true })
  avatar: string;

  @Column({ type: 'bit', default: true, name: 'is_active' })
  isActive: boolean;

  // NEW: WhatsApp verification fields
  @Column({ type: 'bit', default: false, name: 'is_checked', comment: 'Whether this contact has been checked for WhatsApp' })
  isChecked: boolean;

  @Column({ type: 'bit', default: false, name: 'is_wp_contact', comment: 'Whether this contact has a WhatsApp account' })
  isWpContact: boolean;

  @Column({ type: 'datetime', nullable: true, name: 'checked_at', comment: 'When the WhatsApp verification was performed' })
  checkedAt: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'checked_by_session', comment: 'Which session performed the check' })
  checkedBySession: string | null;

  @Column({ type: 'datetime', nullable: true, name: 'last_contacted' })
  lastContacted: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToMany(() => ContactGroup, group => group.contacts)
  @JoinTable({
    name: 'contact_group_members',
    joinColumn: { name: 'contact_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'group_id', referencedColumnName: 'id' }
  })
  groups: ContactGroup[];

  // Helper methods
  get needsVerification(): boolean {
    return !this.isChecked;
  }

  get isVerifiedWhatsAppUser(): boolean {
    return this.isChecked && this.isWpContact;
  }
}