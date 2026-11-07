import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type SaleDocument = HydratedDocument<Sale>;
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

@Schema({ _id: false })
export class SaleItem {
  @Prop({ type: String, required: true })
  productId: string;

  @Prop({ type: String, default: null })
  variantId: string | null;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, default: '' })
  variantName: string;

  @Prop({ type: String, default: '' })
  sku: string;

  @Prop({ type: Number, required: true, min: 1 })
  quantity: number;

  @Prop({ type: Number, required: true })
  unitPriceKobo: number;

  @Prop({ type: Number, required: true })
  unitCostKobo: number;

  @Prop({ type: Number, default: 0 })
  discountKobo: number;

  @Prop({ type: Number, required: true })
  lineTotalKobo: number;

  @Prop({ type: Number, required: true })
  lineCostKobo: number;

  @Prop({ type: String, default: null })
  imageUrl: string | null;
}
export const SaleItemSchema = SchemaFactory.createForClass(SaleItem);

@Schema(schemaOptions('sales'))
export class Sale {
  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true })
  saleNumber: string;

  @Prop({ type: String, default: null })
  orderId: string | null;

  @Prop({ type: String, default: null, index: true })
  customerId: string | null;

  @Prop({ type: String, default: 'Walk-in customer' })
  customerName: string;

  @Prop({ type: String, default: '' })
  customerPhone: string;

  @Prop({ type: String, default: null })
  customerEmail: string | null;

  @Prop({ type: [SaleItemSchema], default: [] })
  items: SaleItem[];

  @Prop({ type: Number, required: true })
  subtotalKobo: number;

  @Prop({ type: Number, default: 0 })
  discountKobo: number;

  @Prop({ type: Number, default: 0 })
  deliveryFeeKobo: number;

  @Prop({ type: Number, required: true })
  totalKobo: number;

  @Prop({ type: Number, required: true })
  costKobo: number;

  @Prop({ type: Number, required: true })
  grossProfitKobo: number;

  @Prop({ type: Number, default: 0 })
  amountPaidKobo: number;

  @Prop({ type: String, enum: ['unpaid', 'partial', 'paid'], default: 'paid', index: true })
  paymentStatus: PaymentStatus;

  @Prop({ type: String, default: 'cash' })
  paymentMethod: string;

  @Prop({ type: String, default: null })
  debtId: string | null;

  @Prop({ type: String, default: null })
  receiptId: string | null;

  @Prop({ type: String, default: null, unique: true, sparse: true, index: true })
  chatToken: string | null;

  @Prop({ type: String, default: '' })
  notes: string;

  @Prop({ type: String, default: 'manual', index: true })
  source: string;

  @Prop({ type: Date, default: () => new Date(), index: true })
  soldAt: Date;

  @Prop({ type: String, default: null })
  createdBy: string | null;

  @Prop({ type: Boolean, default: false })
  stockRestored: boolean;
}

export const SaleSchema = SchemaFactory.createForClass(Sale);
SaleSchema.index({ businessId: 1, soldAt: -1 });
SaleSchema.index({ businessId: 1, paymentStatus: 1 });
SaleSchema.index({ businessId: 1, customerId: 1, soldAt: -1 });
SaleSchema.index({ businessId: 1, saleNumber: 1 }, { unique: true });
SaleSchema.index({ businessId: 1, 'items.productId': 1 });
