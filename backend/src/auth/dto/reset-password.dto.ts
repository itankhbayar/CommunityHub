import { IsString, Length } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @Length(8, 128, { message: 'Password must be at least 8 characters.' })
  newPassword!: string;
}
