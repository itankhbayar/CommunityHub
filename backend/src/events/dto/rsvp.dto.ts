import { IsIn } from 'class-validator';

/**
 * WAITLIST exists in the schema enum but is deliberately not accepted from
 * clients: the core build answers "full" with 409 (decision D4), and
 * auto-promotion is the stretch goal. Keeping the enum value now means no
 * migration later.
 */
export class RsvpDto {
  @IsIn(['GOING', 'NOT_GOING'], {
    message: 'Status must be GOING or NOT_GOING.',
  })
  status!: 'GOING' | 'NOT_GOING';
}
