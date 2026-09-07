import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, BorderStyle } from 'docx';
import { saveAs } from 'file-saver';
import type { WordMarker, Book } from '@/types';

// 掌握程度标签映射
const masteryLabels: Record<number, string> = {
  0: '新单词',
  1: '初学',
  2: '熟悉',
  3: '掌握中',
  4: '已掌握',
  5: '精通'
};

/**
 * 导出单词本为 Word 文档
 * @param words 单词列表
 * @param books 书籍列表（用于获取书名）
 * @param exportType 导出类型: 'all' | 'byBook'
 */
export async function exportWordsToDocx(
  words: WordMarker[],
  books: Book[],
  exportType: 'all' | 'byBook' = 'all'
): Promise<void> {
  if (!words || words.length === 0) {
    throw new Error('没有可导出的单词');
  }

  const getBookTitle = (bookId: string) => {
    return books.find(b => b.id === bookId)?.title || '未知书籍';
  };

  // 创建文档内容
  const children: Paragraph[] = [];

  // 标题
  children.push(
    new Paragraph({
      text: 'LinguaRead 单词本',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 }
    })
  );

  // 导出日期
  children.push(
    new Paragraph({
      text: `导出日期: ${new Date().toLocaleDateString('zh-CN')}`,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      run: { color: '888888', size: 20 }
    })
  );

  // 统计信息
  children.push(
    new Paragraph({
      text: `共 ${words.length} 个单词`,
      spacing: { after: 400 },
      run: { size: 22, bold: true }
    })
  );

  if (exportType === 'byBook') {
    // 按书籍分组导出
    const grouped: Record<string, WordMarker[]> = {};
    for (const word of words) {
      if (!grouped[word.bookId]) {
        grouped[word.bookId] = [];
      }
      grouped[word.bookId].push(word);
    }

    for (const [bookId, bookWords] of Object.entries(grouped)) {
      // 书籍标题
      children.push(
        new Paragraph({
          text: getBookTitle(bookId),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 }
        })
      );

      children.push(
        new Paragraph({
          text: `${bookWords.length} 个单词`,
          spacing: { after: 200 },
          run: { color: '666666', size: 20 }
        })
      );

      // 添加该书籍的单词表格
      children.push(...createWordTable(bookWords));

      // 分页
      children.push(new Paragraph({ text: '', pageBreakBefore: true }));
    }
  } else {
    // 全部导出为一个表格
    children.push(...createWordTable(words));
  }

  // 创建文档
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: 1440,    // 1 inch
            right: 1440,
            bottom: 1440,
            left: 1440
          }
        }
      },
      children
    }]
  });

  // 生成并下载
  const blob = await Packer.toBlob(doc);
  const fileName = `LinguaRead_单词本_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.docx`;
  saveAs(blob, fileName);
}

/**
 * 创建单词表格
 */
function createWordTable(words: WordMarker[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  for (const word of words) {
    // 单词标题行
    paragraphs.push(
      new Paragraph({
        spacing: { before: 300, after: 100 },
        children: [
          new TextRun({
            text: word.word,
            bold: true,
            size: 28,
            color: 'E5A349'
          }),
          new TextRun({
            text: `  [${masteryLabels[word.masteryLevel]}]`,
            size: 18,
            color: '888888'
          })
        ]
      })
    );

    // 翻译
    if (word.translation) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: '翻译: ', bold: true, size: 20 }),
            new TextRun({ text: word.translation, size: 20 })
          ]
        })
      );
    }

    // 原文语境
    if (word.context) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: '语境: ', bold: true, size: 20 }),
            new TextRun({ text: word.context, size: 20, italics: true, color: '555555' })
          ]
        })
      );
    }

    // 添加日期
    paragraphs.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: `添加于 ${new Date(word.createdAt).toLocaleDateString('zh-CN')}`,
            size: 16,
            color: '999999'
          })
        ]
      })
    );

    // 分隔线
    paragraphs.push(
      new Paragraph({
        border: {
          bottom: {
            color: 'E5A349',
            space: 1,
            style: BorderStyle.SINGLE,
            size: 4
          }
        },
        spacing: { after: 100 }
      })
    );
  }

  return paragraphs;
}

/**
 * 导出单词本为 CSV 格式
 */
export function exportWordsToCSV(words: WordMarker[], books: Book[]): void {
  if (!words || words.length === 0) {
    throw new Error('没有可导出的单词');
  }

  const getBookTitle = (bookId: string) => {
    return books.find(b => b.id === bookId)?.title || '未知书籍';
  };

  // CSV 头部
  const headers = ['单词', '翻译', '语境', '掌握程度', '复习次数', '书籍', '添加日期'];
  const rows = words.map(word => [
    word.word,
    word.translation || '',
    word.context || '',
    masteryLabels[word.masteryLevel],
    word.reviewCount.toString(),
    getBookTitle(word.bookId),
    new Date(word.createdAt).toLocaleDateString('zh-CN')
  ]);

  // 转义 CSV 字段
  const escapeCsv = (field: string): string => {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  };

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCsv).join(','))
  ].join('\n');

  // 下载
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const fileName = `LinguaRead_单词本_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`;
  saveAs(blob, fileName);
}
