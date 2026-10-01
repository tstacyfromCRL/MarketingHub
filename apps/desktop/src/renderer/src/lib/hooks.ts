import { useQuery } from '@tanstack/react-query';
import type { PlatformPreset, Role } from '@mh/shared';
import { api } from './api';
import type { Product } from './types';

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  slackUserId: string | null;
  lastLoginAt: string | null;
}

export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api.get<TeamUser[]>('/users'), staleTime: 60_000 });
export const useProducts = () => useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products'), staleTime: 60_000 });
export const usePlatforms = () => useQuery({ queryKey: ['platforms'], queryFn: () => api.get<PlatformPreset[]>('/platforms'), staleTime: Infinity });
