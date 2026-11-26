import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';
export type WithdrawalDocument = HydratedDocument<WithdrawalRequest>;
export type WithdrawalStatus = 'pending' | 'approved' | 'paid' | 'rejected';
@Schema(schemaOptions('withdrawal_requests'))
export class WithdrawalRequest {
  createdAt: Date; updatedAt: Date;
  @Prop({ type: String, required: true, index: true }) businessId: string;
  @Prop({ type: Number, required: true }) amountKobo: number;
  @Prop({ type: String, enum: ['pending', 'approved', 'paid', 'rejected'], default: 'pending', index: true }) status: WithdrawalStatus;
  @Prop({ type: String, required: true }) bankName: string;
  @Prop({ type: String, required: true }) bankCode: string;
  @Prop({ type: String, required: true }) accountNumber: string;
  @Prop({ type: String, required: true }) accountName: string;
  @Prop({ type: String, default: '' }) note: string;
  @Prop({ type: String, default: '' }) adminNote: string;
  @Prop({ type: String, default: null }) reference: string | null;
  @Prop({ type: String, required: true }) requestedBy: string;
  @Prop({ type: String, default: null }) processedBy: string | null;
  @Prop({ type: Date, default: null }) processedAt: Date | null;
}
export const WithdrawalSchema = SchemaFactory.createForClass(WithdrawalRequest);
WithdrawalSchema.index({ businessId: 1, status: 1, createdAt: -1 });
