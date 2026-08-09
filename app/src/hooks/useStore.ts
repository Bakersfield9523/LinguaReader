import { useState, useEffect, useCallback } from 'react';
import { BookDB, WordDB, ProgressDB, FolderDB } from '@/lib/db';
import type { Book, WordMarker, ReadingProgress, ReaderSettings, Folder } from '@/types';

// 书籍状态管理
export function useBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    const data = await BookDB.getAll();
    setBooks(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const addBook = useCallback(async (book: Book) => {
    await BookDB.add(book);
    setBooks((prev: Book[]) => [book, ...prev]);
  }, []);

  const deleteBook = useCallback(async (id: string) => {
    await BookDB.delete(id);
    setBooks((prev: Book[]) => prev.filter((b: Book) => b.id !== id));
  }, []);

  const updateBookProgress = useCallback(async (id: string, progress: number, chapter?: number, scrollPosition?: number) => {
    // Compute updates for both state and DB
    const updates: Partial<Book> = { lastReadAt: Date.now() };
    if (progress !== undefined) updates.progress = progress;
    if (chapter !== undefined) updates.currentChapter = chapter;
    if (scrollPosition !== undefined) updates.scrollPosition = scrollPosition;

    // Update React state — only re-render if something actually changed
    setBooks((prev: Book[]) => {
      const book = prev.find((b: Book) => b.id === id);
      if (!book) return prev;
      const chapterChanged = chapter !== undefined && book.currentChapter !== chapter;
      const progressChanged = book.progress !== progress;
      const scrollChanged = scrollPosition !== undefined && book.scrollPosition !== scrollPosition;
      if (!chapterChanged && !progressChanged && !scrollChanged) return prev;
      return prev.map((b: Book) =>
        b.id === id ? { ...b, ...updates } : b
      );
    });

    // Persist to DB — awaited to prevent data loss on page close / navigation
    await BookDB.update(id, updates);
  }, []);

  return { books, loading, addBook, deleteBook, updateBookProgress, refresh: loadBooks };
}

// 单词标记状态管理
export function useWordMarkers() {
  const [words, setWords] = useState<WordMarker[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWords = useCallback(async () => {
    setLoading(true);
    const data = await WordDB.getAll();
    setWords(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  const addWord = useCallback(async (word: WordMarker) => {
    await WordDB.add(word);
    setWords((prev: WordMarker[]) => [word, ...prev]);
  }, []);

  const updateWord = useCallback(async (id: string, updates: Partial<WordMarker>) => {
    await WordDB.update(id, updates);
    setWords((prev: WordMarker[]) => prev.map((w: WordMarker) => 
      w.id === id ? { ...w, ...updates } : w
    ));
  }, []);

  const deleteWord = useCallback(async (id: string) => {
    await WordDB.delete(id);
    setWords((prev: WordMarker[]) => prev.filter((w: WordMarker) => w.id !== id));
  }, []);

  const getWordsByBook = useCallback((bookId: string) => {
    return words.filter((w: WordMarker) => w.bookId === bookId);
  }, [words]);

  const getWordsByChapter = useCallback((bookId: string, chapterId: string) => {
    return words.filter((w: WordMarker) => w.bookId === bookId && w.chapterId === chapterId);
  }, [words]);

  const wordExists = useCallback((word: string, bookId: string) => {
    return words.some((w: WordMarker) => 
      w.bookId === bookId && w.word.toLowerCase() === word.toLowerCase()
    );
  }, [words]);

  return {
    words,
    loading,
    addWord,
    updateWord,
    deleteWord,
    getWordsByBook,
    getWordsByChapter,
    wordExists,
    refresh: loadWords
  };
}

// 阅读进度状态管理
export function useReadingProgress() {
  const saveProgress = useCallback(async (progress: ReadingProgress) => {
    await ProgressDB.save(progress);
  }, []);

  const getProgress = useCallback(async (bookId: string) => {
    return await ProgressDB.getByBookId(bookId);
  }, []);

  return { saveProgress, getProgress };
}

// 阅读器设置
const READER_SETTINGS_KEY = 'reader_settings';

function loadSavedSettings(): ReaderSettings {
  try {
    const saved = localStorage.getItem(READER_SETTINGS_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return {
    fontSize: 18,
    lineHeight: 1.8,
    theme: 'light',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  };
}

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(loadSavedSettings);

  const updateSettings = useCallback((updates: Partial<ReaderSettings>) => {
    setSettings((prev: ReaderSettings) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { settings, updateSettings };
}

// 文件夹状态管理
export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFolders = useCallback(async () => {
    setLoading(true);
    const data = await FolderDB.getAll();
    setFolders(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const addFolder = useCallback(async (folder: Folder) => {
    await FolderDB.add(folder);
    setFolders((prev: Folder[]) => [folder, ...prev]);
  }, []);

  const updateFolder = useCallback(async (id: string, updates: Partial<Folder>) => {
    await FolderDB.update(id, updates);
    setFolders((prev: Folder[]) => prev.map((f: Folder) => 
      f.id === id ? { ...f, ...updates } : f
    ));
  }, []);

  const deleteFolder = useCallback(async (id: string) => {
    await FolderDB.delete(id);
    setFolders((prev: Folder[]) => prev.filter((f: Folder) => f.id !== id));
  }, []);

  return { folders, loading, addFolder, updateFolder, deleteFolder, refresh: loadFolders };
}
