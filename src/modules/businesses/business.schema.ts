import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type BusinessDocument = HydratedDocument<Business>;
export type BusinessMode = 'products' | 'services' | 'hybrid';

export interface WeeklyHours {
  day: number;
  isOpen: boolean;
  start: string;
  end: string;
}

export interface BookingSettings {
  enabled: boolean;
  autoConfirm: boolean;
  leadTimeMinutes: number;
  windowDays: number;
  slotIntervalMinutes: number;
  cancellationWindowHours: number;
  depositPercent: number;
  paymentCollection: 'deposit' | 'full';
  reminderHoursBefore: number;
  weeklyHours: WeeklyHours[];
  closedDates: string[];
  policy: string;
}

const defaultWeeklyHours: WeeklyHours[] = [
  { day: 1, isOpen: true, start: '09:00', end: '18:00' },
  { day: 2, isOpen: true, start: '09:00', end: '18:00' },
  { day: 3, isOpen: true, start: '09:00', end: '18:00' },
  { day: 4, isOpen: true, start: '09:00', end: '18:00' },
  { day: 5, isOpen: true, start: '09:00', end: '18:00' },
  { day: 6, isOpen: true, start: '09:00', end: '18:00' },
  { day: 0, isOpen: false, start: '09:00', end: '18:00' },
];

export const defaultBookingSettings = (): BookingSettings => ({
  enabled: false,
  autoConfirm: true,
  leadTimeMinutes: 120,
  windowDays: 60,
  slotIntervalMinutes: 30,
  cancellationWindowHours: 24,
  depositPercent: 0,
  paymentCollection: 'deposit',
  reminderHoursBefore: 24,
  weeklyHours: defaultWeeklyHours,
  closedDates: [],
  policy: 'Please arrive 5 minutes early. Cancellations within 24 hours may lose the deposit.',
});

export interface SocialLinks {
  instagram?: string;
  twitter?: string;
  tiktok?: string;
  facebook?: string;
  website?: string;
}

export interface LookbookItem {
  url: string;
  caption?: string;
}

export interface SummarySettings {
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  sendTime: string;
  weeklyDay: number;
  channels: { whatsapp: boolean; email: boolean };
}

@Schema(schemaOptions('businesses'))
export class Business {
  createdAt: Date;
  updatedAt: Date;
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, unique: true, lowercase: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, index: true })
  ownerId: string;

  @Prop({ type: String, default: 'other' })
  category: string;

  @Prop({ type: String, enum: ['products', 'services', 'hybrid'], default: 'products', index: true })
  businessMode: BusinessMode;

  @Prop({ type: Object, default: () => defaultBookingSettings() })
  bookingSettings: BookingSettings;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ type: String, default: '₦' })
  currency: string;

  @Prop({ type: String, default: 'Africa/Lagos' })
  timezone: string;

  @Prop({ type: String, default: null })
  logoUrl: string | null;

  @Prop({ type: String, default: null })
  bannerUrl: string | null;

  @Prop({ type: String, default: null })
  heroVideoUrl: string | null;

  @Prop({ type: String, default: null })
  storyImageUrl: string | null;

  @Prop({ type: String, default: 'The lookbook' })
  lookbookTitle: string;

  @Prop({ type: [Object], default: [] })
  lookbook: LookbookItem[];

  @Prop({ type: String, default: 'We sell the good stuff.' })
  tagline: string;

  @Prop({ type: String, default: '#FF5A1F' })
  brandColor: string;

  @Prop({ type: String, default: 'lagos-pop' })
  templateKey: string;

  @Prop({ type: [String], default: ['hero', 'featured', 'story', 'lookbook', 'categories', 'products', 'contact'] })
  sections: string[];

  @Prop({ type: Object, default: {} })
  socialLinks: SocialLinks;

  @Prop({ type: String, default: null })
  publicPhone: string | null;

  @Prop({ type: String, default: null })
  whatsappNumber: string | null;

  @Prop({ type: String, default: null })
  email: string | null;

  @Prop({ type: String, default: '' })
  address: string;

  @Prop({ type: String, default: '' })
  about: string;

  @Prop({ type: Boolean, default: false })
  storefrontPublished: boolean;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ type: String, default: '' })
  seoTitle: string;

  @Prop({ type: String, default: '' })
  seoDescription: string;

  @Prop({ type: String, default: null })
  customDomain: string | null;

  @Prop({ type: String, default: null })
  calendarToken: string | null;

  @Prop({ type: String, default: null, index: true })
  campusCode: string | null;

  @Prop({ type: String, default: null })
  campusName: string | null;

  @Prop({ type: String, default: null, index: true })
  campusAmbassadorCode: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  isDemo: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  campusVerified: boolean;

  @Prop({ type: Date, default: null })
  verificationRequestedAt: Date | null;

  @Prop({ type: Date, default: null })
  campusVerifiedAt: Date | null;

  @Prop({ type: Number, default: 5, min: 0, max: 30 })
  marketplaceFeePercent: number;

  @Prop({ type: Boolean, default: false })
  serviceChargeEnabled: boolean;

  @Prop({ type: String, enum: ['percent', 'fixed'], default: 'percent' })
  serviceChargeType: 'percent' | 'fixed';

  @Prop({ type: Number, default: 0, min: 0 })
  serviceChargePercent: number;

  @Prop({ type: Number, default: 0, min: 0 })
  serviceChargeFixedKobo: number;

  @Prop({ type: Boolean, default: false })
  providerFeeEnabled: boolean;

  @Prop({ type: String, enum: ['percent', 'fixed'], default: 'percent' })
  providerFeeType: 'percent' | 'fixed';

  @Prop({ type: Number, default: 0, min: 0 })
  providerFeePercent: number;

  @Prop({ type: Number, default: 0, min: 0 })
  providerFeeFixedKobo: number;

  @Prop({ type: Boolean, default: false })
  customDomainVerified: boolean;

  @Prop({ type: String, default: null })
  embedKey: string | null;

  @Prop({
    type: Object,
    default: {
      dailyEnabled: true,
      weeklyEnabled: true,
      sendTime: '20:00',
      weeklyDay: 1,
      channels: { whatsapp: true, email: true },
    },
  })
  summarySettings: SummarySettings;

  @Prop({
    type: Object,
    default: {
      lowStockInApp: true,
      lowStockEmail: true,
      lowStockWhatsapp: true,
      debtReminders: true,
      reminderDaysBefore: 2,
      repeatOverdueEveryDays: 7,
    },
  })
  alertSettings: Record<string, unknown>;

  @Prop({ type: Number, default: 0 })
  onboardingStep: number;

  @Prop({ type: Boolean, default: false })
  isSuspended: boolean;

  @Prop({ type: Date, default: null })
  firstProductAt: Date | null;

  @Prop({ type: Date, default: null })
  firstSaleAt: Date | null;

  @Prop({ type: Date, default: null })
  firstProfitAt: Date | null;

  @Prop({ type: [String], default: [] })
  categories: string[];

  @Prop({ type: Date, default: null })
  lastDailySummaryAt: Date | null;

  @Prop({ type: Date, default: null })
  lastWeeklySummaryAt: Date | null;
}

export const BusinessSchema = SchemaFactory.createForClass(Business);
BusinessSchema.index({ createdAt: -1 });
BusinessSchema.index({ storefrontPublished: 1, slug: 1 });
BusinessSchema.index({ customDomain: 1 }, { sparse: true });
BusinessSchema.index({ businessMode: 1, storefrontPublished: 1 });
