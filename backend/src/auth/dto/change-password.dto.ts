import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  // deliberately unvalidated beyond "is a string": it is checked against the
  // stored hash, and length rules here would only leak what the old policy was
  @IsString()
  currentPassword!: string;

  @IsString()
  @Length(8, 128, { message: 'Password must be at least 8 characters.' })
  newPassword!: string;
}
