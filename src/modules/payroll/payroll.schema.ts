import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type PayrollFrequency = 'daily' | 'weekly' | 'monthly' | 'per_service';
export type PayrollRunStatus = 'draft' | 'approved' | 'processing' | 'paid' | 'partially_paid' | 'cancelled';
export type PayrollItemStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface PayrollItem {
  providerId: string;
  providerName: string;
  monthlySalaryKobo: number;
  payFrequency: PayrollFrequency;
  payRateKobo: number;
  units: number;
  grossKobo: number;
  completedJobs: number;
  assignedJobs: number;
  completionRate: number;
  adjustmentKobo: number;
  deductionKobo: number;
  note: string;
  netKobo: number;
  status: PayrollItemStatus;
  transferReference: string | null;
  transferCode: string | null;
  paidAt: Date | null;
  failureReason: string | null;
}

@Schema(schemaOptions('payroll_runs'))
export class PayrollRun {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true })
  period: string;

  @Prop({ type: String, enum: ['daily', 'weekly', 'monthly', 'per_service'], default: 'monthly', index: true })
  frequency: PayrollFrequency;

  @Prop({ type: Date, required: true })
  periodStart: Date;

  @Prop({ type: Date, required: true })
  periodEnd: Date;

  @Prop({ type: String, enum: ['draft', 'approved', 'processing', 'paid', 'partially_paid', 'cancelled'], default: 'draft', index: true })
  status: PayrollRunStatus;

  @Prop({ type: [Object], default: [] })
  items: PayrollItem[];

  @Prop({ type: Number, default: 0 })
  totalKobo: number;

  @Prop({ type: String, default: null })
  createdBy: string | null;

  @Prop({ type: String, default: null })
  approvedBy: string | null;

  @Prop({ type: Date, default: null })
  approvedAt: Date | null;

  @Prop({ type: Date, default: null })
  paidAt: Date | null;
}

export type PayrollRunDocument = HydratedDocument<PayrollRun>;
export const PayrollRunSchema = SchemaFactory.createForClass(PayrollRun);
PayrollRunSchema.index({ businessId: 1, period: 1 });
