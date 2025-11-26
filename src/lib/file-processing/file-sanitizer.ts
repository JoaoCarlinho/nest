/**
 * Sanitize XML/KML content by removing potentially malicious tags
 * @param content - XML/KML content string
 * @returns Sanitized content
 */
export function sanitizeXMLContent(content: string): string {
  // Remove script tags (case-insensitive)
  let sanitized = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove iframe tags
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

  // Remove object and embed tags
  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  sanitized = sanitized.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');

  // Remove on* event handlers in tags (e.g., onclick, onerror)
  // Handle both single and double quotes, including nested quotes
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '');  // Double quotes
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*'[^']*'/gi, '');  // Single quotes

  // Remove javascript: protocol in any attributes
  sanitized = sanitized.replace(/javascript:/gi, '');

  return sanitized;
}

/**
 * Validate file type by extension
 * @param filename - Original filename
 * @returns boolean indicating if file type is allowed
 */
export function isValidFileType(filename: string): boolean {
  const allowedExtensions = ['.kml', '.kmz'];
  const lowerFilename = filename.toLowerCase();

  return allowedExtensions.some((ext) => lowerFilename.endsWith(ext));
}

/**
 * Get file extension from filename
 * @param filename - Original filename
 * @returns file extension without dot (e.g., "kml", "kmz")
 */
export function getFileExtension(filename: string): string {
  const match = filename.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}
