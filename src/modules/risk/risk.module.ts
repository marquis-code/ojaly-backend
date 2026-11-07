import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { Order, OrderSchema } from '../orders/order.schema';
import { RiskEvent, RiskEventSchema } from './risk-event.schema';
import { RiskService } from './risk.service';
@Module({
  imports: [MongooseModule.forFeature([{ name: RiskEvent.name, schema: RiskEventSchema }, { name: Booking.name, schema: BookingSchema }, { name: Order.name, schema: OrderSchema }])],
  providers: [RiskService], exports: [RiskService],
})
export class RiskModule {}
