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

  async updateNewCustomer(dto: { enabled: boolean; percentOff: number; maxDiscountKobo?: number }) {
    return this.promotions.findOneAndUpdate(
      { key: 'new_customer' },
      { $set: { enabled: dto.enabled, percentOff: Math.max(0, Math.min(100, dto.percentOff)), maxDiscountKobo: Math.max(0, dto.maxDiscountKobo || 0) } },
      { upsert: true, new: true },
    ).exec();
  }

  async newCustomerDiscount(input: { customerPhone: string; customerEmail?: string | null; subtotalKobo: number }): Promise<NewCustomerDiscount | null> {
    const promotion = await this.getNewCustomer();
    if (!promotion.enabled || promotion.percentOff <= 0 || input.subtotalKobo <= 0) return null;
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
