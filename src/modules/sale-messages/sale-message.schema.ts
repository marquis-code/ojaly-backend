import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type SaleMessageDocument = HydratedDocument<SaleMessage>;
export interface SaleAttachment { url: string; type: 'image' | 'audio'; }

@Schema(schemaOptions('sale_messages'))
export class SaleMessage {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true }) businessId: string;
  @Prop({ type: String, required: true, index: true }) saleId: string;
  @Prop({ type: String, required: true }) saleNumber: string;
  @Prop({ type: String, enum: ['customer', 'business'], required: true }) sender: 'customer' | 'business';
  @Prop({ type: String, default: '' }) senderName: string;
  @Prop({ type: String, default: '' }) body: string;
  @Prop({ type: [Object], default: [] }) attachments: SaleAttachment[];
  @Prop({ type: Date, default: null }) readByBusinessAt: Date | null;
  @Prop({ type: Date, default: null }) readByCustomerAt: Date | null;
}

export const SaleMessageSchema = SchemaFactory.createForClass(SaleMessage);
SaleMessageSchema.index({ saleId: 1, createdAt: 1 });
SaleMessageSchema.index({ businessId: 1, createdAt: -1 });
