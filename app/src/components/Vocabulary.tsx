import { useState, useMemo } from 'react';
import { BookOpen, Search, Filter, Trash2, GraduationCap, Clock, CheckCircle, FileDown, Download, Globe, Type, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { exportWordsToDocx, exportWordsToCSV } from '@/lib/exportWords';
import { LANGUAGE_NAMES } from '@/types';
import type { WordMarker, Book, Language } from '@/types';

interface VocabularyProps {
  words: WordMarker[];
  books: Book[];
  onDeleteWord: (id: string) => void;
  onUpdateWord: (id: string, updates: Partial<WordMarker>) => void;
}

// 掌握程度标签
const masteryLabels: Record<number, { label: string; color: string }> = {
  0: { label: '新单词', color: 'bg-gray-500' },
  1: { label: '初学', color: 'bg-red-500' },
  2: { label: '熟悉', color: 'bg-orange-500' },
  3: { label: '掌握中', color: 'bg-yellow-500' },
  4: { label: '已掌握', color: 'bg-blue-500' },
  5: { label: '精通', color: 'bg-green-500' }
};

// 语言标签样式映射
const LANGUAGE_STYLES: Record<Language, { bg: string; text: string; label: string }> = {
  en: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'EN' },
  fr: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'FR' },
  de: { bg: 'bg-yellow-600/20', text: 'text-yellow-400', label: 'DE' },
  ja: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'JP' },
  uk: { bg: 'bg-sky-500/20', text: 'text-sky-400', label: 'UK' },
  pl: { bg: 'bg-pink-500/20', text: 'text-pink-400', label: 'PL' },
};

