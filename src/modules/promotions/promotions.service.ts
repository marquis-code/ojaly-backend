import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Promotion, PromotionDocument } from './promotion.schema';

export interface NewCustomerDiscount {
  discountKobo: number;
  percentOff: number;
  label: string;
}

@Injectable()
export class PromotionsService {
  constructor(
    @InjectModel(Promotion.name) private readonly promotions: Model<PromotionDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
  ) {}

  async getNewCustomer() {
    do {
      const existing = await this.promotions.findOne({ key: 'new_customer' }).lean().exec();
      if (existing) return existing;
      await this.promotions.create({ key: 'new_customer', enabled: false, percentOff: 10, maxDiscountKobo: 0 });
    } while (true);
  }

  async updateNewCustomer(dto: { enabled: boolean; percentOff: number; maxDiscountKobo?: number; startsAt?: string | null; endsAt?: string | null }) {
    return this.promotions.findOneAndUpdate(
      { key: 'new_customer' },
      { $set: { enabled: dto.enabled, percentOff: Math.max(0, Math.min(100, dto.percentOff)), maxDiscountKobo: Math.max(0, dto.maxDiscountKobo || 0), startsAt: this.windowStart(dto.startsAt), endsAt: this.windowEnd(dto.endsAt) } },
      { upsert: true, new: true },
    ).exec();
  }

  private windowStart(value?: string | null): Date | null {
    if (!value) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+01:00`) : new Date(value);
  }
  private windowEnd(value?: string | null): Date | null {
    if (!value) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59+01:00`) : new Date(value);
  }
  private running(promotion: { enabled?: boolean; startsAt?: Date | null; endsAt?: Date | null }) {
    if (!promotion.enabled) return false;
    const now = Date.now();
    if (promotion.startsAt && new Date(promotion.startsAt).getTime() > now) return false;
    if (promotion.endsAt && new Date(promotion.endsAt).getTime() < now) return false;
    return true;
  }

  async getPlatformCampaign() {
    return this.promotions.findOneAndUpdate(
      { key: 'platform_campaign' },
      { $setOnInsert: { enabled: false, percentOff: 10, maxDiscountKobo: 0, label: '10% off everything', bannerText: 'Ojaly is giving every customer 10% off every order and booking.', badgeText: '10% OFF', startsAt: null, endsAt: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
  }

  async publicPlatformCampaign() {
    const promotion = await this.getPlatformCampaign();
    return {
      enabled: this.running(promotion), percentOff: promotion.percentOff || 0,
      label: promotion.label || '', bannerText: promotion.bannerText || '', badgeText: promotion.badgeText || '',
      startsAt: promotion.startsAt || null, endsAt: promotion.endsAt || null, active: this.running(promotion),
    };
  }

  async updatePlatformCampaign(dto: { enabled: boolean; percentOff: number; maxDiscountKobo?: number; label?: string; bannerText?: string; badgeText?: string; startsAt?: string | null; endsAt?: string | null }) {
    return this.promotions.findOneAndUpdate(
      { key: 'platform_campaign' },
      { $set: {
        enabled: Boolean(dto.enabled), percentOff: Math.max(0, Math.min(100, dto.percentOff)),
        maxDiscountKobo: Math.max(0, dto.maxDiscountKobo || 0), label: (dto.label || '').slice(0, 100),
        bannerText: (dto.bannerText || '').slice(0, 200), badgeText: (dto.badgeText || '').slice(0, 40),
        startsAt: this.windowStart(dto.startsAt), endsAt: this.windowEnd(dto.endsAt),
      } },
      { upsert: true, new: true },
    ).exec();
  }

  async platformDiscount(subtotalKobo: number): Promise<NewCustomerDiscount | null> {
    if (subtotalKobo <= 0) return null;
    const promotion = await this.getPlatformCampaign();
    if (!this.running(promotion) || promotion.percentOff <= 0) return null;
    const raw = Math.round((subtotalKobo * promotion.percentOff) / 100);
    const discountKobo = promotion.maxDiscountKobo > 0 ? Math.min(raw, promotion.maxDiscountKobo) : raw;
    return { discountKobo: Math.min(discountKobo, subtotalKobo), percentOff: promotion.percentOff, label: promotion.label || `Ojaly ${promotion.percentOff}% off` };
  }

  async newCustomerDiscount(input: { customerPhone: string; customerEmail?: string | null; subtotalKobo: number }): Promise<NewCustomerDiscount | null> {
    const promotion = await this.getNewCustomer();
    if (!this.running(promotion) || promotion.percentOff <= 0 || input.subtotalKobo <= 0) return null;
    const phone = input.customerPhone;
    const email = input.customerEmail?.toLowerCase() || null;
    const [bookingCount, orderCount] = await Promise.all([
      this.bookings.countDocuments({ customerPhone: phone, status: { $ne: 'cancelled' } }).exec(),
      this.orders.countDocuments({ customerPhone: phone }).exec(),
    ]);
    if (bookingCount + orderCount > 0) return null;
    if (email) {
      const [emailBookings, emailOrders] = await Promise.all([
        this.bookings.countDocuments({ customerEmail: email, status: { $ne: 'cancelled' } }).exec(),
        this.orders.countDocuments({ customerEmail: email }).exec(),
      ]);
      if (emailBookings + emailOrders > 0) return null;
    }
    const raw = Math.round((input.subtotalKobo * promotion.percentOff) / 100);
    const discountKobo = promotion.maxDiscountKobo > 0 ? Math.min(raw, promotion.maxDiscountKobo) : raw;
    return { discountKobo: Math.min(discountKobo, input.subtotalKobo), percentOff: promotion.percentOff, label: `New customer ${promotion.percentOff}% off first booking` };
  }
}
