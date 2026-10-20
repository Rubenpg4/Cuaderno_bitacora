import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { splitMarkdownTables, type MarkdownAlign, type MarkdownTable } from '../shared/markdown.js';

// Ancho útil de una página A4 de docx con márgenes por defecto, en twips.
const DOCX_TEXT_WIDTH = 9026;
const DOCX_ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const;

function docxParagraph(line: string) {
  const heading = line.match(/^(#{1,3}) (.*)$/);
  return new Paragraph({
    heading: heading
      ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][
          heading[1].length - 1
        ]
      : undefined,
    children: [new TextRun({ text: heading ? heading[2] : line, font: 'Calibri', size: 22 })],
    spacing: { after: 140 },
  });
}

function docxTable(table: MarkdownTable) {
  // Reparte el ancho según el texto más largo de cada columna, con límites razonables.
  const weights = table.head.map((_, column) =>
    Math.min(40, Math.max(6, ...[table.head, ...table.rows].map((row) => row[column].length))),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => Math.floor((weight / total) * DOCX_TEXT_WIDTH));
  const row = (cells: string[], header: boolean) =>
    new TableRow({
      tableHeader: header,
      children: cells.map(
        (text, column) =>
          new TableCell({
            width: { size: widths[column], type: WidthType.DXA },
            children: [
              new Paragraph({
                alignment: table.align[column] ? DOCX_ALIGN[table.align[column]] : undefined,
                children: [new TextRun({ text, bold: header, font: 'Calibri', size: 20 })],
              }),
            ],
          }),
      ),
    });
  return new Table({
    width: { size: DOCX_TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [row(table.head, true), ...table.rows.map((cells) => row(cells, false))],
  });
}

const PAGE: [number, number] = [595, 842];
const LEFT = 60,
  TOP = 785,
  BOTTOM = 65,
  TEXT_WIDTH = 475;
const CELL_SIZE = 9.5,
  CELL_LINE = CELL_SIZE * 1.35,
  CELL_PAD = 4;
const INK = rgb(0.09, 0.18, 0.3);

/** Parte un texto en líneas que caben en `width`; corta también las palabras largas. */
function wrap(text: string, face: PDFFont, size: number, width: number) {
  const fits = (value: string) => face.widthOfTextAtSize(value, size) <= width;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const parts: string[] = [];
    let part = '';
    for (const char of word) {
      if (part && !fits(part + char)) {
        parts.push(part);
        part = '';
      }
      part += char;
    }
    parts.push(part);
    for (const piece of parts) {
      const candidate = line ? `${line} ${piece}` : piece;
      if (line && !fits(candidate)) {
        lines.push(line);
        line = piece;
      } else line = candidate;
    }
  }
  lines.push(line);
  return lines;
}

/** Anchos de columna: el natural si cabe; si no, reparto justo del ancho disponible. */
function columnWidths(natural: number[], total: number) {
  if (natural.reduce((sum, width) => sum + width, 0) <= total) return natural;
  const widths = [...natural];
  let open = natural.map((_, column) => column),
    left = total;
  while (open.length) {
    const share = left / open.length;
    const narrow = open.filter((column) => natural[column] <= share);
    if (!narrow.length) {
      for (const column of open) widths[column] = share;
      break;
    }
    for (const column of narrow) left -= natural[column];
    open = open.filter((column) => natural[column] > share);
  }
  return widths;
}

export async function exportDocument(
  format: string,
  body: string,
): Promise<{ bytes: Buffer; type: string; extension: string }> {
  if (format === 'md')
    return { bytes: Buffer.from(body), type: 'text/markdown; charset=utf-8', extension: 'md' };
  if (format === 'csv')
    return { bytes: Buffer.from(body), type: 'text/csv; charset=utf-8', extension: 'csv' };
  const segments = splitMarkdownTables(body);
  if (format === 'docx') {
    const children = segments.flatMap((segment) =>
      segment.type === 'table' ? [docxTable(segment)] : segment.lines.map(docxParagraph),
    );
    const doc = new Document({
      creator: 'Bitácora',
      title: 'Informe revisado de prácticas',
      sections: [{ properties: {}, children }],
    });
    return {
      bytes: await Packer.toBuffer(doc),
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    };
  }
  if (format !== 'pdf') throw Error('Formato no válido.');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage(PAGE),
    y = TOP;
  const newPage = () => {
    page = doc.addPage(PAGE);
    y = TOP;
  };
  const safe = (s: string) =>
    [...s]
      .map((ch) => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return '?';
        }
      })
      .join('');

  const drawLine = (raw: string) => {
    const heading = raw.match(/^(#{1,3}) (.*)$/),
      size = heading ? 16 - heading[1].length : 10.5,
      face = heading ? bold : font;
    for (const l of wrap(safe(heading ? heading[2] : raw), face, size, TEXT_WIDTH)) {
      if (y < BOTTOM) newPage();
      page.drawText(l, { x: LEFT, y, size, font: face, color: INK });
      y -= size * 1.5;
    }
    y -= 7;
  };

  const drawTable = (table: MarkdownTable) => {
    const natural = table.head.map(
      (_, column) =>
        Math.max(
          ...[table.head, ...table.rows].map((row, index) =>
            (index ? font : bold).widthOfTextAtSize(safe(row[column]), CELL_SIZE),
          ),
        ) +
        2 * CELL_PAD +
        1,
    );
    const widths = columnWidths(natural, TEXT_WIDTH);
    const prepare = (cells: string[], header: boolean) => {
      const face = header ? bold : font;
      const lines = cells.map((cell, column) =>
        wrap(safe(cell), face, CELL_SIZE, widths[column] - 2 * CELL_PAD),
      );
      return { face, header, lines, count: Math.max(...lines.map((cell) => cell.length)) };
    };
    type Row = ReturnType<typeof prepare>;
    const head = prepare(table.head, true);
    // «top» es el borde superior de la siguiente fila; empieza a la altura del texto previo.
    let top = y + CELL_SIZE;
    const lineCapacity = () => Math.floor((top - BOTTOM - 2 * CELL_PAD) / CELL_LINE);
    const slice = (row: Row, from: number, count: number) => {
      const height = count * CELL_LINE + 2 * CELL_PAD;
      let x = LEFT;
      row.lines.forEach((cell, column) => {
        const width = widths[column];
        page.drawRectangle({
          x,
          y: top - height,
          width,
          height,
          borderColor: rgb(0.62, 0.67, 0.73),
          borderWidth: 0.6,
          color: row.header ? rgb(0.92, 0.94, 0.97) : undefined,
        });
        cell.slice(from, from + count).forEach((text, line) => {
          const textWidth = row.face.widthOfTextAtSize(text, CELL_SIZE);
          const align: MarkdownAlign = table.align[column];
          const offset =
            align === 'right'
              ? width - CELL_PAD - textWidth
              : align === 'center'
                ? (width - textWidth) / 2
                : CELL_PAD;
          page.drawText(text, {
            x: x + offset,
            y: top - CELL_PAD - line * CELL_LINE - CELL_SIZE,
            size: CELL_SIZE,
            font: row.face,
            color: INK,
          });
        });
        x += width;
      });
      top -= height;
    };
    // La cabecera se repite en cada página salvo que ocupe casi toda la página.
    const repeatHead =
      Math.floor((TOP - BOTTOM - head.count * CELL_LINE - 4 * CELL_PAD) / CELL_LINE) >= 3;
    const freshPage = (withHead: boolean) => {
      newPage();
      top = y + CELL_SIZE;
      if (withHead) slice(head, 0, head.count);
    };
    const headHeight = head.count * CELL_LINE + 2 * CELL_PAD;
    const freshCapacity = Math.floor(
      (TOP + CELL_SIZE - BOTTOM - 2 * CELL_PAD - (repeatHead ? headHeight : 0)) / CELL_LINE,
    );
    const firstRows = head.count + (table.rows.length ? prepare(table.rows[0], false).count : 0);
    if (lineCapacity() < firstRows + 2) freshPage(false);
    slice(head, 0, head.count);
    for (const cells of table.rows) {
      const row = prepare(cells, false);
      let from = 0;
      while (from < row.count) {
        const fit = lineCapacity(),
          rest = row.count - from;
        // Una fila que cabe entera en una página nueva no se parte.
        if (fit < 1 || (from === 0 && rest > fit && rest <= freshCapacity)) {
          freshPage(repeatHead);
          continue;
        }
        const count = Math.min(fit, rest);
        slice(row, from, count);
        from += count;
      }
    }
    y = top - 18;
  };

  for (const segment of segments) {
    if (segment.type === 'table') drawTable(segment);
    else segment.lines.forEach(drawLine);
  }
  doc.getPages().forEach((p, i) =>
    p.drawText(`Bitácora | ${i + 1} / ${doc.getPageCount()}`, {
      x: 60,
      y: 34,
      size: 8,
      font,
      color: rgb(0.4, 0.45, 0.5),
    }),
  );
  return { bytes: Buffer.from(await doc.save()), type: 'application/pdf', extension: 'pdf' };
}
