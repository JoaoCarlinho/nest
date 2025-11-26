import { test, expect } from '@playwright/test';

/**
 * End-to-end API tests for aspect (orientation) analysis
 *
 * Tests complete workflow:
 * 1. POST /api/terrain/aspect/calculate - Trigger calculation
 * 2. GET /api/terrain/aspect/:projectId - Retrieve results
 * 3. GET /api/terrain/aspect/:projectId/geotiff - Download GeoTIFF
 * 4. GET /api/terrain/aspect/:projectId/visualization - Download visualization
 * 5. GET /api/terrain/aspect/:projectId/statistics - Get statistics
 */

test.describe('Aspect Analysis API', () => {
  const testProjectId = 'test-project-aspect-001';

  test.skip('should complete full aspect analysis workflow', async ({ request }) => {
    // This test validates the complete workflow from AC#1-6

    // Step 1: Trigger aspect calculation
    const calculateResponse = await request.post('/api/terrain/aspect/calculate', {
      data: {
        projectId: testProjectId,
        flatAreaThreshold: 2.0
      }
    });

    expect(calculateResponse.ok()).toBeTruthy();
    const calculateData = await calculateResponse.json();
    expect(calculateData.success).toBe(true);
    expect(calculateData.data.status).toBe('processing');

    // Step 2: Poll for completion (in real scenario)
    // await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 3: Retrieve aspect analysis results
    const resultsResponse = await request.get(`/api/terrain/aspect/${testProjectId}`);
    expect(resultsResponse.ok()).toBeTruthy();

    const resultsData = await resultsResponse.json();
    expect(resultsData.success).toBe(true);
    expect(resultsData.data.statistics).toBeDefined();
    expect(resultsData.data.outputs).toBeDefined();

    // Validate statistics structure
    const stats = resultsData.data.statistics;
    expect(stats.flatPercent).toBeDefined();
    expect(stats.distribution).toBeDefined();
    expect(stats.dominantDirection).toBeDefined();
    expect(stats.circularMeanAspect).toBeDefined();
    expect(stats.solarAnalysis).toBeDefined();

    // Validate directional distribution
    const dist = stats.distribution;
    expect(dist.north.percent).toBeDefined();
    expect(dist.northeast.percent).toBeDefined();
    expect(dist.east.percent).toBeDefined();
    expect(dist.southeast.percent).toBeDefined();
    expect(dist.south.percent).toBeDefined();
    expect(dist.southwest.percent).toBeDefined();
    expect(dist.west.percent).toBeDefined();
    expect(dist.northwest.percent).toBeDefined();

    // Validate percentages sum to 100%
    const total =
      dist.north.percent +
      dist.northeast.percent +
      dist.east.percent +
      dist.southeast.percent +
      dist.south.percent +
      dist.southwest.percent +
      dist.west.percent +
      dist.northwest.percent +
      stats.flatPercent;
    expect(Math.abs(total - 100)).toBeLessThan(0.1);

    // Validate solar analysis
    expect(stats.solarAnalysis.northFacingPercent).toBeDefined();
    expect(stats.solarAnalysis.southFacingPercent).toBeDefined();

    // Step 4: Download aspect GeoTIFF
    const geotiffResponse = await request.get(
      `/api/terrain/aspect/${testProjectId}/geotiff?type=aspect`
    );
    expect(geotiffResponse.ok()).toBeTruthy();

    // Step 5: Download classified GeoTIFF
    const classifiedResponse = await request.get(
      `/api/terrain/aspect/${testProjectId}/geotiff?type=classified`
    );
    expect(classifiedResponse.ok()).toBeTruthy();

    // Step 6: Download visualization
    const visualizationResponse = await request.get(
      `/api/terrain/aspect/${testProjectId}/visualization`
    );
    expect(visualizationResponse.ok()).toBeTruthy();

    // Step 7: Get statistics
    const statisticsResponse = await request.get(
      `/api/terrain/aspect/${testProjectId}/statistics`
    );
    expect(statisticsResponse.ok()).toBeTruthy();

    const statisticsData = await statisticsResponse.json();
    expect(statisticsData.success).toBe(true);
    expect(statisticsData.data.statistics.solarAnalysis).toBeDefined();
  });

  test.skip('should return error when DEM is missing', async ({ request }) => {
    // Test error handling for missing prerequisite (Story 1.4)

    const response = await request.post('/api/terrain/aspect/calculate', {
      data: {
        projectId: 'project-without-dem'
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Elevation grid');
    expect(data.details.requiredStory).toBe('1.4 - Elevation Grid Generation');
  });

  test.skip('should return error when slope analysis is missing', async ({ request }) => {
    // Test error handling for missing prerequisite (Story 2.1)

    const response = await request.post('/api/terrain/aspect/calculate', {
      data: {
        projectId: 'project-without-slope'
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Slope analysis required');
    expect(data.details.requiredStory).toBe('2.1 - Slope Calculation');
  });

  test.skip('should return error for invalid flatAreaThreshold', async ({ request }) => {
    // Test validation of flatAreaThreshold

    const response = await request.post('/api/terrain/aspect/calculate', {
      data: {
        projectId: testProjectId,
        flatAreaThreshold: 50.0 // Invalid: too high
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('must be between 0 and 10');
  });

  test.skip('should return 404 for non-existent project', async ({ request }) => {
    const response = await request.get('/api/terrain/aspect/non-existent-project');

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('not found');
  });

  test.skip('should calculate circular mean aspect correctly', async ({ request }) => {
    // Test circular statistics for aspects near 0°/360°

    const resultsResponse = await request.get(`/api/terrain/aspect/${testProjectId}`);
    const resultsData = await resultsResponse.json();

    const circularMean = resultsData.data.statistics.circularMeanAspect;

    // Circular mean should be between 0-360°
    expect(circularMean).toBeGreaterThanOrEqual(0);
    expect(circularMean).toBeLessThan(360);
  });

  test.skip('should identify dominant direction correctly', async ({ request }) => {
    // Test dominant direction identification

    const resultsResponse = await request.get(`/api/terrain/aspect/${testProjectId}`);
    const resultsData = await resultsResponse.json();

    const dominantDirection = resultsData.data.statistics.dominantDirection;

    // Dominant direction should be one of 8 cardinal directions
    const validDirections = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    expect(validDirections).toContain(dominantDirection);
  });

  test.skip('should provide north-facing and south-facing area GeoJSONs', async ({ request }) => {
    // Test AC#4: Identify north-facing vs south-facing slopes

    const resultsResponse = await request.get(`/api/terrain/aspect/${testProjectId}`);
    const resultsData = await resultsResponse.json();

    const outputs = resultsData.data.outputs;

    // Should have GeoJSON polygons for north-facing and south-facing areas
    expect(outputs.northFacingAreasGeojson).toBeDefined();
    expect(outputs.southFacingAreasGeojson).toBeDefined();

    // Parse GeoJSON to validate structure
    if (outputs.northFacingAreasGeojson) {
      const northFacingGeoJSON = JSON.parse(outputs.northFacingAreasGeojson);
      expect(northFacingGeoJSON.type).toBe('FeatureCollection');
      expect(northFacingGeoJSON.features).toBeDefined();
    }

    if (outputs.southFacingAreasGeojson) {
      const southFacingGeoJSON = JSON.parse(outputs.southFacingAreasGeojson);
      expect(southFacingGeoJSON.type).toBe('FeatureCollection');
      expect(southFacingGeoJSON.features).toBeDefined();
    }
  });
});
