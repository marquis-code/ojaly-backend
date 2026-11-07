import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type RiskEventDocument = HydratedDocument<RiskEvent>;
export type RiskAction = 'allow' | 'review' | 'block';

@Schema(schemaOptions('risk_events'))
export class RiskEvent {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, enum: ['booking', 'order', 'payment'], default: 'booking', index: true })
  kind: 'booking' | 'order' | 'payment';

  @Prop({ type: String, required: true })
  reference: string;

  @Prop({ type: String, default: null })
  customerPhone: string | null;

  @Prop({ type: String, default: null })
  customerEmail: string | null;

  @Prop({ type: Number, default: 0 })
  score: number;

  @Prop({ type: [String], default: [] })
  flags: string[];

  @Prop({ type: String, enum: ['allow', 'review', 'block'], default: 'review', index: true })
  action: RiskAction;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const RiskEventSchema = SchemaFactory.createForClass(RiskEvent);
RiskEventSchema.index({ businessId: 1, createdAt: -1 });
