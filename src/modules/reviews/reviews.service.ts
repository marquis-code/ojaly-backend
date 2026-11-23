import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { randomToken } from '../../common/utils/tokens';
import { sanitizeText } from '../../common/utils/sanitize';
import { Review, ReviewDocument, ReviewStatus } from './review.schema';
import { ReplyReviewDto, ReviewQueryDto, SubmitReviewDto } from './review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async context(token: string) {
    const booking = await this.bookings.findOne({ reviewToken: token }).lean().exec();
    if (!booking) throw new NotFoundException('Review link not found.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    const existing = await this.reviews.findOne({ bookingId: booking._id.toString() }).lean().exec();
    return {
      booking: {
        id: booking._id.toString(), bookingNumber: booking.bookingNumber,
        serviceId: booking.serviceId, serviceName: booking.serviceName,
        providerName: booking.providerName, customerName: booking.customerName,
        startAt: booking.startAt, status: booking.status,
      },
      business: business ? {
        id: business._id.toString(), name: business.name, slug: business.slug,
        logoUrl: business.logoUrl, brandColor: business.brandColor,
      } : null,
      review: existing ? this.view(existing) : null,
      canReview: booking.status === 'completed' && !existing,
    };
  }

  async submit(token: string, dto: SubmitReviewDto) {
    const booking = await this.bookings.findOne({ reviewToken: token }).exec();
    if (!booking) throw new NotFoundException('Review link not found.');
    if (booking.status !== 'completed') throw new BadRequestException('You can review an appointment after it is completed.');
    const existing = await this.reviews.findOne({ bookingId: booking._id.toString() }).lean().exec();
    if (existing) throw new BadRequestException('This appointment has already been reviewed.');
    const cleanTags = [...new Set((dto.tags || []).map((tag) => sanitizeText(tag, 40).trim()).filter(Boolean))].slice(0, 6);
    const review = await this.reviews.create({
      businessId: booking.businessId,
      bookingId: booking._id.toString(),
      serviceId: booking.serviceId,
      serviceName: booking.serviceName,
      providerId: booking.providerId,
      providerName: booking.providerName,
      customerId: booking.customerId,
      customerName: booking.customerName,
      rating: dto.rating,
      comment: sanitizeText(dto.comment, 1000),
      categoryRatings: dto.categoryRatings || {},
      tags: cleanTags,
      wouldRecommend: dto.wouldRecommend ?? null,
      publicToken: randomToken(20),
      status: 'published',
    });
    booking.reviewedAt = new Date();
    await booking.save();
    await this.notifications.create({
      businessId: booking.businessId, type: 'booking', tone: dto.rating >= 4 ? 'success' : 'info',
      title: `${dto.rating}-star review for ${booking.serviceName}`,
      message: `${booking.customerName}: ${dto.comment || 'No comment left.'}`,
      data: { reviewId: review._id.toString(), bookingId: booking._id.toString() },
    });
    return this.view(review);
  }

  async list(businessId: string, query: ReviewQueryDto) {
    const filter: Record<string, unknown> = { businessId };
    if (query.status && query.status !== 'all') filter.status = query.status;
    const [items, all, requests] = await Promise.all([
      this.reviews.find(filter).sort({ createdAt: -1 }).limit(200).lean().exec(),
      this.reviews.find({ businessId }).select('rating status vendorReply categoryRatings serviceName createdAt').lean().exec(),
      this.bookings.find({
        businessId, status: 'completed', reviewedAt: null,
        reviewToken: { $ne: null },
      }).select('bookingNumber customerName customerPhone customerEmail serviceName providerName completedAt startAt reviewToken reviewedAt reviewRequestedAt').sort({ completedAt: -1, startAt: -1 }).limit(50).lean().exec(),
    ]);
    const published = all.filter((review) => review.status === 'published');
    const average = published.length ? published.reduce((sum, review) => sum + review.rating, 0) / published.length : 0;
    const distribution = [5, 4, 3, 2, 1].map((star) => ({ star, count: published.filter((review) => review.rating === star).length }));
    const services = new Map<string, { name: string; count: number; rating: number }>();
    for (const review of published) {
      const current = services.get(review.serviceName) || { name: review.serviceName, count: 0, rating: 0 };
      current.count += 1; current.rating += review.rating; services.set(review.serviceName, current);
    }
    const categoryKeys = ['quality', 'punctuality', 'communication', 'value'] as const;
    const categoryAverages = Object.fromEntries(categoryKeys.map((key) => {
      const values = published.map((review) => review.categoryRatings?.[key]).filter((value): value is number => typeof value === 'number');
      return [key, values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null];
    }));
    return {
      items: items.map((review) => this.view(review)),
      summary: {
        total: published.length,
        average: Math.round(average * 10) / 10,
        fiveStar: published.filter((review) => review.rating === 5).length,
        needsAttention: published.filter((review) => review.rating <= 3).length,
        responseRate: published.length ? Math.round((published.filter((review) => review.vendorReply).length / published.length) * 100) : 0,
        pendingRequests: requests.length,
        distribution,
        categoryAverages,
        services: [...services.values()].map((service) => ({ ...service, rating: Math.round((service.rating / service.count) * 10) / 10 })).sort((a, b) => b.count - a.count),
      },
      requests: requests.map((booking) => ({
        id: booking._id.toString(), bookingNumber: booking.bookingNumber,
        customerName: booking.customerName, customerPhone: booking.customerPhone,
        customerEmail: booking.customerEmail || null, serviceName: booking.serviceName,
        providerName: booking.providerName, completedAt: booking.completedAt || booking.startAt,
        reviewRequestedAt: booking.reviewRequestedAt || null,
        reviewUrl: this.reviewUrl(booking.reviewToken),
      })),
    };
  }

  async publishedForBusiness(businessId: string, serviceId?: string) {
    const filter: Record<string, unknown> = { businessId, status: 'published' };
    if (serviceId) filter.serviceId = serviceId;
    const all = await this.reviews.find(filter).select('rating').lean().exec();
    const items = await this.reviews.find(filter).sort({ createdAt: -1 }).limit(6).lean().exec();
    const average = all.length ? all.reduce((sum, review) => sum + review.rating, 0) / all.length : 0;
    return {
      items: items.map((review) => ({
        id: review.publicToken, rating: review.rating, comment: review.comment,
        customerName: review.customerName, serviceName: review.serviceName,
        providerName: review.providerName, createdAt: review.createdAt,
        categoryRatings: review.categoryRatings || {}, tags: review.tags || [],
        wouldRecommend: review.wouldRecommend ?? null, vendorReply: review.vendorReply || '',
      })),
      average: Math.round(average * 10) / 10,
      count: all.length,
    };
  }

  async reply(businessId: string, id: string, dto: ReplyReviewDto) {
    const review = await this.reviews.findOneAndUpdate(
      { _id: id, businessId },
      { $set: { vendorReply: sanitizeText(dto.reply, 1000), vendorRepliedAt: new Date() } },
      { new: true },
    ).lean().exec();
    if (!review) throw new NotFoundException('Review not found.');
    return this.view(review);
  }

  async setStatus(businessId: string, id: string, status: ReviewStatus) {
    const review = await this.reviews.findOneAndUpdate({ _id: id, businessId }, { $set: { status } }, { new: true }).lean().exec();
    if (!review) throw new NotFoundException('Review not found.');
    return this.view(review);
  }

  async remove(businessId: string, id: string) {
    const result = await this.reviews.deleteOne({ _id: id, businessId }).exec();
    if (!result.deletedCount) throw new NotFoundException('Review not found.');
    return { removed: true };
  }

  reviewUrl(token: string | null) {
    return token ? `${this.config.get('appUrl')}/review/${token}` : null;
  }

  private view(review: ReviewDocument | (Review & { _id: unknown })) {
    const r = review as ReviewDocument;
    return {
      id: r._id.toString(), bookingId: r.bookingId, serviceId: r.serviceId, serviceName: r.serviceName,
      providerId: r.providerId, providerName: r.providerName, customerId: r.customerId,
      customerName: r.customerName, rating: r.rating, comment: r.comment,
      categoryRatings: r.categoryRatings || {}, tags: r.tags || [], wouldRecommend: r.wouldRecommend ?? null,
      vendorReply: r.vendorReply || '', vendorRepliedAt: r.vendorRepliedAt || null,
      publicToken: r.publicToken, status: r.status, createdAt: r.createdAt,
    };
  }
}
