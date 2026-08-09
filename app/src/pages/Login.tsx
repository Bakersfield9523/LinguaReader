import { useState } from 'react';
import { BookOpen, Mail, Phone, Lock, User, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

interface LoginProps {
  onBack: () => void;
}

export function Login({ onBack }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [tab, setTab] = useState<'email' | 'phone'>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const { login, register, isLoading } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (!name.trim()) { setError('请输入昵称'); return; }
      if (tab === 'email' && !email.trim()) { setError('请输入邮箱'); return; }
      if (tab === 'phone' && !phone.trim()) { setError('请输入手机号'); return; }
      if (password.length < 6) { setError('密码至少6位'); return; }
      if (password !== confirmPassword) { setError('两次密码不一致'); return; }

      try {
        await register({
          name: name.trim(),
          ...(tab === 'email' ? { email: email.trim() } : { phone: phone.trim() }),
          password,
        });
      } catch (err: any) {
        setError(err.message || '注册失败');
      }
    } else {
      const account = tab === 'email' ? email.trim() : phone.trim();
      if (!account) { setError(tab === 'email' ? '请输入邮箱' : '请输入手机号'); return; }
      if (!password) { setError('请输入密码'); return; }

      try {
        await login(account, password);
      } catch (err: any) {
        setError(err.message || '登录失败');
      }
    }
  };

  const switchMode = () => {
    setMode(prev => prev === 'login' ? 'register' : 'login');
    setError('');
  };

  return (
    <div className="min-h-screen bg-[#1a1c1f] flex items-center justify-center p-4">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-radial from-[#e5a349]/10 via-transparent to-transparent opacity-50" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">返回</span>
        </button>

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#e5a349]/15 mb-4">
            <BookOpen className="w-8 h-8 text-[#e5a349]" />
          </div>
          <h1 className="text-2xl font-bold text-white/90">
            {mode === 'login' ? '欢迎回来' : '创建账号'}
          </h1>
          <p className="text-sm text-white/50 mt-1">
            {mode === 'login' ? '登录以同步您的书籍和单词本' : '注册后可跨设备同步数据'}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-white/5 rounded-xl p-1">
          <button
            onClick={() => { setTab('email'); setError(''); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm transition-colors ${
              tab === 'email' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            <Mail className="w-4 h-4" />
            邮箱
          </button>
          <button
            onClick={() => { setTab('phone'); setError(''); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm transition-colors ${
              tab === 'phone' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            <Phone className="w-4 h-4" />
            手机号
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="昵称"
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
              />
            </div>
          )}

          {tab === 'email' ? (
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱地址"
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
              />
            </div>
          ) : (
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="手机号"
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
              />
            </div>
          )}

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
            />
          </div>

          {mode === 'register' && (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="确认密码"
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#e5a349] hover:bg-[#d4923d] text-black font-medium py-3 rounded-xl"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === 'login' ? (
              '登录'
            ) : (
              '注册'
            )}
          </Button>
        </form>

        {/* Switch mode */}
        <p className="text-center text-sm text-white/50 mt-6">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            onClick={switchMode}
            className="text-[#e5a349] hover:underline ml-1"
          >
            {mode === 'login' ? '立即注册' : '立即登录'}
          </button>
        </p>
      </div>
    </div>
  );
}
