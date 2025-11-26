import { describe, it, expect } from 'vitest';
import {
  sanitizeXMLContent,
  isValidFileType,
  getFileExtension,
} from '@/lib/file-processing/file-sanitizer';

describe('File Sanitizer', () => {
  describe('sanitizeXMLContent', () => {
    it('should remove script tags', () => {
      const maliciousXML = `<kml><script>alert('XSS')</script><Placemark><name>Test</name></Placemark></kml>`;

      const sanitized = sanitizeXMLContent(maliciousXML);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('<Placemark>');
    });

    it('should remove iframe tags', () => {
      const maliciousXML = `<kml><iframe src="evil.com"></iframe><Placemark><name>Test</name></Placemark></kml>`;

      const sanitized = sanitizeXMLContent(maliciousXML);

      expect(sanitized).not.toContain('<iframe>');
      expect(sanitized).toContain('<Placemark>');
    });

    it('should remove onclick event handlers', () => {
      const maliciousXML = `<kml><Placemark onclick="alert('XSS')"><name>Test</name></Placemark></kml>`;

      const sanitized = sanitizeXMLContent(maliciousXML);

      expect(sanitized).not.toContain('onclick');
      expect(sanitized).toContain('<Placemark>');
    });

    it('should remove javascript: protocol', () => {
      const maliciousXML = `<kml><a href="javascript:alert('XSS')">Link</a></kml>`;

      const sanitized = sanitizeXMLContent(maliciousXML);

      expect(sanitized).not.toContain('javascript:');
    });
  });

  describe('isValidFileType', () => {
    it('should accept .kml files', () => {
      expect(isValidFileType('property-boundary.kml')).toBe(true);
      expect(isValidFileType('file.KML')).toBe(true);
    });

    it('should accept .kmz files', () => {
      expect(isValidFileType('property.kmz')).toBe(true);
      expect(isValidFileType('FILE.KMZ')).toBe(true);
    });

    it('should reject other file types', () => {
      expect(isValidFileType('document.pdf')).toBe(false);
      expect(isValidFileType('image.png')).toBe(false);
      expect(isValidFileType('data.json')).toBe(false);
      expect(isValidFileType('file.xml')).toBe(false);
    });
  });

  describe('getFileExtension', () => {
    it('should extract file extension', () => {
      expect(getFileExtension('file.kml')).toBe('kml');
      expect(getFileExtension('property.kmz')).toBe('kmz');
      expect(getFileExtension('FILE.KML')).toBe('kml');
    });

    it('should return empty string for files without extension', () => {
      expect(getFileExtension('filename')).toBe('');
    });
  });
});
