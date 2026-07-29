'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { canManageCommunity, canModerate } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { CommunityRole, Member, Paginated } from '@/lib/types';
import { communityQueryKey, useCommunity } from '../community-context';

const ROLE_OPTIONS: CommunityRole[] = ['OWNER', 'MODERATOR', 'MEMBER'];

function membersQueryKey(communityId: string) {
  return ['members', communityId] as const;
}

export default function MembersPage() {
  const community = useCommunity();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();

  // UI-side gates only — the server enforces all of this independently
  const mayInvite = canModerate(user, community);
  const mayRemove = canModerate(user, community);
  const mayChangeRoles = canManageCommunity(user, community);

  const [pendingRoleChange, setPendingRoleChange] = useState<{
    member: Member;
    nextRole: CommunityRole;
  } | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: membersQueryKey(community.id),
    queryFn: () => api<Paginated<Member>>(`/communities/${community.id}/members?limit=100`),
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: membersQueryKey(community.id) }),
      queryClient.invalidateQueries({ queryKey: communityQueryKey(community.slug) }),
    ]);

  async function changeRole(member: Member, role: CommunityRole) {
    try {
      await api<Member>(`/communities/${community.id}/members/${member.userId}`, {
        method: 'PATCH',
        body: { role },
      });
    } catch (error) {
      // rethrow so ConfirmDialog shows it inline (e.g. last-owner 409)
      throw error instanceof ApiError ? error : new Error("Couldn't change the role.");
    }
    await invalidate();
    toast.success(`${member.displayName} is now ${role.toLowerCase()}.`);
  }

  async function removeMember(member: Member) {
    try {
      await api<void>(`/communities/${community.id}/members/${member.userId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      throw error instanceof ApiError ? error : new Error("Couldn't remove them.");
    }
    await invalidate();
    toast.success(`${member.displayName} was removed.`);
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading members">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 py-12 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Couldn&apos;t load the member list.
        </p>
        <button type="button" onClick={() => void refetch()} className={secondaryButtonClass}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {mayInvite && <InviteForm communityId={community.id} onInvited={invalidate} />}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[28rem] text-sm">
          <caption className="sr-only">
            Members of {community.name} with their roles
          </caption>
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th scope="col" className="px-4 py-2 font-medium">
                Member
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Role
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Joined
              </th>
              {(mayRemove || mayChangeRoles) && (
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.items.map((member) => {
              const isSelf = member.userId === user?.id;
              // moderators cannot touch owners (rule 2) — don't offer it
              const moderatorVsOwner =
                community.callerRole === 'MODERATOR' && member.role === 'OWNER';
              const showRoleSelect = mayChangeRoles && !isSelf;
              const showRemove = mayRemove && !isSelf && !moderatorVsOwner;

              return (
                <tr
                  key={member.userId}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  <td className="px-4 py-3 font-medium">
                    {member.displayName}
                    {isSelf && (
                      <span className="ml-1.5 text-xs font-normal text-zinc-400">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {showRoleSelect ? (
                      <>
                        <label className="sr-only" htmlFor={`role-${member.userId}`}>
                          Role for {member.displayName}
                        </label>
                        <select
                          id={`role-${member.userId}`}
                          value={member.role}
                          onChange={(e) =>
                            setPendingRoleChange({
                              member,
                              nextRole: e.target.value as CommunityRole,
                            })
                          }
                          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:outline-2 focus:outline-offset-0 focus:outline-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {role.toLowerCase()}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <RoleBadge role={member.role} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </td>
                  {(mayRemove || mayChangeRoles) && (
                    <td className="px-4 py-3 text-right">
                      {showRemove && (
                        <button
                          type="button"
                          onClick={() => setRemoving(member)}
                          className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* role changes are destructive-adjacent: always confirmed, and server
          refusals (last owner, self-change) render inline in the dialog */}
      <ConfirmDialog
        open={pendingRoleChange !== null}
        onClose={() => setPendingRoleChange(null)}
        title="Change role?"
        confirmLabel="Change role"
        onConfirm={() =>
          pendingRoleChange
            ? changeRole(pendingRoleChange.member, pendingRoleChange.nextRole)
            : Promise.resolve()
        }
      >
        {pendingRoleChange && (
          <>
            Make <strong>{pendingRoleChange.member.displayName}</strong>{' '}
            {pendingRoleChange.nextRole === 'OWNER' ? 'an' : 'a'}{' '}
            <strong>{pendingRoleChange.nextRole.toLowerCase()}</strong> of this
            community? Their permissions change immediately.
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove member?"
        confirmLabel="Remove"
        onConfirm={() => (removing ? removeMember(removing) : Promise.resolve())}
      >
        {removing && (
          <>
            Remove <strong>{removing.displayName}</strong> from this community?
            They can re-join a public community on their own; private
            communities require a new invite.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

function RoleBadge({ role }: { role: CommunityRole }) {
  const styles: Record<CommunityRole, string> = {
    OWNER:
      'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
    MODERATOR:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    MEMBER: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${styles[role]}`}>
      {role.toLowerCase()}
    </span>
  );
}

function InviteForm({
  communityId,
  onInvited,
}: {
  communityId: string;
  onInvited: () => Promise<unknown>;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api<Member>(`/communities/${communityId}/members`, {
        method: 'POST',
        body: { email: email.trim() },
      }),
    onSuccess: async (member) => {
      setEmail('');
      toast.success(`${member.displayName} is now a member.`);
      await onInvited();
    },
    onError: (error) => {
      // 404 "no account uses that email", 409 "already a member" — both readable
      toast.error(error instanceof ApiError ? error.message : "Couldn't invite them.");
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending || !email.trim()) return;
    mutation.mutate();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 sm:flex-row sm:items-end dark:border-zinc-800"
    >
      <div className="flex-1">
        <label htmlFor="invite-email" className="mb-1.5 block text-sm font-medium">
          Invite by email
        </label>
        <input
          id="invite-email"
          type="email"
          required
          placeholder="their@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          They need a CommunityHub account already; they join as a member right away.
        </p>
      </div>
      <button
        type="submit"
        disabled={mutation.isPending || !email.trim()}
        className={primaryButtonClass}
      >
        {mutation.isPending ? 'Inviting…' : 'Invite'}
      </button>
    </form>
  );
}
