import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type ServiceDocument = HydratedDocument<Service>;

@Schema({ _id: false })
export class ServiceAddon {
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: Number, required: true })
  priceKobo: number;

  @Prop({ type: Number, default: 0 })
  durationMinutes: number;
}
export const ServiceAddonSchema = SchemaFactory.createForClass(ServiceAddon);

@Schema(schemaOptions('services'))
export class Service {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ type: String, default: 'Services', index: true })
  category: string;

  @Prop({ type: String, default: null })
  imageUrl: string | null;

  @Prop({ type: String, default: '#FF5A1F' })
  color: string;

  @Prop({ type: Number, required: true, min: 0, max: 1440 })
  durationMinutes: number;

  @Prop({ type: Boolean, default: true })
  showDuration: boolean;

  @Prop({ type: Boolean, default: false })
  quantityEnabled: boolean;

  @Prop({ type: String, default: 'Quantity' })
  quantityLabel: string;

  @Prop({ type: Number, default: 1, min: 1, max: 100 })
  minQuantity: number;

  @Prop({ type: Number, default: 20, min: 1, max: 100 })
  maxQuantity: number;

  @Prop({ type: Number, default: 0, min: 0 })
  workerPayKobo: number;

  @Prop({ type: Number, default: 0, min: 0, max: 240 })
  bufferBeforeMinutes: number;

  @Prop({ type: Number, default: 0, min: 0, max: 240 })
  bufferAfterMinutes: number;

  @Prop({ type: Number, required: true, min: 0 })
  priceKobo: number;

  @Prop({ type: Number, default: 0, min: 0 })
  depositKobo: number;

  @Prop({ type: Boolean, default: false })
  requiresDeposit: boolean;

  @Prop({ type: Number, default: 1, min: 1, max: 100 })
  maxBookingsPerSlot: number;

  @Prop({ type: [String], default: [] })
  providerIds: string[];

  @Prop({ type: [ServiceAddonSchema], default: [] })
  addOns: ServiceAddon[];

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: true })
  isPublic: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;
}

export const ServiceSchema = SchemaFactory.createForClass(Service);
ServiceSchema.index({ businessId: 1, isActive: 1, sortOrder: 1 });
ServiceSchema.index({ businessId: 1, category: 1 });
ServiceSchema.index({ businessId: 1, name: 1 });
