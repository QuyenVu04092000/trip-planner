import { useState } from 'react';
import { supabase } from '../utils/supabase';
import {
  Plane, Mail, Lock, Eye, EyeOff, ArrowRight,
  CheckCircle, AlertCircle, MapPin, Image, Shield,
} from 'lucide-react';

type Mode = 'login' | 'signup';

// ── Left hero panel ────────────────────────────────────────────────────────────
function HeroPanel() {
  const features = [
    { icon: MapPin,  text: 'Lên kế hoạch từng ngày, từng điểm đến' },
    { icon: Image,   text: 'Lưu ảnh & video kỷ niệm theo chuyến đi' },
    { icon: Shield,  text: 'Dữ liệu riêng tư, chỉ mình bạn thấy' },
  ];

  return (
    <div className="hidden lg:flex lg:w-[52%] relative flex-col justify-between p-12 overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700">

      {/* Decorative blobs */}
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-indigo-400/20 rounded-full blur-2xl pointer-events-none" />

      {/* Top: logo */}
      <div className="relative flex items-center gap-3">
        <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center ring-1 ring-white/30">
          <Plane size={18} className="text-white" />
        </div>
        <span className="text-white font-bold text-lg tracking-tight">TripMemo</span>
      </div>

      {/* Middle: headline + features */}
      <div className="relative space-y-10">
        <div>
          <h2 className="text-4xl font-bold text-white leading-tight tracking-tight">
            Mỗi chuyến đi<br />
            là một<br />
            <span className="text-white/70">câu chuyện.</span>
          </h2>
          <p className="mt-4 text-white/60 text-[15px] leading-relaxed max-w-xs">
            Lên kế hoạch thông minh, lưu giữ kỷ niệm — tất cả trong một nơi duy nhất.
          </p>
        </div>

        <ul className="space-y-4">
          {features.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/15 rounded-lg flex items-center justify-center flex-shrink-0">
                <Icon size={14} className="text-white" />
              </div>
              <span className="text-white/80 text-sm">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom: social proof */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {['🧑‍💼','👩‍🦰','🧔','👩'].map((e, i) => (
              <div key={i} className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/30 flex items-center justify-center text-sm">
                {e}
              </div>
            ))}
          </div>
          <p className="text-white/60 text-xs ml-1">
            Hàng nghìn chuyến đi<br />đã được lưu lại
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Right form panel ───────────────────────────────────────────────────────────
export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const switchMode = (m: Mode) => { setMode(m); setError(null); setSuccess(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess('Đã gửi email xác nhận! Kiểm tra hộp thư và click link để kích hoạt tài khoản.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Đã có lỗi xảy ra';
      if (msg.includes('Invalid login credentials')) setError('Email hoặc mật khẩu không đúng.');
      else if (msg.includes('User already registered')) setError('Email này đã được đăng ký.');
      else if (msg.includes('Password should be at least')) setError('Mật khẩu phải có ít nhất 6 ký tự.');
      else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* Left hero — desktop only */}
      <HeroPanel />

      {/* Right form panel */}
      <div className="flex-1 flex flex-col bg-slate-50 min-h-screen lg:min-h-0">

        {/* Mobile-only top bar */}
        <div className="lg:hidden flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-white">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-violet-600 rounded-lg flex items-center justify-center">
            <Plane size={14} className="text-white" />
          </div>
          <span className="font-bold text-slate-800 text-base tracking-tight">TripMemo</span>
        </div>

        {/* Form area */}
        <div className="flex-1 flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-[380px]">

            {/* Heading */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                {mode === 'login' ? 'Chào mừng trở lại 👋' : 'Tạo tài khoản mới'}
              </h2>
              <p className="text-slate-400 text-sm mt-1.5">
                {mode === 'login'
                  ? 'Đăng nhập để tiếp tục lên kế hoạch.'
                  : 'Miễn phí, không cần thẻ tín dụng.'}
              </p>
            </div>

            {/* Tab */}
            <div className="flex bg-slate-100 rounded-xl p-1 mb-7 gap-1">
              {(['login', 'signup'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                    mode === m
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {m === 'login' ? 'Đăng nhập' : 'Đăng ký'}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Email field */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-500 tracking-widest uppercase">
                  Email
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all shadow-sm"
                  />
                </div>
              </div>

              {/* Password field */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-500 tracking-widest uppercase">
                  Mật khẩu
                </label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Ít nhất 6 ký tự"
                    required
                    minLength={6}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    className="w-full pl-10 pr-11 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Error banner */}
              {error && (
                <div className="flex items-start gap-2.5 px-3.5 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Success banner */}
              {success && (
                <div className="flex items-start gap-2.5 px-3.5 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm">
                  <CheckCircle size={15} className="flex-shrink-0 mt-0.5" />
                  <span>{success}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="relative w-full py-3 mt-1 rounded-xl font-semibold text-sm text-white overflow-hidden group disabled:opacity-60 transition-all duration-200 active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 60%, #8b5cf6 100%)' }}
              >
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-200" />
                <span className="relative flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {mode === 'login' ? 'Đang đăng nhập...' : 'Đang tạo tài khoản...'}
                    </>
                  ) : (
                    <>
                      {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
                      <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform duration-200" />
                    </>
                  )}
                </span>
              </button>
            </form>

            {/* Switch mode text link */}
            <p className="text-center text-slate-400 text-sm mt-6">
              {mode === 'login' ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? '}
              <button
                onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                className="text-blue-500 hover:text-blue-600 font-semibold transition-colors"
              >
                {mode === 'login' ? 'Đăng ký miễn phí' : 'Đăng nhập'}
              </button>
            </p>
          </div>
        </div>

        {/* Bottom footer */}
        <div className="px-5 py-4 border-t border-slate-100 text-center lg:text-right lg:px-10">
          <p className="text-slate-300 text-xs">
            © 2025 TripMemo · Dữ liệu được mã hóa & bảo mật
          </p>
        </div>
      </div>
    </div>
  );
}
