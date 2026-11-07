import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type PromotionDocument = HydratedDocument<Promotion>;

@Schema(schemaOptions('promotions'))
export class Promotion {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, unique: true, default: 'new_customer' })
  key: string;

  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  @Prop({ type: Number, default: 10, min: 0, max: 100 })
  percentOff: number;

  @Prop({ type: Number, default: 0, min: 0 })
  maxDiscountKobo: number;

  @Prop({ type: String, default: '10% off everything' })
  label: string;

  @Prop({ type: String, default: 'Ojaly is giving every customer 10% off every order and booking.' })
  bannerText: string;

  @Prop({ type: String, default: '10% OFF' })
  badgeText: string;
}

export const PromotionSchema = SchemaFactory.createForClass(Promotion);
