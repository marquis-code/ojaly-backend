import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type BookingMessageDocument = HydratedDocument<BookingMessage>;
export type BookingMessageSender = 'customer' | 'business';

@Schema(schemaOptions('booking_messages'))
export class BookingMessage {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true, index: true })
  bookingId: string;

  @Prop({ type: String, required: true })
  bookingNumber: string;

  @Prop({ type: String, enum: ['customer', 'business'], required: true })
  sender: BookingMessageSender;

  @Prop({ type: String, default: '' })
  senderName: string;

  @Prop({ type: String, required: true })
  body: string;

  @Prop({ type: [String], default: [] })
  attachments: string[];

  @Prop({ type: Date, default: null })
  readByBusinessAt: Date | null;

  @Prop({ type: Date, default: null })
  readByCustomerAt: Date | null;

  @Prop({ type: Boolean, default: false })
  redacted: boolean;
}

export const BookingMessageSchema = SchemaFactory.createForClass(BookingMessage);
BookingMessageSchema.index({ bookingId: 1, createdAt: 1 });
BookingMessageSchema.index({ businessId: 1, createdAt: -1 });
