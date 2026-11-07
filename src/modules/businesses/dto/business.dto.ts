import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BUSINESS_CATEGORY_KEYS } from '../business.constants';
import { ALL_PERMISSIONS } from '../../../common/constants/permissions';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const cleanUrl = ({ value }: { value: unknown }) => (value === '' ? null : value);

export class SocialLinksDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: false })
  @MaxLength(200)
  instagram?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: false })
  @MaxLength(200)
  twitter?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: false })
  @MaxLength(200)
  tiktok?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: false })
  @MaxLength(200)
  facebook?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: false })
  @MaxLength(200)
  website?: string;
}

export class SummaryChannelsDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  whatsapp?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  email?: boolean;
}

export class SummarySettingsDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  dailyEnabled?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  weeklyEnabled?: boolean;

  @ApiPropertyOptional({ example: '20:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Send time must use HH:MM (24 hour).' })
  @IsOptional()
  sendTime?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  weeklyDay?: number;

  @ApiPropertyOptional()
  @ValidateNested()
  @Type(() => SummaryChannelsDto)
  @IsOptional()
  channels?: SummaryChannelsDto;
}

export class AlertSettingsDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  lowStockInApp?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  lowStockEmail?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  lowStockWhatsapp?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  debtReminders?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 30 })
  @IsInt()
  @Min(0)
  @Max(30)
  @IsOptional()
  reminderDaysBefore?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 30 })
  @IsInt()
  @Min(1)
  @Max(30)
  @IsOptional()
  repeatOverdueEveryDays?: number;
}

export class LookbookItemDto {
  @ApiProperty()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  url: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(160)
  caption?: string;
}

export class WeeklyHoursDto {
  @ApiProperty({ minimum: 0, maximum: 6, example: 1 })
  @IsInt()
  @Min(0)
  @Max(6)
  day: number;

  @ApiProperty()
  @IsBoolean()
  isOpen: boolean;

  @ApiProperty({ example: '09:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Opening time must use HH:MM.' })
  start: string;

  @ApiProperty({ example: '18:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Closing time must use HH:MM.' })
  end: string;
}

export class BookingSettingsDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  autoConfirm?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 10080 })
  @IsInt()
  @Min(0)
  @Max(10080)
  @IsOptional()
  leadTimeMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  windowDays?: number;

  @ApiPropertyOptional({ minimum: 5, maximum: 120 })
  @IsInt()
  @Min(5)
  @Max(120)
  @IsOptional()
  slotIntervalMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 168 })
  @IsInt()
  @Min(0)
  @Max(168)
  @IsOptional()
  cancellationWindowHours?: number;

  @ApiPropertyOptional({ enum: ['none', 'percent', 'fixed'] })
  @IsIn(['none', 'percent', 'fixed'])
  @IsOptional()
  lateCancellationPenaltyType?: 'none' | 'percent' | 'fixed';

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  lateCancellationPenaltyPercent?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  lateCancellationPenaltyKobo?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  depositPercent?: number;

  @ApiPropertyOptional({ enum: ['deposit', 'full'] })
  @IsIn(['deposit', 'full'])
  @IsOptional()
  paymentCollection?: 'deposit' | 'full';

  @ApiPropertyOptional({ minimum: 0, maximum: 168 })
  @IsInt()
  @Min(0)
  @Max(168)
  @IsOptional()
  reminderHoursBefore?: number;

  @ApiPropertyOptional({ type: [WeeklyHoursDto] })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeeklyHoursDto)
  @IsOptional()
  weeklyHours?: WeeklyHoursDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @IsOptional()
  closedDates?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Booking locations customers can choose from' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  locations?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  policy?: string;
}

export class AddSettlementAccountDto {
  @ApiProperty({ description: 'Paystack bank code' })
  @IsString()
  @MaxLength(20)
  bankCode: string;

  @ApiProperty({ description: '10-digit NUBAN account number' })
  @Matches(/^\d{10}$/)
  accountNumber: string;
}

export class UpdateBusinessDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ enum: BUSINESS_CATEGORY_KEYS })
  @IsIn(BUSINESS_CATEGORY_KEYS as unknown as string[])
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ enum: ['products', 'services', 'hybrid'] })
  @IsIn(['products', 'services', 'hybrid'])
  @IsOptional()
  businessMode?: 'products' | 'services' | 'hybrid';

  @ApiPropertyOptional()
  @ValidateNested()
  @Type(() => BookingSettingsDto)
  @IsOptional()
  bookingSettings?: BookingSettingsDto;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(600)
  description?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  orderPolicy?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  settlementBankName?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  settlementBankCode?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  settlementAccountNumber?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  settlementAccountName?: string | null;

  @ApiPropertyOptional()
  @Transform(cleanUrl)
  @IsUrl({ require_protocol: true })
  @IsOptional()
  logoUrl?: string | null;

  @ApiPropertyOptional()
  @Transform(cleanUrl)
  @IsUrl({ require_protocol: true })
  @IsOptional()
  bannerUrl?: string | null;

  @ApiPropertyOptional()
  @Transform(cleanUrl)
  @IsUrl({ require_protocol: true })
  @IsOptional()
  heroVideoUrl?: string | null;

  @ApiPropertyOptional()
  @Transform(cleanUrl)
  @IsUrl({ require_protocol: true })
  @IsOptional()
  storyImageUrl?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(80)
  lookbookTitle?: string;

  @ApiPropertyOptional({ type: [LookbookItemDto] })
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => LookbookItemDto)
  @IsOptional()
  lookbook?: LookbookItemDto[];

  @ApiPropertyOptional()
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(120)
  tagline?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(120)
  serviceHeroTitle?: string;

  @ApiPropertyOptional({ example: '#FF5A1F' })
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Brand colour must be a 6-digit hex value.' })
  @IsOptional()
  brandColor?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(60)
  templateKey?: string;

  @ApiPropertyOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(['hero', 'featured', 'story', 'lookbook', 'categories', 'products', 'contact', 'testimonials'], { each: true })
  @IsOptional()
  sections?: string[];

  @ApiPropertyOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  @IsOptional()
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  publicPhone?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  whatsappNumber?: string | null;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsEmail()
  @IsOptional()
  email?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(3000)
  about?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(70)
  seoTitle?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(160)
  seoDescription?: string;

  @ApiPropertyOptional()
  @ValidateNested()
  @Type(() => SummarySettingsDto)
  @IsOptional()
  summarySettings?: SummarySettingsDto;

  @ApiPropertyOptional()
  @ValidateNested()
  @Type(() => AlertSettingsDto)
  @IsOptional()
  alertSettings?: AlertSettingsDto;
}

export class CustomDomainDto {
  @ApiProperty({ example: 'shop.tolathrift.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, { message: 'Enter a valid domain, like shop.yourname.com.' })
  @MaxLength(253)
  domain: string;
}

export class InviteStaffDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsIn(ALL_PERMISSIONS, { each: true })
  @IsOptional()
  permissions?: string[];
}

export class UpdateStaffDto {
  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsIn(ALL_PERMISSIONS, { each: true })
  @IsOptional()
  permissions?: string[];

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsIn(['active', 'disabled'])
  @IsOptional()
  status?: 'active' | 'disabled';
}
