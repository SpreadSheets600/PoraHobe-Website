export function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatCategoryName(name: string | null | undefined): string {
  if (!name) return 'General';
  // If it has spaces/underscores, split by them
  if (name.includes(' ') || name.includes('_')) {
    return name.replace(/_/g, ' ').split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  // Otherwise split by hyphen (kebab-case)
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
