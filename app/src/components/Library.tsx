import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, Upload, Trash2, MoreVertical, FileText, X, Check, Globe, Loader2, Image as ImageIcon, Folder, Edit2, Move, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { parseBook, generateDefaultCover } from '@/lib/fileParser';
import { SettingsDB } from '@/lib/db';
import { SettingsDialog } from './SettingsDialog';
import { ReadingCalendar } from './ReadingCalendar';
import { WeeklyReadingCard } from './WeeklyReadingCard';
import { hasApiKey as checkHasApiKey } from '@/lib/aiService';
import type { Book, Folder as FolderType, Language } from '@/types';
import { LANGUAGE_NAMES } from '@/types';

// 语言标签颜色映射（书库卡片上的语言角标）
const LANGUAGE_BADGE_COLOR: Record<Language, string> = {
  en: 'bg-blue-500/80 text-white',
  fr: 'bg-purple-500/80 text-white',
  de: 'bg-yellow-600/80 text-white',
  ja: 'bg-red-500/80 text-white',
  uk: 'bg-sky-500/80 text-white',
  pl: 'bg-pink-500/80 text-white',
};

interface LibraryProps {
  books: Book[];
  folders: FolderType[];
  selectedFolderId: string | null | undefined;
  onAddBook: (book: Book) => void;
  onDeleteBook: (id: string) => void;
  onOpenBook: (book: Book) => void;
  onMoveBook: (bookId: string, folderId: string | null) => void;
  loading: boolean;
}

