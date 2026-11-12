import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { StorefrontVisit, StorefrontVisitSchema } from './storefront-visit.schema';
import { AnalyticsController, PublicAnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: StorefrontVisit.name, schema: StorefrontVisitSchema },
    { name: Business.name, schema: BusinessSchema },
  ])],
  controllers: [AnalyticsController, PublicAnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
