import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type PaymentDocument = HydratedDocument<Payment>;
export type PaymentPurpose = 'order' | 'debt' | 'subscription' | 'invoice' | 'booking' | 'package' | 'waitlist';
export type PaymentStatus = 'pending' | 'processing' | 'success' | 'failed' | 'abandoned' | 'reversed';

@Schema(schemaOptions('payments'))
export class Payment {
  createdAt: Date;
  updatedAt: Date;
  @Prop({ type: String, required: true, unique: true, index: true })
  reference: string;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, enum: ['order', 'debt', 'subscription', 'invoice', 'booking', 'package', 'waitlist'], required: true })
  purpose: PaymentPurpose;

  @Prop({ type: String, default: null })
  orderId: string | null;

  @Prop({ type: String, default: null })
  debtId: string | null;

  @Prop({ type: String, default: null })
  invoiceId: string | null;

  @Prop({ type: String, default: null })
  bookingId: string | null;

  @Prop({ type: String, default: null })
  packagePurchaseId: string | null;

  @Prop({ type: String, default: null })
  waitlistId: string | null;

  @Prop({ type: String, default: null })
  subscriptionId: string | null;

  @Prop({ type: Number, required: true })
  amountKobo: number;

  @Prop({ type: String, default: null })
  email: string | null;

  @Prop({ type: String, default: 'NGN' })
  currency: string;

  @Prop({
    type: String,
    enum: ['pending', 'processing', 'success', 'failed', 'abandoned', 'reversed'],
    default: 'pending',
    index: true,
  })
  status: PaymentStatus;

  @Prop({ type: String, default: null })
  authorizationUrl: string | null;

  @Prop({ type: String, default: null })
  accessCode: string | null;

  @Prop({ type: String, default: null })
  channel: string | null;

  @Prop({ type: Date, default: null })
  paidAt: Date | null;

  @Prop({ type: String, default: null })
  createdBy: string | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ type: String, default: null })
  providerTransactionId: string | null;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ businessId: 1, createdAt: -1 });
PaymentSchema.index({ businessId: 1, purpose: 1, status: 1 });
