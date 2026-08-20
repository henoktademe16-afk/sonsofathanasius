import { describe, it, expect } from 'vitest';
import { parseHtmlToBlocks } from '../../src/utils/htmlBlocks.js';

describe('HTML to PDF Blocks Parser (Linear Scan)', () => {
  it('parses headings (h1-h6), paragraphs, blockquotes, and lists correctly', () => {
    const html = `
      <h1>Main Title</h1>
      <h2>Section Heading</h2>
      <p>Introductory paragraph with scripture <span data-ref="ማቴ 28:19">ማቴ 28:19</span>.</p>
      <blockquote>Patristic quote on Christology</blockquote>
      <ul>
        <li>First theological dogma</li>
        <li>Second theological dogma</li>
      </ul>
      <ol>
        <li>Step 1</li>
        <li>Step 2</li>
      </ol>
      <pre>console.log('Orthodox');</pre>
    `;

    const blocks = parseHtmlToBlocks(html);

    expect(blocks).toHaveLength(9);
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: 'Main Title' });
    expect(blocks[1]).toEqual({ type: 'heading', level: 2, text: 'Section Heading' });
    expect(blocks[2]).toEqual({ type: 'paragraph', text: 'Introductory paragraph with scripture [ማቴ 28:19].' });
    expect(blocks[3]).toEqual({ type: 'quote', text: 'Patristic quote on Christology' });
    expect(blocks[4]).toEqual({ type: 'list-item', ordered: false, index: 1, text: 'First theological dogma' });
    expect(blocks[5]).toEqual({ type: 'list-item', ordered: false, index: 2, text: 'Second theological dogma' });
    expect(blocks[6]).toEqual({ type: 'list-item', ordered: true, index: 1, text: 'Step 1' });
    expect(blocks[7]).toEqual({ type: 'list-item', ordered: true, index: 2, text: 'Step 2' });
    expect(blocks[8]).toEqual({ type: 'pre', text: "console.log('Orthodox');" });
  });

  it('handles table rows gracefully', () => {
    const html = `
      <table>
        <tr><td>Left Cell</td><td>Right Cell</td></tr>
      </table>
    `;
    const blocks = parseHtmlToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].text).toContain('Left Cell');
    expect(blocks[0].text).toContain('Right Cell');
  });

  it('falls back to newline splitting for unformatted plain text', () => {
    const plain = 'First thought.\n\nSecond thought.';
    const blocks = parseHtmlToBlocks(plain);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'paragraph', text: 'First thought.' });
    expect(blocks[1]).toEqual({ type: 'paragraph', text: 'Second thought.' });
  });

  it('handles adversarial unclosed tags in linear time without catastrophic backtracking', () => {
    const adversarial = '<p>Unclosed paragraph with huge payload' + ' abc'.repeat(5000);
    const start = performance.now();
    const blocks = parseHtmlToBlocks(adversarial);
    const duration = performance.now() - start;

    expect(blocks.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(50); // Under 50ms (strictly linear)
  });
});
