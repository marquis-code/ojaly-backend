import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type StorefrontConversationDocument = HydratedDocument<StorefrontConversation>;
export type StorefrontChatMessageDocument = HydratedDocument<StorefrontChatMessage>;

@Schema(schemaOptions('storefront_conversations'))
export class StorefrontConversation {
  createdAt: Date;
  updatedAt: Date;
  @Prop({ type: String, required: true, index: true }) businessId: string;
  @Prop({ type: String, required: true, unique: true, index: true }) publicToken: string;
  @Prop({ type: String, required: true }) visitorName: string;
  @Prop({ type: String, required: true, index: true }) visitorPhone: string;
  @Prop({ type: String, default: null }) visitorEmail: string | null;
  @Prop({ type: String, enum: ['product', 'service', 'general'], default: 'general' }) contextType: 'product' | 'service' | 'general';
  @Prop({ type: String, default: null }) contextId: string | null;
  @Prop({ type: String, default: '' }) contextName: string;
  @Prop({ type: String, enum: ['open', 'closed'], default: 'open', index: true }) status: 'open' | 'closed';
  @Prop({ type: Number, default: 0 }) unreadAdmin: number;
  @Prop({ type: Number, default: 0 }) unreadVisitor: number;
  @Prop({ type: Date, default: null }) lastMessageAt: Date | null;
  @Prop({ type: Date, default: null }) lastNotifiedAt: Date | null;
}
export const StorefrontConversationSchema = SchemaFactory.createForClass(StorefrontConversation);

@Schema(schemaOptions('storefront_chat_messages'))
export class StorefrontChatMessage {
  createdAt: Date;
  updatedAt: Date;
  @Prop({ type: String, required: true, index: true }) conversationId: string;
  @Prop({ type: String, enum: ['visitor', 'business'], required: true }) sender: 'visitor' | 'business';
  @Prop({ type: String, default: '' }) senderName: string;
  @Prop({ type: String, required: true }) body: string;
  @Prop({ type: Date, default: null }) readByAdminAt: Date | null;
  @Prop({ type: Date, default: null }) readByVisitorAt: Date | null;
}
export const StorefrontChatMessageSchema = SchemaFactory.createForClass(StorefrontChatMessage);
StorefrontChatMessageSchema.index({ conversationId: 1, createdAt: 1 });
