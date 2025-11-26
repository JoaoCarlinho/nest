import { test, expect } from '@playwright/test';

/**
 * End-to-end API tests for slope analysis
 *
 * Tests complete workflow:
 * 1. POST /api/terrain/slope/calculate - Trigger calculation
 * 2. GET /api/terrain/slope/:projectId - Retrieve results
 * 3. GET /api/terrain/slope/:projectId/geotiff - Download GeoTIFF
 * 4. GET /api/terrain/slope/:projectId/heatmap - Download heatmap
 * 5. GET /api/terrain/slope/:projectId/statistics - Get statistics
 */

test.describe('Slope Analysis API', () => {
  const testProjectId = 'test-project-slope-001';

  test.skip('should complete full slope analysis workflow', async ({ request }) => {
    // This test validates the complete workflow from AC#1-6

    // Step 1: Trigger slope calculation
    const calculateResponse = await request.post('/api/terrain/slope/calculate', {
      data: {
        projectId: testProjectId,
        smoothingEnabled: false,
        maxBuildableSlope: 15.0,
        flatThreshold: 5.0,
        moderateThreshold: 15.0,
        steepThreshold: 25.0
      }
    });

    expect(calculateResponse.ok()).toBeTruthy();
    const calculateData = await calculateResponse.json();
    expect(calculateData.success).toBe(true);
    expect(calculateData.data.status).toBe('processing');

    // Step 2: Poll for completion (in real scenario)
    // await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 3: Retrieve slope analysis results
    const resultsResponse = await request.get(`/api/terrain/slope/${testProjectId}`);
    expect(resultsResponse.ok()).toBeTruthy();

    const resultsData = await resultsResponse.json();
    expect(resultsData.success).toBe(true);
    expect(resultsData.data.statistics).toBeDefined();
    expect(resultsData.data.outputs).toBeDefined();

    // Validate statistics structure
    const stats = resultsData.data.statistics;
    expect(stats.meanSlope).toBeDefined();
    expect(stats.medianSlope).toBeDefined();
    expect(stats.maxSlope).toBeDefined();
    expect(stats.distribution).toBeDefined();

    // Validate percentages sum to 100%
    const total = stats.distribution.flatPercent +
                  stats.distribution.moderatePercent +
                  stats.distribution.steepPercent +
                  stats.distribution.verySteepPercent;
    expect(Math.abs(total - 100)).toBeLessThan(0.1);

    // Step 4: Download GeoTIFF
    const geotiffResponse = await request.get(
      `/api/terrain/slope/${testProjectId}/geotiff?type=slope`
    );
    expect(geotiffResponse.ok()).toBeTruthy();

    // Step 5: Download classified GeoTIFF
    const classifiedResponse = await request.get(
      `/api/terrain/slope/${testProjectId}/geotiff?type=classified`
    );
    expect(classifiedResponse.ok()).toBeTruthy();

    // Step 6: Download heatmap
    const heatmapResponse = await request.get(
      `/api/terrain/slope/${testProjectId}/heatmap`
    );
    expect(heatmapResponse.ok()).toBeTruthy();

    // Step 7: Get statistics
    const statisticsResponse = await request.get(
      `/api/terrain/slope/${testProjectId}/statistics`
    );
    expect(statisticsResponse.ok()).toBeTruthy();

    const statisticsData = await statisticsResponse.json();
    expect(statisticsData.success).toBe(true);
    expect(statisticsData.data.statistics.buildability).toBeDefined();
  });

  test.skip('should return error when DEM is missing', async ({ request }) => {
    // Test error handling for missing prerequisite (Story 1.4)

    const response = await request.post('/api/terrain/slope/calculate', {
      data: {
        projectId: 'project-without-dem'
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Elevation grid');
    expect(data.details.requiredStory).toBe('1.4 - Elevation Grid Generation');
  });

  test.skip('should return error for invalid slope thresholds', async ({ request }) => {
    // Test validation of slope thresholds

    const response = await request.post('/api/terrain/slope/calculate', {
      data: {
        projectId: testProjectId,
        flatThreshold: 15.0,    // Invalid: flat > moderate
        moderateThreshold: 5.0,
        steepThreshold: 25.0
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Thresholds must be increasing');
  });

  test.skip('should return error for invalid maxBuildableSlope', async ({ request }) => {
    // Test validation of maxBuildableSlope

    const response = await request.post('/api/terrain/slope/calculate', {
      data: {
        projectId: testProjectId,
        maxBuildableSlope: 150.0  // Invalid: > 100%
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('must be between 0 and 100');
  });

  test.skip('should return 404 for non-existent project', async ({ request }) => {
    const response = await request.get('/api/terrain/slope/non-existent-project');

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('not found');
  });
});