export function Vocabulary({ words, books, onDeleteWord, onUpdateWord }: VocabularyProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBook, setFilterBook] = useState<string>('all');
  const [filterMastery, setFilterMastery] = useState<string>('all');
  const [selectedWord, setSelectedWord] = useState<WordMarker | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'byBook'>('all');
  const [isExporting, setIsExporting] = useState(false);
  const [filterLanguage, setFilterLanguage] = useState<Language | 'all'>('all');
  const [detailMode, setDetailMode] = useState<'dict' | 'ai'>('dict');

  // 过滤单词
  const filteredWords = useMemo(() => {
    return words.filter(word => {
      const matchesSearch = word.word.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          word.translation?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesBook = filterBook === 'all' || word.bookId === filterBook;
      const matchesMastery = filterMastery === 'all' || word.masteryLevel.toString() === filterMastery;
      const matchesLanguage = filterLanguage === 'all' || word.language === filterLanguage;
      return matchesSearch && matchesBook && matchesMastery && matchesLanguage;
    });
  }, [words, searchQuery, filterBook, filterMastery, filterLanguage]);

  // 按书籍分组
  const wordsByBook = useMemo(() => {
    const grouped: Record<string, WordMarker[]> = {};
    for (const word of filteredWords) {
      if (!grouped[word.bookId]) {
        grouped[word.bookId] = [];
      }
      grouped[word.bookId].push(word);
    }
    return grouped;
  }, [filteredWords]);

  // 统计数据
  const stats = useMemo(() => {
    const total = words.length;
    const byMastery: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const word of words) {
      byMastery[word.masteryLevel] = (byMastery[word.masteryLevel] || 0) + 1;
    }
    return { total, byMastery };
  }, [words]);

  // 获取书籍名称
  const getBookTitle = (bookId: string) => {
    return books.find(b => b.id === bookId)?.title || '未知书籍';
  };

  // 更新掌握程度
  const updateMastery = (wordId: string, level: number) => {
    const currentWord = words.find(w => w.id === wordId);
    const newCount = (currentWord?.reviewCount || 0) + 1;
    onUpdateWord(wordId, {
      masteryLevel: level as 0 | 1 | 2 | 3 | 4 | 5,
      lastReviewAt: Date.now(),
      reviewCount: newCount
    });
    if (selectedWord) {
      setSelectedWord({
        ...selectedWord,
        masteryLevel: level as 0 | 1 | 2 | 3 | 4 | 5,
        reviewCount: newCount,
        lastReviewAt: Date.now()
      });
    }
  };

  return (
    <div className="min-h-screen pt-32 pb-20 px-4">
      <div className="w-[90%] max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl font-bold text-white mb-2">单词本</h1>
          <p className="text-white/70">复习和管理你标记的单词</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
          <div className="bg-[#1e2125] rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-[#e5a349]/20 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-[#e5a349]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
                <p className="text-sm text-white/50">总单词数</p>
              </div>
            </div>
          </div>

          {Object.entries(stats.byMastery).map(([level, count]) => {
            if (count === 0) return null;
            const { label, color } = masteryLabels[parseInt(level)];
            return (
              <div key={level} className="bg-[#1e2125] rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-10 h-10 rounded-xl ${color}/20 flex items-center justify-center`}>
                    <div className={`w-3 h-3 rounded-full ${color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white">{count}</p>
                    <p className="text-sm text-white/50">{label}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-8">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/50" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索单词..."
                className="pl-12 bg-[#1e2125] border-white/10 text-white placeholder:text-white/30 h-12 rounded-xl"
              />
            </div>
          </div>

          <Select value={filterBook} onValueChange={setFilterBook}>
            <SelectTrigger className="w-[180px] bg-[#1e2125] border-white/10 text-white h-12 rounded-xl [&>span]:truncate [&>span]:max-w-[120px]">
              <Filter className="w-4 h-4 mr-2 flex-shrink-0" />
              <SelectValue placeholder="按书籍筛选" />
            </SelectTrigger>
            <SelectContent className="bg-[#282b2f] border-white/10">
              <SelectItem value="all" className="text-white">所有书籍</SelectItem>
              {books.map(book => (
                <SelectItem key={book.id} value={book.id} className="text-white max-w-[260px] truncate" title={book.title}>
                  {book.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterMastery} onValueChange={setFilterMastery}>
            <SelectTrigger className="w-[160px] bg-[#1e2125] border-white/10 text-white h-12 rounded-xl">
              <GraduationCap className="w-4 h-4 mr-2" />
              <SelectValue placeholder="掌握程度" />
            </SelectTrigger>
            <SelectContent className="bg-[#282b2f] border-white/10">
              <SelectItem value="all" className="text-white">所有程度</SelectItem>
              {Object.entries(masteryLabels).map(([level, { label }]) => (
                <SelectItem key={level} value={level} className="text-white">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterLanguage} onValueChange={(v) => setFilterLanguage(v as Language | 'all')}>
            <SelectTrigger className="w-[140px] bg-[#1e2125] border-white/10 text-white h-12 rounded-xl">
              <Globe className="w-4 h-4 mr-2" />
              <SelectValue placeholder="语言" />
            </SelectTrigger>
            <SelectContent className="bg-[#282b2f] border-white/10">
              <SelectItem value="all" className="text-white">所有语言</SelectItem>
              <SelectItem value="en" className="text-white">英文</SelectItem>
              <SelectItem value="fr" className="text-white">法文</SelectItem>
              <SelectItem value="de" className="text-white">德文</SelectItem>
              <SelectItem value="ja" className="text-white">日文</SelectItem>
              <SelectItem value="uk" className="text-white">乌克兰文</SelectItem>
              <SelectItem value="pl" className="text-white">波兰文</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex bg-[#1e2125] rounded-xl p-1">
            <button
              onClick={() => setViewMode('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'all' ? 'bg-[#e5a349] text-white' : 'text-white/75 hover:text-white'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setViewMode('byBook')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'byBook' ? 'bg-[#e5a349] text-white' : 'text-white/75 hover:text-white'
              }`}
            >
              按书籍
            </button>
          </div>

          {/* Export Buttons */}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={words.length === 0 || isExporting}
              onClick={async () => {
                if (words.length === 0) return;
                setIsExporting(true);
                try {
                  await exportWordsToDocx(filteredWords, books, viewMode as 'all' | 'byBook');
                } catch (e: any) {
                  alert('导出失败: ' + (e.message || '未知错误'));
                } finally {
                  setIsExporting(false);
                }
              }}
              className="bg-[#282b2f] text-white/85 border border-white/15 hover:bg-[#33373d] hover:text-white disabled:opacity-40"
            >
              <FileDown className="w-4 h-4 mr-1" />
              Word
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={words.length === 0 || isExporting}
              onClick={() => {
                if (words.length === 0) return;
                try {
                  exportWordsToCSV(filteredWords, books);
                } catch (e: any) {
                  alert('导出失败: ' + (e.message || '未知错误'))
                }
              }}
              className="bg-[#282b2f] text-white/85 border border-white/15 hover:bg-[#33373d] hover:text-white disabled:opacity-40"
            >
              <Download className="w-4 h-4 mr-1" />
              CSV
            </Button>
          </div>
        </div>

        {/* Word List */}
        {filteredWords.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-[#e5a349]/10 flex items-center justify-center mx-auto mb-6">
              <BookOpen className="w-10 h-10 text-[#e5a349]" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">还没有标记的单词</h3>
            <p className="text-white/50">在阅读时点击单词即可添加到单词本</p>
          </div>
        ) : viewMode === 'all' ? (
          <div className="grid gap-3">
            {filteredWords.map((word) => (
              <div
                key={word.id}
                onClick={() => setSelectedWord(word)}
                className="bg-[#1e2125] rounded-xl p-5 flex items-center justify-between cursor-pointer hover:bg-[#25282c] transition-colors group"
              >
                <div className="flex items-center gap-5">
                  <div className={`w-3 h-3 rounded-full ${masteryLabels[word.masteryLevel].color}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-semibold text-white">{word.word}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LANGUAGE_STYLES[word.language].bg} ${LANGUAGE_STYLES[word.language].text}`}>
                        {LANGUAGE_STYLES[word.language].label}
                      </span>
                    </div>
                    <p className="text-sm text-white/50 mt-1">{getBookTitle(word.bookId)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-white/80">{word.translation}</p>
                    <p className="text-sm text-white/40">
                      {word.reviewCount > 0 ? `复习 ${word.reviewCount} 次` : '未复习'}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWord(word.id);
                    }}
                    className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded-lg transition-all"
                  >
                    <Trash2 className="w-5 h-5 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(wordsByBook).map(([bookId, bookWords]) => (
              <div key={bookId}>
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-[#e5a349]" />
                  {getBookTitle(bookId)}
                  <span className="text-sm text-white/50 font-normal">({bookWords.length})</span>
                </h3>
                <div className="grid gap-3">
                  {bookWords.map((word) => (
                    <div
                      key={word.id}
                      onClick={() => setSelectedWord(word)}
                      className="bg-[#1e2125] rounded-xl p-5 flex items-center justify-between cursor-pointer hover:bg-[#25282c] transition-colors group"
                    >
                      <div className="flex items-center gap-5">
                        <div className={`w-3 h-3 rounded-full ${masteryLabels[word.masteryLevel].color}`} />
                        <h3 className="text-xl font-semibold text-white">{word.word}</h3>
                      </div>
                      <div className="flex items-center gap-6">
                        <p className="text-white/80">{word.translation}</p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteWord(word.id);
                          }}
                          className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded-lg transition-all"
                        >
                          <Trash2 className="w-5 h-5 text-red-400" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Word Detail Dialog */}
      <Dialog open={!!selectedWord} onOpenChange={() => setSelectedWord(null)}>
        <DialogContent className="bg-[#282b2f] border-white/10 text-white max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl font-bold">{selectedWord?.word}</DialogTitle>
          </DialogHeader>

          {selectedWord && (
            <div className="space-y-6 mt-4">
              {/* Translation */}
              <div>
                <p className="text-sm text-white/50 mb-1">翻译</p>
                <p className="text-xl text-white/90">{selectedWord.translation}</p>
              </div>

              {/* 词典 / AI 切换按钮 */}
              <div className="flex gap-1 p-1 bg-white/5 rounded-lg">
                <button
                  onClick={() => setDetailMode('dict')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                    detailMode === 'dict'
                      ? 'bg-[#e5a349] text-white'
                      : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  <Type className="w-3.5 h-3.5" />
                  词典释义
                </button>
                <button
                  onClick={() => setDetailMode('ai')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                    detailMode === 'ai'
                      ? 'bg-purple-500 text-white'
                      : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI 解析
                </button>
              </div>

              {/* 词典释义内容 */}
              {detailMode === 'dict' && selectedWord.dictionaryDef && (
                <div className="space-y-3">
                  {selectedWord.dictionaryDef.partOfSpeech && (
                    <span className="inline-block px-3 py-1 rounded-full bg-[#e5a349]/20 text-[#e5a349] text-sm">
                      {selectedWord.dictionaryDef.partOfSpeech}
                    </span>
                  )}
                  <div className="space-y-2">
                    {selectedWord.dictionaryDef.definitions.map((def, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="text-[#e5a349] font-medium flex-shrink-0">{i + 1}.</span>
                        <p className="text-white/70 text-sm">{def}</p>
                      </div>
                    ))}
                  </div>
                  {selectedWord.dictionaryDef.examples && selectedWord.dictionaryDef.examples.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-white/50 mb-2">例句</p>
                      {selectedWord.dictionaryDef.examples.map((ex, i) => (
                        <p key={i} className="text-sm text-white/50 italic pl-3 border-l-2 border-white/10 mb-1">"{ex}"</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {detailMode === 'dict' && !selectedWord.dictionaryDef && (
                <p className="text-sm text-white/40">暂无词典释义</p>
              )}

              {/* AI 解析内容 */}
              {detailMode === 'ai' && selectedWord.aiExplanation && (
                <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
                  <p className="text-sm text-purple-300/80 mb-2 font-medium flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" /> AI 解析
                  </p>
                  <div className="text-white/80 text-sm whitespace-pre-line leading-relaxed">
                    {selectedWord.aiExplanation}
                  </div>
                </div>
              )}
              {detailMode === 'ai' && !selectedWord.aiExplanation && (
                <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center">
                  <Sparkles className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                  <p className="text-sm text-white/60">标记该单词时暂无 AI 解析</p>
                  <p className="text-xs text-white/40 mt-1">在阅读器中点击单词会自动获取 AI 解析并保存</p>
                </div>
              )}

              {/* Context */}
              {selectedWord.context && (
                <div>
                  <p className="text-sm text-white/50 mb-2">原文语境</p>
                  <div className="p-4 rounded-xl bg-white/5 border-l-4 border-[#e5a349]">
                    <p className="text-white/70 italic">"{selectedWord.context}"</p>
                  </div>
                </div>
              )}

              {/* Mastery Level */}
              <div>
                <p className="text-sm text-white/50 mb-3">掌握程度</p>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(masteryLabels).map(([level, { label, color }]) => (
                    <button
                      key={level}
                      onClick={() => updateMastery(selectedWord.id, parseInt(level))}
                      className={`p-3 rounded-xl text-sm font-medium transition-all ${
                        selectedWord.masteryLevel === parseInt(level)
                          ? `${color} text-white`
                          : 'bg-white/5 text-white/60 hover:bg-white/10'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-6 pt-4 border-t border-white/10">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-white/40" />
                  <span className="text-sm text-white/60">
                    添加于 {new Date(selectedWord.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                {selectedWord.lastReviewAt && (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span className="text-sm text-white/60">
                      上次复习 {new Date(selectedWord.lastReviewAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setSelectedWord(null)}
                  className="flex-1 border-white/20 text-white hover:bg-white/5"
                >
                  关闭
                </Button>
                <Button
                  onClick={() => {
                    onDeleteWord(selectedWord.id);
                    setSelectedWord(null);
                  }}
                  variant="destructive"
                  className="flex-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/30"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
