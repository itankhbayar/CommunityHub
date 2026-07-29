import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * "Invite" is a direct add: the invitee must already have an account, and the
 * membership is created immediately (email delivery is out of scope). Public
 * communities are also self-joinable; private ones only grow this way.
 */
export class InviteMemberDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email!: string;
}
