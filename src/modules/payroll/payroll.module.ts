import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { Provider, ProviderSchema } from '../providers/provider.schema';
import { PaymentsModule } from '../payments/payments.module';
import { PayrollRun, PayrollRunSchema } from './payroll.schema';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PayrollRun.name, schema: PayrollRunSchema },
      { name: Provider.name, schema: ProviderSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    PaymentsModule,
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