export function Library({
  books,
  folders,
  selectedFolderId,
  onAddBook,
  onDeleteBook,
  onOpenBook,
  onMoveBook,
  loading
}: LibraryProps) {
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [formData, setFormData] = useState({
    title: '',
    author: '',
    language: 'en' as Language,
    type: '',
    folderId: ''
  });
  const [customCover, setCustomCover] = useState<string | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);
  const [bookToMove, setBookToMove] = useState<string | null>(null);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [hasAiKey, setHasAiKey] = useState(false);
  const [libraryName, setLibraryName] = useState('我的图书馆');
  const [editingLibraryName, setEditingLibraryName] = useState(false);
  const [libraryNameInput, setLibraryNameInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // 加载自定义图书馆名称
  useEffect(() => {
    SettingsDB.get('libraryName').then((name) => {
      if (name && typeof name === 'string') {
        setLibraryName(name);
      }
    });
  }, []);

  // 保存图书馆名称
  const handleSaveLibraryName = useCallback(async () => {
    const trimmed = libraryNameInput.trim();
    if (!trimmed) {
      setEditingLibraryName(false);
      return;
    }
    setLibraryName(trimmed);
    await SettingsDB.set('libraryName', trimmed);
    setEditingLibraryName(false);
  }, [libraryNameInput]);

  const startEditLibraryName = useCallback(() => {
    setLibraryNameInput(libraryName);
    setEditingLibraryName(true);
  }, [libraryName]);

  // 检查 API Key
  useEffect(() => {
    checkHasApiKey().then(setHasAiKey);
  }, []);

  // 获取文件夹内的书籍
  const getBooksInFolder = useCallback((folderId: string | null) => {
    if (!books || !Array.isArray(books)) return [];
    if (folderId === null) {
      return books.filter(b => !b.folderId);
    }
    return books.filter(b => b.folderId === folderId);
  }, [books]);

  // 获取当前选中的文件夹名称
  const getSelectedFolderName = useCallback(() => {
    if (selectedFolderId === null) return '未分类';
    const folder = folders.find(f => f.id === selectedFolderId);
    return folder?.name || '未知书架';
  }, [selectedFolderId, folders]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const fileName = file.name.replace(/\.[^/.]+$/, '');
      setFormData(prev => ({ ...prev, title: fileName }));
    }
  }, []);

  const handleCoverSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setCustomCover(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!selectedFile || !formData.title) return;

    setIsParsing(true);
    setParseProgress(10);
    
    try {
      const progressInterval = setInterval(() => {
        setParseProgress(p => Math.min(p + 10, 80));
      }, 200);
      
      const book = await parseBook(selectedFile, {
        title: formData.title,
        author: formData.author,
        language: formData.language,
        cover: customCover
      });
      
      // 设置文件夹 - 只有选择了具体文件夹时才设置
      if (formData.folderId && formData.folderId !== "uncategorized") {
        book.folderId = formData.folderId;
      }
      
      clearInterval(progressInterval);
      setParseProgress(100);
      
      await onAddBook(book);
      
      setTimeout(() => {
        setImportDialogOpen(false);
        setSelectedFile(null);
        setCustomCover(undefined);
        setFormData({ title: '', author: '', language: 'en', type: '', folderId: '' });
        setParseProgress(0);
      }, 300);
    } catch (error: any) {
      console.error('Import error:', error);
      const errorMessage = error?.message || '导入失败，请检查文件格式';
      alert(`导入失败: ${errorMessage}`);
      setParseProgress(0);
    } finally {
      setIsParsing(false);
    }
  }, [selectedFile, formData, customCover, onAddBook]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.epub') || file.name.endsWith('.pdf') || file.name.endsWith('.txt'))) {
      setSelectedFile(file);
      const fileName = file.name.replace(/\.[^/.]+$/, '');
      setFormData(prev => ({ ...prev, title: fileName }));
      setImportDialogOpen(true);
    } else {
      alert('请上传 EPUB、PDF 或 TXT 格式的文件');
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const generateCover = useCallback(() => {
    if (formData.title) {
      const cover = generateDefaultCover(formData.title);
      setCustomCover(cover);
    }
  }, [formData.title]);

  // 打开移动书籍对话框
  const openMoveDialog = useCallback((bookId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBookToMove(bookId);
    setMoveDialogOpen(true);
  }, []);

  // 移动书籍
  const handleMoveBook = useCallback((folderId: string | null) => {
    if (bookToMove) {
      onMoveBook(bookToMove, folderId);
      setBookToMove(null);
      setMoveDialogOpen(false);
    }
  }, [bookToMove, onMoveBook]);

  // 获取要移动的书籍信息
  const bookToMoveInfo = bookToMove ? books.find(b => b.id === bookToMove) : null;

  if (loading) {
    return (
      <div className="min-h-screen pt-32 pb-20 px-4">
        <div className="w-[90%] max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-10 h-10 animate-spin text-[#e5a349]" />
          </div>
        </div>
      </div>
    );
  }

  // 当前显示的书籍
  const displayBooks = selectedFolderId !== undefined
    ? getBooksInFolder(selectedFolderId as string | null)
    : books;

  return (
    <div className="min-h-screen pt-32 pb-20 px-4">
      <div className="w-[90%] max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            {selectedFolderId !== undefined ? (
              <h1 className="text-4xl font-bold text-white mb-2">
                {getSelectedFolderName()}
              </h1>
            ) : editingLibraryName ? (
              <div className="flex items-center gap-2 mb-2">
                <input
                  autoFocus
                  value={libraryNameInput}
                  onChange={(e) => setLibraryNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveLibraryName();
                    if (e.key === 'Escape') setEditingLibraryName(false);
                  }}
                  maxLength={30}
                  className="text-4xl font-bold bg-transparent text-white border-b-2 border-[#e5a349] outline-none px-1"
                />
                <button
                  onClick={handleSaveLibraryName}
                  className="p-2 rounded-lg bg-[#e5a349] hover:bg-[#d49340] text-white transition-colors"
                >
                  <Check className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setEditingLibraryName(false)}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2 group/title">
                <h1 className="text-4xl font-bold text-white">
                  {libraryName}
                </h1>
                <button
                  onClick={startEditLibraryName}
                  className="opacity-0 group-hover/title:opacity-100 p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/80 transition-all"
                  title="重命名图书馆"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            )}
            <p className="text-white/60">
              {displayBooks.length > 0 
                ? `共 ${displayBooks.length} 本书` 
                : selectedFolderId !== undefined
                  ? '该书架暂无书籍'
                  : '导入你的第一本书，开始阅读之旅'}
            </p>
          </div>
          <div className="flex gap-3">
            {/* Weekly Reading Card */}
            <div className="mr-2">
              <WeeklyReadingCard onClick={() => setShowCalendar(true)} />
            </div>

            {/* AI Settings Button */}
            <Button
              onClick={() => setShowSettingsDialog(true)}
              variant="outline"
              className={`px-4 py-3 relative border ${
                hasAiKey 
                  ? 'bg-purple-500/15 text-purple-300 border-purple-500/30 hover:bg-purple-500/25 hover:text-purple-200' 
                  : 'bg-[#282b2f] text-white/85 border-white/15 hover:bg-[#33373d] hover:text-white'
              }`}
              title="AI 设置"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              <span>AI</span>
              {!hasAiKey && (
                <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-amber-500 rounded-full border-2 border-[#1a1c1f]" />
              )}
            </Button>
            <Button
              onClick={() => {
                // 根据当前选中的书架预设导入对话框的书架选择
                // selectedFolderId: undefined = 全部书籍, null = 未分类, string = 具体书架
                const folderId = selectedFolderId === undefined 
                  ? ''  // 全部书籍视图，不预设书架
                  : selectedFolderId === null 
                    ? 'uncategorized'  // 未分类视图
                    : selectedFolderId;  // 具体书架
                setFormData(prev => ({ ...prev, folderId }));
                setImportDialogOpen(true);
              }}
              className="bg-[#e5a349] hover:bg-[#d49340] text-white px-6 py-3 rounded-xl flex items-center gap-2 shadow-lg shadow-[#e5a349]/25 transition-all hover:scale-105"
            >
              <Plus className="w-5 h-5" />
              <span>导入书籍</span>
            </Button>
          </div>
        </div>

        {/* Books Grid */}
        {books.length === 0 ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`border-2 border-dashed rounded-3xl p-20 text-center transition-all ${
              isDragging 
                ? 'border-[#e5a349] bg-[#e5a349]/5' 
                : 'border-white/20 hover:border-white/40'
            }`}
          >
            <div className="w-24 h-24 rounded-full bg-[#e5a349]/10 flex items-center justify-center mx-auto mb-6">
              <Upload className="w-10 h-10 text-[#e5a349]" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-3">开始你的阅读之旅</h3>
            <p className="text-white/60 mb-8 max-w-md mx-auto">
              拖放 EPUB、PDF 或 TXT 文件到这里，或者点击导入按钮添加书籍
            </p>
            <Button
              onClick={() => setImportDialogOpen(true)}
              className="bg-[#e5a349] hover:bg-[#d49340] text-white px-6 py-3 shadow-lg shadow-[#e5a349]/25"
            >
              <Plus className="w-5 h-5 mr-2" />
              导入第一本书
            </Button>
          </div>
        ) : displayBooks.length === 0 ? (
          <div className="text-center py-20">
            <Folder className="w-16 h-16 text-white/20 mx-auto mb-4" />
            <p className="text-white/40">该书架暂无书籍</p>
            <Button
              onClick={() => setImportDialogOpen(true)}
              className="mt-4 bg-[#e5a349] hover:bg-[#d49340] text-white shadow-md shadow-[#e5a349]/20"
            >
              <Plus className="w-4 h-4 mr-2" />
              导入书籍
            </Button>
          </div>
        ) : (
          <div 
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 transition-all ${
              isDragging ? 'opacity-50' : ''
            }`}
          >
            {/* Add New Card - 放在最前面方便导入新书 */}
            <button
              onClick={() => {
                const folderId = selectedFolderId === undefined 
                  ? '' 
                  : selectedFolderId === null 
                    ? 'uncategorized' 
                    : selectedFolderId;
                setFormData(prev => ({ ...prev, folderId }));
                setImportDialogOpen(true);
              }}
              className="aspect-[2/3] rounded-2xl border-2 border-dashed border-white/30 flex flex-col items-center justify-center gap-4 hover:border-[#e5a349]/60 hover:bg-[#e5a349]/5 transition-all group"
            >
              <div className="w-16 h-16 rounded-full bg-white/8 flex items-center justify-center group-hover:bg-[#e5a349]/15 transition-colors">
                <Plus className="w-8 h-8 text-white/60 group-hover:text-[#e5a349] transition-colors" />
              </div>
              <span className="text-white/60 group-hover:text-[#e5a349] transition-colors font-medium">
                导入新书
              </span>
            </button>
            {displayBooks.map((book, index) => (
              <div
                key={book.id}
                className="group relative animate-fade-in"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                {/* Book Card */}
                <div
                  onClick={() => onOpenBook(book)}
                  className="cursor-pointer bg-[#1e2125] rounded-2xl overflow-hidden shadow-xl transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-[#e5a349]/10"
                >
                  {/* Cover */}
                  <div className="aspect-[2/3] relative overflow-hidden">
                    <img
                      src={book.cover}
                      alt={book.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    {/* Language Badge */}
                    <div className="absolute top-3 left-3">
                      <span className={`px-2 py-1 rounded-lg text-xs font-medium ${LANGUAGE_BADGE_COLOR[book.language]}`}>
                        {LANGUAGE_NAMES[book.language].label}
                      </span>
                    </div>

                    {/* Format Badge */}
                    <div className="absolute top-3 right-3">
                      <span className="px-2 py-1 rounded-lg text-xs font-medium bg-black/60 text-white/80 uppercase">
                        {book.format}
                      </span>
                    </div>

                    {/* Continue Reading Badge */}
                    {book.progress !== undefined && book.progress > 0 && book.progress < 100 && (
                      <div className="absolute bottom-3 left-3 right-3">
                        <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-white/80">继续阅读</span>
                            <span className="text-[#e5a349]">{Math.round(book.progress)}%</span>
                          </div>
                          <Progress value={book.progress} className="h-1" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="font-semibold text-white truncate mb-1" title={book.title}>
                      {book.title}
                    </h3>
                    <p className="text-sm text-white/50 truncate" title={book.author}>
                      {book.author || 'Unknown Author'}
                    </p>
                    
                    {/* Folder Badge */}
                    {book.folderId && folders && Array.isArray(folders) && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-[#e5a349]">
                        <Folder className="w-3 h-3" />
                        <span className="truncate">
                          {folders.find(f => f.id === book.folderId)?.name || '未知书架'}
                        </span>
                      </div>
                    )}
                    
                    {/* Reading Status */}
                    {book.progress === 100 && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-400 mt-2">
                        <Check className="w-3 h-3" />
                        已读完
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button 
                      className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="w-4 h-4 text-white" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-[#1e2125] border-white/15">
                    <DropdownMenuItem
                      onClick={(e) => openMoveDialog(book.id, e)}
                      className="text-white/85 hover:text-white focus:text-white hover:bg-white/8 focus:bg-white/8"
                    >
                      <Move className="w-4 h-4 mr-2" />
                      移动到书架
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-white/15" />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteBook(book.id);
                      }}
                      className="text-red-400/90 hover:text-red-300 focus:text-red-300 hover:bg-red-500/10 focus:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="bg-[#282b2f] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">导入书籍</DialogTitle>
            <DialogDescription className="text-white/60">
              支持 EPUB、PDF 和 TXT 格式
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {/* File Upload */}
            <div
              onClick={() => !isParsing && fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                isParsing 
                  ? 'opacity-50 cursor-not-allowed' 
                  : selectedFile
                    ? 'border-[#e5a349] bg-[#e5a349]/5'
                    : 'border-white/20 hover:border-white/40'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".epub,.pdf,.txt"
                onChange={handleFileSelect}
                disabled={isParsing}
                className="hidden"
              />
              {isParsing ? (
                <div className="space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#e5a349]" />
                  <p className="text-white/60">正在解析书籍...</p>
                  <Progress value={parseProgress} className="w-48 mx-auto" />
                </div>
              ) : selectedFile ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="w-6 h-6 text-[#e5a349]" />
                  <span className="text-white font-medium">{selectedFile.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                    }}
                    className="p-1 hover:bg-white/10 rounded"
                  >
                    <X className="w-4 h-4 text-white/60" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-white/40 mx-auto mb-3" />
                  <p className="text-white/60">点击选择文件或拖放至此</p>
                  <p className="text-white/40 text-sm mt-1">支持 EPUB、PDF、TXT</p>
                </>
              )}
            </div>

            {/* Form Fields */}
            {!isParsing && (
              <>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="title" className="text-white/80">书名</Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="输入书名"
                      className="bg-[#1e2125] border-white/10 text-white placeholder:text-white/30 mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="author" className="text-white/80">作者</Label>
                    <Input
                      id="author"
                      value={formData.author}
                      onChange={(e) => setFormData(prev => ({ ...prev, author: e.target.value }))}
                      placeholder="输入作者（可选）"
                      className="bg-[#1e2125] border-white/10 text-white placeholder:text-white/30 mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="language" className="text-white/80">语言</Label>
                    <Select
                      value={formData.language}
                      onValueChange={(value: Language) => setFormData(prev => ({ ...prev, language: value }))}
                    >
                      <SelectTrigger className="bg-[#1e2125] border-white/10 text-white mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#282b2f] border-white/10">
                        <SelectItem value="en" className="text-white">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-blue-400" />
                            英文
                          </div>
                        </SelectItem>
                        <SelectItem value="fr" className="text-white">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-purple-400" />
                            法文
                          </div>
                        </SelectItem>
                        <SelectItem value="de" className="text-white">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-yellow-400" />
                            德文
                          </div>
                        </SelectItem>
                        <SelectItem value="ja" className="text-white">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-red-400" />
                            日文
                          </div>
                        </SelectItem>
                        <SelectItem value="uk" className="text-white">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-sky-400" />
                            乌克兰文
                          </div>
                        </SelectItem>
                        <SelectItem value="pl" className="text-white">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-pink-400" />
                            波兰文
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Folder Selection */}
                  {folders && folders.length > 0 && (
                    <div>
                      <Label htmlFor="folder" className="text-white/80">书架</Label>
                      <Select
                        value={formData.folderId || "uncategorized"}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, folderId: value === "uncategorized" ? "" : value }))}
                      >
                        <SelectTrigger className="bg-[#1e2125] border-white/10 text-white mt-2">
                          <SelectValue placeholder="选择书架（可选）" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#282b2f] border-white/10">
                          <SelectItem value="uncategorized" className="text-white/60">
                            未分类
                          </SelectItem>
                          {folders.map(folder => (
                            <SelectItem key={folder.id} value={folder.id} className="text-white">
                              <div className="flex items-center gap-2">
                                <Folder className="w-4 h-4 text-[#e5a349]" />
                                {folder.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Cover Selection */}
                  <div>
                    <Label className="text-white/80">书籍封面</Label>
                    <div className="mt-2 space-y-3">
                      {customCover ? (
                        <div className="relative w-32 aspect-[2/3] rounded-lg overflow-hidden">
                          <img src={customCover} alt="Cover preview" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setCustomCover(undefined)}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => coverInputRef.current?.click()}
                            className="flex-1 py-3 px-4 rounded-xl border border-dashed border-white/20 hover:border-[#e5a349]/50 hover:bg-[#e5a349]/5 transition-all flex items-center justify-center gap-2"
                          >
                            <ImageIcon className="w-4 h-4" />
                            <span className="text-sm">上传封面</span>
                          </button>
                          <button
                            onClick={generateCover}
                            className="flex-1 py-3 px-4 rounded-xl border border-dashed border-white/20 hover:border-[#e5a349]/50 hover:bg-[#e5a349]/5 transition-all flex items-center justify-center gap-2"
                          >
                            <ImageIcon className="w-4 h-4" />
                            <span className="text-sm">生成封面</span>
                          </button>
                        </div>
                      )}
                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleCoverSelect}
                        className="hidden"
                      />
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setImportDialogOpen(false);
                      setSelectedFile(null);
                      setCustomCover(undefined);
                      setFormData({ title: '', author: '', language: 'en', type: '', folderId: '' });
                    }}
                    className="flex-1 bg-[#1e2125] text-white/85 border border-white/15 hover:bg-[#282b2f] hover:text-white"
                  >
                    取消
                  </Button>
                  <Button
                    onClick={handleImport}
                    disabled={!selectedFile || !formData.title}
                    className="flex-1 bg-[#e5a349] hover:bg-[#d49340] text-white disabled:opacity-50"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    导入
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Move Book Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent className="bg-[#282b2f] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">移动到书架</DialogTitle>
            <DialogDescription className="text-white/60">
              {bookToMoveInfo && `将 "${bookToMoveInfo.title}" 移动到：`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-4">
            <button
              onClick={() => handleMoveBook(null)}
              className={`w-full px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${
                bookToMoveInfo?.folderId === undefined
                  ? 'bg-[#e5a349]/20 border border-[#e5a349]'
                  : 'bg-[#1e2125] hover:bg-[#282b2f] border border-transparent'
              }`}
            >
              <Folder className="w-5 h-5 text-white/60" />
              <span>未分类</span>
            </button>
            {folders.map(folder => (
              <button
                key={folder.id}
                onClick={() => handleMoveBook(folder.id)}
                className={`w-full px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${
                  bookToMoveInfo?.folderId === folder.id
                    ? 'bg-[#e5a349]/20 border border-[#e5a349]'
                    : 'bg-[#1e2125] hover:bg-[#282b2f] border border-transparent'
                }`}
              >
                <Folder className="w-5 h-5 text-[#e5a349]" />
                <span>{folder.name}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Settings Dialog */}
      {/* Reading Calendar Modal */}
      {showCalendar && (
        <ReadingCalendar onClose={() => setShowCalendar(false)} />
      )}

      <SettingsDialog 
        open={showSettingsDialog} 
        onOpenChange={(open) => {
          setShowSettingsDialog(open);
          // 关闭对话框后重新检查 API Key 状态
          if (!open) {
            checkHasApiKey().then(setHasAiKey);
          }
        }} 
      />
    </div>
  );
}
