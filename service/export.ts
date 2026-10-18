import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export async function exportDocument(
  format: string,
  body: string,
): Promise<{ bytes: Buffer; type: string; extension: string }> {
  if (format === 'md')
    return { bytes: Buffer.from(body), type: 'text/markdown; charset=utf-8', extension: 'md' };
  if (format === 'csv')
    return { bytes: Buffer.from(body), type: 'text/csv; charset=utf-8', extension: 'csv' };
  if (format === 'docx') {
    const paragraphs = body.split('\n').map((line) => {
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
    });
    const doc = new Document({
      creator: 'Bitácora',
      title: 'Informe revisado de prácticas',
      sections: [{ properties: {}, children: paragraphs }],
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
  let page = doc.addPage([595, 842]),
    y = 785;
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
  for (const raw of body.split('\n')) {
    const heading = raw.match(/^(#{1,3}) (.*)$/),
      size = heading ? 16 - heading[1].length : 10.5,
      face = heading ? bold : font;
    const words = safe(heading ? heading[2] : raw).split(/\s+/);
    let line = '';
    const lines: string[] = [];
    for (const word of words) {
      for (const part of word.match(/.{1,65}/g) || ['']) {
        const candidate = line ? `${line} ${part}` : part;
        if (face.widthOfTextAtSize(candidate, size) > 475 && line) {
          lines.push(line);
          line = part;
        } else line = candidate;
      }
    }
    lines.push(line);
    for (const l of lines) {
      if (y < 65) {
        page = doc.addPage([595, 842]);
        y = 785;
      }
      page.drawText(l, { x: 60, y, size, font: face, color: rgb(0.09, 0.18, 0.3) });
      y -= size * 1.5;
    }
    y -= 7;
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
