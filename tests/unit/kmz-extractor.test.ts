import { describe, it, expect } from 'vitest';
import { extractKMLFromKMZ } from '@/lib/file-processing/kmz-extractor';
import { FileUploadError } from '@/lib/errors/FileUploadError';
import AdmZip from 'adm-zip';

describe('KMZ Extractor', () => {
  it('should extract KML from valid KMZ with doc.kml', async () => {
    // Create a simple KMZ file in memory
    const zip = new AdmZip();
    const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark><name>Test</name><Point><coordinates>0,0,0</coordinates></Point></Placemark>
</kml>`;

    zip.addFile('doc.kml', Buffer.from(kmlContent, 'utf-8'));
    const kmzBuffer = zip.toBuffer();

    const extracted = await extractKMLFromKMZ(kmzBuffer);

    expect(extracted).toBe(kmlContent);
  });

  it('should extract KML from KMZ with alternative .kml filename', async () => {
    const zip = new AdmZip();
    const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark><name>Test</name></Placemark>
</kml>`;

    zip.addFile('custom-name.kml', Buffer.from(kmlContent, 'utf-8'));
    const kmzBuffer = zip.toBuffer();

    const extracted = await extractKMLFromKMZ(kmzBuffer);

    expect(extracted).toBe(kmlContent);
  });

  it('should throw error if KMZ contains no KML file', async () => {
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('Not a KML file', 'utf-8'));
    const kmzBuffer = zip.toBuffer();

    await expect(extractKMLFromKMZ(kmzBuffer)).rejects.toThrow(FileUploadError);
    await expect(extractKMLFromKMZ(kmzBuffer)).rejects.toThrow('No KML file found');
  });

  it('should throw error if KML in KMZ is empty', async () => {
    const zip = new AdmZip();
    zip.addFile('doc.kml', Buffer.from('', 'utf-8'));
    const kmzBuffer = zip.toBuffer();

    await expect(extractKMLFromKMZ(kmzBuffer)).rejects.toThrow(FileUploadError);
    await expect(extractKMLFromKMZ(kmzBuffer)).rejects.toThrow('empty');
  });

  it('should throw error for corrupted KMZ file', async () => {
    const corruptedBuffer = Buffer.from('This is not a valid ZIP file');

    await expect(extractKMLFromKMZ(corruptedBuffer)).rejects.toThrow(FileUploadError);
    await expect(extractKMLFromKMZ(corruptedBuffer)).rejects.toThrow(/Invalid or corrupted/);
  });
});
