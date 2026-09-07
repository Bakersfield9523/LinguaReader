import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { userBooks, userWords, userFolders, userSettings, userHighlights, userBookmarks } from "@db/schema";
import { eq, and } from "drizzle-orm";

export const syncRouter = createRouter({
  // ── 同步书籍 ──
  syncBooks: authedQuery
    .input(
      z.array(
        z.object({
          localId: z.string(),
          title: z.string(),
          author: z.string().optional(),
          language: z.string().default("en"),
          cover: z.string().optional(),
          totalChapters: z.number().default(0),
          progress: z.number().default(0),
          currentChapter: z.number().default(0),
          chapterData: z.string().optional(),
          contentsMap: z.string().optional(),
          folderId: z.string().optional(),
          lastReadAt: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id;

      for (const book of input) {
        const existing = await db
          .select({ id: userBooks.id })
          .from(userBooks)
          .where(and(eq(userBooks.userId, userId), eq(userBooks.localId, book.localId)))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(userBooks)
            .set({
              title: book.title,
              author: book.author || null,
              language: book.language,
              cover: book.cover || null,
              totalChapters: book.totalChapters,
              progress: book.progress,
              currentChapter: book.currentChapter,
              chapterData: book.chapterData || null,
              contentsMap: book.contentsMap || null,
              folderId: book.folderId || null,
              lastReadAt: book.lastReadAt ? new Date(book.lastReadAt) : null,
              updatedAt: new Date(),
            })
            .where(eq(userBooks.id, existing[0].id));
        } else {
          await db.insert(userBooks).values({
            userId,
            localId: book.localId,
            title: book.title,
            author: book.author || null,
            language: book.language,
            cover: book.cover || null,
            totalChapters: book.totalChapters,
            progress: book.progress,
            currentChapter: book.currentChapter,
            chapterData: book.chapterData || null,
            contentsMap: book.contentsMap || null,
            folderId: book.folderId || null,
            lastReadAt: book.lastReadAt ? new Date(book.lastReadAt) : null,
          });
        }
      }
      return { success: true, count: input.length };
    }),

  // ── 获取云端书籍 ──
  getBooks: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select().from(userBooks).where(eq(userBooks.userId, ctx.user.id));
  }),

  // ── 删除云端书籍 ──
  deleteBook: authedQuery
    .input(z.object({ localId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(userBooks)
        .where(and(eq(userBooks.userId, ctx.user.id), eq(userBooks.localId, input.localId)));
      return { success: true };
    }),

  // ── 同步单词 ──
  syncWords: authedQuery
    .input(
      z.array(
        z.object({
          localId: z.string(),
          bookId: z.string(),
          chapterId: z.string().optional(),
          word: z.string(),
          sentence: z.string().optional(),
          paragraph: z.string().optional(),
          aiMeaning: z.string().optional(),
          aiContext: z.string().optional(),
          dictionary: z.string().optional(),
          masteryLevel: z.number().default(0),
          createdAt: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id;

      for (const w of input) {
        const existing = await db
          .select({ id: userWords.id })
          .from(userWords)
          .where(and(eq(userWords.userId, userId), eq(userWords.localId, w.localId)))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(userWords)
            .set({
              bookId: w.bookId,
              chapterId: w.chapterId || null,
              word: w.word,
              sentence: w.sentence || null,
              paragraph: w.paragraph || null,
              aiMeaning: w.aiMeaning || null,
              aiContext: w.aiContext || null,
              dictionary: w.dictionary || null,
              masteryLevel: w.masteryLevel,
            })
            .where(eq(userWords.id, existing[0].id));
        } else {
          await db.insert(userWords).values({
            userId,
            localId: w.localId,
            bookId: w.bookId,
            chapterId: w.chapterId || null,
            word: w.word,
            sentence: w.sentence || null,
            paragraph: w.paragraph || null,
            aiMeaning: w.aiMeaning || null,
            aiContext: w.aiContext || null,
            dictionary: w.dictionary || null,
            masteryLevel: w.masteryLevel,
            createdAt: w.createdAt ? new Date(w.createdAt) : new Date(),
          });
        }
      }
      return { success: true, count: input.length };
    }),

  // ── 获取云端单词 ──
  getWords: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select().from(userWords).where(eq(userWords.userId, ctx.user.id));
  }),

  // ── 删除云端单词 ──
  deleteWord: authedQuery
    .input(z.object({ localId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(userWords)
        .where(and(eq(userWords.userId, ctx.user.id), eq(userWords.localId, input.localId)));
      return { success: true };
    }),

  // ── 同步文件夹 ──
  syncFolders: authedQuery
    .input(
      z.array(
        z.object({
          localId: z.string(),
          name: z.string(),
          color: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id;

      for (const f of input) {
        const existing = await db
          .select({ id: userFolders.id })
          .from(userFolders)
          .where(and(eq(userFolders.userId, userId), eq(userFolders.localId, f.localId)))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(userFolders)
            .set({ name: f.name, color: f.color || null, updatedAt: new Date() })
            .where(eq(userFolders.id, existing[0].id));
        } else {
          await db.insert(userFolders).values({
            userId,
            localId: f.localId,
            name: f.name,
            color: f.color || null,
          });
        }
      }
      return { success: true, count: input.length };
    }),

  // ── 获取云端文件夹 ──
  getFolders: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select().from(userFolders).where(eq(userFolders.userId, ctx.user.id));
  }),

  // ── 同步设置 ──
  syncSettings: authedQuery
    .input(
      z.object({
        aiLanguage: z.string().default("zh"),
        fontSize: z.number().default(18),
        lineHeight: z.number().default(180),
        theme: z.string().default("light"),
        fontFamily: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db
        .select({ id: userSettings.id })
        .from(userSettings)
        .where(eq(userSettings.userId, ctx.user.id))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(userSettings)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(userSettings.id, existing[0].id));
      } else {
        await db.insert(userSettings).values({
          userId: ctx.user.id,
          ...input,
        });
      }
      return { success: true };
    }),

  // ── 获取云端设置 ──
  getSettings: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const found = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, ctx.user.id))
      .limit(1);
    return found[0] || null;
  }),

  // ── 全量同步（上传所有数据）──
  fullUpload: authedQuery
    .input(
      z.object({
        books: z.array(
          z.object({
            localId: z.string(),
            title: z.string(),
            author: z.string().optional(),
            language: z.string().default("en"),
            cover: z.string().optional(),
            totalChapters: z.number().default(0),
            progress: z.number().default(0),
            currentChapter: z.number().default(0),
            chapterData: z.string().optional(),
            contentsMap: z.string().optional(),
            folderId: z.string().optional(),
            lastReadAt: z.string().optional(),
          })
        ).default([]),
        words: z.array(
          z.object({
            localId: z.string(),
            bookId: z.string(),
            chapterId: z.string().optional(),
            word: z.string(),
            sentence: z.string().optional(),
            paragraph: z.string().optional(),
            aiMeaning: z.string().optional(),
            aiContext: z.string().optional(),
            dictionary: z.string().optional(),
            masteryLevel: z.number().default(0),
            createdAt: z.string().optional(),
          })
        ).default([]),
        folders: z.array(
          z.object({
            localId: z.string(),
            name: z.string(),
            color: z.string().optional(),
          })
        ).default([]),
        settings: z.object({
          aiLanguage: z.string().default("zh"),
          fontSize: z.number().default(18),
          lineHeight: z.number().default(180),
          theme: z.string().default("light"),
          fontFamily: z.string().optional(),
        }).optional(),
        highlights: z.array(
          z.object({
            localId: z.string(),
            bookId: z.string(),
            chapterIndex: z.number(),
            chapterId: z.string().optional(),
            chapterTitle: z.string().optional(),
            text: z.string(),
            note: z.string().optional(),
            color: z.string().optional(),
            type: z.string().optional(),
            createdAt: z.string().optional(),
          })
        ).default([]),
        bookmarks: z.array(
          z.object({
            localId: z.string(),
            bookId: z.string(),
            chapterIndex: z.number(),
            chapterTitle: z.string().optional(),
            note: z.string().optional(),
            scrollPosition: z.number().optional(),
            createdAt: z.string().optional(),
          })
        ).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id;

      // 同步书籍
      for (const book of input.books) {
        const existing = await db
          .select({ id: userBooks.id })
          .from(userBooks)
          .where(and(eq(userBooks.userId, userId), eq(userBooks.localId, book.localId)))
          .limit(1);

        if (existing.length > 0) {
          await db.update(userBooks).set({
            title: book.title,
            author: book.author || null,
            language: book.language,
            cover: book.cover || null,
            totalChapters: book.totalChapters,
            progress: book.progress,
            currentChapter: book.currentChapter,
            chapterData: book.chapterData || null,
            contentsMap: book.contentsMap || null,
            folderId: book.folderId || null,
            lastReadAt: book.lastReadAt ? new Date(book.lastReadAt) : null,
            localId: book.localId || book.id,
            updatedAt: new Date(),
          }).where(eq(userBooks.id, existing[0].id));
        } else {
          await db.insert(userBooks).values({
            userId,
            localId: book.localId || book.id,
            title: book.title,
            author: book.author || null,
            language: book.language,
            cover: book.cover || null,
            totalChapters: book.totalChapters,
            progress: book.progress,
            currentChapter: book.currentChapter,
            chapterData: book.chapterData || null,
            contentsMap: book.contentsMap || null,
            folderId: book.folderId || null,
            lastReadAt: book.lastReadAt ? new Date(book.lastReadAt) : null,
          });
        }
      }

      // 同步单词
      for (const w of input.words) {
        const existing = await db
          .select({ id: userWords.id })
          .from(userWords)
          .where(and(eq(userWords.userId, userId), eq(userWords.localId, w.localId || w.id)))
          .limit(1);

        if (existing.length > 0) {
          await db.update(userWords).set({
            bookId: w.bookId,
            chapterId: w.chapterId || null,
            word: w.word,
            sentence: w.sentence || null,
            paragraph: w.paragraph || null,
            aiMeaning: w.aiMeaning || null,
            aiContext: w.aiContext || null,
            dictionary: w.dictionary || null,
            masteryLevel: w.masteryLevel,
            localId: w.localId || w.id,
          }).where(eq(userWords.id, existing[0].id));
        } else {
          await db.insert(userWords).values({
            userId,
            localId: w.localId || w.id,
            bookId: w.bookId,
            chapterId: w.chapterId || null,
            word: w.word,
            sentence: w.sentence || null,
            paragraph: w.paragraph || null,
            aiMeaning: w.aiMeaning || null,
            aiContext: w.aiContext || null,
            dictionary: w.dictionary || null,
            masteryLevel: w.masteryLevel,
            createdAt: w.createdAt ? new Date(w.createdAt) : new Date(),
          });
        }
      }

      // 同步文件夹
      for (const f of input.folders) {
        const existing = await db
          .select({ id: userFolders.id })
          .from(userFolders)
          .where(and(eq(userFolders.userId, userId), eq(userFolders.localId, f.localId || f.id)))
          .limit(1);

        if (existing.length > 0) {
          await db.update(userFolders).set({
            name: f.name,
            color: f.color || null,
            localId: f.localId || f.id,
            updatedAt: new Date(),
          }).where(eq(userFolders.id, existing[0].id));
        } else {
          await db.insert(userFolders).values({
            userId,
            localId: f.localId || f.id,
            name: f.name,
            color: f.color || null,
          });
        }
      }

      // 同步设置
      if (input.settings) {
        const s = input.settings;
        const sExisting = await db
          .select({ id: userSettings.id })
          .from(userSettings)
          .where(eq(userSettings.userId, userId))
          .limit(1);

        if (sExisting.length > 0) {
          await db.update(userSettings).set({
            aiLanguage: s.aiLanguage,
            fontSize: s.fontSize,
            lineHeight: s.lineHeight,
            theme: s.theme,
            fontFamily: s.fontFamily || null,
            updatedAt: new Date(),
          }).where(eq(userSettings.id, sExisting[0].id));
        } else {
          await db.insert(userSettings).values({
            userId,
            aiLanguage: s.aiLanguage,
            fontSize: s.fontSize,
            lineHeight: s.lineHeight,
            theme: s.theme,
            fontFamily: s.fontFamily,
          });
        }
      }

      // 同步高亮
      for (const h of input.highlights) {
        const existing = await db
          .select({ id: userHighlights.id })
          .from(userHighlights)
          .where(and(eq(userHighlights.userId, userId), eq(userHighlights.localId, h.localId)))
          .limit(1);

        if (existing.length > 0) {
          await db.update(userHighlights).set({
            bookId: h.bookId,
            chapterIndex: h.chapterIndex,
            chapterId: h.chapterId || null,
            chapterTitle: h.chapterTitle || null,
            text: h.text,
            note: h.note || null,
            color: h.color || null,
            type: h.type || null,
          }).where(eq(userHighlights.id, existing[0].id));
        } else {
          await db.insert(userHighlights).values({
            userId,
            localId: h.localId,
            bookId: h.bookId,
            chapterIndex: h.chapterIndex,
            chapterId: h.chapterId || null,
            chapterTitle: h.chapterTitle || null,
            text: h.text,
            note: h.note || null,
            color: h.color || null,
            type: h.type || null,
            createdAt: h.createdAt ? new Date(h.createdAt) : new Date(),
          });
        }
      }

      // 同步书签
      for (const b of input.bookmarks) {
        const existing = await db
          .select({ id: userBookmarks.id })
          .from(userBookmarks)
          .where(and(eq(userBookmarks.userId, userId), eq(userBookmarks.localId, b.localId)))
          .limit(1);

        if (existing.length > 0) {
          await db.update(userBookmarks).set({
            bookId: b.bookId,
            chapterIndex: b.chapterIndex,
            chapterTitle: b.chapterTitle || null,
            note: b.note || null,
            scrollPosition: b.scrollPosition ?? null,
          }).where(eq(userBookmarks.id, existing[0].id));
        } else {
          await db.insert(userBookmarks).values({
            userId,
            localId: b.localId,
            bookId: b.bookId,
            chapterIndex: b.chapterIndex,
            chapterTitle: b.chapterTitle || null,
            note: b.note || null,
            scrollPosition: b.scrollPosition ?? null,
            createdAt: b.createdAt ? new Date(b.createdAt) : new Date(),
          });
        }
      }

      return { success: true };
    }),

  // ── 全量下载（获取所有云端数据）──
  fullDownload: authedQuery
    .mutation(async ({ ctx }) => {
    const db = getDb();
    const userId = ctx.user.id;

    const [books, words, folders, settings, highlights, bookmarks] = await Promise.all([
      db.select().from(userBooks).where(eq(userBooks.userId, userId)),
      db.select().from(userWords).where(eq(userWords.userId, userId)),
      db.select().from(userFolders).where(eq(userFolders.userId, userId)),
      db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
      db.select().from(userHighlights).where(eq(userHighlights.userId, userId)),
      db.select().from(userBookmarks).where(eq(userBookmarks.userId, userId)),
    ]);

    return {
      books,
      words,
      folders,
      settings: settings[0] || null,
      highlights,
      bookmarks,
    };
  }),
});
