import AdmZip from 'adm-zip';
import { FileUploadError } from '../errors/FileUploadError';

/**
 * Extract KML content from KMZ file (which is a ZIP archive)
 * @param kmzBuffer - KMZ file buffer
 * @returns KML content as string
 * @throws FileUploadError if extraction fails or KML not found
 */
export async function extractKMLFromKMZ(kmzBuffer: Buffer): Promise<string> {
  try {
    const zip = new AdmZip(kmzBuffer);
    const zipEntries = zip.getEntries();

    // Find doc.kml (primary) or any .kml file
    let kmlEntry = zipEntries.find((entry) => entry.entryName === 'doc.kml');

    if (!kmlEntry) {
      // Fallback: find first .kml file
      kmlEntry = zipEntries.find((entry) => entry.entryName.endsWith('.kml'));
    }

    if (!kmlEntry) {
      throw new FileUploadError('No KML file found in KMZ archive', {
        fileType: 'kmz',
        validationErrors: [
          {
            message: 'KMZ must contain a doc.kml file or at least one .kml file',
          },
        ],
      });
    }

    const kmlContent = kmlEntry.getData().toString('utf8');

    if (!kmlContent || kmlContent.trim().length === 0) {
      throw new FileUploadError('KML file in KMZ is empty', {
        fileType: 'kmz',
        validationErrors: [{ message: 'Extracted KML file contains no content' }],
      });
    }

    return kmlContent;
  } catch (error) {
    if (error instanceof FileUploadError) {
      throw error;
    }

    // Handle ZIP parsing errors
    throw new FileUploadError('Invalid or corrupted KMZ file', {
      fileType: 'kmz',
      validationErrors: [
        {
          message:
            error instanceof Error
              ? error.message
              : 'Failed to parse KMZ as ZIP archive',
        },
      ],
    });
  }
}
