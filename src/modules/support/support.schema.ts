import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type SupportConversationDocument = HydratedDocument<SupportConversation>;
export type SupportMessageDocument = HydratedDocument<SupportMessage>;

@Schema(schemaOptions('support_conversations'))
export class SupportConversation {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, unique: true, index: true })
  publicToken: string;

  @Prop({ type: String, required: true })
  visitorName: string;

  @Prop({ type: String, required: true, index: true })
  visitorEmail: string;

  @Prop({ type: String, required: true })
  visitorPhone: string;

  @Prop({ type: String, enum: ['open', 'closed'], default: 'open', index: true })
  status: 'open' | 'closed';

  @Prop({ type: Number, default: 0 })
  unreadAdmin: number;

  @Prop({ type: Number, default: 0 })
  unreadVisitor: number;

  @Prop({ type: Date, default: null })
  lastMessageAt: Date | null;
}

export const SupportConversationSchema = SchemaFactory.createForClass(SupportConversation);

@Schema(schemaOptions('support_messages'))
export class SupportMessage {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  conversationId: string;

  @Prop({ type: String, enum: ['visitor', 'admin'], required: true })
  sender: 'visitor' | 'admin';

  @Prop({ type: String, default: '' })
  senderName: string;

  @Prop({ type: String, required: true })
  body: string;

  @Prop({ type: Date, default: null })
  readByAdminAt: Date | null;

  @Prop({ type: Date, default: null })
  readByVisitorAt: Date | null;
}

export const SupportMessageSchema = SchemaFactory.createForClass(SupportMessage);
SupportMessageSchema.index({ conversationId: 1, createdAt: 1 });
