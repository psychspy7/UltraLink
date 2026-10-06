import { describe, it, expect } from 'vitest';
import manifest from '../../app/manifest';

describe('PWA Manifest Specification', () => {
  it('generates a valid standalone PWA manifest', () => {
    const config = manifest();
    expect(config.name).toContain('UltraLink');
    expect(config.short_name).toBe('UltraLink');
    expect(config.display).toBe('standalone');
    expect(config.start_url).toBe('/');
    expect(config.background_color).toBe('#070B14');
    expect(config.theme_color).toBe('#06B6D4');
    expect(config.icons).toBeDefined();
    expect(config.icons?.length).toBeGreaterThanOrEqual(2);
  });
});
