import localforage from 'localforage';
import type { Book, WordMarker, ReadingProgress, Folder, Bookmark, ReadingDay, Highlight } from '@/types';

// 配置 localforage
localforage.config({
  name: 'LinguaReader',
  version: 1.0,
  storeName: 'data',
  description: 'LinguaReader app data storage'
});

// 创建独立的存储实例
const booksStore = localforage.createInstance({
  name: 'LinguaReader',
  storeName: 'books'
});

const wordsStore = localforage.createInstance({
  name: 'LinguaReader',
  storeName: 'wordMarkers'
});

const progressStore = localforage.createInstance({
  name: 'LinguaReader',
  storeName: 'progress'
});

const settingsStore = localforage.createInstance({
  name: 'LinguaReader',
  storeName: 'settings'
});

const foldersStore = localforage.createInstance({
  name: 'LinguaReader',
  storeName: 'folders'
});

const bookmarksStore = localforage.createInstance({
  name: 'LinguaReader',
  storeName: 'bookmarks'
});

const readingDaysStore = localforage.createInstance({
  name: 'LinguaReader',
  storeName: 'readingDays'
});

const highlightsStore = localforage.createInstance({
  name: 'LinguaReader',
  storeName: 'highlights'
});

// 文件夹相关操作
export const FolderDB = {
  async getAll(): Promise<Folder[]> {
    const folders: Folder[] = [];
    await foldersStore.iterate((value) => {
      folders.push(value as Folder);
    });
    return folders.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  async getById(id: string): Promise<Folder | null> {
    return await foldersStore.getItem(id);
  },

  async add(folder: Folder): Promise<void> {
    await foldersStore.setItem(folder.id, folder);
  },

  async update(id: string, updates: Partial<Folder>): Promise<void> {
    const folder = await this.getById(id);
    if (folder) {
      await foldersStore.setItem(id, { ...folder, ...updates, updatedAt: Date.now() });
    }
  },

  async delete(id: string): Promise<void> {
    await foldersStore.removeItem(id);
    // 将文件夹内的书籍移动到未分类
    const books = await BookDB.getByFolderId(id);
    for (const book of books) {
      await BookDB.update(book.id, { folderId: undefined });
    }
  }
};

// 书籍相关操作
export const BookDB = {
  async getAll(): Promise<Book[]> {
    const books: Book[] = [];
    await booksStore.iterate((value) => {
      books.push(value as Book);
    });
    return books.sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
  },

  async getById(id: string): Promise<Book | null> {
    return await booksStore.getItem(id);
  },

  async getByFolderId(folderId: string | null): Promise<Book[]> {
    const allBooks = await this.getAll();
    if (folderId === null) {
      // 返回未分类的书籍
      return allBooks.filter(b => !b.folderId);
    }
    return allBooks.filter(b => b.folderId === folderId);
  },

  async add(book: Book): Promise<void> {
    await booksStore.setItem(book.id, book);
  },

  async update(id: string, updates: Partial<Book>): Promise<void> {
    const book = await this.getById(id);
    if (book) {
      await booksStore.setItem(id, { ...book, ...updates });
    }
  },

  async delete(id: string): Promise<void> {
    await booksStore.removeItem(id);
    // 级联删除：单词标记
    const words = await WordDB.getByBookId(id);
    for (const word of words) {
      await WordDB.delete(word.id);
    }
    // 级联删除：书签
    const bookmarks = await this.getBookmarks(id);
    for (const bm of bookmarks) {
      await this.deleteBookmark(bm.id);
    }
    // 级联删除：高亮
    const highlights = await HighlightDB.getByBookId(id);
    for (const hl of highlights) {
      await HighlightDB.delete(hl.id);
    }
    // 级联删除：阅读进度
    await ProgressDB.delete(id);
  },

  async updateProgress(id: string, progress: number): Promise<void> {
    await this.update(id, { progress, lastReadAt: Date.now() });
  },

  async updateCurrentChapter(id: string, chapter: number): Promise<void> {
    await this.update(id, { currentChapter: chapter, lastReadAt: Date.now() });
  },

  async moveToFolder(bookId: string, folderId: string | null): Promise<void> {
    await this.update(bookId, { folderId: folderId || undefined });
  },

  // 书签操作
  async getBookmarks(bookId: string): Promise<Bookmark[]> {
    const allBookmarks: Bookmark[] = [];
    await bookmarksStore.iterate((value) => {
      const bm = value as Bookmark;
      if (bm.bookId === bookId) allBookmarks.push(bm);
    });
    return allBookmarks.sort((a, b) => b.createdAt - a.createdAt);
  },

  async addBookmark(bookmark: Bookmark): Promise<void> {
    await bookmarksStore.setItem(bookmark.id, bookmark);
  },

  async deleteBookmark(bookmarkId: string): Promise<void> {
    await bookmarksStore.removeItem(bookmarkId);
  },

  async getAllBookmarks(): Promise<Bookmark[]> {
    const allBookmarks: Bookmark[] = [];
    await bookmarksStore.iterate((value) => {
      allBookmarks.push(value as Bookmark);
    });
    return allBookmarks.sort((a, b) => b.createdAt - a.createdAt);
  }
};

// 单词标记相关操作
export const WordDB = {
  async getAll(): Promise<WordMarker[]> {
    const words: WordMarker[] = [];
    await wordsStore.iterate((value) => {
      words.push(value as WordMarker);
    });
    return words.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getById(id: string): Promise<WordMarker | null> {
    return await wordsStore.getItem(id);
  },

  async getByBookId(bookId: string): Promise<WordMarker[]> {
    const allWords = await this.getAll();
    return allWords.filter(w => w.bookId === bookId);
  },

  async getByChapterId(bookId: string, chapterId: string): Promise<WordMarker[]> {
    const allWords = await this.getAll();
    return allWords.filter(w => w.bookId === bookId && w.chapterId === chapterId);
  },

  async add(word: WordMarker): Promise<void> {
    await wordsStore.setItem(word.id, word);
  },

  async update(id: string, updates: Partial<WordMarker>): Promise<void> {
    const word = await this.getById(id);
    if (word) {
      await wordsStore.setItem(id, { ...word, ...updates });
    }
  },

  async delete(id: string): Promise<void> {
    await wordsStore.removeItem(id);
  },

  async exists(word: string, bookId: string): Promise<boolean> {
    const words = await this.getByBookId(bookId);
    return words.some(w => w.word.toLowerCase() === word.toLowerCase());
  },

  async getStats(): Promise<{ total: number; byBook: Record<string, number>; byMastery: Record<number, number> }> {
    const words = await this.getAll();
    const byBook: Record<string, number> = {};
    const byMastery: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    
    for (const word of words) {
      byBook[word.bookId] = (byBook[word.bookId] || 0) + 1;
      byMastery[word.masteryLevel] = (byMastery[word.masteryLevel] || 0) + 1;
    }
    
    return { total: words.length, byBook, byMastery };
  }
};

// 阅读进度相关操作
export const ProgressDB = {
  async getByBookId(bookId: string): Promise<ReadingProgress | null> {
    return await progressStore.getItem(bookId);
  },

  async save(progress: ReadingProgress): Promise<void> {
    await progressStore.setItem(progress.bookId, progress);
  },

  async delete(bookId: string): Promise<void> {
    await progressStore.removeItem(bookId);
  }
};

// 设置相关操作
export const SettingsDB = {
  async get(key: string): Promise<any> {
    return await settingsStore.getItem(key);
  },

  async set(key: string, value: any): Promise<void> {
    await settingsStore.setItem(key, value);
  }
};

// 阅读日历/时长相关操作
export const ReadingDayDB = {
  async getAll(): Promise<ReadingDay[]> {
    const days: ReadingDay[] = [];
    await readingDaysStore.iterate((value) => {
      days.push(value as ReadingDay);
    });
    return days.sort((a, b) => b.date.localeCompare(a.date));
  },

  async getByDate(date: string): Promise<ReadingDay | null> {
    return await readingDaysStore.getItem(date);
  },

  async getByRange(startDate: string, endDate: string): Promise<ReadingDay[]> {
    const all = await this.getAll();
    return all.filter(d => d.date >= startDate && d.date <= endDate);
  },

  async addMinutes(date: string, minutes: number): Promise<void> {
    const existing = await this.getByDate(date);
    if (existing) {
      await readingDaysStore.setItem(date, {
        ...existing,
        minutes: existing.minutes + minutes,
      });
    } else {
      await readingDaysStore.setItem(date, {
        date,
        minutes,
        bookCount: 1,
      });
    }
  },

  async getStats(): Promise<{ totalDays: number; totalMinutes: number; maxMinutes: number; avgMinutes: number; streak: number }> {
    const days = await this.getAll();
    const totalMinutes = days.reduce((sum, d) => sum + d.minutes, 0);
    const maxMinutes = days.length > 0 ? Math.max(...days.map(d => d.minutes)) : 0;

    // 计算连续阅读天数
    const sortedDates = days.map(d => d.date).sort().reverse();
    let streak = 0;
    const today = new Date();
    const todayStr = formatDateLocal(today);
    const yesterdayStr = formatDateLocal(new Date(today.getTime() - 86400000));

    if (sortedDates.length > 0) {
      const mostRecent = sortedDates[0];
      if (mostRecent === todayStr || mostRecent === yesterdayStr) {
        streak = 1;
        const dateObj = new Date(mostRecent + 'T00:00:00');
        while (true) {
          dateObj.setDate(dateObj.getDate() - 1);
          const prevStr = formatDateLocal(dateObj);
          if (days.some(d => d.date === prevStr)) {
            streak++;
          } else {
            break;
          }
        }
      }
    }

    return {
      totalDays: days.length,
      totalMinutes,
      maxMinutes,
      avgMinutes: days.length > 0 ? Math.round(totalMinutes / days.length) : 0,
      streak,
    };
  },

  async getWeeklyData(): Promise<{ day: string; minutes: number }[]> {
    const today = new Date();
    const weekStart = new Date(today);
    // getDay(): 0=周日,1=周一,...,6=周六
    const daysSinceMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
    weekStart.setDate(today.getDate() - daysSinceMonday);
    const startStr = formatDateLocal(weekStart);
    const endStr = formatDateLocal(today);

    const days = await this.getByRange(startStr, endStr);
    const dayMap = new Map(days.map(d => [d.date, d.minutes]));

    const result: { day: string; minutes: number }[] = [];
    const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const dateStr = formatDateLocal(d);
      result.push({
        day: dayNames[i],
        minutes: dayMap.get(dateStr) || 0,
      });
    }
    return result;
  },

  async getWeeklyTotal(): Promise<number> {
    const weekly = await this.getWeeklyData();
    return weekly.reduce((sum, d) => sum + d.minutes, 0);
  },

  async delete(date: string): Promise<void> {
    await readingDaysStore.removeItem(date);
  }
};

function formatDateLocal(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 文本高亮/下划线操作
export const HighlightDB = {
  async getAll(): Promise<Highlight[]> {
    const highlights: Highlight[] = [];
    await highlightsStore.iterate((value) => {
      highlights.push(value as Highlight);
    });
    return highlights.sort((a, b) => b.createdAt - a.createdAt);
  },

  async getByBookId(bookId: string): Promise<Highlight[]> {
    const all = await this.getAll();
    return all.filter(h => h.bookId === bookId);
  },

  async getByChapterId(bookId: string, chapterIndex: number): Promise<Highlight[]> {
    const all = await this.getAll();
    return all.filter(h => h.bookId === bookId && h.chapterIndex === chapterIndex);
  },

  async add(highlight: Highlight): Promise<void> {
    await highlightsStore.setItem(highlight.id, highlight);
  },

  async update(id: string, updates: Partial<Highlight>): Promise<void> {
    const existing = await highlightsStore.getItem(id) as Highlight | null;
    if (existing) {
      await highlightsStore.setItem(id, { ...existing, ...updates });
    }
  },

  async delete(id: string): Promise<void> {
    await highlightsStore.removeItem(id);
  },

  async exists(bookId: string, text: string, chapterIndex: number): Promise<boolean> {
    const all = await this.getByBookId(bookId);
    return all.some(h => h.text === text && h.chapterIndex === chapterIndex);
  }
};

// 导出所有存储
export { booksStore, wordsStore, progressStore, settingsStore, foldersStore };
