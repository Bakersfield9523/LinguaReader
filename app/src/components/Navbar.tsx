import { BookOpen, Library, Menu, X } from 'lucide-react';
import { useState, useEffect } from 'react';

interface NavbarProps {
  currentView: 'library' | 'reader' | 'vocabulary';
  onViewChange: (view: 'library' | 'reader' | 'vocabulary') => void;
}

export function Navbar({ currentView, onViewChange }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { id: 'library', label: '图书馆', icon: Library },
    { id: 'vocabulary', label: '单词本', icon: BookOpen },
  ] as const;

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-[#282b2f]/90 backdrop-blur-xl shadow-lg'
          : 'bg-transparent'
      }`}
    >
      <div className="w-[90%] max-w-7xl mx-auto h-20 flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={() => onViewChange('library')}
          className="flex items-center gap-3 group"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#e5a349] to-[#d49340] flex items-center justify-center transform group-hover:scale-110 transition-transform duration-300">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">
            Lingua<span className="text-[#e5a349]">Reader</span>
          </span>
        </button>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                className={`relative px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all duration-300 ${
                  isActive
                    ? 'text-white'
                    : 'text-white/75 hover:text-white hover:bg-white/8'
                }`}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-[#e5a349] rounded-xl shadow-lg shadow-[#e5a349]/25" />
                )}
                <span className="relative flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  <span className="font-medium">{item.label}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2 text-white/80 hover:text-white"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-[#282b2f]/95 backdrop-blur-xl border-t border-white/10 p-4">
          <div className="flex flex-col gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onViewChange(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${
                    isActive
                      ? 'bg-[#e5a349] text-white'
                      : 'text-white/75 hover:text-white hover:bg-white/8'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
