import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type BookingDocument = HydratedDocument<Booking>;
export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export type BookingPaymentStatus = 'unpaid' | 'deposit_paid' | 'paid' | 'refunded';
export type BookingSource = 'storefront' | 'dashboard' | 'whatsapp' | 'walk_in' | 'marketplace';

@Schema({ _id: false })
export class BookingAddon {
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: Number, required: true })
  priceKobo: number;

  @Prop({ type: Number, default: 0 })
  durationMinutes: number;
}
export const BookingAddonSchema = SchemaFactory.createForClass(BookingAddon);

@Schema({ _id: false })
export class BookingHistory {
  @Prop({ type: String, required: true })
  status: string;

  @Prop({ type: Date, default: () => new Date() })
  at: Date;

  @Prop({ type: String, default: null })
  by: string | null;

  @Prop({ type: String, default: '' })
  note: string;
}
export const BookingHistorySchema = SchemaFactory.createForClass(BookingHistory);

@Schema(schemaOptions('bookings'))
export class Booking {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true })
  bookingNumber: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  publicToken: string;

  @Prop({ type: String, required: true, index: true })
  serviceId: string;

  @Prop({ type: String, required: true })
  serviceName: string;

  @Prop({ type: String, default: '' })
  serviceCategory: string;

  @Prop({ type: String, default: null })
  serviceImageUrl: string | null;

  @Prop({ type: String, required: true, index: true })
  providerId: string;

  @Prop({ type: String, required: true })
  providerName: string;

  @Prop({ type: String, default: null })
  providerAvatarUrl: string | null;

  @Prop({ type: String, default: null })
  providerColor: string | null;

  @Prop({ type: String, default: null, index: true })
  customerId: string | null;

  @Prop({ type: String, required: true })
  customerName: string;

  @Prop({ type: String, required: true, index: true })
  customerPhone: string;

  @Prop({ type: String, default: null })
  customerEmail: string | null;

  @Prop({ type: Date, required: true, index: true })
  startAt: Date;

  @Prop({ type: Date, required: true })
  endAt: Date;

  /** Includes service buffers; used for overlap checks. */
  @Prop({ type: Date, required: true })
  blockStartAt: Date;

  @Prop({ type: Date, required: true })
  blockEndAt: Date;

  @Prop({ type: Number, required: true })
  durationMinutes: number;

  @Prop({ type: Number, default: 1 })
  capacity: number;

  @Prop({ type: String, default: null, index: true })
  packagePurchaseId: string | null;

  @Prop({ type: String, default: null })
  packageCode: string | null;

  @Prop({ type: String, default: null })
  packageName: string | null;

  @Prop({ type: String, default: null, index: true })
  marketplaceCampus: string | null;

  @Prop({ type: String, default: null, index: true })
  customRequestId: string | null;

  @Prop({ type: Number, default: 0 })
  marketplaceFeePercent: number;

  @Prop({ type: Number, default: 0 })
  marketplaceFeeKobo: number;

  @Prop({ type: Number, default: 0 })
  packageValueKobo: number;

  @Prop({ type: Number, default: 0 })
  bufferBeforeMinutes: number;

  @Prop({ type: Number, default: 0 })
  bufferAfterMinutes: number;

  @Prop({ type: String, default: 'Africa/Lagos' })
  timezone: string;

  @Prop({ type: [BookingAddonSchema], default: [] })
  addOns: BookingAddon[];

  @Prop({ type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'], default: 'pending', index: true })
  status: BookingStatus;

  @Prop({ type: String, enum: ['storefront', 'dashboard', 'whatsapp', 'walk_in', 'marketplace'], default: 'dashboard' })
  source: BookingSource;

  @Prop({ type: String, default: '' })
  notes: string;

  @Prop({ type: String, default: '' })
  location: string;

  @Prop({ type: Number, default: 0 })
  subtotalKobo: number;

  @Prop({ type: Number, default: 0 })
  serviceChargeKobo: number;

  @Prop({ type: Number, default: 0 })
  serviceChargePercent: number;

  @Prop({ type: Number, default: 0 })
  discountKobo: number;

  @Prop({ type: String, default: null })
  promotionLabel: string | null;

  @Prop({ type: Number, default: 0 })
  providerFeeKobo: number;

  @Prop({ type: Number, default: 0 })
  providerFeePercent: number;

  @Prop({ type: Number, default: 0 })
  providerNetKobo: number;

  @Prop({ type: Number, required: true })
  priceKobo: number;

  @Prop({ type: Number, default: 0 })
  depositKobo: number;

  @Prop({ type: Number, default: 0 })
  amountPaidKobo: number;

  @Prop({ type: Number, default: 0 })
  refundedKobo: number;

  @Prop({ type: String, enum: ['unpaid', 'deposit_paid', 'paid', 'refunded'], default: 'unpaid', index: true })
  paymentStatus: BookingPaymentStatus;

  @Prop({ type: String, default: null, index: true })
  seriesId: string | null;

  @Prop({ type: Number, default: 0 })
  seriesIndex: number;

  @Prop({ type: Number, default: 1 })
  seriesTotal: number;

  @Prop({ type: String, default: null })
  paymentReference: string | null;

  @Prop({ type: String, default: null })
  saleId: string | null;

  @Prop({ type: String, default: null })
  cancellationReason: string | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: Date, default: null })
  reminderSentAt: Date | null;

  @Prop({ type: Date, default: null })
  confirmationSentAt: Date | null;

  @Prop({ type: String, default: null })
  reviewToken: string | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  @Prop({ type: String, default: null })
  createdBy: string | null;

  @Prop({ type: [BookingHistorySchema], default: [] })
  history: BookingHistory[];
}

export const BookingSchema = SchemaFactory.createForClass(Booking);
BookingSchema.index({ businessId: 1, startAt: 1 });
BookingSchema.index({ businessId: 1, status: 1, startAt: 1 });
BookingSchema.index({ businessId: 1, providerId: 1, blockStartAt: 1, blockEndAt: 1 });
BookingSchema.index({ businessId: 1, customerPhone: 1, startAt: -1 });
BookingSchema.index({ businessId: 1, bookingNumber: 1 }, { unique: true });
BookingSchema.index({ reviewToken: 1 }, { unique: true, partialFilterExpression: { reviewToken: { $type: 'string' } } });
