import { UrlDiscoveryService } from './url-discovery.service';

describe('UrlDiscoveryService', () => {
  let service: UrlDiscoveryService;

  beforeEach(() => {
    service = new UrlDiscoveryService();
  });

  it('converts ISO standard HTML URL into its official .detail.rss feed', async () => {
    const result = await service.resolveSourceUrl(
      'https://www.iso.org/fr/standard/75100.html',
    );
    expect(result.resolvedUrl).toBe(
      'https://www.iso.org/contents/data/standard/07/51/75100.detail.rss',
    );
    expect(result.detectedType).toBe('RSS');
    expect(result.resolutionMethod).toBe('PATTERN_MATCH');
    expect(result.suggestedOrganization).toBe('ISO');
    expect(result.suggestedCategory).toBe('NORMATIF');
  });

  it('converts ISO technical committee HTML URL into its official .catalogue.rss feed', async () => {
    const result = await service.resolveSourceUrl(
      'https://www.iso.org/fr/committee/54998.html',
    );
    expect(result.resolvedUrl).toBe(
      'https://www.iso.org/contents/data/committee/05/49/54998.catalogue.rss',
    );
    expect(result.detectedType).toBe('RSS');
    expect(result.resolutionMethod).toBe('PATTERN_MATCH');
  });

  it('converts ISO homepage into the latest-standards.rss feed', async () => {
    const result = await service.resolveSourceUrl('https://www.iso.org/fr');
    expect(result.resolvedUrl).toBe(
      'https://www.iso.org/contents/shared/rss/latest-standards.rss',
    );
    expect(result.detectedType).toBe('RSS');
    expect(result.resolutionMethod).toBe('PATTERN_MATCH');
  });
});
