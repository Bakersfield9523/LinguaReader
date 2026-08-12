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
  const [user, setUser] = useState<AuthUser | null>(() => {
    // 启动时优先从 localStorage 恢复已登录的档案，这样即使后端尚未就绪也能立即
    // 保持登录态，避免“重启就要重新登录”。me 查询随后会在后台刷新为最新档案。
    try {
      const raw = localStorage.getItem('auth_user');
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  });

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: !!token,
    // 后端由 Rust 在启动时拉起 Node，约有 5s 延迟；首屏 me 可能在后端就绪前发送而
    // 失败。下面显式重试：对“连接被拒 / 网络层”错误一直重试直到后端就绪（最多 12 次，
    // 退避到 3s），只对明确的鉴权错误(UNAUTHORIZED/FORBIDDEN/NOT_FOUND)停止并重新登录。
    retry: (failureCount: number, error: unknown) => {
      if (failureCount >= 12) return false;
      const code = (error as any)?.data?.code;
      if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'NOT_FOUND') return false;
      return true;
    },
    retryDelay: (attempt: number) => Math.min(3000, 1000 * attempt),
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
      // 把最新档案缓存到 localStorage，下次启动即使后端还没就绪也能立即恢复登录态。
      try { localStorage.setItem('auth_user', JSON.stringify(u)); } catch { /* ignore */ }
    }
    if (meQuery.error) {
      // 仅当服务端明确返回鉴权错误（token 失效 / 用户不存在）才清除登录态。
      const err: any = meQuery.error;
      const code: string | undefined = err?.data?.code;
      const isAuthError =
        code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'NOT_FOUND';
      if (isAuthError) {
        setToken(null);
        setUser(null);
        try {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user');
        } catch { /* ignore */ }
      }
      // 网络层错误（后端尚未就绪）不清除，交给上面的 retry 自动恢复。
    }
  }, [meQuery.data, meQuery.error]);

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => {
      setToken(data.token);
      setUser(data.user);
      try {
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
      } catch { /* ignore */ }
    },
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      setToken(data.token);
      setUser(data.user);
      try {
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
      } catch { /* ignore */ }
    },
  });

  const updateProfileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      meQuery.refetch();
    },
  });

  const changePasswordMutation = trpc.auth.changePassword.useMutation();

  const forgotPasswordLookupMutation = trpc.auth.forgotPasswordLookup.useMutation();
  const verifySecurityAnswerMutation = trpc.auth.verifySecurityAnswer.useMutation();
  const resetPasswordMutation = trpc.auth.resetPassword.useMutation();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    } catch { /* ignore */ }
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
      const res = await updateProfileMutation.mutateAsync(data);
      // 立即把昵称/头像写回本地 user 状态，确保裁剪/改名后界面即时刷新，
      // 不必等 me 轮询返回（避免“改了头像却不刷新”的观感）。
      setUser((prev) => {
        if (!prev) return prev;
        const next: AuthUser = {
          ...prev,
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
        };
        try { localStorage.setItem('auth_user', JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
      meQuery.refetch();
      return res;
    },
    [updateProfileMutation, meQuery],
  );

  const forgotPasswordLookup = useCallback(
    async (account: string) => forgotPasswordLookupMutation.mutateAsync({ account }),
    [forgotPasswordLookupMutation],
  );
  const verifySecurityAnswer = useCallback(
    async (account: string, answer: string) =>
      verifySecurityAnswerMutation.mutateAsync({ account, answer }),
    [verifySecurityAnswerMutation],
  );
  const resetPassword = useCallback(
    async (resetToken: string, newPassword: string) =>
      resetPasswordMutation.mutateAsync({ resetToken, newPassword }),
    [resetPasswordMutation],
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
    forgotPasswordLookup,
    verifySecurityAnswer,
    resetPassword,
    registerError: registerMutation.error,
    loginError: loginMutation.error,
    forgotLookupError: forgotPasswordLookupMutation.error,
    verifyAnswerError: verifySecurityAnswerMutation.error,
    resetError: resetPasswordMutation.error,
  };
}
