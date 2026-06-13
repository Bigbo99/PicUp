import { IsIn } from 'class-validator';
import type { CreditRechargePlan } from '@picup/shared';

export class CreateRechargeOrderDto {
  @IsIn(['credits_10_trial', 'credits_20', 'credits_45'])
  planId!: CreditRechargePlan['id'];
}
