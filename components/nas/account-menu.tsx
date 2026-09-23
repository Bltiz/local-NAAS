'use client';

import { Link2, LogOut, UserRound, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ViewerInfo {
  id: string;
  name: string;
  role: 'admin' | 'member';
  home: string | null;
}

interface Props {
  viewer: ViewerInfo | null;
  canSignOut: boolean;
  onUsers: () => void;
  onLinks: () => void;
  onSignOut: () => void;
}

export function AccountMenu({ viewer, canSignOut, onUsers, onLinks, onSignOut }: Props) {
  if (!viewer) return null;
  const isAdmin = viewer.role === 'admin';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label="Account" />}>
        <UserRound />
        <span className="hidden max-w-[7rem] truncate sm:inline">{isAdmin ? 'Admin' : viewer.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            Signed in as {isAdmin ? 'admin' : viewer.name}
            {viewer.home && <span className="block text-[11px] font-normal text-muted-foreground">Your space: {viewer.home}</span>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {isAdmin && canSignOut && (
          <DropdownMenuItem onClick={onUsers}>
            <Users /> Users…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onLinks}>
          <Link2 /> Shared links…
        </DropdownMenuItem>
        {canSignOut && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
