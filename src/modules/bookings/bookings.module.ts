import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Customer, CustomerSchema } from '../customers/customer.schema';
import { Debt, DebtSchema } from '../debts/debt.schema';
import { DebtsModule } from '../debts/debts.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Counter, CounterSchema } from '../plans/counter.schema';
import { Provider, ProviderSchema } from '../providers/provider.schema';
import { ProvidersModule } from '../providers/providers.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { Sale, SaleSchema } from '../sales/sale.schema';
import { Service, ServiceSchema } from '../services/service.schema';
import { ServicesModule } from '../services/services.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { PaymentsModule } from '../payments/payments.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { RiskModule } from '../risk/risk.module';
import { PackagesModule } from '../packages/packages.module';
import { CalendarModule } from '../calendar/calendar.module';
import { Booking, BookingSchema } from './booking.schema';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { PublicBookingsController } from './public-bookings.controller';
import { AvailabilityService } from './availability.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Provider.name, schema: ProviderSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Sale.name, schema: SaleSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: Debt.name, schema: DebtSchema },
    ]),
    ProvidersModule,
    ServicesModule,
    WaitlistModule,
    PaymentsModule,
    PromotionsModule,
    RiskModule,
    PackagesModule,
    CalendarModule,
    DebtsModule,
    ReceiptsModule,
    NotificationsModule,
    MailModule,
  ],
  controllers: [BookingsController, PublicBookingsController],
  providers: [BookingsService, AvailabilityService],
  exports: [BookingsService, AvailabilityService],
})
export class BookingsModule {}
