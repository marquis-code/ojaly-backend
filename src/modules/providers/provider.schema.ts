import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type ProviderDocument = HydratedDocument<Provider>;

@Schema({ _id: false })
export class ScheduleBreak {
  @Prop({ type: String, required: true })
  start: string;

  @Prop({ type: String, required: true })
  end: string;
}

@Schema({ _id: false })
export class ProviderDay {
  @Prop({ type: Number, required: true, min: 0, max: 6 })
  day: number;

  @Prop({ type: Boolean, default: true })
  isWorking: boolean;

  @Prop({ type: String, default: '09:00' })
  start: string;

  @Prop({ type: String, default: '18:00' })
  end: string;

  @Prop({ type: [ScheduleBreak], default: [] })
  breaks: ScheduleBreak[];
}

@Schema({ _id: false })
export class ProviderTimeOff {
  @Prop({ type: Date, required: true })
  startAt: Date;

  @Prop({ type: Date, required: true })
  endAt: Date;

  @Prop({ type: String, default: 'Time off' })
  reason: string;
}

@Schema(schemaOptions('providers'))
export class Provider {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '' })
  title: string;

  @Prop({ type: String, default: '' })
  bio: string;

  @Prop({ type: String, default: null })
  email: string | null;

  @Prop({ type: String, default: null })
  phone: string | null;

  @Prop({ type: String, default: null })
  avatarUrl: string | null;

  @Prop({ type: String, default: '#FF5A1F' })
  color: string;

  @Prop({ type: String, default: null })
  userId: string | null;

  @Prop({ type: String, default: null })
  membershipId: string | null;

  @Prop({ type: [ProviderDay], default: [] })
  weeklySchedule: ProviderDay[];

  @Prop({ type: [ProviderTimeOff], default: [] })
  timeOff: ProviderTimeOff[];

  @Prop({ type: Boolean, default: true, index: true })
  isBookable: boolean;

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  @Prop({ type: Boolean, default: false })
  salaryEnabled: boolean;

  @Prop({ type: String, enum: ['daily', 'weekly', 'monthly', 'per_service'], default: 'monthly' })
  payFrequency: 'daily' | 'weekly' | 'monthly' | 'per_service';

  @Prop({ type: Number, default: 0, min: 0 })
  payRateKobo: number;

  @Prop({ type: Number, default: 0, min: 0 })
  monthlySalaryKobo: number;

  @Prop({ type: String, default: null })
  salaryStartDate: string | null;

  @Prop({ type: String, default: null })
  bankName: string | null;

  @Prop({ type: String, default: null })
  bankCode: string | null;

  @Prop({ type: String, default: null })
  accountNumber: string | null;

  @Prop({ type: String, default: null })
  accountName: string | null;

  @Prop({ type: String, default: null })
  paystackRecipientCode: string | null;

}

export const ProviderSchema = SchemaFactory.createForClass(Provider);
ProviderSchema.index({ businessId: 1, isActive: 1, sortOrder: 1 });
ProviderSchema.index({ businessId: 1, name: 1 });
