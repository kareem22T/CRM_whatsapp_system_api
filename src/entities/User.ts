import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  OneToMany 
} from 'typeorm';
import { Session } from './Session';

export enum UserRole {
  ADMIN = 'admin',
  AGENT = 'agent',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "nvarchar", length: 255, unique: true })
  email: string;

  @Column({ type: 'nvarchar', length: 255 })
  password: string;

  @Column({ type: 'nvarchar', length: 255 })
  name: string;

  @Column({
    type: 'nvarchar',
    default: UserRole.AGENT,
  })
  role: UserRole;

  @Column({ type: 'bit', default: true })
  isActive: boolean;

  @Column({ type: "datetime", nullable: true })
  lastLoginAt: Date;

  @OneToMany(() => Session, (session) => session.user)
  sessions: Session[];

  @CreateDateColumn({ type: 'datetime2', default: () => 'GETDATE()' })
    createdAt: Date;

  @CreateDateColumn({ type: 'datetime2', default: () => 'GETDATE()' })
    updatedAt: Date;
}
