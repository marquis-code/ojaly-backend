import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type StorefrontVisitDocument = HydratedDocument<StorefrontVisit>;

@Schema(schemaOptions('storefront_visits'))
export class StorefrontVisit {
  createdAt: Date;
  updatedAt: Date;
  @Prop({ type: String, required: true, index: true }) businessId: string;
  @Prop({ type: String, required: true, index: true }) visitorId: string;
  @Prop({ type: String, default: '/' }) path: string;
  @Prop({ type: String, default: 'direct' }) source: string;
  @Prop({ type: String, default: '' }) referrer: string;
  @Prop({ type: String, default: '' }) device: string;
  @Prop({ type: String, default: '' }) userAgent: string;
}
export const StorefrontVisitSchema = SchemaFactory.createForClass(StorefrontVisit);
StorefrontVisitSchema.index({ businessId: 1, createdAt: -1 });
StorefrontVisitSchema.index({ businessId: 1, visitorId: 1, createdAt: -1 });
