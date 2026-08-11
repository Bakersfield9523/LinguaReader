import { useState } from 'react';
import { BookOpen, Mail, Phone, Lock, User, ArrowLeft, Loader2, KeyRound, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

// 纯前端密码强度评估（不发送到服务器）
function getPasswordStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score; // 0-5
}

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
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [error, setError] = useState('');

  // 找回密码流程状态
  const [forgotStep, setForgotStep] = useState<'lookup' | 'answer' | 'reset' | 'done' | null>(null);
  const [forgotAccount, setForgotAccount] = useState('');
  const [forgotQuestion, setForgotQuestion] = useState('');
  const [forgotAnswer, setForgotAnswer] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const strength = getPasswordStrength(password);
  const newStrength = getPasswordStrength(newPassword);
  const strengthMeta = [
    { label: '', bar: 'bg-white/10', text: 'text-white/40' },
    { label: '弱', bar: 'bg-red-400', text: 'text-red-400' },
    { label: '较弱', bar: 'bg-orange-400', text: 'text-orange-400' },
    { label: '中等', bar: 'bg-yellow-400', text: 'text-yellow-400' },
    { label: '强', bar: 'bg-green-400', text: 'text-green-400' },
    { label: '很强', bar: 'bg-green-500', text: 'text-green-500' },
  ][Math.min(strength, 5)];
  const newStrengthMeta = strengthMeta; // 复用同一套

  const { login, register, isLoading, forgotPasswordLookup, verifySecurityAnswer, resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (!name.trim()) { setError('请输入昵称'); return; }
      if (tab === 'email' && !email.trim()) { setError('请输入邮箱'); return; }
      if (tab === 'phone' && !phone.trim()) { setError('请输入手机号'); return; }
      if (password.length < 6) { setError('密码至少6位'); return; }
      if (password !== confirmPassword) { setError('两次密码不一致'); return; }
      if (
        (securityQuestion.trim() && !securityAnswer.trim()) ||
        (!securityQuestion.trim() && securityAnswer.trim())
      ) {
        setError('安全问题和答案需同时填写'); return;
      }

      try {
        await register({
          name: name.trim(),
          ...(tab === 'email' ? { email: email.trim() } : { phone: phone.trim() }),
          password,
          ...(securityQuestion.trim() ? { securityQuestion: securityQuestion.trim() } : {}),
          ...(securityAnswer.trim() ? { securityAnswer: securityAnswer.trim() } : {}),
        });
        onBack();
      } catch (err: any) {
        setError(err.message || '注册失败');
      }
    } else {
      const account = tab === 'email' ? email.trim() : phone.trim();
      if (!account) { setError(tab === 'email' ? '请输入邮箱' : '请输入手机号'); return; }
      if (!password) { setError('请输入密码'); return; }

      try {
        await login(account, password);
        onBack();
      } catch (err: any) {
        setError(err.message || '登录失败');
      }
    }
  };

  const switchMode = () => {
    setMode(prev => prev === 'login' ? 'register' : 'login');
    setError('');
  };

  // ── 找回密码：第一步，查找账户 ──
  const handleForgotLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!forgotAccount.trim()) { setError('请输入手机号或邮箱'); return; }
    try {
      const res = await forgotPasswordLookup(forgotAccount.trim());
      setForgotQuestion(res.securityQuestion);
      setForgotStep('answer');
    } catch (err: any) {
      setError(err.message || '查找失败');
    }
  };

  // ── 找回密码：第二步，验证安全问题 ──
  const handleVerifyAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!forgotAnswer.trim()) { setError('请输入安全问题答案'); return; }
    try {
      const res = await verifySecurityAnswer(forgotAccount.trim(), forgotAnswer.trim());
      setResetToken(res.resetToken);
      setForgotStep('reset');
    } catch (err: any) {
      setError(err.message || '验证失败');
    }
  };

  // ── 找回密码：第三步，重置密码 ──
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) { setError('新密码至少6位'); return; }
    if (newPassword !== confirmNewPassword) { setError('两次密码不一致'); return; }
    try {
      await resetPassword(resetToken, newPassword);
      setForgotStep('done');
    } catch (err: any) {
      setError(err.message || '重置失败');
    }
  };

  const backToLogin = () => {
    setForgotStep(null);
    setForgotAccount('');
    setForgotQuestion('');
    setForgotAnswer('');
    setResetToken('');
    setNewPassword('');
    setConfirmNewPassword('');
    setError('');
  };

  // ── 忘记密码面板 ──
  if (forgotStep) {
    return (
      <div className="min-h-screen bg-[#1a1c1f] flex items-center justify-center p-4">
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-radial from-[#e5a349]/10 via-transparent to-transparent opacity-50" />
        </div>
        <div className="relative z-10 w-full max-w-md">
          <button
            onClick={backToLogin}
            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">返回登录</span>
          </button>

          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#e5a349]/15 mb-4">
              <KeyRound className="w-8 h-8 text-[#e5a349]" />
            </div>
            <h1 className="text-2xl font-bold text-white/90">找回密码</h1>
            <p className="text-sm text-white/50 mt-1">
              {forgotStep === 'lookup' && '输入注册时的手机号或邮箱'}
              {forgotStep === 'answer' && '回答你的安全问题以验证身份'}
              {forgotStep === 'reset' && '设置一个新的密码'}
              {forgotStep === 'done' && '密码已重置'}
            </p>
          </div>

          {forgotStep === 'lookup' && (
            <form onSubmit={handleForgotLookup} className="space-y-4">
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  value={forgotAccount}
                  onChange={(e) => setForgotAccount(e.target.value)}
                  placeholder="手机号或邮箱"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
                />
              </div>
              {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" disabled={isLoading} className="w-full bg-[#e5a349] hover:bg-[#d4923d] text-black font-medium py-3 rounded-xl">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '查找账户'}
              </Button>
            </form>
          )}

          {forgotStep === 'answer' && (
            <form onSubmit={handleVerifyAnswer} className="space-y-4">
              <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/80">
                <ShieldQuestion className="w-4 h-4 inline mr-2 text-[#e5a349]" />
                {forgotQuestion}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  value={forgotAnswer}
                  onChange={(e) => setForgotAnswer(e.target.value)}
                  placeholder="你的答案"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
                />
              </div>
              {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" disabled={isLoading} className="w-full bg-[#e5a349] hover:bg-[#d4923d] text-black font-medium py-3 rounded-xl">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '验证'}
              </Button>
            </form>
          )}

          {forgotStep === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="新密码（至少6位）"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
                />
              </div>
              {newPassword.length > 0 && (
                <div className="px-1 -mt-2">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className={`h-1 flex-1 rounded-full ${i <= newStrength ? newStrengthMeta.bar : 'bg-white/10'}`} />
                    ))}
                  </div>
                  {newStrengthMeta.label && <p className={`text-xs mt-1 ${newStrengthMeta.text}`}>密码强度：{newStrengthMeta.label}</p>}
                </div>
              )}
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="确认新密码"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
                />
              </div>
              {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" disabled={isLoading} className="w-full bg-[#e5a349] hover:bg-[#d4923d] text-black font-medium py-3 rounded-xl">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '重置密码'}
              </Button>
            </form>
          )}

          {forgotStep === 'done' && (
            <div className="space-y-4">
              <div className="text-center text-sm text-green-400 bg-green-500/10 rounded-lg px-3 py-4">
                密码已成功重置，请用新密码登录。
              </div>
              <Button type="button" onClick={backToLogin} className="w-full bg-[#e5a349] hover:bg-[#d4923d] text-black font-medium py-3 rounded-xl">
                返回登录
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

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

          {mode === 'register' && password.length > 0 && (
            <div className="px-1 -mt-2">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i <= strength ? strengthMeta.bar : 'bg-white/10'}`}
                  />
                ))}
              </div>
              {strengthMeta.label && (
                <p className={`text-xs mt-1 ${strengthMeta.text}`}>密码强度：{strengthMeta.label}</p>
              )}
            </div>
          )}

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

          {mode === 'register' && (
            <>
              <div className="relative">
                <ShieldQuestion className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  value={securityQuestion}
                  onChange={(e) => setSecurityQuestion(e.target.value)}
                  placeholder="安全问题（选填，用于找回密码）"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
                />
              </div>
              {securityQuestion.trim() && (
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    value={securityAnswer}
                    onChange={(e) => setSecurityAnswer(e.target.value)}
                    placeholder="安全问题答案"
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e5a349]/50"
                  />
                </div>
              )}
            </>
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

        {mode === 'login' && (
          <p className="text-center text-sm mt-3">
            <button
              onClick={() => { setForgotStep('lookup'); setError(''); }}
              className="text-white/50 hover:text-[#e5a349] transition-colors"
            >
              忘记密码？
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
