import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { WaitlistEntry, WaitlistSchema } from '../waitlist/waitlist.schema';
import { WithdrawalRequest, WithdrawalSchema } from './withdrawal.schema';
import { AdminPayoutsController, PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
@Module({
  imports: [MongooseModule.forFeature([
    { name: Business.name, schema: BusinessSchema },
    { name: Booking.name, schema: BookingSchema },
    { name: WaitlistEntry.name, schema: WaitlistSchema },
    { name: WithdrawalRequest.name, schema: WithdrawalSchema },
  ])],
  controllers: [PayoutsController, AdminPayoutsController],
  providers: [PayoutsService],
})
export class PayoutsModule {}
