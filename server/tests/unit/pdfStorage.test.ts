import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildPdfFileName, writePdfAtomic, sweepOldPdfs, sweepTmpOrphans } from '../../src/pdf/pdfStorage.js';
import { config } from '../../src/config/index.js';

describe('PDF Storage & Atomicity Layer', () => {
  const testDir = path.join(config.storage.uploadsDir, 'test_pdf_storage');

  beforeEach(async () => {
    if (!fs.existsSync(testDir)) {
      await fs.promises.mkdir(testDir, { recursive: true });
    }
  });

  afterEach(async () => {
    if (fs.existsSync(testDir)) {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    }
  });

  it('generates deterministic UTC epoch versioned filenames', () => {
    const updatedAt = new Date('2026-08-20T12:00:00.000Z');
    const fileName = buildPdfFileName({
      contentId: 42,
      updatedAt,
      langCode: 'am',
    });

    expect(fileName).toBe(`article_42_${updatedAt.getTime()}_am.pdf`);
    expect(fileName).toMatch(/^article_\d+_\d+_(am|en|om|ti)\.pdf$/);
  });

  it('performs atomic writes via temporary files and leaves zero .tmp orphans on failure', async () => {
    const targetPath = path.join(testDir, 'article_fail_test.pdf');

    // Injected failure
    await expect(
      writePdfAtomic(async (tmpPath) => {
        await fs.promises.writeFile(tmpPath, 'Partial corrupt content');
        throw new Error('Simulated disk/rendering crash mid-write');
      }, targetPath)
    ).rejects.toThrow('Simulated disk/rendering crash mid-write');

    // Assert target file does not exist
    expect(fs.existsSync(targetPath)).toBe(false);

    // Assert no orphaned tmp files exist in directory
    const files = await fs.promises.readdir(testDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('successfully writes and atomically renames when render succeeds', async () => {
    const targetPath = path.join(testDir, 'article_success_test.pdf');

    await writePdfAtomic(async (tmpPath) => {
      await fs.promises.writeFile(tmpPath, '%PDF-1.4 Mock PDF stream');
    }, targetPath);

    expect(fs.existsSync(targetPath)).toBe(true);
    const content = await fs.promises.readFile(targetPath, 'utf8');
    expect(content).toContain('%PDF-1.4');
  });
});
