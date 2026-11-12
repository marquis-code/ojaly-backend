import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { StorefrontVisit, StorefrontVisitDocument } from './storefront-visit.schema';
import { TrackStorefrontVisitDto } from './analytics.dto';

const BOT = /(bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedinbot|twitterbot|googlebot|bingbot|applebot|semrush|ahrefs|screaming|headless)/i;
const RANGE_DAYS = { today: 1, '7d': 7, '30d': 30, '90d': 90 } as const;

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(StorefrontVisit.name) private readonly visits: Model<StorefrontVisitDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
  ) {}

  async track(businessId: string, dto: TrackStorefrontVisitDto, userAgent: string, ip: string) {
    if (!businessId || !/^[a-f\d]{24}$/i.test(businessId)) return { tracked: false };
    if (BOT.test(userAgent)) return { tracked: false };
    const business = await this.businesses.findOne({ _id: businessId, storefrontPublished: true, isSuspended: { $ne: true } }).select('_id').lean().exec();
    if (!business) return { tracked: false };
    const cleanVisitor = (dto.visitorId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const fallback = createHash('sha256').update(`${ip}|${userAgent}|${this.dayKey(new Date())}`).digest('hex').slice(0, 32);
    const visitorId = cleanVisitor.length >= 8 ? cleanVisitor : fallback;
    const rawPath = (dto.path || '/').split('?')[0].slice(0, 300);
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const referrer = (dto.referrer || '').slice(0, 500);
    const source = this.source(dto.source, referrer);
    const device = /mobile|android|iphone|ipad/i.test(userAgent) ? 'mobile' : 'desktop';
    await this.visits.create({ businessId, visitorId, path, source, referrer, device, userAgent: userAgent.slice(0, 300) });
    return { tracked: true };
  }

  async storefront(businessId: string, range: 'today' | '7d' | '30d' | '90d' = '30d') {
    const days = RANGE_DAYS[range] || 30;
    const now = new Date();
    const from = this.startOfDay(new Date(now.getTime() - (days - 1) * 86400000));
    const previousFrom = new Date(from.getTime() - days * 86400000);
    const [current, previous] = await Promise.all([
      this.visits.find({ businessId, createdAt: { $gte: from, $lte: now } }).select('visitorId path source createdAt').lean().exec(),
      this.visits.find({ businessId, createdAt: { $gte: previousFrom, $lt: from } }).select('visitorId createdAt').lean().exec(),
    ]);
    const summarize = (rows: typeof current) => {
      const visitors = new Set(rows.map((row) => row.visitorId));
      return { visitors: visitors.size, visits: rows.length };
    };
    const totals = summarize(current);
    const prior = summarize(previous);
    const todayKey = this.dayKey(now);
    const todayRows = current.filter((row) => this.dayKey(new Date(row.createdAt)) === todayKey);
    const daily: { date: string; label: string; visitors: number; visits: number }[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date(now.getTime() - i * 86400000);
      const key = this.dayKey(date);
      const rows = current.filter((row) => this.dayKey(new Date(row.createdAt)) === key);
      daily.push({ date: key, label: new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }).format(date), visitors: new Set(rows.map((row) => row.visitorId)).size, visits: rows.length });
    }
    const group = (field: 'source' | 'path') => {
      const map = new Map<string, { visits: number; visitors: Set<string> }>();
      for (const row of current) {
        const key = String(row[field] || (field === 'source' ? 'direct' : '/'));
        const item = map.get(key) || { visits: 0, visitors: new Set<string>() };
        item.visits += 1; item.visitors.add(row.visitorId); map.set(key, item);
      }
      return [...map.entries()].map(([key, value]) => ({ key, visits: value.visits, visitors: value.visitors.size })).sort((a, b) => b.visits - a.visits).slice(0, 6);
    };
    const percent = (value: number, base: number) => base ? Math.round(((value - base) / base) * 100) : null;
    return {
      range: { key: range, days, from, to: now },
      totals: {
        visitors: totals.visitors, visits: totals.visits,
        todayVisitors: new Set(todayRows.map((row) => row.visitorId)).size, todayVisits: todayRows.length,
      },
      comparison: { visitorsPercent: percent(totals.visitors, prior.visitors), visitsPercent: percent(totals.visits, prior.visits) },
      daily, sources: group('source'), pages: group('path'),
    };
  }

  private startOfDay(date: Date) {
    const key = this.dayKey(date);
    return new Date(`${key}T00:00:00+01:00`);
  }
  private dayKey(date: Date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
  private source(input?: string, referrer = '') {
    const value = (input || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    if (value) return value;
    const ref = referrer.toLowerCase();
    if (!ref) return 'direct';
    if (/whatsapp|wa\.me/.test(ref)) return 'whatsapp';
    if (/instagram/.test(ref)) return 'instagram';
    if (/facebook|fb\./.test(ref)) return 'facebook';
    if (/tiktok/.test(ref)) return 'tiktok';
    if (/google/.test(ref)) return 'google';
    if (/ojaly\.org\/marketplace/.test(ref)) return 'marketplace';
    return 'referral';
  }
}
