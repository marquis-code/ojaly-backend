import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type ReviewDocument = HydratedDocument<Review>;
export type ReviewStatus = 'published' | 'pending' | 'hidden';

@Schema(schemaOptions('reviews'))
export class Review {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  bookingId: string;

  @Prop({ type: String, required: true })
  serviceId: string;

  @Prop({ type: String, required: true })
  serviceName: string;

  @Prop({ type: String, default: null, index: true })
  providerId: string | null;

  @Prop({ type: String, default: null })
  providerName: string | null;

  @Prop({ type: String, default: null })
  customerId: string | null;

  @Prop({ type: String, required: true })
  customerName: string;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ type: String, default: '' })
  comment: string;

  @Prop({ type: Object, default: {} })
  categoryRatings: { quality?: number; punctuality?: number; communication?: number; value?: number };

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: Boolean, default: null })
  wouldRecommend: boolean | null;

  @Prop({ type: String, default: '' })
  vendorReply: string;

  @Prop({ type: Date, default: null })
  vendorRepliedAt: Date | null;


  @Prop({ type: String, required: true, unique: true, index: true })
  publicToken: string;

  @Prop({ type: String, enum: ['published', 'pending', 'hidden'], default: 'published', index: true })
  status: ReviewStatus;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ businessId: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ businessId: 1, serviceId: 1, status: 1 });
