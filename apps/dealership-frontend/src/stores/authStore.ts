import { create } from 'zustand';
import { storage } from '../lib/utils';
import { STORAGE_KEYS, USER_ROLES } from '../config/constants';

export interface User {
  id: string;
  name: string;
  role: typeof USER_ROLES.SALESPERSON | typeof USER_ROLES.MANAGER;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: storage.get<User>(STORAGE_KEYS.CURRENT_USER),
  isAuthenticated: !!storage.get<User>(STORAGE_KEYS.CURRENT_USER),

  login: (user) => {
    storage.set(STORAGE_KEYS.CURRENT_USER, user);
    set({ user, isAuthenticated: true });
  },

  logout: () => {
    storage.remove(STORAGE_KEYS.CURRENT_USER);
    set({ user: null, isAuthenticated: false });
  },

  updateUser: (updates) =>
    set((state) => {
      if (!state.user) return state;
      const updatedUser = { ...state.user, ...updates };
      storage.set(STORAGE_KEYS.CURRENT_USER, updatedUser);
      return { user: updatedUser };
    }),
}));
