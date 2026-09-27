// Read only the XML text parts of Office Open XML documents; never execute
// macros, follow relationships, or expand arbitrary archive contents.
export async function extractOfficeText(file, maxCharacters = 24_000) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('This Office document is not a readable ZIP archive.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count > 10_000) throw new Error('This Office document has too many parts.');
  const parts = [];
  let expanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('Invalid Office archive.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const local = view.getUint32(offset + 42, true);
    offset +=
      46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (
      !/^(word\/(document|footnotes|endnotes)|ppt\/slides\/slide\d+|xl\/(sharedStrings|worksheets\/sheet\d+))\.xml$/.test(
        name
      )
    )
      continue;
    expanded += uncompressed;
    if (flags & 1 || uncompressed > 8_000_000 || expanded > 24_000_000)
      throw new Error('This Office document is encrypted or exceeds the text extraction limit.');
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50)
      throw new Error('Invalid Office document part.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + size > bytes.length) throw new Error('Incomplete Office document.');
    let data = bytes.subarray(start, start + size);
    if (method === 8) {
      const reader = new Blob([data])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'))
        .getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > uncompressed || length > 8_000_000) {
          await reader.cancel();
          throw new Error('Office part exceeds its declared size.');
        }
        chunks.push(chunk.value);
      }
      data = new Uint8Array(await new Blob(chunks).arrayBuffer());
    } else if (method !== 0) throw new Error('Unsupported Office compression.');
    if (data.length !== uncompressed || data.length > 8_000_000)
      throw new Error('Invalid Office part size.');
    const xml = new TextDecoder().decode(data);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error('Office XML must not define external entities.');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid Office XML.');
    parts.push({ name, doc });
  }
  parts.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  // XML namespaces differ between browser DOMs and the server's lightweight DOM.
  const nodes = (doc, name) =>
    [...doc.querySelectorAll('*')].filter((node) => node.localName.split(':').at(-1) === name);
  const strings = parts.find((part) => part.name === 'xl/sharedStrings.xml');
  const shared = strings
    ? nodes(strings.doc, 'si').map((node) =>
        nodes(node, 't')
          .map((t) => t.textContent)
          .join('')
      )
    : [];
  const text = parts
    .filter((part) => part !== strings)
    .map(({ name, doc }) => {
      if (name.startsWith('xl/'))
        return nodes(doc, 'row')
          .map((row) =>
            nodes(row, 'c')
              .map((cell) => {
                const value =
                  nodes(cell, 'v')[0]?.textContent || nodes(cell, 't')[0]?.textContent || '';
                return cell.getAttribute('t') === 's' ? shared[Number(value)] || '' : value;
              })
              .join('\t')
          )
          .join('\n');
      return nodes(doc, 'p')
        .map((paragraph) =>
          nodes(paragraph, 't')
            .map((node) => node.textContent)
            .join('')
        )
        .join('\n');
    })
    .join('\n\n')
    .trim();
  if (!text) throw new Error('This Office document contains no readable text.');
  return { text: text.slice(0, maxCharacters), truncated: text.length > maxCharacters };
}
