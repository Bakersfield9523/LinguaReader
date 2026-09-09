import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2 } from 'lucide-react';

interface PronunciationButtonsProps {
  word: string;
  language: string;
  ukPhonetic?: string;
  usPhonetic?: string;
}

// 有道 dictvoice 支持的非英文语种（le 参数）。
// 乌克兰语/俄语不支持（实测返回 JSON 而非 MP3），须走 TTS 兜底。
const YOUDAO_LE: Record<string, string> = {
  fr: 'fr',
  de: 'de',
  ja: 'jap',
  pl: 'pl',
};

// Web Speech TTS 兜底语言标签
const TTS_LANG: Record<string, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  de: 'de-DE',
  ja: 'ja-JP',
  pl: 'pl-PL',
  uk: 'uk-UA',
};

export function PronunciationButtons({ word, language, ukPhonetic, usPhonetic }: PronunciationButtonsProps) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setSupported(false);
      return;
    }

    // 尝试预加载 voices，部分浏览器/WebView 需要触发 onvoiceschanged 才能返回完整列表
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.onvoiceschanged = () => {
        synth.getVoices();
      };
    }
    return () => {
      synth.onvoiceschanged = null;
      // 组件卸载时停止音频播放
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      synth.cancel();
    };
  }, []);

  // 切换单词时停止上一个音频
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      window.speechSynthesis?.cancel();
      setPlaying(null);
    };
  }, [word]);

  const speakWithTTS = useCallback((accent: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    const all = synth.getVoices() || [];
    const targetLang =
      accent === 'uk' ? 'en-GB'
        : accent === 'us' ? 'en-US'
          : (TTS_LANG[language] || 'en-US');
    const prefix = targetLang.toLowerCase().split('-')[0];
    const voice =
      all.find(v => v.lang.toLowerCase().startsWith(targetLang.toLowerCase())) ||
      all.find(v => v.lang.toLowerCase().startsWith(prefix)) ||
      all[0];

    const utterance = new SpeechSynthesisUtterance(word);
    if (voice) utterance.voice = voice;
    utterance.lang = targetLang;
    utterance.rate = 0.85;

    utterance.onstart = () => setPlaying(accent);
    utterance.onend = () => setPlaying(null);
    utterance.onerror = () => setPlaying(null);

    synth.speak(utterance);
  }, [word, language]);

  const play = useCallback((accent: string) => {
    if (!word) return;

    // 停止上一个播放
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();

    // 有道词典发音：英文 type=0 英音 / type=1 美音；其它语种 le=fr/de/jap/pl。
    // 乌克兰语有道不支持（返回 JSON 而非 MP3），直连 TTS。
    let youdaoUrl: string | null = null;
    if (language === 'en') {
      youdaoUrl = `https://dict.youdao.com/dictvoice?type=${accent === 'uk' ? 0 : 1}&audio=${encodeURIComponent(word)}`;
    } else if (YOUDAO_LE[language]) {
      youdaoUrl = `https://dict.youdao.com/dictvoice?le=${YOUDAO_LE[language]}&audio=${encodeURIComponent(word)}`;
    }

    if (!youdaoUrl) {
      speakWithTTS(accent);
      return;
    }

    setPlaying(accent); // 立即反馈
    const el = new Audio(youdaoUrl);
    audioRef.current = el;
    el.onended = () => { setPlaying(null); audioRef.current = null; };
    el.onerror = () => {
      setPlaying(null);
      audioRef.current = null;
      speakWithTTS(accent); // 有道失败回退 TTS
    };
    el.play().catch(() => {
      setPlaying(null);
      audioRef.current = null;
      speakWithTTS(accent);
    });
  }, [word, language, speakWithTTS]);

  // 非英文：单个按钮（按各自语种发音）
  if (language !== 'en') {
    const phonetic = ukPhonetic || usPhonetic;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); play(language); }}
        disabled={playing !== null}
        className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                   bg-white hover:bg-gray-50 border border-gray-200
                   shadow-[0_1px_3px_rgba(0,0,0,0.08)]
                   transition-all duration-150 disabled:opacity-40"
        title="发音"
      >
        <span className="text-gray-500 text-xs select-none font-medium">发音</span>
        {phonetic ? (
          <span className="text-gray-400 italic text-xs">{`/${phonetic}/`}</span>
        ) : null}
        <Volume2 className={`w-3.5 h-3.5 flex-shrink-0 ${playing ? 'text-[#e5a349] animate-pulse' : 'text-[#e5a349]/70 group-hover:text-[#e5a349]'}`} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* 英式发音 pill */}
      <button
        onClick={(e) => { e.stopPropagation(); play('uk'); }}
        disabled={playing !== null}
        className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                   bg-white hover:bg-gray-50 border border-gray-200
                   shadow-[0_1px_3px_rgba(0,0,0,0.08)]
                   transition-all duration-150 disabled:opacity-40"
        title="英式发音"
      >
        <span className="text-gray-500 text-xs select-none font-medium">英</span>
        {ukPhonetic ? (
          <span className="text-gray-400 italic text-xs">{`/${ukPhonetic}/`}</span>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
        <Volume2 className={`w-3.5 h-3.5 flex-shrink-0 ${playing === 'uk' ? 'text-[#e5a349] animate-pulse' : 'text-[#e5a349]/70 group-hover:text-[#e5a349]'}`} />
      </button>

      {/* 美式发音 pill */}
      <button
        onClick={(e) => { e.stopPropagation(); play('us'); }}
        disabled={playing !== null}
        className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                   bg-white hover:bg-gray-50 border border-gray-200
                   shadow-[0_1px_3px_rgba(0,0,0,0.08)]
                   transition-all duration-150 disabled:opacity-40"
        title="美式发音"
      >
        <span className="text-gray-500 text-xs select-none font-medium">美</span>
        {usPhonetic ? (
          <span className="text-gray-400 italic text-xs">{`/${usPhonetic}/`}</span>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
        <Volume2 className={`w-3.5 h-3.5 flex-shrink-0 ${playing === 'us' ? 'text-[#e5a349] animate-pulse' : 'text-[#e5a349]/70 group-hover:text-[#e5a349]'}`} />
      </button>
    </div>
  );
}
