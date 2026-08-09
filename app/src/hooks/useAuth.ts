import { useState, useCallback, useEffect } from 'react';
import { trpc } from '@/providers/trpc';

export interface AuthUser {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  avatar?: string | null;
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem('auth_token'); } catch { return null; }
  });
  const [user, setUser] = useState<AuthUser | null>(null);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (meQuery.data) {
      const d = meQuery.data;
      const emailVal: string | undefined = d.email ? String(d.email) : undefined;
      const phoneVal: string | undefined = d.phone ? String(d.phone) : undefined;
      const avatarVal: string | undefined = d.avatar ? String(d.avatar) : undefined;
      const u: AuthUser = {
        id: Number(d.id),
        name: String(d.name),
        email: emailVal,
        phone: phoneVal,
        avatar: avatarVal,
      };
      setUser(u);
    }
    if (meQuery.error) {
      // Token无效，清除
      setToken(null);
      setUser(null);
      try { localStorage.removeItem('auth_token'); } catch { /* ignore */ }
    }
  }, [meQuery.data, meQuery.error]);

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => {
      setToken(data.token);
      setUser(data.user);
      try { localStorage.setItem('auth_token', data.token); } catch { /* ignore */ }
    },
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      setToken(data.token);
      setUser(data.user);
      try { localStorage.setItem('auth_token', data.token); } catch { /* ignore */ }
    },
  });

  const updateProfileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      meQuery.refetch();
    },
  });

  const changePasswordMutation = trpc.auth.changePassword.useMutation();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    try { localStorage.removeItem('auth_token'); } catch { /* ignore */ }
    window.location.reload();
  }, []);

  const register = useCallback(
    async (data: { name: string; email?: string; phone?: string; password: string }) => {
      return registerMutation.mutateAsync(data);
    },
    [registerMutation],
  );

  const login = useCallback(
    async (account: string, password: string) => {
      return loginMutation.mutateAsync({ account, password });
    },
    [loginMutation],
  );

  const updateProfile = useCallback(
    async (data: { name?: string; avatar?: string }) => {
      return updateProfileMutation.mutateAsync(data);
    },
    [updateProfileMutation],
  );

  return {
    user,
    token,
    isLoggedIn: !!user,
    isLoading: meQuery.isLoading || registerMutation.isPending || loginMutation.isPending,
    register,
    login,
    logout,
    updateProfile,
    changePassword: changePasswordMutation.mutateAsync,
    registerError: registerMutation.error,
    loginError: loginMutation.error,
  };
}
