import { useState, useRef } from 'react';
import { User, LogOut, Upload, Edit2, Check, X, Cloud, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { trpc } from '@/providers/trpc';

interface UserPanelProps {
  onLoginClick: () => void;
}

export function UserPanel({ onLoginClick }: UserPanelProps) {
  const { user, isLoggedIn, logout, updateProfile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fullUpload = trpc.sync.fullUpload.useMutation();
  const fullDownload = trpc.sync.fullDownload.useMutation();
  const [syncing, setSyncing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 头像上传
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height, 256);
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const sx = (img.width - size) / 2;
          const sy = (img.height - size) / 2;
          ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
          const compressed = canvas.toDataURL('image/jpeg', 0.7);
          updateProfile({ avatar: compressed });
        }
      };
      img.src = base64;
    };
    reader.readAsDataURL(file);
  };

  // 修改名字
  const handleNameSave = () => {
    if (nameInput.trim()) {
      updateProfile({ name: nameInput.trim() });
    }
    setIsEditingName(false);
  };

  const startEditName = () => {
    setNameInput(user?.name || '');
    setIsEditingName(true);
  };

  // 同步数据到云端
  const handleSyncUp = async () => {
    setSyncing(true);
    try {
      const { BookDB, WordDB, FolderDB, HighlightDB } = await import('@/lib/db');
      const books = await BookDB.getAll();
      const words = await WordDB.getAll();
      const folders = await FolderDB.getAll();
      const highlights = await HighlightDB.getAll();
      const bookmarks = await BookDB.getAllBookmarks();

      await fullUpload.mutateAsync({
        books: books.map(b => ({
          localId: b.id,
          title: b.title,
          author: b.author,
          language: b.language,
          cover: b.cover,
          totalChapters: b.chapters?.length || 0,
          progress: b.progress || 0,
          currentChapter: b.currentChapter || 0,
          chapterData: b.chapters ? JSON.stringify(b.chapters) : undefined,
          folderId: b.folderId,
          lastReadAt: b.lastReadAt ? new Date(b.lastReadAt).toISOString() : undefined,
        })),
        words: words.map(w => ({
          localId: w.id,
          bookId: w.bookId,
          chapterId: w.chapterId,
          word: w.word,
          sentence: w.context,
          aiMeaning: w.aiExplanation,
          dictionary: w.dictionaryDef ? JSON.stringify(w.dictionaryDef) : undefined,
          masteryLevel: w.masteryLevel,
          createdAt: new Date(w.createdAt).toISOString(),
        })),
        folders: folders.map(f => ({
          localId: f.id,
          name: f.name,
        })),
        highlights: highlights.map(h => ({
          localId: h.id,
          bookId: h.bookId,
          chapterIndex: h.chapterIndex,
          chapterId: h.chapterId,
          chapterTitle: h.chapterTitle,
          text: h.text,
          note: h.note,
          color: h.color,
          type: h.type,
          createdAt: new Date(h.createdAt).toISOString(),
        })),
        bookmarks: bookmarks.map(b => ({
          localId: b.id,
          bookId: b.bookId,
          chapterIndex: b.chapterIndex,
          chapterTitle: b.chapterTitle,
          note: b.note,
          scrollPosition: b.scrollPosition,
          createdAt: new Date(b.createdAt).toISOString(),
        })),
      });
      alert('同步成功！');
    } catch (err: any) {
      alert('同步失败：' + (err.message || '未知错误'));
    } finally {
      setSyncing(false);
    }
  };

  // 从云端下载数据
  const handleSyncDown = async () => {
    setDownloading(true);
    try {
      const result = await fullDownload.mutateAsync();
      const { BookDB, WordDB, FolderDB, HighlightDB } = await import('@/lib/db');

      // 恢复文件夹
      for (const f of result.folders) {
        await FolderDB.add({
          id: f.localId,
          name: f.name,
          createdAt: Date.now(),
        });
      }

      // 恢复书籍元数据（文件内容需重新导入）
      for (const b of result.books) {
        const existing = await BookDB.getById(b.localId);
        if (!existing) {
          await BookDB.add({
            id: b.localId,
            title: b.title,
            author: b.author || undefined,
            cover: b.cover || undefined,
            language: (b.language as any) || 'en',
            format: 'txt',
            fileData: '',
            fileType: 'text/plain',
            createdAt: Date.now(),
            lastReadAt: b.lastReadAt ? new Date(b.lastReadAt).getTime() : undefined,
            progress: b.progress,
            currentChapter: b.currentChapter,
            chapters: b.chapterData ? JSON.parse(b.chapterData) : undefined,
            folderId: b.folderId || undefined,
          });
        } else {
          await BookDB.update(b.localId, {
            progress: b.progress,
            currentChapter: b.currentChapter,
            lastReadAt: b.lastReadAt ? new Date(b.lastReadAt).getTime() : undefined,
          });
        }
      }

      // 恢复单词
      for (const w of result.words) {
        await WordDB.add({
          id: w.localId,
          word: w.word,
          bookId: w.bookId,
          chapterId: w.chapterId || undefined,
          context: w.sentence || undefined,
          aiExplanation: w.aiMeaning || undefined,
          dictionaryDef: w.dictionary ? JSON.parse(w.dictionary) : undefined,
          language: 'en',
          createdAt: w.createdAt ? new Date(w.createdAt).getTime() : Date.now(),
          reviewCount: 0,
          masteryLevel: (w.masteryLevel as any) || 0,
        });
      }

      // 恢复高亮
      for (const h of result.highlights) {
        await HighlightDB.add({
          id: h.localId,
          bookId: h.bookId,
          chapterIndex: h.chapterIndex,
          chapterId: h.chapterId || undefined,
          chapterTitle: h.chapterTitle || undefined,
          text: h.text,
          note: h.note || undefined,
          color: h.color || undefined,
          type: (h.type as any) || 'highlight',
          createdAt: h.createdAt ? new Date(h.createdAt).getTime() : Date.now(),
        });
      }

      // 恢复书签
      for (const b of result.bookmarks) {
        await BookDB.addBookmark({
          id: b.localId,
          bookId: b.bookId,
          chapterIndex: b.chapterIndex,
          chapterTitle: b.chapterTitle || undefined,
          note: b.note || undefined,
          scrollPosition: b.scrollPosition || undefined,
          createdAt: b.createdAt ? new Date(b.createdAt).getTime() : Date.now(),
        });
      }

      alert(`下载成功！\n书籍 ${result.books.length} 本\n单词 ${result.words.length} 个\n高亮 ${result.highlights.length} 条\n书签 ${result.bookmarks.length} 个\n\n注意：书籍文件内容需要重新导入才能阅读。`);
    } catch (err: any) {
      alert('下载失败：' + (err.message || '未知错误'));
    } finally {
      setDownloading(false);
    }
  };

  // 未登录状态
  if (!isLoggedIn) {
    return (
      <button
        onClick={onLoginClick}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors text-sm"
      >
        <User className="w-4 h-4" />
        登录
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
      >
        {user?.avatar ? (
          <img
            src={user.avatar}
            alt="avatar"
            className="w-7 h-7 rounded-full object-cover"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-[#e5a349]/20 flex items-center justify-center">
            <User className="w-4 h-4 text-[#e5a349]" />
          </div>
        )}
        <span className="text-sm text-white/80 max-w-[80px] truncate">{user?.name}</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          <div className="absolute right-0 top-full mt-2 w-72 bg-[#282b2f] border border-white/10 rounded-2xl shadow-2xl z-50 p-4 space-y-4">
            {/* 用户信息 */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="relative group flex-shrink-0"
              >
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt="avatar"
                    className="w-14 h-14 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-[#e5a349]/20 flex items-center justify-center">
                    <User className="w-7 h-7 text-[#e5a349]" />
                  </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Upload className="w-4 h-4 text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />

              <div className="flex-1 min-w-0">
                {isEditingName ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      className="bg-white/10 rounded-lg px-2 py-1 text-sm text-white w-full focus:outline-none focus:ring-1 focus:ring-[#e5a349]/50"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleNameSave();
                        if (e.key === 'Escape') setIsEditingName(false);
                      }}
                    />
                    <button onClick={handleNameSave} className="text-green-400 hover:text-green-300">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setIsEditingName(false)} className="text-red-400 hover:text-red-300">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-white font-medium truncate">{user?.name}</span>
                    <button onClick={startEditName} className="text-white/40 hover:text-white/70">
                      <Edit2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <p className="text-xs text-white/40 truncate">
                  {user?.email || user?.phone}
                </p>
              </div>
            </div>

            {/* 同步按钮 */}
            <Button
              onClick={handleSyncUp}
              disabled={syncing || downloading}
              variant="ghost"
              className="w-full bg-[#e5a349]/10 hover:bg-[#e5a349]/20 text-[#e5a349] border border-[#e5a349]/20"
              size="sm"
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Cloud className="w-4 h-4 mr-2" />
              )}
              同步数据到云端
            </Button>

            {/* 下载按钮 */}
            <Button
              onClick={handleSyncDown}
              disabled={syncing || downloading}
              variant="ghost"
              className="w-full bg-white/5 hover:bg-white/10 text-white/70 border border-white/10"
              size="sm"
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              从云端恢复数据
            </Button>

            {/* 退出登录 */}
            <button
              onClick={() => { logout(); setIsOpen(false); }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-red-400 hover:bg-red-500/10 transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </div>
        </>
      )}
    </div>
  );
}
