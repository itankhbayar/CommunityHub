import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class CreatePostDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 5000, { message: 'A post needs between 1 and 5000 characters.' })
  body!: string;
}
