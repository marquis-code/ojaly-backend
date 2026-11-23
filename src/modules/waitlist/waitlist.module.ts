import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Service, ServiceSchema } from '../services/service.schema';
import { Customer, CustomerSchema } from '../customers/customer.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { WaitlistEntry, WaitlistSchema } from './waitlist.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WaitlistEntry.name, schema: WaitlistSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [WaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
