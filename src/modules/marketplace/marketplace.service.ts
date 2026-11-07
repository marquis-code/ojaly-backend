import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { Review, ReviewDocument } from '../reviews/review.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { LAGOS_CAMPUSES, campusByCode } from '../campus/campus.constants';

@Injectable()
export class MarketplaceService {
  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
  ) {}

  async search(input: { campus?: string; category?: string; q?: string }) {
    const campus = input.campus && input.campus !== 'LAGOS' ? campusByCode(input.campus) : null;
    const filter: Record<string, unknown> = {
      storefrontPublished: true,
      isSuspended: { $ne: true },
      isDemo: { $ne: true },
      campusVerified: true,
      businessMode: { $in: ['services', 'hybrid'] },
      ...(campus ? { campusCode: campus.code } : {}),
    };
    const businesses = await this.businesses.find(filter).select('name slug tagline description category logoUrl bannerUrl campusCode campusName campusVerified address city').limit(100).lean().exec();
    if (!businesses.length) return { campuses: LAGOS_CAMPUSES, categories: [], businesses: [], total: 0 };

    const ids = businesses.map((business) => business._id.toString());
    const services = await this.services.find({ businessId: { $in: ids }, isActive: true, isPublic: true }).sort({ sortOrder: 1, priceKobo: 1 }).lean().exec();
    const reviews = await this.reviews.find({ businessId: { $in: ids }, status: 'published' }).select('businessId rating').lean().exec();
    const q = input.q?.trim().toLowerCase();
    const categories = [...new Set(services.map((service) => service.category).filter(Boolean))].sort();

    const result = businesses.map((business) => {
      const own = services.filter((service) => service.businessId === business._id.toString());
      const matching = input.category ? own.filter((service) => service.category === input.category) : own;
      if (!matching.length) return null;
      if (q && !`${business.name} ${business.tagline} ${business.description} ${matching.map((service) => `${service.name} ${service.description}`).join(' ')}`.toLowerCase().includes(q)) return null;
      const ownReviews = reviews.filter((review) => review.businessId === business._id.toString());
      const average = ownReviews.length ? ownReviews.reduce((sum, review) => sum + review.rating, 0) / ownReviews.length : 0;
      return {
        id: business._id.toString(), name: business.name, slug: business.slug,
        tagline: business.tagline || '', description: business.description || '',
        logoUrl: business.logoUrl, bannerUrl: business.bannerUrl,
        category: business.category, campusCode: business.campusCode, campusName: business.campusName,
        verified: Boolean(business.campusVerified), address: business.address || '',
        rating: Math.round(average * 10) / 10, reviewCount: ownReviews.length,
        serviceCount: own.length, minPriceKobo: own.reduce((min, service) => Math.min(min, service.priceKobo), own[0]?.priceKobo || 0),
        services: matching.slice(0, 6).map((service) => ({ id: service._id.toString(), name: service.name, category: service.category, priceKobo: service.priceKobo, durationMinutes: service.durationMinutes })),
        categories: [...new Set(own.map((service) => service.category).filter(Boolean))],
      };
    }).filter(Boolean) as Record<string, unknown>[];
    result.sort((a, b) => Number(b.rating) - Number(a.rating) || Number(b.reviewCount) - Number(a.reviewCount));
    return { campuses: LAGOS_CAMPUSES, categories, businesses: result, total: result.length };
  }

  async featuredBusinesses() {
    const businesses = await this.businesses.find({
      isDemo: { $ne: true },
      isSuspended: { $ne: true },
      storefrontPublished: true,
      campusVerified: true,
      businessMode: { $in: ['services', 'hybrid'] },
    }).select('name slug tagline description logoUrl bannerUrl businessMode campusCode campusName address').sort({ createdAt: -1 }).limit(12).lean().exec();
    if (!businesses.length) return [];
    const ids = businesses.map((business) => business._id.toString());
    const [services, products] = await Promise.all([
      this.services.find({ businessId: { $in: ids }, isActive: true, isPublic: true }).select('businessId name priceKobo category').lean().exec(),
      this.products.find({ businessId: { $in: ids }, isActive: true }).select('businessId name category variants priceKobo').lean().exec(),
    ]);
    return businesses.map((business) => {
      const ownServices = services.filter((service) => service.businessId === business._id.toString());
      const ownProducts = products.filter((product) => product.businessId === business._id.toString());
      const prices = [
        ...ownServices.map((service) => service.priceKobo),
        ...ownProducts.flatMap((product) => (product.variants || []).map((variant) => variant.priceKobo)),
        ...ownProducts.map((product) => product.priceKobo),
      ].filter((price) => typeof price === 'number' && price > 0);
      const isService = business.businessMode === 'services';
      return {
        id: business._id.toString(), name: business.name, slug: business.slug,
        tagline: business.tagline || business.description || '', logoUrl: business.logoUrl, bannerUrl: business.bannerUrl,
        mode: isService ? 'services' : business.businessMode, campusCode: business.campusCode || 'Lagos',
        campusName: business.campusName || 'Lagos', address: business.address || '',
        serviceCount: ownServices.length, productCount: ownProducts.length,
        startingPriceKobo: prices.length ? Math.min(...prices) : null,
        href: isService ? `/s/${business.slug}/services` : `/s/${business.slug}`,
        cta: isService ? 'Book a service' : business.businessMode === 'hybrid' ? 'Shop & book' : 'Shop products',
      };
    });
  }

  async mine(businessId: string) {
    const bookings = await this.bookings.find({ businessId, source: 'marketplace' }).sort({ startAt: -1 }).limit(100).lean().exec();
    return {
      bookings: bookings.map((booking) => ({
        id: booking._id.toString(), bookingNumber: booking.bookingNumber, customerName: booking.customerName,
        serviceName: booking.serviceName, startAt: booking.startAt, status: booking.status,
        priceKobo: booking.priceKobo, feeKobo: booking.marketplaceFeeKobo || 0, campus: booking.marketplaceCampus,
      })),
      summary: {
        bookings: bookings.length,
        gmvKobo: bookings.reduce((sum, booking) => sum + booking.priceKobo, 0),
        commissionKobo: bookings.reduce((sum, booking) => sum + (booking.marketplaceFeeKobo || 0), 0),
        completed: bookings.filter((booking) => booking.status === 'completed').length,
      },
    };
  }

  async requestVerification(businessId: string) {
    const business = await this.businesses.findById(businessId).select('businessMode name').lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    if (!['services', 'hybrid'].includes(business.businessMode)) throw new NotFoundException('Only service businesses can request marketplace verification.');
    await this.businesses.updateOne({ _id: businessId }, { $set: { verificationRequestedAt: new Date() } }).exec();
    return { requested: true, message: 'Your verification request is in. We review new providers within 48 hours.' };
  }

  async adminBusinesses(campus?: string) {
    const filter: Record<string, unknown> = { businessMode: { $in: ['services', 'hybrid'] }, ...(campus ? { campusCode: campus } : {}) };
    const businesses = await this.businesses.find(filter).select('name slug campusCode campusName campusVerified campusVerifiedAt verificationRequestedAt storefrontPublished createdAt firstSaleAt').sort({ campusCode: 1, name: 1 }).limit(300).lean().exec();
    return businesses.map((business) => ({
      id: business._id.toString(), name: business.name, slug: business.slug,
      campusCode: business.campusCode, campusName: business.campusName,
      verified: Boolean(business.campusVerified), verifiedAt: business.campusVerifiedAt,
      verificationRequestedAt: business.verificationRequestedAt || null, storefrontPublished: Boolean(business.storefrontPublished),
      createdAt: business.createdAt, firstSaleAt: business.firstSaleAt,
    }));
  }

  async setVerified(businessId: string, verified: boolean) {
    const business = await this.businesses.findByIdAndUpdate(businessId, {
      $set: { campusVerified: verified, campusVerifiedAt: verified ? new Date() : null },
    }, { new: true }).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    return { id: business._id.toString(), verified: Boolean(business.campusVerified) };
  }

  async adminDashboard() {
    const [bookings, businesses] = await Promise.all([
      this.bookings.find({ source: 'marketplace' }).select('marketplaceCampus priceKobo marketplaceFeeKobo status startAt customerPhone').lean().exec(),
      this.businesses.find({ businessMode: { $in: ['services', 'hybrid'] } }).select('campusCode campusVerified firstSaleAt').lean().exec(),
    ]);
    const campuses = LAGOS_CAMPUSES.map((campus) => {
      const own = bookings.filter((booking) => booking.marketplaceCampus === campus.code);
      const businessRows = businesses.filter((business) => business.campusCode === campus.code);
      return {
        ...campus,
        businesses: businessRows.length,
        verified: businessRows.filter((business) => business.campusVerified).length,
        activated: businessRows.filter((business) => business.firstSaleAt).length,
        bookings: own.length,
        completed: own.filter((booking) => booking.status === 'completed').length,
        gmvKobo: own.reduce((sum, booking) => sum + booking.priceKobo, 0),
        commissionKobo: own.reduce((sum, booking) => sum + (booking.marketplaceFeeKobo || 0), 0),
        repeatCustomers: [...new Set(own.map((booking) => booking.customerPhone))].filter((phone) => own.filter((booking) => booking.customerPhone === phone).length > 1).length,
      };
    });
    return {
      campuses,
      totals: {
        businesses: businesses.length,
        verified: businesses.filter((business) => business.campusVerified).length,
        bookings: bookings.length,
        gmvKobo: bookings.reduce((sum, booking) => sum + booking.priceKobo, 0),
        commissionKobo: bookings.reduce((sum, booking) => sum + (booking.marketplaceFeeKobo || 0), 0),
      },
    };
  }
}
