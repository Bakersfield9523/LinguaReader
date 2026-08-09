import { useState, useCallback, useEffect, useMemo } from 'react';
import { Routes, Route, useNavigate } from 'react-router';
import { Navbar } from '@/components/Navbar';
import { Library } from '@/components/Library';
import { Reader } from '@/components/Reader';
import { Vocabulary } from '@/components/Vocabulary';
import { UserPanel } from '@/components/UserPanel';
import { Login } from '@/pages/Login';
import { useBooks, useWordMarkers, useFolders } from '@/hooks/useStore';
import { BookDB } from '@/lib/db';
import type { Book } from '@/types';
import './App.css';

function MainApp() {
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState<'library' | 'reader' | 'vocabulary'>('library');
  const [currentBook, setCurrentBook] = useState<Book | null>(null);

  const { books, loading: booksLoading, addBook, deleteBook, updateBookProgress, refresh: refreshBooks } = useBooks();
  const { words, addWord, updateWord, deleteWord } = useWordMarkers();
  const { folders, loading: foldersLoading, addFolder, updateFolder, deleteFolder } = useFolders();

  // 当 books 数组更新时，同步更新 currentBook 以确保 Reader 收到最新的进度
  // 但只在关键字段实际变化时才更新，避免不必要的重渲染
  useEffect(() => {
    if (currentBook && currentView === 'reader') {
      const updated = books.find(b => b.id === currentBook.id);
      if (updated && (
        updated.progress !== currentBook.progress ||
        updated.currentChapter !== currentBook.currentChapter ||
        updated.scrollPosition !== currentBook.scrollPosition
      )) {
        setCurrentBook(updated);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books]);

  // Memoize word markers for the current book to prevent unnecessary re-renders
  // of PDFCanvasViewer (which is wrapped in memo). Without this, every App-level
  // re-render creates a new array reference from the inline .filter(), breaking
  // memo equality checks and causing the wordMarkers effect to fire redundantly.
  const currentBookWords = useMemo(
    () => currentBook ? words.filter(w => w.bookId === currentBook.id) : [],
    [words, currentBook]
  );

  const handleOpenBook = useCallback((book: Book) => {
    setCurrentBook(book);
    setCurrentView('reader');
  }, []);

  const handleBackToLibrary = useCallback(() => {
    setCurrentBook(null);
    setCurrentView('library');
    // 刷新书籍列表，使最近阅读的书排在最前面
    refreshBooks();
  }, [refreshBooks]);

  const renderView = () => {
    switch (currentView) {
      case 'reader':
        if (!currentBook) return null;
        return (
          <Reader
            book={currentBook}
            wordMarkers={currentBookWords}
            onAddWord={addWord}
            onDeleteWord={deleteWord}
            onUpdateWord={updateWord}
            onBack={handleBackToLibrary}
            onUpdateProgress={updateBookProgress}
          />
        );

      case 'vocabulary':
        return (
          <Vocabulary
            words={words}
            books={books}
            onDeleteWord={deleteWord}
            onUpdateWord={updateWord}
          />
        );

      case 'library':
      default:
        return (
          <Library
            books={books}
            folders={folders}
            onAddBook={addBook}
            onDeleteBook={deleteBook}
            onOpenBook={handleOpenBook}
            onAddFolder={addFolder}
            onUpdateFolder={updateFolder}
            onDeleteFolder={deleteFolder}
            onMoveBook={async (bookId, folderId) => {
              await BookDB.moveToFolder(bookId, folderId);
              refreshBooks();
            }}
            loading={booksLoading || foldersLoading}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1c1f]">
      {/* Background Gradient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-radial from-[#e5a349]/10 via-transparent to-transparent opacity-50" />
        <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-radial from-[#7ca2b5]/5 via-transparent to-transparent opacity-30" />
      </div>

      {/* Navigation */}
      {currentView !== 'reader' && (
        <>
          <Navbar currentView={currentView} onViewChange={setCurrentView} />
          {/* User Panel - 右上角 */}
          <div className="fixed top-4 right-4 z-50">
            <UserPanel onLoginClick={() => navigate('/login')} />
          </div>
        </>
      )}

      {/* Main Content */}
      <main className="relative z-10">
        {renderView()}
      </main>
    </div>
  );
}

function App() {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route path="/login" element={<Login onBack={() => navigate('/')} />} />
      <Route path="/*" element={<MainApp />} />
    </Routes>
  );
}

export default App;
