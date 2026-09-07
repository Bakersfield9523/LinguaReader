import { useState, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Library as LibraryIcon,
  BookOpen,
  ChevronRight,
  ChevronDown,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Book, Folder as FolderType } from '@/types';

interface BookshelfSidebarProps {
  books: Book[];
  folders: FolderType[];
  selectedFolderId: string | null | undefined;
  onSelectFolder: (id: string | null | undefined) => void;
  onAddFolder: (folder: FolderType) => void;
  onUpdateFolder: (id: string, updates: Partial<FolderType>) => void;
  onDeleteFolder: (id: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function BookshelfSidebar({
  books,
  folders,
  selectedFolderId,
  onSelectFolder,
  onAddFolder,
  onUpdateFolder,
  onDeleteFolder,
  collapsed,
  onCollapsedChange,
}: BookshelfSidebarProps) {
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderFormData, setFolderFormData] = useState({
    name: '',
    editingId: null as string | null,
  });

  // 我的书架 section 展开状态（跨重启记忆）
  const [myShelvesExpanded, setMyShelvesExpanded] = useState(() => {
    try {
      return localStorage.getItem('bookshelf_my_shelves_expanded') !== '0';
    } catch {
      return true;
    }
  });

  // 管理书架模式：让所有书架的操作按钮常驻显示
  const [manageMode, setManageMode] = useState(false);

  const toggleCollapse = useCallback(() => {
    onCollapsedChange(!collapsed);
  }, [collapsed, onCollapsedChange]);

  const toggleMyShelves = useCallback(() => {
    setMyShelvesExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('bookshelf_my_shelves_expanded', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleManageMode = useCallback(() => {
    setManageMode((prev) => !prev);
  }, []);

  const allCount = books?.length ?? 0;
  const uncategorizedCount = books?.filter((b) => !b.folderId).length ?? 0;

  const openNewFolder = useCallback(() => {
    setFolderFormData({ name: '', editingId: null });
    setFolderDialogOpen(true);
  }, []);

  const openEditFolder = useCallback(
    (folder: FolderType, e: React.MouseEvent) => {
      e.stopPropagation();
      setFolderFormData({ name: folder.name, editingId: folder.id });
      setFolderDialogOpen(true);
    },
    [],
  );

  const handleSaveFolder = useCallback(() => {
    if (!folderFormData.name.trim()) return;
    if (folderFormData.editingId) {
      onUpdateFolder(folderFormData.editingId, { name: folderFormData.name.trim() });
    } else {
      const newFolder: FolderType = {
        id: crypto.randomUUID(),
        name: folderFormData.name.trim(),
        createdAt: Date.now(),
      };
      onAddFolder(newFolder);
    }
    setFolderFormData({ name: '', editingId: null });
    setFolderDialogOpen(false);
  }, [folderFormData, onAddFolder, onUpdateFolder]);

  const ShelfRow = ({
    active,
    onClick,
    icon: Icon,
    label,
    count,
    title,
  }: {
    active: boolean;
    onClick: () => void;
    icon: typeof Folder;
    label: string;
    count?: number;
    title?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? title : undefined}
      className={`w-full flex items-center gap-3 rounded-xl transition-all ${
        collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
      } ${
        active
          ? 'bg-[#e5a349] text-white'
          : 'text-white/70 hover:bg-white/8 hover:text-white'
      }`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 text-left truncate text-sm font-medium">{label}</span>
          {count !== undefined && <span className="text-xs opacity-60">{count}</span>}
        </>
      )}
    </button>
  );

  return (
    <aside
      className={`fixed top-0 left-0 h-screen shrink-0 border-r border-white/10 bg-[#202327] flex flex-col transition-all duration-300 z-50 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center border-b border-white/10 ${
          collapsed
            ? 'flex-col justify-center h-20 py-2 gap-1'
            : 'justify-between h-14 px-3'
        }`}
      >
        {!collapsed ? (
          <div className="flex items-center gap-2 text-white font-semibold">
            <LibraryIcon className="w-5 h-5 text-[#e5a349]" />
            <span>书架</span>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#e5a349] to-[#d49340] flex items-center justify-center shadow-lg shadow-[#e5a349]/25">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
        )}
        <button
          onClick={toggleCollapse}
          className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          title={collapsed ? '展开书架' : '收起书架'}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-5 h-5" />
          ) : (
            <PanelLeftClose className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Shelf list */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        <ShelfRow
          active={selectedFolderId === undefined}
          onClick={() => onSelectFolder(undefined)}
          icon={LibraryIcon}
          label="全部书籍"
          count={allCount}
          title={`全部书籍 (${allCount})`}
        />
        <ShelfRow
          active={selectedFolderId === null}
          onClick={() => onSelectFolder(null)}
          icon={Folder}
          label="未分类"
          count={uncategorizedCount}
          title={`未分类 (${uncategorizedCount})`}
        />

        {!collapsed && (
          <div className="mt-4">
            {/* 我的书架 section header */}
            <button
              type="button"
              onClick={toggleMyShelves}
              className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-white/90 hover:text-white transition-colors"
            >
              <span>我的书架</span>
              {myShelvesExpanded ? (
                <ChevronDown className="w-4 h-4 text-white/60" />
              ) : (
                <ChevronRight className="w-4 h-4 text-white/60" />
              )}
            </button>

            {/* 管理按钮 */}
            <div className="flex gap-2 px-3 mt-1">
              <button
                type="button"
                onClick={openNewFolder}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[#e5a349]/15 hover:bg-[#e5a349]/25 text-[#e5a349] px-2 py-2 text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                新建书架
              </button>
              <button
                type="button"
                onClick={toggleManageMode}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                  manageMode
                    ? 'bg-white/15 text-white'
                    : 'bg-white/8 hover:bg-white/12 text-white/80 hover:text-white'
                }`}
              >
                <Pencil className="w-4 h-4" />
                管理书架
              </button>
            </div>

            {/* 书架列表 */}
            {myShelvesExpanded && (
              <div className="mt-2 space-y-1 px-2">
                {folders.map((folder) => {
                  const count = books?.filter((b) => b.folderId === folder.id).length ?? 0;
                  return (
                    <div key={folder.id} className="relative group">
                      <ShelfRow
                        active={selectedFolderId === folder.id}
                        onClick={() => onSelectFolder(folder.id)}
                        icon={selectedFolderId === folder.id ? FolderOpen : Folder}
                        label={folder.name}
                        count={count}
                      />
                      {/* Shelf actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className={`absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-[#282b2f] border border-white/10 flex items-center justify-center transition-opacity ${
                              manageMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="w-4 h-4 text-white/60" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-[#1e2125] border-white/15">
                          <DropdownMenuItem
                            onClick={(e) => openEditFolder(folder, e)}
                            className="text-white/85 hover:text-white focus:text-white hover:bg-white/8 focus:bg-white/8"
                          >
                            <Edit2 className="w-4 h-4 mr-2" />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                confirm(
                                  `确定要删除书架 "${folder.name}" 吗？书架内的书籍将移至未分类。`,
                                )
                              ) {
                                onDeleteFolder(folder.id);
                              }
                            }}
                            className="text-red-400/90 hover:text-red-300 focus:text-red-300 hover:bg-red-500/10 focus:bg-red-500/10"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 收起侧边栏时：继续用图标行显示书架 */}
        {collapsed &&
          folders.map((folder) => {
            const count = books?.filter((b) => b.folderId === folder.id).length ?? 0;
            return (
              <ShelfRow
                key={folder.id}
                active={selectedFolderId === folder.id}
                onClick={() => onSelectFolder(folder.id)}
                icon={selectedFolderId === folder.id ? FolderOpen : Folder}
                label={folder.name}
                count={count}
                title={`${folder.name} (${count})`}
              />
            );
          })}
      </div>

      {/* Shelf dialog (新建 / 重命名) */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="bg-[#282b2f] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {folderFormData.editingId ? '重命名书架' : '新建书架'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label htmlFor="shelfName" className="text-white/80">
                书架名称
              </Label>
              <Input
                id="shelfName"
                value={folderFormData.name}
                onChange={(e) =>
                  setFolderFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="输入书架名称"
                className="bg-[#1e2125] border-white/10 text-white placeholder:text-white/30 mt-2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveFolder();
                }}
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                variant="ghost"
                onClick={() => {
                  setFolderFormData({ name: '', editingId: null });
                  setFolderDialogOpen(false);
                }}
                className="flex-1 bg-[#1e2125] text-white/85 border border-white/15 hover:bg-[#282b2f] hover:text-white"
              >
                取消
              </Button>
              <Button
                onClick={handleSaveFolder}
                disabled={!folderFormData.name.trim()}
                className="flex-1 bg-[#e5a349] hover:bg-[#d49340] text-white disabled:opacity-50"
              >
                <Plus className="w-4 h-4 mr-2" />
                {folderFormData.editingId ? '保存' : '创建'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
