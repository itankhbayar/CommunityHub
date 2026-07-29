import { IsEnum } from 'class-validator';
import { CommunityRole } from '../../generated/prisma/enums';

export class ChangeRoleDto {
  @IsEnum(CommunityRole, {
    message: 'Role must be OWNER, MODERATOR, or MEMBER.',
  })
  role!: CommunityRole;
}
