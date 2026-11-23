import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema(schemaOptions('customers'))
export class Customer {
  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, index: true })
  phone: string;

  @Prop({ type: String, default: null })
  email: string | null;

  @Prop({ type: String, default: '' })
  address: string;

  @Prop({ type: String, default: '' })
  notes: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: Number, default: 0 })
  totalSpentKobo: number;

  @Prop({ type: Number, default: 0 })
  outstandingKobo: number;

  @Prop({ type: Number, default: 0 })
  walletBalanceKobo: number;

  @Prop({ type: [Object], default: [] })
  walletTransactions: { amountKobo: number; type: string; reason: string; reference?: string; createdAt: Date }[];

  @Prop({ type: Number, default: 0 })
  orderCount: number;

  @Prop({ type: Date, default: null })
  lastPurchaseAt: Date | null;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
CustomerSchema.index({ businessId: 1, phone: 1 }, { unique: true });
CustomerSchema.index({ businessId: 1, name: 1 });
CustomerSchema.index({ businessId: 1, outstandingKobo: -1 });
